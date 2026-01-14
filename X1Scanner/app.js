// === CONFIG ===
const API = "https://fancy-sky-11bc.simon-kaggwa-why.workers.dev";

// === ELEMENTS ===
const mintInput = document.getElementById("mintInput");
const scanBtn = document.getElementById("scanBtn");
const statusEl = document.getElementById("scanStatus");
const resultBox = document.getElementById("result");
const resultContent = document.getElementById("resultContent");
const trendingBox = document.getElementById("trending");
document.getElementById("y").textContent = new Date().getFullYear();

// === HELPERS ===
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (m) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[m]));
}

function short(addr) {
  const s = String(addr || "");
  if (s.length <= 12) return s;
  return `${s.slice(0, 6)}…${s.slice(-6)}`;
}

function riskBadge(risk) {
  const r = (risk || "HIGH").toUpperCase();
  const cls = r === "LOW" ? "low" : r === "MEDIUM" ? "med" : "high";
  return `<span class="badge ${cls}">${esc(r)}</span>`;
}

async function safeFetchJson(url) {
  const res = await fetch(url);
  let data = null;
  try { data = await res.json(); } catch (_) {}
  if (!res.ok) {
    const msg = data?.error || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data;
}

// === TRENDING ===
async function loadTrending() {
  trendingBox.innerHTML = `<div class="mutedSmall">Loading trending…</div>`;
  try {
    const data = await safeFetchJson(`${API}/trending`);
    if (!data?.items?.length) {
      trendingBox.innerHTML = `<div class="mutedSmall">No trending tokens yet</div>`;
      return;
    }

    trendingBox.innerHTML = data.items.map(t => `
      <button class="tokenCard tokenBtn" data-mint="${esc(t.mint)}">
        <div class="tokenTop">
          <div class="tokenTitle">
            <div class="tokenName">${esc(t.name || "Unknown")}</div>
            <div class="tokenSub">${esc(t.symbol || "?")} • ${short(t.mint)}</div>
          </div>
          ${riskBadge(t.risk)}
        </div>
        <div class="tokenMeta">
          <div><span>Supply</span><b>${t.supplyUi ?? "—"}</b></div>
          <div><span>Decimals</span><b>${t.decimals ?? "—"}</b></div>
        </div>
      </button>
    `).join("");

    // click-to-scan
    document.querySelectorAll(".tokenBtn").forEach(btn => {
      btn.addEventListener("click", () => {
        mintInput.value = btn.dataset.mint;
        scanBtn.click();
        window.scrollTo({ top: 0, behavior: "smooth" });
      });
    });

  } catch (e) {
    trendingBox.innerHTML = `<div class="mutedSmall">Trending error: ${esc(e.message)}</div>`;
  }
}

// === SCAN ===
async function runScan() {
  const mint = mintInput.value.trim();
  if (!mint) {
    statusEl.textContent = "Paste a token mint address.";
    return;
  }

  statusEl.textContent = "Scanning on-chain…";
  resultBox.classList.add("hidden");
  resultContent.innerHTML = "";

  try {
    const data = await safeFetchJson(`${API}/scan?mint=${encodeURIComponent(mint)}`);

    statusEl.textContent = "Scan complete.";
    resultBox.classList.remove("hidden");

    const holders = (data.topHolders || []).slice(0, 6);

    resultContent.innerHTML = `
      <div class="report">
        <div class="reportHead">
          <div>
            <div class="rTitle">${esc(data.name || "Unknown")} <span class="sym">(${esc(data.symbol || "?")})</span></div>
            <div class="rSub">Mint: <code>${esc(data.mint)}</code></div>
          </div>
          <div class="rRight">
            ${riskBadge(data.risk)}
          </div>
        </div>

        <div class="reportGrid">
          <div class="kpi">
            <span>Supply</span>
            <b>${data.supply?.ui ?? "—"}</b>
          </div>
          <div class="kpi">
            <span>Decimals</span>
            <b>${data.decimals ?? "—"}</b>
          </div>
          <div class="kpi">
            <span>Top holders (shown)</span>
            <b>${holders.length}</b>
          </div>
        </div>

        <div class="sectionTitle">Top Holders</div>
        <div class="holders">
          ${holders.length ? holders.map(h => `
            <div class="holderRow">
              <div class="holderAddr">${esc(short(h.address))}</div>
              <div class="holderAmt">${h.uiAmount ?? "—"}</div>
            </div>
          `).join("") : `<div class="mutedSmall">No holder data available.</div>`}
        </div>

        <div class="note">
          This is the “fast engine” version. Next step is adding your real Guardian logic:
          clusters, snipers, authority checks, liquidity, mint/freeze authority, etc.
        </div>
      </div>
    `;

  } catch (e) {
    statusEl.textContent = "";
    resultBox.classList.remove("hidden");
    resultContent.innerHTML = `<div class="errorBox">Scan error: ${esc(e.message)}</div>`;
  }
}

scanBtn.addEventListener("click", runScan);
mintInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") runScan();
});

// boot
loadTrending();
