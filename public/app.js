
const $ = id => document.getElementById(id);
const API = location.origin;

const COLORS = {
  ema21: '#b43cff',
  ma55: '#ff922b',
  ma100: '#ff466b',
  ma200: '#46adff'
};

const enabled = new Set(['ema21', 'ma55']);

let priceChart;
let volumeChart;
let candles;
let histogram;
let lines = {};
let priceLines = {};
let currentRows = [];

let busy = false;
let requestPending = false;
let chartUnlocked = false;
let initialView = true;
let lastChartKey = '';
let syncing = false;

const signalKeys = new Set();
const signalHistory = [];

const fmt = (v, d = 2) =>
  v == null || v === '' || !Number.isFinite(+v)
    ? '—'
    : (+v).toLocaleString('en-US', {
        maximumFractionDigits: d
      });

const field = (o, keys) =>
  keys.map(k => o?.[k])
      .find(v => v !== undefined && v !== null);

const setText = (id, value) => {
  const el = $(id);
  if (el) el.textContent = value;
};

async function api(path) {
  const response = await fetch(API + path, {
    cache: 'no-store'
  });

  if (!response.ok) {
    throw Error('HTTP ' + response.status);
  }

  const json = await response.json();

  if (json.error) {
    throw Error(
      typeof json.error === 'string'
        ? json.error
        : JSON.stringify(json.error)
    );
  }

  return json;
}

function normalize(raw) {
  const source = Array.isArray(raw)
    ? raw
    : Array.isArray(raw?.data)
      ? raw.data
      : Array.isArray(raw?.rows)
        ? raw.rows
        : [];

  const rows = source.map(v => {
    const a = Array.isArray(v);

    let t = +(a
      ? v[0]
      : field(v, ['time', 'timestamp', 't']));

    if (t > 1e12) {
      t = Math.floor(t / 1000);
    }

    return {
      time: t,
      open: +(a ? v[1] : field(v, ['open', 'o'])),
      high: +(a ? v[2] : field(v, ['high', 'h'])),
      low: +(a ? v[3] : field(v, ['low', 'l'])),
      close: +(a ? v[4] : field(v, ['close', 'c'])),
      volume: +(a
        ? v[5]
        : field(v, ['volume', 'vol', 'v'])) || 0
    };
  });

  const unique = new Map();

  for (const row of rows) {
    if (
      row.time > 0 &&
      [row.open, row.high, row.low, row.close]
        .every(Number.isFinite)
    ) {
      unique.set(row.time, row);
    }
  }

  return [...unique.values()]
    .sort((a, b) => a.time - b.time);
}

function ema(rows, n) {
  let value = null;
  const k = 2 / (n + 1);

  return rows.map(r => {
    value = value === null
      ? r.close
      : value + (r.close - value) * k;

    return value;
  });
}

function sma(rows, n) {
  let sum = 0;

  return rows.map((r, i) => {
    sum += r.close;

    if (i >= n) {
      sum -= rows[i - n].close;
    }

    return i < n - 1 ? null : sum / n;
  });
}

function rsi(rows, n = 14) {
  const out = Array(rows.length).fill(null);

  if (rows.length <= n) return out;

  let gains = 0;
  let losses = 0;

  for (let i = 1; i <= n; i++) {
    const change = rows[i].close - rows[i - 1].close;
    gains += Math.max(change, 0);
    losses += Math.max(-change, 0);
  }

  gains /= n;
  losses /= n;

  const value = () =>
    losses === 0
      ? (gains === 0 ? 50 : 100)
      : 100 - 100 / (1 + gains / losses);

  out[n] = value();

  for (let i = n + 1; i < rows.length; i++) {
    const change = rows[i].close - rows[i - 1].close;

    gains = (
      gains * (n - 1) + Math.max(change, 0)
    ) / n;

    losses = (
      losses * (n - 1) + Math.max(-change, 0)
    ) / n;

    out[i] = value();
  }

  return out;
}

function adx(rows, n = 14) {
  const result = {
    adx: Array(rows.length).fill(null),
    plus: Array(rows.length).fill(null),
    minus: Array(rows.length).fill(null)
  };

  if (rows.length < 2 * n + 1) return result;

  const tr = [];
  const pd = [];
  const md = [];

  for (let i = 1; i < rows.length; i++) {
    const a = rows[i];
    const p = rows[i - 1];

    const up = a.high - p.high;
    const down = p.low - a.low;

    tr[i] = Math.max(
      a.high - a.low,
      Math.abs(a.high - p.close),
      Math.abs(a.low - p.close)
    );

    pd[i] = up > down && up > 0 ? up : 0;
    md[i] = down > up && down > 0 ? down : 0;
  }

  let st = 0;
  let sp = 0;
  let sm = 0;

  for (let i = 1; i <= n; i++) {
    st += tr[i];
    sp += pd[i];
    sm += md[i];
  }

  const dx = Array(rows.length).fill(null);

  for (let i = n; i < rows.length; i++) {
    if (i > n) {
      st = st - st / n + tr[i];
      sp = sp - sp / n + pd[i];
      sm = sm - sm / n + md[i];
    }

    const plus = 100 * sp / (st || 1);
    const minus = 100 * sm / (st || 1);

    result.plus[i] = plus;
    result.minus[i] = minus;

    dx[i] =
      100 * Math.abs(plus - minus) /
      (plus + minus || 1);
  }

  let total = 0;

  for (let i = n; i < 2 * n; i++) {
    total += dx[i];
  }

  let value = total / n;

  result.adx[2 * n - 1] = value;

  for (let i = 2 * n; i < rows.length; i++) {
    value = (value * (n - 1) + dx[i]) / n;
    result.adx[i] = value;
  }

  return result;
}

function touchSettings(unlocked) {
  return {
    handleScroll: {
      mouseWheel: true,
      pressedMouseMove: true,
      horzTouchDrag: unlocked,
      vertTouchDrag: false
    },
    handleScale: {
      axisPressedMouseMove: true,
      mouseWheel: true,
      pinch: true
    }
  };
}

function applyNavigation() {
  if (!priceChart || !volumeChart) return;

  priceChart.applyOptions(touchSettings(chartUnlocked));
  volumeChart.applyOptions(touchSettings(chartUnlocked));

  const button = $('chartNavigation');

  if (button) {
    button.setAttribute(
      'aria-pressed',
      String(chartUnlocked)
    );

    button.textContent = chartUnlocked
      ? '🔓 Bloquear gráfica'
      : '🔒 Desbloquear gráfica';
  }

  setText(
    'chartTouchStatus',
    chartUnlocked
      ? 'Gráfica desbloqueada: arrastra las velas con un dedo. Usa dos dedos para ampliar.'
      : 'Gráfica bloqueada: desliza la página con un dedo.'
  );
}

function resetChartView() {
  if (!priceChart || !currentRows.length) return;

  const total = currentRows.length;

  // Mostrar aproximadamente las últimas 50 velas.
  const from = Math.max(0, total - 50);

  const range = {
    from,
    to: total + 2
  };

  priceChart.timeScale().setVisibleLogicalRange(range);
  volumeChart.timeScale().setVisibleLogicalRange(range);
}

function createCharts() {
  if (!window.LightweightCharts) {
    throw Error('No se pudo cargar Lightweight Charts.');
  }

  const priceEl = $('chart');
  const volEl = $('volumeChart');

  if (!priceEl || !volEl) {
    throw Error('Faltan los contenedores de las gráficas.');
  }

  const common = {
    layout: {
      background: { color: '#081426' },
      textColor: '#b3c4df'
    },
    grid: {
      vertLines: { color: '#1b2c43' },
      horzLines: { color: '#1b2c43' }
    },
    rightPriceScale: {
      borderColor: '#39516d'
    },
    timeScale: {
      timeVisible: true,
      secondsVisible: false,
      borderColor: '#39516d',
      rightOffset: 3,
      barSpacing: 9,
      minBarSpacing: 4,
      fixLeftEdge: false,
      fixRightEdge: false
    }
  };

  priceChart = LightweightCharts.createChart(
    priceEl,
    {
      ...common,
      ...touchSettings(false),
      width: priceEl.clientWidth,
      height: priceEl.clientHeight || 340,
      timeScale: {
        ...common.timeScale,
        visible: false
      },
      crosshair: {
        mode: LightweightCharts.CrosshairMode.Normal
      }
    }
  );

  volumeChart = LightweightCharts.createChart(
    volEl,
    {
      ...common,
      ...touchSettings(false),
      width: volEl.clientWidth,
      height: volEl.clientHeight || 115,
      timeScale: {
        ...common.timeScale,
        visible: true
      }
    }
  );

  candles = priceChart.addCandlestickSeries({
    upColor: '#00e69b',
    downColor: '#ff3868',
    borderUpColor: '#00e69b',
    borderDownColor: '#ff3868',
    wickUpColor: '#00e69b',
    wickDownColor: '#ff3868'
  });

  histogram = volumeChart.addHistogramSeries({
    priceFormat: {
      type: 'volume'
    },
    priceScaleId: 'right',
    priceLineVisible: false,
    lastValueVisible: true
  });

  volumeChart.priceScale('right').applyOptions({
    scaleMargins: {
      top: 0.12,
      bottom: 0
    }
  });

  Object.entries(COLORS).forEach(([key, color]) => {
    lines[key] = priceChart.addLineSeries({
      color,
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: true,
      crosshairMarkerVisible: false
    });
  });

  function sync(from, to) {
    from.timeScale().subscribeVisibleLogicalRangeChange(
      range => {
        if (syncing || !range) return;

        syncing = true;

        try {
          to.timeScale().setVisibleLogicalRange(range);
        } catch (e) {
          console.warn('Sincronización:', e.message);
        } finally {
          syncing = false;
        }
      }
    );
  }

  sync(priceChart, volumeChart);
  sync(volumeChart, priceChart);

  const resize = () => {
    priceChart.applyOptions({
      width: priceEl.clientWidth,
      height: priceEl.clientHeight || 340
    });

    volumeChart.applyOptions({
      width: volEl.clientWidth,
      height: volEl.clientHeight || 115
    });
  };

  if ('ResizeObserver' in window) {
    new ResizeObserver(resize).observe(priceEl);
    new ResizeObserver(resize).observe(volEl);
  } else {
    window.addEventListener('resize', resize);
  }

  applyNavigation();
}

function updateIndicators() {
  if (!candles || !currentRows.length) return;

  const rows = currentRows;

  const values = {
    ema21: ema(rows, 21),
    ma55: sma(rows, 55),
    ma100: sma(rows, 100),
    ma200: sma(rows, 200)
  };

  Object.keys(lines).forEach(key => {
    const data = enabled.has(key)
      ? rows.flatMap((r, i) =>
          Number.isFinite(values[key][i])
            ? [{
                time: r.time,
                value: values[key][i]
              }]
            : []
        )
      : [];

    lines[key].setData(data);
  });

  for (const key of ['support', 'resistance']) {
    if (priceLines[key]) {
      candles.removePriceLine(priceLines[key]);
      priceLines[key] = null;
    }
  }

  const recent = rows.slice(0, -1).slice(-50);

  if (recent.length) {
    if (enabled.has('support')) {
      priceLines.support = candles.createPriceLine({
        price: Math.min(...recent.map(r => r.low)),
        color: '#00e69b',
        lineWidth: 2,
        lineStyle: 2,
        axisLabelVisible: true,
        title: 'Soporte'
      });
    }

    if (enabled.has('resistance')) {
      priceLines.resistance = candles.createPriceLine({
        price: Math.max(...recent.map(r => r.high)),
        color: '#ff3868',
        lineWidth: 2,
        lineStyle: 2,
        axisLabelVisible: true,
        title: 'Resistencia'
      });
    }
  }

  const i = Math.max(0, rows.length - 2);

  const rv = rsi(rows)[i];
  const ax = adx(rows).adx[i];

  setText('ema21Value', fmt(values.ema21[i]));
  setText('ma55Value', fmt(values.ma55[i]));
  setText('rsiValue', fmt(rv, 1));
  setText('adxValue', fmt(ax, 1));

  setText(
    'indicatorReadout',
    `RSI 14: ${fmt(rv, 1)} · ADX Wilder: ${fmt(ax, 1)} · Datos de la última vela cerrada.`
  );
}

function setupButtons() {
  document.querySelectorAll('[data-indicator]')
    .forEach(button => {
      const key = button.dataset.indicator;

      button.setAttribute(
        'aria-pressed',
        String(enabled.has(key))
      );

      // Los indicadores gráficos pendientes se
      // activarán cuando tengan su propio panel.
      if (button.disabled) return;

      if (key === 'rsi' || key === 'adx') {
        button.disabled = true;
        button.textContent += ' · próximo paso';
        return;
      }

      button.addEventListener('click', () => {
        if (enabled.has(key)) {
          enabled.delete(key);
        } else {
          enabled.add(key);
        }

        button.setAttribute(
          'aria-pressed',
          String(enabled.has(key))
        );

        updateIndicators();
      });
    });

  $('chartNavigation')?.addEventListener('click', () => {
    chartUnlocked = !chartUnlocked;
    applyNavigation();
  });

  $('chartReset')?.addEventListener('click', () => {
    resetChartView();
  });
}

function evaluate(rows, tf, symbol) {
  if (rows.length < 70) {
    return {
      tf,
      symbol,
      side: 'WAIT',
      label: 'DATOS INSUFICIENTES',
      detail: 'Esperando suficientes velas cerradas.',
      metrics: '—'
    };
  }

  const i = rows.length - 2;
  const r = rows[i];

  const e21 = ema(rows, 21);
  const e55 = ema(rows, 55);

  const rv = rsi(rows)[i];
  const a = adx(rows).adx[i];

  const prev = rows.slice(i - 20, i);

  const hi = Math.max(...prev.map(x => x.high));
  const lo = Math.min(...prev.map(x => x.low));

  const sweepLow = r.low < lo && r.close > lo;
  const sweepHigh = r.high > hi && r.close < hi;

  const gapUp = i >= 2 && r.low > rows[i - 2].high;
  const gapDown = i >= 2 && r.high < rows[i - 2].low;

  const bull =
    e21[i] > e55[i] &&
    r.close > e21[i] &&
    e21[i] > e21[i - 4];

  const bear =
    e21[i] < e55[i] &&
    r.close < e21[i] &&
    e21[i] < e21[i - 4];

  let side = 'WAIT';
  let detail = 'No hay confluencia suficiente. ESPERAR.';

  if (
    bull &&
    rv > 50 &&
    rv < 75 &&
    a >= 18 &&
    (sweepLow || gapUp)
  ) {
    side = 'LONG';
    detail = `Sesgo alcista; RSI ${fmt(rv, 1)}; ADX ${fmt(a, 1)}; ${
      sweepLow
        ? 'barrido de mínimo'
        : 'brecha alcista de tres velas'
    }.`;
  } else if (
    bear &&
    rv < 50 &&
    rv > 25 &&
    a >= 18 &&
    (sweepHigh || gapDown)
  ) {
    side = 'SHORT';
    detail = `Sesgo bajista; RSI ${fmt(rv, 1)}; ADX ${fmt(a, 1)}; ${
      sweepHigh
        ? 'barrido de máximo'
        : 'brecha bajista de tres velas'
    }.`;
  }

  return {
    tf,
    symbol,
    side,
    label: side === 'WAIT'
      ? 'NO HAY ENTRADA'
      : `POSIBLE ${side}`,
    detail,
    metrics:
      `EMA21 ${fmt(e21[i])} · EMA55 ${fmt(e55[i])} · ` +
      `RSI ${fmt(rv, 1)} · ADX ${fmt(a, 1)}`,
    price: r.close,
    time: r.time
  };
}

function showSignal(r) {
  const suffix = r.tf === '5m' ? '5' : '15';

  setText('state' + suffix, r.label);
  setText('detail' + suffix, r.detail);
  setText('metrics' + suffix, r.metrics);

  const el = $('state' + suffix);

  if (el) {
    el.className = 'state ' + (
      r.side === 'LONG'
        ? 'long'
        : r.side === 'SHORT'
          ? 'short'
          : 'wait'
    );
  }
}

function recordSignal(r, market) {
  if (r.side === 'WAIT') return;

  const key =
    `${market}:${r.symbol}:${r.tf}:${r.time}`;

  if (signalKeys.has(key)) return;

  signalKeys.add(key);

  signalHistory.unshift({
    ...r,
    stamp: new Date().toLocaleTimeString()
  });

  signalHistory.length = Math.min(
    signalHistory.length,
    30
  );

  const body = $('signalLog');
  if (!body) return;

  body.replaceChildren(
    ...signalHistory.map(item => {
      const tr = document.createElement('tr');

      const cells = [
        item.stamp,
        item.tf,
        item.symbol,
        item.label,
        fmt(item.price),
        item.detail,
        'EN OBSERVACIÓN'
      ];

      for (const value of cells) {
        const td = document.createElement('td');
        td.textContent = value;
        tr.append(td);
      }

      return tr;
    })
  );
}

async function monitor(symbol, market) {
  document.querySelectorAll('.signal-grid h3')
    .forEach((h, i) => {
      h.textContent =
        `${symbol} / ${i === 0 ? '5' : '15'} minutos`;
    });

  const frames = ['5m', '15m'];

  const results = await Promise.allSettled(
    frames.map(tf =>
      api(
        `/api/market/${market}/klines/${symbol}` +
        `?interval=${tf}&limit=300`
      )
    )
  );

  results.forEach((result, i) => {
    const tf = frames[i];

    if (result.status === 'fulfilled') {
      const r = evaluate(
        normalize(result.value.data),
        tf,
        symbol
      );

      showSignal(r);
      recordSignal(r, market);
    } else {
      const suffix = tf === '5m' ? '5' : '15';

      setText('state' + suffix, 'ERROR DE DATOS');
      setText('detail' + suffix, result.reason.message);
    }
  });
}

async function refresh() {
  if (busy) {
    requestPending = true;
    return;
  }

  busy = true;

  const symbol = $('symbol').value;
  const market = $('market').value;
  const tf = $('interval').value;

  const chartKey = `${market}:${symbol}:${tf}`;
  const changed = chartKey !== lastChartKey;

  $('refresh').disabled = true;

  setText('chartTitle', `${symbol} · ${tf}`);
  setText('message', 'Actualizando datos...');

  try {
    const [ticker, klines] = await Promise.all([
      api(`/api/market/${market}/ticker/${symbol}`),
      api(
        `/api/market/${market}/klines/${symbol}` +
        `?interval=${tf}&limit=300`
      )
    ]);

    // Ignorar una respuesta antigua si el usuario
    // cambió el activo mientras cargaban los datos.
    if (
      symbol !== $('symbol').value ||
      market !== $('market').value ||
      tf !== $('interval').value
    ) {
      requestPending = true;
      return;
    }

    const d = ticker.data || {};
    const rows = normalize(klines.data);

    if (!rows.length) {
      throw Error('No se reconocieron las velas de BingX.');
    }

    setText(
      'price',
      fmt(field(d, [
        'lastPrice',
        'last',
        'price',
        'close'
      ]))
    );

    const change = field(d, [
      'priceChangePercent',
      'changePercent'
    ]);

    setText(
      'change',
      change == null
        ? '—'
        : fmt(change, 2) + '%'
    );

    $('change').style.color =
      +change >= 0 ? '#00e69b' : '#ff3868';

    const fields = {
      high: ['highPrice', 'high'],
      low: ['lowPrice', 'low'],
      open: ['openPrice', 'open'],
      volume: ['volume', 'quoteVolume', 'turnover'],
      bid: ['bidPrice', 'bid'],
      ask: ['askPrice', 'ask']
    };

    for (const [id, keys] of Object.entries(fields)) {
      setText(id, fmt(field(d, keys)));
    }

    // Conservar la posición del gráfico si el
    // usuario está revisando velas anteriores.
    const previousRange = !changed && !initialView
      ? priceChart.timeScale().getVisibleLogicalRange()
      : null;

    candles.setData(
      rows.map(({ time, open, high, low, close }) => ({
        time,
        open,
        high,
        low,
        close
      }))
    );

    histogram.setData(
      rows.map(r => ({
        time: r.time,
        value: r.volume,
        color: r.close >= r.open
          ? 'rgba(0,230,155,.85)'
          : 'rgba(255,56,104,.85)'
      }))
    );

    currentRows = rows;
    updateIndicators();

    if (changed || initialView) {
      resetChartView();
      initialView = false;
      lastChartKey = chartKey;
    } else if (previousRange) {
      priceChart.timeScale()
        .setVisibleLogicalRange(previousRange);
    }

    setText('volumeLabel', symbol.split('-')[0]);

    setText(
      'message',
      `${rows.length} velas cargadas · ` +
      'Precio y volumen sincronizados.'
    );

    setText('connection', '● Conectado a BingX');
    $('connection').style.color = '#00e69b';

    setText(
      'status',
      'Datos públicos de BingX recibidos.'
    );

    setText('engineState', 'MONITOREANDO');

    setText(
      'updated',
      new Date().toLocaleTimeString()
    );

    await monitor(symbol, market);
  } catch (e) {
    setText('message', 'Error: ' + e.message);
    setText('connection', '● Error de datos');

    $('connection').style.color = '#ff3868';

    setText('status', e.message);
    setText('engineState', 'SIN DATOS');
  } finally {
    busy = false;
    $('refresh').disabled = false;

    if (requestPending) {
      requestPending = false;
      refresh();
    }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  try {
    createCharts();
    setupButtons();

    $('refresh').addEventListener('click', refresh);

    ['symbol', 'market', 'interval'].forEach(id => {
      $(id).addEventListener('change', refresh);
    });

    refresh();

    setInterval(refresh, 30000);
  } catch (e) {
    setText(
      'message',
      'Error al iniciar: ' + e.message
    );

    console.error(e);
  }
});
