JavaScript

/*
 CRYPTOLEXUZ PRO — TRADE PLANS V5 COMPLETO
 Estructura 5m/15m, ruptura, retesteo y volumen.
 Auditoría con velas de 1m cerradas y datos reales.
 No ejecuta operaciones.
*/
"use strict";
(() => {
  if (window.__CL_TRADE_PLANS_V5__) return;
  window.__CL_TRADE_PLANS_V5__ = true;
  const $ = id => document.getElementById(id);
  const GOLD = "NCCOGOLD2USD-USDT", OIL = "NCCO1OILWTI2USD-USDT";
  const KEY = "cryptolexuz.trade-audit.v4"; // Conserva el historial V4.
  const MAX_LOG = 250, WAIT = 480, TRACK = 7200, CANDLE = 60;
  const FINAL = new Set(["NO ACTIVADA", "INVALIDADA", "STOP ANTES DE TP1", "TP2 ALCANZADO", "TP1 Y STOP", "SIN VERIFICAR", "SECUENCIA AMBIGUA", "SEGUIMIENTO FINALIZADO"]);
  const cache = new Map(), precisionCache = new Map();
  let history = [], storageAvailable = true, busy = false, rerun = false;
  let recheckTimer = null, observer = null, intervalTimer = null, contractsPromise = null, contractsAt = 0, initialized = false;
  const now = () => Math.floor(Date.now() / 1000);
  const n = v => v == null || v === "" ? NaN : Number(v);
  const marketId = x => [x.exchange, x.market, x.symbol].join("|");
  const isFinal = p => FINAL.has(p.status);
  const fmt = (v, digits = 2) => Number.isFinite(Number(v)) ? Number(v).toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits }) : "—";
  const node = (tag, cls = "", value) => { const e = document.createElement(tag); if (cls) e.className = cls; if (value !== undefined) e.textContent = String(value); return e; };
  function validRecord(p) {
    return p && typeof p.id === "string" && typeof p.symbol === "string" && ["LONG", "SHORT"].includes(p.side) && Number.isFinite(p.createdAt) && [p.entry, p.stop, p.tp1, p.tp2].every(Number.isFinite);
  }
  function load() {
    try {
      const parsed = JSON.parse(localStorage.getItem(KEY) || "[]");
      history = Array.isArray(parsed) ? parsed.filter(validRecord).slice(0, MAX_LOG) : [];
      for (const p of history) {
        p.lastChecked = Number.isFinite(p.lastChecked) ? p.lastChecked : p.createdTime;
        p.tp1Hit = Boolean(p.tp1Hit); p.tp2Hit = Boolean(p.tp2Hit);
        p.stopBeforeTP1 = Boolean(p.stopBeforeTP1);
        p.activatedAt = p.activatedAt ?? null;
      }
    } catch (e) { history = []; storageAvailable = false; console.warn("Trade Plans: historial", e); }
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(history.slice(0, MAX_LOG))); storageAvailable = true; }
    catch (e) { storageAvailable = false; console.warn("Trade Plans: guardado", e); }
  }
  function norm(raw) {
    let arr = Array.isArray(raw) ? raw : raw?.data?.data ?? raw?.data?.list ?? raw?.data?.candles ?? raw?.data ?? raw?.list ?? [];
    if (!Array.isArray(arr)) return [];
    const out = [];
    for (const c of arr) {
      if (!c || typeof c !== "object") continue;
      const a = Array.isArray(c);
      let t = a ? c[0] : c.time ?? c.timestamp ?? c.openTime ?? c.t;
      t = typeof t === "string" && !/^\d+$/.test(t) ? Date.parse(t) : Number(t);
      t = t > 1e12 ? Math.floor(t / 1000) : Math.floor(t);
      const open = n(a ? c[1] : c.open ?? c.o), high = n(a ? c[2] : c.high ?? c.h);
      const low = n(a ? c[3] : c.low ?? c.l), close = n(a ? c[4] : c.close ?? c.c);
      const volume = n(a ? c[5] : c.volume ?? c.vol ?? c.v ?? 0);
      if (![t, open, high, low, close, volume].every(Number.isFinite) || t <= 0 || t > now() + 60 || Math.min(open, high, low, close) <= 0 || volume < 0 || high < Math.max(open, close, low) || low > Math.min(open, close, high)) continue;
      out.push({ time: t, open, high, low, close, volume });
    }
    out.sort((a, b) => a.time - b.time);
    return [...new Map(out.map(c => [c.time, c])).values()];
  }
  function closedCandles(arr, tf) {
    const seconds = ({ "1m": 60, "5m": 300, "15m": 900 })[tf];
    return arr.filter(c => c.time + seconds <= now());
  }
  async function json(url, timeout = 11000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const response = await fetch(url, { cache: "no-store", signal: controller.signal });
      if (!response.ok) throw Error("HTTP " + response.status);
      const data = await response.json();
      if (data?.code !== undefined && ![0, "0", "00000"].includes(data.code)) throw Error(String(data.msg || data.message || "API no disponible"));
      return data;
    } finally { clearTimeout(timer); }
  }
  async function candles(x, tf) {
    const key = marketId(x) + "|" + tf, ttl = tf === "1m" ? 20000 : 60000;
    const cached = cache.get(key);
    if (cached && Date.now() - cached.at < ttl) return cached.data;
    const url = "/api/exchange/" + encodeURIComponent(x.exchange) + "/klines/" + encodeURIComponent(x.symbol) + "?market=" + encodeURIComponent(x.market) + "&interval=" + encodeURIComponent(tf) + "&limit=300";
    const data = norm(await json(url));
    if (data.length < (tf === "1m" ? 2 : 65)) throw Error("Faltan velas de " + tf);
    cache.set(key, { at: Date.now(), data });
    return data;
  }
  function scanSignals() {
    const body = $("clScanBody"); if (!body) return [];
    const exchange = ($("exchange")?.value || "bingx").toLowerCase(), market = $("market")?.value || "perpetual";
    const results = [];
    for (const row of body.querySelectorAll(":scope > tr")) {
      if (row.dataset.tradeplanRow) continue;
      const cells = [...row.children];
      if (cells.length < 6 || !/^\d+$/.test(cells[0].textContent.trim())) continue;
      const label = cells[1].textContent.trim(), isGold = label.includes("GOLD"), isOil = label.includes("OIL WTI"), special = isGold || isOil;
      results.push({ label, side: cells[2].textContent.trim().toUpperCase(), score: Number(cells[3].textContent.split("/")[0]), state: cells[4].textContent.trim().toUpperCase(), exchange: special ? "bingx" : exchange, market: special ? "perpetual" : market, symbol: isGold ? GOLD : isOil ? OIL : label.replace("/", "-") });
    }
    return results;
  }
  function ema(values, length) {
    if (values.length < length) return NaN;
    let v = values.slice(0, length).reduce((a, b) => a + b, 0) / length;
    for (let i = length; i < values.length; i++) v += (values[i] - v) * 2 / (length + 1);
    return v;
  }
  function ma(values, length) { return values.length < length ? NaN : values.slice(-length).reduce((a, b) => a + b, 0) / length; }
  function atr(c, period = 14) {
    if (c.length < period + 2) return NaN;
    const ranges = [];
    for (let i = 1; i < c.length; i++) ranges.push(Math.max(c[i].high - c[i].low, Math.abs(c[i].high - c[i - 1].close), Math.abs(c[i].low - c[i - 1].close)));
    return ma(ranges, period);
  }
  function tickGuess(c) {
    let decimals = 2;
    for (const bar of c.slice(-40)) for (const p of [bar.open, bar.high, bar.low, bar.close]) {
      const str = Number(p).toFixed(8).replace(/0+$/, "");
      decimals = Math.max(decimals, (str.split(".")[1] || "").length);
    }
    decimals = Math.min(8, decimals);
    return { tick: 10 ** -decimals, decimals, verified: false };
  }
  function bingxContracts() {
    if (!contractsPromise || Date.now() - contractsAt > 900000) {
      contractsAt = Date.now();
      contractsPromise = json("https://open-api.bingx.com/openApi/swap/v2/quote/contracts", 7000).catch(() => ({ data: [] }));
    }
    return contractsPromise;
  }
  async function rule(x, c) {
    const key = marketId(x), old = precisionCache.get(key);
    if (old && Date.now() - old.at < 900000) return old.rule;
    let result = tickGuess(c);
    try {
      if (x.exchange === "bingx" && x.market === "perpetual") {
        const raw = await bingxContracts();
        const list = Array.isArray(raw.data) ? raw.data : [];
        const contract = list.find(z => z.symbol === x.symbol);
        const tick = Number(contract?.tickSize ?? contract?.priceStep);
        const precision = Number(contract?.pricePrecision);
        if (contract && Number.isFinite(tick) && tick > 0) {
          const txt = String(tick);
          const decimals = txt.includes("e-") ? Number(txt.split("e-")[1]) : (txt.split(".")[1] || "").length;
          result = { tick, decimals: Math.min(10, decimals), verified: true };
        } else if (contract && Number.isInteger(precision) && precision >= 0 && precision <= 10) {
          result = { tick: 10 ** -precision, decimals: precision, verified: false };
        }
      }
    } catch (e) { console.warn("Trade Plans: precisión estimada", e); }
    precisionCache.set(key, { at: Date.now(), rule: result });
    return result;
  }
  function round(value, rule, method = "round") {
    const units = value / rule.tick;
    const count = method === "up" ? Math.ceil(units - 1e-8) : method === "down" ? Math.floor(units + 1e-8) : Math.round(units);
    return Number((count * rule.tick).toFixed(rule.decimals));
  }
  function pivots(c) {
    const out = [];
    for (let i = 3; i < c.length - 3; i++) {
      const around = c.slice(i - 3, i + 4);
      if (around.every((x, j) => j === 3 || x.high < c[i].high)) out.push({ type: "high", p: c[i].high });
      if (around.every((x, j) => j === 3 || x.low > c[i].low)) out.push({ type: "low", p: c[i].low });
    }
    return out;
  }
  function validateSetup(x, a1, a5, a15, r) {
    const c1 = closedCandles(a1, "1m"), c5 = closedCandles(a5, "5m"), c15 = closedCandles(a15, "15m");
    if (c1.length < 60 || c5.length < 65 || c15.length < 65) return { reason: "Historial de velas cerradas incompleto" };
    const last = c1.at(-1);
    if (now() - (last.time + 60) > 140) return { reason: "Velas de un minuto desactualizadas" };
    const long = x.side === "LONG", five = c5.map(z => z.close), fifteen = c15.map(z => z.close);
    const e5 = ema(five, 21), m5 = ma(five, 55), e15 = ema(fifteen, 21), m15 = ma(fifteen, 55);
    const aligned = long ? five.at(-1) > e5 && e5 > m5 && fifteen.at(-1) > e15 && e15 > m15 : five.at(-1) < e5 && e5 < m5 && fifteen.at(-1) < e15 && e15 < m15;
    if (!aligned) return { reason: "Tendencia de cinco y quince minutos sin alinear" };
    const volatility = atr(c1);
    if (!Number.isFinite(volatility) || volatility < r.tick) return { reason: "Volatilidad insuficiente" };
    let setup = null;
    for (let back = 1; back <= 3; back++) {
      const idx = c1.length - 1 - back;
      if (idx < 25) continue;
      const breakout = c1[idx], previous = c1.slice(idx - 10, idx);
      const level = long ? Math.max(...previous.map(z => z.high)) : Math.min(...previous.map(z => z.low));
      const twenty = c1.slice(idx - 20, idx), avgVolume = twenty.reduce((sum, z) => sum + z.volume, 0) / twenty.length;
      const volOk = avgVolume > 0 && breakout.volume >= avgVolume * 1.3;
      const broke = long ? breakout.close > level + .04 * volatility : breakout.close < level - .04 * volatility;
      const held = c1.slice(idx + 1, -1).every(z => long ? z.close >= level - .16 * volatility : z.close <= level + .16 * volatility);
      const retest = long ? last.low <= level + .20 * volatility && last.low >= level - .25 * volatility && last.close > level : last.high >= level - .20 * volatility && last.high <= level + .25 * volatility && last.close < level;
      if (volOk && broke && held && retest) { setup = { level, candle: last, breakTime: breakout.time }; break; }
    }
    if (!setup) return { reason: "Esperando ruptura, retesteo y volumen confirmado" };
    const buffer = Math.max(r.tick, .2 * volatility);
    const entry = long ? round(last.high + r.tick, r, "up") : round(last.low - r.tick, r, "down");
    const recent = c1.slice(-4);
    const stop = long ? round(Math.min(...recent.map(z => z.low)) - buffer, r, "down") : round(Math.max(...recent.map(z => z.high)) + buffer, r, "up");
    const risk = Math.abs(entry - stop), riskPct = 100 * risk / entry;
    if (!Number.isFinite(riskPct) || risk < 3 * r.tick || riskPct < .035 || riskPct > 1.5 || stop <= 0 || entry <= 0 || (long ? stop >= entry : stop <= entry)) return { reason: "Stop o distancia de riesgo no aceptable" };
    const tp1 = round(entry + (long ? 1 : -1) * risk * 1.5, r, long ? "up" : "down");
    const tp2 = round(entry + (long ? 1 : -1) * risk * 2.5, r, long ? "up" : "down");
    if (tp1 <= 0 || tp2 <= 0 || (long ? !(entry < tp1 && tp1 < tp2) : !(entry > tp1 && tp1 > tp2))) return { reason: "Objetivos no válidos" };
    const levels = pivots(c5.slice(-110));
    const barrier = long ? levels.filter(z => z.type === "high" && z.p > entry).sort((a, b) => a.p - b.p)[0] : levels.filter(z => z.type === "low" && z.p < entry).sort((a, b) => b.p - a.p)[0];
    if (barrier && (long ? barrier.p < tp1 : barrier.p > tp1)) return { reason: "Soporte o resistencia bloquea TP1" };
    return { plan: {
      id: [marketId(x), x.side, setup.candle.time].join("|"), exchange: x.exchange, market: x.market, symbol: x.symbol, label: x.label, side: x.side, score: x.score,
      entry, stop, tp1, tp2, riskPct, decimals: r.decimals, verifiedTick: r.verified,
      createdAt: Date.now(), createdTime: setup.candle.time, lastChecked: setup.candle.time,
      status: "ESPERAR ACTIVACIÓN", activatedAt: null, tp1Hit: false, tp2Hit: false, stopBeforeTP1: false
    } };
  }
  function follow(p, arr) {
    if (isFinal(p)) return false;
    const closed = closedCandles(arr, "1m");
    if (!closed.length) return false;
    let changed = false;
    const lastChecked = Number.isFinite(p.lastChecked) ? p.lastChecked : p.createdTime;
    const fresh = closed.filter(c => c.time > lastChecked);
    if (!fresh.length) {
      // Sin datos suficientes para certificar el resultado: no se inventa.
      if (closed[0].time > lastChecked + 60) { p.status = "SIN VERIFICAR"; return true; }
      return false;
    }
    if (fresh[0].time > lastChecked + 60) { p.status = "SIN VERIFICAR"; return true; }
    for (const c of fresh) {
      if (c.time > p.lastChecked + 60) { p.status = "SIN VERIFICAR"; changed = true; break; }
      const long = p.side === "LONG";
      const entry = long ? c.high >= p.entry : c.low <= p.entry;
      const stop = long ? c.low <= p.stop : c.high >= p.stop;
      const tp1 = long ? c.high >= p.tp1 : c.low <= p.tp1;
      const tp2 = long ? c.high >= p.tp2 : c.low <= p.tp2;
      if (p.status === "ESPERAR ACTIVACIÓN") {
        if (c.time - p.createdTime >= WAIT) p.status = "NO ACTIVADA";
        else if (entry && (stop || tp1 || tp2)) p.status = "SECUENCIA AMBIGUA";
        else if (entry) { p.status = "ACTIVADA"; p.activatedAt = c.time; }
        else if (stop) p.status = "INVALIDADA";
      } else if (p.status === "ACTIVADA") {
        if (stop && (tp1 || tp2)) p.status = "SECUENCIA AMBIGUA";
        else if (stop) { p.status = "STOP ANTES DE TP1"; p.stopBeforeTP1 = true; }
        else if (tp2) { p.tp1Hit = true; p.tp2Hit = true; p.status = "TP2 ALCANZADO"; }
        else if (tp1) { p.tp1Hit = true; p.status = "TP1 ALCANZADO"; }
      } else if (p.status === "TP1 ALCANZADO") {
        if (tp2 && stop) p.status = "SECUENCIA AMBIGUA";
        else if (tp2) { p.tp2Hit = true; p.status = "TP2 ALCANZADO"; }
        else if (stop) p.status = "TP1 Y STOP";
      }
      p.lastChecked = c.time; changed = true;
      if (isFinal(p)) break;
      if (c.time - p.createdTime >= TRACK) { p.status = "SEGUIMIENTO FINALIZADO"; break; }
    }
    // Cierre por vencimiento solo si el periodo completo se puede auditar.
    if (!isFinal(p) && p.status === "ESPERAR ACTIVACIÓN" && closed.at(-1).time - p.createdTime >= WAIT) { p.status = "NO ACTIVADA"; changed = true; }
    return changed;
  }
  function addRecord(p) {
    if (history.some(z => z.id === p.id)) return false;
    if (history.some(z => marketId(z) === marketId(p) && z.side === p.side && !isFinal(z))) return false;
    const prev = history.find(z => marketId(z) === marketId(p) && z.side === p.side);
    if (prev && p.createdAt - prev.createdAt < 720000) return false;
    history.unshift(p); if (history.length > MAX_LOG) history.length = MAX_LOG;
    save(); return true;
  }
  function metrics() {
    // Solo resultados inequívocos. Las secuencias ambiguas no entran en la tasa.
    const eligible = history.filter(p => !["SECUENCIA AMBIGUA", "SIN VERIFICAR"].includes(p.status));
    const successes = eligible.filter(p => p.tp1Hit).length;
    const losses = eligible.filter(p => p.stopBeforeTP1).length;
    const decided = successes + losses;
    return {
      successes, losses, decided,
      activated: history.filter(p => p.activatedAt !== null).length,
      untriggered: history.filter(p => ["NO ACTIVADA", "INVALIDADA"].includes(p.status)).length,
      uncertain: history.filter(p => ["SIN VERIFICAR", "SECUENCIA AMBIGUA"].includes(p.status)).length,
      tp2: eligible.filter(p => p.tp2Hit).length,
      rate: decided ? fmt(successes / decided * 100, 1) + "%" : "Sin muestra"
    };
  }
  function ui() {
    let root = $("clAuditV4") || $("clAuditV5");
    if (root) return root;
    const scanner = $("clScanner"); if (!scanner) return null;
    root = node("section", "cl-audit"); root.id = "clAuditV5";
    root.append(node("h3", "", "🎯 Entradas validadas · V5"), node("p", "cl-small", "Una señal CONFIRMADA en el escáner no es una entrada. Se exige alineación de cinco y quince minutos, ruptura, retesteo, volumen y espacio estructural."));
    const cards = node("div", "cl-cards"); cards.id = "clAuditCards"; root.append(cards);
    root.append(node("h3", "", "📊 Auditoría de señales"), node("p", "cl-small", "Efectividad: TP1 alcanzado frente a stop antes de TP1. Los casos no activados, ambiguos o sin verificar quedan fuera del porcentaje."));
    const stats = node("div", "cl-stats"); stats.id = "clAuditStats"; root.append(stats);
    const storage = node("p", "cl-small"); storage.id = "clAuditStorage"; root.append(storage);
    const log = node("div", "cl-log"); log.id = "clAuditLog"; root.append(log);
    scanner.append(root);
    if (!$("clAuditStyle")) {
      const style = node("style"); style.id = "clAuditStyle";
      style.textContent = `
        .cl-audit{border-top:1px solid #334463;margin-top:20px;padding-top:14px;color:#dce6ff}
        .cl-audit h3{font-size:16px;margin:8px 0}
        .cl-small{color:#a8b5d4;font-size:12px;line-height:1.55;margin:5px 0 13px}
        .cl-cards{display:grid;gap:12px}
        .cl-card{background:#101d36;border:1px solid #334463;border-radius:13px;padding:13px;min-width:0}
        .cl-head{display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;font-weight:700;margin-bottom:9px}
        .cl-note{font-size:12px;color:#ffc971;line-height:1.5;margin:5px 0}
        .cl-prices{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin-top:10px}
        .cl-price{background:#0b1429;border:1px solid #293b58;border-radius:9px;padding:10px;min-width:0}
        .cl-price small{display:block;color:#9eafcc;font-size:11px}
        .cl-price strong{display:block;color:#e7eeff;font-size:clamp(13px,3.4vw,17px);overflow-wrap:anywhere}
        .cl-stats{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
        .cl-stat{border:1px solid #304467;background:#0b1429;border-radius:10px;padding:12px}
        .cl-stat small{display:block;font-size:11px;color:#a5b4d0}
        .cl-stat strong{font-size:19px}
        .cl-log{max-height:340px;overflow:auto;font-size:12px}
        .cl-row{padding:9px 3px;border-bottom:1px solid #263856;line-height:1.6}
        @media(max-width:350px){.cl-prices,.cl-stats{grid-template-columns:1fr}}
      `;
      document.head.append(style);
    }
    return root;
  }
  function render(signals = scanSignals(), reasons = {}) {
    if (!ui()) return;
    const cards = $("clAuditCards"); cards.replaceChildren();
    const candidates = signals.filter(s => s.state === "CONFIRMADA" && s.score >= 65 && ["LONG", "SHORT"].includes(s.side));
    if (!candidates.length) cards.append(node("div", "cl-card cl-small", "Sin configuraciones técnicas candidatas. Se mantiene el seguimiento de entradas anteriores."));
    for (const s of candidates) {
      const card = node("article", "cl-card"), head = node("div", "cl-head");
      head.append(node("span", "", s.label), node("span", "", s.side + " · " + s.score + "/100")); card.append(head);
      const record = history.find(p => marketId(p) === marketId(s) && p.side === s.side && !isFinal(p)) || history.find(p => marketId(p) === marketId(s) && p.side === s.side && Date.now() - p.createdAt < 720000);
      if (!record) card.append(node("div", "cl-note", reasons[marketId(s)] || "Evaluando ruptura, retesteo y volumen…"));
      else {
        card.append(node("div", "cl-note", "Estado: " + record.status));
        const grid = node("div", "cl-prices");
        for (const [label, amount] of [["🎯 Entrada", record.entry], ["🛑 Stop Loss", record.stop], ["✅ TP1 · 1.5R", record.tp1], ["✅ TP2 · 2.5R", record.tp2]]) {
          const box = node("div", "cl-price"); box.append(node("small", "", label), node("strong", "", fmt(amount, record.decimals ?? 2))); grid.append(box);
        }
        card.append(grid);
        card.append(node("p", "cl-small", "Distancia al stop: " + fmt(record.riskPct, 2) + "% · " + (record.verifiedTick ? "Tick API verificado" : "⚠ Tick estimado: comprobar en el exchange") + " · Sin orden real"));
      }
      cards.append(card);
    }
    const s = metrics(), stats = $("clAuditStats"); stats.replaceChildren();
    for (const [label, value] of [["Efectividad TP1", s.rate], ["Casos evaluables", s.decided], ["Llegaron a TP1", s.successes], ["Stop antes de TP1", s.losses], ["Entradas activadas", s.activated], ["No activadas / invalidadas", s.untriggered], ["TP2 alcanzado", s.tp2], ["No verificables / ambiguas", s.uncertain]]) {
      const item = node("div", "cl-stat"); item.append(node("small", "", label), node("strong", "", value)); stats.append(item);
    }
    $("clAuditStorage").textContent = storageAvailable ? "Registro guardado en este navegador. Al volver se auditan únicamente las velas cerradas disponibles; los huecos no se inventan." : "⚠ No se puede guardar en este navegador. El historial puede perderse al cerrar.";
    const log = $("clAuditLog"); log.replaceChildren();
    for (const p of history.slice(0, 35)) log.append(node("div", "cl-row", new Date(p.createdAt).toLocaleString("es-MX") + " · " + (p.label || p.symbol) + " · " + p.side + " · " + p.status + (p.tp1Hit ? " · TP1 registrado" : "")));
    if (!history.length) log.append(node("div", "cl-small", "Aún no hay señales validadas registradas."));
  }
  function signalSignature(signals) { return JSON.stringify(signals.map(s => [marketId(s), s.side, s.state, s.score])); }
  async function process() {
    if (document.hidden) return;
    if (busy) { rerun = true; return; }
    busy = true; rerun = false;
    const signals = scanSignals(), signature = signalSignature(signals), reasons = {};
    let modified = false;
    try {
      const candidates = signals.filter(s => s.state === "CONFIRMADA" && s.score >= 65 && ["LONG", "SHORT"].includes(s.side));
      const pending = history.filter(p => !isFinal(p));
      const unique = new Map();
      for (const p of pending) unique.set(marketId(p), p);
      for (const s of candidates) unique.set(marketId(s), s);
      const targets = [...unique.values()]; let index = 0;
      async function worker() {
        while (index < targets.length) {
          const x = targets[index++], id = marketId(x);
          try {
            const a1 = await candles(x, "1m");
            for (const p of pending.filter(p => marketId(p) === id)) if (follow(p, a1)) modified = true;
            const candidate = candidates.find(s => marketId(s) === id);
            if (!candidate || signalSignature(scanSignals()) !== signature) continue;
            const a5 = await candles(candidate, "5m"), a15 = await candles(candidate, "15m"), r = await rule(candidate, a1);
            if (signalSignature(scanSignals()) !== signature) continue;
            const result = validateSetup(candidate, a1, a5, a15, r);
            reasons[id] = result.reason || "Entrada condicionada a ruptura del máximo o mínimo del retesteo";
            if (result.plan && addRecord(result.plan)) modified = true;
          } catch (e) { reasons[id] = "No disponible: " + (e?.message || String(e)); }
        }
      }
      await Promise.all([worker(), worker()]);
      if (modified) save();
      render(scanSignals(), reasons);
    } catch (e) { console.warn("Trade Plans V5:", e); render(scanSignals(), reasons); }
    finally {
      busy = false;
      if (rerun) { rerun = false; setTimeout(process, 400); }
    }
  }
  function schedule(delay = 300) {
    clearTimeout(recheckTimer);
    recheckTimer = setTimeout(process, delay);
  }
  function init() {
    if (initialized) return;
    const body = $("clScanBody");
    if (!body) { setTimeout(init, 500); return; }
    initialized = true;
    load(); ui(); render(scanSignals());
    observer = new MutationObserver(() => schedule(300));
    observer.observe(body, { childList: true });
    for (const id of ["exchange", "market", "symbol"]) $(id)?.addEventListener("change", () => schedule(400));
    document.addEventListener("visibilitychange", () => { if (!document.hidden) schedule(100); });
    $("clScanNow")?.addEventListener("click", () => schedule(300));
    intervalTimer = setInterval(() => { if (!document.hidden) process(); }, 60000);
    window.addEventListener("beforeunload", () => { observer?.disconnect(); clearInterval(intervalTimer); clearTimeout(recheckTimer); });
    process();
    console.info("CRYPTOLEXUZ PRO — Trade Plans V5 cargado");
  }
  window.CryptolexuzTradePlans = { version: "5", refresh: process, getHistory: () => JSON.parse(JSON.stringify(history)), getMetrics: metrics };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();
