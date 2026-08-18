// ============================================================
// 45 MINUTES · STATS DASHBOARD (v2)
// Fetches encrypted snapshot from GitHub, decrypts client-side.
// ============================================================

const CONFIG = {
  repoOwner: "Jorchvr",
  repoName: "45minutes_stats",
  dataBranch: "data",
  snapshotFile: "snapshot.json",
  refreshMs: 30_000,
  pbkdf2Iterations: 200_000,
  pbkdf2Salt: "45minutes-stats-v1",
};

const el = (id) => document.getElementById(id);

let cryptoKey = null;
let refreshTimer = null;
let agoTimer = null;
let lastSnapshotAt = null;

// ============ UTIL ============
function b64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
const strToBytes = (s) => new TextEncoder().encode(s);
const bytesToStr = (b) => new TextDecoder().decode(b);

function escapeHTML(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c]);
}

function fmtMoney(n) {
  if (n == null || isNaN(n)) return "$0";
  const abs = Math.abs(Number(n));
  const sign = Number(n) < 0 ? "-" : "";
  return sign + "$" + abs.toLocaleString("es-MX", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}
function fmtUsd(n) {
  if (n == null || isNaN(n)) return "US$0";
  const abs = Math.abs(Number(n));
  const sign = Number(n) < 0 ? "-" : "";
  return sign + "US$" + abs.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtNumber(n) {
  if (n == null || isNaN(n)) return "0";
  return Number(n).toLocaleString("es-MX");
}
function fmtTime(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" });
  } catch { return "—"; }
}
function fmtAgo(iso) {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.max(0, Math.floor(diff / 1000));
  if (s < 60) return s + "s";
  const m = Math.floor(s / 60);
  if (m < 60) return m + "m";
  const h = Math.floor(m / 60);
  if (h < 24) return h + "h";
  return Math.floor(h / 24) + "d";
}
function tagClassForMethod(m) {
  const s = (m || "").toLowerCase();
  if (s.includes("efect")) return "tag-efectivo";
  if (s.includes("tarj")) return "tag-tarjeta";
  if (s.includes("trans")) return "tag-transfer";
  if (s.includes("dol") || s.includes("usd")) return "tag-usd";
  return "";
}
function tagClassForTipo(t) {
  const s = (t || "").toLowerCase();
  if (s.includes("nuevo")) return "tag-nuevo";
  if (s.includes("renov")) return "tag-renovacion";
  if (s.includes("inscr")) return "tag-inscripcion";
  if (s.includes("pos")) return "tag-pos";
  if (s.includes("gasto")) return "tag-gasto";
  return "";
}

// ============ CRYPTO ============
async function deriveKey(password) {
  const passKey = await crypto.subtle.importKey(
    "raw", strToBytes(password), { name: "PBKDF2" }, false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: strToBytes(CONFIG.pbkdf2Salt),
      iterations: CONFIG.pbkdf2Iterations, hash: "SHA-256" },
    passKey,
    { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
}

async function fetchSnapshot() {
  const url = `https://raw.githubusercontent.com/${CONFIG.repoOwner}/`
            + `${CONFIG.repoName}/${CONFIG.dataBranch}/${CONFIG.snapshotFile}`
            + `?t=${Date.now()}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP_${res.status}`);
  return res.json();
}

async function decryptSnapshot(snap, key) {
  const iv = b64ToBytes(snap.iv);
  const ct = b64ToBytes(snap.ct);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
  return JSON.parse(bytesToStr(new Uint8Array(plain)));
}

// ============ RENDER ============
function render(data) {
  // 1. Caja total (acumulado)
  const ct = data.caja_total || {};
  el("cajatotal-pesos").textContent = fmtMoney(ct.pesos);
  el("cajatotal-usd").textContent = fmtUsd(ct.usd);

  // 2. Balance neto del día
  const bn = data.caja_hoy_neto || {};
  el("balance-total").textContent = fmtMoney(bn.total_mxn);
  el("balance-efectivo").textContent = fmtMoney(bn.efectivo);
  el("balance-transfer").textContent = fmtMoney(bn.transferencia);
  el("balance-tarjeta").textContent = fmtMoney(bn.tarjeta);
  el("balance-usd").textContent = fmtUsd(bn.dolares_usd);

  // 3. Personas hoy
  const p = data.personas_hoy || {};
  el("personas-total").textContent = fmtNumber(p.total);
  el("personas-gym").textContent = fmtNumber(p.gym);
  el("personas-spinning").textContent = fmtNumber(p.spinning);
  el("personas-pilates").textContent = fmtNumber(p.pilates);

  // 4. Socios
  const s = data.socios || {};
  el("socios-activos").textContent = fmtNumber(s.activos);
  el("socios-vencen").textContent = fmtNumber(s.vencen_7d);
  el("socios-vencidos").textContent = fmtNumber(s.vencidos);

  // 5. Timeline
  renderTimeline(data.timeline || []);

  // 6. Últimas ventas
  const v = data.ventas || {};
  const parts = [];
  if (v.count) parts.push(`${v.count} tickets`);
  if (v.count_nuevos) parts.push(`${v.count_nuevos} nuevos`);
  if (v.count_renovacion) parts.push(`${v.count_renovacion} renov.`);
  if (v.count_inscripcion) parts.push(`${v.count_inscripcion} insc.`);
  el("ventas-summary").textContent = parts.length ? parts.join(" · ") : "sin ventas hoy";

  const tbody = el("ventas-tbody");
  if (v.ultimas && v.ultimas.length) {
    tbody.innerHTML = v.ultimas.map((row) => {
      const refClass = row.refundada ? "refundada" : "";
      return `
      <tr class="${refClass}">
        <td>${escapeHTML(fmtTime(row.fecha))}</td>
        <td>${escapeHTML(row.usuario || "")}</td>
        <td>${escapeHTML(row.concepto || "")}</td>
        <td><span class="tag ${tagClassForTipo(row.tipo)}">${escapeHTML((row.tipo || "").toUpperCase())}</span></td>
        <td><span class="tag ${tagClassForMethod(row.metodo)}">${escapeHTML((row.metodo || "").toUpperCase())}</span></td>
        <td class="right"><strong>${fmtMoney(row.total)}</strong></td>
      </tr>`;
    }).join("");
  } else {
    tbody.innerHTML = `<tr><td colspan="6" class="muted center">Sin ventas hoy</td></tr>`;
  }

  // 7. Stock bajo
  const stock = data.stock_bajo || [];
  const stbody = el("stock-tbody");
  if (stock.length) {
    stbody.innerHTML = stock.map((p) => {
      const cls = p.stock <= 0 ? "stock-out" : "stock-low";
      return `
        <tr>
          <td>${escapeHTML(p.nombre || "")}</td>
          <td class="right"><span class="${cls}">${fmtNumber(p.stock)}</span></td>
          <td class="right">${fmtMoney(p.precio)}</td>
        </tr>`;
    }).join("");
  } else {
    stbody.innerHTML = `<tr><td colspan="3" class="muted center">Todo el stock OK</td></tr>`;
  }

  lastSnapshotAt = data.generated_at || new Date().toISOString();
  el("snapshot-time").textContent = "SNAPSHOT · " + fmtTime(lastSnapshotAt);
  updateAgo();
}

function renderTimeline(cortes) {
  const tl = el("timeline");
  if (!cortes || !cortes.length) {
    tl.innerHTML = `<div class="timeline-empty">Sin actividad hoy todavía</div>`;
    return;
  }
  tl.innerHTML = cortes.map((c, i) => {
    const esExtremo = c.etiqueta === "APERTURA" || c.etiqueta === "AHORA" || c.etiqueta === "CIERRE";
    const totalDelta = (c.delta_pesos || 0) + (c.delta_usd || 0);
    let deltaCls = "zero", deltaTxt = "—";
    if (i === 0) {
      deltaTxt = c.saldo_pesos || c.saldo_usd ? "INICIO" : "—";
    } else if (totalDelta > 0) {
      deltaCls = "up";
      const parts = [];
      if (c.delta_pesos > 0) parts.push(`+${fmtMoney(c.delta_pesos)}`);
      if (c.delta_usd > 0) parts.push(`+${fmtUsd(c.delta_usd)}`);
      deltaTxt = parts.join(" · ");
    } else if (totalDelta < 0) {
      deltaCls = "down";
      const parts = [];
      if (c.delta_pesos < 0) parts.push(fmtMoney(c.delta_pesos));
      if (c.delta_usd < 0) parts.push(fmtUsd(c.delta_usd));
      deltaTxt = parts.join(" · ");
    }
    return `
      <div class="timeline-item ${esExtremo ? "extremo" : ""}">
        <div class="timeline-label">${escapeHTML(c.etiqueta)}</div>
        <div class="timeline-pesos">${fmtMoney(c.saldo_pesos)}</div>
        <div class="timeline-usd">${fmtUsd(c.saldo_usd)}</div>
        <div class="timeline-delta ${deltaCls}">${escapeHTML(deltaTxt)}</div>
      </div>`;
  }).join("");
}

function updateAgo() {
  if (!lastSnapshotAt) return;
  el("ago").textContent = fmtAgo(lastSnapshotAt);
  const secs = Math.floor((Date.now() - new Date(lastSnapshotAt).getTime()) / 1000);
  const lu = el("last-update");
  lu.classList.remove("stale", "dead");
  if (secs > 300) lu.classList.add("dead");
  else if (secs > 90) lu.classList.add("stale");
}

// ============ POLL ============
async function tick() {
  if (!cryptoKey) return;
  try {
    const snap = await fetchSnapshot();
    const data = await decryptSnapshot(snap, cryptoKey);
    render(data);
  } catch (e) {
    console.error("tick failed:", e);
    if (e.name === "OperationError") logout("Contraseña ya no es válida");
  }
}

function startPolling() {
  clearInterval(refreshTimer);
  clearInterval(agoTimer);
  refreshTimer = setInterval(tick, CONFIG.refreshMs);
  agoTimer = setInterval(updateAgo, 1000);
}

// ============ LOGIN / LOGOUT ============
const showError = (msg) => { const e = el("login-error"); e.textContent = msg; e.classList.remove("hidden"); };
const hideError = () => el("login-error").classList.add("hidden");

async function login() {
  hideError();
  const pw = el("password-input").value;
  if (!pw) return showError("INGRESA LA CONTRASEÑA");
  const btn = el("login-btn");
  btn.disabled = true;
  const original = btn.textContent;
  btn.textContent = "VERIFICANDO...";
  try {
    cryptoKey = await deriveKey(pw);
    const snap = await fetchSnapshot();
    const data = await decryptSnapshot(snap, cryptoKey);
    render(data);
    sessionStorage.setItem("gm_pw", pw);
    el("login").classList.add("hidden");
    el("dashboard").classList.remove("hidden");
    startPolling();
  } catch (e) {
    console.error("login failed:", e);
    cryptoKey = null;
    if (e.name === "OperationError") showError("CONTRASEÑA INCORRECTA");
    else if (e.message && e.message.startsWith("HTTP_")) {
      const code = e.message.slice(5);
      showError(code === "404" ? "NO HAY SNAPSHOT AÚN (¿RUNNER CORRIENDO?)" : "ERROR DE RED (HTTP " + code + ")");
    } else showError("ERROR: " + (e.message || e));
  } finally { btn.disabled = false; btn.textContent = original; }
}

function logout(msg) {
  clearInterval(refreshTimer); clearInterval(agoTimer);
  refreshTimer = null; agoTimer = null;
  cryptoKey = null; lastSnapshotAt = null;
  sessionStorage.removeItem("gm_pw");
  el("password-input").value = "";
  el("dashboard").classList.add("hidden");
  el("login").classList.remove("hidden");
  el("password-input").focus();
  if (msg) showError(msg);
}

// ============ DEMO MODE ============
function loadDemo() {
  const demo = {
    generated_at: new Date().toISOString(),
    tipo_cambio_usd: 17.0,
    caja_total: { pesos: 1265, usd: 26.82 },
    caja_hoy_neto: { total_mxn: 8400, efectivo: 235, transferencia: 0, tarjeta: 8165, dolares_usd: 5.53 },
    personas_hoy: { total: 83, gym: 78, spinning: 3, pilates: 2 },
    accesos: { total: 105, denegados: 4 },
    socios: { activos: 214, vencen_7d: 8, vencidos: 15 },
    timeline: [
      { etiqueta: "APERTURA", saldo_pesos: 1030, saldo_usd: 21.29, delta_pesos: 1030, delta_usd: 21.29 },
      { etiqueta: "10:00", saldo_pesos: 1065, saldo_usd: 23.05, delta_pesos: 35, delta_usd: 1.76 },
      { etiqueta: "12:00", saldo_pesos: 1265, saldo_usd: 26.82, delta_pesos: 200, delta_usd: 3.76 },
      { etiqueta: "AHORA", saldo_pesos: 1265, saldo_usd: 26.82, delta_pesos: 0, delta_usd: 0 },
    ],
    ventas: {
      count: 6, monto: 3800, gastos: 0, count_nuevos: 1, count_renovacion: 4, count_inscripcion: 1, count_pos: 0,
      ultimas: [
        { fecha: new Date(Date.now() - 20 * 60000).toISOString(), concepto: "MENSUALIDAD GYM - JORGE ANTONIO CEBALLOS MAGNON", metodo: "Tarjeta", usuario: "ABBY", total: 1400, tipo: "Renovación", refundada: false },
        { fecha: new Date(Date.now() - 79 * 60000).toISOString(), concepto: "DAYPASS - ALANIS", metodo: "Efectivo", usuario: "ABBY", total: 200, tipo: "Renovación", refundada: false },
        { fecha: new Date(Date.now() - 131 * 60000).toISOString(), concepto: "DAYPASS - PAOLA GOMEZ HARO", metodo: "Tarjeta", usuario: "ABBY", total: 200, tipo: "Renovación", refundada: false },
        { fecha: new Date(Date.now() - 160 * 60000).toISOString(), concepto: "MENSUALIDAD GYM - SANTIAGO NUÑO CHONG", metodo: "Tarjeta", usuario: "ABBY", total: 1400, tipo: "Renovación", refundada: false },
        { fecha: new Date(Date.now() - 204 * 60000).toISOString(), concepto: "1 CLASE PILATES - CLIENTE NUEVO", metodo: "Tarjeta", usuario: "ABBY", total: 300, tipo: "Nuevo", refundada: false },
        { fecha: new Date(Date.now() - 204 * 60000).toISOString(), concepto: "INSCRIPCIÓN - CLIENTE NUEVO", metodo: "Tarjeta", usuario: "ABBY", total: 300, tipo: "Inscripción", refundada: false },
      ],
    },
    stock_bajo: [
      { nombre: "AGUA GRANDE", stock: 0, precio: 35 },
      { nombre: "GATORADE AZUL", stock: 1, precio: 35 },
      { nombre: "RYSE ORANGE CREAM", stock: 1, precio: 75 },
      { nombre: "C4 FROZEN BOMBSICLE", stock: 0, precio: 80 },
      { nombre: "GATORADE NARANJA", stock: 4, precio: 35 },
    ],
  };
  render(demo);
  el("login").classList.add("hidden");
  el("dashboard").classList.remove("hidden");
  agoTimer = setInterval(updateAgo, 1000);
}

// ============ INIT ============
document.addEventListener("DOMContentLoaded", async () => {
  el("login-btn").addEventListener("click", login);
  el("password-input").addEventListener("keydown", (e) => { if (e.key === "Enter") login(); });
  el("logout-btn").addEventListener("click", () => logout());
  el("refresh-btn").addEventListener("click", tick);

  if (new URLSearchParams(location.search).has("demo")) { loadDemo(); return; }

  const savedPw = sessionStorage.getItem("gm_pw");
  if (savedPw) { el("password-input").value = savedPw; await login(); }
  else el("password-input").focus();
});

// ============ PWA / Service Worker ============
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => { /* ignora fallo silencioso */ });
  });
}
