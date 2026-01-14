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

// === SCAN ===
scanBtn.onclick = async () => {
  const mint = mintInput.value.trim();
  if (!mint) {
    statusEl.textContent = "Paste a token mint address.";
    return;
  }

  statusEl.textContent = "Scanning on-chain...";
  resultBox.classList.add("hidden");

  try {
    const res = await fetch(`${API}/scan?mint=${mint}`);
    const data = await res.json();

    statusEl.textContent = "";
    resultBox.classList.remove("hidden");

    resultContent.innerHTML = `
      <div class="tokenCard">
        <b>Mint</b><br>${data.mint}<br><br>
        <b>Name</b><br>${data.name}<br><br>
        <b>Symbol</b><br>${data.symbol}<br><br>
        <b>Risk</b><br><span style="color:red">${data.risk}</span>
      </div>
    `;
  } catch (e) {
    statusEl.textContent = "Scan failed.";
  }
};

// === TRENDING ===
async function loadTrending() {
  try {
    const res = await fetch(`${API}/trending`);
    const data = await res.json();

    if (!data.items || data.items.length === 0) {
      trendingBox.innerHTML = "<i>No trending tokens yet</i>";
      return;
    }

    trendingBox.innerHTML = data.items.map(t => `
      <div class="tokenCard">
        <b>${t.mint}</b><br>
        <small>${t.source}</small>
      </div>
    `).join("");
  } catch {
    trendingBox.innerHTML = "<i>Failed to load trending</i>";
  }
}

loadTrending();
