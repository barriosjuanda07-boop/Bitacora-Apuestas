// Lógica pura: ganancia/pérdida y liquidación de mercados a partir del marcador.
// Se usa en el navegador (window.Settle) y en pruebas con Node (module.exports).
(function (root) {
  "use strict";

  function pl(b) {
    const m = +b.monto || 0, c = +b.cuota || 0;
    switch (b.estado) {
      case "ganada": return m * (c - 1);
      case "medio_ganada": return (m / 2) * (c - 1);
      case "perdida": return -m;
      case "medio_perdida": return -m / 2;
      case "cashout": return (+b.cashout || 0) - m;
      default: return 0; // pendiente, nula
    }
  }

  // Divide líneas asiáticas de cuarto (2.25 → 2 y 2.5).
  function splitLine(l) {
    l = +l;
    const q = Math.round(l * 4);
    if (Math.abs(q) % 2 === 1) return [(q - 1) / 4, (q + 1) / 4];
    return [l];
  }
  const cmp = x => (x > 1e-9 ? "w" : x < -1e-9 ? "l" : "p");

  function combine(parts) {
    const w = parts.filter(p => p === "w").length, l = parts.filter(p => p === "l").length, n = parts.length;
    if (w === n) return "ganada";
    if (l === n) return "perdida";
    if (w === 0 && l === 0) return "nula";
    if (l === 0) return "medio_ganada";
    if (w === 0) return "medio_perdida";
    return "nula";
  }

  // h, a = goles/puntos de local y visitante. Devuelve el estado o null si el mercado no se puede liquidar.
  function settle(mercado, pick, linea, h, a) {
    h = +h; a = +a;
    if (!isFinite(h) || !isFinite(a)) return null;
    switch (mercado) {
      case "ganador": {
        const r = h > a ? "home" : h < a ? "away" : "draw";
        return r === pick ? "ganada" : "perdida";
      }
      case "doble": {
        const ok = pick === "1X" ? h >= a : pick === "X2" ? a >= h : pick === "12" ? h !== a : null;
        return ok === null ? null : ok ? "ganada" : "perdida";
      }
      case "total": {
        if (linea === "" || linea == null || !isFinite(+linea)) return null;
        const t = h + a;
        return combine(splitLine(linea).map(l => cmp(pick === "over" ? t - l : l - t)));
      }
      case "handicap": {
        if (linea === "" || linea == null || !isFinite(+linea)) return null;
        const diff = pick === "home" ? h - a : a - h;
        return combine(splitLine(linea).map(l => cmp(diff + l)));
      }
      case "btts": {
        const both = h > 0 && a > 0;
        return (pick === "si") === both ? "ganada" : "perdida";
      }
      default: return null;
    }
  }

  const api = { pl, settle, splitLine };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Settle = api;
})(this);
