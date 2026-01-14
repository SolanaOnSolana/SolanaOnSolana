// X1Scanner Frontend
// Uses Cloudflare Worker API

const API = "https://fancy-sky-11bc.simon-kaggwa-why.workers.dev";

const mintInput = document.getElementById("mintInput");
const scanBtn = document.getElementById("scanBtn");
const statusEl = document.getElementById("scanStatus");

const resultBox = document.getElementById("result");
const resultContent = document.getElementById("resultContent");

const trendingDexBox = document.getElementById("trendingDex");
const trendingPumpBox = document.getElementById("trendingPump");

document.getElementById("y").textContent = new Date().getFullYear();

function esc(s) {
  return String(s || "").replace(/[&<>"']/g, (m) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[m]));
}

function shortAddr(a) {
  if (!a) return "";
  if (a.length < 14) return a;
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

function fmtNum(n) {
  if (n === null || n === undefined || n === "") return "—";
  const x = Number(n);
  if (!Number.isFinite(x)) return "—";
  return x.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function riskClass(risk) {
  const r = String(risk || "").toUpperCase();
  if (r === "LOW") return "low";
  if (r === "HIGH") return "high";
  return "med";
}

function badge(risk) {
  const r = String(risk || "MED").toUpperCase();
  return `<span class="badge ${riskClass(r)}">${esc(r)}</span>`;
}

function tokenCard(t, onClick) {
  const name = t?.name || "Unknown";
  const sym = t?.symbol || "?";
  const mint = t?.mint || "";
  const logo = t?.logo ? `<img class="tokenLogo" src="${esc(t.logo)}" alt="" onerror="this.style.display='none'">` : `<div class="tokenLogo ph"></div>`;

  return `
    <button class="tokenBtn tokenCard" ${onClick ? `data-mint="${esc(mint)}"` : ""}>
      <div class="tokenTop">
        <div class="tokenLeft">
          ${logo}
          <div>
            <div class="tokenName">${esc(name)}</div>
            <div class="tokenSub">${esc(sym)} • <span class="mono">${esc(shortAddr(mint))}</span></div>
          </div>
        </div>
        ${badge(t?.risk)}
      </div>
      <div class="tokenFoot mutedSmall">
        ${t?.source === "pumpfun" ? "Pump.fun trending" : "DexScreener trending"}
      </div>
    </button>
  `;
}

function renderScan(data) {
  const name = data?.name || "Unknown";
  const sym = data?.symbol || "?";
  const mint = data?.mint || "";
  const logo = data?.logo ? `<img class="reportLogo" src="${esc(data.logo)}" alt="" onerror="this.style.display='none'">` : "";

  const price = data?.priceUsd ? `$${fmtNum(data.priceUsd)}` : "—";
  const liq = data?.liquidityUsd ? `$${fmtNum(data.liquidityUsd)}` : "—";
  const vol = data?.volume24h ? `$${fmtNum(data.volume24h)}` : "—";
  const fdv = data?.fdv ? `$${fmtNum(data.fdv)}` : "—";

  const bestPair = data?.bestPair
    ? `<a class="link" href="${esc(data.bestPair)}" target="_blank" rel="noreferrer">View best pair</a>`
    : "";

  resultContent.innerHTML = `
    <div class="report">
      <div class="reportHead">
        <div class="reportLeft">
          <div class="rTitle">${logo} ${esc(name)} <span class="sym">(${esc(sym)})</span></div>
          <div class="rSub">CA: <code class="mono">${esc(mint)}</code></div>
          <div class="rLinks">${bestPair}</div>
        </div>
        ${badge(data?.risk)}
      </div>

      <div class="reportGrid">
        <div class="kpi"><span>Price</span><b>${esc(price)}</b></div>
        <div class="kpi"><span>Liquidity</span><b>${esc(liq)}</b></div>
        <div class="kpi"><span>Volume (24h)</span><b>${esc(vol)}</b></div>
        <div class="kpi"><span>FDV</span><b>${esc(fdv)}</b></div>
      </div>

      <div class="note">${esc(data?.note || "")}</div>
    </div>
  `;
  resultBox.classList.remove("hidden");
}

async function loadTrending() {
  // DEX
  trendingDexBox.innerHTML = `<div class="mutedSmall">Loading DexScreener trending…</div>`;
  try {
    const r = await fetch(`${API}/trending/dex`);
    const j = await r.json();
    const items = Array.isArray(j?.items) ? j.items : [];
    if (!items.length) {
      trendingDexBox.innerHTML = `<div class="mutedSmall">No DexScreener trending available.</div>`;
    } else {
      trendingDexBox.innerHTML = items.map((t) => tokenCard(t, true)).join("");
    }
  } catch (e) {
    trendingDexBox.innerHTML = `<div class="errorBox">Dex trending failed.</div>`;
  }

  // PUMP
  trendingPumpBox.innerHTML = `<div class="mutedSmall">Loading Pump.fun trending…</div>`;
  try {
    const r = await fetch(`${API}/trending/pump`);
    const j = await r.json();
    if (!j?.ok) {
      trendingPumpBox.innerHTML = `<div class="mutedSmall">Pump.fun trending not available right now.</div>`;
    } else {
      const items = Array.isArray(j?.items) ? j.items : [];
      trendingPumpBox.innerHTML = items.length
        ? items.map((t) => tokenCard(t, true)).join("")
        : `<div class="mutedSmall">No Pump.fun trending available.</div>`;
    }
  } catch (e) {
    trendingPumpBox.innerHTML = `<div class="mutedSmall">Pump.fun trending not available right now.</div>`;
  }

  // click-to-scan on cards
  document.querySelectorAll(".tokenBtn[data-mint]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const m = btn.getAttribute("data-mint");
      if (m) {
        mintInput.value = m;
        doScan();
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
    });
  });
}

async function doScan() {
  const mint = (mintInput.value || "").trim();
  if (!mint) {
    statusEl.textContent = "Paste a token mint address.";
    return;
  }

  statusEl.textContent = "Scanning…";
  resultBox.classList.add("hidden");

  try {
    const r = await fetch(`${API}/scan?mint=${encodeURIComponent(mint)}`);
    const j = await r.json();

    if (!j?.ok) {
      statusEl.textContent = `Scan failed: ${j?.error || "Unknown error"}`;
      resultContent.innerHTML = `<div class="errorBox">${esc(j?.detail || "No details")}</div>`;
      resultBox.classList.remove("hidden");
      return;
    }

    statusEl.textContent = "Scan complete.";
    renderScan(j);
  } catch (e) {
    statusEl.textContent = "Scan failed: Network error";
    resultContent.innerHTML = `<div class="errorBox">Network error</div>`;
    resultBox.classList.remove("hidden");
  }
}

scanBtn.addEventListener("click", doScan);
mintInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") doScan();
});

loadTrending();
