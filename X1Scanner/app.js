// app.js — X1Scanner Frontend (V1)

// ✅ IMPORTANT: your Worker base URL (NO trailing slash)
const API = "https://fancy-sky-11bc.simon-kaggwa-why.workers.dev";

// Elements
const mintInput = document.getElementById("mintInput");
const scanBtn = document.getElementById("scanBtn");
const statusEl = document.getElementById("scanStatus");
const resultBox = document.getElementById("result");
const resultContent = document.getElementById("resultContent");
const trendingBox = document.getElementById("trending");
document.getElementById("y").textContent = new Date().getFullYear();

// Helpers
const short = (s) => (!s || s.length < 10 ? s : `${s.slice(0, 4)}…${s.slice(-4)}`);

function setStatus(msg, kind = "") {
  statusEl.textContent = msg || "";
  statusEl.className = "status" + (kind ? ` ${kind}` : "");
}

function riskClass(label) {
  const x = (label || "").toLowerCase();
  if (x === "low") return "low";
  if (x === "med" || x === "medium") return "med";
  return "high";
}

function fmtPct(n) {
  if (typeof n !== "number" || !isFinite(n)) return "—";
  return `${n.toFixed(2)}%`;
}

function fmtNum(n) {
  if (n == null || !isFinite(n)) return "—";
  // compact-ish without Intl complexity
  const abs = Math.abs(n);
  if (abs >= 1e12) return (n / 1e12).toFixed(2) + "T";
  if (abs >= 1e9) return (n / 1e9).toFixed(2) + "B";
  if (abs >= 1e6) return (n / 1e6).toFixed(2) + "M";
  if (abs >= 1e3) return (n / 1e3).toFixed(2) + "K";
  return String(n);
}

async function fetchJSON(url) {
  const res = await fetch(url, { cache: "no-store" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data?.ok === false) {
    const msg = data?.error || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data;
}

// Trending
async function loadTrending() {
  trendingBox.innerHTML = `<div class="mutedSmall">Loading…</div>`;

  try {
    const data = await fetchJSON(`${API}/trending`);
    const items = data.items || [];

    trendingBox.innerHTML = items
      .map((t) => {
        const logo = t.logo
          ? `<img class="tokenLogo" src="${t.logo}" alt="${t.symbol || ""}"/>`
          : `<div class="tokenLogo tokenLogoFallback">${(t.symbol || "?").slice(0, 1)}</div>`;

        return `
          <button class="tokenCard tokenBtn" data-mint="${t.mint}">
            <div class="tokenTop">
              <div class="tokenLeft">
                ${logo}
                <div>
                  <div class="tokenName">${t.name || "Token"}</div>
                  <div class="tokenSub">${t.symbol || ""}</div>
                </div>
              </div>
              <span class="badge low">TOP</span>
            </div>
            <div class="tokenSub" style="margin-top:10px;">
              ${short(t.mint)}
            </div>
          </button>
        `;
      })
      .join("");

    // click -> auto fill & scan
    trendingBox.querySelectorAll("[data-mint]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const mint = btn.getAttribute("data-mint");
        mintInput.value = mint;
        doScan(mint);
        window.scrollTo({ top: 0, behavior: "smooth" });
      });
    });
  } catch (e) {
    trendingBox.innerHTML = `<div class="errorBox">Failed to load trending: ${String(e.message || e)}</div>`;
  }
}

// Scan
async function doScan(mint) {
  const m = (mint || mintInput.value || "").trim();
  if (!m) return setStatus("Paste a token mint address.");

  setStatus("Scanning on-chain…");
  resultBox.classList.add("hidden");
  resultContent.innerHTML = "";

  try {
    const data = await fetchJSON(`${API}/scan?mint=${encodeURIComponent(m)}`);

    setStatus("");

    const r = data.risk || {};
    const rc = riskClass(r.label);
    const badge = `<span class="badge ${rc}">${r.label || "—"} • ${r.score ?? "—"}</span>`;

    const logo = data.logo
      ? `<img class="reportLogo" src="${data.logo}" alt="${data.symbol || ""}"/>`
      : `<div class="reportLogo reportLogoFallback">${(data.symbol || "?").slice(0, 1)}</div>`;

    const mintRow = `<div class="rSub">Mint: <code>${data.mint}</code></div>`;

    // authorities
    const auth = data.authorities || {};
    const authLines = [
      auth.mintAuthorityEnabled ? "Mint authority enabled" : "Mint authority disabled",
      auth.freezeAuthorityEnabled ? "Freeze authority enabled" : "Freeze authority disabled",
    ];

    // supply
    const supplyUi = data.supply?.ui ? Number(data.supply.ui) : null;

    // top holder
    const holders = data.holders?.top || [];
    const topShare = data.holders?.topHolderShare;

    const holderRows = holders.length
      ? holders.slice(0, 8).map((h, idx) => {
          const amt = h.amount != null ? fmtNum(h.amount) : (h.ui || "—");
          let share = "—";
          if (supplyUi && h.amount != null && supplyUi > 0) {
            share = fmtPct((h.amount / supplyUi) * 100);
          }
          return `
            <div class="holderRow">
              <div class="holderAddr">#${idx + 1} • ${short(h.address)}</div>
              <div class="holderAmt">${amt} <span class="mutedSmall">(${share})</span></div>
            </div>
          `;
        }).join("")
      : `<div class="mutedSmall">No holder data available.</div>`;

    const reasons = (r.reasons || [])
      .map((x) => `<div class="noteItem">• ${x}</div>`)
      .join("");

    resultContent.innerHTML = `
      <div class="report">
        <div class="reportHead">
          <div class="reportLeft">
            ${logo}
            <div>
              <div class="rTitle">${data.name || "Token"} <span class="sym">(${data.symbol || ""})</span></div>
              ${mintRow}
              <div class="mutedSmall" style="margin-top:10px;">${authLines.join(" • ")}</div>
            </div>
          </div>
          ${badge}
        </div>

        <div class="reportGrid">
          <div class="kpi">
            <span>Supply</span>
            <b>${supplyUi != null ? fmtNum(supplyUi) : "—"}</b>
          </div>
          <div class="kpi">
            <span>Decimals</span>
            <b>${data.decimals ?? "—"}</b>
          </div>
          <div class="kpi">
            <span>Top holder share</span>
            <b>${fmtPct(topShare)}</b>
          </div>
        </div>

        <div class="sectionTitle">Top Holders</div>
        <div class="holders">${holderRows}</div>

        <div class="sectionTitle">Risk Notes</div>
        <div class="note">
          ${reasons || `<span class="mutedSmall">No flags triggered.</span>`}
        </div>

        <div class="note mutedSmall">
          This is V1 (fast on-chain checks). Next upgrade = clusters/snipers/LP checks & deeper heuristics.
        </div>
      </div>
    `;

    resultBox.classList.remove("hidden");
  } catch (e) {
    setStatus("");
    resultBox.classList.remove("hidden");
    resultContent.innerHTML = `<div class="errorBox">Scan failed: ${String(e.message || e)}</div>`;
  }
}

// Events
scanBtn.addEventListener("click", () => doScan());
mintInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") doScan();
});

// Init
loadTrending();
