const API = "https://fancy-sky-11bc.simon-kaggwa-why.workers.dev";

// Elements
const scanBtn = document.querySelector(".btn");
const input = document.querySelector("input");
const statusEl = document.getElementById("scanStatus");
const trendingEl = document.getElementById("trending");
const resultBox = document.getElementById("result");
const resultContent = document.getElementById("resultContent");

// Scan token
async function scanToken() {
  const mint = input.value.trim();
  if (!mint) return;

  statusEl.textContent = "Scanning on-chain…";
  resultBox.classList.add("hidden");

  try {
    const res = await fetch(`${API}/scan?mint=${mint}`);
    const data = await res.json();

    resultContent.innerHTML = `
      <p><b>Risk:</b> ${data.risk}</p>
      <p><b>Name:</b> ${data.name}</p>
      <p><b>Symbol:</b> ${data.symbol}</p>
      <p><b>Mint:</b> ${data.mint}</p>
    `;

    statusEl.textContent = "Scan complete.";
    resultBox.classList.remove("hidden");
  } catch (e) {
    statusEl.textContent = "Scan failed.";
  }
}

// Load trending
async function loadTrending() {
  try {
    const res = await fetch(`${API}/trending`);
    const data = await res.json();

    if (!data.items.length) {
      trendingEl.innerHTML = "<i>No trending tokens yet</i>";
      return;
    }

    trendingEl.innerHTML = data.items
      .map(
        t => `<div class="trend" onclick="scanFromTrending('${t.mint}')">
                ${t.mint}
              </div>`
      )
      .join("");
  } catch {
    trendingEl.innerHTML = "<i>Trending unavailable</i>";
  }
}

window.scanFromTrending = (mint) => {
  input.value = mint;
  scanToken();
};

// Events
scanBtn.addEventListener("click", scanToken);
loadTrending();
