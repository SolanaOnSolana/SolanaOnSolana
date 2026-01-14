/* ============================================================
   X1 Contract Scanner — app.js (NO paid APIs)
   - On-chain via Cloudflare Worker RPC proxy (Helius upstream)
   - Market/trending via DexScreener (public endpoints)
   ============================================================ */

/** ✅ SET THIS to your Cloudflare Worker URL */
const RPC_PROXY = "https://x1-rpc-proxy.simon-kaggwa-why.workers.dev";

/** RPC config */
const RPC_TIMEOUT_MS = 12000;

/** DexScreener endpoints (public) */
const DEX_TOKEN_URL = (mint) => `https://api.dexscreener.com/latest/dex/tokens/${encodeURIComponent(mint)}`;
const DEX_BOOSTED_SOL = "https://api.dexscreener.com/latest/dex/boosted/solana";   // trending-ish
const DEX_SEARCH_SOL = (q) => `https://api.dexscreener.com/latest/dex/search/?q=${encodeURIComponent(q)}`;

/** Solscan links */
const SOLSCAN_TOKEN = (mint) => `https://solscan.io/token/${mint}`;
const SOLSCAN_ACCOUNT = (addr) => `https://solscan.io/account/${addr}`;

/** Helpers */
const $ = (id) => document.getElementById(id);
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const shortAddr = (a) => (a ? `${a.slice(0, 4)}…${a.slice(-4)}` : "—");
const looksBase58 = (s) =>
  typeof s === "string" &&
  s.length >= 32 &&
  s.length <= 52 &&
  /^[1-9A-HJ-NP-Za-km-z]+$/.test(s);

function fmtInt(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  try {
    return new Intl.NumberFormat("en-US").format(Math.round(Number(n)));
  } catch {
    return String(n);
  }
}
function fmtNum(n, digits = 2) {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  const x = Number(n);
  if (!Number.isFinite(x)) return "—";
  try {
    return new Intl.NumberFormat("en-US", { maximumFractionDigits: digits }).format(x);
  } catch {
    return String(x);
  }
}
function fmtUsd(n, digits = 2) {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  const x = Number(n);
  if (!Number.isFinite(x)) return "—";
  if (x >= 1_000_000_000) return `$${fmtNum(x / 1_000_000_000, 2)}B`;
  if (x >= 1_000_000) return `$${fmtNum(x / 1_000_000, 2)}M`;
  if (x >= 1_000) return `$${fmtNum(x / 1_000, 2)}K`;
  return `$${fmtNum(x, digits)}`;
}
function setStatus(msg) {
  const el = $("status");
  if (el) el.textContent = msg || "—";
}
function setBadge(el, txt, mode) {
  if (!el) return;
  el.textContent = txt;
  el.classList.remove("good", "warn", "bad");
  if (mode) el.classList.add(mode);
}
function setScoreBar(pct) {
  const bar = $("scoreBar");
  if (!bar) return;
  bar.style.width = clamp(pct, 0, 100) + "%";
}

/** Fetch with timeout */
async function fetchTimeout(url, opts = {}, ms = RPC_TIMEOUT_MS) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(url, { ...opts, signal: controller.signal });
    return res;
  } finally {
    clearTimeout(t);
  }
}

/** JSON-RPC via Worker proxy (POST only) */
async function rpc(method, params) {
  if (!RPC_PROXY) throw new Error("RPC proxy not set.");
  const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method, params });
  const res = await fetchTimeout(RPC_PROXY, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`RPC HTTP ${res.status} ${txt}`.slice(0, 180));
  }
  const j = await res.json();
  if (j.error) throw new Error(j.error.message || "RPC error");
  return j.result;
}

/** On-chain queries */
async function getTokenSupply(mint) {
  const r = await rpc("getTokenSupply", [mint]);
  return r?.value || null; // { amount, decimals, uiAmount, uiAmountString }
}

async function getMintAuthorities(mint) {
  // Use getAccountInfo on mint account (parsed)
  const r = await rpc("getAccountInfo", [
    mint,
    { encoding: "jsonParsed", commitment: "confirmed" },
  ]);
  const info = r?.value?.data?.parsed?.info;
  // For SPL Token mint: parsed.info has mintAuthority and freezeAuthority
  const mintAuthority = info?.mintAuthority ?? null;
  const freezeAuthority = info?.freezeAuthority ?? null;
  const program = r?.value?.owner || null; // token program
  return { mintAuthority, freezeAuthority, program };
}

async function getLargestTokenAccounts(mint) {
  const r = await rpc("getTokenLargestAccounts", [mint]);
  return Array.isArray(r?.value) ? r.value : [];
}

async function getTokenAccountsOwners(tokenAccounts) {
  // tokenAccounts are token account addresses; we need owners (getAccountInfo parsed)
  // We'll do a batch via getMultipleAccounts with jsonParsed
  if (!tokenAccounts.length) return [];
  const r = await rpc("getMultipleAccounts", [
    tokenAccounts,
    { encoding: "jsonParsed", commitment: "confirmed" },
  ]);
  const vals = r?.value || [];
  return vals.map((acc, i) => {
    const owner = acc?.data?.parsed?.info?.owner || null;
    return { tokenAccount: tokenAccounts[i], owner };
  });
}

/** DexScreener (market) */
async function dexToken(mint) {
  const res = await fetchTimeout(DEX_TOKEN_URL(mint), {}, 12000);
  if (!res.ok) return null;
  const j = await res.json().catch(() => null);
  return j;
}

function pickBestPair(pairs) {
  if (!Array.isArray(pairs) || !pairs.length) return null;
  // prefer highest liquidity USD, then highest volume 24h
  const sorted = pairs.slice().sort((a, b) => {
    const la = Number(a?.liquidity?.usd || 0);
    const lb = Number(b?.liquidity?.usd || 0);
    if (lb !== la) return lb - la;
    const va = Number(a?.volume?.h24 || 0);
    const vb = Number(b?.volume?.h24 || 0);
    return vb - va;
  });
  return sorted[0] || null;
}

function pairAgeText(pair) {
  // DexScreener often includes pairCreatedAt (ms)
  const ts = Number(pair?.pairCreatedAt || 0);
  if (!ts) return "—";
  const ageMs = Date.now() - ts;
  if (ageMs < 0) return "—";
  const mins = Math.floor(ageMs / 60000);
  const hrs = Math.floor(mins / 60);
  const days = Math.floor(hrs / 24);
  if (days >= 1) return `${days}d`;
  if (hrs >= 1) return `${hrs}h`;
  return `${mins}m`;
}

/** Trending (DexScreener public)
 *  Dex boosted endpoint returns pairs; we filter to Solana and show top.
 *  Pumpfun trending (heuristic): from boosted list, keep mints ending with "pump" and show top.
 */
async function loadTrending() {
  const dexEl = $("dexTrending");
  const pumpEl = $("pumpTrending");
  const dexHint = $("dexTrendHint");
  const pumpHint = $("pumpTrendHint");

  if (dexEl) dexEl.innerHTML = `<div class="trendEmpty">Loading…</div>`;
  if (pumpEl) pumpEl.innerHTML = `<div class="trendEmpty">Loading…</div>`;

  try {
    const res = await fetchTimeout(DEX_BOOSTED_SOL, {}, 12000);
    const j = await res.json().catch(() => null);
    const pairs = Array.isArray(j?.pairs) ? j.pairs : [];

    // filter solana chain
    const solPairs = pairs.filter((p) => (p?.chainId || "").toLowerCase() === "solana");

    // sort by liquidity usd then vol
    solPairs.sort((a, b) => {
      const la = Number(a?.liquidity?.usd || 0);
      const lb = Number(b?.liquidity?.usd || 0);
      if (lb !== la) return lb - la;
      return Number(b?.volume?.h24 || 0) - Number(a?.volume?.h24 || 0);
    });

    const topDex = solPairs.slice(0, 10);
    const topPump = solPairs
      .filter((p) => String(p?.baseToken?.address || "").endsWith("pump"))
      .slice(0, 10);

    if (dexHint) dexHint.textContent = topDex.length ? `${topDex.length} tokens` : "—";
    if (pumpHint) pumpHint.textContent = topPump.length ? `${topPump.length} tokens` : "—";

    const render = (arr, el) => {
      if (!el) return;
      if (!arr.length) {
        el.innerHTML = `<div class="trendEmpty">No trending data.</div>`;
        return;
      }
      el.innerHTML = "";
      arr.forEach((p, idx) => {
        const name = p?.baseToken?.name || "—";
        const sym = p?.baseToken?.symbol || "—";
        const mint = p?.baseToken?.address || "";
        const price = p?.priceUsd ? `$${fmtNum(p.priceUsd, 8)}` : "—";
        const liq = fmtUsd(p?.liquidity?.usd || 0);
        const mc = fmtUsd(p?.marketCap || p?.fdv || 0);
        const url = p?.url || (mint ? SOLSCAN_TOKEN(mint) : "#");

        const row = document.createElement("a");
        row.className = "trendRow";
        row.href = "#";
        row.addEventListener("click", (e) => {
          e.preventDefault();
          const inp = $("mint");
          if (inp && mint) {
            inp.value = mint;
            scan();
          }
        });

        row.innerHTML = `
          <div class="trendIdx">${idx + 1}</div>
          <div class="trendMain">
            <div class="trendTitle">${name} <span class="muted">(${sym})</span></div>
            <div class="trendSub mono">${mint ? shortAddr(mint) : "—"}</div>
          </div>
          <div class="trendNums">
            <div class="trendNum"><span class="muted">Price</span> ${price}</div>
            <div class="trendNum"><span class="muted">Liq</span> ${liq}</div>
            <div class="trendNum"><span class="muted">MCap</span> ${mc}</div>
          </div>
        `;
        el.appendChild(row);
      });
    };

    render(topDex, dexEl);
    render(topPump, pumpEl);

  } catch (e) {
    if (dexEl) dexEl.innerHTML = `<div class="trendEmpty">Failed to load.</div>`;
    if (pumpEl) pumpEl.innerHTML = `<div class="trendEmpty">Failed to load.</div>`;
    if (dexHint) dexHint.textContent = "—";
    if (pumpHint) pumpHint.textContent = "—";
  }
}

/** Risk scoring */
function buildRisk({ mintAuth, freezeAuth, liqUsd, top1Pct, top5Pct, top20Pct, clustersCount }) {
  // score: 0 best, 100 worst
  let score = 0;
  const reasons = [];

  // Authorities
  if (!mintAuth) {
    reasons.push("Mint authority NOT set (good).");
  } else {
    score += 35;
    reasons.push("Mint authority is set (risk: can mint more).");
  }

  if (!freezeAuth) {
    reasons.push("Freeze authority NOT set (good).");
  } else {
    score += 25;
    reasons.push("Freeze authority is set (risk: can freeze wallets).");
  }

  // Liquidity
  if (liqUsd >= 250_000) {
    reasons.push(`Liquidity strong (${fmtUsd(liqUsd)}).`);
  } else if (liqUsd >= 50_000) {
    score += 10;
    reasons.push(`Liquidity ok (${fmtUsd(liqUsd)}).`);
  } else if (liqUsd >= 10_000) {
    score += 20;
    reasons.push(`Liquidity low (${fmtUsd(liqUsd)}).`);
  } else {
    score += 30;
    reasons.push(`Liquidity very low (${fmtUsd(liqUsd)}).`);
  }

  // Concentration (top holders)
  if (top1Pct >= 35) {
    score += 25;
    reasons.push(`Top1 concentration ${top1Pct.toFixed(2)}% (very high).`);
  } else if (top1Pct >= 20) {
    score += 15;
    reasons.push(`Top1 concentration ${top1Pct.toFixed(2)}% (high).`);
  } else if (top1Pct >= 10) {
    score += 8;
    reasons.push(`Top1 concentration ${top1Pct.toFixed(2)}% (medium).`);
  } else {
    reasons.push(`Top1 concentration ${top1Pct.toFixed(2)}% (low).`);
  }

  if (top5Pct >= 65) {
    score += 18;
    reasons.push(`Top5 concentration ${top5Pct.toFixed(2)}% (very high).`);
  } else if (top5Pct >= 45) {
    score += 12;
    reasons.push(`Top5 concentration ${top5Pct.toFixed(2)}% (high).`);
  } else if (top5Pct >= 30) {
    score += 6;
    reasons.push(`Top5 concentration ${top5Pct.toFixed(2)}% (medium).`);
  } else {
    reasons.push(`Top5 concentration ${top5Pct.toFixed(2)}% (low).`);
  }

  if (clustersCount >= 3) {
    score += 15;
    reasons.push(`Owner clusters detected (${clustersCount}).`);
  } else if (clustersCount >= 1) {
    score += 8;
    reasons.push(`Some owner clustering detected (${clustersCount}).`);
  } else {
    reasons.push("No obvious Top20 owner clusters (good).");
  }

  score = clamp(score, 0, 100);

  let label = "MED RISK", badge = "warn";
  if (score <= 34) { label = "LOW RISK"; badge = "good"; }
  else if (score >= 70) { label = "HIGH RISK"; badge = "bad"; }

  return { score, label, badge, reasons };
}

/** UI renderers */
function renderRiskReasons(items) {
  const ul = $("riskList");
  if (!ul) return;
  ul.innerHTML = "";
  if (!items || !items.length) {
    ul.innerHTML = `<li class="muted">No risk reasons.</li>`;
    return;
  }
  items.forEach((t) => {
    const li = document.createElement("li");
    li.textContent = t;
    ul.appendChild(li);
  });
}

function renderHoldersTable({ holders, supplyUi }) {
  const table = $("holdersTable");
  const hint = $("holdersHint");
  if (!table) return;

  // keep header
  const head = table.querySelector(".tr.th");
  table.innerHTML = "";
  if (head) table.appendChild(head);

  if (!holders || !holders.length) {
    const row = document.createElement("div");
    row.className = "tr";
    row.innerHTML = `
      <div class="cellMain">—</div>
      <div class="cellMain muted">No data</div>
      <div class="cellMain muted">—</div>
      <div class="cellMain muted">—</div>
      <div class="cellMain muted">—</div>
    `;
    table.appendChild(row);
    if (hint) hint.textContent = "—";
    return;
  }

  if (hint) hint.textContent = `${holders.length} accounts`;

  holders.forEach((h, i) => {
    const amt = Number(h.uiAmount || 0);
    const pct = supplyUi > 0 ? (amt / supplyUi) * 100 : 0;
    const ta = h.address;
    const owner = h.owner || "—";

    const row = document.createElement("div");
    row.className = "tr";
    row.innerHTML = `
      <div class="cellMain">#${i + 1}</div>
      <div>
        <div class="cellMain">${fmtInt(amt)} <span class="muted">(${pct.toFixed(2)}%)</span></div>
      </div>
      <div><a class="link mono" href="${SOLSCAN_ACCOUNT(ta)}" target="_blank" rel="noreferrer">${shortAddr(ta)}</a></div>
      <div><a class="link mono" href="${SOLSCAN_ACCOUNT(owner)}" target="_blank" rel="noreferrer">${shortAddr(owner)}</a></div>
      <div><a class="link" href="${SOLSCAN_ACCOUNT(ta)}" target="_blank" rel="noreferrer">View</a></div>
    `;
    table.appendChild(row);
  });
}

function renderClusters(clusterMap) {
  const box = $("clusterBox");
  if (!box) return;

  const entries = Array.from(clusterMap.entries())
    .filter(([, arr]) => arr.length >= 2)
    .sort((a, b) => b[1].length - a[1].length);

  if (!entries.length) {
    box.innerHTML = `<div>No clusters found in Top 20.</div>`;
    return;
  }

  box.innerHTML = "";
  entries.forEach(([owner, tas]) => {
    const div = document.createElement("div");
    div.className = "clusterItem";
    div.innerHTML = `
      <div><span class="muted">Owner</span> <a class="link mono" href="${SOLSCAN_ACCOUNT(owner)}" target="_blank" rel="noreferrer">${owner}</a></div>
      <div class="muted" style="margin-top:6px;">Token accounts: ${tas.map(a => shortAddr(a)).join(", ")}</div>
    `;
    box.appendChild(div);
  });
}

/** Main scan */
async function scan() {
  const mint = ($("mint")?.value || "").trim();
  if (!looksBase58(mint)) {
    setStatus("Invalid mint address.");
    return;
  }

  // Reset UI quickly
  $("mintShort").textContent = shortAddr(mint);
  $("dexLink").textContent = "—";
  $("dexLink").href = "#";
  $("scanHint").textContent = "Scanning…";
  renderRiskReasons([]);
  setStatus("Running scan…");

  // Clear token logo initially
  const logoEl = $("tokenLogo");
  if (logoEl) logoEl.style.display = "none";

  try {
    // Parallel: Dex + onchain
    const [dex, supply, auth] = await Promise.all([
      dexToken(mint),
      getTokenSupply(mint),
      getMintAuthorities(mint),
    ]);

    // Dex info
    const pairs = Array.isArray(dex?.pairs) ? dex.pairs : [];
    const pair = pickBestPair(pairs);

    const tokenName = pair?.baseToken?.name || dex?.pairs?.[0]?.baseToken?.name || "—";
    const tokenSymbol = pair?.baseToken?.symbol || dex?.pairs?.[0]?.baseToken?.symbol || "—";
    $("tokenName").textContent = tokenName;
    $("tokenSymbol").textContent = tokenSymbol ? `(${tokenSymbol})` : "—";

    // Token logo (Dex)
    const imgUrl =
      pair?.baseToken?.icon ||
      pair?.info?.imageUrl ||
      pair?.info?.openGraphImageUrl ||
      null;

    if (logoEl && imgUrl) {
      logoEl.src = imgUrl;
      logoEl.style.display = "";
    } else if (logoEl) {
      logoEl.style.display = "none";
    }

    // Market KPIs
    const priceUsd = pair?.priceUsd ? Number(pair.priceUsd) : null;
    const liqUsd = Number(pair?.liquidity?.usd || 0);
    const mcap = Number(pair?.marketCap || 0);
    const fdv = Number(pair?.fdv || 0);
    const bestMc = mcap > 0 ? mcap : (fdv > 0 ? fdv : 0);

    $("kPrice").textContent = priceUsd ? `$${fmtNum(priceUsd, priceUsd < 0.01 ? 8 : 6)}` : "—";
    $("kLiq").textContent = liqUsd ? fmtUsd(liqUsd) : "—";
    $("kMc").textContent = bestMc ? fmtUsd(bestMc) : "—";

    // Dex link
    const dexUrl = pair?.url || (mint ? SOLSCAN_TOKEN(mint) : "#");
    const dexLink = $("dexLink");
    if (dexLink) {
      dexLink.href = dexUrl;
      dexLink.textContent = pair ? (pair?.dexId ? `${pair.dexId} • ${shortAddr(pair.pairAddress || "")}` : "Dex link") : "—";
    }

    // Onchain supply/decimals
    const decimals = supply ? Number(supply.decimals || 0) : null;
    const uiSupply = supply ? Number(supply.uiAmount || 0) : null;

    $("kSupply").textContent = uiSupply !== null ? fmtInt(uiSupply) : "—";
    $("kDec").textContent = decimals !== null ? String(decimals) : "—";

    // Authorities
    const mintAuth = auth?.mintAuthority || null;
    const freezeAuth = auth?.freezeAuthority || null;
    const program = auth?.program || null;

    const authLine = $("authLine");
    if (authLine) {
      const a1 = mintAuth ? "Mint: SET" : "Mint: NONE";
      const a2 = freezeAuth ? "Freeze: SET" : "Freeze: NONE";
      authLine.textContent = `${a1} • ${a2}`;
    }

    $("sMintAuth").textContent = mintAuth ? "SET" : "NONE";
    $("sFreezeAuth").textContent = freezeAuth ? "SET" : "NONE";
    $("sProgram").textContent = program ? shortAddr(program) : "—";

    // Pair/market extra signals
    $("sLiq").textContent = liqUsd ? fmtUsd(liqUsd) : "—";
    $("sVol").textContent = pair?.volume?.h24 ? fmtUsd(pair.volume.h24) : "—";
    $("sAge").textContent = pair ? pairAgeText(pair) : "—";
    $("sDex").textContent = pair?.dexId ? String(pair.dexId).toUpperCase() : "—";

    // Holders & concentration
    $("holdersHint").textContent = "Loading…";
    const largest = await getLargestTokenAccounts(mint);
    const top20 = largest.slice(0, 20);

    // owners for each token account
    const tas = top20.map((x) => x.address);
    const owners = await getTokenAccountsOwners(tas);

    // merge
    const holders = top20.map((x) => {
      const match = owners.find((o) => o.tokenAccount === x.address);
      return {
        address: x.address,
        uiAmount: Number(x.uiAmount || 0),
        owner: match?.owner || null,
      };
    });

    // holder pct
    const supplyUi = uiSupply || 0;
    const sortedH = holders.slice().sort((a, b) => b.uiAmount - a.uiAmount);
    const top1 = sortedH[0]?.uiAmount || 0;
    const top5 = sortedH.slice(0, 5).reduce((acc, x) => acc + x.uiAmount, 0);
    const top20sum = sortedH.reduce((acc, x) => acc + x.uiAmount, 0);

    const top1Pct = supplyUi > 0 ? (top1 / supplyUi) * 100 : 0;
    const top5Pct = supplyUi > 0 ? (top5 / supplyUi) * 100 : 0;
    const top20Pct = supplyUi > 0 ? (top20sum / supplyUi) * 100 : 0;

    $("kTop20").textContent = supplyUi > 0 ? `${top20Pct.toFixed(2)}%` : "—";
    $("sHolders").textContent = `${holders.length}/20`;

    // clusters by owner
    const clusterMap = new Map();
    holders.forEach((h) => {
      const owner = h.owner || "—";
      if (!clusterMap.has(owner)) clusterMap.set(owner, []);
      clusterMap.get(owner).push(h.address);
    });
    const clustersCount = Array.from(clusterMap.values()).filter((arr) => arr.length >= 2).length;

    // render holders + clusters
    renderHoldersTable({ holders: sortedH, supplyUi });
    renderClusters(clusterMap);

    // Risk
    const risk = buildRisk({
      mintAuth,
      freezeAuth,
      liqUsd,
      top1Pct,
      top5Pct,
      top20Pct,
      clustersCount,
    });

    const riskBadge = $("riskBadge");
    const scoreBadge = $("scoreBadge");
    setBadge(riskBadge, risk.label, risk.badge);

    if (scoreBadge) scoreBadge.textContent = `Score ${risk.score}/100`;
    setScoreBar(risk.score);

    // Verdict panel
    $("verdictBig").textContent = risk.label;
    $("verdictSub").textContent =
      risk.label === "LOW RISK"
        ? "Clean authorities + acceptable liquidity + no strong clustering."
        : risk.label === "MED RISK"
        ? "Mixed signals. Check liquidity, concentration and owners before aping."
        : "High risk signals detected. Extreme caution recommended.";

    renderRiskReasons(risk.reasons);

    $("scanHint").textContent = pair ? "Market + on-chain loaded" : "On-chain loaded (no Dex pair found)";
    setStatus(`Scan complete • ${risk.label}`);

  } catch (e) {
    console.error(e);
    $("scanHint").textContent = "Scan failed";
    renderRiskReasons([String(e?.message || "Unknown error")]);
    setStatus("Scan failed: " + (e?.message || "unknown error"));
  }
}

/** Wire up */
function boot() {
  // scan button
  const btn = $("btnScan");
  if (btn) btn.addEventListener("click", scan);

  // enter key
  const mint = $("mint");
  if (mint) mint.addEventListener("keydown", (e) => {
    if (e.key === "Enter") scan();
  });

  // trending
  loadTrending();
  // refresh trending every 60s
  setInterval(loadTrending, 60000);
}

boot();
