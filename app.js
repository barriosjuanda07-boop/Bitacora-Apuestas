(() => {
"use strict";
const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const { pl } = window.Settle;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const clean = o => JSON.parse(JSON.stringify(o)); // Firestore no acepta undefined

/* ---------- Estado ---------- */
let bets = [];
let config = { bankroll: 1000, moneda: "Q", unidad: 0 };
let period = "todo", showN = 25, editingId = null, store = null;

/* ---------- Almacenamiento ---------- */
const LS_KEY = "bitacora-apuestas-v1";
const lsRead = () => { try { return JSON.parse(localStorage.getItem(LS_KEY)) || {}; } catch { return {}; } };
const lsWrite = o => { try { localStorage.setItem(LS_KEY, JSON.stringify(o)); return true; } catch { return false; } };
const newLocalId = () => "b" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

function localStore() {
  let fn = null;
  const emit = () => { const o = lsRead(); fn && fn(Object.values(o.bets || {}), o.config || null); };
  window.addEventListener("storage", e => { if (e.key === LS_KEY) emit(); });
  return {
    kind: "local",
    subscribe(f) { fn = f; emit(); },
    async saveBet(b) { const o = lsRead(); o.bets = o.bets || {}; o.bets[b.id] = clean(b); if (!lsWrite(o)) throw new Error("el navegador no permitió guardar"); emit(); },
    async deleteBet(id) { const o = lsRead(); if (o.bets) delete o.bets[id]; lsWrite(o); emit(); },
    async saveConfig(c) { const o = lsRead(); o.config = c; lsWrite(o); emit(); },
    newId: newLocalId,
  };
}
function fbStore(fs, uid) {
  const base = fs.collection("users").doc(uid), col = base.collection("bets");
  return {
    kind: "cloud",
    subscribe(f, onErr) {
      let list = [], cfg = null, gotBets = false;
      col.onSnapshot(s => { gotBets = true; list = s.docs.map(d => ({ ...d.data(), id: d.id })); f(list, cfg, s.metadata); }, onErr);
      base.onSnapshot(d => { cfg = d.exists ? d.data() : null; if (gotBets) f(list, cfg, d.metadata); }, onErr);
    },
    async saveBet(b) { const { id, ...r } = b; await col.doc(id).set(clean(r)); },
    async deleteBet(id) { await col.doc(id).delete(); },
    async saveConfig(c) { await base.set(clean(c), { merge: true }); },
    newId: () => col.doc().id,
  };
}
function setSync(state, txt) { $("#syncDot").className = "dot " + (state || ""); $("#syncTxt").textContent = txt; }

function onData(list, cfg) {
  bets = list;
  if (cfg) config = { ...config, ...cfg };
  render();
}

function initStore() {
  const cfg = window.FIREBASE_CONFIG;
  if (!cfg || !window.firebase) {
    store = localStore();
    setSync("warn", "Guardado solo en este navegador");
    store.subscribe(onData);
    return;
  }
  firebase.initializeApp(cfg);
  const auth = firebase.auth(), fs = firebase.firestore();
  fs.enablePersistence({ synchronizeTabs: true }).catch(() => {});
  $("#btnLogin").addEventListener("click", async () => {
    $("#loginErr").textContent = "";
    const prov = new firebase.auth.GoogleAuthProvider();
    try { await auth.signInWithPopup(prov); }
    catch (e) {
      if (e && (e.code === "auth/popup-blocked" || e.code === "auth/operation-not-supported-in-this-environment")) { auth.signInWithRedirect(prov); return; }
      if (e && e.code === "auth/unauthorized-domain") { $("#loginErr").textContent = "Este dominio no está autorizado en Firebase. Agrégalo en Authentication → Configuración → Dominios autorizados."; return; }
      if (e && e.code !== "auth/popup-closed-by-user") $("#loginErr").textContent = "No se pudo iniciar sesión: " + (e.message || e.code);
    }
  });
  $("#btnLogout").hidden = false;
  $("#btnLogout").addEventListener("click", () => { closeOv($("#ovCfg")); auth.signOut(); location.reload(); });
  let started = false;
  auth.onAuthStateChanged(u => {
    if (!u) { $("#gate").hidden = false; $("#app").hidden = true; return; }
    $("#gate").hidden = true; $("#app").hidden = false;
    $("#userBox").textContent = "· " + (u.displayName || u.email || "");
    if (started) return; started = true;
    store = fbStore(fs, u.uid);
    let first = true;
    const t = setTimeout(() => setSync("warn", "Sin conexión; mostrando lo último guardado"), 10000);
    store.subscribe((list, c, meta) => {
      if (meta && !meta.fromCache) { clearTimeout(t); setSync("ok", "Sincronizado en la nube"); }
      onData(list, c);
      if (first && meta && !meta.fromCache) { first = false; offerMigration(list); }
    }, e => { clearTimeout(t); setSync("warn", "Error de conexión con Firebase: " + (e.code || e.message)); });
  });
}
function offerMigration(cloudList) {
  const o = lsRead(), loc = Object.values(o.bets || {});
  const ids = new Set(cloudList.map(b => b.id));
  const pend = loc.filter(b => !ids.has(b.id));
  if (!pend.length) return;
  const box = $("#moreBox");
  const btn = document.createElement("button");
  btn.className = "btn primary"; btn.type = "button";
  btn.textContent = `Subir ${pend.length} apuestas guardadas en este navegador`;
  btn.addEventListener("click", async () => {
    btn.disabled = true;
    try { for (const b of pend) await store.saveBet(b); if (o.config) await store.saveConfig(o.config); delete o.bets; lsWrite(o); toast("Apuestas subidas a la nube"); btn.remove(); }
    catch (e) { toast(writeErr(e)); btn.disabled = false; }
  });
  box.prepend(btn);
}

/* ---------- Utilidades ---------- */
const localISO = d => { d = new Date(d); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };
const today = () => localISO(new Date());
const isClosed = b => b.estado && b.estado !== "pendiente";
const byDateAsc = (a, b) => (a.fecha || "").localeCompare(b.fecha || "") || (a.creado || 0) - (b.creado || 0);
const byDateDesc = (a, b) => byDateAsc(b, a);
const norm = s => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
function periodStart() {
  const d = new Date();
  if (period === "7") d.setDate(d.getDate() - 6);
  else if (period === "30") d.setDate(d.getDate() - 29);
  else if (period === "mes") d.setDate(1);
  else return null;
  return localISO(d);
}
const inPeriod = b => { const s = periodStart(); return !s || (b.fecha || "") >= s; };
const americanToDec = a => { a = +a; if (!a) return 0; return a > 0 ? 1 + a / 100 : 1 + 100 / Math.abs(a); };
function money(n, signed) {
  const s = Math.abs(n).toLocaleString("es-GT", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const sign = n < -0.004 ? "−" : (signed && n > 0.004 ? "+" : "");
  return sign + config.moneda + " " + s;
}
const pct = (n, signed) => (isFinite(n) ? ((signed && n > 0 ? "+" : "") + (n * 100).toFixed(1).replace("-", "−") + " %") : "—");
const cls = n => n > 0.004 ? "pos" : n < -0.004 ? "neg" : "";
const units = n => config.unidad > 0 ? ((n > 0 ? "+" : "") + (n / config.unidad).toFixed(2).replace("-", "−") + " u") : null;
const fmtDate = f => { if (!f) return "—"; const [y, m, d] = f.split("-"); return `${d}/${m}/${y.slice(2)}`; };
const _unused = iso => { try { return new Date(iso).toLocaleString("es-GT", { weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }); } catch { return iso; } };
const estadoTxt = { pendiente: "Pendiente", ganada: "Ganada", perdida: "Perdida", nula: "Nula", cashout: "Cash out", medio_ganada: "Medio ganada", medio_perdida: "Medio perdida" };
const isWinState = s => s === "ganada" || s === "medio_ganada";
const isLossState = s => s === "perdida" || s === "medio_perdida";

/* ---------- Estadísticas ---------- */
function computeStats(list) {
  const closed = list.filter(isClosed).sort(byDateAsc);
  const decided = closed.filter(b => isWinState(b.estado) || isLossState(b.estado));
  const wins = closed.filter(b => isWinState(b.estado)).length, losses = closed.filter(b => isLossState(b.estado)).length;
  const staked = closed.reduce((s, b) => s + (+b.monto || 0), 0);
  const profit = closed.reduce((s, b) => s + pl(b), 0);
  const avgOdds = closed.length ? closed.reduce((s, b) => s + (+b.cuota || 0), 0) / closed.length : NaN;
  const beWin = decided.length ? decided.reduce((s, b) => s + 1 / (+b.cuota || 1), 0) / decided.length : NaN;
  const avgStake = closed.length ? staked / closed.length : NaN;
  let best = null, worst = null;
  closed.forEach(b => { if (!best || pl(b) > pl(best)) best = b; if (!worst || pl(b) < pl(worst)) worst = b; });
  let streak = 0, streakType = null;
  for (let i = decided.length - 1; i >= 0; i--) { const t = isWinState(decided[i].estado) ? "w" : "l"; if (!streakType) { streakType = t; streak = 1; } else if (t === streakType) streak++; else break; }
  let bestW = 0, cur = 0;
  decided.forEach(b => { if (isWinState(b.estado)) { cur++; bestW = Math.max(bestW, cur); } else cur = 0; });
  return { closed, wins, losses, staked, profit, avgOdds, beWin, avgStake, best, worst, streak, streakType, bestW,
    roi: staked ? profit / staked : NaN, winRate: wins + losses ? wins / (wins + losses) : NaN };
}
function drawdown(all) {
  let run = +config.bankroll || 0, peak = run, abs = 0, p = 0;
  all.filter(isClosed).sort(byDateAsc).forEach(b => { run += pl(b); if (run > peak) peak = run; const d = peak - run; if (d > abs) { abs = d; p = peak ? d / peak : 0; } });
  return { abs, pct: p };
}

/* ---------- Gráficas ---------- */
let chBank = null, chMonth = null;
if (window.Chart) { Chart.defaults.color = css("--muted"); Chart.defaults.font.family = css("--font-body"); Chart.defaults.font.size = 12; Chart.defaults.borderColor = css("--line"); }
const tip = () => ({ backgroundColor: css("--surface-2"), borderColor: css("--line"), borderWidth: 1, titleColor: css("--text"), bodyColor: css("--text"), padding: 10 });
function drawBank(all) {
  const cv = $("#chartBank");
  if (!window.Chart) { $("#chartHint").textContent = "No se pudo cargar la librería de gráficas"; return; }
  const closedAll = all.filter(isClosed).sort(byDateAsc), s = periodStart();
  let base = +config.bankroll || 0;
  closedAll.forEach(b => { if (s && (b.fecha || "") < s) base += pl(b); });
  const pts = closedAll.filter(b => !s || (b.fecha || "") >= s);
  const labels = ["Inicio"], data = [base], meta = [null];
  let run = base;
  pts.forEach(b => { run += pl(b); labels.push(fmtDate(b.fecha)); data.push(+run.toFixed(2)); meta.push(b); });
  const up = run >= base, col = up ? css("--win") : css("--loss");
  const grad = cv.getContext("2d").createLinearGradient(0, 0, 0, cv.parentElement.clientHeight || 280);
  grad.addColorStop(0, up ? "rgba(79,192,141,.28)" : "rgba(238,106,106,.28)"); grad.addColorStop(1, "rgba(0,0,0,0)");
  if (chBank) chBank.destroy();
  chBank = new Chart(cv, {
    type: "line",
    data: { labels, datasets: [
      { data, borderColor: col, backgroundColor: grad, fill: true, tension: .25, borderWidth: 2, pointRadius: data.map((_, i) => i === data.length - 1 ? 5 : data.length > 40 ? 0 : 2.5), pointBackgroundColor: col, pointBorderWidth: 0 },
      { data: data.map(() => base), borderColor: css("--line"), borderDash: [4, 4], borderWidth: 1, pointRadius: 0, fill: false }] },
    options: { responsive: true, maintainAspectRatio: false, animation: false, interaction: { mode: "index", intersect: false },
      plugins: { legend: { display: false }, tooltip: { ...tip(), filter: i => i.datasetIndex === 0, callbacks: {
        title: it => { const b = meta[it[0].dataIndex]; return b ? b.evento : "Inicio del periodo"; },
        label: it => { const b = meta[it.dataIndex]; const l = "Balance: " + money(it.raw); return b ? [l, "Resultado: " + money(pl(b), true)] : l; } } } },
      scales: { x: { grid: { display: false }, ticks: { maxTicksLimit: 8, maxRotation: 0 } }, y: { grid: { color: "rgba(40,49,66,.6)" }, ticks: { callback: v => config.moneda + " " + Number(v).toLocaleString("es-GT") } } } }
  });
  $("#chartHint").textContent = pts.length ? `${pts.length} apuestas cerradas · punteada = punto de partida` : "Todavía no hay apuestas cerradas en este periodo";
}
function drawMonth(all) {
  if (!window.Chart) return;
  const m = {};
  all.filter(isClosed).forEach(b => { const k = (b.fecha || "").slice(0, 7); if (k) m[k] = (m[k] || 0) + pl(b); });
  const keys = Object.keys(m).sort().slice(-8), vals = keys.map(k => +m[k].toFixed(2));
  const names = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
  if (chMonth) chMonth.destroy();
  chMonth = new Chart($("#chartMonth"), {
    type: "bar",
    data: { labels: keys.map(k => names[+k.slice(5, 7) - 1] + " " + k.slice(2, 4)), datasets: [{ data: vals, backgroundColor: vals.map(v => v >= 0 ? css("--win") : css("--loss")), borderRadius: 4, maxBarThickness: 34 }] },
    options: { responsive: true, maintainAspectRatio: false, animation: false, plugins: { legend: { display: false }, tooltip: { ...tip(), callbacks: { label: i => money(i.raw, true) } } },
      scales: { x: { grid: { display: false } }, y: { grid: { color: "rgba(40,49,66,.6)" }, ticks: { maxTicksLimit: 5, callback: v => Number(v).toLocaleString("es-GT") } } } }
  });
}

/* ---------- Render ---------- */
const uniq = a => Array.from(new Set(a.filter(Boolean).map(s => String(s).trim()).filter(Boolean))).sort((x, y) => x.localeCompare(y, "es"));
function render() {
  const all = bets.slice(), list = all.filter(inPeriod), S = computeStats(list);
  const totalProfit = all.filter(isClosed).reduce((s, b) => s + pl(b), 0);
  const bank = +config.bankroll || 0, balance = bank + totalProfit;
  const pending = all.filter(b => b.estado === "pendiente");
  const pendStake = pending.reduce((s, b) => s + (+b.monto || 0), 0);
  const pendPot = pending.reduce((s, b) => s + (+b.monto || 0) * ((+b.cuota || 0) - 1), 0);

  $("#kBalance").textContent = money(balance);
  $("#kBalanceSub").innerHTML = `<span class="${cls(totalProfit)}">${pct(bank ? totalProfit / bank : NaN, true)}</span> sobre ${esc(money(bank))} iniciales`;
  $("#kProfit").textContent = money(S.profit, true); $("#kProfit").className = "val num " + cls(S.profit);
  $("#kProfitSub").textContent = (units(S.profit) ? units(S.profit) + " · " : "") + `${S.closed.length} cerradas`;
  $("#kRoi").textContent = pct(S.roi, true); $("#kRoi").className = "val num " + cls(S.roi);
  $("#kRoiSub").textContent = "Apostado: " + money(S.staked);
  $("#kWin").textContent = pct(S.winRate);
  $("#kWinSub").textContent = `${S.wins} G · ${S.losses} P` + (isFinite(S.beWin) ? ` · necesitas ${pct(S.beWin)}` : "");
  $("#kPend").textContent = money(pendStake);
  $("#kPendSub").textContent = pending.length ? `${pending.length} pendientes · posible ${money(pendPot, true)}` : "Sin apuestas abiertas";

  $("#periodLbl").textContent = { "7": "Últimos 7 días", "30": "Últimos 30 días", mes: "Este mes", todo: "Todo el historial" }[period];
  const dd = drawdown(all), edge = isFinite(S.winRate) && isFinite(S.beWin) ? S.winRate - S.beWin : NaN;
  const rows = [
    ["Cuota promedio", isFinite(S.avgOdds) ? S.avgOdds.toFixed(2) : "—", "Prob. implícita " + (isFinite(S.avgOdds) ? pct(1 / S.avgOdds) : "—")],
    ["Ventaja vs. cuotas", isFinite(edge) ? `<span class="${cls(edge)}">${(edge > 0 ? "+" : "") + (edge * 100).toFixed(1).replace("-", "−")} pp</span>` : "—", "Tu acierto menos el que piden las cuotas"],
    ["Monto promedio", isFinite(S.avgStake) ? esc(money(S.avgStake)) : "—", bank && isFinite(S.avgStake) ? pct(S.avgStake / bank) + " del bankroll inicial" : ""],
    ["Racha actual", S.streakType ? `<span class="${S.streakType === "w" ? "pos" : "neg"}">${S.streak} ${S.streakType === "w" ? "ganada" : "perdida"}${S.streak > 1 ? "s" : ""}</span>` : "—", "Mejor racha ganadora: " + S.bestW],
    ["Caída máxima", dd.abs > 0 ? `<span class="neg">−${esc(money(dd.abs))}</span>` : "—", dd.abs > 0 ? pct(dd.pct) + " desde un pico del bankroll" : "Desde el máximo del bankroll"],
    ["Mejor apuesta", S.best && pl(S.best) > 0 ? `<span class="pos">${esc(money(pl(S.best), true))}</span>` : "—", S.best && pl(S.best) > 0 ? S.best.evento : ""],
    ["Peor apuesta", S.worst && pl(S.worst) < 0 ? `<span class="neg">${esc(money(pl(S.worst), true))}</span>` : "—", S.worst && pl(S.worst) < 0 ? S.worst.evento : ""],
  ];
  $("#stats").innerHTML = rows.map(([k, v, s]) => `<div class="stat"><span class="k">${esc(k)}<small>${esc(s)}</small></span><span class="num">${v}</span></div>`).join("");
  $("#byDeporte").innerHTML = breakdown(list, b => b.deporte, "Deporte");
  $("#byCasa").innerHTML = breakdown(list, b => b.casa, "Casa");

  const dep = uniq(all.map(b => b.deporte)), fd = $("#fDeporte"), cur = fd.value;
  fd.innerHTML = '<option value="">Todos los deportes</option>' + dep.map(d => `<option${d === cur ? " selected" : ""}>${esc(d)}</option>`).join("");
  $("#dlDeporte").innerHTML = uniq(dep.concat(["Tenis ATP", "Tenis WTA", "Tenis Challenger", "Fútbol", "NFL", "Básquet", "Béisbol"])).map(d => `<option value="${esc(d)}">`).join("");
  $("#dlCasa").innerHTML = uniq(all.map(b => b.casa)).map(d => `<option value="${esc(d)}">`).join("");
  renderHist(all); drawBank(all); drawMonth(all);
}
function breakdown(list, keyFn, title) {
  const g = {};
  list.filter(isClosed).forEach(b => { const k = (keyFn(b) || "Sin especificar").trim() || "Sin especificar"; const v = g[k] = g[k] || { n: 0, st: 0, pr: 0 }; v.n++; v.st += +b.monto || 0; v.pr += pl(b); });
  const arr = Object.entries(g).sort((a, b) => b[1].pr - a[1].pr);
  if (!arr.length) return '<div class="empty"><p>Aparece cuando cierres apuestas en este periodo.</p></div>';
  const max = Math.max(...arr.map(([, v]) => Math.abs(v.pr)), 1);
  return `<table><thead><tr><th>${title}</th><th class="r">N</th><th class="r">G/P</th><th class="r">ROI</th></tr></thead><tbody>` +
    arr.map(([k, v]) => { const roi = v.st ? v.pr / v.st : 0;
      return `<tr><td>${esc(k)}<div class="bar"><i style="width:${Math.round(Math.abs(v.pr) / max * 100)}%;background:${v.pr >= 0 ? "var(--win)" : "var(--loss)"}"></i></div></td><td class="r num">${v.n}</td><td class="r num ${cls(v.pr)}">${esc(money(v.pr, true))}</td><td class="r num ${cls(roi)}">${pct(roi, true)}</td></tr>`; }).join("") + "</tbody></table>";
}
function renderHist(all) {
  const q = norm($("#fSearch").value), e = $("#fEstado").value, d = $("#fDeporte").value;
  const rows = all.filter(inPeriod).filter(b => (!e || b.estado === e || (e === "ganada" && b.estado === "medio_ganada") || (e === "perdida" && b.estado === "medio_perdida")) && (!d || b.deporte === d) &&
    (!q || norm([b.evento, b.seleccion, b.notas, b.casa, b.deporte].join(" ")).includes(q))).sort(byDateDesc);
  const box = $("#hist");
  if (!all.length) {
    box.innerHTML = `<div class="empty"><p>Aún no tienes apuestas. Pon tu bankroll en Ajustes y registra la primera. Si ya tenías apuestas en la versión de Claude, impórtalas desde Ajustes.</p>
      <div class="actions" style="justify-content:center"><button class="btn primary" type="button" data-act="new">+ Registrar primera apuesta</button><button class="btn" type="button" data-act="cfg">Ajustes</button></div></div>`;
    return;
  }
  if (!rows.length) { box.innerHTML = '<div class="empty"><p>Ninguna apuesta coincide con los filtros o el periodo elegido.</p></div>'; return; }
  box.innerHTML = `<table class="hist"><thead><tr><th>Fecha</th><th>Evento</th><th>Deporte</th><th>Casa</th><th class="r">Cuota</th><th class="r">Monto</th><th>Estado</th><th class="r">G/P</th><th class="r">Acciones</th></tr></thead><tbody>` +
    rows.slice(0, showN).map(b => {
      const v = pl(b);
      const sub = b.legs && b.legs.length ? "" : [b.seleccion, b.tipo && b.tipo !== "simple" ? b.tipo : ""].filter(Boolean).join(" · ");
      const legHtml = b.legs && b.legs.length ? b.legs.map((l, i) => `<span class="legl"><i>${i + 1}</i>${esc(l.evento)} · ${esc(l.seleccion)}${l.cuota ? ` <span class="num">@${(+l.cuota).toFixed(2)}</span>` : ""}</span>`).join("") : "";
      const extra = b.marcador ? `<span>Marcador ${esc(b.marcador)}</span>` : "";
      const quick = b.estado === "pendiente" ? `<button class="btn sm" type="button" data-act="win" data-id="${esc(b.id)}">Ganó</button><button class="btn sm" type="button" data-act="lose" data-id="${esc(b.id)}">Perdió</button>` : "";
      return `<tr><td class="num">${fmtDate(b.fecha)}</td>
        <td class="ev"><b>${esc(b.evento)}</b><span>${esc(sub)}</span>${legHtml}${extra ? "<br>" + extra : ""}</td>
        <td>${esc(b.deporte || "—")}</td><td>${esc(b.casa || "—")}</td>
        <td class="r num">${(+b.cuota || 0).toFixed(2)}</td><td class="r num">${esc(money(+b.monto || 0))}</td>
        <td><span class="pill p-${esc(b.estado)}">${estadoTxt[b.estado] || esc(b.estado)}</span></td>
        <td class="r num ${cls(v)}">${b.estado === "pendiente" ? `<span style="color:var(--muted)">${esc(money((+b.monto || 0) * ((+b.cuota || 0) - 1), true))}</span>` : esc(money(v, true))}</td>
        <td><div class="rowact">${quick}<button class="btn sm" type="button" data-act="edit" data-id="${esc(b.id)}">Editar</button></div></td></tr>`;
    }).join("") + "</tbody></table>";
  const mb = $("#moreBox"); mb.querySelectorAll("[data-act=more]").forEach(x => x.remove());
  if (rows.length > showN) mb.insertAdjacentHTML("beforeend", `<button class="btn" type="button" data-act="more">Mostrar más (${rows.length - showN} restantes)</button>`);
}

/* ---------- Modales ---------- */
let lastFocus = null;
function openOv(id) { lastFocus = document.activeElement; const o = $(id); o.classList.add("open"); const f = o.querySelector("input:not([type=radio]):not([hidden]),select"); f && setTimeout(() => f.focus(), 20); }
function closeOv(o) { o.classList.remove("open"); lastFocus && lastFocus.focus && lastFocus.focus(); }
$$(".overlay").forEach(o => o.addEventListener("click", e => { if (e.target === o || e.target.closest("[data-close]")) closeOv(o); }));
document.addEventListener("keydown", e => {
  if (e.key === "Escape") { $$(".overlay.open").forEach(closeOv); return; }
  if ((e.key === "n" || e.key === "N") && !e.ctrlKey && !e.metaKey && !$$(".overlay.open").length && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName) && store) { e.preventDefault(); openBet(null); }
});

function getEstado() { return (document.querySelector('input[name="estado"]:checked') || {}).value || "pendiente"; }
function setEstado(v) { const r = document.querySelector(`input[name="estado"][value="${v}"]`); if (r) r.checked = true; $("#cashBox").hidden = v !== "cashout"; }
const decOdds = () => { const raw = +$("#iCuota").value; return $("#iFormato").value === "us" ? americanToDec(raw) : raw; };
function updatePreview() {
  const c = decOdds(), m = +$("#iMonto").value, est = getEstado();
  $("#cashBox").hidden = est !== "cashout";
  const parts = [];
  if (c > 1 && m > 0) {
    parts.push(`Ganancia posible <b class="num">${esc(money(m * (c - 1), true))}</b>`, `Cobro total <b class="num">${esc(money(m * c))}</b>`, `Prob. implícita <b class="num">${pct(1 / c)}</b>`);
    if ($("#iFormato").value === "us") parts.push(`Cuota decimal <b class="num">${c.toFixed(3)}</b>`);
    const bal = (+config.bankroll || 0) + bets.filter(isClosed).reduce((s, b) => s + pl(b), 0);
    if (bal > 0) parts.push(`Riesgo <b class="num">${pct(m / bal)}</b> del balance`);
    if (config.unidad > 0) parts.push(`<b class="num">${(m / config.unidad).toFixed(2)} u</b>`);
  } else parts.push("Escribe la cuota y el monto para ver la ganancia posible.");
  if (getTipo() === "combinada") { const n = readLegs().filter(l => l.evento || l.seleccion || l.cuota).length; parts.push(legsCuota() ? `${n} selecciones · cuota total = producto de las cuotas` : `${n} selecciones · llena la cuota de cada una para calcular la total, o escribe la total`); }
  $("#preview").innerHTML = parts.join("");
}
["#iCuota", "#iMonto", "#iFormato"].forEach(s => $(s).addEventListener("input", updatePreview));
$("#iEstado").addEventListener("change", updatePreview);

/* Combinadas */
const getTipo = () => (document.querySelector('input[name="tipo"]:checked') || {}).value || "simple";
function setTipo(t) {
  t = t === "combinada" ? "combinada" : "simple";
  const r = document.querySelector(`input[name="tipo"][value="${t}"]`); if (r) r.checked = true;
  $$(".only-simple").forEach(el => { el.hidden = t !== "simple"; });
  $$(".only-combo").forEach(el => { el.hidden = t !== "combinada"; });
  $("#lblCuota").textContent = t === "combinada" ? "Cuota total" : "Cuota";
  if (t === "combinada") while ($$("#legs .leg").length < 2) addLeg();
}
function addLeg(l, focus) {
  l = l || {};
  const row = document.createElement("div"); row.className = "leg";
  row.innerHTML = `<span class="n"></span><input class="field ev" placeholder="Partido" aria-label="Partido"><input class="field sel" placeholder="Tu selección" aria-label="Tu selección"><input class="field num cu" type="number" step="any" inputmode="decimal" placeholder="Cuota" aria-label="Cuota de la selección"><button type="button" class="rm" aria-label="Quitar selección" title="Quitar">×</button>`;
  row.querySelector(".ev").value = l.evento || "";
  row.querySelector(".sel").value = l.seleccion || "";
  row.querySelector(".cu").value = l.cuota || "";
  $("#legs").appendChild(row); renumber();
  if (focus) row.querySelector(".ev").focus();
}
function renumber() { $$("#legs .leg").forEach((r, i) => { r.querySelector(".n").textContent = i + 1; }); }
function readLegs() {
  return $$("#legs .leg").map(r => ({ evento: r.querySelector(".ev").value.trim(), seleccion: r.querySelector(".sel").value.trim(), cuota: +r.querySelector(".cu").value || null }));
}
function legsCuota() {
  const L = readLegs().filter(l => l.evento || l.seleccion || l.cuota);
  if (L.length < 2 || L.some(l => !(l.cuota > 1))) return null;
  return L.reduce((p, l) => p * l.cuota, 1);
}
function syncComboOdds() { const c = legsCuota(); if (c) { $("#iFormato").value = "dec"; $("#iCuota").value = c.toFixed(2); } updatePreview(); }
$("#legs").addEventListener("input", e => { if (e.target.classList.contains("cu")) syncComboOdds(); });
$("#legs").addEventListener("click", e => {
  const b = e.target.closest(".rm"); if (!b) return;
  if ($$("#legs .leg").length <= 2) { toast("Una combinada necesita al menos 2 selecciones. Si es una sola, elige Simple."); return; }
  b.closest(".leg").remove(); renumber(); syncComboOdds();
});
$("#btnAddLeg").addEventListener("click", () => addLeg(null, true));
$("#iTipo").addEventListener("change", () => { setTipo(getTipo()); updatePreview(); });

let lastCasa = "";
function openBet(id) {
  editingId = id;
  const b = id ? bets.find(x => x.id === id) : null;
  $("#betTitle").textContent = b ? "Editar apuesta" : "Nueva apuesta";
  $("#btnSave").textContent = b ? "Guardar cambios" : "Guardar apuesta";
  $("#btnDelInForm").hidden = !b;
  $("#iFecha").value = b ? b.fecha : today();
  $("#iDeporte").value = b ? b.deporte || "" : "";
  $("#iCasa").value = b ? b.casa || "" : lastCasa;
  $("#iEvento").value = b ? b.evento || "" : "";
  $("#legs").innerHTML = "";
  (b && b.legs ? b.legs : []).forEach(l => addLeg(l));
  setTipo(b ? b.tipo : "simple");
  $("#iFormato").value = "dec";
  $("#iCuota").value = b ? b.cuota : "";
  $("#iMonto").value = b ? b.monto : "";
  $("#iCash").value = b && b.cashout != null ? b.cashout : "";
  $("#iNotas").value = b ? b.notas || "" : "";
  $("#iSel").value = b ? b.seleccion || "" : "";
  setEstado(b ? b.estado : "pendiente");
  $("#betErr").textContent = "";
  updatePreview();
  openOv("#ovBet");
  if (!b) setTimeout(() => (getTipo() === "combinada" ? $("#legs .ev") : $("#iEvento")).focus(), 30);
}
$("#betForm").addEventListener("submit", async e => {
  e.preventDefault();
  const cuota = decOdds(), monto = +$("#iMonto").value, est = getEstado();
  const err = [];
  const tipo = getTipo();
  const legs = tipo === "combinada" ? readLegs().filter(l => l.evento || l.seleccion || l.cuota) : null;
  if (tipo === "simple") {
    if (!$("#iEvento").value.trim()) err.push("escribe el partido");
    if (!$("#iSel").value.trim()) err.push("escribe tu apuesta");
  } else {
    if (legs.length < 2) err.push("agrega al menos 2 selecciones");
    if (legs.some(l => !l.evento || !l.seleccion)) err.push("cada selección necesita partido y apuesta");
  }
  if (!(cuota > 1)) err.push("la cuota decimal debe ser mayor que 1 (en americana usa, por ejemplo, −110 o +150)");
  if (!(monto > 0)) err.push("el monto debe ser mayor que 0");
  if (!$("#iFecha").value) err.push("elige una fecha");
  if (est === "cashout" && !($("#iCash").value !== "" && +$("#iCash").value >= 0)) err.push("indica cuánto recibiste en el cash out");
  if (err.length) { $("#betErr").textContent = "Falta corregir: " + err.join("; ") + "."; return; }
  const prev = editingId ? bets.find(x => x.id === editingId) : null;
  const estado = est;
  const b = {
    id: editingId || store.newId(), kind: "bet",
    fecha: $("#iFecha").value, deporte: $("#iDeporte").value.trim(), casa: $("#iCasa").value.trim(),
    tipo, legs: legs || null,
    evento: legs ? `Combinada de ${legs.length} selecciones` : $("#iEvento").value.trim(),
    seleccion: legs ? legs.map(l => `${l.evento}: ${l.seleccion}${l.cuota ? " @" + l.cuota : ""}`).join(" | ") : $("#iSel").value.trim(),
    cuota: +cuota.toFixed(4), monto, estado, cashout: est === "cashout" ? +$("#iCash").value : null,
    notas: $("#iNotas").value.trim(), marcador: prev ? prev.marcador || null : null,
    creado: prev ? prev.creado || Date.now() : Date.now(),
  };
  $("#btnSave").disabled = true;
  try { await store.saveBet(b); lastCasa = b.casa; closeOv($("#ovBet")); toast(prev ? "Apuesta actualizada" : "Apuesta registrada"); }
  catch (x) { $("#betErr").textContent = writeErr(x); }
  finally { $("#btnSave").disabled = false; }
});
$("#btnDelInForm").addEventListener("click", () => { const id = editingId; closeOv($("#ovBet")); askDelete(id); });

let pendingDelete = null;
function askDelete(id) {
  const b = bets.find(x => x.id === id); if (!b) return;
  pendingDelete = id;
  $("#cfMsg").textContent = `Se eliminará “${b.evento}” del ${fmtDate(b.fecha)} (${money(+b.monto)}). No se puede deshacer.`;
  openOv("#ovConfirm");
}
$("#cfOk").addEventListener("click", async () => {
  const id = pendingDelete; closeOv($("#ovConfirm")); if (!id) return;
  try { await store.deleteBet(id); toast("Apuesta eliminada"); } catch (x) { toast(writeErr(x)); }
});
function writeErr(x) {
  const c = x && x.code;
  if (c === "permission-denied") return "Firebase rechazó el guardado. Revisa las reglas de Firestore (están en el README).";
  if (c === "unavailable") return "Sin conexión. Se guardará cuando vuelva el internet.";
  return "No se pudo guardar" + (x && x.message ? ": " + x.message : ". Intenta de nuevo.");
}

/* ---------- Ajustes ---------- */
function openCfg() {
  $("#cBank").value = config.bankroll; $("#cMon").value = config.moneda; $("#cUnit").value = config.unidad || "";
  openOv("#ovCfg");
}
$("#btnConfig").addEventListener("click", openCfg);
$("#cfgForm").addEventListener("submit", async e => {
  e.preventDefault();
  const c = { bankroll: Math.max(0, +$("#cBank").value || 0), moneda: $("#cMon").value, unidad: Math.max(0, +$("#cUnit").value || 0) };
  try { await store.saveConfig(c); config = { ...config, ...c }; closeOv($("#ovCfg")); render(); toast("Ajustes guardados"); } catch (x) { toast(writeErr(x)); }
});

/* Exportar / importar */
function download(name, text, type) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}
const HEAD = ["fecha", "deporte", "casa", "evento", "seleccion", "tipo", "cuota", "monto", "estado", "cashout", "marcador", "ganancia", "notas"];
$("#btnExportCsv").addEventListener("click", () => {
  const q = v => { const s = String(v ?? ""); return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const lines = [HEAD.join(",")].concat(bets.slice().sort(byDateAsc).map(b => [b.fecha, b.deporte, b.casa, b.evento, b.seleccion, b.tipo, b.cuota, b.monto, b.estado, b.cashout ?? "", b.marcador || "", pl(b).toFixed(2), b.notas].map(q).join(",")));
  download(`apuestas-${today()}.csv`, "﻿" + lines.join("\n"), "text/csv;charset=utf-8");
});
$("#btnExportJson").addEventListener("click", () => download(`respaldo-apuestas-${today()}.json`, JSON.stringify({ config, bets }, null, 2), "application/json"));
function parseCSV(t) {
  const rows = []; let row = [], f = "", q = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) { if (c === '"') { if (t[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true;
    else if (c === ",") { row.push(f); f = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && t[i + 1] === "\n") i++; row.push(f); rows.push(row); row = []; f = ""; }
    else f += c;
  }
  if (f !== "" || row.length) { row.push(f); rows.push(row); }
  return rows.filter(r => r.some(x => x.trim() !== ""));
}
$("#fileImport").addEventListener("change", async e => {
  const file = e.target.files[0]; e.target.value = ""; if (!file) return;
  try {
    const text = (await file.text()).replace(/^﻿/, "");
    let list = [], cfg = null;
    if (/\.json$/i.test(file.name) || text.trim().startsWith("{") || text.trim().startsWith("[")) {
      const o = JSON.parse(text); list = Array.isArray(o) ? o : o.bets || []; cfg = Array.isArray(o) ? null : o.config || null;
    } else {
      const rows = parseCSV(text), h = rows.shift().map(x => norm(x));
      const ix = k => h.indexOf(k);
      list = rows.map(r => {
        const g = k => (ix(k) >= 0 ? r[ix(k)] : "") || "";
        return { fecha: g("fecha"), deporte: g("deporte"), casa: g("casa"), evento: g("evento"), seleccion: g("seleccion"), tipo: g("tipo") || "simple",
          cuota: +g("cuota"), monto: +g("monto"), estado: g("estado") || "pendiente", cashout: g("cashout") === "" ? null : +g("cashout"),
          marcador: g("marcador") || null, notas: g("notas") };
      });
    }
    list = list.filter(b => b && b.evento && +b.cuota > 1 && +b.monto > 0);
    if (!list.length) { toast("El archivo no tiene apuestas válidas"); return; }
    const ids = new Set(bets.map(b => b.id));
    let n = 0;
    for (const b of list) {
      const id = b.id && !ids.has(b.id) ? b.id : store.newId();
      await store.saveBet({ kind: "bet", creado: Date.now() + n, ...b, id }); n++;
    }
    if (cfg) await store.saveConfig({ ...config, ...cfg });
    toast(`${n} apuestas importadas`);
    closeOv($("#ovCfg"));
  } catch (x) { toast("No se pudo leer el archivo: " + (x.message || x)); }
});

/* ---------- Acciones generales ---------- */
document.addEventListener("click", async e => {
  const t = e.target.closest("[data-act]"); if (!t) return;
  const act = t.dataset.act, id = t.dataset.id;
  if (act === "new") openBet(null);
  else if (act === "cfg") openCfg();
  else if (act === "edit") openBet(id);
  else if (act === "more") { showN += 25; renderHist(bets); }
  else if (act === "win" || act === "lose") {
    const b = bets.find(x => x.id === id); if (!b) return;
    t.disabled = true;
    try { await store.saveBet({ ...b, estado: act === "win" ? "ganada" : "perdida" }); toast(act === "win" ? `Ganada: ${money(b.monto * (b.cuota - 1), true)}` : `Perdida: ${money(-b.monto, true)}`); }
    catch (x) { toast(writeErr(x)); t.disabled = false; }
  }
});
$$(".seg button").forEach(b => b.addEventListener("click", () => { period = b.dataset.period; $$(".seg button").forEach(x => x.setAttribute("aria-pressed", String(x === b))); showN = 25; render(); }));
["#fSearch", "#fEstado", "#fDeporte"].forEach(s => $(s).addEventListener("input", () => { showN = 25; renderHist(bets); }));
$("#btnNew").addEventListener("click", () => openBet(null));

let tT = null;
function toast(msg) { const t = $("#toast"); t.textContent = msg; t.classList.add("show"); clearTimeout(tT); tT = setTimeout(() => t.classList.remove("show"), 3200); }

render();
initStore();
})();
