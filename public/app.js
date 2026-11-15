
const $ = id => document.getElementById(id);
const base = location.origin;

let chart, candles, volumes, latestRows = [], busy = false;
const activeIndicators = new Set(["ema21", "ma55"]);
const indicatorSeries = {};
const indicatorLines = {};
const indicatorColors = {
  ema21: "#a78bfa",
  ma55: "#fb923c",
  ma100: "#ef4444",
  ma200: "#60a5fa"
};
const lastLogged = {};
const logItems = [];

const fmt = (v, d = 4) =>
  v !== null && v !== undefined && v !== "" && Number.isFinite(Number(v))
    ? Number(v).toLocaleString("en-US", { maximumFractionDigits: d })
    : "—";

const pick = (o, keys) => {
  for (const k of keys) {
    if (o?.[k] !== undefined && o[k] !== null) return o[k];
  }
};

async function api(path) {
  const response = await fetch(base + path, { cache: "no-store" });
  const data = await response.json();
  if (!response.ok || data.error) {
    throw Error(data.error || `HTTP ${response.status}`);
  }
  return data;
}

function init() {
  const el = $("chart");
  if (!window.LightweightCharts) {
    $("message").textContent = "No se pudo cargar la librería de gráficas.";
    return;
  }

  chart = LightweightCharts.createChart(el, {
    width: el.clientWidth,
    height: window.innerWidth <= 750 ? 410 : 520,
    layout: {
      background: { color: "#111a2b" },
      textColor: "#b6c9e7"
    },
    grid: {
      vertLines: { color: "#243249" },
      horzLines: { color: "#243249" }
    },
    timeScale: {
      timeVisible: true,
      borderColor: "#30415b",
      barSpacing: 9
    },
    rightPriceScale: { borderColor: "#30415b" }
  });

  candles = chart.addCandlestickSeries({
    upColor: "#00e6a0",
    downColor: "#ff466b",
    borderUpColor: "#00e6a0",
    borderDownColor: "#ff466b",
    wickUpColor: "#00e6a0",
    wickDownColor: "#ff466b"
  });

  volumes = chart.addHistogramSeries({
    priceScaleId: "",
    priceFormat: { type: "volume" },
    scaleMargins: { top: 0.82, bottom: 0 }
  });

  for (const key of Object.keys(indicatorColors)) {
    indicatorSeries[key] = chart.addLineSeries({
      color: indicatorColors[key],
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: true,
      crosshairMarkerVisible: false
    });
  }

  if (typeof ResizeObserver !== "undefined") {
    new ResizeObserver(() => {
      chart.applyOptions({ width: el.clientWidth });
    }).observe(el);
  }
}

function normalize(data) {
  const source = Array.isArray(data)
    ? data
    : Array.isArray(data?.data)
      ? data.data
      : Array.isArray(data?.rows)
        ? data.rows
        : [];

  const rows = source.map(x => {
    let t, o, h, l, c, v;

    if (Array.isArray(x)) {
      [t, o, h, l, c, v] = x;
    } else {
      t = pick(x, ["time", "timestamp", "t"]);
      o = pick(x, ["open", "o"]);
      h = pick(x, ["high", "h"]);
      l = pick(x, ["low", "l"]);
      c = pick(x, ["close", "c"]);
      v = pick(x, ["volume", "vol", "v"]);
    }

    t = Number(t);
    if (t > 1e12) t = Math.floor(t / 1000);

    return {
      time: t,
      open: Number(o),
      high: Number(h),
      low: Number(l),
      close: Number(c),
      volume: Number(v || 0)
    };
  });

  return rows
    .filter(x =>
      x.time > 0 &&
      [x.open, x.high, x.low, x.close].every(Number.isFinite)
    )
    .sort((a, b) => a.time - b.time)
    .filter((x, i, a) => !i || x.time !== a[i - 1].time);
}

function ema(rows, period) {
  const output = [];
  const factor = 2 / (period + 1);
  let value = null;

  for (const row of rows) {
    value = value === null
      ? row.close
      : row.close * factor + value * (1 - factor);
    output.push(value);
  }

  return output;
}

function sma(rows, period) {
  const output = Array(rows.length).fill(null);
  let sum = 0;

  for (let i = 0; i < rows.length; i++) {
    sum += rows[i].close;
    if (i >= period) sum -= rows[i - period].close;
    if (i >= period - 1) output[i] = sum / period;
  }

  return output;
}

function rsi(rows, period = 14) {
  const output = Array(rows.length).fill(null);

  for (let i = period; i < rows.length; i++) {
    let gains = 0, losses = 0;

    for (let j = i - period + 1; j <= i; j++) {
      const difference = rows[j].close - rows[j - 1].close;
      if (difference > 0) gains += difference;
      else losses -= difference;
    }

    output[i] = losses === 0
      ? gains === 0 ? 50 : 100
      : 100 - 100 / (1 + gains / losses);
  }

  return output;
}

function adxApprox(rows, period = 14) {
  const output = Array(rows.length).fill(null);

  for (let i = period * 2; i < rows.length; i++) {
    let plus = 0, minus = 0, trSum = 0;

    for (let j = i - period + 1; j <= i; j++) {
      const up = rows[j].high - rows[j - 1].high;
      const down = rows[j - 1].low - rows[j].low;

      if (up > down && up > 0) plus += up;
      if (down > up && down > 0) minus += down;

      trSum += Math.max(
        rows[j].high - rows[j].low,
        Math.abs(rows[j].high - rows[j - 1].close),
        Math.abs(rows[j].low - rows[j - 1].close)
      );
    }

    const p = 100 * plus / (trSum || 1);
    const m = 100 * minus / (trSum || 1);
    output[i] = 100 * Math.abs(p - m) / ((p + m) || 1);
  }

  return output;
}

function updateIndicators() {
  if (!candles || !latestRows.length) return;

  const rows = latestRows;
  const values = {
    ema21: ema(rows, 21),
    ma55: sma(rows, 55),
    ma100: sma(rows, 100),
    ma200: sma(rows, 200)
  };

  for (const key of Object.keys(indicatorSeries)) {
    const series = indicatorSeries[key];

    const points = activeIndicators.has(key)
      ? rows.flatMap((row, index) =>
          Number.isFinite(values[key][index])
            ? [{ time: row.time, value: values[key][index] }]
            : []
        )
      : [];

    series.setData(points);
  }

  for (const key of ["support", "resistance"]) {
    if (indicatorLines[key]) {
      candles.removePriceLine(indicatorLines[key]);
      indicatorLines[key] = null;
    }
  }

  const closedRows = rows.slice(0, -1);
  const recent = closedRows.slice(-50);

  if (recent.length) {
    if (activeIndicators.has("support")) {
      indicatorLines.support = candles.createPriceLine({
        price: Math.min(...recent.map(x => x.low)),
        color: "#4ade80",
        lineWidth: 2,
        lineStyle: 2,
        axisLabelVisible: true,
        title: "Soporte 50"
      });
    }

    if (activeIndicators.has("resistance")) {
      indicatorLines.resistance = candles.createPriceLine({
        price: Math.max(...recent.map(x => x.high)),
        color: "#fb7185",
        lineWidth: 2,
        lineStyle: 2,
        axisLabelVisible: true,
        title: "Resistencia 50"
      });
    }
  }

  const last = rows.length - 2;
  const parts = [];

  if (activeIndicators.has("rsi") && last >= 14) {
    parts.push(`RSI 14: ${fmt(rsi(rows)[last], 1)}`);
  }

  if (activeIndicators.has("adx") && last >= 28) {
    parts.push(
      `ADX aproximado: ${fmt(adxApprox(rows)[last], 1)} (no Wilder)`
    );
  }

  const readout = $("indicatorReadout");
  if (readout) {
    readout.textContent = parts.length
      ? parts.join(" · ")
      : "Las medias se dibujan sobre el precio. Soportes y resistencias usan 50 velas cerradas.";
  }
}

function setupIndicatorButtons() {
  document.querySelectorAll("[data-indicator]").forEach(button => {
    const key = button.dataset.indicator;

    button.setAttribute(
      "aria-pressed",
      String(activeIndicators.has(key))
    );

    if (button.disabled) return;

    button.addEventListener("click", () => {
      if (activeIndicators.has(key)) {
        activeIndicators.delete(key);
      } else {
        activeIndicators.add(key);
      }

      button.setAttribute(
        "aria-pressed",
        String(activeIndicators.has(key))
      );

      updateIndicators();
    });
  });
}

function analyze(rows, tf, symbol) {
  if (rows.length < 70) {
    return {
      tf,
      symbol,
      label: "DATOS INSUFICIENTES",
      side: "WAIT",
      detail: "Se necesitan más velas para evaluar el mercado.",
      metrics: "—"
    };
  }

  const i = rows.length - 2;
  const x = rows[i];

  const e21 = ema(rows, 21);
  const e55 = ema(rows, 55);
  const rv = rsi(rows);
  const ax = adxApprox(rows);

  const bullish = e21[i] > e55[i] && x.close > e21[i];
  const bearish = e21[i] < e55[i] && x.close < e21[i];

  const r = rv[i];
  const a = ax[i] || 0;

  const previous = rows.slice(i - 20, i);
  const high = Math.max(...previous.map(z => z.high));
  const low = Math.min(...previous.map(z => z.low));

  const sweepLow = x.low < low && x.close > low;
  const sweepHigh = x.high > high && x.close < high;

  const bullFvg = i >= 2 && rows[i].low > rows[i - 2].high;
  const bearFvg = i >= 2 && rows[i].high < rows[i - 2].low;

  const momentum = e21[i] - e21[i - 4];
  const bullMom = momentum > 0;
  const bearMom = momentum < 0;

  let side = "WAIT";
  let reason = "No hay confluencia suficiente. NO HAY ENTRADA. ESPERAR.";

  if (
    bullish && bullMom && r > 50 && r < 75 &&
    a >= 18 && (sweepLow || bullFvg)
  ) {
    side = "LONG";
    reason = `Sesgo alcista; RSI ${fmt(r, 1)}; fuerza aproximada ${fmt(a, 1)}; ${sweepLow ? "barrido de mínimo" : "FVG alcista"}.`;
  } else if (
    bearish && bearMom && r < 50 && r > 25 &&
    a >= 18 && (sweepHigh || bearFvg)
  ) {
    side = "SHORT";
    reason = `Sesgo bajista; RSI ${fmt(r, 1)}; fuerza aproximada ${fmt(a, 1)}; ${sweepHigh ? "barrido de máximo" : "FVG bajista"}.`;
  }

  return {
    tf,
    symbol,
    side,
    label: side === "WAIT" ? "NO HAY ENTRADA" : `POSIBLE ${side}`,
    detail: reason,
    price: x.close,
    time: x.time,
    metrics: `EMA21 ${fmt(e21[i])} · EMA55 ${fmt(e55[i])} · RSI ${fmt(r, 1)} · Fuerza aprox. ${fmt(a, 1)}`
  };
}

function paintResult(result) {
  const suffix = result.tf === "5m" ? "5" : "15";

  $("state" + suffix).textContent = result.label;
  $("state" + suffix).className =
    "state " +
    (result.side === "LONG"
      ? "long"
      : result.side === "SHORT"
        ? "short"
        : "wait");

  $("detail" + suffix).textContent = result.detail;
  $("metrics" + suffix).textContent = result.metrics;
}

function logSignal(result, market) {
  if (!result.side || result.side === "WAIT") return;

  const key = `${market}:${result.symbol}:${result.tf}:${result.time}`;
  if (lastLogged[key]) return;
  lastLogged[key] = true;

  logItems.unshift({
    ...result,
    stamp: new Date().toLocaleTimeString()
  });

  if (logItems.length > 30) logItems.pop();

  $("signalLog").innerHTML = logItems.map(item => `
    <tr>
      <td>${item.stamp}</td>
      <td>${item.tf}</td>
      <td>${item.symbol}</td>
      <td class="${item.side === "LONG" ? "long" : "short"}">${item.label}</td>
      <td>${fmt(item.price)}</td>
      <td>${item.detail}</td>
      <td>EN OBSERVACIÓN</td>
    </tr>
  `).join("");
}

async function getCandles(symbol, market, interval) {
  const response = await api(
    `/api/market/${market}/klines/${symbol}?interval=${interval}&limit=300`
  );
  return normalize(response.data);
}

async function monitor(symbol, market) {
  document.querySelectorAll(".signal-grid h3").forEach((heading, index) => {
    heading.textContent =
      `${symbol} / ${index === 0 ? "5" : "15"} minutos`;
  });

  for (const tf of ["5m", "15m"]) {
    try {
      const rows = await getCandles(symbol, market, tf);
      const result = analyze(rows, tf, symbol);
      paintResult(result);
      logSignal(result, market);
    } catch (error) {
      const suffix = tf === "5m" ? "5" : "15";
      $("state" + suffix).textContent = "ERROR DE DATOS";
      $("detail" + suffix).textContent = error.message;
    }
  }
}

async function refresh() {
  if (busy) return;
  busy = true;

  const symbol = $("symbol").value;
  const market = $("market").value;
  const interval = $("interval").value;

  $("refresh").disabled = true;
  $("chartTitle").textContent = `${symbol} · ${interval}`;
  $("message").textContent = "Actualizando datos...";

  try {
    await api("/health");

    const [ticker, klines] = await Promise.all([
      api(`/api/market/${market}/ticker/${symbol}`),
      api(`/api/market/${market}/klines/${symbol}?interval=${interval}&limit=300`)
    ]);

    const data = ticker.data || {};

    $("price").textContent = fmt(
      pick(data, ["lastPrice", "last", "price", "close"])
    );

    const change = pick(data, ["priceChangePercent", "changePercent"]);
    $("change").textContent =
      change === undefined ? "—" : `${fmt(change, 2)}%`;
    $("change").style.color =
      Number(change) >= 0 ? "#00e6a0" : "#ff466b";

    $("high").textContent = fmt(pick(data, ["highPrice", "high"]));
    $("low").textContent = fmt(pick(data, ["lowPrice", "low"]));
    $("volume").textContent = fmt(
      pick(data, ["volume", "quoteVolume", "turnover"]), 2
    );
    $("bid").textContent = fmt(pick(data, ["bidPrice", "bid"]));
    $("ask").textContent = fmt(pick(data, ["askPrice", "ask"]));
    $("open").textContent = fmt(pick(data, ["openPrice", "open"]));

    const rows = normalize(klines.data);

    if (!rows.length) {
      throw Error("BingX no devolvió velas reconocibles.");
    }

    if (!candles) init();
    if (!candles) throw Error("No se pudo iniciar la gráfica.");

    candles.setData(rows.map(row => ({
      time: row.time,
      open: row.open,
      high: row.high,
      low: row.low,
      close: row.close
    })));

    volumes.setData(rows.map(row => ({
      time: row.time,
      value: row.volume,
      color: row.close >= row.open
        ? "rgba(0,230,160,.55)"
        : "rgba(255,70,107,.55)"
    })));

    latestRows = rows;
    updateIndicators();
    chart.timeScale().fitContent();

    $("message").textContent =
      `${rows.length} velas cargadas · Indicadores disponibles.`;

    $("connection").textContent = "● Conectado a BingX";
    $("connection").style.color = "#00e6a0";

    $("status").textContent =
      "Servidor activo; datos recibidos de BingX.";

    $("engineState").textContent = "MONITOREANDO";
    $("updated").textContent = new Date().toLocaleTimeString();

    await monitor(symbol, market);
  } catch (error) {
    $("message").textContent = error.message;
    $("connection").textContent = "● Sin conexión";
    $("connection").style.color = "#ff466b";
    $("status").textContent = error.message;
    $("engineState").textContent = "SIN DATOS";
  } finally {
    $("refresh").disabled = false;
    busy = false;
  }
}

document.addEventListener("DOMContentLoaded", () => {
  init();
  setupIndicatorButtons();

  $("refresh").addEventListener("click", refresh);

  ["symbol", "market", "interval"].forEach(id => {
    $(id).addEventListener("change", refresh);
  });

  refresh();
  setInterval(refresh, 30000);
});
