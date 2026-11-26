
/*
 CRYPTOLEXUZ PRO — APP.JS V26
 Compatible con index.html V34
 Lightweight Charts 4.2.2
 Terminal informativa sin ejecución de órdenes.
*/
"use strict";

(() => {
  if (window.__cryptolexuzAppV26) return;
  window.__cryptolexuzAppV26 = true;

  const $ = id => document.getElementById(id);
  const C = {
    green: "#00f5a0",
    red: "#ff476c",
    purple: "#bb52ff",
    orange: "#ff9a35",
    blue: "#36c5ff",
    yellow: "#ffe15a"
  };

  const GOLD = "NCCOGOLD2USD-USDT";
  const OIL = "NCCO1OILWTI2USD-USDT";

  const ASSETS = [
    "BTC-USDT", "ETH-USDT", "BNB-USDT",
    "SOL-USDT", "XRP-USDT", "DOGE-USDT",
    GOLD, OIL
  ];

  const TF = [
    "1m", "3m", "5m", "15m", "30m",
    "1h", "2h", "4h", "6h", "8h",
    "12h", "1d", "3d", "1w", "1M"
  ];

  const SCAN_TF = [
    "1d", "4h", "1h", "30m", "15m", "5m", "1m"
  ];

  const SEC = {
    "1m": 60, "3m": 180, "5m": 300,
    "15m": 900, "30m": 1800,
    "1h": 3600, "2h": 7200, "4h": 14400,
    "6h": 21600, "8h": 28800,
    "12h": 43200, "1d": 86400,
    "3d": 259200, "1w": 604800,
    "1M": 2592000
  };

  const SETTINGS_KEY =
    "cryptolexuz-chart-settings-v1";
  const HISTORY_KEY =
    "cryptolexuz-v16-history";

  const DEFAULTS = {
    maLines: [
      { period: 55, color: C.orange, width: 2, enabled: true },
      { period: 100, color: C.red, width: 3, enabled: false },
      { period: 200, color: C.blue, width: 2, enabled: false }
    ],
    emaLines: [
      { period: 21, color: C.purple, width: 2, enabled: true }
    ],
    height: 360,
    options: {
      countdown: true,
      multiperiod: true,
      bidask: false
    },
    indicators: {
      MA: true, EMA: true, VOL: true,
      RSI: true, ADX: false, AO: false,
      FVG: true, IFVG: false,
      liquidity: false, sweeps: false,
      support: false, resistance: false
    }
  };

  const charts = {};
  const series = {};
  const moving = new Map();
  const levelLines = [];
  const cache = new Map();
  const timers = [];

  let prefs = readSettings();
  let rows = [];
  let zones = [];
  let pivots = [];
  let history = [];
  let currentKey = "";
  let generation = 0;
  let scanGeneration = 0;
  let socket = null;
  let socketToken = 0;
  let reconnectTimer = null;
  let chartBusy = false;
  let tickerBusy = false;
  let monitorBusy = false;
  let scanBusy = false;
  let verifyBusy = false;
  let chartAgain = false;
  let monitorAgain = false;
  let scanAgain = false;
  let lastWS = 0;
  let scanLast = 0;
  let monitorLast = 0;
  let lastRSI = "RSI no disponible.";
  let resizePending = false;
  let overlayPending = false;
  let syncingRange = false;
  let profileModule = null;

  const now = () => Math.floor(Date.now() / 1000);

  function put(id, value) {
    const element = $(id);
    if (element) element.textContent = String(value);
  }

  function fmt(value, digits = 2) {
    if (value === null || value === undefined || value === "") {
      return "—";
    }
    const number = Number(value);
    if (!Number.isFinite(number)) return "—";
    return number.toLocaleString("en-US", {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits
    });
  }

  function emit(name, detail = {}) {
    window.dispatchEvent(new CustomEvent(name, { detail }));
  }

  function readSettings() {
    let saved = {};
    try {
      saved = JSON.parse(
        localStorage.getItem(SETTINGS_KEY) || "{}"
      ) || {};
    } catch {}

    const normalizeLines = (input, defaults) =>
      (Array.isArray(input) ? input : defaults)
        .slice(0, 12)
        .map(line => ({
          period: Math.max(1, Math.min(1000,
            Math.round(Number(line.period) || 21))),
          color: /^#[0-9a-f]{6}$/i.test(line.color)
            ? line.color : C.purple,
          width: Math.max(1, Math.min(5,
            Number(line.width) || 2)),
          enabled: line.enabled !== false
        }));

    return {
      maLines: normalizeLines(
        saved.maLines, DEFAULTS.maLines
      ),
      emaLines: normalizeLines(
        saved.emaLines, DEFAULTS.emaLines
      ),
      height: Math.max(240, Math.min(600,
        Number(saved.height) || 360)),
      options: {
        ...DEFAULTS.options,
        ...(saved.options || {})
      },
      indicators: {
        ...DEFAULTS.indicators,
        ...(saved.indicators || {})
      }
    };
  }

  function saveSettings() {
    try {
      localStorage.setItem(
        SETTINGS_KEY, JSON.stringify(prefs)
      );
    } catch (error) {
      console.warn("Ajustes:", error);
    }
  }

  function selection() {
    const symbol = $("symbol")?.value || "BTC-USDT";
    const commodity = symbol === GOLD || symbol === OIL;
    return {
      symbol,
      tf: $("interval")?.value || "15m",
      exchange: commodity ? "bingx" :
        ($("exchange")?.value || "bingx").toLowerCase(),
      market: commodity ? "perpetual" :
        ($("market")?.value || "perpetual").toLowerCase()
    };
  }

  function key(s) {
    return [s.exchange, s.market, s.symbol, s.tf].join("|");
  }

  function syncCommodity() {
    if (![GOLD, OIL].includes($("symbol")?.value)) return;
    if ($("exchange")) $("exchange").value = "bingx";
    if ($("market")) $("market").value = "perpetual";
  }

  function populateTimeframes() {
    const select = $("interval");
    if (!select) return;
    const previous = select.value || "15m";
    for (const tf of TF) {
      if (![...select.options].some(o => o.value === tf)) {
        const option = document.createElement("option");
        option.value = tf;
        option.textContent = tf;
        select.add(option);
      }
    }
    select.value = SEC[previous] ? previous : "15m";
    syncTimeframes();
  }

  function syncTimeframes() {
    const tf = selection().tf;
    document.querySelectorAll(
      "[data-tf], [data-cl-tf]"
    ).forEach(button => {
      const active =
        (button.dataset.tf || button.dataset.clTf) === tf;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    });
    put("chartTitle", selection().symbol + " · " + tf);
  }

  function changeTimeframe(tf) {
    if (!SEC[tf] || !$("interval")) return;
    const select = $("interval");
    if (select.value === tf) {
      syncTimeframes();
      return;
    }
    select.value = tf;
    select.dispatchEvent(
      new Event("change", { bubbles: true })
    );
  }

  function connection(message, color = C.yellow) {
    put("connection", "● " + message);
    if ($("connection")) {
      $("connection").style.color = color;
    }
  }

  function timestamp(value) {
    const n = typeof value === "string" &&
      !/^\d+$/.test(value)
      ? Date.parse(value) : Number(value);
    return Number.isFinite(n)
      ? Math.floor(n > 1e12 ? n / 1000 : n)
      : NaN;
  }

  function normalize(payload) {
    const source = [
      payload?.data?.data,
      payload?.data?.list,
      payload?.data?.candles,
      payload?.data,
      payload?.list,
      payload?.candles,
      payload
    ].find(Array.isArray) || [];

    const result = [];

    for (const item of source) {
      if (!item) continue;
      const a = Array.isArray(item);
      const candle = {
        time: timestamp(a ? item[0] :
          item.time ?? item.timestamp ??
          item.openTime ?? item.t),
        open: Number(a ? item[1] : item.open ?? item.o),
        high: Number(a ? item[2] : item.high ?? item.h),
        low: Number(a ? item[3] : item.low ?? item.l),
        close: Number(a ? item[4] : item.close ?? item.c),
        volume: Number(a ? item[5] :
          item.volume ?? item.vol ?? item.v ?? 0)
      };
      if (!Object.values(candle).every(Number.isFinite)) {
        continue;
      }
      if (
        candle.time <= 0 ||
        candle.time > now() + 60 ||
        candle.low <= 0 ||
        candle.volume < 0 ||
        candle.high < Math.max(
          candle.open, candle.close, candle.low
        ) ||
        candle.low > Math.min(candle.open, candle.close)
      ) continue;
      result.push(candle);
    }

    result.sort((a, b) => a.time - b.time);
    return [...new Map(
      result.map(c => [c.time, c])
    ).values()];
  }

  function closed(data, tf) {
    const seconds = SEC[tf] || 60;
    return data.filter(
      c => c.time + seconds <= now() - 2
    );
  }

  function sma(values, period) {
    const out = Array(values.length).fill(null);
    period = Math.floor(Number(period));
    if (!Number.isFinite(period) || period < 1) {
      return out;
    }
    let sum = 0;
    for (let i = 0; i < values.length; i++) {
      sum += values[i];
      if (i >= period) sum -= values[i - period];
      if (i >= period - 1) out[i] = sum / period;
    }
    return out;
  }

  function ema(values, period) {
    const out = Array(values.length).fill(null);
    period = Math.floor(Number(period));
    if (period < 1 || values.length < period) return out;
    let value = values.slice(0, period)
      .reduce((a, b) => a + b, 0) / period;
    out[period - 1] = value;
    for (let i = period; i < values.length; i++) {
      value += (values[i] - value) * 2 / (period + 1);
      out[i] = value;
    }
    return out;
  }

  function rsi(values, period = 14) {
    const out = Array(values.length).fill(null);
    if (values.length <= period) return out;
    let gains = 0, losses = 0;
    for (let i = 1; i <= period; i++) {
      const delta = values[i] - values[i - 1];
      gains += Math.max(delta, 0);
      losses += Math.max(-delta, 0);
    }
    gains /= period;
    losses /= period;
    const calc = () => losses === 0
      ? gains === 0 ? 50 : 100
      : 100 - 100 / (1 + gains / losses);
    out[period] = calc();
    for (let i = period + 1; i < values.length; i++) {
      const delta = values[i] - values[i - 1];
      gains = (gains * (period - 1) +
        Math.max(delta, 0)) / period;
      losses = (losses * (period - 1) +
        Math.max(-delta, 0)) / period;
      out[i] = calc();
    }
    return out;
  }

  function adx(data, period = 14) {
    const n = data.length;
    const ax = Array(n).fill(null);
    const plus = Array(n).fill(null);
    const minus = Array(n).fill(null);
    if (n < 2 * period) {
      return { adx: ax, plus, minus };
    }
    const tr = [], up = [], down = [], dx = [];
    for (let i = 1; i < n; i++) {
      const h = data[i].high - data[i - 1].high;
      const l = data[i - 1].low - data[i].low;
      tr[i] = Math.max(
        data[i].high - data[i].low,
        Math.abs(data[i].high - data[i - 1].close),
        Math.abs(data[i].low - data[i - 1].close)
      );
      up[i] = h > l && h > 0 ? h : 0;
      down[i] = l > h && l > 0 ? l : 0;
    }
    let totalTR = 0, totalPlus = 0, totalMinus = 0;
    for (let i = 1; i <= period; i++) {
      totalTR += tr[i];
      totalPlus += up[i];
      totalMinus += down[i];
    }
    for (let i = period; i < n; i++) {
      if (i > period) {
        totalTR = totalTR - totalTR / period + tr[i];
        totalPlus = totalPlus -
          totalPlus / period + up[i];
        totalMinus = totalMinus -
          totalMinus / period + down[i];
      }
      plus[i] = totalTR ? 100 * totalPlus / totalTR : 0;
      minus[i] = totalTR ? 100 * totalMinus / totalTR : 0;
      const sum = plus[i] + minus[i];
      dx[i] = sum
        ? 100 * Math.abs(plus[i] - minus[i]) / sum : 0;
    }
    let totalDX = 0;
    for (let i = period; i < 2 * period; i++) {
      totalDX += dx[i];
    }
    ax[2 * period - 1] = totalDX / period;
    for (let i = 2 * period; i < n; i++) {
      ax[i] = (
        ax[i - 1] * (period - 1) + dx[i]
      ) / period;
    }
    return { adx: ax, plus, minus };
  }

  function atr(data, period = 14) {
    if (data.length < period + 1) return null;
    const ranges = [];
    for (let i = 1; i < data.length; i++) {
      ranges.push(Math.max(
        data[i].high - data[i].low,
        Math.abs(data[i].high - data[i - 1].close),
        Math.abs(data[i].low - data[i - 1].close)
      ));
    }
    let value = ranges.slice(0, period)
      .reduce((a, b) => a + b, 0) / period;
    for (let i = period; i < ranges.length; i++) {
      value = (
        value * (period - 1) + ranges[i]
      ) / period;
    }
    return value;
  }

  function awesomeOscillator(data) {
    const median = data.map(
      c => (c.high + c.low) / 2
    );
    const fast = sma(median, 5);
    const slow = sma(median, 34);
    return median.map((_, i) =>
      Number.isFinite(fast[i]) &&
      Number.isFinite(slow[i])
        ? fast[i] - slow[i] : null
    );
  }

  function lineData(data, values) {
    return data.flatMap((c, i) =>
      Number.isFinite(values[i])
        ? [{ time: c.time, value: values[i] }]
        : []
    );
  }

  function volumeBar(c) {
    return {
      time: c.time,
      value: c.volume,
      color: c.close >= c.open
        ? "rgba(0,245,160,.7)"
        : "rgba(255,71,108,.7)"
    };
  }

  function aoBars(data, values) {
    return data.flatMap((c, i) => {
      if (!Number.isFinite(values[i])) return [];
      return [{
        time: c.time,
        value: values[i],
        color: !Number.isFinite(values[i - 1]) ||
          values[i] >= values[i - 1]
          ? C.green : C.red
      }];
    });
  }

  function chartOptions(height) {
    return {
      width: 300,
      height,
      layout: {
        background: { type: "solid", color: "#000000" },
        textColor: "#c9d3ee",
        fontSize: 11
      },
      grid: {
        vertLines: { color: "#141414" },
        horzLines: { color: "#141414" }
      },
      rightPriceScale: {
        borderColor: "#343434",
        minimumWidth: 65
      },
      timeScale: {
        borderColor: "#343434",
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 5,
        barSpacing: 9,
        minBarSpacing: 2
      },
      crosshair: {
        mode: LightweightCharts.CrosshairMode.Normal
      },
      handleScroll: {
        mouseWheel: false,
        pressedMouseMove: true,
        horzTouchDrag: true,
        vertTouchDrag: false
      },
      handleScale: {
        mouseWheel: true,
        pinch: true,
        axisPressedMouseMove: {
          time: true,
          price: true
        },
        axisDoubleClickReset: true
      },
      kineticScroll: { touch: true, mouse: true }
    };
  }

  function indicatorKey(name) {
    const map = {
      ma: "MA", ema: "EMA",
      vol: "VOL", volume: "VOL",
      rsi: "RSI", adx: "ADX", ao: "AO",
      fvg: "FVG", ifvg: "IFVG",
      liquidity: "liquidity",
      sweeps: "sweeps",
      support: "support",
      resistance: "resistance"
    };
    return map[String(name).toLowerCase()] || null;
  }

  const namedLines = {
    ema21: ["emaLines", "EMA", 21],
    ma55: ["maLines", "MA", 55],
    ma100: ["maLines", "MA", 100],
    ma200: ["maLines", "MA", 200]
  };

  function indicatorActive(name) {
    const normalized = String(name).toLowerCase();
    if (namedLines[normalized]) {
      const [list, group, period] = namedLines[normalized];
      return prefs.indicators[group] !== false &&
        prefs[list].some(line =>
          line.period === period && line.enabled !== false
        );
    }
    const k = indicatorKey(name);
    return k ? prefs.indicators[k] === true : false;
  }

  function updateButtons() {
    document.querySelectorAll(
      "[data-indicator], [data-osc]"
    ).forEach(button => {
      const name = button.dataset.indicator ||
        button.dataset.osc;
      const active = indicatorActive(name);
      button.classList.toggle("active", active);
      button.setAttribute(
        "aria-pressed", String(active)
      );
    });
  }

  function updatePanels() {
    const panels = {
      rsiSection: "RSI",
      adxSection: "ADX",
      aoSection: "AO"
    };
    for (const [id, name] of Object.entries(panels)) {
      if ($(id)) {
        $(id).hidden = !prefs.indicators[name];
      }
    }
    const volume = $("volumeChart")
      ?.closest(".volume-section");
    if (volume) {
      volume.hidden = !prefs.indicators.VOL;
    }
    scheduleResize();
  }

  function updateMoving(force = false) {
    if (!charts.price || !rows.length) return;

    const closes = rows.map(c => c.close);
    const configs = [
      ...prefs.maLines.map(line => ({
        ...line, method: "sma", group: "MA"
      })),
      ...prefs.emaLines.map(line => ({
        ...line, method: "ema", group: "EMA"
      }))
    ];

    const wanted = new Set();

    configs.forEach((line, index) => {
      const id = line.method + ":" +
        line.period + ":" + index;
      wanted.add(id);

      let target = moving.get(id);
      if (!target) {
        target = charts.price.addLineSeries({
          color: line.color,
          lineWidth: line.width,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false
        });
        moving.set(id, target);
      } else {
        target.applyOptions({
          color: line.color,
          lineWidth: line.width
        });
      }

      const active = line.enabled !== false &&
        prefs.indicators[line.group] !== false;

      const values = line.method === "ema"
        ? ema(closes, line.period)
        : sma(closes, line.period);

      target.setData(active
        ? lineData(rows, values) : []);
    });

    for (const [id, target] of moving) {
      if (!wanted.has(id)) {
        try {
          charts.price.removeSeries(target);
        } catch {}
        moving.delete(id);
      }
    }
  }

  function setIndicator(name, active) {
    const normalized = String(name).toLowerCase();
    if (namedLines[normalized]) {
      const [list, group, period] =
        namedLines[normalized];
      let line = prefs[list].find(
        item => item.period === period
      );
      if (!line) {
        const defaults = group === "EMA"
          ? DEFAULTS.emaLines : DEFAULTS.maLines;
        line = {
          ...(defaults.find(x => x.period === period) ||
            {
              period, color: C.purple,
              width: 2, enabled: false
            })
        };
        prefs[list].push(line);
      }
      line.enabled = Boolean(active);
      if (active) prefs.indicators[group] = true;
    } else {
      const k = indicatorKey(name);
      if (!k) return;
      prefs.indicators[k] = Boolean(active);
    }

    saveSettings();
    updateButtons();
    updatePanels();
    updateIndicators(true);
    emit("cryptolexuz:indicator-state-updated", {
      settings: prefs
    });
  }

  function toggleIndicator(name) {
    setIndicator(name, !indicatorActive(name));
  }

  function applySavedIndicators() {
    prefs = readSettings();
    if ($("chart")) {
      $("chart").style.height = prefs.height + "px";
    }
    updateButtons();
    updatePanels();
    updateIndicators(true);
    scheduleResize();
  }

  function createCharts() {
    if (!window.LightweightCharts || !$("chart")) {
      put("message",
        "No se pudo cargar Lightweight Charts.");
      connection("Error de gráfica", C.red);
      return false;
    }

    charts.price = LightweightCharts.createChart(
      $("chart"),
      chartOptions($("chart").clientHeight || 360)
    );

    series.price = charts.price.addCandlestickSeries({
      upColor: C.green,
      downColor: C.red,
      wickUpColor: C.green,
      wickDownColor: C.red,
      borderVisible: false
    });

    for (const [name, id, height] of [
      ["volume", "volumeChart", 115],
      ["rsi", "rsiChart", 145],
      ["adx", "adxChart", 145],
      ["ao", "aoChart", 145]
    ]) {
      if ($(id)) {
        charts[name] = LightweightCharts.createChart(
          $(id), chartOptions(height)
        );
      }
    }

    if (charts.volume) {
      series.volume = charts.volume.addHistogramSeries({
        priceFormat: { type: "volume" },
        priceScaleId: ""
      });
      series.volume.priceScale().applyOptions({
        scaleMargins: { top: 0.12, bottom: 0 }
      });
    }

    if (charts.rsi) {
      series.rsi = charts.rsi.addLineSeries({
        color: C.purple,
        lineWidth: 2,
        priceLineVisible: false
      });
      for (const price of [30, 50, 70]) {
        series.rsi.createPriceLine({
          price,
          color: "#657399",
          lineStyle: LightweightCharts.LineStyle.Dashed,
          axisLabelVisible: true
        });
      }
    }

    if (charts.adx) {
      for (const [name, color] of [
        ["adx", C.yellow],
        ["plus", C.green],
        ["minus", C.red]
      ]) {
        series[name] = charts.adx.addLineSeries({
          color,
          lineWidth: 2,
          priceLineVisible: false
        });
      }
    }

    if (charts.ao) {
      series.ao = charts.ao.addHistogramSeries({
        priceFormat: {
          type: "price",
          precision: 5,
          minMove: 0.00001
        },
        priceScaleId: ""
      });
      series.ao.createPriceLine({
        price: 0,
        color: "#657399",
        lineStyle: LightweightCharts.LineStyle.Dashed,
        axisLabelVisible: true
      });
    }

    charts.price.timeScale()
      .subscribeVisibleLogicalRangeChange(range => {
        if (syncingRange || !range) return;
        syncingRange = true;
        try {
          for (const name of [
            "volume", "rsi", "adx", "ao"
          ]) {
            charts[name]?.timeScale()
              .setVisibleLogicalRange(range);
          }
        } catch {}
        syncingRange = false;
        scheduleOverlay();
      });

    if (window.ResizeObserver) {
      const observer = new ResizeObserver(scheduleResize);
      for (const id of [
        "chart", "volumeChart", "rsiChart",
        "adxChart", "aoChart"
      ]) {
        if ($(id)) observer.observe($(id));
      }
    }

    window.addEventListener("resize", scheduleResize);

    window.CryptolexuzChart = {
      chart: charts.price,
      chartApi: charts.price,
      candle: series.price,
      candleSeries: series.price,
      getRows: () => rows,
      getCandles: () => rows,
      getSelection: selection,
      timeScale: () => charts.price.timeScale(),
      applyOptions: options =>
        charts.price.applyOptions(options),
      resetView,
      resize
    };

    window.clChart = charts.price;
    window.chartApi = charts.price;

    emit("cryptolexuz:chart-ready", {
      chart: charts.price,
      candle: series.price,
      candleSeries: series.price,
      rows,
      candles: rows,
      getRows: () => rows,
      getSelection: selection
    });

    try {
      window.CryptolexuzFibonacci?.attach?.(
        charts.price, series.price,
        { getRows: () => rows, getSelection: selection }
      );
    } catch (error) {
      console.warn("Fibonacci:", error);
    }

    attachVolumeProfile();
    scheduleResize();
    return true;
  }

  function resize() {
    for (const [name, id, fallback] of [
      ["price", "chart", 360],
      ["volume", "volumeChart", 115],
      ["rsi", "rsiChart", 145],
      ["adx", "adxChart", 145],
      ["ao", "aoChart", 145]
    ]) {
      const element = $(id);
      if (!element || !charts[name] ||
          element.clientWidth <= 0) continue;
      charts[name].resize(
        Math.round(element.clientWidth),
        name === "price"
          ? Math.max(240, element.clientHeight || fallback)
          : fallback
      );
    }
    scheduleOverlay();
    redrawModules();
  }

  function scheduleResize() {
    if (resizePending) return;
    resizePending = true;
    requestAnimationFrame(() => {
      resizePending = false;
      resize();
    });
  }

  function resetView() {
    if (!charts.price || !rows.length) return;
    try {
      charts.price.timeScale().setVisibleLogicalRange({
        from: Math.max(0, rows.length - 50),
        to: rows.length + 3
      });
    } catch {}
  }

  function detectPivots(data) {
    const output = [];
    for (let i = 4; i < data.length - 4; i++) {
      const near = data.slice(i - 4, i + 5);
      if (near.every((c, j) =>
        j === 4 || c.high < data[i].high)) {
        output.push({
          index: i, price: data[i].high, type: "high"
        });
      }
      if (near.every((c, j) =>
        j === 4 || c.low > data[i].low)) {
        output.push({
          index: i, price: data[i].low, type: "low"
        });
      }
    }
    return output.slice(-40);
  }

  function detectFVG(data) {
    const result = [];
    for (let i = 2; i < data.length; i++) {
      const bull = data[i].low > data[i - 2].high;
      const bear = data[i].high < data[i - 2].low;
      if (!bull && !bear) continue;

      const top = bull
        ? data[i].low : data[i - 2].low;
      const bottom = bull
        ? data[i - 2].high : data[i].high;

      if ((top - bottom) / ((top + bottom) / 2)
          < 0.00035) continue;

      let end = data.length - 1;
      let filled = false;
      let inverted = false;

      for (let j = i + 1; j < data.length; j++) {
        const touched = bull
          ? data[j].low <= bottom
          : data[j].high >= top;
        if (touched) {
          end = j;
          filled = true;
          inverted = bull
            ? data[j].close < bottom
            : data[j].close > top;
          break;
        }
      }

      result.push({
        start: i - 2, end,
        top, bottom, bull, filled, inverted
      });
    }
    return result.slice(-80);
  }

  function detectSweeps(data) {
    const result = [];
    for (let i = 20; i < data.length - 1; i++) {
      const previous = data.slice(i - 20, i);
      const high = Math.max(
        ...previous.map(c => c.high)
      );
      const low = Math.min(
        ...previous.map(c => c.low)
      );

      if (data[i].high > high && data[i].close < high) {
        result.push({
          time: data[i].time,
          position: "aboveBar",
          color: C.red,
          shape: "arrowDown",
          text: "Barrido ↑"
        });
      }

      if (data[i].low < low && data[i].close > low) {
        result.push({
          time: data[i].time,
          position: "belowBar",
          color: C.green,
          shape: "arrowUp",
          text: "Barrido ↓"
        });
      }
    }
    return result.slice(-25);
  }

  function updateLevels() {
    if (!series.price) return;

    for (const line of levelLines) {
      try {
        series.price.removePriceLine(line);
      } catch {}
    }
    levelLines.length = 0;

    const requested = [];
    const recent = pivots.slice(-18);

    if (prefs.indicators.support) {
      const p = recent.filter(
        x => x.type === "low"
      ).at(-1);
      if (p) requested.push([
        p.price, C.green, "Soporte"
      ]);
    }

    if (prefs.indicators.resistance) {
      const p = recent.filter(
        x => x.type === "high"
      ).at(-1);
      if (p) requested.push([
        p.price, C.red, "Resistencia"
      ]);
    }

    if (prefs.indicators.liquidity) {
      for (const p of recent.filter(
        x => x.type === "high"
      ).slice(-2)) {
        requested.push([p.price, C.red, "Máximo"]);
      }
      for (const p of recent.filter(
        x => x.type === "low"
      ).slice(-2)) {
        requested.push([p.price, C.green, "Mínimo"]);
      }
    }

    for (const [price, color, title] of requested) {
      levelLines.push(
        series.price.createPriceLine({
          price, color, title,
          lineWidth: 1,
          lineStyle: LightweightCharts.LineStyle.Dashed,
          axisLabelVisible: true
        })
      );
    }
  }

  function drawZones() {
    const canvas = $("zonesCanvas");
    const area = $("priceChartArea");
    if (!canvas || !area || !charts.price ||
        !series.price) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = Math.min(devicePixelRatio || 1, 2);
    const width = area.clientWidth;
    const height = area.clientHeight;

    if (!width || !height) return;

    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.pointerEvents = "none";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    if (!prefs.indicators.FVG &&
        !prefs.indicators.IFVG) return;

    const scale = charts.price.timeScale();

    for (const zone of zones.slice(-25)) {
      const show =
        (!zone.filled && prefs.indicators.FVG) ||
        (zone.inverted && prefs.indicators.IFVG);
      if (!show) continue;

      const x1 = scale.logicalToCoordinate(zone.start);
      const x2 = scale.logicalToCoordinate(zone.end);
      const y1 = series.price.priceToCoordinate(zone.top);
      const y2 = series.price.priceToCoordinate(zone.bottom);

      if (![x1, x2, y1, y2].every(Number.isFinite)) {
        continue;
      }

      const left = Math.max(0, x1);
      const right = Math.min(width - 70, x2);
      const top = Math.max(0, Math.min(y1, y2));
      const bottom = Math.min(
        height, Math.max(y1, y2)
      );

      if (right <= left || bottom <= top) continue;

      ctx.fillStyle = zone.inverted
        ? "rgba(255,225,90,.12)"
        : zone.bull
          ? "rgba(0,245,160,.09)"
          : "rgba(255,71,108,.09)";
      ctx.fillRect(
        left, top, right - left, bottom - top
      );

      ctx.strokeStyle = zone.inverted
        ? "#ffe15a"
        : zone.bull
          ? "rgba(0,245,160,.4)"
          : "rgba(255,71,108,.4)";
      ctx.strokeRect(
        left, top, right - left, bottom - top
      );
    }
  }

  function scheduleOverlay() {
    if (overlayPending) return;
    overlayPending = true;
    requestAnimationFrame(() => {
      overlayPending = false;
      drawZones();
    });
  }

  function updateIndicators(force = false) {
    if (!rows.length || !series.price) return;

    const closes = rows.map(c => c.close);
    const e = ema(closes, 21);
    const m = sma(closes, 55);
    const rv = rsi(closes);
    const av = adx(rows);
    const ao = awesomeOscillator(rows);

    updateMoving(force);

    series.rsi?.setData(
      prefs.indicators.RSI ? lineData(rows, rv) : []
    );

    for (const [name, values] of [
      ["adx", av.adx],
      ["plus", av.plus],
      ["minus", av.minus]
    ]) {
      series[name]?.setData(
        prefs.indicators.ADX
          ? lineData(rows, values) : []
      );
    }

    series.ao?.setData(
      prefs.indicators.AO
        ? rows.flatMap((c, i) =>
            Number.isFinite(ao[i]) ? [{
              time: c.time,
              value: ao[i],
              color: !Number.isFinite(ao[i - 1]) ||
                ao[i] >= ao[i - 1]
                ? C.green : C.red
            }] : [])
        : []
    );

    const valid = closed(rows, selection().tf);
    const last = valid.at(-1);
    const index = rows.findIndex(
      c => c.time === last?.time
    );

    if (index >= 0) {
      for (const [id, value, digits] of [
        ["ema21Value", e[index], 2],
        ["ma55Value", m[index], 2],
        ["rsiValue", rv[index], 1],
        ["adxValue", av.adx[index], 1],
        ["rsiChartValue", rv[index], 1],
        ["adxChartValue", av.adx[index], 1],
        ["aoValue", ao[index], 5]
      ]) {
        put(id, fmt(value, digits));
      }

      const r = rv[index];
      lastRSI = !Number.isFinite(r)
        ? "RSI no disponible."
        : r < 30
          ? "RSI en sobreventa; rebote no confirmado."
          : r > 70
            ? "RSI en sobrecompra; caída no confirmada."
            : r >= 50
              ? "RSI con predominio comprador."
              : "RSI con predominio vendedor.";

      put("rsiInterpretation", lastRSI);

      const strength = av.adx[index];
      put("adxInterpretation",
        Number.isFinite(strength)
          ? "ADX " + fmt(strength, 1) +
            (strength >= 25
              ? ". Tendencia con fuerza."
              : ". Tendencia débil.")
          : "ADX no disponible."
      );

      const aoNow = ao[index];
      const aoPrev = ao[index - 1];
      put("aoInterpretation",
        !Number.isFinite(aoNow)
          ? "AO sin datos suficientes."
          : aoNow > 0 && aoNow > aoPrev
            ? "AO positivo con impulso creciente."
            : aoNow < 0 && aoNow < aoPrev
              ? "AO negativo con impulso bajista."
              : "AO sin confirmación de impulso."
      );

      let trend = "Historial insuficiente";
      if (Number.isFinite(e[index]) &&
          Number.isFinite(m[index])) {
        trend = closes[index] > e[index] &&
          e[index] > m[index]
          ? "Sesgo alcista"
          : closes[index] < e[index] &&
            e[index] < m[index]
            ? "Sesgo bajista"
            : "Mercado mixto";
      }

      put("indicatorReadout",
        trend + ". " + lastRSI);
    }

    if (valid.length >= 21) {
      const previous = valid.slice(-21, -1);
      const average = previous.reduce(
        (sum, c) => sum + c.volume, 0
      ) / previous.length;
      put("volumeInterpretation",
        average > 0
          ? "Volumen de última vela cerrada: " +
            fmt(valid.at(-1).volume / average) +
            " veces el promedio."
          : "Volumen insuficiente."
      );
    }

    const analysisRows = valid.length
      ? valid : rows.slice(0, -1);

    pivots = detectPivots(analysisRows);
    zones = detectFVG(analysisRows);

    updateLevels();

    series.price.setMarkers(
      prefs.indicators.sweeps
        ? detectSweeps(analysisRows) : []
    );

    scheduleOverlay();
  }

  function attachVolumeProfile() {
    const vp = window.CryptolexuzVolumeProfile ||
      window.CRYPTOLEXUZ_VOLUME_PROFILE;
    if (!vp || !charts.price || !series.price) return;
    if (vp === profileModule) return;

    try {
      vp.attach?.(charts.price, series.price, {
        getRows: () => rows,
        getCandles: () => rows,
        getSelection: selection
      });
      profileModule = vp;
    } catch (error) {
      console.warn("Volume Profile:", error);
    }
  }

  function redrawModules() {
    try {
      window.CryptolexuzFibonacci?.redraw?.();
      window.CryptolexuzRangeBoxes?.redraw?.();
      (window.CryptolexuzVolumeProfile ||
        window.CRYPTOLEXUZ_VOLUME_PROFILE)?.redraw?.();
    } catch (error) {
      console.warn("Redibujado:", error);
    }
  }

  function updateModules(force = false) {
    attachVolumeProfile();
    const vp = window.CryptolexuzVolumeProfile ||
      window.CRYPTOLEXUZ_VOLUME_PROFILE;

    try {
      if (typeof vp?.setData === "function") {
        vp.setData(rows);
      } else {
        vp?.updateData?.(rows);
      }
    } catch (error) {
      console.warn("Volume Profile:", error);
    }

    emit("cryptolexuz:candles-updated", {
      chart: charts.price,
      candle: series.price,
      candleSeries: series.price,
      rows,
      candles: rows,
      selection: selection(),
      force
    });

    if (force) redrawModules();
  }

  async function getJSON(url, timeout = 12000) {
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(), timeout
    );
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        cache: "no-store"
      });
      if (!response.ok) {
        throw new Error("HTTP " + response.status);
      }
      const payload = await response.json();
      if (payload?.code !== undefined &&
          ![0, "0"].includes(payload.code)) {
        throw new Error(
          payload.msg || payload.message ||
          "Error del exchange"
        );
      }
      return payload;
    } finally {
      clearTimeout(timer);
    }
  }

  function candleURL(s, limit = 300) {
    return "/api/exchange/" +
      encodeURIComponent(s.exchange) +
      "/klines/" +
      encodeURIComponent(s.symbol) +
      "?market=" + encodeURIComponent(s.market) +
      "&interval=" + encodeURIComponent(s.tf) +
      "&limit=" + limit;
  }

  function tickerURL(s) {
    return "/api/exchange/" +
      encodeURIComponent(s.exchange) +
      "/ticker/" +
      encodeURIComponent(s.symbol) +
      "?market=" + encodeURIComponent(s.market);
  }

  function applyCandles(data, s) {
    const changed = currentKey !== key(s);
    const oldRange = !changed
      ? charts.price.timeScale()
          .getVisibleLogicalRange()
      : null;

    rows = data;
    currentKey = key(s);

    series.price.setData(rows);
    series.volume?.setData(rows.map(volumeBar));

    updateIndicators(true);
    updateModules(true);

    if (changed) {
      resetView();
    } else if (oldRange) {
      try {
        charts.price.timeScale()
          .setVisibleLogicalRange(oldRange);
      } catch {}
    }

    put("chartTitle", s.symbol + " · " + s.tf);
    put("volumeLabel",
      s.symbol === GOLD ? "GOLD"
        : s.symbol === OIL ? "OIL WTI"
          : s.symbol.split("-")[0]
    );
  }

  async function refresh() {
    if (!series.price) return;
    if (chartBusy) {
      chartAgain = true;
      return;
    }

    chartBusy = true;
    const id = generation;
    const s = selection();

    try {
      put("status",
        "Cargando " + s.symbol + " · " + s.tf);
      const data = normalize(
        await getJSON(candleURL(s))
      );
      if (id !== generation ||
          key(s) !== key(selection())) return;

      if (!data.length) {
        throw new Error("Sin velas válidas");
      }

      applyCandles(data, s);
      put("status", "Velas actualizadas");
      put("message", "");
    } catch (error) {
      if (id === generation) {
        put("status", "Error: " + error.message);
        put("message",
          "Comprueba la conexión con el servidor.");
      }
    } finally {
      chartBusy = false;
      if (chartAgain || id !== generation) {
        chartAgain = false;
        queueMicrotask(refresh);
      }
    }
  }

  function tickerData(payload) {
    let data = payload?.data ?? payload;
    if (Array.isArray(data)) data = data[0];
    if (data?.data) data = data.data;
    if (Array.isArray(data)) data = data[0];
    return data || {};
  }

  async function refreshTicker() {
    if (tickerBusy) return;
    tickerBusy = true;

    const s = selection();
    const id = generation;

    try {
      const data = tickerData(
        await getJSON(tickerURL(s), 8000)
      );
      if (id !== generation ||
          key(s) !== key(selection())) return;

      const price = Number(
        data.lastPrice ?? data.last ??
        data.price ?? data.close ?? data.c
      );
      const open = Number(
        data.openPrice ?? data.open24h ??
        data.open ?? data.o
      );

      let change = Number(
        data.priceChangePercent ??
        data.changePercent
      );

      if (!Number.isFinite(change) &&
          price > 0 && open > 0) {
        change = (price / open - 1) * 100;
      }

      if (price > 0 &&
          Date.now() - lastWS > 7000) {
        put("price", fmt(price));
        connection(
          s.exchange.toUpperCase() + " · REST"
        );
      }

      for (const [id, value, digits] of [
        ["high", data.highPrice ??
          data.high24h ?? data.high ?? data.h, 2],
        ["low", data.lowPrice ??
          data.low24h ?? data.low ?? data.l, 2],
        ["open", open, 2],
        ["volume", data.volume ??
          data.volume24h ?? data.vol ?? data.v, 0],
        ["bid", data.bidPrice ??
          data.bid ?? data.bestBid, 2],
        ["ask", data.askPrice ??
          data.ask ?? data.bestAsk, 2]
      ]) {
        put(id, fmt(value, digits));
      }

      put("change",
        Number.isFinite(change)
          ? (change >= 0 ? "+" : "") +
            fmt(change) + "%"
          : "—"
      );

      $("change")?.classList.toggle(
        "negative", change < 0
      );

      put("updated",
        new Date().toLocaleTimeString("es-MX"));
    } catch (error) {
      console.warn("Ticker:", error.message);
    } finally {
      tickerBusy = false;
    }
  }

  function disconnect() {
    socketToken++;
    clearTimeout(reconnectTimer);
    if (socket) {
      const old = socket;
      socket = null;
      old.onopen = null;
      old.onmessage = null;
      old.onerror = null;
      old.onclose = null;
      try { old.close(); } catch {}
    }
  }

  function connect() {
    disconnect();
    if (document.hidden) return;

    const token = socketToken;
    const s = selection();
    const protocol = location.protocol === "https:"
      ? "wss:" : "ws:";
    const url = protocol + "//" + location.host +
      "/ws?exchange=" + encodeURIComponent(s.exchange) +
      "&market=" + encodeURIComponent(s.market) +
      "&symbol=" + encodeURIComponent(s.symbol);

    connection(s.exchange.toUpperCase() +
      " · conectando");

    try {
      socket = new WebSocket(url);
    } catch {
      reconnectTimer = setTimeout(connect, 4000);
      return;
    }

    socket.onopen = () => {
      if (token === socketToken) {
        connection("Esperando precios");
      }
    };

    socket.onmessage = event => {
      if (token !== socketToken) return;
      let data;
      try {
        data = JSON.parse(event.data);
      } catch {
        return;
      }
      if (
        data.type !== "price" ||
        data.symbol !== s.symbol ||
        data.market !== s.market ||
        data.exchange !== s.exchange
      ) return;

      const price = Number(data.price);
      if (!Number.isFinite(price) ||
          price <= 0) return;

      put("price", fmt(price));
      put("updated",
        new Date().toLocaleTimeString("es-MX"));
      lastWS = Date.now();
      connection(
        s.exchange.toUpperCase() + " · en vivo",
        C.green
      );
    };

    socket.onerror = () => {
      if (token === socketToken) {
        connection("Conexión interrumpida", C.red);
      }
    };

    socket.onclose = () => {
      if (token !== socketToken) return;
      socket = null;
      reconnectTimer = setTimeout(() => {
        if (token === socketToken &&
            !document.hidden) connect();
      }, 4000);
    };
  }

  function metric(data, tf) {
    const candles = closed(data, tf);
    if (candles.length < 60) return null;

    const closes = candles.map(c => c.close);
    const last = candles.at(-1);
    const e = ema(closes, 21).at(-1);
    const m = sma(closes, 55).at(-1);
    const rv = rsi(closes).at(-1);
    const ad = adx(candles);
    const strength = ad.adx.at(-1);
    const plus = ad.plus.at(-1);
    const minus = ad.minus.at(-1);
    const ao = awesomeOscillator(candles);
    const aoNow = ao.at(-1);
    const aoPrevious = ao.at(-2);

    if (![e, m, rv, strength, plus, minus]
        .every(Number.isFinite)) return null;

    let bull = 0, bear = 0;
    if (last.close > e) bull++;
    if (last.close < e) bear++;
    if (e > m) bull++;
    if (e < m) bear++;
    if (rv >= 55) bull++;
    if (rv <= 45) bear++;
    if (plus > minus) bull++;
    if (minus > plus) bear++;

    const previous = candles.slice(-7, -1);
    const average = candles.slice(-21, -1)
      .reduce((sum, c) => sum + c.volume, 0) / 20;

    return {
      bull, bear,
      adx: strength,
      plus, minus, rsi: rv,
      ao: aoNow,
      aoPrevious,
      aoBull: Number.isFinite(aoNow) &&
        Number.isFinite(aoPrevious) &&
        aoNow > 0 && aoNow > aoPrevious,
      aoBear: Number.isFinite(aoNow) &&
        Number.isFinite(aoPrevious) &&
        aoNow < 0 && aoNow < aoPrevious,
      volRatio: average ? last.volume / average : 0,
      close: last.close,
      closedTime: last.time,
      atr: atr(candles),
      breakHigh: last.close > Math.max(
        ...previous.map(c => c.high)),
      breakLow: last.close < Math.min(
        ...previous.map(c => c.low))
    };
  }

  function analyze(data, tf) {
    const m = metric(data, tf);
    if (!m) {
      return {
        state: "SIN DATOS",
        direction: "neutral",
        detail: "Historial insuficiente.",
        metrics: "—"
      };
    }

    const bullish = m.bull >= 3 && m.bull > m.bear;
    const bearish = m.bear >= 3 && m.bear > m.bull;

    const opportunity = m.bull === 4 &&
      m.adx >= 25 && m.rsi < 70
      ? "Posible LONG"
      : m.bear === 4 &&
        m.adx >= 25 && m.rsi > 30
        ? "Posible SHORT"
        : "Sin entrada confirmada";

    return {
      state: bullish ? "SESGO ALCISTA"
        : bearish ? "SESGO BAJISTA"
          : "LATERAL / MIXTO",
      direction: bullish ? "bullish"
        : bearish ? "bearish" : "neutral",
      detail: opportunity + ". " +
        (m.aoBull ? "AO alcista"
          : m.aoBear ? "AO bajista"
            : "AO sin confirmación") +
        ". Requiere confirmación.",
      metrics: "RSI " + fmt(m.rsi, 1) +
        " · ADX " + fmt(m.adx, 1),
      price: m.close
    };
  }

  async function monitor(force = false) {
    if (monitorBusy) {
      if (force) monitorAgain = true;
      return;
    }
    if (!force &&
        Date.now() - monitorLast < 60000) return;

    monitorBusy = true;
    const s = selection();
    const id = generation;

    try {
      put("engineState", "ANALIZANDO");
      const frames = await Promise.allSettled(
        ["5m", "15m"].map(async tf =>
          normalize(await getJSON(
            candleURL({ ...s, tf })
          ))
        )
      );
      if (id !== generation) return;

      let success = 0;

      for (let i = 0; i < 2; i++) {
        const tf = i === 0 ? "5m" : "15m";
        const suffix = i === 0 ? "5" : "15";
        const item = frames[i];
        const result = item.status === "fulfilled"
          ? analyze(item.value, tf)
          : {
              state: "SIN CONEXIÓN",
              direction: "neutral",
              detail: "No se pudieron cargar velas.",
              metrics: "—"
            };

        if (item.status === "fulfilled" &&
            result.state !== "SIN DATOS") success++;

        put("state" + suffix, result.state);
        put("detail" + suffix, result.detail);
        put("metrics" + suffix, result.metrics);

        const element = $("state" + suffix);
        if (element) {
          element.className =
            "state " + result.direction;
          const heading = element.closest(
            ".signal-card")?.querySelector("h3");
          if (heading) {
            heading.textContent = s.symbol + " / " + tf;
          }
        }
      }

      put("engineState",
        success ? "ANALIZANDO" : "SIN CONEXIÓN");
      monitorLast = Date.now();
    } catch (error) {
      if (id === generation) {
        put("engineState", "SIN CONEXIÓN");
      }
      console.warn("Monitor:", error);
    } finally {
      monitorBusy = false;
      if (monitorAgain || id !== generation) {
        monitorAgain = false;
        queueMicrotask(() => monitor(true));
      }
    }
  }

  function scannerUI() {
    if ($("clScanner")) return;
    const host = $("clScannerHost") ||
      $("clScreenScanner");
    if (!host) return;

    const section = document.createElement("section");
    section.id = "clScanner";
    section.className = "cl-module";
    section.innerHTML = `
      <h2>📡 Escáner CRYPTOLEXUZ PRO</h2>
      <p id="clScanStatus">Esperando análisis...</p>
      <div class="chart-controls">
        <button id="clScanNow" type="button">
          ↻ Escanear
        </button>
        <button id="clNotify" type="button">
          🔔 Activar avisos
        </button>
      </div>
      <p class="cl-notice">
        Ocho activos · Siete temporalidades · LONG / SHORT
      </p>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Activo</th>
              <th>Dirección</th>
              <th>Puntos</th>
              <th>Estado</th>
              <th>Confirmaciones</th>
            </tr>
          </thead>
          <tbody id="clScanBody">
            <tr>
              <td colspan="6">Iniciando...</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p id="clScanErrors" class="cl-notice"></p>
    `;
    host.append(section);

    $("clScanNow")?.addEventListener(
      "click", () => scan(true)
    );

    $("clNotify")?.addEventListener(
      "click", async () => {
        if (!("Notification" in window)) {
          alert("Notificaciones no disponibles.");
          return;
        }
        const permission =
          await Notification.requestPermission();
        put("clNotify",
          permission === "granted"
            ? "🔔 Avisos activos"
            : "🔕 Sin permiso");
      }
    );
  }

  function markets() {
    const s = selection();
    return ASSETS.map(symbol => {
      const commodity = symbol === GOLD || symbol === OIL;
      return {
        symbol,
        exchange: commodity ? "bingx" : s.exchange,
        market: commodity ? "perpetual" : s.market,
        label: symbol === GOLD ? "GOLD (XAU)"
          : symbol === OIL ? "OIL WTI"
            : symbol.replace("-", "/")
      };
    });
  }

  async function frames(market) {
    const result = {};
    for (const tf of SCAN_TF) {
      const s = { ...market, tf };
      const cacheKey = key(s);
      const ttl = SEC[tf] >= 3600 ? 180000
        : SEC[tf] >= 900 ? 90000 : 50000;
      const cached = cache.get(cacheKey);

      if (cached && Date.now() - cached.at < ttl) {
        result[tf] = cached.data;
        continue;
      }

      const data = normalize(
        await getJSON(candleURL(s, 300))
      );
      if (closed(data, tf).length < 60) {
        throw new Error(tf + ": historial insuficiente");
      }

      result[tf] = data;
      cache.set(cacheKey, {
        at: Date.now(),
        data
      });
    }
    return result;
  }

  function rank(market, framesData) {
    const metrics = {};
    for (const tf of SCAN_TF) {
      metrics[tf] = metric(
        framesData[tf] || [], tf
      );
    }

    if (!metrics["1m"] ||
        !metrics["5m"] ||
        !metrics["15m"]) {
      return {
        market,
        score: 0,
        state: "SIN DATOS",
        direction: "NEUTRAL",
        confirmations: "—"
      };
    }

    const weights = {
      "1d": 5, "4h": 7, "1h": 9,
      "30m": 10, "15m": 13,
      "5m": 17, "1m": 19
    };

    let bull = 0, bear = 0, available = 0;

    for (const tf of SCAN_TF) {
      const m = metrics[tf];
      if (!m) continue;
      available++;
      bull += weights[tf] * m.bull / 4;
      bear += weights[tf] * m.bear / 4;
    }

    const direction = bull === bear
      ? "NEUTRAL"
      : bull > bear ? "LONG" : "SHORT";

    const fast = metrics["1m"];
    const aligned = ["1m", "5m", "15m"]
      .filter(tf => {
        const m = metrics[tf];
        return direction === "LONG"
          ? m.bull >= 3
          : direction === "SHORT"
            ? m.bear >= 3 : false;
      }).length;

    let score = Math.round(Math.max(bull, bear));
    score += aligned === 3 ? 8
      : aligned === 2 ? 4 : 0;
    score += fast.adx >= 25 ? 5
      : fast.adx >= 20 ? 2 : 0;

    if (fast.volRatio >= 1.3) score += 5;

    if (
      (direction === "LONG" && fast.breakHigh) ||
      (direction === "SHORT" && fast.breakLow)
    ) score += 4;

    if (
      (direction === "LONG" && fast.aoBull) ||
      (direction === "SHORT" && fast.aoBear)
    ) score += 3;

    score = Math.min(100, score);

    const confirmed =
      direction !== "NEUTRAL" &&
      aligned === 3 &&
      fast.adx >= 20 &&
      score >= 65 &&
      (direction === "LONG"
        ? fast.rsi < 75 : fast.rsi > 25);

    return {
      market, score, direction,
      state: confirmed ? "CONFIRMADA"
        : score >= 55 ? "EN OBSERVACIÓN"
          : "SIN ENTRADA",
      confirmations: aligned + "/3 rápidas · " +
        available + "/7 marcos",
      closedTime: fast.closedTime,
      price: fast.close,
      atr: fast.atr
    };
  }

  try {
    const saved = JSON.parse(
      localStorage.getItem(HISTORY_KEY) || "[]"
    );
    history = Array.isArray(saved)
      ? saved.slice(0, 300) : [];
  } catch {
    history = [];
  }

  function saveHistory() {
    try {
      localStorage.setItem(
        HISTORY_KEY,
        JSON.stringify(history.slice(0, 300))
      );
    } catch (error) {
      console.warn("Historial:", error);
    }
  }

  function addSignal(result) {
    if (
      result.state !== "CONFIRMADA" ||
      !result.closedTime ||
      !Number.isFinite(result.atr) ||
      result.atr <= 0
    ) return false;

    const id = [
      result.market.exchange,
      result.market.market,
      result.market.symbol,
      result.direction,
      result.closedTime
    ].join("|");

    if (history.some(x => x.id === id)) return false;

    const entry = result.price;
    const distance = result.atr;
    const side = result.direction;

    history.unshift({
      id,
      symbol: result.market.symbol,
      exchange: result.market.exchange,
      market: result.market.market,
      tf: "1m",
      direction: side,
      created: result.closedTime,
      entry,
      stop: side === "LONG"
        ? entry - distance : entry + distance,
      target: side === "LONG"
        ? entry + 2 * distance
        : entry - 2 * distance,
      state: "PENDIENTE",
      activated: null,
      ended: null,
      reason: "Alineación multitemporal + ADX + RSI + AO",
      lastChecked: result.closedTime
    });

    history = history.slice(0, 300);
    saveHistory();
    renderHistory();
    return true;
  }

  function evaluateSignal(signal, data) {
    if (!["PENDIENTE", "ACTIVADA"]
        .includes(signal.state)) return false;

    let changed = false;

    for (const candle of closed(data, signal.tf)) {
      if (
        candle.time <= signal.lastChecked ||
        candle.time <= signal.created
      ) continue;

      signal.lastChecked = candle.time;
      changed = true;

      if (signal.state === "PENDIENTE") {
        if (!(candle.low <= signal.entry &&
              candle.high >= signal.entry)) {
          continue;
        }
        signal.state = "ACTIVADA";
        signal.activated = candle.time;
      }

      const stop = signal.direction === "LONG"
        ? candle.low <= signal.stop
        : candle.high >= signal.stop;

      const target = signal.direction === "LONG"
        ? candle.high >= signal.target
        : candle.low <= signal.target;

      if (stop && target) {
        signal.state = "NO VERIFICABLE";
        signal.ended = candle.time;
        break;
      }

      if (stop || target) {
        signal.state =
          candle.time === signal.activated
            ? "NO VERIFICABLE"
            : target ? "OBJETIVO" : "STOP";
        signal.ended = candle.time;
        break;
      }
    }

    return changed;
  }

  async function verifySignals() {
    if (verifyBusy) return;
    verifyBusy = true;

    try {
      const groups = new Map();

      for (const signal of history.filter(
        x => ["PENDIENTE", "ACTIVADA"]
          .includes(x.state)
      )) {
        const groupKey = key(signal);
        if (!groups.has(groupKey)) {
          groups.set(groupKey, []);
        }
        groups.get(groupKey).push(signal);
      }

      let dirty = false;

      for (const group of groups.values()) {
        const first = group[0];
        try {
          const data = normalize(
            await getJSON(candleURL(first, 300))
          );
          const valid = closed(data, first.tf);
          if (!valid.length) continue;

          for (const item of group) {
            if (
              item.lastChecked <
              valid[0].time - (SEC[item.tf] || 60)
            ) {
              item.state = "NO VERIFICABLE";
              item.ended = now();
              dirty = true;
              continue;
            }

            if (evaluateSignal(item, data)) {
              dirty = true;
            }
          }
        } catch (error) {
          console.warn("Verificación:", error);
        }
      }

      if (dirty) {
        saveHistory();
        renderHistory();
      }
    } finally {
      verifyBusy = false;
    }
  }

  function renderHistory() {
    const wins = history.filter(
      x => x.state === "OBJETIVO"
    ).length;
    const losses = history.filter(
      x => x.state === "STOP"
    ).length;

    put("clTotalSignals", history.length);
    put("clTargetsHit", wins);
    put("clStopsHit", losses);
    put("clWinRate", wins + losses
      ? fmt(wins / (wins + losses) * 100, 1) + "%"
      : "—");

    const body = $("signalLog");
    if (!body) return;
    body.replaceChildren();

    if (!history.length) {
      const tr = document.createElement("tr");
      const td = document.createElement("td");
      td.colSpan = 7;
      td.textContent =
        "Todavía no hay señales registradas.";
      tr.append(td);
      body.append(tr);
      return;
    }

    for (const signal of history.slice(0, 30)) {
      const tr = document.createElement("tr");
      const cells = [
        new Date(signal.created * 1000)
          .toLocaleString("es-MX"),
        signal.tf,
        signal.symbol,
        signal.direction,
        fmt(signal.entry),
        signal.reason +
          " · TP " + fmt(signal.target) +
          " · SL " + fmt(signal.stop),
        signal.state
      ];

      for (const value of cells) {
        const td = document.createElement("td");
        td.textContent = value;
        tr.append(td);
      }
      body.append(tr);
    }
  }

  function notifySignal(result) {
    if (
      result.state !== "CONFIRMADA" ||
      !("Notification" in window) ||
      Notification.permission !== "granted"
    ) return;

    try {
      new Notification(
        "CRYPTOLEXUZ · " +
        result.market.label + " · " +
        result.direction,
        {
          body: "Señal técnica " +
            result.score + "/100 · Precio " +
            fmt(result.price),
          tag: result.market.symbol + "|" +
            result.direction + "|" +
            result.closedTime
        }
      );
    } catch (error) {
      console.warn("Notificación:", error);
    }
  }

  async function scan(force = false) {
    if (document.hidden) return;
    if (scanBusy) {
      if (force) scanAgain = true;
      return;
    }
    if (!force &&
        Date.now() - scanLast < 55000) return;

    scanBusy = true;
    const id = scanGeneration;
    const items = markets();
    const results = [];
    const errors = [];

    put("clScanStatus", "Analizando ocho activos...");

    let cursor = 0;

    async function worker() {
      while (cursor < items.length) {
        const market = items[cursor++];
        try {
          results.push(rank(
            market, await frames(market)
          ));
        } catch (error) {
          errors.push(
            market.label + ": " + error.message
          );
        }
      }
    }

    try {
      await Promise.all([worker(), worker()]);
      if (id !== scanGeneration) return;

      results.sort((a, b) => b.score - a.score);

      const body = $("clScanBody");
      if (body) {
        body.replaceChildren();

        for (const [index, result] of results.entries()) {
          const tr = document.createElement("tr");
          const cells = [
            index + 1,
            result.market.label,
            result.direction,
            result.score + "/100",
            result.state,
            result.confirmations
          ];

          for (const value of cells) {
            const td = document.createElement("td");
            td.textContent = value;
            td.style.padding = "9px 6px";
            tr.append(td);
          }
          body.append(tr);
        }

        if (!results.length) {
          const tr = document.createElement("tr");
          const td = document.createElement("td");
          td.colSpan = 6;
          td.textContent = "Sin resultados disponibles.";
          tr.append(td);
          body.append(tr);
        }
      }

      put("clScanErrors",
        errors.length
          ? "Sin datos: " + errors.join(" · ")
          : ""
      );

      put("clScanStatus",
        "Última revisión: " +
        new Date().toLocaleTimeString("es-MX") +
        " · " + results.length + "/" +
        items.length + " activos"
      );

      scanLast = Date.now();

      for (const result of results) {
        if (addSignal(result)) {
          notifySignal(result);
        }
      }

      await verifySignals();
    } catch (error) {
      put("clScanStatus",
        "Error del escáner: " + error.message);
      console.warn("Escáner:", error);
    } finally {
      scanBusy = false;
      if (scanAgain || id !== scanGeneration) {
        scanAgain = false;
        queueMicrotask(() => scan(true));
      }
    }
  }

  function clearMarket() {
    generation++;
    scanGeneration++;
    scanLast = 0;
    monitorLast = 0;
    currentKey = "";
    rows = [];
    zones = [];
    pivots = [];
    lastWS = 0;

    series.price?.setData([]);
    series.volume?.setData([]);

    for (const target of moving.values()) {
      target.setData([]);
    }

    for (const name of [
      "rsi", "adx", "plus", "minus", "ao"
    ]) {
      series[name]?.setData([]);
    }

    for (const line of levelLines) {
      try {
        series.price?.removePriceLine(line);
      } catch {}
    }
    levelLines.length = 0;
    series.price?.setMarkers([]);

    updateModules(true);
    put("price", "—");
    put("message", "Cargando nuevo mercado...");
    scheduleOverlay();
  }

  function marketChanged() {
    syncCommodity();
    syncTimeframes();
    clearMarket();
    connect();
    refresh();
    refreshTicker();
    monitor(true);
    scan(true);
    scheduleResize();
  }

  function events() {
    document.addEventListener("click", event => {
      const target = event.target instanceof Element
        ? event.target
        : event.target?.parentElement;
      if (!target) return;

      const timeframe = target.closest("[data-tf]");
      if (timeframe) {
        changeTimeframe(timeframe.dataset.tf);
        return;
      }

      const indicator = target.closest(
        "[data-indicator]"
      );
      if (indicator) {
        toggleIndicator(indicator.dataset.indicator);
        return;
      }

      const osc = target.closest("[data-osc]");
      if (osc) {
        const name = osc.dataset.osc;
        if (indicatorKey(name)) {
          toggleIndicator(name);
        }
      }
    });

    $("refresh")?.addEventListener("click", () => {
      refresh();
      refreshTicker();
      monitor(true);
    });

    $("chartReset")?.addEventListener(
      "click", resetView
    );

    $("rsiSpeak")?.addEventListener("click", () => {
      if (!("speechSynthesis" in window)) return;
      speechSynthesis.cancel();
      const utterance =
        new SpeechSynthesisUtterance(lastRSI);
      utterance.lang = "es-MX";
      speechSynthesis.speak(utterance);
    });

    if ($("rsiSpeak") &&
        "speechSynthesis" in window) {
      $("rsiSpeak").disabled = false;
    }

    for (const id of [
      "symbol", "interval", "exchange", "market"
    ]) {
      $(id)?.addEventListener(
        "change", marketChanged
      );
    }

    document.addEventListener(
      "visibilitychange", () => {
        if (document.hidden) {
          disconnect();
        } else {
          connect();
          refresh();
          refreshTicker();
          monitor(true);
          scan(true);
        }
      }
    );

    window.addEventListener(
      "cryptolexuz:screen-change", event => {
        if (event.detail?.screen === "charts") {
          setTimeout(scheduleResize, 120);
        }
        if (event.detail?.screen === "results") {
          renderHistory();
        }
      }
    );

    window.addEventListener(
      "cryptolexuz:indicator-settings-change",
      applySavedIndicators
    );

    window.addEventListener(
      "cryptolexuz:volume-profile-ready", () => {
        profileModule = null;
        attachVolumeProfile();
        updateModules(true);
      }
    );

    syncTimeframes();
    updateButtons();
  }

  window.CryptolexuzIndicators = {
    getSettings: () => readSettings(),
    getEnabled: () => Object.keys(
      prefs.indicators
    ).filter(k => prefs.indicators[k]),
    isEnabled: indicatorActive,
    setIndicator,
    toggleIndicator,
    refresh: () => {
      applySavedIndicators();
      refresh();
    },
    awesomeOscillator,
    sma,
    ema,
    rsi,
    adx
  };

  function init() {
    populateTimeframes();
    syncCommodity();
    scannerUI();
    renderHistory();
    events();
    applySavedIndicators();

    if (!createCharts()) return;

    connect();
    refresh();
    refreshTicker();
    monitor(true);
    scan(true);

    for (const [milliseconds, fn] of [
      [15000, refresh],
      [10000, refreshTicker],
      [60000, monitor],
      [60000, scan],
      [60000, verifySignals]
    ]) {
      timers.push(setInterval(() => {
        if (!document.hidden) {
          Promise.resolve(fn()).catch(console.warn);
        }
      }, milliseconds));
    }

    window.addEventListener("beforeunload", () => {
      disconnect();
      for (const timer of timers) {
        clearInterval(timer);
      }
    });

    console.info(
      "CRYPTOLEXUZ PRO — APP.JS V26 iniciado"
    );
  }

  if (document.readyState === "loading") {
    document.addEventListener(
      "DOMContentLoaded", init, { once: true }
    );
  } else {
    init();
  }
})();
