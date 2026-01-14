// ==============================
// CONFIG
// ==============================
const API = "https://fancy-sky-11bc.simon-kaggwa-why.workers.dev";

// ==============================
// HELPERS
// ==============================
const $ = (id) => document.getElementById(id);

// ==============================
// SCAN BUTTON
// ==============================
$("scanBtn").addEventListener("click", async () => {
  const mint = $("mintInput").value.trim();
  if (!mint) {
    $("scanStatus").textContent = "Paste a token mint address.";
    return;
  }

  $("scanStatus").textContent = "Scanning on-chain…";
  $("result").classList.add("hidden");

  try {
    const res = await fetch(`${API}/scan?mint=${mint}`);
    const data = await res.json();

    $("scanStatus").textContent = "Scan complete.";
    $("result").classList.remove("hidden");

    $("resultContent").innerHTML = `
      <pre>${JSON.stringify(data, null, 2)}</pre>
    `;
  } catch (err) {
    $("scanStatus").textContent = "Scan failed.";
  }
});

// ==============================
// TRENDING TOKENS
// ==============================
async function loadTrending() {
  try {
    const res = await fetch(`${API}/trending`);
    const data = await res.json();

    const box = $("trending");
    box.innerHTML = "";

    if (!data.items || data.items.length === 0) {
      box.innerHTML = "<div class='tokenCard'>No trending tokens yet</div>";
      return;
    }

    data.items.forEach((t) => {
      const el = document.createElement("div");
      el.className = "tokenCard";
      el.innerHTML = `
        <strong>${t.name || "Unknown"}</strong><br/>
        <code>${t.mint}</code><br/>
        <small>Source: ${t.source}</small>
      `;
      el.onclick = () => {
        $("mintInput").value = t.mint;
        window.scrollTo({ top: 0, behavior: "smooth" });
      };
      box.appendChild(el);
    });
  } catch (e) {
    $("trending").innerHTML =
      "<div class='tokenCard'>Failed to load trending tokens</div>";
  }
}

// ==============================
// INIT
// ==============================
loadTrending();
$("y").textContent = new Date().getFullYear();
