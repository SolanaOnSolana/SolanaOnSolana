const API = "https://fancy-sky-11bc.simon-kaggwa-why.workers.dev";

const scanBtn = document.querySelector(".scan-btn");
const input = document.querySelector("input");
const status = document.querySelector(".status");
const trendingBox = document.querySelector(".trending");

async function scanToken() {
  const mint = input.value.trim();
  if (!mint) return;

  status.textContent = "Scanning on-chain…";

  try {
    const res = await fetch(`${API}/scan?mint=${mint}`);
    const data = await res.json();

    status.innerHTML = `
      Risk Level: <b>${data.risk}</b><br/>
      Name: ${data.name}<br/>
      Symbol: ${data.symbol}
    `;
  } catch (e) {
    status.textContent = "Scan failed";
  }
}

async function loadTrending() {
  try {
    const res = await fetch(`${API}/trending`);
    const data = await res.json();

    if (!data.items.length) {
      trendingBox.innerHTML = "<i>No trending tokens yet</i>";
      return;
    }

    trendingBox.innerHTML = data.items
      .map(t => `<div class="trend">${t.mint}</div>`)
      .join("");
  } catch {
    trendingBox.innerHTML = "<i>Trending unavailable</i>";
  }
}

scanBtn.addEventListener("click", scanToken);
loadTrending();
