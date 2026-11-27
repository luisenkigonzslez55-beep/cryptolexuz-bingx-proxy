/* CRYPTOLEXUZ PRO — APP.JS V27 COMPLETO
   Compatible con INDEX.HTML y Lightweight Charts 4.2.2.
   Terminal informativa; no ejecuta órdenes.
*/
'use strict';
(() => {
  if (window.__cryptolexuzAppV27) return;
  window.__cryptolexuzAppV27 = true;

  const $ = id => document.getElementById(id);
  const C = {
    green: '#00f5a0',
    red: '#ff476c',
    purple: '#bb52ff',
    orange: '#ff9a35',
    blue: '#36c5ff',
    yellow: '#ffe15a'
  };
  const GOLD = 'NCCOGOLD2USD-USDT';
  const OIL = 'NCCO1OILWTI2USD-USDT';
  const ASSETS = ['BTC-USDT', 'ETH-USDT', 'BNB-USDT', 'SOL-USDT', 'XRP-USDT', 'DOGE-USDT', GOLD, OIL];
  const ALL_TF = ['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '8h', '12h', '1d', '3d', '1w', '1M'];
  const SCAN_TF = ['1d', '4h', '1h', '30m', '15m', '5m', '1m'];
  const SEC = {
    '1m': 60, '3m': 180, '5m': 300, '15m': 900, '30m': 1800,
    '1h': 3600, '2h': 7200, '4h': 14400, '6h': 21600, '8h': 28800,
    '12h': 43200, '1d': 86400, '3d': 259200, '1w': 604800, '1M': 2592000
  };
  const SETTINGS_KEY = 'cryptolexuz-chart-settings-v1';
  const HISTORY_KEY = 'cryptolexuz-v27-history';
  const LEGACY_HISTORY_KEY = 'cryptolexuz-v16-history';

  const MA_DEFAULT = [
    { period: 55, color: C.orange, width: 2, enabled: true },
    { period: 100, color: C.red, width: 3, enabled: false },
    { period: 200, color: C.blue, width: 2, enabled: false }
  ];
  const EMA_DEFAULT = [
    { period: 21, color: C.purple, width: 2, enabled: true }
  ];
  const IND_DEFAULT = {
    MA: true, EMA: true, VOL: true, RSI: true,
    ADX: false, AO: false, FVG: true, IFVG: false,
    liquidity: false, sweeps: false, support: false, resistance: false
  };

  const charts = {};
  const series = {};
  const moving = new Map();
  const seriesCache = new WeakMap();
  const timers = [];
  const cache = new Map();
  const levelLines = [];

  let prefs;
  let rows = [];
  let zones = [];
  let pivots = [];
  let history = [];
  let currentKey = '';
  let chartRequest = 0;
  let tickerRequest = 0;
  let monitorRequest = 0;
  let scanRequest = 0;
  let chartBusy = false;
  let tickerBusy = false;
  let monitorBusy = false;
  let scanBusy = false;
  let verifyBusy = false;
  let chartAgain = false;
  let tickerAgain = false;
  let monitorAgain = false;
  let scanAgain = false;
  let socket = null;
  let socketToken = 0;
  let reconnectTimer = null;
  let lastWS = 0;
  let scanLast = 0;
  let monitorLast = 0;
  let resizePending = false;
  let overlayPending = false;
  let syncingRange = false;
  let markerSignature = '';
  let levelSignature = '';
  let lastRSI = 'RSI no disponible.';
  let profileAttached = null;
  let lastProfileRows = null;

  const now = () => Math.floor(Date.now() / 1000);
  const emit = (name, detail = {}) => window.dispatchEvent(new CustomEvent(name, { detail }));
  const put = (id, value) => {
    const e = $(id);
    if (e && e.textContent !== String(value)) e.textContent = String(value);
  };
  const fmt = (v, n = 2) => (
    Number.isFinite(Number(v)) && v !== null && v !== undefined && v !== ''
      ? Number(v).toLocaleString('en-US', { minimumFractionDigits: n, maximumFractionDigits: n })
      : '—'
  );
  const safeJSON = (text, fallback) => {
    try {
      return JSON.parse(text) || fallback;
    } catch {
      return fallback;
    }
  };
  const clone = a => a.map(x => ({ ...x }));

  function normalizeLines(input, defaults) {
    if (!Array.isArray(input) || !input.length) return clone(defaults);
    return input.slice(0, 12).map(x => ({
      period: Math.max(1, Math.min(1000, Math.round(Number(x.period) || 21))),
      color: /^#[0-9a-f]{6}$/i.test(x.color) ? x.color : C.purple,
      width: Math.max(1, Math.min(5, Number(x.width) || 2)),
      enabled: x.enabled !== false
    }));
  }

  function readSettings() {
    const saved = safeJSON(localStorage.getItem(SETTINGS_KEY), {});
    const legacy = Array.isArray(saved.lines) ? saved.lines : [];
    const maSource = saved.maLines ?? (legacy.length ? legacy.filter(x => Number(x.period) !== 21) : null);
    const emaSource = saved.emaLines ?? (legacy.length ? legacy.filter(x => Number(x.period) === 21) : null);
    return {
      maLines: normalizeLines(maSource, MA_DEFAULT),
      emaLines: normalizeLines(emaSource, EMA_DEFAULT),
      height: Math.max(240, Math.min(600, Number(saved.height) || 360)),
      options: { countdown: true, multiperiod: true, bidask: false, ...(saved.options || {}) },
      indicators: { ...IND_DEFAULT, ...(saved.indicators || {}) }
    };
  }

  function saveSettings() {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(prefs));
    } catch (e) {
      console.warn('Ajustes:', e);
    }
  }

  prefs = readSettings();

  function selection() {
    const symbol = $('symbol')?.value || 'BTC-USDT';
    const commodity = symbol === GOLD || symbol === OIL;
    return {
      symbol,
      tf: $('interval')?.value || '15m',
      exchange: commodity ? 'bingx' : ($('exchange')?.value || 'bingx').toLowerCase(),
      market: commodity ? 'perpetual' : ($('market')?.value || 'perpetual').toLowerCase()
    };
  }

  const key = s => [s.exchange, s.market, s.symbol, s.tf].join('|');

  function syncCommodity() {
    if ([GOLD, OIL].includes($('symbol')?.value)) {
      if ($('exchange')) $('exchange').value = 'bingx';
      if ($('market')) $('market').value = 'perpetual';
    }
  }

  function syncTimeframes() {
    const tf = selection().tf;
    document.querySelectorAll('[data-tf],[data-cl-tf]').forEach(b => {
      const active = (b.dataset.tf || b.dataset.clTf) === tf;
      b.classList.toggle('active', active);
      b.setAttribute('aria-pressed', String(active));
    });
    put('chartTitle', selection().symbol + ' · ' + tf);
  }

  function populateTimeframes() {
    const select = $('interval');
    if (!select) return;
    const previous = select.value || '15m';
    for (const tf of ALL_TF) {
      if (!Array.from(select.options).some(x => x.value === tf)) {
        const o = document.createElement('option');
        o.value = tf;
        o.textContent = tf;
        select.append(o);
      }
    }
    select.value = SEC[previous] ? previous : '15m';
    syncTimeframes();
  }

  function setTimeframe(tf) {
    if (!SEC[tf] || !$('interval')) return;
    const select = $('interval');
    if (select.value !== tf) {
      select.value = tf;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    } else {
      syncTimeframes();
    }
  }

  function connection(label, color = C.yellow) {
    put('connection', '● ' + label);
    if ($('connection')) $('connection').style.color = color;
  }

  function timestamp(value) {
    const v = typeof value === 'string' && !/^\d+$/.test(value) ? Date.parse(value) : Number(value);
    return Number.isFinite(v) ? Math.floor(v > 1e12 ? v / 1000 : v) : NaN;
  }

  function normalize(payload) {
    const source = [
      payload?.data?.data, payload?.data?.list, payload?.data?.candles,
      payload?.data, payload?.list, payload?.candles, payload
    ].find(Array.isArray) || [];
    const output = [];
    for (const item of source) {
      if (!item) continue;
      const a = Array.isArray(item);
      const c = {
        time: timestamp(a ? item[0] : (item.time ?? item.timestamp ?? item.openTime ?? item.t)),
        open: Number(a ? item[1] : (item.open ?? item.o)),
        high: Number(a ? item[2] : (item.high ?? item.h)),
        low: Number(a ? item[3] : (item.low ?? item.l)),
        close: Number(a ? item[4] : (item.close ?? item.c)),
        volume: Number(a ? item[5] : (item.volume ?? item.vol ?? item.v ?? 0))
      };
      if (
        Object.values(c).every(Number.isFinite) &&
        c.time > 0 &&
        c.time <= now() + 60 &&
        c.low > 0 &&
        c.volume >= 0 &&
        c.high >= Math.max(c.open, c.close, c.low) &&
        c.low <= Math.min(c.open, c.close)
      ) {
        output.push(c);
      }
    }
    output.sort((a, b) => a.time - b.time);
    return [...new Map(output.map(c => [c.time, c])).values()];
  }

  function closed(data, tf) {
    const seconds = SEC[tf] || 60;
    return data.filter(c => c.time + seconds <= now() - 2);
  }

  function sma(values, period) {
    const out = Array(values.length).fill(null);
    period = Math.floor(Number(period));
    if (period < 1 || !Number.isFinite(period)) return out;
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
    let value = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
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
    let gain = 0;
    let loss = 0;
    for (let i = 1; i <= period; i++) {
      const d = values[i] - values[i - 1];
      gain += Math.max(0, d);
      loss += Math.max(0, -d);
    }
    gain /= period;
    loss /= period;
    const value = () => (loss === 0 ? (gain === 0 ? 50 : 100) : 100 - 100 / (1 + gain / loss));
    out[period] = value();
    for (let i = period + 1; i < values.length; i++) {
      const d = values[i] - values[i - 1];
      gain = (gain * (period - 1) + Math.max(0, d)) / period;
      loss = (loss * (period - 1) + Math.max(0, -d)) / period;
      out[i] = value();
    }
    return out;
  }

  function adx(data, period = 14) {
    const n = data.length;
    const ax = Array(n).fill(null);
    const plus = Array(n).fill(null);
    const minus = Array(n).fill(null);
    if (n < 2 * period) return { adx: ax, plus, minus };
    const tr = [];
    const up = [];
    const down = [];
    const dx = [];
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
    let t = 0;
    let p = 0;
    let m = 0;
    for (let i = 1; i <= period; i++) {
      t += tr[i];
      p += up[i];
      m += down[i];
    }
    for (let i = period; i < n; i++) {
      if (i > period) {
        t = t - t / period + tr[i];
        p = p - p / period + up[i];
        m = m - m / period + down[i];
      }
      plus[i] = t ? 100 * p / t : 0;
      minus[i] = t ? 100 * m / t : 0;
      const sum = plus[i] + minus[i];
      dx[i] = sum ? 100 * Math.abs(plus[i] - minus[i]) / sum : 0;
    }
    let total = 0;
    for (let i = period; i < 2 * period; i++) total += dx[i];
    ax[2 * period - 1] = total / period;
    for (let i = 2 * period; i < n; i++) {
      ax[i] = (ax[i - 1] * (period - 1) + dx[i]) / period;
    }
    return { adx: ax, plus, minus };
  }

  function atr(data, period = 14) {
    if (data.length < period + 1) return null;
    const r = [];
    for (let i = 1; i < data.length; i++) {
      r.push(Math.max(
        data[i].high - data[i].low,
        Math.abs(data[i].high - data[i - 1].close),
        Math.abs(data[i].low - data[i - 1].close)
      ));
    }
    let v = r.slice(0, period).reduce((a, b) => a + b, 0) / period;
    for (let i = period; i < r.length; i++) {
      v = (v * (period - 1) + r[i]) / period;
    }
    return v;
  }

  function awesomeOscillator(data) {
    const middle = data.map(c => (c.high + c.low) / 2);
    const fast = sma(middle, 5);
    const slow = sma(middle, 34);
    return middle.map((_, i) => (
      Number.isFinite(fast[i]) && Number.isFinite(slow[i]) ? fast[i] - slow[i] : null
    ));
  }

  function lineData(data, values) {
    return data.flatMap((c, i) => (
      Number.isFinite(values[i]) ? [{ time: c.time, value: values[i] }] : []
    ));
  }

  function volumeBar(c) {
    return {
      time: c.time,
      value: c.volume,
      color: c.close >= c.open ? 'rgba(0,245,160,.7)' : 'rgba(255,71,108,.7)'
    };
  }

  function aoBars(data, values) {
    return data.flatMap((c, i) => (
      Number.isFinite(values[i])
        ? [{
            time: c.time,
            value: values[i],
            color: !Number.isFinite(values[i - 1]) || values[i] >= values[i - 1] ? C.green : C.red
          }]
        : []
    ));
  }

  function setSeries(target, data, force = false) {
    if (!target) return;
    const prev = seriesCache.get(target);
    const first = data[0];
    const last = data.at(-1);
    if (
      force ||
      !prev ||
      !data.length ||
      prev.length > data.length ||
      prev.first !== first?.time ||
      prev.lastTime > last?.time ||
      data.length > prev.length + 1
    ) {
      target.setData(data);
    } else if (last && last.time === prev.lastTime) {
      if (last.value !== prev.lastValue || last.color !== prev.lastColor) target.update(last);
    } else if (last && last.time > prev.lastTime) {
      target.update(last);
    } else {
      target.setData(data);
    }
    seriesCache.set(target, {
      length: data.length,
      first: first?.time,
      lastTime: last?.time,
      lastValue: last?.value,
      lastColor: last?.color
    });
  }

  function chartOptions(height) {
    return {
      width: Math.max(300, $('chart')?.clientWidth || 300),
      height,
      layout: { background: { type: 'solid', color: '#000000' }, textColor: '#c9d3ee', fontSize: 11 },
      grid: { vertLines: { color: '#141414' }, horzLines: { color: '#141414' } },
      rightPriceScale: { borderColor: '#343434', minimumWidth: 65 },
      timeScale: { borderColor: '#343434', timeVisible: true, secondsVisible: false, rightOffset: 5, barSpacing: 9, minBarSpacing: 2 },
      crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
      handleScroll: { mouseWheel: false, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
      handleScale: { mouseWheel: true, pinch: true, axisPressedMouseMove: { time: true, price: true }, axisDoubleClickReset: true },
      kineticScroll: { touch: true, mouse: true }
    };
  }

  function range() {
    try {
      const r = charts.price?.timeScale().getVisibleLogicalRange();
      return Number.isFinite(r?.from) && Number.isFinite(r?.to) ? { from: r.from, to: r.to } : null;
    } catch {
      return null;
    }
  }

  function restore(r) {
    if (!r || !charts.price) return;
    try {
      charts.price.timeScale().setVisibleLogicalRange(r);
    } catch {}
  }

  function resetView() {
    if (!charts.price || !rows.length) return;
    restore({ from: Math.max(0, rows.length - 50), to: rows.length + 3 });
  }

  function syncRanges(r) {
    if (syncingRange || !r || !Number.isFinite(r.from) || !Number.isFinite(r.to)) return;
    syncingRange = true;
    try {
      for (const name of ['volume', 'rsi', 'adx', 'ao']) {
        if (charts[name]) {
          const old = charts[name].timeScale().getVisibleLogicalRange();
          if (!old || Math.abs(old.from - r.from) > 0.05 || Math.abs(old.to - r.to) > 0.05) {
            charts[name].timeScale().setVisibleLogicalRange(r);
          }
        }
      }
    } catch {} finally {
      syncingRange = false;
    }
    scheduleOverlay();
  }

  function resize() {
    for (const [name, id, height] of [
      ['price', 'chart', 360],
      ['volume', 'volumeChart', 115],
      ['rsi', 'rsiChart', 145],
      ['adx', 'adxChart', 145],
      ['ao', 'aoChart', 145]
    ]) {
      const el = $(id);
      if (!charts[name] || !el || el.clientWidth < 1) continue;
      const h = name === 'price' ? Math.max(240, el.clientHeight || prefs.height) : height;
      charts[name].resize(Math.round(el.clientWidth), Math.round(h));
    }
    resizeCanvas();
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

  function resizeCanvas() {
    const c = $('zonesCanvas');
    const a = $('priceChartArea');
    if (!c || !a || !a.clientWidth || !a.clientHeight) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.round(a.clientWidth * dpr);
    const h = Math.round(a.clientHeight * dpr);
    if (c.width !== w) c.width = w;
    if (c.height !== h) c.height = h;
    c.style.pointerEvents = 'none';
    c.getContext('2d')?.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function scheduleOverlay() {
    if (overlayPending) return;
    overlayPending = true;
    requestAnimationFrame(() => {
      overlayPending = false;
      drawZones();
    });
  }

  function redrawModules() {
    for (const name of ['CryptolexuzFibonacci', 'CryptolexuzRangeBoxes', 'CryptolexuzVolumeProfile']) {
      try {
        window[name]?.redraw?.();
      } catch (e) {
        console.warn(name, e);
      }
    }
  }

  function announceReady() {
    if (!charts.price || !series.price) return;
    const chart = charts.price;
    const candle = series.price;
    window.CryptolexuzChart = {
      chart, chartApi: chart, candle, candleSeries: candle,
      applyOptions: x => chart.applyOptions(x),
      timeScale: () => chart.timeScale(),
      getRows: () => rows,
      getCandles: () => rows,
      getSelection: selection,
      resetView,
      resize
    };
    window.clChart = chart;
    window.chartApi = chart;
    emit('cryptolexuz:chart-ready', {
      chart, candle, candleSeries: candle,
      rows, candles: rows, getRows: () => rows, getSelection: selection
    });
  }

  function attachProfile() {
    const p = window.CryptolexuzVolumeProfile || window.CRYPTOLEXUZ_VOLUME_PROFILE;
    if (!p || !charts.price || !series.price) return;
    if (p === profileAttached && lastProfileRows === rows) return;
    try {
      p.attach?.(charts.price, series.price, {
        getRows: () => rows,
        getCandles: () => rows,
        getSelection: selection
      });
      profileAttached = p;
    } catch (e) {
      console.warn('Volume Profile:', e);
    }
  }

  function updateModules(force = false) {
    attachProfile();
    const p = window.CryptolexuzVolumeProfile || window.CRYPTOLEXUZ_VOLUME_PROFILE;
    if (p && (force || lastProfileRows !== rows)) {
      try {
        if (typeof p.setData === 'function') p.setData(rows);
        else p.updateData?.(rows);
        lastProfileRows = rows;
      } catch (e) {
        console.warn('Volume Profile:', e);
      }
    }
    emit('cryptolexuz:candles-updated', {
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

  function movingConfigurations() {
    return [
      ...prefs.maLines.map(x => ({ ...x, method: 'sma' })),
      ...prefs.emaLines.map(x => ({ ...x, method: 'ema' }))
    ];
  }

  function rebuildMoving() {
    if (!charts.price) return;
    const wanted = new Set();
    for (const conf of movingConfigurations()) {
      const id = conf.method + ':' + conf.period;
      wanted.add(id);
      let item = moving.get(id);
      if (!item) {
        item = charts.price.addLineSeries({
          color: conf.color,
          lineWidth: conf.width,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false
        });
        moving.set(id, item);
      } else {
        item.applyOptions({ color: conf.color, lineWidth: conf.width });
      }
    }
    for (const [id, item] of moving) {
      if (!wanted.has(id)) {
        try {
          charts.price.removeSeries(item);
        } catch {}
        moving.delete(id);
      }
    }
  }

  function updateMoving(closes, force = false) {
    rebuildMoving();
    for (const conf of movingConfigurations()) {
      const target = moving.get(conf.method + ':' + conf.period);
      const active = conf.enabled !== false && prefs.indicators[conf.method === 'ema' ? 'EMA' : 'MA'] !== false;
      const values = active ? (conf.method === 'ema' ? ema(closes, conf.period) : sma(closes, conf.period)) : [];
      setSeries(target, active ? lineData(rows, values) : [], force);
    }
  }

  const namedLines = {
    ema21: ['ema', 21],
    ma55: ['sma', 55],
    ma100: ['sma', 100],
    ma200: ['sma', 200]
  };
  const indicatorMap = {
    rsi: 'RSI', adx: 'ADX', ao: 'AO',
    volume: 'VOL', vol: 'VOL',
    fvg: 'FVG', ifvg: 'IFVG',
    liquidity: 'liquidity', sweeps: 'sweeps',
    support: 'support', resistance: 'resistance',
    ma: 'MA', ema: 'EMA'
  };

  function indicatorActive(name) {
    name = String(name || '').toLowerCase();
    if (namedLines[name]) {
      const [method, period] = namedLines[name];
      const group = method === 'ema' ? 'EMA' : 'MA';
      const list = method === 'ema' ? prefs.emaLines : prefs.maLines;
      return prefs.indicators[group] !== false && list.some(x => x.period === period && x.enabled !== false);
    }
    const k = indicatorMap[name];
    return k ? prefs.indicators[k] !== false : false;
  }

  function updateButtons() {
    document.querySelectorAll('[data-indicator],[data-osc]').forEach(b => {
      const name = b.dataset.indicator || b.dataset.osc;
      const lower = String(name || '').toLowerCase();
      if (!indicatorMap[lower] && !namedLines[lower]) {
        b.setAttribute('aria-disabled', 'true');
        return;
      }
      const active = indicatorActive(lower);
      b.removeAttribute('aria-disabled');
      b.classList.toggle('active', active);
      b.setAttribute('aria-pressed', String(active));
    });
  }

  function updatePanelVisibility() {
    for (const [id, name] of [['rsiSection', 'RSI'], ['adxSection', 'ADX'], ['aoSection', 'AO']]) {
      if ($(id)) $(id).hidden = !prefs.indicators[name];
    }
    const volume = $('volumeChart')?.closest('.volume-section');
    if (volume) volume.hidden = !prefs.indicators.VOL;
    scheduleResize();
  }

  function setIndicator(name, active) {
    name = String(name || '').toLowerCase();
    if (namedLines[name]) {
      const [method, period] = namedLines[name];
      const group = method === 'ema' ? 'EMA' : 'MA';
      const list = method === 'ema' ? prefs.emaLines : prefs.maLines;
      let line = list.find(x => x.period === period);
      if (!line) {
        const d = (method === 'ema' ? EMA_DEFAULT : MA_DEFAULT).find(x => x.period === period);
        line = { ...(d || { period, color: C.purple, width: 2, enabled: false }) };
        list.push(line);
      }
      line.enabled = Boolean(active);
      if (active) prefs.indicators[group] = true;
    } else {
      const k = indicatorMap[name];
      if (!k) return;
      prefs.indicators[k] = Boolean(active);
    }
    saveSettings();
    updateButtons();
    updatePanelVisibility();
    if (rows.length) updateIndicators(true);
    emit('cryptolexuz:indicator-state-updated', { settings: prefs });
  }

  function toggleIndicator(name) {
    setIndicator(name, !indicatorActive(name));
  }

  function applySavedIndicators() {
    prefs = readSettings();
    updateButtons();
    updatePanelVisibility();
    if ($('chart')) $('chart').style.height = prefs.height + 'px';
    if (rows.length) updateIndicators(true);
    scheduleResize();
  }

  function createCharts() {
    if (!window.LightweightCharts || !$('chart')) {
      put('message', 'No se pudo cargar Lightweight Charts.');
      connection('Error de gráfica', C.red);
      return false;
    }
    charts.price = LightweightCharts.createChart($('chart'), chartOptions(prefs.height));
    series.price = charts.price.addCandlestickSeries({
      upColor: C.green, downColor: C.red,
      wickUpColor: C.green, wickDownColor: C.red,
      borderVisible: false
    });
    rebuildMoving();

    for (const [name, id, height] of [
      ['volume', 'volumeChart', 115],
      ['rsi', 'rsiChart', 145],
      ['adx', 'adxChart', 145],
      ['ao', 'aoChart', 145]
    ]) {
      if ($(id)) charts[name] = LightweightCharts.createChart($(id), chartOptions(height));
    }

    if (charts.volume) {
      series.volume = charts.volume.addHistogramSeries({ priceFormat: { type: 'volume' }, priceScaleId: '' });
      series.volume.priceScale().applyOptions({ scaleMargins: { top: 0.12, bottom: 0 } });
    }
    if (charts.rsi) {
      series.rsi = charts.rsi.addLineSeries({ color: C.purple, lineWidth: 2, priceLineVisible: false });
      for (const level of [30, 50, 70]) {
        series.rsi.createPriceLine({
          price: level, color: '#657399',
          lineStyle: LightweightCharts.LineStyle.Dashed, axisLabelVisible: true
        });
      }
    }
    if (charts.adx) {
      for (const [name, color] of [['adx', C.yellow], ['plus', C.green], ['minus', C.red]]) {
        series[name] = charts.adx.addLineSeries({ color, lineWidth: 2, priceLineVisible: false });
      }
    }
    if (charts.ao) {
      series.ao = charts.ao.addHistogramSeries({
        priceFormat: { type: 'price', precision: 5, minMove: 0.00001 },
        priceScaleId: ''
      });
      series.ao.createPriceLine({
        price: 0, color: '#657399',
        lineStyle: LightweightCharts.LineStyle.Dashed, axisLabelVisible: true
      });
    }

    charts.price.timeScale().subscribeVisibleLogicalRangeChange(syncRanges);
    $('chart').style.touchAction = 'pan-y';
    if ($('zonesCanvas')) $('zonesCanvas').style.pointerEvents = 'none';

    if (window.ResizeObserver) {
      const observer = new ResizeObserver(scheduleResize);
      for (const id of ['chart', 'volumeChart', 'rsiChart', 'adxChart', 'aoChart']) {
        if ($(id)) observer.observe($(id));
      }
    }
    window.addEventListener('resize', scheduleResize);

    try {
      window.CryptolexuzFibonacci?.attach?.(charts.price, series.price, {
        getRows: () => rows,
        getSelection: selection
      });
    } catch (e) {
      console.warn('Fibonacci:', e);
    }

    announceReady();
    attachProfile();
    setTimeout(scheduleResize, 150);
    return true;
  }

  function detectPivots(data) {
    const result = [];
    for (let i = 4; i < data.length - 4; i++) {
      const neighbors = data.slice(i - 4, i + 5);
      if (neighbors.every((c, j) => j === 4 || c.high < data[i].high)) {
        result.push({ index: i, price: data[i].high, type: 'high' });
      }
      if (neighbors.every((c, j) => j === 4 || c.low > data[i].low)) {
        result.push({ index: i, price: data[i].low, type: 'low' });
      }
    }
    return result.slice(-40);
  }

  function detectFVG(data) {
    const result = [];
    for (let i = 2; i < data.length; i++) {
      const bull = data[i].low > data[i - 2].high;
      const bear = data[i].high < data[i - 2].low;
      if (!bull && !bear) continue;
      const top = bull ? data[i].low : data[i - 2].low;
      const bottom = bull ? data[i - 2].high : data[i].high;
      if ((top - bottom) / ((top + bottom) / 2) < 0.00035) continue;
      let end = data.length - 1;
      let filled = false;
      let inverted = false;
      for (let j = i + 1; j < data.length; j++) {
        const touched = bull ? data[j].low <= bottom : data[j].high >= top;
        if (touched) {
          end = j;
          filled = true;
          inverted = bull ? data[j].close < bottom : data[j].close > top;
          break;
        }
      }
      result.push({ start: i - 2, end, top, bottom, bull, filled, inverted });
    }
    return result.slice(-80);
  }

  function detectSweeps(data) {
    const result = [];
    for (let i = 20; i < data.length - 1; i++) {
      const previous = data.slice(i - 20, i);
      const high = Math.max(...previous.map(c => c.high));
      const low = Math.min(...previous.map(c => c.low));
      if (data[i].high > high && data[i].close < high) {
        result.push({ time: data[i].time, position: 'aboveBar', color: C.red, shape: 'arrowDown', text: 'Barrido ↑' });
      }
      if (data[i].low < low && data[i].close > low) {
        result.push({ time: data[i].time, position: 'belowBar', color: C.green, shape: 'arrowUp', text: 'Barrido ↓' });
      }
    }
    return result.slice(-25);
  }

  function updateLevels() {
    if (!series.price) return;
    const recent = pivots.slice(-18);
    const requested = [];
    for (const [name, type, color, label] of [['support', 'low', C.green, 'Soporte'], ['resistance', 'high', C.red, 'Resistencia']]) {
      if (prefs.indicators[name]) {
        const p = recent.filter(x => x.type === type).at(-1);
        if (p) requested.push([p.price, color, label]);
      }
    }
    if (prefs.indicators.liquidity) {
      for (const p of recent.filter(x => x.type === 'high').slice(-2)) requested.push([p.price, C.red, 'Máximo']);
      for (const p of recent.filter(x => x.type === 'low').slice(-2)) requested.push([p.price, C.green, 'Mínimo']);
    }
    const signature = JSON.stringify(requested);
    if (signature === levelSignature) return;
    levelSignature = signature;
    for (const line of levelLines) {
      try {
        series.price.removePriceLine(line);
      } catch {}
    }
    levelLines.length = 0;
    for (const [price, color, title] of requested) {
      levelLines.push(series.price.createPriceLine({
        price, color, title,
        lineWidth: 1, lineStyle: LightweightCharts.LineStyle.Dashed, axisLabelVisible: true
      }));
    }
  }

  function drawZones() {
    const canvas = $('zonesCanvas');
    const area = $('priceChartArea');
    if (!canvas || !area || !charts.price || !series.price) return;
    resizeCanvas();
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const w = area.clientWidth;
    const h = area.clientHeight;
    ctx.clearRect(0, 0, w, h);
    if (!prefs.indicators.FVG && !prefs.indicators.IFVG) return;
    for (const zone of zones.slice(-25)) {
      if (!((!zone.filled && prefs.indicators.FVG) || (zone.inverted && prefs.indicators.IFVG))) continue;
      const scale = charts.price.timeScale();
      const x1 = scale.logicalToCoordinate(zone.start);
      const x2 = scale.logicalToCoordinate(zone.end);
      const y1 = series.price.priceToCoordinate(zone.top);
      const y2 = series.price.priceToCoordinate(zone.bottom);
      if (![x1, x2, y1, y2].every(Number.isFinite)) continue;
      const left = Math.max(0, x1);
      const right = Math.min(w - 70, x2);
      const top = Math.max(0, Math.min(y1, y2));
      const bottom = Math.min(h, Math.max(y1, y2));
      if (right <= left || bottom <= top) continue;
      ctx.fillStyle = zone.inverted ? 'rgba(255,225,90,.12)' : (zone.bull ? 'rgba(0,245,160,.09)' : 'rgba(255,71,108,.09)');
      ctx.fillRect(left, top, right - left, bottom - top);
      ctx.strokeStyle = zone.inverted ? '#ffe15a' : (zone.bull ? 'rgba(0,245,160,.4)' : 'rgba(255,71,108,.4)');
      ctx.strokeRect(left, top, right - left, bottom - top);
    }
  }

  function updateIndicators(force = false) {
    if (!rows.length || !series.price) return;
    const closes = rows.map(c => c.close);
    const e = ema(closes, 21);
    const m = sma(closes, 55);
    const rv = rsi(closes);
    const av = adx(rows);
    const ao = awesomeOscillator(rows);

    updateMoving(closes, force);
    setSeries(series.rsi, prefs.indicators.RSI ? lineData(rows, rv) : [], force);
    for (const [name, values] of [['adx', av.adx], ['plus', av.plus], ['minus', av.minus]]) {
      setSeries(series[name], prefs.indicators.ADX ? lineData(rows, values) : [], force);
    }
    setSeries(series.ao, prefs.indicators.AO ? aoBars(rows, ao) : [], force);

    const valid = closed(rows, selection().tf);
    const last = valid.at(-1);
    const index = last ? rows.findIndex(c => c.time === last.time) : -1;
    if (index >= 0) {
      for (const [id, value, digits] of [
        ['ema21Value', e[index], 2],
        ['ma55Value', m[index], 2],
        ['rsiValue', rv[index], 1],
        ['adxValue', av.adx[index], 1],
        ['rsiChartValue', rv[index], 1],
        ['adxChartValue', av.adx[index], 1],
        ['aoValue', ao[index], 5]
      ]) {
        put(id, fmt(value, digits));
      }

      const r = rv[index];
      lastRSI = !Number.isFinite(r)
        ? 'RSI no disponible.'
        : r < 30
          ? 'RSI en sobreventa; rebote no confirmado.'
          : r > 70
            ? 'RSI en sobrecompra; caída no confirmada.'
            : r >= 50
              ? 'RSI con predominio comprador.'
              : 'RSI con predominio vendedor.';
      put('rsiInterpretation', lastRSI);

      const strength = av.adx[index];
      put(
        'adxInterpretation',
        Number.isFinite(strength)
          ? 'ADX ' + fmt(strength, 1) + (strength >= 25 ? '. Tendencia con fuerza.' : '. Tendencia débil.')
          : 'ADX no disponible.'
      );

      const a = ao[index];
      const p = ao[index - 1];
      put(
        'aoInterpretation',
        !Number.isFinite(a)
          ? 'AO sin historial suficiente.'
          : p <= 0 && a > 0
            ? 'AO: cruce alcista de cero.'
            : p >= 0 && a < 0
              ? 'AO: cruce bajista de cero.'
              : a > 0 && a > p
                ? 'AO positivo y aumentando.'
                : a > 0
                  ? 'AO positivo, perdiendo impulso.'
                  : a < p
                    ? 'AO negativo y descendiendo.'
                    : 'AO negativo, recuperando impulso.'
      );

      const trend = Number.isFinite(e[index]) && Number.isFinite(m[index])
        ? (closes[index] > e[index] && e[index] > m[index]
            ? 'Sesgo alcista'
            : closes[index] < e[index] && e[index] < m[index]
              ? 'Sesgo bajista'
              : 'Mercado mixto')
        : 'Historial insuficiente';
      put('indicatorReadout', trend + '. ' + lastRSI);
    }

    const previous = valid.slice(-21, -1);
    if (last && previous.length === 20) {
      const avg = previous.reduce((s, c) => s + c.volume, 0) / 20;
      put(
        'volumeInterpretation',
        avg ? 'Volumen de última vela cerrada: ' + fmt(last.volume / avg, 2) + ' veces el promedio.' : 'Volumen insuficiente.'
      );
    }

    pivots = detectPivots(rows);
    zones = detectFVG(rows);
    const markers = prefs.indicators.sweeps ? detectSweeps(rows) : [];
    const signature = JSON.stringify(markers);
    if (markerSignature !== signature) {
      series.price.setMarkers(markers);
      markerSignature = signature;
    }
    updateLevels();
    scheduleOverlay();
  }

  async function getJSON(url, timeout = 12000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const response = await fetch(url, { signal: controller.signal, cache: 'no-store' });
      if (!response.ok) throw Error('HTTP ' + response.status);
      const data = await response.json();
      if (data?.code !== undefined && ![0, '0'].includes(data.code)) {
        throw Error(data.msg || data.message || 'Error del exchange');
      }
      return data;
    } finally {
      clearTimeout(timer);
    }
  }

  const candleURL = (s, limit = 300) => (
    '/api/exchange/' + encodeURIComponent(s.exchange) +
    '/klines/' + encodeURIComponent(s.symbol) +
    '?market=' + encodeURIComponent(s.market) +
    '&interval=' + encodeURIComponent(s.tf) +
    '&limit=' + limit
  );

  const tickerURL = s => (
    '/api/exchange/' + encodeURIComponent(s.exchange) +
    '/ticker/' + encodeURIComponent(s.symbol) +
    '?market=' + encodeURIComponent(s.market)
  );

  function sameCandle(a, b) {
    return Boolean(
      a && b &&
      a.time === b.time &&
      a.open === b.open &&
      a.high === b.high &&
      a.low === b.low &&
      a.close === b.close &&
      a.volume === b.volume
    );
  }

  function classifyChange(oldData, newData) {
    if (!oldData.length || !newData.length) return 'rebuild';
    if (oldData.length === newData.length && oldData.slice(0, -1).every((c, i) => sameCandle(c, newData[i]))) {
      return sameCandle(oldData.at(-1), newData.at(-1)) ? 'none' : 'last';
    }
    if (newData.length === oldData.length + 1 && oldData.every((c, i) => sameCandle(c, newData[i]))) {
      return 'append';
    }
    return 'rebuild';
  }

  function applyCandles(data, s) {
    const changed = currentKey !== key(s);
    const type = changed ? 'rebuild' : classifyChange(rows, data);
    if (type === 'none') {
      put('status', 'Velas actualizadas');
      return;
    }
    const previous = changed ? null : range();
    rows = data;
    currentKey = key(s);
    const last = data.at(-1);
    if (type === 'last' || type === 'append') {
      series.price.update(last);
      series.volume?.update(volumeBar(last));
    } else {
      series.price.setData(rows);
      series.volume?.setData(rows.map(volumeBar));
      seriesCache.delete(series.volume);
    }
    const force = type === 'rebuild' || changed;
    updateIndicators(force);
    updateModules(force);
    if (changed) resetView();
    else if (force && previous) restore(previous);
    put('chartTitle', s.symbol + ' · ' + s.tf);
    put('volumeLabel', s.symbol === GOLD ? 'GOLD' : (s.symbol === OIL ? 'OIL WTI' : s.symbol.split('-')[0]));
    scheduleOverlay();
  }

  async function refresh() {
    if (!series.price) return;
    if (chartBusy) {
      chartAgain = true;
      return;
    }
    chartBusy = true;
    const id = chartRequest;
    const s = selection();
    try {
      put('status', 'Cargando ' + s.symbol + ' · ' + s.tf);
      const data = normalize(await getJSON(candleURL(s)));
      if (id !== chartRequest || key(s) !== key(selection())) return;
      if (!data.length) throw Error('Sin velas válidas');
      applyCandles(data, s);
      put('status', 'Velas actualizadas');
      put('message', '');
    } catch (e) {
      if (id === chartRequest) {
        put('status', 'Error: ' + e.message);
        put('message', 'Comprueba la conexión con el servidor.');
      }
    } finally {
      chartBusy = false;
      if (chartAgain) {
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
    if (tickerBusy) {
      tickerAgain = true;
      return;
    }
    tickerBusy = true;
    const s = selection();
    const id = tickerRequest;
    try {
      const d = tickerData(await getJSON(tickerURL(s), 8000));
      if (id !== tickerRequest || key(s) !== key(selection())) return;
      const price = Number(d.lastPrice ?? d.last ?? d.price ?? d.close ?? d.c);
      const open = Number(d.openPrice ?? d.open24h ?? d.open ?? d.o);
      let change = Number(d.priceChangePercent ?? d.changePercent);
      if (!Number.isFinite(change) && price > 0 && open > 0) change = (price / open - 1) * 100;
      if (price > 0 && Date.now() - lastWS > 7000) {
        put('price', fmt(price));
        connection(s.exchange.toUpperCase() + ' · REST');
      }
      for (const [idEl, value, n] of [
        ['high', d.highPrice ?? d.high24h ?? d.high ?? d.h, 2],
        ['low', d.lowPrice ?? d.low24h ?? d.low ?? d.l, 2],
        ['open', open, 2],
        ['volume', d.volume ?? d.volume24h ?? d.vol ?? d.v, 0],
        ['bid', d.bidPrice ?? d.bid ?? d.bestBid, 2],
        ['ask', d.askPrice ?? d.ask ?? d.bestAsk, 2]
      ]) {
        put(idEl, fmt(value, n));
      }
      put('change', Number.isFinite(change) ? (change >= 0 ? '+' : '') + fmt(change) + '%' : '—');
      $('change')?.classList.toggle('negative', change < 0);
      put('updated', new Date().toLocaleTimeString('es-MX'));
    } catch (e) {
      console.warn('Ticker:', e.message);
    } finally {
      tickerBusy = false;
      if (tickerAgain) {
        tickerAgain = false;
        queueMicrotask(refreshTicker);
      }
    }
  }

  function disconnect() {
    socketToken++;
    clearTimeout(reconnectTimer);
    if (socket) {
      const old = socket;
      socket = null;
      old.onopen = old.onmessage = old.onclose = old.onerror = null;
      try {
        old.close();
      } catch {}
    }
  }

  function connect() {
    disconnect();
    const token = socketToken;
    const s = selection();
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = (
      protocol + '//' + location.host + '/ws' +
      '?exchange=' + encodeURIComponent(s.exchange) +
      '&market=' + encodeURIComponent(s.market) +
      '&symbol=' + encodeURIComponent(s.symbol)
    );
    connection(s.exchange.toUpperCase() + ' · conectando');
    try {
      socket = new WebSocket(url);
    } catch {
      scheduleReconnect(token);
      return;
    }
    socket.onopen = () => {
      if (token === socketToken) connection('Esperando precios');
    };
    socket.onmessage = event => {
      if (token !== socketToken) return;
      let data;
      try {
        data = JSON.parse(event.data);
      } catch {
        return;
      }
      if (data.type !== 'price' || data.symbol !== s.symbol || data.market !== s.market || data.exchange !== s.exchange) return;
      const price = Number(data.price);
      if (!Number.isFinite(price) || price <= 0) return;
      put('price', fmt(price));
      put('updated', new Date().toLocaleTimeString('es-MX'));
      lastWS = Date.now();
      connection(s.exchange.toUpperCase() + ' · en vivo', C.green);
    };
    socket.onerror = () => {
      if (token === socketToken) connection('Conexión interrumpida', C.red);
    };
    socket.onclose = () => {
      if (token === socketToken) {
        socket = null;
        scheduleReconnect(token);
      }
    };
  }

  function scheduleReconnect(token) {
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(() => {
      if (token === socketToken && !document.hidden) connect();
    }, 4000);
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

    if (![e, m, rv, strength, plus, minus].every(Number.isFinite)) return null;

    let bull = 0;
    let bear = 0;
    if (last.close > e) bull++;
    if (last.close < e) bear++;
    if (e > m) bull++;
    if (e < m) bear++;
    if (rv >= 55) bull++;
    if (rv <= 45) bear++;
    if (plus > minus) bull++;
    if (minus > plus) bear++;

    const previous = candles.slice(-7, -1);
    const average = candles.slice(-21, -1).reduce((s, c) => s + c.volume, 0) / 20;

    return {
      bull, bear,
      adx: strength, plus, minus, rsi: rv,
      ao: aoNow, aoPrevious,
      aoBull: Number.isFinite(aoNow) && Number.isFinite(aoPrevious) && aoNow > 0 && aoNow > aoPrevious,
      aoBear: Number.isFinite(aoNow) && Number.isFinite(aoPrevious) && aoNow < 0 && aoNow < aoPrevious,
      volRatio: average ? last.volume / average : 0,
      close: last.close,
      closedTime: last.time,
      atr: atr(candles),
      breakHigh: last.close > Math.max(...previous.map(c => c.high)),
      breakLow: last.close < Math.min(...previous.map(c => c.low))
    };
  }

  function analyze(data, tf) {
    const m = metric(data, tf);
    if (!m) return { state: 'SIN DATOS', direction: 'neutral', detail: 'Historial insuficiente.', metrics: '—', price: null };
    const bullish = m.bull >= 3 && m.bull > m.bear;
    const bearish = m.bear >= 3 && m.bear > m.bull;
    const opportunity = (
      m.bull === 4 && m.adx >= 25 && m.rsi < 70
        ? 'Posible LONG'
        : m.bear === 4 && m.adx >= 25 && m.rsi > 30
          ? 'Posible SHORT'
          : 'Sin entrada confirmada'
    );
    const aoText = m.aoBull ? 'AO alcista' : (m.aoBear ? 'AO bajista' : 'AO sin confirmación');
    return {
      state: bullish ? 'SESGO ALCISTA' : (bearish ? 'SESGO BAJISTA' : 'LATERAL / MIXTO'),
      direction: bullish ? 'bullish' : (bearish ? 'bearish' : 'neutral'),
      detail: opportunity + '. ' + aoText + '. Requiere confirmación.',
      metrics: 'RSI ' + fmt(m.rsi, 1) + ' · ADX ' + fmt(m.adx, 1),
      price: m.close
    };
  }

  
