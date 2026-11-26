
/*
 CRYPTOLEXUZ PRO — VOLUME PROFILE V6 COMPLETO

 Compatible con Lightweight Charts 4.2.2.

 FUNCIONES:
 - Controles debajo de la gráfica.
 - Perfil a izquierda o derecha.
 - POC, VAH y VAL.
 - Área de valor aproximada al 70%.
 - Distribución estimada con OHLCV.
 - Compras y ventas estimadas.
 - Opacidad configurable.
 - Anchura configurable.
 - Niveles configurables.
 - Perfil de velas visibles.
 - Actualización mediante eventos.
 - Sin modificar métodos de Lightweight Charts.
 - Protección al cambiar de mercado.
 - Conserva preferencias V5, V4 y V2.
 - Compatible con integración de app.js.
 - Sin ejecución de operaciones.

 IMPORTANTE:
 El perfil no utiliza volumen real
 negociado en cada nivel de precio.
 No representa delta real de órdenes.
*/

"use strict";

(() => {

  if (window.__clVolumeProfileV6) return;
  window.__clVolumeProfileV6 = true;

  const $ = id =>
    document.getElementById(id);

  const KEY =
    "cryptolexuz.volumeProfile.v6";

  const OLD_KEYS = [
    "cryptolexuz.volumeProfile.v5",
    "cryptolexuz.volumeProfile.v4",
    "cryptolexuz.volumeProfile.v2"
  ];

  const DEFAULTS = {
    enabled: true,
    side: "right",
    width: 90,
    bins: 60,
    poc: true,
    valueArea: true,
    opacity: 0.32
  };

  const settings = {
    ...DEFAULTS
  };

  const COLORS = {
    green: "#00f5a0",
    red: "#ff476c",
    poc: "#ffe15a",
    vah: "#bb52ff",
    val: "#36c5ff"
  };

  const TF = {
    "1m": 60,
    "3m": 180,
    "5m": 300,
    "15m": 900,
    "30m": 1800,
    "1h": 3600,
    "2h": 7200,
    "4h": 14400,
    "6h": 21600,
    "8h": 28800,
    "12h": 43200,
    "1d": 86400,
    "3d": 259200,
    "1w": 604800,
    "1M": 2592000
  };

  const GOLD =
    "NCCOGOLD2USD-USDT";

  const OIL =
    "NCCO1OILWTI2USD-USDT";

  let chart = null;
  let candle = null;

  let data = [];
  let dataMarketKey = "";

  let canvas = null;
  let controls = null;

  let raf = 0;
  let initialized = false;

  let subscribedChart = null;
  let resizeObserver = null;
  let observedArea = null;

  let recoveryTimer = null;
  let recoveryAttempts = 0;

  let lastProfile = null;
  let lastVisibleCount = 0;

  function clamp(value, min, max) {
    return Math.max(
      min,
      Math.min(max, value)
    );
  }

  function readJSON(key) {
    try {
      const raw =
        localStorage.getItem(key);

      if (raw === null) {
        return null;
      }

      return JSON.parse(raw);

    } catch (error) {
      console.warn(
        "Volume Profile: lectura",
        key,
        error
      );

      return null;
    }
  }

  function loadSettings() {
    let saved = null;

    for (
      const key of [
        KEY,
        ...OLD_KEYS
      ]
    ) {
      const value = readJSON(key);

      if (
        value &&
        typeof value === "object" &&
        !Array.isArray(value)
      ) {
        saved = value;
        break;
      }
    }

    if (saved) {
      Object.assign(
        settings,
        saved
      );
    }

    settings.enabled =
      Boolean(settings.enabled);

    settings.side =
      settings.side === "left"
        ? "left"
        : "right";

    settings.width = clamp(
      Number(settings.width) || 90,
      60,
      180
    );

    settings.bins = clamp(
      Math.round(
        Number(settings.bins) || 60
      ),
      30,
      150
    );

    settings.poc =
      Boolean(settings.poc);

    settings.valueArea =
      Boolean(settings.valueArea);

    settings.opacity = clamp(
      Number(settings.opacity) || 0.32,
      0.1,
      0.85
    );
  }

  function saveSettings() {
    try {
      localStorage.setItem(
        KEY,
        JSON.stringify(settings)
      );
    } catch (error) {
      console.warn(
        "Volume Profile: guardado",
        error
      );
    }

    window.dispatchEvent(
      new CustomEvent(
        "cryptolexuz:volume-profile-update",
        {
          detail: {
            settings: {
              ...settings
            }
          }
        }
      )
    );
  }

  loadSettings();

  function selection() {
    const symbol =
      $("symbol")?.value ||
      "BTC-USDT";

    const commodity =
      [GOLD, OIL].includes(symbol);

    return {
      symbol,

      interval:
        $("interval")?.value ||
        "15m",

      exchange: commodity
        ? "bingx"
        : String(
            $("exchange")?.value ||
            "bingx"
          ).toLowerCase(),

      market: commodity
        ? "perpetual"
        : String(
            $("market")?.value ||
            "perpetual"
          ).toLowerCase()
    };
  }

  function selectionKey(s) {
    return [
      s.exchange,
      s.market,
      s.symbol,
      s.interval
    ].join("|");
  }

  function normalizeSelection(s) {
    if (!s) {
      return selection();
    }

    const symbol =
      String(
        s.symbol ||
        selection().symbol
      );

    const commodity =
      [GOLD, OIL].includes(symbol);

    return {
      symbol,

      interval:
        s.interval ||
        s.tf ||
        selection().interval,

      exchange: commodity
        ? "bingx"
        : String(
            s.exchange ||
            selection().exchange
          ).toLowerCase(),

      market: commodity
        ? "perpetual"
        : String(
            s.market ||
            selection().market
          ).toLowerCase()
    };
  }

  function normalizeTime(value) {
    if (
      value &&
      typeof value === "object" &&
      Number.isFinite(value.year) &&
      Number.isFinite(value.month) &&
      Number.isFinite(value.day)
    ) {
      return Date.UTC(
        value.year,
        value.month - 1,
        value.day
      ) / 1000;
    }

    let time =
      typeof value === "string" &&
      !/^\d+$/.test(value)
        ? Date.parse(value)
        : Number(value);

    if (!Number.isFinite(time)) {
      return NaN;
    }

    if (time > 1e12) {
      time = Math.floor(
        time / 1000
      );
    }

    return time;
  }

  function normalize(items) {
    if (!Array.isArray(items)) {
      return [];
    }

    const result = [];

    for (const item of items) {
      if (
        !item ||
        typeof item !== "object"
      ) {
        continue;
      }

      const array =
        Array.isArray(item);

      const time = normalizeTime(
        array
          ? item[0]
          : item.time ??
            item.timestamp ??
            item.openTime ??
            item.t
      );

      const open = Number(
        array
          ? item[1]
          : item.open ?? item.o
      );

      const high = Number(
        array
          ? item[2]
          : item.high ?? item.h
      );

      const low = Number(
        array
          ? item[3]
          : item.low ?? item.l
      );

      const close = Number(
        array
          ? item[4]
          : item.close ?? item.c
      );

      const volumeRaw = array
        ? item[5]
        : item.volume ??
          item.vol ??
          item.v ??
          0;

      const volume = Number(
        volumeRaw
      );

      if (
        ![
          time,
          open,
          high,
          low,
          close,
          volume
        ].every(Number.isFinite)
      ) {
        continue;
      }

      if (
        time <= 0 ||
        low <= 0 ||
        high < Math.max(
          open,
          close,
          low
        ) ||
        low > Math.min(
          open,
          close,
          high
        ) ||
        volume < 0
      ) {
        continue;
      }

      result.push({
        time,
        open,
        high,
        low,
        close,
        volume
      });
    }

    result.sort(
      (a, b) =>
        a.time - b.time
    );

    return [
      ...new Map(
        result.map(
          c => [c.time, c]
        )
      ).values()
    ].slice(-3000);
  }

  function closedData(items, interval) {
    const seconds =
      TF[interval];

    if (!seconds) {
      return items;
    }

    const current =
      Date.now() / 1000;

    return items.filter(
      c =>
        c.time + seconds <=
        current - 2
    );
  }

  function status(message) {
    const target =
      $("clVpStatus");

    if (
      target &&
      target.textContent !== message
    ) {
      target.textContent =
        message;
    }
  }

  function createOption(
    value,
    label
  ) {
    const option =
      document.createElement("option");

    option.value =
      String(value);

    option.textContent =
      label;

    return option;
  }

  function ensureOption(
    select,
    value
  ) {
    if (!select) {
      return;
    }

    const exists = [
      ...select.options
    ].some(
      option =>
        Number(option.value) ===
        Number(value)
    );

    if (!exists) {
      select.add(
        createOption(
          value,
          String(value)
        )
      );
    }
  }

  function addStyles() {
    if ($("clVpStylesV6")) {
      return;
    }

    const style =
      document.createElement("style");

    style.id =
      "clVpStylesV6";

    style.textContent = `
      #clVpCanvas {
        position:absolute !important;
        inset:0 !important;
        width:100% !important;
        height:100% !important;
        pointer-events:none !important;
        z-index:3;
        background:transparent !important;
      }

      #clVpControls {
        width:100%;
        box-sizing:border-box;
        margin:10px 0 14px;
        border:1px solid #35476a;
        border-radius:12px;
        background:#111a30;
        color:#e8edff;
        overflow:hidden;
        font:12px system-ui,sans-serif;
      }

      #clVpControls summary {
        cursor:pointer;
        padding:13px;
        font-size:13px;
        font-weight:700;
        color:#e4b9ff;
        user-select:none;
      }

      #clVpControls .cl-vp-content {
        display:grid;
        grid-template-columns:
          repeat(
            2,
            minmax(0,1fr)
          );
        gap:12px;
        padding:12px;
        border-top:1px solid #293a58;
      }

      #clVpControls label {
        display:flex;
        flex-direction:column;
        gap:6px;
        min-width:0;
        color:#cbd6ee;
      }

      #clVpControls label.cl-vp-check {
        flex-direction:row;
        align-items:center;
        min-height:38px;
      }

      #clVpControls select {
        width:100%;
        min-height:38px;
        padding:8px;
        border:1px solid #53618b;
        border-radius:8px;
        background:#1b2743;
        color:white;
      }

      #clVpControls input[type="checkbox"],
      #clVpControls input[type="range"] {
        accent-color:#bb52ff;
      }

      #clVpControls input[type="range"] {
        width:100%;
      }

      #clVpControls .cl-vp-full {
        grid-column:1/-1;
      }

      #clVpStatus {
        color:#aebcdd;
        line-height:1.6;
        overflow-wrap:anywhere;
      }

      .cl-vp-warning {
        color:#91a0bf;
        line-height:1.6;
      }

      @media(max-width:350px) {
        #clVpControls .cl-vp-content {
          grid-template-columns:1fr;
        }
      }
    `;

    document.head.append(style);
  }

  function makeLabel(
    title,
    input,
    className = ""
  ) {
    const label =
      document.createElement("label");

    if (className) {
      label.className =
        className;
    }

    if (
      input.type === "checkbox"
    ) {
      label.append(
        input,
        document.createTextNode(
          title
        )
      );
    } else {
      const text =
        document.createElement("span");

      text.textContent =
        title;

      label.append(
        text,
        input
      );
    }

    return label;
  }

  function makeInput(
    id,
    type
  ) {
    const input =
      document.createElement("input");

    input.id = id;
    input.type = type;

    return input;
  }

  function makeSelect(id, options) {
    const select =
      document.createElement("select");

    select.id = id;

    for (
      const [value, label] of options
    ) {
      select.append(
        createOption(
          value,
          label
        )
      );
    }

    return select;
  }

  function buildControls() {
    if (controls) {
      return;
    }

    controls =
      document.createElement("details");

    controls.id =
      "clVpControls";

    controls.className =
      "cl-tool-panel";

    const summary =
      document.createElement("summary");

    summary.textContent =
      "📊 Volume Profile · Configuración";

    const content =
      document.createElement("div");

    content.className =
      "cl-vp-content";

    const enabled =
      makeInput(
        "clVpEnabled",
        "checkbox"
      );

    enabled.checked =
      settings.enabled;

    const side =
      makeSelect(
        "clVpSide",
        [
          ["right", "Derecha"],
          ["left", "Izquierda"]
        ]
      );

    side.value =
      settings.side;

    const width =
      makeSelect(
        "clVpWidth",
        [
          [70, "Estrecho"],
          [90, "Compacto"],
          [110, "Normal"],
          [145, "Ancho"],
          [180, "Muy ancho"]
        ]
      );

    ensureOption(
      width,
      settings.width
    );

    width.value =
      String(settings.width);

    const bins =
      makeSelect(
        "clVpBins",
        [
          [40, "40 niveles"],
          [60, "60 niveles"],
          [90, "90 niveles"],
          [120, "120 niveles"]
        ]
      );

    ensureOption(
      bins,
      settings.bins
    );

    bins.value =
      String(settings.bins);

    const poc =
      makeInput(
        "clVpPoc",
        "checkbox"
      );

    poc.checked =
      settings.poc;

    const valueArea =
      makeInput(
        "clVpValueArea",
        "checkbox"
      );

    valueArea.checked =
      settings.valueArea;

    const opacity =
      makeInput(
        "clVpOpacity",
        "range"
      );

    opacity.min = "10";
    opacity.max = "85";
    opacity.step = "5";

    opacity.value =
      String(
        Math.round(
          settings.opacity * 100
        )
      );

    const statusElement =
      document.createElement("small");

    statusElement.id =
      "clVpStatus";

    statusElement.className =
      "cl-vp-full";

    statusElement.textContent =
      "Esperando velas...";

    const warning =
      document.createElement("small");

    warning.className =
      "cl-vp-full cl-vp-warning";

    warning.textContent =
      "Perfil estimado con velas OHLCV. " +
      "Las proporciones verde y roja " +
      "no representan compras, ventas " +
      "ni delta reales por nivel de precio.";

    content.append(
      makeLabel(
        "Mostrar perfil",
        enabled,
        "cl-vp-check"
      ),

      makeLabel(
        "Posición",
        side
      ),

      makeLabel(
        "Anchura",
        width
      ),

      makeLabel(
        "Detalle",
        bins
      ),

      makeLabel(
        "Línea POC",
        poc,
        "cl-vp-check"
      ),

      makeLabel(
        "Líneas VAH / VAL",
        valueArea,
        "cl-vp-check"
      ),

      makeLabel(
        "Opacidad del perfil",
        opacity,
        "cl-vp-full"
      ),

      statusElement,
      warning
    );

    controls.append(
      summary,
      content
    );

    const bindings = [
      [
        enabled,
        "enabled",
        input => input.checked
      ],
      [
        side,
        "side",
        input => input.value
      ],
      [
        width,
        "width",
        input => Number(input.value)
      ],
      [
        bins,
        "bins",
        input => Number(input.value)
      ],
      [
        poc,
        "poc",
        input => input.checked
      ],
      [
        valueArea,
        "valueArea",
        input => input.checked
      ],
      [
        opacity,
        "opacity",
        input =>
          Number(input.value) / 100
      ]
    ];

    for (
      const [
        input,
        key,
        transform
      ] of bindings
    ) {
      input.addEventListener(
        key === "opacity"
          ? "input"
          : "change",
        () => {
          settings[key] =
            transform(input);

          saveSettings();
          schedule();
        }
      );
    }
  }

  function ensureUI() {
    const area =
      $("priceChartArea") ||
      $("chart")?.parentElement;

    if (
      !area ||
      !area.parentElement
    ) {
      return false;
    }

    addStyles();
    buildControls();

    if (
      getComputedStyle(area)
        .position === "static"
    ) {
      area.style.position =
        "relative";
    }

    if (
      !canvas
    ) {
      canvas =
        document.createElement("canvas");

      canvas.id =
        "clVpCanvas";
    }

    if (
      canvas.parentElement !== area
    ) {
      area.append(canvas);
    }

    /*
     Los controles se colocan
     después del contenedor
     de la gráfica de precios.
    */

    if (
      controls.previousElementSibling !==
      area
    ) {
      area.insertAdjacentElement(
        "afterend",
        controls
      );
    }

    if (
      window.ResizeObserver &&
      observedArea !== area
    ) {
      resizeObserver?.disconnect();

      resizeObserver =
        new ResizeObserver(
          schedule
        );

      resizeObserver.observe(area);

      observedArea = area;
    }

    return true;
  }

  function clearCanvas() {
    if (!canvas) {
      return;
    }

    const ctx =
      canvas.getContext("2d");

    if (!ctx) {
      return;
    }

    ctx.clearRect(
      0,
      0,
      canvas.width,
      canvas.height
    );
  }

  function resetMarket() {
    data = [];
    dataMarketKey = "";

    lastProfile = null;
    lastVisibleCount = 0;

    clearCanvas();

    status(
      "Esperando velas del mercado seleccionado..."
    );

    schedule();
  }

  function acceptData(
    items,
    source = null
  ) {
    if (!Array.isArray(items)) {
      return false;
    }

    const current =
      selection();

    const currentKey =
      selectionKey(current);

    const incoming =
      source
        ? normalizeSelection(source)
        : current;

    const incomingKey =
      selectionKey(incoming);

    if (
      incomingKey !== currentKey
    ) {
      return false;
    }

    const normalized =
      normalize(items);

    data = normalized;
    dataMarketKey = currentKey;

    lastProfile = null;

    schedule();

    return true;
  }

  function setData(
    items,
    source = null
  ) {
    return acceptData(
      items,
      source
    );
  }

  function attach(
    nextChart,
    nextCandle
  ) {
    if (
      !nextChart ||
      !nextCandle
    ) {
      return false;
    }

    if (
      subscribedChart &&
      subscribedChart !== nextChart
    ) {
      try {
        subscribedChart.timeScale()
          .unsubscribeVisibleLogicalRangeChange(
            schedule
          );
      } catch {}
    }

    chart = nextChart;
    candle = nextCandle;

    ensureUI();

    if (
      subscribedChart !== nextChart
    ) {
      subscribedChart = nextChart;

      try {
        nextChart.timeScale()
          .subscribeVisibleLogicalRangeChange(
            schedule
          );
      } catch (error) {
        console.warn(
          "Volume Profile: rango visible",
          error
        );
      }
    }

    schedule();

    return true;
  }

  function recoverChart() {
    const shared =
      window.CryptolexuzChart;

    if (
      !shared?.chart
    ) {
      return false;
    }

    attach(
      shared.chart,
      shared.candle ||
      shared.candleSeries
    );

    if (
      typeof shared.getRows ===
      "function"
    ) {
      try {
        const rows =
          shared.getRows();

        if (
          Array.isArray(rows)
        ) {
          acceptData(rows);
        }
      } catch (error) {
        console.warn(
          "Volume Profile: recuperación",
          error
        );
      }
    }

    return true;
  }

  function scheduleRecovery() {
    clearTimeout(
      recoveryTimer
    );

    recoveryAttempts = 0;

    const attempt = () => {
      recoverChart();

      recoveryAttempts++;

      if (
        (
          !chart ||
          !candle ||
          !data.length
        ) &&
        recoveryAttempts < 12
      ) {
        recoveryTimer =
          setTimeout(
            attempt,
            500
          );
      }
    };

    recoveryTimer =
      setTimeout(
        attempt,
        150
      );
  }

  function schedule() {
    if (raf) {
      return;
    }

    raf =
      requestAnimationFrame(
        () => {
          raf = 0;
          draw();
        }
      );
  }

  function visibleRows() {
    if (
      dataMarketKey !==
      selectionKey(selection())
    ) {
      return [];
    }

    const rows =
      closedData(
        data,
        selection().interval
      );

    if (!rows.length) {
      return [];
    }

    if (!chart) {
      return rows;
    }

    try {
      const scale =
        chart.timeScale();

      const range =
        scale.getVisibleRange();

      if (
        !range ||
        range.from == null ||
        range.to == null
      ) {
        return rows;
      }

      const from =
        normalizeTime(range.from);

      const to =
        normalizeTime(range.to);

      if (
        !Number.isFinite(from) ||
        !Number.isFinite(to)
      ) {
        return rows;
      }

      return rows.filter(
        c =>
          c.time >= from &&
          c.time <= to
      );

    } catch (error) {
      console.warn(
        "Volume Profile: velas visibles",
        error
      );

      return rows;
    }
  }

  /*
   PERFIL ESTIMADO OHLCV.

   El volumen de cada vela se
   distribuye proporcionalmente
   entre los niveles de precio
   que atraviesa su rango.

   No son operaciones reales
   registradas por precio.
  */

  function calculateProfile(rows) {
    if (
      !Array.isArray(rows) ||
      rows.length < 2
    ) {
      return null;
    }

    let lo = Infinity;
    let hi = -Infinity;

    for (const row of rows) {
      lo = Math.min(
        lo,
        row.low
      );

      hi = Math.max(
        hi,
        row.high
      );
    }

    if (
      !Number.isFinite(lo) ||
      !Number.isFinite(hi) ||
      hi <= lo
    ) {
      return null;
    }

    const count =
      settings.bins;

    const step =
      (hi - lo) / count;

    if (
      !Number.isFinite(step) ||
      step <= 0
    ) {
      return null;
    }

    const buy =
      new Float64Array(count);

    const sell =
      new Float64Array(count);

    const totals =
      new Float64Array(count);

    for (const row of rows) {
      if (
        row.volume <= 0
      ) {
        continue;
      }

      const span =
        row.high - row.low;

      const start =
        clamp(
          Math.floor(
            (row.low - lo) / step
          ),
          0,
          count - 1
        );

      const end =
        clamp(
          Math.floor(
            (row.high - lo) / step
          ),
          0,
          count - 1
        );

      /*
       La proporción verde/roja
       depende de la posición
       del cierre dentro del rango.
       Es una aproximación visual.
      */

      const buyRatio =
        span > 0
          ? clamp(
              0.5 +
              (
                row.close -
                row.open
              ) /
              (2 * span),
              0.1,
              0.9
            )
          : 0.5;

      let totalWeight = 0;

      const weights = [];

      for (
        let i = start;
        i <= end;
        i++
      ) {
        const binLow =
          lo + i * step;

        const binHigh =
          binLow + step;

        const overlap =
          span > 0
            ? Math.max(
                0,
                Math.min(
                  row.high,
                  binHigh
                ) -
                Math.max(
                  row.low,
                  binLow
                )
              )
            : (
                i === start
                  ? 1
                  : 0
              );

        weights.push(overlap);

        totalWeight += overlap;
      }

      if (
        totalWeight <= 0
      ) {
        continue;
      }

      for (
        let i = start;
        i <= end;
        i++
      ) {
        const weight =
          weights[i - start] /
          totalWeight;

        const portion =
          row.volume * weight;

        buy[i] +=
          portion * buyRatio;

        sell[i] +=
          portion * (
            1 - buyRatio
          );

        totals[i] +=
          portion;
      }
    }

    let totalVolume = 0;
    let maxVolume = 0;
    let pocIndex = 0;

    for (
      let i = 0;
      i < count;
      i++
    ) {
      totalVolume +=
        totals[i];

      if (
        totals[i] > maxVolume
      ) {
        maxVolume =
          totals[i];

        pocIndex = i;
      }
    }

    if (
      totalVolume <= 0 ||
      maxVolume <= 0
    ) {
      return null;
    }

    /*
     Área de valor aproximada
     al 70% del volumen estimado.

     Expansión desde POC hacia
     niveles adyacentes.
    */

    const target =
      totalVolume * 0.70;

    let lower = pocIndex;
    let upper = pocIndex;

    let accumulated =
      totals[pocIndex];

    while (
      accumulated < target &&
      (
        lower > 0 ||
        upper < count - 1
      )
    ) {
      const below =
        lower > 0
          ? totals[lower - 1]
          : -1;

      const above =
        upper < count - 1
          ? totals[upper + 1]
          : -1;

      if (
        above >= below &&
        upper < count - 1
      ) {
        upper++;

        accumulated +=
          totals[upper];

      } else if (
        lower > 0
      ) {
        lower--;

        accumulated +=
          totals[lower];

      } else {
        break;
      }
    }

    return {
      lo,
      hi,
      step,
      buy,
      sell,
      totals,

      pocIndex,
      lower,
      upper,

      poc:
        lo +
        (
          pocIndex + 0.5
        ) * step,

      vah:
        lo +
        (upper + 1) * step,

      val:
        lo +
        lower * step,

      max: maxVolume,
      totalVolume,
      count
    };
  }

  function prepareCanvas() {
    if (
      !ensureUI() ||
      !canvas
    ) {
      return null;
    }

    const area =
      canvas.parentElement;

    if (!area) {
      return null;
    }

    const width =
      area.clientWidth;

    const height =
      area.clientHeight;

    if (
      width < 30 ||
      height < 30
    ) {
      return null;
    }

    const dpr =
      Math.min(
        window.devicePixelRatio || 1,
        2
      );

    const pixelWidth =
      Math.round(
        width * dpr
      );

    const pixelHeight =
      Math.round(
        height * dpr
      );

    if (
      canvas.width !== pixelWidth
    ) {
      canvas.width =
        pixelWidth;
    }

    if (
      canvas.height !== pixelHeight
    ) {
      canvas.height =
        pixelHeight;
    }

    const ctx =
      canvas.getContext("2d");

    if (!ctx) {
      return null;
    }

    ctx.setTransform(
      dpr,
      0,
      0,
      dpr,
      0,
      0
    );

    ctx.clearRect(
      0,
      0,
      width,
      height
    );

    return {
      ctx,
      width,
      height,
      area
    };
  }

  function coordinateOffset(area) {
    const chartElement =
      $("chart");

    if (!chartElement) {
      return 0;
    }

    return (
      chartElement
        .getBoundingClientRect()
        .top -
      area
        .getBoundingClientRect()
        .top
    );
  }

  function drawLine(
    ctx,
    y,
    label,
    color,
    width,
    height
  ) {
    if (
      !Number.isFinite(y) ||
      y < 0 ||
      y > height
    ) {
      return;
    }

    ctx.save();

    ctx.strokeStyle =
      color;

    ctx.lineWidth =
      label === "POC"
        ? 1.8
        : 1;

    ctx.setLineDash(
      label === "POC"
        ? []
        : [5, 4]
    );

    ctx.beginPath();

    ctx.moveTo(
      0,
      y
    );

    ctx.lineTo(
      width,
      y
    );

    ctx.stroke();

    ctx.setLineDash([]);

    ctx.fillStyle =
      color;

    ctx.font =
      "bold 10px system-ui";

    const right =
      settings.side === "right";

    ctx.textAlign =
      right
        ? "left"
        : "right";

    const x =
      right
        ? 6
        : width - 6;

    ctx.fillText(
      label,
      x,
      clamp(
        y - 5,
        12,
        height - 3
      )
    );

    ctx.restore();
  }

  function draw() {
    const surface =
      prepareCanvas();

    if (!surface) {
      return;
    }

    const {
      ctx,
      width,
      height,
      area
    } = surface;

    if (!settings.enabled) {
      lastProfile = null;
      lastVisibleCount = 0;

      status(
        "Volume Profile oculto"
      );

      return;
    }

    if (
      !chart ||
      !candle
    ) {
      status(
        "Esperando conexión con la gráfica..."
      );

      return;
    }

    if (
      dataMarketKey !==
      selectionKey(selection())
    ) {
      status(
        "Esperando velas del mercado actual..."
      );

      return;
    }

    const visible =
      visibleRows();

    lastVisibleCount =
      visible.length;

    if (
      visible.length < 2
    ) {
      lastProfile = null;

      status(
        "Se necesitan al menos dos velas cerradas visibles"
      );

      return;
    }

    const profile =
      calculateProfile(
        visible
      );

    lastProfile =
      profile;

    if (!profile) {
      status(
        "Volumen insuficiente para calcular el perfil"
      );

      return;
    }

    let priceScaleWidth = 0;

    try {
      priceScaleWidth =
        chart.priceScale("right")
          .width() || 0;
    } catch {}

    const plotWidth =
      Math.max(
        0,
        width -
        priceScaleWidth
      );

    if (
      plotWidth < 30
    ) {
      status(
        "Espacio insuficiente para dibujar el perfil"
      );

      return;
    }

    const barWidth =
      Math.min(
        settings.width,
        Math.max(
          25,
          plotWidth * 0.32
        )
      );

    const maxLength =
      Math.max(
        10,
        barWidth - 8
      );

    const right =
      settings.side === "right";

    const edge =
      right
        ? plotWidth - 3
        : 3;

    const offsetY =
      coordinateOffset(area);

    for (
      let i = 0;
      i < profile.count;
      i++
    ) {
      if (
        profile.totals[i] <= 0
      ) {
        continue;
      }

      const p0 =
        profile.lo +
        i * profile.step;

      const p1 =
        p0 +
        profile.step;

      let c0;
      let c1;

      try {
        c0 =
          candle.priceToCoordinate(
            p0
          );

        c1 =
          candle.priceToCoordinate(
            p1
          );
      } catch {
        continue;
      }

      if (
        !Number.isFinite(c0) ||
        !Number.isFinite(c1)
      ) {
        continue;
      }

      const y =
        Math.min(
          c0,
          c1
        ) + offsetY;

      const h =
        Math.max(
          1,
          Math.abs(
            c1 - c0
          ) - 0.5
        );

      if (
        y > height ||
        y + h < 0
      ) {
        continue;
      }

      const ratio =
        profile.totals[i] /
        profile.max;

      const length =
        Math.max(
          1,
          ratio * maxLength
        );

      const x =
        right
          ? edge - length
          : edge;

      const buyRatio =
        profile.buy[i] /
        profile.totals[i];

      const greenWidth =
        length * buyRatio;

      const redWidth =
        length - greenWidth;

      const insideValueArea =
        i >= profile.lower &&
        i <= profile.upper;

      ctx.save();

      ctx.globalAlpha =
        insideValueArea
          ? settings.opacity
          : settings.opacity *
            0.55;

      if (right) {
        ctx.fillStyle =
          COLORS.green;

        ctx.fillRect(
          x,
          y,
          greenWidth,
          h
        );

        ctx.fillStyle =
          COLORS.red;

        ctx.fillRect(
          x + greenWidth,
          y,
          redWidth,
          h
        );

      } else {
        ctx.fillStyle =
          COLORS.red;

        ctx.fillRect(
          x,
          y,
          redWidth,
          h
        );

        ctx.fillStyle =
          COLORS.green;

        ctx.fillRect(
          x + redWidth,
          y,
          greenWidth,
          h
        );
      }

      ctx.restore();

      if (
        settings.poc &&
        i === profile.pocIndex
      ) {
        ctx.save();

        ctx.strokeStyle =
          COLORS.poc;

        ctx.lineWidth =
          1.5;

        ctx.strokeRect(
          x,
          y,
          length,
          h
        );

        ctx.restore();
      }
    }

    const priceY = price => {
      try {
        const coordinate =
          candle.priceToCoordinate(
            price
          );

        return Number.isFinite(
          coordinate
        )
          ? coordinate + offsetY
          : null;

      } catch {
        return null;
      }
    };

    if (settings.valueArea) {
      drawLine(
        ctx,
        priceY(profile.vah),
        "VAH",
        COLORS.vah,
        plotWidth,
        height
      );

      drawLine(
        ctx,
        priceY(profile.val),
        "VAL",
        COLORS.val,
        plotWidth,
        height
      );
    }

    if (settings.poc) {
      drawLine(
        ctx,
        priceY(profile.poc),
        "POC",
        COLORS.poc,
        plotWidth,
        height
      );
    }

    const fmt = value =>
      Number(value).toLocaleString(
        "es-MX",
        {
          maximumFractionDigits: 6
        }
      );

    status(
      visible.length +
      " velas cerradas · " +
      "POC " +
      fmt(profile.poc) +
      " · VAH " +
      fmt(profile.vah) +
      " · VAL " +
      fmt(profile.val) +
      " · Estimado OHLCV"
    );
  }

  function getProfile() {
    if (!lastProfile) {
      return null;
    }

    return {
      poc:
        lastProfile.poc,

      vah:
        lastProfile.vah,

      val:
        lastProfile.val,

      totalVolume:
        lastProfile.totalVolume,

      visibleCandles:
        lastVisibleCount,

      estimated: true,

      method:
        "OHLCV range allocation"
    };
  }

  function onChartReady(event) {
    const detail =
      event.detail || {};

    attach(
      detail.chart,
      detail.candle ||
      detail.candleSeries
    );

    const rows =
      detail.rows ||
      detail.candles;

    if (
      Array.isArray(rows)
    ) {
      const source =
        detail.selection ||
        (
          detail.symbol &&
          (
            detail.interval ||
            detail.tf
          )
            ? detail
            : null
        );

      acceptData(
        rows,
        source
      );
    }
  }

  function onCandlesUpdated(event) {
    const detail =
      event.detail || {};

    if (
      detail.chart &&
      (
        detail.candle ||
        detail.candleSeries
      )
    ) {
      attach(
        detail.chart,
        detail.candle ||
        detail.candleSeries
      );
    }

    const rows =
      detail.rows ||
      detail.candles;

    if (
      Array.isArray(rows)
    ) {
      const source =
        detail.selection ||
        (
          detail.symbol &&
          (
            detail.interval ||
            detail.tf
          )
            ? detail
            : null
        );

      acceptData(
        rows,
        source
      );
    }
  }

  function onSelectionChange() {
    resetMarket();
    scheduleRecovery();
  }

  function init() {
    if (initialized) {
      return;
    }

    initialized = true;

    ensureUI();

    for (
      const id of [
        "symbol",
        "interval",
        "market",
        "exchange"
      ]
    ) {
      $(id)?.addEventListener(
        "change",
        onSelectionChange
      );
    }

    window.addEventListener(
      "resize",
      schedule
    );

    window.addEventListener(
      "cryptolexuz:screen-change",
      () => {
        ensureUI();
        recoverChart();
        schedule();
      }
    );

    document.addEventListener(
      "visibilitychange",
      () => {
        if (!document.hidden) {
          ensureUI();
          recoverChart();
          schedule();
        }
      }
    );

    scheduleRecovery();

    console.info(
      "CRYPTOLEXUZ PRO — " +
      "Volume Profile V6 cargado"
    );
  }

  window.addEventListener(
    "cryptolexuz:chart-ready",
    onChartReady
  );

  window.addEventListener(
    "cryptolexuz:candles-updated",
    onCandlesUpdated
  );

  window.CryptolexuzVolumeProfile = {
    version: "6",

    attach,

    setData,

    redraw: schedule,

    layout: schedule,

    refresh: () => {
      recoverChart();
      schedule();
    },

    getData: () =>
      data.map(
        c => ({ ...c })
      ),

    getSettings: () =>
      ({ ...settings }),

    getProfile,

    getStatus: () => ({
      attached:
        Boolean(
          chart &&
          candle
        ),

      enabled:
        settings.enabled,

      marketKey:
        dataMarketKey,

      candles:
        data.length,

      visibleCandles:
        lastVisibleCount,

      profileAvailable:
        Boolean(lastProfile)
    })
  };

  if (
    document.readyState ===
    "loading"
  ) {
    document.addEventListener(
      "DOMContentLoaded",
      init,
      { once: true }
    );

  } else {
    init();
  }

})();
