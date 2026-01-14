// ===============================
// X1 Scanner — Frontend Logic v2
// ===============================

// 1) SET THIS to your Cloudflare Worker base URL (NO trailing slash)
const API = "https://fancy-sky-11bc.simon-kaggwa-why.workers.dev";

// 2) Token metadata source (logos, names, symbols)
const JUP_TOKENLIST = "https://token.jup.ag/all";

// ---------- Elements ----------
const mintInput = document.getElementById("mintInput");
const scanBtn = document.getElementById("scanBtn");
const statusEl = document.getElementById("scanStatus");
const resultBox = document.getElementById("result");
const resultContent = document.getElementById("resultContent");
const trendingBox = document.getElementById("trending");
document.getElementById("y").textContent = new Date().getFullYear();

// ---------- Small helpers ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function shortMint(m) {
  if (!m || m.length < 12) return m || "";
  return `${m.slice(0, 4)}…${m.slice(-4)}`;
}

function riskLevel(risk) {
  const r = String(risk || "").toLowerCase().trim();
  if (r === "low") return "low";
  if (r === "medium" || r === "med") return "med";
  return "high"; // default
}

function badgeHTML(risk) {
  const lvl = riskLevel(risk);
  const label = (lvl === "med") ? "MED" : lvl.toUpperCase();
  return `<span class="badge ${lvl}">${label}</span>`;
}

function logoHTML(url, alt) {
  // Safe-ish image element with fallback to simple circle if broken
  const safe = url ? String(url) : "";
  const a = alt ? String(alt) : "token";
  return `
    <div style="
      width:38px;height:38px;border-radius:12px;
      border:1px solid rgba(255,255,255,.12);
      background:rgba(255,255,255,.06);
      overflow:hidden;display:flex;align-items:center;justify-content:center;
      flex:0 0 auto;">
      ${safe ? `<img src="${safe}" alt="${a}" style="width:100%;height:100%;object-fit:cover" onerror="this.style.display='none'; this.parentNode.textContent='•'">` : "•"}
    </div>
  `;
}

function setStatus(msg, isError = false) {
  statusEl.textContent = msg || "";
  statusEl.style.color = isError ? "#ffd9e0" : "";
}

function showResult() {
  resultBox.classList.remove("hidden");
  // scroll a bit so user sees it
  resultBox.scrollIntoView({ behavior: "smooth", block: "start" });
}

function hideResult() {
  resultBox.classList.add("hidden");
  resultContent.innerHTML = "";
}

// ---------- Tokenlist cache ----------
let tokenMapPromise = null;

async function getTokenMap() {
  if (!tokenMapPromise) {
    tokenMapPromise = (async () => {
      try {
        const res = await fetch(JUP_TOKENLIST, { cache: "force-cache" });
        const list = await res.json();
        const map = new Map();
        for (const t of list || []) {
          if (t && t.address) map.set(t.address, t);
        }
        return map;
      } catch (e) {
        // If Jupiter list fails, we still function using Worker fields
        return new Map();
      }
    })();
  }
  return tokenMapPromise;
}

async function enrichToken(base) {
  // base from worker: {mint,name,symbol,decimals,supply,risk,...}
  const mint = base?.mint;
  if (!mint) return base;

  const map = await getTokenMap();
  const meta = map.get(mint);

  const name = (base?.name && base.name !== "Unknown") ? base.name : (meta?.name || base?.name || "Unknown");
  const symbol = (base?.symbol && base.symbol !== "?") ? base.symbol : (meta?.symbol || base?.symbol || "?");
  const logoURI = meta?.logoURI || meta?.logo || meta?.icon || null;

  return { ...base, name, symbol, logoURI };
}

// ---------- API calls ----------
async function apiGET(path) {
  const url = `${API}${path}`;
  const res = await fetch(url, { headers: { "accept": "application/json" } });
  let data = null;
  try { data = await res.json(); } catch (e) {}
  if (!res.ok) {
    const msg = data?.error || `Request failed (${res.status})`;
    throw new Error(msg);
  }
  return data;
}

async function loadTrending() {
  trendingBox.innerHTML = `<div class="mutedSmall">Loading trending…</div>`;

  try {
    const data = await apiGET(`/trending`);
    // expected: {ok,count,items:[{mint,...}]} OR array
    const items = Array.isArray(data) ? data : (data?.items || []);
    if (!items.length) {
      trendingBox.innerHTML = `<div class="mutedSmall">No trending tokens yet</div>`;
      return;
    }

    // enrich each mint with name/symbol/logo
    const enriched = [];
    for (const it of items.slice(0, 12)) {
      const mint = it?.mint || it?.address || it?.token || it;
      if (!mint || typeof mint !== "string") continue;
      const fake = { mint, name: "Unknown", symbol: "?", risk: it?.risk || "LOW" };
      enriched.push(await enrichToken(fake));
      // tiny yield so Safari doesn't freeze
      await sleep(5);
    }

    trendingBox.innerHTML = enriched.map((t) => {
      const name = t.name || "Unknown";
      const symbol = t.symbol || "?";
      const mintShort = shortMint(t.mint);
      const risk = t.risk || "LOW";
      return `
        <button class="tokenCard tokenBtn" data-mint="${t.mint}">
          <div class="tokenTop">
            <div style="display:flex;gap:12px;align-items:center;min-width:0;">
              ${logoHTML(t.logoURI, symbol)}
              <div style="min-width:0;">
                <div class="tokenName" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${name}</div>
                <div class="tokenSub">${symbol} • ${mintShort}</div>
              </div>
            </div>
            ${badgeHTML(risk)}
          </div>
        </button>
      `;
    }).join("");

    // click handlers
    trendingBox.querySelectorAll("[data-mint]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const m = btn.getAttribute("data-mint");
        mintInput.value = m;
        runScan(m);
      });
    });

  } catch (e) {
    trendingBox.innerHTML = `<div class="errorBox">Failed to load trending: ${e.message}</div>`;
  }
}

async function runScan(mint) {
  const m = String(mint || "").trim();
  if (!m) {
    setStatus("Paste a token mint address.", true);
    return;
  }

  setStatus("Scanning…");
  hideResult();

  try {
    const data = await apiGET(`/scan?mint=${encodeURIComponent(m)}`);
    const tok = await enrichToken(data);

    const name = tok.name || "Unknown";
    const symbol = tok.symbol || "?";
    const risk = tok.risk || "HIGH";

    // Minimal report like you asked: logo + name + ticker + CA + risk
    resultContent.innerHTML = `
      <div class="report">
        <div class="reportHead">
          <div style="display:flex;gap:14px;align-items:center;min-width:0;">
            ${logoHTML(tok.logoURI, symbol)}
            <div style="min-width:0;">
              <div class="rTitle">
                ${name} <span class="sym">(${symbol})</span>
              </div>
              <div class="rSub">
                Mint: <code>${tok.mint}</code>
              </div>
            </div>
          </div>
          ${badgeHTML(risk)}
        </div>

        <div class="note" style="margin-top:14px;">
          <div style="font-weight:950;margin-bottom:6px;">Next step (Scanner “real”):</div>
          <div style="line-height:1.5">
            Liquidity / LP lock • Mint & Freeze authority • Holder concentration • Snipers & bundles • Cluster detection • Rug signals.
          </div>
        </div>

        <details style="margin-top:12px;opacity:.95">
          <summary style="cursor:pointer;font-weight:900;color:rgba(255,255,255,.75)">Debug: raw data</summary>
          <pre style="white-space:pre-wrap;word-break:break-word;margin:10px 0 0;padding:12px;border-radius:14px;background:rgba(0,0,0,.22);border:1px solid rgba(255,255,255,.10)">${escapeHTML(JSON.stringify(tok, null, 2))}</pre>
        </details>
      </div>
    `;

    setStatus("Scan complete.");
    showResult();
  } catch (e) {
    setStatus(`Scan failed: ${e.message}`, true);
    resultContent.innerHTML = `<div class="errorBox">Scan failed: ${escapeHTML(e.message)}</div>`;
    resultBox.classList.remove("hidden");
  }
}

function escapeHTML(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

// ---------- Events ----------
scanBtn.addEventListener("click", () => runScan(mintInput.value));
mintInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") runScan(mintInput.value);
});

// ---------- Boot ----------
(async function boot() {
  setStatus("");
  hideResult();
  // warm tokenlist in background
  getTokenMap();
  // load trending
  await loadTrending();
})();
