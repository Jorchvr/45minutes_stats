// ============================================================
// 45 MINUTES · STATS DASHBOARD
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
const $ = (sel) => document.querySelector(sel);

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
function strToBytes(s) { return new TextEncoder().encode(s); }
function bytesToStr(b) { return new TextDecoder().decode(b); }

function escapeHTML(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c]);
}

function fmtMoney(n) {
  if (n == null || isNaN(n)) return "$0";
  return "$" + Math.round(Number(n)).toLocaleString("es-MX");
}
function fmtNumber(n) {
  if (n == null || isNaN(n)) return "0";
  return Number(n).toLocaleString("es-MX");
}
function fmtTime(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleTimeString("es-MX", {
      hour: "2-digit", minute: "2-digit",
    });
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

// ============ CRYPTO ============
async function deriveKey(password) {
  const passKey = await crypto.subtle.importKey(
    "raw",
    strToBytes(password),
    { name: "PBKDF2" },
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: strToBytes(CONFIG.pbkdf2Salt),
      iterations: CONFIG.pbkdf2Iterations,
      hash: "SHA-256",
    },
    passKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"]
  );
}

async function fetchSnapshot() {
  const url =
    `https://raw.githubusercontent.com/${CONFIG.repoOwner}/` +
    `${CONFIG.repoName}/${CONFIG.dataBranch}/${CONFIG.snapshotFile}` +
    `?t=${Date.now()}`;
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
  const caja = data.caja || {};
  el("caja-efectivo").textContent = fmtMoney(caja.efectivo);
  el("caja-tarjeta").textContent = fmtMoney(caja.tarjeta);
  el("caja-transfer").textContent = fmtMoney(caja.transferencia);
  el("caja-usd").textContent = fmtMoney(caja.dolares);
  el("caja-total").textContent = fmtMoney(caja.total);

  const v = data.ventas || {};
  el("ventas-count").textContent = fmtNumber(v.count);
  el("ventas-monto").textContent = fmtMoney(v.monto);
  el("ventas-gastos").textContent = fmtMoney(v.gastos);

  const a = data.accesos || {};
  el("access-unicos").textContent = fmtNumber(a.unicos);
  el("access-total").textContent = fmtNumber(a.total);
  el("access-denegados").textContent = fmtNumber(a.denegados);

  const s = data.socios || {};
  el("socios-activos").textContent = fmtNumber(s.activos);
  el("socios-vencen").textContent = fmtNumber(s.vencen_7d);
  el("socios-vencidos").textContent = fmtNumber(s.vencidos);

  const tbody = el("ventas-tbody");
  if (v.ultimas && v.ultimas.length) {
    tbody.innerHTML = v.ultimas.map((row) => `
      <tr>
        <td>${escapeHTML(fmtTime(row.fecha))}</td>
        <td>${escapeHTML(row.concepto || "")}</td>
        <td><span class="tag ${tagClassForMethod(row.metodo)}">${escapeHTML((row.metodo || "").toUpperCase())}</span></td>
        <td>${escapeHTML(row.usuario || "")}</td>
        <td class="right"><strong>${fmtMoney(row.total)}</strong></td>
      </tr>`).join("");
  } else {
    tbody.innerHTML = `<tr><td colspan="5" class="muted center">Sin ventas hoy</td></tr>`;
  }

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
    if (e.name === "OperationError") {
      logout("Contraseña ya no es válida");
    }
  }
}

function startPolling() {
  clearInterval(refreshTimer);
  clearInterval(agoTimer);
  refreshTimer = setInterval(tick, CONFIG.refreshMs);
  agoTimer = setInterval(updateAgo, 1000);
}

// ============ LOGIN / LOGOUT ============
function showError(msg) {
  const e = el("login-error");
  e.textContent = msg;
  e.classList.remove("hidden");
}
function hideError() { el("login-error").classList.add("hidden"); }

async function login() {
  hideError();
  const pw = el("password-input").value;
  if (!pw) return showError("INGRESA LA CONTRASEÑA");

  const btn = el("login-btn");
  btn.disabled = true;
  const originalText = btn.textContent;
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
    if (e.name === "OperationError") {
      showError("CONTRASEÑA INCORRECTA");
    } else if (e.message && e.message.startsWith("HTTP_")) {
      const code = e.message.slice(5);
      if (code === "404") {
        showError("NO HAY SNAPSHOT AÚN (¿EL RUNNER ESTÁ CORRIENDO?)");
      } else {
        showError("ERROR DE RED (HTTP " + code + ")");
      }
    } else {
      showError("ERROR: " + (e.message || e));
    }
  } finally {
    btn.disabled = false;
    btn.textContent = originalText;
  }
}

function logout(msg) {
  clearInterval(refreshTimer);
  clearInterval(agoTimer);
  refreshTimer = null;
  agoTimer = null;
  cryptoKey = null;
  lastSnapshotAt = null;
  sessionStorage.removeItem("gm_pw");
  el("password-input").value = "";
  el("dashboard").classList.add("hidden");
  el("login").classList.remove("hidden");
  el("password-input").focus();
  if (msg) showError(msg);
}

// ============ DEMO MODE (bypass crypto para preview) ============
function loadDemo() {
  const demo = {
    generated_at: new Date().toISOString(),
    caja: { efectivo: 3450, tarjeta: 1200, transferencia: 800, dolares: 150, total: 5600 },
    ventas: {
      count: 24, monto: 5750, gastos: 150,
      ultimas: [
        { fecha: new Date(Date.now() - 5 * 60000).toISOString(), concepto: "MENSUALIDAD GYM", metodo: "Efectivo", usuario: "JORGE", total: 500 },
        { fecha: new Date(Date.now() - 12 * 60000).toISOString(), concepto: "BOTELLA AGUA + BARRA PROTEINA", metodo: "Tarjeta", usuario: "MIRIAM", total: 85 },
        { fecha: new Date(Date.now() - 18 * 60000).toISOString(), concepto: "DAYPASS SPINNING", metodo: "Transferencia", usuario: "JORGE", total: 120 },
        { fecha: new Date(Date.now() - 25 * 60000).toISOString(), concepto: "INSCRIPCION + MENSUALIDAD", metodo: "Efectivo", usuario: "JORGE", total: 1100 },
        { fecha: new Date(Date.now() - 40 * 60000).toISOString(), concepto: "PROTEINA WHEY 2 KG", metodo: "Tarjeta", usuario: "MIRIAM", total: 890 },
        { fecha: new Date(Date.now() - 55 * 60000).toISOString(), concepto: "MENSUALIDAD GYM+SPINNING", metodo: "Efectivo", usuario: "JORGE", total: 750 },
        { fecha: new Date(Date.now() - 68 * 60000).toISOString(), concepto: "[GASTO] GARRAFON AGUA", metodo: "Efectivo", usuario: "JORGE", total: -150 },
        { fecha: new Date(Date.now() - 90 * 60000).toISOString(), concepto: "DAYPASS", metodo: "Efectivo", usuario: "MIRIAM", total: 100 },
      ],
    },
    accesos: { unicos: 47, total: 62, denegados: 3 },
    socios: { activos: 214, vencen_7d: 8, vencidos: 15 },
    stock_bajo: [
      { nombre: "PROTEINA WHEY VAINILLA 2KG", stock: 0, precio: 890 },
      { nombre: "BARRA PROTEINA CHOCOLATE", stock: 1, precio: 45 },
      { nombre: "BOTELLA AGUA 600ML", stock: 2, precio: 20 },
      { nombre: "CREATINA 500G", stock: 3, precio: 550 },
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
  el("password-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter") login();
  });
  el("logout-btn").addEventListener("click", () => logout());
  el("refresh-btn").addEventListener("click", tick);

  // ?demo=1 → sin backend, sin password, datos hardcoded (para preview de diseño)
  if (new URLSearchParams(location.search).has("demo")) {
    loadDemo();
    return;
  }

  const savedPw = sessionStorage.getItem("gm_pw");
  if (savedPw) {
    el("password-input").value = savedPw;
    await login();
  } else {
    el("password-input").focus();
  }
});
