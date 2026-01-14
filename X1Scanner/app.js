/* ============================================================
  X1Scanner/app.js  — Free-only Solana Token Contract Scanner
  - Market data: DexScreener
  - On-chain: Solana RPC (no paid API)
============================================================ */

/** ------------------ CONFIG ------------------ **/
const RPC_URLS = [
  "https://api.mainnet-beta.solana.com",
  "https://rpc.ankr.com/solana",
  "https://solana.drpc.org"
];

// DexScreener token endpoint (works for Solana tokens too)
const DEX_TOKENS = (mint) => `https://api.dexscreener.com/latest/dex/tokens/${encodeURIComponent(mint)}`;

// Timeouts
const FETCH_TIMEOUT_MS = 12000;

/** ------------------ DOM HELPERS ------------------ **/
const $ = (id) => document.getElementById(id);

function setText(id, txt) {
  const el = $(id);
  if (el) el.textContent = txt;
}

function setHTML(id, html) {
  const el = $(id);
  if (el) el.innerHTML = html;
}

function setStatus(msg) {
  setText("status", msg);
}

function setLogo(url) {
  const img = $("tokenLogo");
  if (!img) return;
  if (url) {
    img.src = url;
    img.style.display = "";
  } else {
    img.removeAttribute("src");
    img.style.display = "none";
  }
}

function setRiskBadge(level) {
  // level: "LOW" | "MEDIUM" | "HIGH"
  const el = $("riskBadge");
  if (!el) return;

  el.textContent = level === "LOW" ? "LOW RISK" : (level === "MEDIUM" ? "MEDIUM RISK" : "HIGH RISK");

  // you can style these classes in CSS: .good/.warn/.bad like in your DNA tool
  el.classList.remove("good", "warn", "bad");
  if (level === "LOW") el.classList.add("good");
  else if (level === "MEDIUM") el.classList.add("warn");
  else el.classList.add("bad");
}

/** ------------------ UTILS ------------------ **/
function looksBase58(s) {
  return typeof s === "string"
    && s.length >= 32 && s.length <= 52
    && /^[1-9A-HJ-NP-Za-km-z]+$/.test(s);
}

function shortAddr(a) {
  return a ? `${a.slice(0, 4)}…${a.slice(-4)}` : "—";
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
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

function fmtInt(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  const x = Number(n);
  if (!Number.isFinite(x)) return "—";
  try {
    return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(Math.floor(x));
  } catch {
    return String(Math.floor(x));
  }
}

async function fetchWithTimeout(url, options = {}, timeoutMs = FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    return res;
  } finally {
    clearTimeout(t);
  }
}

/** ------------------ RPC (fallback rotation) ------------------ **/
let _rpcIndex = 0;

async function rpcCall(method, params) {
  const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method, params });
  const urls = RPC_URLS;

  for (let attempt = 0; attempt < urls.length; attempt++) {
    const url = urls[_rpcIndex % urls.length];
    try {
      const res = await fetchWithTimeout(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body
      });

      if (res.status === 429) throw new Error("RPC rate limited (429)");
      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        throw new Error(`RPC HTTP ${res.status} ${txt}`.trim());
      }

      const j = await res.json();
      if (j?.error) throw new Error(j.error.message || "RPC error");
      return j.result;
    } catch (e) {
      _rpcIndex++;
      if (attempt === urls.length - 1) throw e;
    }
  }
}

/** ------------------ ON-CHAIN QUERIES ------------------ **/
async function getMintParsed(mint) {
  // getAccountInfo + jsonParsed on SPL Mint usually contains:
  // parsed.info.decimals, supply, mintAuthority, freezeAuthority, isInitialized
  const r = await rpcCall("getAccountInfo", [
    mint,
    { encoding: "jsonParsed", commitment: "confirmed" }
  ]);

  const v = r?.value;
  const parsed = v?.data?.parsed;
  if (!parsed || parsed.type !== "mint") return null;
  return parsed.info || null;
}

async function getTokenSupply(mint) {
  const r = await rpcCall("getTokenSupply", [mint]);
  return r?.value || null; // { amount, decimals, uiAmount, uiAmountString }
}

async function getTokenLargestAccounts(mint) {
  const r = await rpcCall("getTokenLargestAccounts", [mint]);
  return Array.isArray(r?.value) ? r.value : [];
}

async function getTokenAccountOwner(tokenAccount) {
  // token account parsed gives owner + tokenAmount
  const r = await rpcCall("getAccountInfo", [
    tokenAccount,
    { encoding: "jsonParsed", commitment: "confirmed" }
  ]);
  const parsed = r?.value?.data?.parsed;
  if (!parsed || parsed.type !== "account") return null;
  return parsed.info?.owner || null;
}

/** ------------------ MARKET QUERIES (DexScreener) ------------------ **/
async function getDexPairs(mint) {
  const res = await fetchWithTimeout(DEX_TOKENS(mint), { method: "GET" });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`DexScreener HTTP ${res.status} ${txt}`.trim());
  }
  const data = await res.json();
  const pairs = Array.isArray(data?.pairs) ? data.pairs : [];
  // prefer Solana chain + highest liquidity
  const solPairs = pairs.filter(p => String(p?.chainId || "").toLowerCase() === "solana");
  const list = solPairs.length ? solPairs : pairs;
  list.sort((a, b) => (Number(b?.liquidity?.usd || 0) - Number(a?.liquidity?.usd || 0)));
  return list;
}

function pickTokenMetaFromDex(bestPair, mint) {
  // DexScreener pair usually has baseToken { address, name, symbol }
  const base = bestPair?.baseToken || null;
  const quote = bestPair?.quoteToken || null;

  // choose which side is our mint
  let token = base;
  if (String(base?.address || "") !== mint && String(quote?.address || "") === mint) token = quote;

  const name = token?.name || "—";
  const symbol = token?.symbol || "—";

  // DexScreener sometimes includes token profile images; not guaranteed
  // Some responses provide "info.imageUrl" or "info" object; we try common fields
  const logo =
    bestPair?.info?.imageUrl ||
    bestPair?.baseToken?.logoURI ||
    bestPair?.quoteToken?.logoURI ||
    null;

  return { name, symbol, logo };
}

/** ------------------ RISK ENGINE ------------------ **/
function computeRiskSignals({ mintInfo, supplyUi, topHolders, owners, bestPair }) {
  const reasons = [];
  let score = 0;

  // Authorities
  const mintAuth = mintInfo?.mintAuthority || null;
  const freezeAuth = mintInfo?.freezeAuthority || null;

  if (mintAuth) { score += 25; reasons.push(`Mint authority is set (${shortAddr(mintAuth)}). Creator can mint more tokens.`); }
  else reasons.push("Mint authority is NOT set (good).");

  if (freezeAuth) { score += 20; reasons.push(`Freeze authority is set (${shortAddr(freezeAuth)}). Tokens can be frozen.`); }
  else reasons.push("Freeze authority is NOT set (good).");

  // Liquidity
  const liqUsd = Number(bestPair?.liquidity?.usd || 0);
  if (!bestPair) {
    score += 30;
    reasons.push("No market pair found on DexScreener (unknown liquidity/price).");
  } else {
    if (liqUsd < 10000) { score += 20; reasons.push(`Very low liquidity ($${fmtInt(liqUsd)}). High slippage/manipulation risk.`); }
    else if (liqUsd < 50000) { score += 10; reasons.push(`Low liquidity ($${fmtInt(liqUsd)}). Be careful with size.`); }
    else reasons.push(`Liquidity looks okay ($${fmtInt(liqUsd)}).`);
  }

  // Concentration (needs supply)
  if (supplyUi && supplyUi > 0 && Array.isArray(topHolders) && topHolders.length) {
    const topUi = topHolders.map(x => Number(x.uiAmount || 0));
    const top1 = (topUi[0] || 0) / supplyUi * 100;
    const top5 = topUi.slice(0, 5).reduce((a, b) => a + b, 0) / supplyUi * 100;
    const top20 = topUi.slice(0, 20).reduce((a, b) => a + b, 0) / supplyUi * 100;

    if (top1 > 20) { score += 20; reasons.push(`Top 1 holds ${top1.toFixed(2)}% (high concentration).`); }
    else if (top1 > 10) { score += 10; reasons.push(`Top 1 holds ${top1.toFixed(2)}% (moderate concentration).`); }
    else reasons.push(`Top 1 holds ${top1.toFixed(2)}% (good).`);

    if (top5 > 50) { score += 15; reasons.push(`Top 5 hold ${top5.toFixed(2)}% (high).`); }
    else if (top5 > 35) { score += 8; reasons.push(`Top 5 hold ${top5.toFixed(2)}% (moderate).`); }

    if (top20 > 80) { score += 10; reasons.push(`Top 20 hold ${top20.toFixed(2)}% (very concentrated).`); }
  } else {
    score += 10;
    reasons.push("Could not compute holder concentration (missing supply or holders).");
  }

  // Owner clustering in top accounts
  if (Array.isArray(owners) && owners.length) {
    const counts = new Map();
    for (const o of owners) {
      if (!o) continue;
      counts.set(o, (counts.get(o) || 0) + 1);
    }
    const clustered = Array.from(counts.entries()).filter(([, c]) => c >= 2).sort((a, b) => b[1] - a[1]);
    if (clustered.length) {
      score += clamp(clustered[0][1] * 4, 4, 16);
      reasons.push(`Cluster detected: same owner appears across multiple top token accounts (${shortAddr(clustered[0][0])} x${clustered[0][1]}).`);
    } else {
      reasons.push("No obvious clustering among top token accounts (good).");
    }
  }

  const level = score >= 60 ? "HIGH" : (score >= 35 ? "MEDIUM" : "LOW");
  return { score: clamp(score, 0, 100), level, reasons };
}

/** ------------------ RENDER HELPERS ------------------ **/
function renderHoldersList({ largest, owners, supplyUi }) {
  const el = $("holdersList");
  if (!el) return;

  if (!largest.length) {
    el.innerHTML = `<div style="opacity:.8">—</div>`;
    return;
  }

  const rows = largest.slice(0, 20).map((x, i) => {
    const addr = x.address;
    const ui = Number(x.uiAmount || 0);
    const pct = (supplyUi && supplyUi > 0) ? (ui / supplyUi * 100) : null;
    const owner = owners?.[i] || null;

    const pctTxt = pct === null ? "—" : `${pct.toFixed(2)}%`;
    const link = addr ? `https://solscan.io/account/${addr}` : "#";
    const ownerLink = owner ? `https://solscan.io/account/${owner}` : "#";

    return `
      <div class="tr">
        <div class="cellMain">#${i + 1}</div>
        <div>
          <div class="cellMain">${fmtInt(ui)} <span style="opacity:.7">(${pctTxt})</span></div>
          <div class="cellSub mono">
            TA: <a class="link" href="${link}" target="_blank" rel="noreferrer">${shortAddr(addr)}</a>
            ${owner ? ` • Owner: <a class="link" href="${ownerLink}" target="_blank" rel="noreferrer">${shortAddr(owner)}</a>` : ""}
          </div>
        </div>
        <div class="col3">—</div>
      </div>
    `;
  }).join("");

  el.innerHTML = rows;
}

function renderClusters(owners) {
  const el = $("clustersList");
  if (!el) return;

  if (!owners?.length) {
    el.innerHTML = `<div style="opacity:.8">—</div>`;
    return;
  }

  const counts = new Map();
  for (const o of owners) {
    if (!o) continue;
    counts.set(o, (counts.get(o) || 0) + 1);
  }

  const list = Array.from(counts.entries())
    .filter(([, c]) => c >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8);

  if (!list.length) {
    el.innerHTML = `<div style="opacity:.8">No clusters found in Top 20.</div>`;
    return;
  }

  el.innerHTML = list.map(([o, c]) => {
    const u = `https://solscan.io/account/${o}`;
    return `<div style="margin:8px 0;">
      <span class="badge warn">Cluster x${c}</span>
      <a class="link mono" href="${u}" target="_blank" rel="noreferrer" style="margin-left:10px;">${o}</a>
    </div>`;
  }).join("");
}

function safePairNum(p, path, fallback = null) {
  try {
    const parts = path.split(".");
    let cur = p;
    for (const k of parts) cur = cur?.[k];
    const n = Number(cur);
    return Number.isFinite(n) ? n : fallback;
  } catch {
    return fallback;
  }
}

/** ------------------ MAIN SCAN ------------------ **/
async function scanMint(mint) {
  setStatus("Scanning token…");
  setRiskBadge("MEDIUM");
  setText("riskReason", "—");

  // clear basics
  setText("tokenName", "—");
  setText("tokenSymbol", "—");
  setText("kPrice", "—");
  setText("kLiq", "—");
  setText("kMc", "—");
  setText("kFdv", "—");
  setText("kSupply", "—");
  setText("kDec", "—");
  setText("kAuthorities", "—");
  setHTML("holdersList", "");
  setHTML("clustersList", "");
  setLogo(null);

  if (!looksBase58(mint)) {
    setStatus("Invalid mint address (not base58 / wrong length).");
    setRiskBadge("HIGH");
    setText("riskReason", "Invalid input.");
    return;
  }

  try {
    // run on-chain + market in parallel
    const [mintParsed, supply, largest, pairs] = await Promise.all([
      getMintParsed(mint),
      getTokenSupply(mint).catch(() => null),
      getTokenLargestAccounts(mint).catch(() => []),
      getDexPairs(mint).catch(() => [])
    ]);

    // Best pair
    const bestPair = pairs?.[0] || null;

    // Token meta
    let name = "—", symbol = "—", logo = null;
    if (bestPair) {
      const meta = pickTokenMetaFromDex(bestPair, mint);
      name = meta.name || "—";
      symbol = meta.symbol || "—";
      logo = meta.logo || null;
    }
    // If dex doesn't have name/symbol, keep it as — (free-only limitation)
    setText("tokenName", name);
    setText("tokenSymbol", symbol);
    setLogo(logo);

    // Market stats from best pair (if exists)
    if (bestPair) {
      const priceUsd = safePairNum(bestPair, "priceUsd", null);
      const liqUsd = safePairNum(bestPair, "liquidity.usd", null);
      const fdv = safePairNum(bestPair, "fdv", null);
      const mc = safePairNum(bestPair, "marketCap", null);

      setText("kPrice", priceUsd !== null ? `$${fmtNum(priceUsd, 8)}` : "—");
      setText("kLiq", liqUsd !== null ? `$${fmtInt(liqUsd)}` : "—");
      setText("kFdv", fdv !== null ? `$${fmtInt(fdv)}` : "—");
      setText("kMc", mc !== null ? `$${fmtInt(mc)}` : "—");
    }

    // On-chain mint info
    const decimals = supply ? Number(supply.decimals || 0) : (mintParsed ? Number(mintParsed.decimals || 0) : null);
    const supplyUi = supply ? Number(supply.uiAmount || 0) : null;

    setText("kDec", decimals !== null ? String(decimals) : "—");
    setText("kSupply", supplyUi !== null ? fmtInt(supplyUi) : "—");

    const mintAuth = mintParsed?.mintAuthority || null;
    const freezeAuth = mintParsed?.freezeAuthority || null;

    const authTxt = [
      `Mint: ${mintAuth ? shortAddr(mintAuth) : "NONE"}`,
      `Freeze: ${freezeAuth ? shortAddr(freezeAuth) : "NONE"}`
    ].join(" • ");
    setText("kAuthorities", authTxt);

    // Owners for top token accounts (to cluster)
    const top20 = Array.isArray(largest) ? largest.slice(0, 20) : [];
    const owners = [];
    for (const it of top20) {
      try {
        const owner = await getTokenAccountOwner(it.address);
        owners.push(owner);
      } catch {
        owners.push(null);
      }
    }

    // Render holders + clusters
    renderHoldersList({ largest: top20, owners, supplyUi });
    renderClusters(owners);

    // Risk
    const risk = computeRiskSignals({
      mintInfo: mintParsed,
      supplyUi,
      topHolders: top20,
      owners,
      bestPair
    });

    setRiskBadge(risk.level);
    setText("riskReason", `Score ${risk.score}/100`);

    // Put reasons (if you have an element for it)
    const reasonsEl = $("riskReasons");
    if (reasonsEl) {
      reasonsEl.innerHTML = risk.reasons.map(r => `<div style="margin:6px 0; opacity:.9">• ${r}</div>`).join("");
    }

    setStatus(`Scan complete • ${risk.level} RISK`);
  } catch (e) {
    console.error(e);
    setStatus("Scan failed: " + (e?.message || "unknown error"));
    setRiskBadge("HIGH");
    setText("riskReason", "Scan failed.");
  }
}

/** ------------------ WIRE UI ------------------ **/
function getMintInputValue() {
  // support either <input id="mint"> or your existing <input id="wallet">
  const a = $("mint");
  const b = $("wallet");
  const v = (a?.value || b?.value || "").trim();
  return v;
}

function bind() {
  const btn = $("btnScan");
  if (btn) btn.addEventListener("click", () => scanMint(getMintInputValue()));

  const a = $("mint");
  const b = $("wallet");
  [a, b].forEach(inp => {
    if (!inp) return;
    inp.addEventListener("keydown", (e) => {
      if (e.key === "Enter") scanMint(getMintInputValue());
    });
  });
}

bind();

// expose for manual testing in console: window.scanMint("MINT...")
window.scanMint = scanMint;
