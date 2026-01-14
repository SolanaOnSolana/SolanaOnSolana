// ==============================
// X1 Scanner Frontend Logic
// ==============================

// !!! WICHTIG: DAS IST DEINE CLOUDFLARE WORKER URL !!!
const API = "https://fancy-sky-11bc.simon-kaggwa-why.workers.dev";

// ------------------------------
// Elements
// ------------------------------
const mintInput = document.getElementById("mintInput");
const scanBtn = document.getElementById("scanBtn");
const statusEl = document.getElementById("scanStatus");
const resultBox = document.getElementById("result");
const resultContent = document.getElementById("resultContent");
const trendingBox = document.getElementById("trending");

document.getElementById("y").textContent = new Date().getFullYear();

// ------------------------------
// Helpers
// ------------------------------
function riskClass(risk) {
  if (!risk) return "med";
  const r = risk.toUpperCase();
  if (r === "LOW") return "low";
  if (r === "HIGH") return "high";
  return "med";
}

// ------------------------------
// Load Trending Tokens
// ------------------------------
async function loadTrending() {
  trendingBox.innerHTML = `<div class="mutedSmall">Loading trending tokens…</div>`;

  try {
    const res = await fetch(`${API}/trending`);
    if (!res.ok) throw new Error("HTTP " + res.status);

    const data = await res.json();

    if (!data.items || data.items.length === 0) {
      trendingBox.innerHTML = `<div class="mutedSmall">No trending tokens yet</div>`;
      return;
    }

    trendingBox.innerHTML = "";

    data.items.forEach(t => {
      const div = document.createElement("div");
      div.className = "tokenCard tokenBtn";
      div.innerHTML = `
        <div class="tokenTop">
          <div>
            <div class="tokenName">${t.name || "Unknown"}</div>
            <div class="tokenSub">${t.symbol || "—"}</div>
          </div>
          <span class="badge ${riskClass(t.risk)}">${t.risk || "MED"}</span>
        </div>
        <div class="tokenSub" style="margin-top:10px;word-break:break-all">
          ${t.mint}
        </div>
      `;
      div.onclick = () => {
        mintInput.value = t.mint;
        scanBtn.click();
      };
      trendingBox.appendChild(div);
    });

  } catch (err) {
    trendingBox.innerHTML = `<div class="errorBox">Failed to load trending</div>`;
    console.error("Trending error:", err);
  }
}

// ------------------------------
// Scan Token
// ------------------------------
scanBtn.onclick = async () => {
  const mint = mintInput.value.trim();

  if (!mint) {
    statusEl.textContent = "Paste a token mint address.";
    return;
  }

  statusEl.textContent = "Scanning on-chain…";
  resultBox.classList.add("hidden");

  try {
    const res = await fetch(`${API}/scan?mint=${mint}`);
    if (!res.ok) throw new Error("HTTP " + res.status);

    const data = await res.json();

    statusEl.textContent = "";
    resultBox.classList.remove("hidden");

    const risk = (data.risk || "MED").toUpperCase();

    resultContent.innerHTML = `
      <div class="report">
        <div class="reportHead">
          <div>
            <div class="rTitle">
              ${data.name || "Unknown"}
              <span class="sym">${data.symbol ? "• " + data.symbol : ""}</span>
            </div>
            <div class="rSub">
              Mint: <code>${data.mint || mint}</code>
            </div>
          </div>
          <span class="badge ${riskClass(risk)}">${risk}</span>
        </div>

        <div class="reportGrid">
          <div class="kpi">
            <span>Decimals</span>
            <b>${data.decimals ?? "—"}</b>
          </div>
          <div class="kpi">
            <span>Supply</span>
            <b>${data.supply ?? "—"}</b>
          </div>
          <div class="kpi">
            <span>Top Holder Share</span>
            <b>${data.topHolderShare ?? "—"}</b>
          </div>
        </div>

        <div class="note">
          ${data.note || "Advanced holder, sniper, liquidity and authority analysis coming next."}
        </div>
      </div>
    `;

  } catch (err) {
    statusEl.textContent = "";
    resultBox.classList.remove("hidden");
    resultContent.innerHTML = `
      <div class="errorBox">
        Scan failed. Check token or backend.
      </div>
    `;
    console.error("Scan error:", err);
  }
};

// ------------------------------
// Init
// ------------------------------
loadTrending();
