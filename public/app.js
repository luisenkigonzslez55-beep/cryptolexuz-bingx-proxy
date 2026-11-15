
/* =====================================================
   CRYPTOLEXUZ PRO
   APP.JS — VERSION 8
   BingX · Graficas · Indicadores · Senales
   ===================================================== */

"use strict";

(() => {

const $ = id => document.getElementById(id);
const API = location.origin;

const C = {
  green: "#00f5a0",
  red: "#ff476c",
  purple: "#bb52ff",
  orange: "#ff9a35",
  blue: "#36c5ff",
  yellow: "#ffe15a",
  muted: "#a5b0cf"
};

const enabled = new Set([
  "ema21", "ma55", "rsi", "fvg"
]);

const supported = new Set([
  "ema21", "ma55", "ma100", "ma200",
  "rsi", "adx", "fvg", "ifvg",
  "liquidity", "sweeps",
  "support", "resistance"
]);

const charts = {};
const series = {};
const maSeries = {};
const drawnLines = [];

let rows = [];
let zones = [];
let pivots = [];
let sweeps = [];
let chartUnlocked = false;
let loading = false;
let requestId = 0;
let lastSymbol = "";
let lastInterval = "";
let monitorBusy = false;
let lastMonitorAt = 0;

const signalHistory = [];
const lastStates = {};

let currentRSIText = "";

const num = (v, d = 2) => {
  const n = Number(v);
  return Number.isFinite(n)
    ? n.toLocaleString("en-US", {
        minimumFractionDigits: d,
        maximumFractionDigits: d
      })
    : "—";
};

const value = (id, text) => {
  const el = $(id);
  if (el) el.textContent = text;
};

function selected() {
  return {
    symbol: $("symbol")?.value || "BTC-USDT",
    tf: $("interval")?.value || "15m",
    market: $("market")?.value || "perpetual"
  };
}

function setConnection(text, color = C.green) {
  const el = $("connection");
  if (el) {
    el.textContent = "● " + text;
    el.style.color = color;
  }
}

function toSeconds(t) {
  if (typeof t === "string" && !/^\d+$/.test(t)) {
    return Math.floor(new Date(t).getTime() / 1000);
  }
  const n = Number(t);
  return n > 1e12 ? Math.floor(n / 1000) : Math.floor(n);
}

function normalize(raw) {
  let data = raw;

  if (!Array.isArray(data)) {
    data = data?.data?.data ??
      data?.data?.list ??
      data?.data?.candles ??
      data?.data ??
      data?.list ??
      data?.candles ??
      [];
  }

  if (!Array.isArray(data)) return [];

  const result = [];

  for (const x of data) {
    const a = Array.isArray(x);

    const time = toSeconds(
      a ? x[0] :
      x.time ?? x.timestamp ?? x.openTime ?? x.t
    );

    const open = Number(a ? x[1] : x.open ?? x.o);
    const high = Number(a ? x[2] : x.high ?? x.h);
    const low = Number(a ? x[3] : x.low ?? x.l);
    const close = Number(a ? x[4] : x.close ?? x.c);
    const volume = Number(
      a ? x[5] : x.volume ?? x.vol ?? x.v ?? 0
    );

    if (
      Number.isFinite(time) &&
      Number.isFinite(open) &&
      Number.isFinite(high) &&
      Number.isFinite(low) &&
      Number.isFinite(close) &&
      high >= low &&
      high >= Math.max(open, close) &&
      low <= Math.min(open, close)
    ) {
      result.push({
        time, open, high, low, close,
        volume: Number.isFinite(volume) ? volume : 0
      });
    }
  }

  result.sort((a, b) => a.time - b.time);

  return result.filter(
    (x, i, a) => !i || x.time !== a[i - 1].time
  );
}

function sma(a, period) {
  const out = Array(a.length).fill(null);
  let sum = 0;

  for (let i = 0; i < a.length; i++) {
    sum += a[i];
    if (i >= period) sum -= a[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }

  return out;
}

function ema(a, period) {
  const out = Array(a.length).fill(null);
  if (a.length < period) return out;

  let sum = 0;
  for (let i = 0; i < period; i++) sum += a[i];

  let previous = sum / period;
  out[period - 1] = previous;

  const k = 2 / (period + 1);

  for (let i = period; i < a.length; i++) {
    previous = a[i] * k + previous * (1 - k);
    out[i] = previous;
  }

  return out;
}

function rsi(a, period = 14) {
  const out = Array(a.length).fill(null);
  if (a.length <= period) return out;

  let gain = 0;
  let loss = 0;

  for (let i = 1; i <= period; i++) {
    const d = a[i] - a[i - 1];
    gain += Math.max(0, d);
    loss += Math.max(0, -d);
  }

  gain /= period;
  loss /= period;

  const calc = () =>
    loss === 0
      ? gain === 0 ? 50 : 100
      : 100 - 100 / (1 + gain / loss);

  out[period] = calc();

  for (let i = period + 1; i < a.length; i++) {
    const d = a[i] - a[i - 1];

    gain = (gain * (period - 1) + Math.max(0, d)) / period;
    loss = (loss * (period - 1) + Math.max(0, -d)) / period;

    out[i] = calc();
  }

  return out;
}

function adx(a, period = 14) {
  const n = a.length;

  const ADX = Array(n).fill(null);
  const PLUS = Array(n).fill(null);
  const MINUS = Array(n).fill(null);

  if (n < period * 2) {
    return { adx: ADX, plus: PLUS, minus: MINUS };
  }

  const tr = Array(n).fill(0);
  const pdm = Array(n).fill(0);
  const mdm = Array(n).fill(0);

  for (let i = 1; i < n; i++) {
    const up = a[i].high - a[i - 1].high;
    const down = a[i - 1].low - a[i].low;

    pdm[i] = up > down && up > 0 ? up : 0;
    mdm[i] = down > up && down > 0 ? down : 0;

    tr[i] = Math.max(
      a[i].high - a[i].low,
      Math.abs(a[i].high - a[i - 1].close),
      Math.abs(a[i].low - a[i - 1].close)
    );
  }

  let atr = 0, sp = 0, sm = 0;

  for (let i = 1; i <= period; i++) {
    atr += tr[i];
    sp += pdm[i];
    sm += mdm[i];
  }

  const dx = Array(n).fill(null);

  for (let i = period; i < n; i++) {
    if (i > period) {
      atr = atr - atr / period + tr[i];
      sp = sp - sp / period + pdm[i];
      sm = sm - sm / period + mdm[i];
    }

    const p = atr ? 100 * sp / atr : 0;
    const m = atr ? 100 * sm / atr : 0;

    PLUS[i] = p;
    MINUS[i] = m;

    dx[i] = p + m ? 100 * Math.abs(p - m) / (p + m) : 0;
  }

  const first = period * 2 - 1;
  let total = 0;

  for (let i = period; i <= first; i++) total += dx[i];

  ADX[first] = total / period;

  for (let i = first + 1; i < n; i++) {
    ADX[i] = (
      ADX[i - 1] * (period - 1) + dx[i]
    ) / period;
  }

  return { adx: ADX, plus: PLUS, minus: MINUS };
}

function lineData(a, values) {
  return a.flatMap((x, i) =>
    Number.isFinite(values[i])
      ? [{ time: x.time, value: values[i] }]
      : []
  );
}

function lastValid(a) {
  for (let i = a.length - 1; i >= 0; i--) {
    if (Number.isFinite(a[i])) return a[i];
  }
  return null;
}

function chartOptions(height) {
  return {
    width: 300,
    height,
    layout: {
      background: { color: "#080e20" },
      textColor: "#c9d3ee",
      fontSize: 11
    },
    grid: {
      vertLines: { color: "#15213a" },
      horzLines: { color: "#15213a" }
    },
    rightPriceScale: {
      borderColor: "#34456c",
      minimumWidth: 65
    },
    timeScale: {
      borderColor: "#34456c",
      timeVisible: true,
      secondsVisible: false
    },
    crosshair: {
      mode: LightweightCharts.CrosshairMode.Normal
    },
    handleScroll: {
      mouseWheel: true,
      pressedMouseMove: true,
      horzTouchDrag: false,
      vertTouchDrag: false
    },
    handleScale: {
      mouseWheel: true,
      pinch: false
    }
  };
}

function createCharts() {
  if (!window.LightweightCharts) {
    value("message", "No se pudo cargar la biblioteca de gráficas.");
    setConnection("Error de gráfica", C.red);
    return false;
  }

  const main = $("chart");
  if (!main) return false;

  charts.price = LightweightCharts.createChart(
    main, chartOptions(360)
  );

  series.price = charts.price.addCandlestickSeries({
    upColor: C.green,
    downColor: C.red,
    wickUpColor: C.green,
    wickDownColor: C.red,
    borderVisible: false,
    priceLineVisible: true
  });

  const maConfig = {
    ema21: C.purple,
    ma55: C.orange,
    ma100: C.red,
    ma200: C.blue
  };

  for (const [key, color] of Object.entries(maConfig)) {
    maSeries[key] = charts.price.addLineSeries({
      color,
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false
    });
  }

  charts.volume = LightweightCharts.createChart(
    $("volumeChart"), chartOptions(115)
  );

  series.volume = charts.volume.addHistogramSeries({
    priceFormat: { type: "volume" },
    priceScaleId: ""
  });

  series.volume.priceScale().applyOptions({
    scaleMargins: { top: 0.12, bottom: 0 }
  });

  charts.rsi = LightweightCharts.createChart(
    $("rsiChart"), chartOptions(145)
  );

  series.rsi = charts.rsi.addLineSeries({
    color: C.purple,
    lineWidth: 2,
    priceLineVisible: false
  });

  for (const level of [30, 50, 70]) {
    series.rsi.createPriceLine({
      price: level,
      color: level === 50 ? "#607399" : "#a24d9c",
      lineWidth: 1,
      lineStyle: LightweightCharts.LineStyle.Dashed,
      axisLabelVisible: true
    });
  }

  charts.adx = LightweightCharts.createChart(
    $("adxChart"), chartOptions(145)
  );

  series.adx = charts.adx.addLineSeries({
    color: C.yellow,
    lineWidth: 2,
    priceLineVisible: false
  });

  series.plus = charts.adx.addLineSeries({
    color: C.green,
    lineWidth: 2,
    priceLineVisible: false
  });

  series.minus = charts.adx.addLineSeries({
    color: C.red,
    lineWidth: 2,
    priceLineVisible: false
  });

  series.adx.createPriceLine({
    price: 25,
    color: "#7d89a8",
    lineStyle: LightweightCharts.LineStyle.Dashed,
    axisLabelVisible: true
  });

  const all = Object.values(charts);
  let syncing = false;

  for (const chart of all) {
    chart.timeScale().subscribeVisibleLogicalRangeChange(range => {
      if (syncing || !range) return;
      syncing = true;

      for (const other of all) {
        if (other !== chart) {
          try {
            other.timeScale().setVisibleLogicalRange(range);
          } catch (_) {}
        }
      }

      syncing = false;
      drawZones();
    });
  }

  const resize = () => {
    const sizes = [
      ["price", "chart"],
      ["volume", "volumeChart"],
      ["rsi", "rsiChart"],
      ["adx", "adxChart"]
    ];

    for (const [key, id] of sizes) {
      const el = $(id);
      if (!el || !charts[key]) continue;

      const w = el.clientWidth;
      const h = el.clientHeight;

      if (w > 0 && h > 0) {
        charts[key].resize(w, h);
      }
    }

    resizeCanvas();
  };

  if (window.ResizeObserver) {
    const observer = new ResizeObserver(resize);

    for (const id of [
      "chart", "volumeChart", "rsiChart", "adxChart"
    ]) {
      if ($(id)) observer.observe($(id));
    }
  }

  window.addEventListener("resize", resize);

  setTimeout(resize, 100);

  setChartNavigation(false);

  return true;
}

function setChartNavigation(unlocked) {
  chartUnlocked = unlocked;

  const chart = charts.price;
  if (!chart) return;

  chart.applyOptions({
    handleScroll: {
      mouseWheel: true,
      pressedMouseMove: true,
      horzTouchDrag: unlocked,
      vertTouchDrag: unlocked
    },
    handleScale: {
      mouseWheel: true,
      pinch: unlocked
    }
  });

  value(
    "chartNavigation",
    unlocked ? "🔓 Bloquear" : "🔒 Desbloquear"
  );

  value(
    "chartTouchStatus",
    unlocked
      ? "Gráfica desbloqueada: arrastra o usa dos dedos."
      : "Gráfica bloqueada: desliza la página con un dedo."
  );

  $("chartNavigation")?.setAttribute(
    "aria-pressed", String(unlocked)
  );
}

function resetView() {
  if (!charts.price || !rows.length) return;

  const end = rows.length + 3;
  const start = Math.max(0, rows.length - 50);

  charts.price.timeScale().setVisibleLogicalRange({
    from: start,
    to: end
  });
}

function detectPivots(a) {
  const found = [];
  const left = 4;
  const right = 4;

  for (let i = left; i < a.length - right; i++) {
    let high = true;
    let low = true;

    for (let j = i - left; j <= i + right; j++) {
      if (j === i) continue;

      if (a[j].high >= a[i].high) high = false;
      if (a[j].low <= a[i].low) low = false;
    }

    if (high) found.push({
      index: i,
      price: a[i].high,
      type: "high"
    });

    if (low) found.push({
      index: i,
      price: a[i].low,
      type: "low"
    });
  }

  return found.slice(-40);
}

function detectFVG(a) {
  const found = [];

  for (let i = 2; i < a.length; i++) {
    const bull = a[i].low > a[i - 2].high;
    const bear = a[i].high < a[i - 2].low;

    if (!bull && !bear) continue;

    const top = bull ? a[i].low : a[i - 2].low;
    const bottom = bull ? a[i - 2].high : a[i].high;
    const middle = (top + bottom) / 2;

    if ((top - bottom) / middle < 0.00035) continue;

    let end = a.length - 1;
    let filled = false;
    let inverted = false;

    for (let j = i + 1; j < a.length; j++) {
      if (bull && a[j].low <= bottom) {
        end = j;
        filled = true;
        inverted = a[j].close < bottom;
        break;
      }

      if (bear && a[j].high >= top) {
        end = j;
        filled = true;
        inverted = a[j].close > top;
        break;
      }
    }

    found.push({
      start: i - 2,
      end,
      top,
      bottom,
      bull,
      filled,
      inverted
    });
  }

  return found.slice(-80);
}

function detectSweeps(a) {
  const found = [];

  for (let i = 20; i < a.length - 1; i++) {
    const previous = a.slice(i - 20, i);

    const high = Math.max(...previous.map(x => x.high));
    const low = Math.min(...previous.map(x => x.low));

    if (a[i].high > high && a[i].close < high) {
      found.push({
        time: a[i].time,
        position: "aboveBar",
        color: C.red,
        shape: "arrowDown",
        text: "Barrido ↑"
      });
    }

    if (a[i].low < low && a[i].close > low) {
      found.push({
        time: a[i].time,
        position: "belowBar",
        color: C.green,
        shape: "arrowUp",
        text: "Barrido ↓"
      });
    }
  }

  return found.slice(-25);
}

function clearPriceLines() {
  for (const line of drawnLines) {
    try {
      series.price.removePriceLine(line);
    } catch (_) {}
  }
  drawnLines.length = 0;
}

function addLevel(price, color, title) {
  if (!Number.isFinite(price)) return;

  const line = series.price.createPriceLine({
    price,
    color,
    lineWidth: 1,
    lineStyle: LightweightCharts.LineStyle.Dashed,
    axisLabelVisible: true,
    title
  });

  drawnLines.push(line);
}

function updateLevels() {
  clearPriceLines();

  const recent = pivots.slice(-18);

  if (enabled.has("support")) {
    const lows = recent.filter(x => x.type === "low");
    const level = lows.at(-1);

    if (level) addLevel(level.price, C.green, "Soporte");
  }

  if (enabled.has("resistance")) {
    const highs = recent.filter(x => x.type === "high");
    const level = highs.at(-1);

    if (level) addLevel(level.price, C.red, "Resistencia");
  }

  if (enabled.has("liquidity")) {
    const highs = recent.filter(x => x.type === "high").slice(-2);
    const lows = recent.filter(x => x.type === "low").slice(-2);

    for (const x of highs) {
      addLevel(x.price, C.red, "Maximo previo");
    }

    for (const x of lows) {
      addLevel(x.price, C.green, "Minimo previo");
    }
  }
}

function resizeCanvas() {
  const canvas = $("zonesCanvas");
  const area = $("priceChartArea");

  if (!canvas || !area) return;

  const dpr = Math.min(window.devicePixelRatio || 1, 2);

  canvas.width = Math.round(area.clientWidth * dpr);
  canvas.height = Math.round(area.clientHeight * dpr);

  const ctx = canvas.getContext("2d");

  if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  drawZones();
}

function drawZones() {
  const canvas = $("zonesCanvas");
  const area = $("priceChartArea");

  if (!canvas || !area || !charts.price || !rows.length) return;

  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const width = area.clientWidth;
  const height = area.clientHeight;

  ctx.clearRect(0, 0, width, height);

  if (!enabled.has("fvg") && !enabled.has("ifvg")) return;

  const scale = charts.price.timeScale();
  const maxX = Math.max(0, width - 70);

  const selectedZones = zones
    .filter(z =>
      (!z.filled && enabled.has("fvg")) ||
      (z.inverted && enabled.has("ifvg"))
    )
    .slice(-18);

  for (const z of selectedZones) {
    const x1 = scale.logicalToCoordinate(z.start);
    const x2 = scale.logicalToCoordinate(z.end);

    const y1 = series.price.priceToCoordinate(z.top);
    const y2 = series.price.priceToCoordinate(z.bottom);

    if (
      ![x1, x2, y1, y2].every(Number.isFinite)
    ) continue;

    const left = Math.max(0, x1);
    const right = Math.min(maxX, x2);

    if (right <= left) continue;

    const top = Math.max(0, Math.min(y1, y2));
    const bottom = Math.min(height, Math.max(y1, y2));

    if (bottom <= top) continue;

    const color = z.inverted
      ? "rgba(255, 225, 90, 0.10)"
      : z.bull
        ? "rgba(0, 245, 160, 0.09)"
        : "rgba(255, 71, 108, 0.09)";

    const border = z.inverted
      ? "rgba(255, 225, 90, 0.50)"
      : z.bull
        ? "rgba(0, 245, 160, 0.40)"
        : "rgba(255, 71, 108, 0.40)";

    ctx.fillStyle = color;
    ctx.fillRect(left, top, right - left, bottom - top);

    ctx.strokeStyle = border;
    ctx.lineWidth = 1;
    ctx.strokeRect(left, top, right - left, bottom - top);
  }
}

function rsiInterpretation(v) {
  if (!Number.isFinite(v)) return "RSI no disponible.";

  if (v < 30) {
    return "RSI " + num(v, 1) +
      ": zona de sobreventa. Puede existir presión vendedora intensa; no confirma un rebote.";
  }

  if (v < 40) {
    return "RSI " + num(v, 1) +
      ": predominio vendedor, todavía sin sobreventa.";
  }

  if (v < 50) {
    return "RSI " + num(v, 1) +
      ": impulso ligeramente bajista.";
  }

  if (v < 60) {
    return "RSI " + num(v, 1) +
      ": impulso ligeramente alcista.";
  }

  if (v < 70) {
    return "RSI " + num(v, 1) +
      ": predominio comprador.";
  }

  return "RSI " + num(v, 1) +
    ": zona de sobrecompra. No significa que el precio deba caer inmediatamente.";
}

function adxInterpretation(ax, plus, minus) {
  if (![ax, plus, minus].every(Number.isFinite)) {
    return "ADX no disponible.";
  }

  const strength = ax < 20
    ? "tendencia débil o mercado sin fuerza definida"
    : ax < 25
      ? "tendencia en desarrollo"
      : ax < 40
        ? "tendencia con fuerza"
        : "tendencia muy fuerte";

  const direction = plus > minus
    ? "predominio direccional comprador"
    : minus > plus
      ? "predominio direccional vendedor"
      : "equilibrio direccional";

  return "ADX " + num(ax, 1) +
    ": " + strength + ". +DI " +
    num(plus, 1) + " y −DI " +
    num(minus, 1) + ": " + direction +
    ". El ADX mide fuerza, no dirección.";
}

function volumeInterpretation(a) {
  if (a.length < 21) return "Volumen insuficiente.";

  const closed = a.slice(0, -1);
  const last = closed.at(-1);

  const previous = closed.slice(-21, -1);
  const average = previous.reduce(
    (s, x) => s + x.volume, 0
  ) / previous.length;

  if (!average) return "No hay volumen suficiente.";

  const ratio = last.volume / average;
  const direction = last.close >= last.open
    ? "alcista"
    : "bajista";

  let strength = "volumen cercano al promedio";

  if (ratio >= 1.8) strength = "volumen muy elevado";
  else if (ratio >= 1.3) strength = "volumen superior al promedio";
  else if (ratio < 0.7) strength = "volumen reducido";

  return "Última vela cerrada " + direction +
    ", con " + strength + " (" +
    num(ratio, 2) + " veces el promedio de veinte velas). " +
    "El color de la vela no identifica por sí solo compras y ventas agresoras.";
}

function updateIndicators() {
  if (!rows.length || !series.price) return;

  const closes = rows.map(x => x.close);

  const e21 = ema(closes, 21);
  const m55 = sma(closes, 55);
  const m100 = sma(closes, 100);
  const m200 = sma(closes, 200);
  const rv = rsi(closes);
  const av = adx(rows);

  const mapping = {
    ema21: e21,
    ma55: m55,
    ma100: m100,
    ma200: m200
  };

  for (const [key, arr] of Object.entries(mapping)) {
    maSeries[key].setData(
      enabled.has(key) ? lineData(rows, arr) : []
    );
  }

  series.rsi.setData(
    enabled.has("rsi") ? lineData(rows, rv) : []
  );

  series.adx.setData(
    enabled.has("adx") ? lineData(rows, av.adx) : []
  );

  series.plus.setData(
    enabled.has("adx") ? lineData(rows, av.plus) : []
  );

  series.minus.setData(
    enabled.has("adx") ? lineData(rows, av.minus) : []
  );

  const closedIndex = Math.max(0, rows.length - 2);

  value("ema21Value", num(e21[closedIndex]));
  value("ma55Value", num(m55[closedIndex]));
  value("rsiValue", num(rv[closedIndex], 1));
  value("adxValue", num(av.adx[closedIndex], 1));

  value("rsiChartValue", num(rv[closedIndex], 1));
  value("adxChartValue", num(av.adx[closedIndex], 1));

  currentRSIText = rsiInterpretation(rv[closedIndex]);

  value("rsiInterpretation", currentRSIText);

  value(
    "adxInterpretation",
    adxInterpretation(
      av.adx[closedIndex],
      av.plus[closedIndex],
      av.minus[closedIndex]
    )
  );

  value("volumeInterpretation", volumeInterpretation(rows));

  const price = closes[closedIndex];

  let trend = "Mixta";

  if (
    Number.isFinite(e21[closedIndex]) &&
    Number.isFinite(m55[closedIndex])
  ) {
    if (price > e21[closedIndex] &&
        e21[closedIndex] > m55[closedIndex]) {
      trend = "Sesgo alcista";
    } else if (
      price < e21[closedIndex] &&
      e21[closedIndex] < m55[closedIndex]
    ) {
      trend = "Sesgo bajista";
    }
  }

  value(
    "indicatorReadout",
    trend + ". " + currentRSIText
  );

  pivots = detectPivots(rows);
  zones = detectFVG(rows);
  sweeps = detectSweeps(rows);

  updateLevels();

  series.price.setMarkers(
    enabled.has("sweeps") ? sweeps : []
  );

  const rsiSection = $("rsiSection");
  const adxSection = $("adxSection");

  if (rsiSection) rsiSection.hidden = !enabled.has("rsi");
  if (adxSection) adxSection.hidden = !enabled.has("adx");

  requestAnimationFrame(() => {
    if (enabled.has("adx")) {
      const el = $("adxChart");
      if (el?.clientWidth) {
        charts.adx.resize(el.clientWidth, el.clientHeight);
      }
    }
    if (enabled.has("rsi")) {
      const el = $("rsiChart");
      if (el?.clientWidth) {
        charts.rsi.resize(el.clientWidth, el.clientHeight);
      }
    }
    drawZones();
  });
}

function analyzeSignal(a) {
  const closed = a.slice(0, -1);

  if (closed.length < 60) {
    return {
      state: "SIN DATOS",
      direction: "neutral",
      detail: "No hay suficientes velas cerradas.",
      metrics: "Esperando historial",
      price: null
    };
  }

  const closes = closed.map(x => x.close);
  const last = closed.at(-1);

  const e = ema(closes, 21).at(-1);
  const m = sma(closes, 55).at(-1);
  const r = rsi(closes).at(-1);

  const aData = adx(closed);
  const ax = aData.adx.at(-1);
  const plus = aData.plus.at(-1);
  const minus = aData.minus.at(-1);

  if (![e, m, r, ax, plus, minus].every(Number.isFinite)) {
    return {
      state: "SIN DATOS",
      direction: "neutral",
      detail: "Indicadores todavía no disponibles.",
      metrics: "Esperando cálculos",
      price: last.close
    };
  }

  let bull = 0;
  let bear = 0;
  const reasons = [];

  if (last.close > e) {
    bull++;
    reasons.push("precio sobre EMA 21");
  } else {
    bear++;
    reasons.push("precio bajo EMA 21");
  }

  if (e > m) {
    bull++;
    reasons.push("EMA 21 sobre MA 55");
  } else {
    bear++;
    reasons.push("EMA 21 bajo MA 55");
  }

  if (r >= 55) bull++;
  else if (r <= 45) bear++;

  if (plus > minus) bull++;
  else if (minus > plus) bear++;

  const strong = ax >= 25;
  const developing = ax >= 20;

  let state = "LATERAL / MIXTO";
  let direction = "neutral";

  if (bull >= 3 && bull > bear) {
    state = "SESGO ALCISTA";
    direction = "bullish";
  } else if (bear >= 3 && bear > bull) {
    state = "SESGO BAJISTA";
    direction = "bearish";
  }

  const strength = strong
    ? "ADX confirma fuerza de tendencia"
    : developing
      ? "ADX muestra fuerza en desarrollo"
      : "ADX indica fuerza limitada";

  let opportunity = "Sin entrada confirmada";

  if (
    direction === "bullish" &&
    bull === 4 &&
    strong &&
    r < 70
  ) {
    opportunity = "Posible LONG; requiere confirmación del precio";
  }

  if (
    direction === "bearish" &&
    bear === 4 &&
    strong &&
    r > 30
  ) {
    opportunity = "Posible SHORT; requiere confirmación del precio";
  }

  return {
    state,
    direction,
    detail: reasons.join(" · ") +
      ". " + strength + ". " + opportunity + ".",
    metrics:
      "RSI " + num(r, 1) +
      " · ADX " + num(ax, 1) +
      " · +DI " + num(plus, 1) +
      " · −DI " + num(minus, 1) +
      " · Confluencia " + Math.max(bull, bear) + "/4",
    price: last.close
  };
}

function recordSignal(tf, symbol, result) {
  const key = symbol + "|" + tf;

  if (lastStates[key] === result.state) return;

  lastStates[key] = result.state;

  if (result.state === "SIN DATOS") return;

  signalHistory.unshift({
    time: new Date().toLocaleTimeString("es-MX"),
    tf,
    symbol,
    state: result.state,
    price: result.price,
    detail: result.detail
  });

  if (signalHistory.length > 30) signalHistory.length = 30;

  renderHistory();
}

function renderHistory() {
  const tbody = $("signalLog");
  if (!tbody) return;

  tbody.replaceChildren();

  for (const s of signalHistory) {
    const tr = document.createElement("tr");

    const fields = [
      s.time,
      s.tf,
      s.symbol,
      s.state,
      num(s.price),
      s.detail,
      "Observación"
    ];

    for (const text of fields) {
      const td = document.createElement("td");
      td.textContent = text;
      tr.appendChild(td);
    }

    tbody.appendChild(tr);
  }
}

function showSignal(tf, symbol, result) {
  const suffix = tf === "5m" ? "5" : "15";

  value("state" + suffix, result.state);
  value("detail" + suffix, result.detail);
  value("metrics" + suffix, result.metrics);

  const state = $("state" + suffix);

  if (state) {
    state.className = "state " + result.direction;
  }

  const card = $("state" + suffix)?.closest(".signal-card");
  const heading = card?.querySelector("h3");

  if (heading) {
    heading.textContent = symbol +
      " / " + (tf === "5m" ? "5" : "15") + " minutos";
  }

  recordSignal(tf, symbol, result);
}

async function getJSON(url, timeout = 12000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      cache: "no-store"
    });

    if (!response.ok) {
      throw new Error("HTTP " + response.status);
    }

    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

function candleURL(market, symbol, tf, limit = 300) {
  return API + "/api/market/" +
    encodeURIComponent(market) +
    "/klines/" +
    encodeURIComponent(symbol) +
    "?interval=" + encodeURIComponent(tf) +
    "&limit=" + limit;
}

function tickerURL(market, symbol) {
  return API + "/api/market/" +
    encodeURIComponent(market) +
    "/ticker/" +
    encodeURIComponent(symbol);
}

function unwrapTicker(raw) {
  let d = raw?.data ?? raw;

  if (Array.isArray(d)) d = d[0] ?? {};

  if (d?.data) d = d.data;

  if (Array.isArray(d)) d = d[0] ?? {};

  return d || {};
}

function updateTicker(raw) {
  const d = unwrapTicker(raw);

  const price = Number(
    d.lastPrice ?? d.last ?? d.price ?? d.close ?? d.c
  );

  const high = Number(
    d.highPrice ?? d.high24h ?? d.high ?? d.h
  );

  const low = Number(
    d.lowPrice ?? d.low24h ?? d.low ?? d.l
  );

  const open = Number(
    d.openPrice ?? d.open24h ?? d.open ?? d.o
  );

  const volume = Number(
    d.volume ?? d.volume24h ?? d.vol ?? d.v
  );

  let change = Number(
    d.priceChangePercent ??
    d.changePercent ??
    d.changeRate
  );

  if (!Number.isFinite(change) &&
      Number.isFinite(price) &&
      Number.isFinite(open) &&
      open !== 0) {
    change = (price / open - 1) * 100;
  }

  if (Number.isFinite(price)) value("price", num(price));

  value("high", num(high));
  value("low", num(low));
  value("open", num(open));
  value("volume", num(volume, 0));

  const el = $("change");

  if (el) {
    el.textContent = Number.isFinite(change)
      ? (change >= 0 ? "+" : "") + num(change) + "%"
      : "—";

    el.classList.toggle("negative", change < 0);
    el.style.color = change < 0 ? C.red : C.green;
  }

  value("bid", num(d.bidPrice ?? d.bid ?? d.bestBid));
  value("ask", num(d.askPrice ?? d.ask ?? d.bestAsk));
}

async function monitor(symbol, market, force = false) {
  if (monitorBusy) return;

  if (!force && Date.now() - lastMonitorAt < 60000) return;

  monitorBusy = true;

  try {
    const [five, fifteen] = await Promise.all([
      getJSON(candleURL(market, symbol, "5m")),
      getJSON(candleURL(market, symbol, "15m"))
    ]);

    if (selected().symbol !== symbol ||
        selected().market !== market) return;

    const a5 = normalize(five);
    const a15 = normalize(fifteen);

    showSignal("5m", symbol, analyzeSignal(a5));
    showSignal("15m", symbol, analyzeSignal(a15));

    value("engineState", "ANALIZANDO");
    lastMonitorAt = Date.now();

  } catch (error) {
    value("engineState", "SIN CONEXIÓN");
    console.warn("Monitor:", error.message);
  } finally {
    monitorBusy = false;
  }
}

function applyCandles(data, symbol, tf) {
  const changed = symbol !== lastSymbol ||
    tf !== lastInterval;

  let previousRange = null;

  if (!changed) {
    try {
      previousRange = charts.price
        .timeScale()
        .getVisibleLogicalRange();
    } catch (_) {}
  }

  rows = data;

  series.price.setData(rows);

  series.volume.setData(rows.map(x => ({
    time: x.time,
    value: x.volume,
    color: x.close >= x.open
      ? "rgba(0,245,160,.70)"
      : "rgba(255,71,108,.70)"
  })));

  updateIndicators();

  if (changed) {
    lastSymbol = symbol;
    lastInterval = tf;
    resetView();
  } else if (previousRange) {
    try {
      charts.price.timeScale()
        .setVisibleLogicalRange(previousRange);
    } catch (_) {}
  }

  value("chartTitle", symbol + " · " + tf);
  value("volumeLabel", symbol.split("-")[0]);

  const area = $("priceChartArea");

  if (area && !$("zonesCanvas")?.width) {
    resizeCanvas();
  } else {
    drawZones();
  }
}

async function refresh() {
  if (loading || !series.price) return;

  loading = true;
  const id = ++requestId;

  const { symbol, tf, market } = selected();

  setConnection("Actualizando", C.yellow);
  value("status", "Consultando BingX...");

  try {
    const [tickerResult, candleResult] = await Promise.allSettled([
      getJSON(tickerURL(market, symbol)),
      getJSON(candleURL(market, symbol, tf))
    ]);

    if (id !== requestId) return;

    if (tickerResult.status === "fulfilled") {
      updateTicker(tickerResult.value);
    }

    if (candleResult.status !== "fulfilled") {
      throw candleResult.reason;
    }

    const data = normalize(candleResult.value);

    if (!data.length) {
      throw new Error("BingX no devolvió velas válidas");
    }

    applyCandles(data, symbol, tf);

    setConnection("BingX conectado");
    value("status", "Datos públicos de BingX disponibles");

    value(
      "updated",
      new Date().toLocaleTimeString("es-MX")
    );

    value("message", "");

    monitor(symbol, market);

  } catch (error) {
    console.error("CRYPTOLEXUZ:", error);

    setConnection("Sin conexión", C.red);
    value("status", "Error: " + error.message);
    value(
      "message",
      "No se pudieron actualizar las velas. " +
      "Comprueba la conexión y el servidor."
    );
  } finally {
    loading = false;
  }
}

function toggleIndicator(key) {
  if (!supported.has(key)) return;

  if (enabled.has(key)) enabled.delete(key);
  else enabled.add(key);

  updateButtons();
  updateIndicators();
}

function updateButtons() {
  document.querySelectorAll("[data-indicator]")
    .forEach(button => {
      const key = button.dataset.indicator;

      if (!supported.has(key)) {
        button.disabled = true;
        return;
      }

      const active = enabled.has(key);

      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    });
}

function speakRSI() {
  if (!("speechSynthesis" in window)) return;

  speechSynthesis.cancel();

  const speech = new SpeechSynthesisUtterance(
    currentRSIText || "El RSI no está disponible."
  );

  speech.lang = "es-MX";
  speech.rate = 0.95;

  speechSynthesis.speak(speech);
}

function setupEvents() {
  document.querySelectorAll("[data-indicator]")
    .forEach(button => {
      button.addEventListener("click", () => {
        toggleIndicator(button.dataset.indicator);
      });
    });

  $("refresh")?.addEventListener("click", refresh);

  $("chartNavigation")?.addEventListener("click", () => {
    setChartNavigation(!chartUnlocked);
  });

  $("chartReset")?.addEventListener("click", resetView);

  $("rsiSpeak")?.addEventListener("click", speakRSI);

  if ($("rsiSpeak") && "speechSynthesis" in window) {
    $("rsiSpeak").disabled = false;
    $("rsiSpeak").textContent = "🔊 Escuchar interpretación RSI";
  }

  for (const id of ["symbol", "interval", "market"]) {
    $(id)?.addEventListener("change", () => {
      lastMonitorAt = 0;
      refresh();
    });
  }

  const mapToggle = $("liquidityMapToggle");

  if (mapToggle) {
    mapToggle.checked = false;
    mapToggle.disabled = true;
  }

  updateButtons();
}

function init() {
  setupEvents();

  if (!createCharts()) return;

  refresh();

  // Respaldo por consultas periodicas.
  // WebSocket real requiere integracion con server.js.
  setInterval(refresh, 15000);

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) refresh();
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}

})();
