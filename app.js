(() => {
"use strict";
const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const { pl, settle } = window.Settle;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const clean = o => JSON.parse(JSON.stringify(o)); // Firestore no acepta undefined

/* ---------- Ligas de ESPN ---------- */
const LEAGUES = [
  { k: "eng.1", sport: "soccer", name: "Premier League", dep: "Fútbol", on: true },
  { k: "esp.1", sport: "soccer", name: "LaLiga", dep: "Fútbol", on: true },
  { k: "ita.1", sport: "soccer", name: "Serie A", dep: "Fútbol", on: true },
  { k: "ger.1", sport: "soccer", name: "Bundesliga", dep: "Fútbol", on: true },
  { k: "fra.1", sport: "soccer", name: "Ligue 1", dep: "Fútbol", on: true },
  { k: "uefa.champions", sport: "soccer", name: "Champions League", dep: "Fútbol", on: true },
  { k: "uefa.europa", sport: "soccer", name: "Europa League", dep: "Fútbol", on: true },
  { k: "mex.1", sport: "soccer", name: "Liga MX", dep: "Fútbol", on: true },
  { k: "usa.1", sport: "soccer", name: "MLS", dep: "Fútbol", on: false },
  { k: "por.1", sport: "soccer", name: "Liga Portugal", dep: "Fútbol", on: false },
  { k: "ned.1", sport: "soccer", name: "Eredivisie", dep: "Fútbol", on: false },
  { k: "conmebol.libertadores", sport: "soccer", name: "Libertadores", dep: "Fútbol", on: false },
  { k: "concacaf.champions", sport: "soccer", name: "Concachampions", dep: "Fútbol", on: false },
  { k: "nba", sport: "basketball", name: "NBA", dep: "Básquet", on: true },
  { k: "nfl", sport: "football", name: "NFL", dep: "Fútbol americano", on: true },
  { k: "mlb", sport: "baseball", name: "MLB", dep: "Béisbol", on: true },
  { k: "nhl", sport: "hockey", name: "NHL", dep: "Hockey", on: false },
  { k: "college-football", sport: "football", name: "NCAA Football", dep: "Fútbol americano", on: false },
];
const leagueBy = k => LEAGUES.find(l => l.k === k);
const ESPN = "https://site.api.espn.com/apis/site/v2/sports";

/* ---------- Estado ---------- */
let bets = [];
let config = { bankroll: 1000, moneda: "Q", unidad: 0, ligas: LEAGUES.filter(l => l.on).map(l => l.k), auto: true };
let period = "todo", showN = 25, editingId = null, store = null, linked = null;
const live = {}; // id de apuesta → {detail, h, a}

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
  scheduleCheck();
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
const ymd = d => localISO(d).replace(/-/g, "");
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
const fmtWhen = iso => { try { return new Date(iso).toLocaleString("es-GT", { weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }); } catch { return iso; } };
const estadoTxt = { pendiente: "Pendiente", ganada: "Ganada", perdida: "Perdida", nula: "Nula", cashout: "Cash out", medio_ganada: "Medio ganada", medio_perdida: "Medio perdida" };
const mercadoTxt = { ganador: "Ganador", doble: "Doble oportunidad", total: "Más / menos", handicap: "Hándicap", btts: "Ambos anotan", otro: "Otro" };
const isWinState = s => s === "ganada" || s === "medio_ganada";
const isLossState = s => s === "perdida" || s === "medio_perdida";

/* ---------- ESPN ---------- */
const cache = new Map();
async function getJSON(url, ttl = 600000) {
  const c = cache.get(url);
  if (c && Date.now() - c.t < ttl) return c.v;
  const r = await fetch(url);
  if (!r.ok) throw new Error("ESPN respondió " + r.status);
  const v = await r.json();
  cache.set(url, { t: Date.now(), v });
  return v;
}
function parseComp(comp, L, fallback) {
  const cs = (comp && comp.competitors) || [];
  const H = cs.find(c => c.homeAway === "home") || cs[0], A = cs.find(c => c.homeAway === "away") || cs[1];
  if (!H || !A) return null;
  const team = c => { const t = c.team || {}; return { name: t.displayName || t.name || "", short: t.shortDisplayName || t.name || "", abbr: t.abbreviation || "", loc: t.location || "", logo: t.logo || (t.logos && t.logos[0] && t.logos[0].href) || "", score: c.score && typeof c.score === "object" ? c.score.displayValue : c.score }; };
  const st = ((comp && comp.status) || (fallback && fallback.status) || {}).type || {};
  return { id: String((fallback && fallback.id) || comp.id), sport: L.sport, league: L.k, leagueName: L.name, dep: L.dep,
    date: (comp && comp.date) || (fallback && fallback.date), home: team(H), away: team(A),
    state: st.state, completed: !!st.completed, detail: st.shortDetail || st.detail || st.description || "" };
}
async function searchMatches(q) {
  const nq = norm(q);
  const from = new Date(); from.setDate(from.getDate() - 3);
  const to = new Date(); to.setDate(to.getDate() + 10);
  const range = ymd(from) + "-" + ymd(to);
  const ligas = (config.ligas && config.ligas.length ? config.ligas : LEAGUES.filter(l => l.on).map(l => l.k)).map(leagueBy).filter(Boolean);
  let fails = 0;
  const all = await Promise.all(ligas.map(async L => {
    try {
      const d = await getJSON(`${ESPN}/${L.sport}/${L.k}/scoreboard?dates=${range}&limit=400`);
      return (d.events || []).map(ev => parseComp(ev.competitions && ev.competitions[0], L, ev)).filter(Boolean);
    } catch { fails++; return []; }
  }));
  const hits = all.flat().filter(m => [m.home, m.away].some(t => [t.name, t.short, t.abbr, t.loc].some(x => norm(x).includes(nq))));
  hits.sort((a, b) => {
    const now = Date.now(), da = Math.abs(new Date(a.date) - now), db = Math.abs(new Date(b.date) - now);
    const pa = a.state === "pre" || a.state === "in" ? 0 : 1, pb = b.state === "pre" || b.state === "in" ? 0 : 1;
    return pa - pb || da - db;
  });
  return { hits: hits.slice(0, 25), failed: fails === ligas.length && ligas.length > 0 };
}
async function fetchResult(espn) {
  const L = leagueBy(espn.league) || { k: espn.league, sport: espn.sport, name: espn.leagueName || "", dep: "" };
  const d = await getJSON(`${ESPN}/${espn.sport}/${espn.league}/summary?event=${espn.id}`, 60000);
  const comp = d && d.header && d.header.competitions && d.header.competitions[0];
  return comp ? parseComp(comp, L, { id: espn.id, date: comp.date }) : null;
}

/* ---------- Cierre automático ---------- */
let checking = false, checkTimer = null;
function scheduleCheck() {
  if (checkTimer) return;
  checkTimer = setTimeout(async function loop() { await checkResults(false); checkTimer = setTimeout(loop, 180000); }, 1500);
}
async function checkResults(manual) {
  if (checking || !store) return;
  if (!config.auto && !manual) return;
  checking = true;
  const btn = $("#btnCheck"); btn.disabled = true; btn.textContent = "Revisando…";
  const now = Date.now();
  const todo = bets.filter(b => b.estado === "pendiente" && b.espn && b.espn.id && (!b.espn.date || new Date(b.espn.date).getTime() <= now + 60000));
  let closed = 0, errors = 0;
  for (const b of todo) {
    try {
      const m = await fetchResult(b.espn);
      if (!m) continue;
      const h = parseFloat(m.home.score), a = parseFloat(m.away.score);
      if (m.completed && isFinite(h) && isFinite(a)) {
        delete live[b.id];
        const res = b.mercado && b.mercado !== "otro" && b.tipo !== "combinada" ? settle(b.mercado, b.pick, b.linea, h, a) : null;
        const upd = { ...b, marcador: `${h}-${a}` };
        if (res) { upd.estado = res; upd.auto = true; closed++; }
        if (res || b.marcador !== upd.marcador) await store.saveBet(upd);
      } else if (m.state === "in") {
        live[b.id] = { detail: m.detail, h: m.home.score, a: m.away.score };
      } else if (m.state === "post") {
        live[b.id] = { detail: m.detail || "Finalizado", h: m.home.score, a: m.away.score };
      }
      await sleep(250);
    } catch { errors++; }
  }
  checking = false;
  btn.disabled = false; btn.textContent = "Revisar resultados";
  if (closed) toast(`${closed} apuesta${closed > 1 ? "s" : ""} cerrada${closed > 1 ? "s" : ""} con el resultado final`);
  else if (manual) toast(errors ? "No se pudo conectar con ESPN. Intenta en un momento." : todo.length ? "Todavía no hay resultados finales nuevos" : "No hay apuestas pendientes vinculadas a un partido");
  renderHist(bets);
}

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
  $("#byMercado").innerHTML = breakdown(list, b => mercadoTxt[b.mercado] || "Otro", "Mercado");

  const dep = uniq(all.map(b => b.deporte)), fd = $("#fDeporte"), cur = fd.value;
  fd.innerHTML = '<option value="">Todos los deportes</option>' + dep.map(d => `<option${d === cur ? " selected" : ""}>${esc(d)}</option>`).join("");
  $("#dlDeporte").innerHTML = uniq(dep.concat(["Fútbol", "Básquet", "Tenis", "Béisbol", "Fútbol americano", "Hockey", "MMA / UFC", "eSports"])).map(d => `<option value="${esc(d)}">`).join("");
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
    box.innerHTML = `<div class="empty"><p>Aún no tienes apuestas. Pon tu bankroll en Ajustes y registra la primera: escribe un equipo en el buscador y elige el partido. Si ya tenías apuestas en la versión de Claude, impórtalas desde Ajustes.</p>
      <div class="actions" style="justify-content:center"><button class="btn primary" type="button" data-act="new">+ Registrar primera apuesta</button><button class="btn" type="button" data-act="cfg">Ajustes</button></div></div>`;
    return;
  }
  if (!rows.length) { box.innerHTML = '<div class="empty"><p>Ninguna apuesta coincide con los filtros o el periodo elegido.</p></div>'; return; }
  box.innerHTML = `<table class="hist"><thead><tr><th>Fecha</th><th>Evento</th><th>Deporte</th><th>Casa</th><th class="r">Cuota</th><th class="r">Monto</th><th>Estado</th><th class="r">G/P</th><th class="r">Acciones</th></tr></thead><tbody>` +
    rows.slice(0, showN).map(b => {
      const v = pl(b), L = live[b.id];
      const sub = [b.seleccion, b.tipo && b.tipo !== "simple" ? b.tipo : ""].filter(Boolean).join(" · ");
      const extra = b.estado === "pendiente" && L ? `<span class="live">${esc(L.detail)} · ${esc(L.h)}-${esc(L.a)}</span>` : (b.marcador ? `<span>Marcador ${esc(b.marcador)}</span>` : (b.estado === "pendiente" && b.espn && b.espn.date ? `<span>${esc(fmtWhen(b.espn.date))}</span>` : ""));
      const quick = b.estado === "pendiente" ? `<button class="btn sm" type="button" data-act="win" data-id="${esc(b.id)}">Ganó</button><button class="btn sm" type="button" data-act="lose" data-id="${esc(b.id)}">Perdió</button>` : "";
      return `<tr><td class="num">${fmtDate(b.fecha)}</td>
        <td class="ev"><b>${esc(b.evento)}${b.auto ? '<span class="tag auto">auto</span>' : ""}${b.espn && b.estado === "pendiente" ? '<span class="tag auto">ESPN</span>' : ""}</b><span>${esc(sub)}</span>${extra ? "<br>" + extra : ""}</td>
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

/* Mercados */
function pickOptions() {
  const m = $("#iMercado").value, soccer = linked ? linked.sport === "soccer" : /f[uú]tbol$/i.test($("#iDeporte").value.trim()) || !$("#iDeporte").value.trim();
  const H = linked ? linked.home.short || linked.home.name : "Local", A = linked ? linked.away.short || linked.away.name : "Visitante";
  const opts = {
    ganador: [["home", H + " gana"]].concat(soccer ? [["draw", "Empate"]] : []).concat([["away", A + " gana"]]),
    doble: [["1X", H + " o empate"], ["X2", A + " o empate"], ["12", H + " o " + A]],
    total: [["over", "Más de"], ["under", "Menos de"]],
    handicap: [["home", H], ["away", A]],
    btts: [["si", "Sí, ambos anotan"], ["no", "No"]],
    otro: [],
  }[m];
  const cur = $("#iPick").value;
  $("#iPick").innerHTML = opts.map(([v, t]) => `<option value="${v}">${esc(t)}</option>`).join("");
  if (opts.some(o => o[0] === cur)) $("#iPick").value = cur;
  $("#pickBox").hidden = m === "otro";
  $("#lineBox").hidden = !(m === "total" || m === "handicap");
  $("#iLinea").placeholder = m === "handicap" ? "−1.5" : "2.5";
}
function autoSelText() {
  const m = $("#iMercado").value; if (m === "otro") return;
  const p = $("#iPick").selectedOptions[0], l = $("#iLinea").value;
  let t = p ? p.textContent : "";
  if (m === "total" && l !== "") t = `${t} ${l}`;
  if (m === "handicap" && l !== "") t = `${t} ${+l > 0 ? "+" : ""}${l}`;
  if (m === "btts") t = "Ambos anotan: " + ($("#iPick").value === "si" ? "Sí" : "No");
  $("#iSel").value = t;
}
$("#iMercado").addEventListener("change", () => { pickOptions(); autoSelText(); updatePreview(); });
$("#iPick").addEventListener("change", () => { autoSelText(); updatePreview(); });
$("#iLinea").addEventListener("input", () => { autoSelText(); updatePreview(); });
$("#iTipo").addEventListener("change", updatePreview);

/* Buscador */
let qTimer = null, qSeq = 0;
$("#qMatch").addEventListener("input", () => {
  clearTimeout(qTimer);
  const q = $("#qMatch").value.trim();
  if (q.length < 3) { $("#results").innerHTML = ""; return; }
  $("#results").innerHTML = '<div class="res-msg">Buscando en ESPN…</div>';
  qTimer = setTimeout(async () => {
    const my = ++qSeq;
    try {
      const { hits, failed } = await searchMatches(q);
      if (my !== qSeq) return;
      if (failed) { $("#results").innerHTML = '<div class="res-msg">No se pudo conectar con ESPN. Revisa tu internet o llena el partido a mano.</div>'; return; }
      if (!hits.length) { $("#results").innerHTML = `<div class="res-msg">No encontré partidos de “${esc(q)}” en las ligas activas. Prueba otro nombre (en inglés a veces funciona mejor: “Bayern”, “Inter”), activa más ligas en Ajustes o llénalo a mano.</div>`; return; }
      window.__hits = hits;
      $("#results").innerHTML = hits.map((m, i) => {
        const st = m.state === "in" ? `<span class="st in">En vivo · ${esc(m.home.score)}-${esc(m.away.score)}</span>` : m.state === "post" ? `<span class="st">Final · ${esc(m.home.score)}-${esc(m.away.score)}</span>` : `<span class="st">${esc(fmtWhen(m.date))}</span>`;
        return `<button type="button" class="res" role="option" data-hit="${i}"><span class="teams">${logo(m.home)}${esc(m.home.name)} <span style="color:var(--muted)">vs</span> ${logo(m.away)}${esc(m.away.name)}</span>${st}<span class="meta">${esc(m.leagueName)}</span></button>`;
      }).join("");
    } catch { if (my === qSeq) $("#results").innerHTML = '<div class="res-msg">No se pudo conectar con ESPN.</div>'; }
  }, 450);
});
const logo = t => t.logo ? `<img src="${esc(t.logo)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : "";
$("#results").addEventListener("click", e => {
  const b = e.target.closest("[data-hit]"); if (!b) return;
  const m = window.__hits[+b.dataset.hit]; if (!m) return;
  linkMatch({ id: m.id, sport: m.sport, league: m.league, leagueName: m.leagueName, date: m.date, home: { name: m.home.name, short: m.home.short, logo: m.home.logo }, away: { name: m.away.name, short: m.away.short, logo: m.away.logo } });
  $("#iEvento").value = `${m.home.name} vs ${m.away.name}`;
  $("#iDeporte").value = m.dep;
  $("#iFecha").value = localISO(m.date);
  $("#results").innerHTML = ""; $("#qMatch").value = "";
  pickOptions(); autoSelText(); updatePreview();
  $("#iCuota").focus();
});
function linkMatch(m) {
  linked = m;
  const card = $("#matchCard");
  if (!m) { card.hidden = true; $("#searchBox").hidden = false; return; }
  card.innerHTML = `<div class="mt"><b>${logo(m.home)}${esc(m.home.name)} <span style="color:var(--muted)">vs</span> ${logo(m.away)}${esc(m.away.name)}</b><span>${esc(m.leagueName || "")} · ${esc(fmtWhen(m.date))} · se cierra sola al terminar</span></div><button class="btn sm" type="button" id="btnUnlink">Cambiar partido</button>`;
  card.hidden = false; $("#searchBox").hidden = true;
  $("#btnUnlink").addEventListener("click", () => { linkMatch(null); pickOptions(); $("#qMatch").focus(); });
}

function getEstado() { return (document.querySelector('input[name="estado"]:checked') || {}).value || "pendiente"; }
function setEstado(v) { if (v === "medio_ganada" || v === "medio_perdida") v = v.replace("medio_", ""); const r = document.querySelector(`input[name="estado"][value="${v}"]`); if (r) r.checked = true; $("#cashBox").hidden = v !== "cashout"; }
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
  const mer = $("#iMercado").value;
  if (linked && (mer === "otro" || $("#iTipo").value === "combinada")) parts.push("Este mercado se marca a mano; el marcador sí se guarda solo.");
  $("#preview").innerHTML = parts.join("");
}
["#iCuota", "#iMonto", "#iFormato"].forEach(s => $(s).addEventListener("input", updatePreview));
$("#iEstado").addEventListener("change", updatePreview);

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
  $("#iTipo").value = b ? b.tipo || "simple" : "simple";
  $("#iFormato").value = "dec";
  $("#iCuota").value = b ? b.cuota : "";
  $("#iMonto").value = b ? b.monto : "";
  $("#iCash").value = b && b.cashout != null ? b.cashout : "";
  $("#iNotas").value = b ? b.notas || "" : "";
  $("#qMatch").value = ""; $("#results").innerHTML = "";
  linkMatch(b && b.espn ? b.espn : null);
  $("#iMercado").value = b ? b.mercado || "otro" : "ganador";
  pickOptions();
  if (b && b.pick) $("#iPick").value = b.pick;
  $("#iLinea").value = b && b.linea != null ? b.linea : "";
  $("#iSel").value = b ? b.seleccion || "" : "";
  if (!b) autoSelText();
  setEstado(b ? b.estado : "pendiente");
  $("#betErr").textContent = "";
  updatePreview();
  openOv("#ovBet");
  if (!b) setTimeout(() => $("#qMatch").focus(), 30);
}
$("#betForm").addEventListener("submit", async e => {
  e.preventDefault();
  const cuota = decOdds(), monto = +$("#iMonto").value, est = getEstado(), mer = $("#iMercado").value;
  const err = [];
  if (!$("#iEvento").value.trim()) err.push("escribe el evento o búscalo arriba");
  if (!(cuota > 1)) err.push("la cuota decimal debe ser mayor que 1 (en americana usa, por ejemplo, −110 o +150)");
  if (!(monto > 0)) err.push("el monto debe ser mayor que 0");
  if (!$("#iFecha").value) err.push("elige una fecha");
  if ((mer === "total" || mer === "handicap") && $("#iLinea").value === "") err.push("pon la línea del mercado");
  if (est === "cashout" && !($("#iCash").value !== "" && +$("#iCash").value >= 0)) err.push("indica cuánto recibiste en el cash out");
  if (err.length) { $("#betErr").textContent = "Falta corregir: " + err.join("; ") + "."; return; }
  const prev = editingId ? bets.find(x => x.id === editingId) : null;
  let estado = est;
  if (prev && (prev.estado === "medio_ganada" || prev.estado === "medio_perdida") && prev.estado.replace("medio_", "") === est) estado = prev.estado;
  const b = {
    id: editingId || store.newId(), kind: "bet",
    fecha: $("#iFecha").value, deporte: $("#iDeporte").value.trim(), casa: $("#iCasa").value.trim(),
    evento: $("#iEvento").value.trim(), seleccion: $("#iSel").value.trim(), tipo: $("#iTipo").value,
    mercado: mer, pick: mer === "otro" ? null : $("#iPick").value, linea: (mer === "total" || mer === "handicap") ? +$("#iLinea").value : null,
    cuota: +cuota.toFixed(4), monto, estado, cashout: est === "cashout" ? +$("#iCash").value : null,
    notas: $("#iNotas").value.trim(), espn: linked || null,
    marcador: prev ? prev.marcador || null : null, auto: prev && prev.estado === estado ? !!prev.auto : false,
    creado: prev ? prev.creado || Date.now() : Date.now(),
  };
  $("#btnSave").disabled = true;
  try { await store.saveBet(b); lastCasa = b.casa; closeOv($("#ovBet")); toast(prev ? "Apuesta actualizada" : "Apuesta registrada"); if (b.espn && b.estado === "pendiente") checkResults(false); }
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
  $("#cBank").value = config.bankroll; $("#cMon").value = config.moneda; $("#cUnit").value = config.unidad || ""; $("#cAuto").checked = config.auto !== false;
  const on = new Set(config.ligas || []);
  $("#leagueChips").innerHTML = LEAGUES.map(l => `<label class="chip"><input type="checkbox" value="${l.k}"${on.has(l.k) ? " checked" : ""}> ${esc(l.name)}</label>`).join("");
  openOv("#ovCfg");
}
$("#btnConfig").addEventListener("click", openCfg);
$("#cfgForm").addEventListener("submit", async e => {
  e.preventDefault();
  const c = { bankroll: Math.max(0, +$("#cBank").value || 0), moneda: $("#cMon").value, unidad: Math.max(0, +$("#cUnit").value || 0),
    auto: $("#cAuto").checked, ligas: $$("#leagueChips input:checked").map(i => i.value) };
  try { await store.saveConfig(c); config = { ...config, ...c }; closeOv($("#ovCfg")); render(); toast("Ajustes guardados"); } catch (x) { toast(writeErr(x)); }
});

/* Exportar / importar */
function download(name, text, type) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}
const HEAD = ["fecha", "deporte", "casa", "evento", "seleccion", "tipo", "mercado", "cuota", "monto", "estado", "cashout", "marcador", "ganancia", "notas"];
$("#btnExportCsv").addEventListener("click", () => {
  const q = v => { const s = String(v ?? ""); return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const lines = [HEAD.join(",")].concat(bets.slice().sort(byDateAsc).map(b => [b.fecha, b.deporte, b.casa, b.evento, b.seleccion, b.tipo, b.mercado, b.cuota, b.monto, b.estado, b.cashout ?? "", b.marcador || "", pl(b).toFixed(2), b.notas].map(q).join(",")));
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
          mercado: g("mercado") || "otro", cuota: +g("cuota"), monto: +g("monto"), estado: g("estado") || "pendiente", cashout: g("cashout") === "" ? null : +g("cashout"),
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
    try { await store.saveBet({ ...b, estado: act === "win" ? "ganada" : "perdida", auto: false }); toast(act === "win" ? `Ganada: ${money(b.monto * (b.cuota - 1), true)}` : `Perdida: ${money(-b.monto, true)}`); }
    catch (x) { toast(writeErr(x)); t.disabled = false; }
  }
});
$$(".seg button").forEach(b => b.addEventListener("click", () => { period = b.dataset.period; $$(".seg button").forEach(x => x.setAttribute("aria-pressed", String(x === b))); showN = 25; render(); }));
["#fSearch", "#fEstado", "#fDeporte"].forEach(s => $(s).addEventListener("input", () => { showN = 25; renderHist(bets); }));
$("#btnNew").addEventListener("click", () => openBet(null));
$("#btnCheck").addEventListener("click", () => checkResults(true));
document.addEventListener("visibilitychange", () => { if (!document.hidden) checkResults(false); });

let tT = null;
function toast(msg) { const t = $("#toast"); t.textContent = msg; t.classList.add("show"); clearTimeout(tT); tT = setTimeout(() => t.classList.remove("show"), 3200); }

render();
initStore();
})();
