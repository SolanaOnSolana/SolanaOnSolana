const API = "https://fancy-sky-11bc.simon-kaggwa-why.workers.dev";

document.getElementById("y").textContent = new Date().getFullYear();

async function loadTrending() {
  const box = document.getElementById("trending");
  box.textContent = "Loading…";

  try {
    const res = await fetch(API + "/trending");
    const data = await res.json();

    box.innerHTML = "";

    if (!data.items || !data.items.length) {
      box.innerHTML = "<i>No trending tokens yet</i>";
      return;
    }

    data.items.forEach(t => {
      const el = document.createElement("div");
      el.className = "tokenCard";
      el.innerHTML = `
        <strong>${t.source}</strong><br/>
        <small>${(t.signature || "").slice(0, 12)}…</small><br/><br/>
        <button class="btn" onclick="scan('${t.mint || ""}')">Scan</button>
      `;
      box.appendChild(el);
    });
  } catch (e) {
    box.textContent = "Failed to load trending.";
  }
}

function scan(mint) {
  if (!mint) {
    mint = document.getElementById("mintInput").value.trim();
  }
  if (!mint) return;

  document.getElementById("scanStatus").textContent =
    "Guardian engine initializing…";

  document.getElementById("result").classList.add("hidden");

  // Backend scan logic comes next
  setTimeout(() => {
    document.getElementById("scanStatus").textContent =
      "Scan engine coming online…";
  }, 600);
}

document.getElementById("scanBtn").onclick = () => scan();
loadTrending();
