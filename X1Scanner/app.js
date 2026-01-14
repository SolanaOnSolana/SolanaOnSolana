/* ============================================================
  X1Scanner/app.js  — Robust Free-only Solana Token Scanner
  - Market data: DexScreener
  - On-chain: Solana RPC with automatic failover
============================================================ */

const RPC_URLS = [
  "https://api.mainnet-beta.solana.com",
  "https://rpc.ankr.com/solana",
  "https://solana.drpc.org"
];

const DEX_TOKENS = (mint) => `https://api.dexscreener.com/latest/dex/tokens/${encodeURIComponent(mint)}`;
const FETCH_TIMEOUT_MS = 12000;

const $ = (id) => document.getElementById(id);

function setText(id, txt){ const el = $(id); if(el) el.textContent = txt; }
function setStatus(msg){ setText("status", msg); }
function setHTML(id, html){ const el = $(id); if(el) el.innerHTML = html; }

function setLogo(url){
  const img = $("tokenLogo");
  if(!img) return;
  if(url){ img.src = url; img.style.display=""; }
  else { img.removeAttribute("src"); img.style.display="none"; }
}

function setRiskBadge(level){
  const el = $("riskBadge");
  if(!el) return;
  el.textContent = level === "LOW" ? "LOW RISK" : (level === "MEDIUM" ? "MEDIUM RISK" : "HIGH RISK");
  el.classList.remove("good","warn","bad");
  if(level === "LOW") el.classList.add("good");
  else if(level === "MEDIUM") el.classList.add("warn");
  else el.classList.add("bad");
}

/** ------------------ utils ------------------ **/
function looksBase58(s){
  return typeof s === "string"
    && s.length >= 32 && s.length <= 52
    && /^[1-9A-HJ-NP-Za-km-z]+$/.test(s);
}
function shortAddr(a){ return a ? `${a.slice(0,4)}…${a.slice(-4)}` : "—"; }
function clamp(n,min,max){ return Math.max(min, Math.min(max, n)); }
function fmtNum(n, digits=2){
  if(n === null || n === undefined || Number.isNaN(n)) return "—";
  const x = Number(n);
  if(!Number.isFinite(x)) return "—";
  try { return new Intl.NumberFormat("en-US",{ maximumFractionDigits: digits }).format(x); }
  catch { return String(x); }
}
function fmtInt(n){
  if(n === null || n === undefined || Number.isNaN(n)) return "—";
  const x = Number(n);
  if(!Number.isFinite(x)) return "—";
  try { return new Intl.NumberFormat("en-US",{ maximumFractionDigits: 0 }).format(Math.floor(x)); }
  catch { return String(Math.floor(x)); }
}

async function fetchWithTimeout(url, options={}, timeoutMs=FETCH_TIMEOUT_MS){
  const controller = new AbortController();
  const t = setTimeout(()=>controller.abort(), timeoutMs);
  try{
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(t);
  }
}

/** ------------------ RPC failover ------------------ **/
let _rpcCursor = 0;

async function rpcCall(method, params){
  const body = JSON.stringify({ jsonrpc:"2.0", id:1, method, params });
  let lastErr = null;

  for(let attempt=0; attempt<RPC_URLS.length; attempt++){
    const url = RPC_URLS[(_rpcCursor + attempt) % RPC_URLS.length];
    try{
      const res = await fetchWithTimeout(url, {
        method:"POST",
        headers:{ "Content-Type":"application/json" },
        body
      });

      // retry on rate limits / server errors
      if(res.status === 429 || res.status >= 500){
        const txt = await res.text().catch(()=> "");
        throw new Error(`RPC ${res.status} ${txt}`.slice(0,220));
      }
      if(!res.ok){
        const txt = await res.text().catch(()=> "");
        throw new Error(`RPC HTTP ${res.status} ${txt}`.slice(0,220));
      }

      const j = await res.json();
      if(j?.error) throw new Error(j.error.message || "RPC error");
      _rpcCursor = (_rpcCursor + attempt + 1) % RPC_URLS.length; // move forward
      return j.result;

    }catch(e){
      lastErr = e;
      // continue to next rpc
    }
  }

  throw lastErr || new Error("RPC failed");
}

/** ------------------ On-chain queries ------------------ **/
async function getMintParsed(mint){
  const r = await rpcCall("getAccountInfo", [mint, { encoding:"jsonParsed", commitment:"confirmed" }]);
  const parsed = r?.value?.data?.parsed;
  if(!parsed || parsed.type !== "mint") return null;
  return parsed.info || null;
}
async function getTokenSupply(mint){
  const r = await rpcCall("getTokenSupply", [mint]);
  return r?.value || null;
}
async function getTokenLargestAccounts(mint){
  const r = await rpcCall("getTokenLargestAccounts", [mint]);
  return Array.isArray(r?.value) ? r.value : [];
}
async function getTokenAccountOwner(tokenAccount){
  const r = await rpcCall("getAccountInfo", [tokenAccount, { encoding:"jsonParsed", commitment:"confirmed" }]);
  const parsed = r?.value?.data?.parsed;
  if(!parsed || parsed.type !== "account") return null;
  return parsed.info?.owner || null;
}

/** ------------------ Market (DexScreener) ------------------ **/
async function getDexPairs(mint){
  const res = await fetchWithTimeout(DEX_TOKENS(mint), { method:"GET" });
  if(!res.ok){
    const txt = await res.text().catch(()=> "");
    throw new Error(`DexScreener HTTP ${res.status} ${txt}`.slice(0,180));
  }
  const data = await res.json();
  const pairs = Array.isArray(data?.pairs) ? data.pairs : [];
  const solPairs = pairs.filter(p => String(p?.chainId||"").toLowerCase() === "solana");
  const list = solPairs.length ? solPairs : pairs;
  list.sort((a,b)=> (Number(b?.liquidity?.usd||0) - Number(a?.liquidity?.usd||0)));
  return list;
}

function pickTokenMetaFromDex(bestPair, mint){
  const base = bestPair?.baseToken || null;
  const quote = bestPair?.quoteToken || null;
  let token = base;
  if(String(base?.address||"") !== mint && String(quote?.address||"") === mint) token = quote;

  const name = token?.name || "—";
  const symbol = token?.symbol || "—";
  const logo =
    bestPair?.info?.imageUrl ||
    bestPair?.baseToken?.logoURI ||
    bestPair?.quoteToken?.logoURI ||
    null;

  return { name, symbol, logo };
}

function safeNum(obj, path, fallback=null){
  try{
    const parts = path.split(".");
    let cur = obj;
    for(const k of parts) cur = cur?.[k];
    const n = Number(cur);
    return Number.isFinite(n) ? n : fallback;
  }catch{ return fallback; }
}

/** ------------------ Risk ------------------ **/
function computeRiskSignals({ mintInfo, supplyUi, topHolders, owners, bestPair }){
  const reasons = [];
  let score = 0;

  const mintAuth = mintInfo?.mintAuthority || null;
  const freezeAuth = mintInfo?.freezeAuthority || null;

  if(mintAuth){ score += 25; reasons.push(`Mint authority SET (${shortAddr(mintAuth)}). Can mint more supply.`); }
  else reasons.push("Mint authority NOT set (good).");

  if(freezeAuth){ score += 20; reasons.push(`Freeze authority SET (${shortAddr(freezeAuth)}). Can freeze holders.`); }
  else reasons.push("Freeze authority NOT set (good).");

  const liqUsd = Number(bestPair?.liquidity?.usd || 0);
  if(!bestPair){
    score += 30;
    reasons.push("No Dex pair found (unknown liquidity/price).");
  }else{
    if(liqUsd < 10000){ score += 20; reasons.push(`Very low liquidity ($${fmtInt(liqUsd)}).`); }
    else if(liqUsd < 50000){ score += 10; reasons.push(`Low liquidity ($${fmtInt(liqUsd)}).`); }
    else reasons.push(`Liquidity ok ($${fmtInt(liqUsd)}).`);
  }

  if(supplyUi && supplyUi > 0 && topHolders?.length){
    const topUi = topHolders.map(x => Number(x.uiAmount || 0));
    const top1 = (topUi[0] || 0) / supplyUi * 100;
    const top5 = topUi.slice(0,5).reduce((a,b)=>a+b,0) / supplyUi * 100;
    const top20 = topUi.slice(0,20).reduce((a,b)=>a+b,0) / supplyUi * 100;

    if(top1 > 20){ score += 20; reasons.push(`Top1 concentration ${top1.toFixed(2)}% (high).`); }
    else if(top1 > 10){ score += 10; reasons.push(`Top1 concentration ${top1.toFixed(2)}% (medium).`); }
    else reasons.push(`Top1 concentration ${top1.toFixed(2)}% (good).`);

    if(top5 > 50){ score += 15; reasons.push(`Top5 concentration ${top5.toFixed(2)}% (high).`); }
    else if(top5 > 35){ score += 8; reasons.push(`Top5 concentration ${top5.toFixed(2)}% (medium).`); }

    if(top20 > 80){ score += 10; reasons.push(`Top20 concentration ${top20.toFixed(2)}% (very high).`); }
  }else{
    score += 10;
    reasons.push("Concentration unknown (RPC limits).");
  }

  if(Array.isArray(owners) && owners.length){
    const counts = new Map();
    for(const o of owners){ if(!o) continue; counts.set(o,(counts.get(o)||0)+1); }
    const clustered = Array.from(counts.entries()).filter(([,c])=>c>=2).sort((a,b)=>b[1]-a[1]);
    if(clustered.length){
      score += clamp(clustered[0][1] * 4, 4, 16);
      reasons.push(`Cluster detected: ${shortAddr(clustered[0][0])} appears ${clustered[0][1]}x in Top20.`);
    }else{
      reasons.push("No obvious Top20 owner clusters (good).");
    }
  }

  const level = score >= 60 ? "HIGH" : (score >= 35 ? "MEDIUM" : "LOW");
  return { score: clamp(score,0,100), level, reasons };
}

/** ------------------ Render ------------------ **/
function renderHoldersList({ largest, owners, supplyUi }){
  const el = $("holdersList");
  if(!el) return;

  if(!largest?.length){
    el.innerHTML = `<div style="padding:12px 14px; opacity:.8">—</div>`;
    return;
  }

  el.innerHTML = largest.slice(0,20).map((x,i)=>{
    const ta = x.address;
    const ui = Number(x.uiAmount || 0);
    const pct = (supplyUi && supplyUi > 0) ? (ui / supplyUi * 100) : null;
    const owner = owners?.[i] || null;

    const taLink = ta ? `https://solscan.io/account/${ta}` : "#";
    const owLink = owner ? `https://solscan.io/account/${owner}` : "#";

    return `
      <div class="tr">
        <div class="cellMain">#${i+1}</div>
        <div>
          <div class="cellMain">${fmtInt(ui)} <span style="opacity:.7">${pct===null ? "" : `(${pct.toFixed(2)}%)`}</span></div>
          <div class="cellSub mono">
            TA: <a class="link" href="${taLink}" target="_blank" rel="noreferrer">${shortAddr(ta)}</a>
            ${owner ? ` • Owner: <a class="link" href="${owLink}" target="_blank" rel="noreferrer">${shortAddr(owner)}</a>` : ""}
          </div>
        </div>
        <div class="col3">—</div>
      </div>
    `;
  }).join("");
}

function renderClusters(owners){
  const el = $("clustersList");
  if(!el) return;

  if(!owners?.length){
    el.innerHTML = `<div style="opacity:.8">—</div>`;
    return;
  }

  const counts = new Map();
  for(const o of owners){ if(!o) continue; counts.set(o,(counts.get(o)||0)+1); }
  const list = Array.from(counts.entries()).filter(([,c])=>c>=2).sort((a,b)=>b[1]-a[1]).slice(0,8);

  if(!list.length){
    el.innerHTML = `<div style="opacity:.8">No clusters found in Top 20.</div>`;
    return;
  }

  el.innerHTML = list.map(([o,c])=>{
    const u = `https://solscan.io/account/${o}`;
    return `<div style="margin:8px 0;">
      <span class="badge warn">Cluster x${c}</span>
      <a class="link mono" href="${u}" target="_blank" rel="noreferrer" style="margin-left:10px;">${o}</a>
    </div>`;
  }).join("");
}

/** ------------------ main scan ------------------ **/
async function scanMint(mint){
  setStatus("Scanning token…");
  setRiskBadge("MEDIUM");
  setText("riskReason","—");
  setText("tokenName","—");
  setText("tokenSymbol","—");
  setText("kPrice","—");
  setText("kLiq","—");
  setText("kMc","—");
  setText("kFdv","—");
  setText("kSupply","—");
  setText("kDec","—");
  setText("kAuthorities","—");
  setHTML("holdersList","");
  setHTML("clustersList","");
  setLogo(null);

  const reasonsEl = $("riskReasons");
  if(reasonsEl) reasonsEl.innerHTML = "—";

  const mintShort = $("mintShort");
  if(mintShort) mintShort.textContent = mint ? shortAddr(mint) : "—";

  if(!looksBase58(mint)){
    setStatus("Invalid mint address.");
    setRiskBadge("HIGH");
    setText("riskReason","Invalid input");
    return;
  }

  // 1) Market first (independent)
  let bestPair = null;
  try{
    const pairs = await getDexPairs(mint);
    bestPair = pairs?.[0] || null;
    if(bestPair){
      const meta = pickTokenMetaFromDex(bestPair, mint);
      setText("tokenName", meta.name || "—");
      setText("tokenSymbol", meta.symbol || "—");
      setLogo(meta.logo || null);

      const priceUsd = safeNum(bestPair,"priceUsd",null);
      const liqUsd = safeNum(bestPair,"liquidity.usd",null);
      const mc = safeNum(bestPair,"marketCap",null);
      const fdv = safeNum(bestPair,"fdv",null);

      setText("kPrice", priceUsd!==null ? `$${fmtNum(priceUsd, 8)}` : "—");
      setText("kLiq", liqUsd!==null ? `$${fmtInt(liqUsd)}` : "—");
      setText("kMc", mc!==null ? `$${fmtInt(mc)}` : "—");
      setText("kFdv", fdv!==null ? `$${fmtInt(fdv)}` : "—");
    }
  }catch(e){
    // Market failing shouldn't kill scan
    console.warn("Dex error:", e);
  }

  // 2) On-chain (with failover). If it fails, we still show market + a warning.
  try{
    const [mintParsed, supply, largest] = await Promise.all([
      getMintParsed(mint),
      getTokenSupply(mint).catch(()=>null),
      getTokenLargestAccounts(mint).catch(()=>[])
    ]);

    const decimals = supply ? Number(supply.decimals||0) : (mintParsed ? Number(mintParsed.decimals||0) : null);
    const supplyUi = supply ? Number(supply.uiAmount||0) : null;

    setText("kDec", decimals!==null ? String(decimals) : "—");
    setText("kSupply", supplyUi!==null ? fmtInt(supplyUi) : "—");

    const mintAuth = mintParsed?.mintAuthority || null;
    const freezeAuth = mintParsed?.freezeAuthority || null;
    setText("kAuthorities", `Mint: ${mintAuth ? shortAddr(mintAuth) : "NONE"} • Freeze: ${freezeAuth ? shortAddr(freezeAuth) : "NONE"}`);

    const top20 = (largest || []).slice(0,20);

    // fetch owners best-effort (parallel, but safe)
    const ownerPromises = top20.map(it =>
      getTokenAccountOwner(it.address).catch(()=>null)
    );
    const owners = await Promise.all(ownerPromises);

    renderHoldersList({ largest: top20, owners, supplyUi });
    renderClusters(owners);

    const risk = computeRiskSignals({
      mintInfo: mintParsed,
      supplyUi,
      topHolders: top20,
      owners,
      bestPair
    });

    setRiskBadge(risk.level);
    setText("riskReason", `Score ${risk.score}/100`);
    if(reasonsEl){
      reasonsEl.innerHTML = risk.reasons.map(r => `<div style="margin:6px 0; opacity:.9">• ${r}</div>`).join("");
    }

    setStatus(`Scan complete • ${risk.level} RISK`);

  }catch(e){
    console.error(e);
    // still show something useful
    setRiskBadge("HIGH");
    setText("riskReason", "On-chain unavailable");
    if(reasonsEl){
      reasonsEl.innerHTML = `<div style="margin:6px 0; opacity:.9">• RPC temporarily unavailable. Try again in 10 seconds.</div>`;
    }
    setStatus("Scan partial: RPC temporarily unavailable (try again).");
  }
}

/** ------------------ wire UI ------------------ **/
function getMintInputValue(){
  const a = $("mint");
  const b = $("wallet");
  return (a?.value || b?.value || "").trim();
}

function bind(){
  const btn = $("btnScan");
  if(btn) btn.addEventListener("click", ()=>scanMint(getMintInputValue()));
  const a = $("mint"), b = $("wallet");
  [a,b].forEach(inp=>{
    if(!inp) return;
    inp.addEventListener("keydown",(e)=>{
      if(e.key==="Enter") scanMint(getMintInputValue());
    });
  });
}

bind();
window.scanMint = scanMint;
