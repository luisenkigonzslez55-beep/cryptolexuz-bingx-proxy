
/*
 CRYPTOLEXUZ PRO — RANGE BOXES V7 COMPLETO

 Compatible con Lightweight Charts 4.2.2.

 FUNCIONES:
 - Sin caja verde.
 - Cajas moradas editables.
 - Movimiento táctil con un dedo.
 - Ajuste de cuatro bordes.
 - Navegación libre fuera de edición.
 - Persistencia por activo y mercado.
 - Conservación de cajas V6, V5 y V3.
 - Detección opcional de lateralización.
 - Caja de penúltima vela.
 - Línea central configurable.
 - Extensión visual hacia la derecha.
 - Actualización con velas reales.
 - Sin ejecución de órdenes.
*/

"use strict";

(() => {

  if (window.__clRangeBoxesV7) return;
  window.__clRangeBoxesV7 = true;

  const $ = id =>
    document.getElementById(id);

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

  const STORE =
    "cryptolexuz-purple-boxes-v7";

  const OLD_STORES = [
    "cryptolexuz-purple-boxes-v6",
    "cryptolexuz-purple-boxes-v5",
    "cryptolexuz-fixed-boxes-v3"
  ];

  const PREFS =
    "cryptolexuz-purple-prefs-v7";

  const OLD_PREFS = [
    "cryptolexuz-purple-prefs-v6",
    "cryptolexuz-purple-prefs-v5"
  ];

  const PURPLE = "#bb52ff";
  const PURPLE_LIGHT = "#e4b9ff";

  const MAX_BOXES = 300;
  const HANDLE_SIZE = 16;

  const config = {
    fixed: true,
    sideways: true,
    previous: false,
    midpoint: false,
    boundaries: true,
    extendRight: true,
    lookback: 24
  };

  let chart = null;
  let candle = null;
  let rows = [];

  let rowsKey = "";
  let currentKey = "";

  let boxes = [];
  let selectedId = null;

  let initialized = false;
  let editing = false;
  let drag = null;

  let frame = 0;
  let resizeObserver = null;
  let subscribedChart = null;
  let observedHost = null;

  let recoveryTimer = null;
  let recoveryAttempts = 0;

  const now = () =>
    Math.floor(Date.now() / 1000);

  function readJSON(key, fallback = null) {
    try {
      const raw =
        localStorage.getItem(key);

      return raw === null
        ? fallback
        : JSON.parse(raw);

    } catch (error) {
      console.warn(
        "Range Boxes: lectura",
        key,
        error
      );

      return fallback;
    }
  }

  function readMigrated(
    current,
    previous,
    fallback
  ) {
    const direct =
      readJSON(current, null);

    if (direct !== null) {
      return direct;
    }

    for (const key of previous) {
      const value =
        readJSON(key, null);

      if (value !== null) {
        return value;
      }
    }

    return fallback;
  }

  function saveJSON(key, value) {
    try {
      localStorage.setItem(
        key,
        JSON.stringify(value)
      );

      return true;

    } catch (error) {
      console.warn(
        "Range Boxes: guardado",
        error
      );

      return false;
    }
  }

  function normalizeSelection(s) {
    const symbol =
      String(
        s?.symbol ||
        "BTC-USDT"
      );

    const commodity =
      [GOLD, OIL].includes(symbol);

    return {
      symbol,

      tf:
        TF[s?.tf]
          ? s.tf
          : "15m",

      exchange: commodity
        ? "bingx"
        : String(
            s?.exchange ||
            "bingx"
          ).toLowerCase(),

      market: commodity
        ? "perpetual"
        : String(
            s?.market ||
            "perpetual"
          ).toLowerCase()
    };
  }

  function selection() {
    return normalizeSelection({
      symbol:
        $("symbol")?.value,

      tf:
        $("interval")?.value,

      exchange:
        $("exchange")?.value,

      market:
        $("market")?.value
    });
  }

  function marketKey(s) {
    return [
      s.exchange,
      s.market,
      s.symbol
    ].join("|");
  }

  function dataKey(s) {
    return (
      marketKey(s) +
      "|" +
      s.tf
    );
  }

  function validBox(b) {
    if (
      !b ||
      typeof b.id !== "string" ||
      typeof b.marketKey !== "string"
    ) {
      return false;
    }

    const values = [
      b.start,
      b.end,
      b.high,
      b.low
    ].map(Number);

    return (
      values.every(Number.isFinite) &&
      values[0] > 0 &&
      values[1] > values[0] &&
      values[3] > 0 &&
      values[2] > values[3]
    );
  }

  function normalizeBox(b) {
    return {
      ...b,
      start: Number(b.start),
      end: Number(b.end),
      high: Number(b.high),
      low: Number(b.low),
      name: "Caja morada"
    };
  }

  function loadBoxes() {
    const stored = readMigrated(
      STORE,
      OLD_STORES,
      []
    );

    const source =
      Array.isArray(stored)
        ? stored
        : [];

    const unique = new Map();

    for (const b of source) {
      if (!validBox(b)) {
        continue;
      }

      unique.set(
        b.id,
        normalizeBox(b)
      );
    }

    boxes = [
      ...unique.values()
    ].slice(-MAX_BOXES);

    saveBoxes();
  }

  function saveBoxes() {
    return saveJSON(
      STORE,
      boxes
    );
  }

  function loadPrefs() {
    const saved = readMigrated(
      PREFS,
      OLD_PREFS,
      {}
    );

    if (
      !saved ||
      typeof saved !== "object"
    ) {
      return;
    }

    for (
      const key of Object.keys(config)
    ) {
      if (key === "lookback") {
        const value =
          Number(saved[key]);

        if (
          [12, 24, 36, 48, 72]
            .includes(value)
        ) {
          config.lookback = value;
        }

      } else if (
        typeof saved[key] ===
        "boolean"
      ) {
        config[key] = saved[key];
      }
    }
  }

  function savePrefs() {
    saveJSON(PREFS, config);
  }

  loadBoxes();
  loadPrefs();

  function element(
    tag,
    className = "",
    value
  ) {
    const e =
      document.createElement(tag);

    if (className) {
      e.className = className;
    }

    if (value !== undefined) {
      e.textContent = String(value);
    }

    return e;
  }

  const canvas =
    document.createElement("canvas");

  canvas.id = "clRangeOverlay";

  const touchLayer =
    document.createElement("div");

  touchLayer.id =
    "clRangeTouchLayer";

  touchLayer.className =
    "cl-box-touch-layer";

  touchLayer.hidden = true;

  touchLayer.setAttribute(
    "aria-label",
    "Edición de cajas moradas"
  );

  const panel =
    element("section", "cl-module");

  panel.id = "clRangeControls";

  const heading =
    element("div", "clrb-heading");

  heading.append(
    element(
      "strong",
      "",
      "🟪 Cajas moradas"
    ),
    element(
      "span",
      "clrb-version",
      "V7"
    )
  );

  const grid =
    element("div", "clrb-grid");

  const toggleInputs = {};

  function addToggle(label, key) {
    const wrapper =
      element("label", "clrb-toggle");

    const input =
      document.createElement("input");

    input.type = "checkbox";
    input.checked = config[key];
    input.style.accentColor = PURPLE;

    input.addEventListener(
      "change",
      () => {
        config[key] = input.checked;

        savePrefs();
        redraw();
      }
    );

    wrapper.append(
      input,
      document.createTextNode(label)
    );

    grid.append(wrapper);

    toggleInputs[key] = input;

    return input;
  }

  addToggle(
    "Mostrar cajas fijas",
    "fixed"
  );

  addToggle(
    "Lateralización",
    "sideways"
  );

  addToggle(
    "Penúltima vela",
    "previous"
  );

  addToggle(
    "Extender lateral",
    "extendRight"
  );

  addToggle(
    "Línea central",
    "midpoint"
  );

  addToggle(
    "Mostrar bordes",
    "boundaries"
  );

  function button(text) {
    const b = element(
      "button",
      "cl-purple-box-button",
      text
    );

    b.type = "button";

    return b;
  }

  const createButton =
    button("＋ Crear caja");

  const candleButton =
    button("📌 Fijar vela");

  const deleteButton =
    button("🗑 Eliminar");

  const editButton =
    button("✋ Editar: NO");

  editButton.setAttribute(
    "aria-pressed",
    "false"
  );

  const selectBox =
    document.createElement("select");

  selectBox.className =
    "clrb-select";

  selectBox.setAttribute(
    "aria-label",
    "Seleccionar caja morada"
  );

  const lookback =
    document.createElement("select");

  lookback.className =
    "clrb-select";

  lookback.setAttribute(
    "aria-label",
    "Velas del rango"
  );

  for (
    const count of [
      12, 24, 36, 48, 72
    ]
  ) {
    const option =
      element(
        "option",
        "",
        count + " velas"
      );

    option.value =
      String(count);

    option.selected =
      count === config.lookback;

    lookback.append(option);
  }

  const controls =
    element("div", "clrb-controls");

  controls.append(
    createButton,
    candleButton,
    deleteButton,
    selectBox,
    editButton,
    lookback
  );

  const note =
    element(
      "p",
      "clrb-note",
      "Crea una caja morada y activa " +
      "Editar. Arrastra su interior " +
      "para moverla o sus cuatro " +
      "bordes para ajustar el rango. " +
      "Desactiva Editar para navegar " +
      "libremente por la gráfica."
    );

  panel.append(
    heading,
    grid,
    controls,
    note
  );

  function addStyles() {
    if ($("clRangeBoxesCSS")) {
      return;
    }

    const style =
      document.createElement("style");

    style.id = "clRangeBoxesCSS";

    style.textContent = `
      #clRangeOverlay {
        position:absolute !important;
        inset:0 !important;
        display:block;
        width:100% !important;
        height:100% !important;
        pointer-events:none !important;
        z-index:15;
        background:transparent !important;
      }

      #clRangeTouchLayer {
        position:absolute !important;
        inset:0 !important;
        width:100% !important;
        height:100% !important;
        z-index:16;
        background:transparent;
        touch-action:none;
        user-select:none;
        -webkit-user-select:none;
        cursor:crosshair;
      }

      #clRangeTouchLayer[hidden] {
        display:none !important;
      }

      #priceChartArea.cl-box-editing {
        position:relative;
      }

      #priceChartArea.cl-box-dragging {
        cursor:grabbing;
      }

      #clRangeControls {
        display:grid;
        gap:12px;
        margin:12px 0;
        padding:14px;
        border:1px solid #493365;
        border-radius:13px;
        background:#151123;
        color:#f0e5ff;
        font:12px system-ui,sans-serif;
        min-width:0;
      }

      .clrb-heading {
        display:flex;
        justify-content:space-between;
        align-items:center;
        gap:8px;
      }

      .clrb-heading strong {
        font-size:15px;
      }

      .clrb-version {
        color:#b89bd1;
      }

      .clrb-grid {
        display:grid;
        grid-template-columns:
          repeat(2,minmax(0,1fr));
        gap:8px;
      }

      .clrb-toggle {
        display:flex;
        align-items:center;
        gap:7px;
        min-height:40px;
        padding:8px;
        border:1px solid #51366a;
        border-radius:8px;
        background:#251b32;
        cursor:pointer;
        min-width:0;
      }

      .clrb-toggle input {
        flex-shrink:0;
      }

      .clrb-controls {
        display:flex;
        flex-wrap:wrap;
        align-items:center;
        gap:8px;
      }

      .cl-purple-box-button {
        min-height:40px;
        padding:9px 12px;
        border:1px solid #7849a3;
        border-radius:9px;
        background:#302044;
        color:#f4eaff;
        font:600 12px system-ui,sans-serif;
        cursor:pointer;
      }

      .cl-purple-box-button.active {
        background:#7635b4;
        border-color:#e4b9ff;
        color:white;
      }

      .cl-purple-box-button:disabled {
        opacity:.45;
        cursor:not-allowed;
      }

      .clrb-select {
        min-height:40px;
        min-width:0;
        max-width:100%;
        padding:9px;
        border:1px solid #7849a3;
        border-radius:8px;
        background:#251b32;
        color:white;
        font:12px system-ui,sans-serif;
      }

      .clrb-note {
        margin:0;
        color:#c4aed7;
        line-height:1.6;
      }

      @media(max-width:370px) {
        .clrb-grid {
          grid-template-columns:1fr;
        }

        .clrb-controls > * {
          flex:1 1 auto;
        }
      }
    `;

    document.head.append(style);
  }

  function visibleBoxes() {
    const key =
      marketKey(selection());

    return boxes.filter(
      b => b.marketKey === key
    );
  }

  function selectedBox() {
    return visibleBoxes().find(
      b => b.id === selectedId
    ) || null;
  }

  function updateSelector() {
    const list = visibleBoxes();

    if (
      !list.some(
        b => b.id === selectedId
      )
    ) {
      selectedId =
        list.at(-1)?.id || null;
    }

    selectBox.replaceChildren();

    if (!list.length) {
      const option =
        element(
          "option",
          "",
          "Sin cajas"
        );

      option.value = "";

      selectBox.append(option);
    }

    list.forEach(
      (box, index) => {
        const option =
          element(
            "option",
            "",
            "Caja morada " +
            (index + 1)
          );

        option.value = box.id;

        option.selected =
          box.id === selectedId;

        selectBox.append(option);
      }
    );

    const empty =
      list.length === 0;

    deleteButton.disabled = empty;
    editButton.disabled = empty;
    selectBox.disabled = empty;

    if (empty && editing) {
      setEditing(false);
    }
  }

  function saveAndRedraw() {
    saveBoxes();
    updateSelector();
    redraw();
  }

  selectBox.addEventListener(
    "change",
    () => {
      selectedId = selectBox.value;
      redraw();
    }
  );

  lookback.addEventListener(
    "change",
    () => {
      const value =
        Number(lookback.value);

      if (
        [12, 24, 36, 48, 72]
          .includes(value)
      ) {
        config.lookback = value;

        savePrefs();
        redraw();
      }
    }
  );

  function normalizeRows(data) {
    if (!Array.isArray(data)) {
      return [];
    }

    const result = [];

    for (const c of data) {
      if (
        !c ||
        typeof c !== "object"
      ) {
        continue;
      }

      let time =
        c.time ??
        c.timestamp ??
        c.openTime;

      if (
        typeof time === "object" &&
        time !== null &&
        Number.isFinite(time.year) &&
        Number.isFinite(time.month) &&
        Number.isFinite(time.day)
      ) {
        time = Date.UTC(
          time.year,
          time.month - 1,
          time.day
        ) / 1000;
      } else {
        time = Number(time);

        if (time > 1e12) {
          time = Math.floor(
            time / 1000
          );
        }
      }

      const open =
        Number(c.open ?? c.o);

      const high =
        Number(c.high ?? c.h);

      const low =
        Number(c.low ?? c.l);

      const close =
        Number(c.close ?? c.c);

      if (
        ![
          time,
          open,
          high,
          low,
          close
        ].every(Number.isFinite)
      ) {
        continue;
      }

      if (
        time <= 0 ||
        low <= 0 ||
        high < Math.max(
          open,
          close
        ) ||
        low > Math.min(
          open,
          close
        )
      ) {
        continue;
      }

      result.push({
        time,
        open,
        high,
        low,
        close,
        volume:
          Number(
            c.volume ??
            c.vol ??
            0
          ) || 0
      });
    }

    result.sort(
      (a, b) => a.time - b.time
    );

    return [
      ...new Map(
        result.map(
          c => [c.time, c]
        )
      ).values()
    ];
  }

  function closedRows() {
    const s = selection();

    if (
      rowsKey !== dataKey(s)
    ) {
      return [];
    }

    const seconds =
      TF[s.tf] || 60;

    const current = now();

    return rows.filter(
      c =>
        c.time + seconds <=
        current - 2
    );
  }

  function rangeSource() {
    const data =
      closedRows().slice(
        -config.lookback
      );

    if (data.length < 4) {
      return null;
    }

    return {
      start:
        data[0].time,

      end:
        data.at(-1).time,

      high:
        Math.max(
          ...data.map(
            c => c.high
          )
        ),

      low:
        Math.min(
          ...data.map(
            c => c.low
          )
        )
    };
  }

  function createBox(source) {
    if (!source) {
      return;
    }

    const s = selection();

    const seconds =
      TF[s.tf] || 60;

    const box = {
      id:
        "purple-" +
        Date.now() +
        "-" +
        Math.random()
          .toString(36)
          .slice(2, 9),

      marketKey:
        marketKey(s),

      symbol:
        s.symbol,

      exchange:
        s.exchange,

      market:
        s.market,

      sourceTf:
        s.tf,

      name:
        "Caja morada",

      start:
        Number(source.start),

      end:
        Math.max(
          Number(source.end),
          Number(source.start) +
          seconds
        ),

      high:
        Number(source.high),

      low:
        Number(source.low)
    };

    if (!validBox(box)) {
      note.textContent =
        "No se pudo crear: " +
        "rango de precios inválido.";

      return;
    }

    boxes.push(box);

    if (
      boxes.length > MAX_BOXES
    ) {
      boxes.splice(
        0,
        boxes.length - MAX_BOXES
      );
    }

    selectedId = box.id;

    config.fixed = true;

    toggleInputs.fixed.checked = true;

    savePrefs();
    saveAndRedraw();

    note.textContent =
      "Caja creada. Activa Editar " +
      "para moverla o ajustar " +
      "sus cuatro bordes.";
  }

  createButton.addEventListener(
    "click",
    () => {
      const source =
        rangeSource();

      if (!source) {
        note.textContent =
          "Esperando al menos cuatro " +
          "velas cerradas del " +
          "activo y temporalidad actuales.";

        return;
      }

      createBox(source);
    }
  );

  candleButton.addEventListener(
    "click",
    () => {
      const data =
        closedRows();

      const previous =
        data.at(-2);

      if (!previous) {
        note.textContent =
          "No hay suficientes " +
          "velas cerradas.";

        return;
      }

      const seconds =
        TF[selection().tf] || 60;

      createBox({
        start:
          previous.time,

        end:
          previous.time + seconds,

        high:
          previous.high,

        low:
          previous.low
      });
    }
  );

  deleteButton.addEventListener(
    "click",
    () => {
      const box =
        selectedBox();

      if (!box) {
        return;
      }

      if (
        !window.confirm(
          "¿Eliminar la caja morada seleccionada?"
        )
      ) {
        return;
      }

      boxes = boxes.filter(
        b => b.id !== box.id
      );

      selectedId = null;

      saveAndRedraw();
    }
  );

  function setEditing(enabled) {
    editing = Boolean(enabled);

    drag = null;

    touchLayer.hidden =
      !editing;

    const host =
      canvas.parentElement;

    host?.classList.toggle(
      "cl-box-editing",
      editing
    );

    host?.classList.remove(
      "cl-box-dragging"
    );

    editButton.textContent =
      editing
        ? "✋ Editar: SÍ"
        : "✋ Editar: NO";

    editButton.classList.toggle(
      "active",
      editing
    );

    editButton.setAttribute(
      "aria-pressed",
      String(editing)
    );

    redraw();
  }

  editButton.addEventListener(
    "click",
    () => {
      if (
        !editing &&
        !visibleBoxes().length
      ) {
        return;
      }

      setEditing(!editing);
    }
  );

  function priceY(value) {
    try {
      const y =
        candle?.priceToCoordinate(
          value
        );

      return Number.isFinite(y)
        ? y
        : null;

    } catch {
      return null;
    }
  }

  function priceAtY(value) {
    try {
      const price =
        candle?.coordinateToPrice(
          value
        );

      return Number.isFinite(price)
        ? price
        : null;

    } catch {
      return null;
    }
  }

  function timeX(value) {
    try {
      const x =
        chart?.timeScale()
          .timeToCoordinate(value);

      return Number.isFinite(x)
        ? x
        : null;

    } catch {
      return null;
    }
  }

  /*
   Conversión de tiempo a coordenada.

   Primero intenta el tiempo exacto.
   Si no existe una vela exacta,
   interpola entre velas próximas.

   Esto permite conservar cajas
   al cambiar de temporalidad.
  */

  function timeCoordinate(value) {
    if (
      !chart ||
      !rows.length
    ) {
      return null;
    }

    const exact =
      timeX(value);

    if (
      Number.isFinite(exact)
    ) {
      return exact;
    }

    let low = 0;
    let high = rows.length;

    while (low < high) {
      const mid =
        Math.floor(
          (low + high) / 2
        );

      if (
        rows[mid].time < value
      ) {
        low = mid + 1;
      } else {
        high = mid;
      }
    }

    const before =
      rows[low - 1];

    const after =
      rows[low];

    if (
      before &&
      after &&
      after.time > before.time
    ) {
      const x1 =
        timeX(before.time);

      const x2 =
        timeX(after.time);

      if (
        Number.isFinite(x1) &&
        Number.isFinite(x2)
      ) {
        const ratio =
          (value - before.time) /
          (after.time - before.time);

        return (
          x1 +
          (x2 - x1) * ratio
        );
      }
    }

    const edge =
      value < rows[0].time
        ? rows[0]
        : rows.at(-1);

    const edgeX =
      timeX(edge.time);

    if (
      !Number.isFinite(edgeX)
    ) {
      return null;
    }

    let spacing = 7;

    try {
      spacing = Number(
        chart.timeScale()
          .options().barSpacing
      ) || 7;

    } catch {}

    const seconds =
      TF[selection().tf] || 60;

    return (
      edgeX +
      (
        (value - edge.time) /
        seconds
      ) * spacing
    );
  }

  /*
   Conversión de coordenada a tiempo.

   Se usa la escala lógica cuando
   está disponible y se interpola
   para evitar saltos bruscos.
  */

  function timeAtX(x) {
    if (
      !chart ||
      !rows.length
    ) {
      return null;
    }

    const scale =
      chart.timeScale();

    let logical;

    try {
      logical =
        scale.coordinateToLogical(x);

    } catch {
      return null;
    }

    if (
      !Number.isFinite(logical)
    ) {
      return null;
    }

    const seconds =
      TF[selection().tf] || 60;

    const index =
      Math.floor(logical);

    const fraction =
      logical - index;

    if (index < 0) {
      return (
        rows[0].time +
        logical * seconds
      );
    }

    if (
      index >= rows.length - 1
    ) {
      return (
        rows.at(-1).time +
        (
          logical -
          (rows.length - 1)
        ) * seconds
      );
    }

    const before =
      rows[index];

    const after =
      rows[index + 1];

    if (
      !before ||
      !after
    ) {
      return null;
    }

    return (
      before.time +
      (
        after.time -
        before.time
      ) * fraction
    );
  }

  function geometry(box) {
    const x1 =
      timeCoordinate(
        box.start
      );

    const x2 =
      timeCoordinate(
        box.end
      );

    const y1 =
      priceY(box.high);

    const y2 =
      priceY(box.low);

    if (
      ![
        x1,
        x2,
        y1,
        y2
      ].every(Number.isFinite)
    ) {
      return null;
    }

    return {
      left:
        Math.min(x1, x2),

      right:
        Math.max(x1, x2),

      top:
        Math.min(y1, y2),

      bottom:
        Math.max(y1, y2)
    };
  }

  function drawBox(
    ctx,
    box,
    label,
    options = {}
  ) {
    const g =
      geometry(box);

    if (!g) {
      return;
    }

    const width =
      canvas.clientWidth;

    const height =
      canvas.clientHeight;

    const left =
      Math.max(
        0,
        g.left
      );

    const right =
      Math.min(
        width,
        options.extend
          ? width
          : g.right
      );

    const top =
      Math.max(
        0,
        g.top
      );

    const bottom =
      Math.min(
        height,
        g.bottom
      );

    if (
      right <= left ||
      bottom <= top
    ) {
      return;
    }

    ctx.save();

    ctx.fillStyle =
      options.active
        ? "rgba(187,82,255,.18)"
        : "rgba(187,82,255,.10)";

    ctx.fillRect(
      left,
      top,
      right - left,
      bottom - top
    );

    ctx.strokeStyle =
      options.active
        ? PURPLE_LIGHT
        : PURPLE;

    ctx.lineWidth =
      options.active
        ? 2
        : 1.2;

    if (
      config.boundaries ||
      options.active
    ) {
      ctx.strokeRect(
        left + .5,
        top + .5,
        Math.max(
          0,
          right - left - 1
        ),
        Math.max(
          0,
          bottom - top - 1
        )
      );
    }

    if (config.midpoint) {
      const mid =
        (
          box.high +
          box.low
        ) / 2;

      const y =
        priceY(mid);

      if (
        Number.isFinite(y)
      ) {
        ctx.beginPath();

        ctx.strokeStyle =
          PURPLE_LIGHT;

        ctx.lineWidth = 1;

        ctx.setLineDash(
          [5, 5]
        );

        ctx.moveTo(
          left,
          y
        );

        ctx.lineTo(
          right,
          y
        );

        ctx.stroke();

        ctx.setLineDash([]);
      }
    }

    ctx.font =
      "11px system-ui";

    ctx.fillStyle =
      PURPLE_LIGHT;

    ctx.fillText(
      label,
      left + 5,
      Math.max(
        13,
        top + 13
      ),
      Math.max(
        10,
        right - left - 8
      )
    );

    if (
      options.active &&
      editing
    ) {
      const points = [
        [
          g.left,
          (
            g.top +
            g.bottom
          ) / 2
        ],
        [
          g.right,
          (
            g.top +
            g.bottom
          ) / 2
        ],
        [
          (
            g.left +
            g.right
          ) / 2,
          g.top
        ],
        [
          (
            g.left +
            g.right
          ) / 2,
          g.bottom
        ]
      ];

      ctx.fillStyle = "#ffffff";

      for (
        const [x, y] of points
      ) {
        if (
          x < 0 ||
          x > width ||
          y < 0 ||
          y > height
        ) {
          continue;
        }

        ctx.fillRect(
          x - 5,
          y - 5,
          10,
          10
        );
      }
    }

    ctx.restore();
  }

  function sidewaysSource() {
    const data =
      closedRows().slice(-18);

    if (
      data.length < 12
    ) {
      return null;
    }

    const high =
      Math.max(
        ...data.map(
          c => c.high
        )
      );

    const low =
      Math.min(
        ...data.map(
          c => c.low
        )
      );

    const averageRange =
      data.reduce(
        (sum, c) =>
          sum +
          c.high -
          c.low,
        0
      ) / data.length;

    if (
      averageRange <= 0
    ) {
      return null;
    }

    const ratio =
      (high - low) /
      averageRange;

    if (ratio > 5) {
      return null;
    }

    return {
      start:
        data[0].time,

      end:
        data.at(-1).time,

      high,
      low
    };
  }

  function draw() {
    if (
      !chart ||
      !candle ||
      !canvas.isConnected
    ) {
      return;
    }

    if (
      rowsKey !==
      dataKey(selection())
    ) {
      return;
    }

    const width =
      canvas.clientWidth;

    const height =
      canvas.clientHeight;

    if (
      width <= 0 ||
      height <= 0
    ) {
      return;
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
      return;
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

    if (config.sideways) {
      const source =
        sidewaysSource();

      if (source) {
        drawBox(
          ctx,
          source,
          "Lateralización",
          {
            extend:
              config.extendRight
          }
        );
      }
    }

    if (config.previous) {
      const data =
        closedRows();

      const previous =
        data.at(-2);

      if (previous) {
        const seconds =
          TF[selection().tf] || 60;

        drawBox(
          ctx,
          {
            start:
              previous.time,

            end:
              previous.time +
              seconds,

            high:
              previous.high,

            low:
              previous.low
          },
          "Penúltima vela"
        );
      }
    }

    if (config.fixed) {
      visibleBoxes().forEach(
        (box, index) => {
          drawBox(
            ctx,
            box,
            "Caja morada " +
            (index + 1),
            {
              active:
                box.id ===
                selectedId
            }
          );
        }
      );
    }
  }

  function redraw() {
    if (frame) {
      return;
    }

    frame =
      requestAnimationFrame(
        () => {
          frame = 0;
          draw();
        }
      );
  }

  function pointerPosition(event) {
    const rect =
      touchLayer
        .getBoundingClientRect();

    return {
      x:
        event.clientX -
        rect.left,

      y:
        event.clientY -
        rect.top
    };
  }

  function hitTest(point) {
    const list =
      visibleBoxes()
        .slice()
        .reverse();

    for (const box of list) {
      const g =
        geometry(box);

      if (!g) {
        continue;
      }

      const margin =
        HANDLE_SIZE;

      if (
        point.x <
          g.left - margin ||
        point.x >
          g.right + margin ||
        point.y <
          g.top - margin ||
        point.y >
          g.bottom + margin
      ) {
        continue;
      }

      const nearLeft =
        Math.abs(
          point.x - g.left
        ) <= margin;

      const nearRight =
        Math.abs(
          point.x - g.right
        ) <= margin;

      const nearTop =
        Math.abs(
          point.y - g.top
        ) <= margin;

      const nearBottom =
        Math.abs(
          point.y - g.bottom
        ) <= margin;

      if (nearLeft) {
        return {
          box,
          mode: "left"
        };
      }

      if (nearRight) {
        return {
          box,
          mode: "right"
        };
      }

      if (nearTop) {
        return {
          box,
          mode: "top"
        };
      }

      if (nearBottom) {
        return {
          box,
          mode: "bottom"
        };
      }

      return {
        box,
        mode: "move"
      };
    }

    return null;
  }

  touchLayer.addEventListener(
    "pointerdown",
    event => {
      if (
        !editing ||
        drag
      ) {
        return;
      }

      if (
        event.pointerType ===
          "mouse" &&
        event.button !== 0
      ) {
        return;
      }

      const point =
        pointerPosition(event);

      const hit =
        hitTest(point);

      if (!hit) {
        return;
      }

      event.preventDefault();

      selectedId =
        hit.box.id;

      updateSelector();

      drag = {
        pointerId:
          event.pointerId,

        box:
          hit.box,

        mode:
          hit.mode,

        startPoint:
          point,

        original:
          { ...hit.box },

        startTime:
          timeAtX(point.x),

        startPrice:
          priceAtY(point.y),

        key:
          dataKey(selection())
      };

      try {
        touchLayer.setPointerCapture(
          event.pointerId
        );
      } catch {}

      canvas.parentElement
        ?.classList.add(
          "cl-box-dragging"
        );

      redraw();
    }
  );

  touchLayer.addEventListener(
    "pointermove",
    event => {
      if (
        !drag ||
        event.pointerId !==
          drag.pointerId
      ) {
        return;
      }

      event.preventDefault();

      if (
        drag.key !==
        dataKey(selection())
      ) {
        cancelDrag();
        return;
      }

      const point =
        pointerPosition(event);

      const box =
        drag.box;

      const original =
        drag.original;

      const seconds =
        TF[selection().tf] || 60;

      const currentTime =
        timeAtX(point.x);

      const currentPrice =
        priceAtY(point.y);

      if (
        drag.mode === "move"
      ) {
        if (
          Number.isFinite(
            drag.startTime
          ) &&
          Number.isFinite(
            currentTime
          )
        ) {
          const delta =
            Math.round(
              (
                currentTime -
                drag.startTime
              ) / seconds
            ) * seconds;

          box.start =
            original.start +
            delta;

          box.end =
            original.end +
            delta;
        }

        if (
          Number.isFinite(
            drag.startPrice
          ) &&
          Number.isFinite(
            currentPrice
          )
        ) {
          const delta =
            currentPrice -
            drag.startPrice;

          const newLow =
            original.low +
            delta;

          const newHigh =
            original.high +
            delta;

          if (
            newLow > 0 &&
            newHigh > newLow
          ) {
            box.low =
              newLow;

            box.high =
              newHigh;
          }
        }
      }

      if (
        drag.mode === "left" ||
        drag.mode === "right"
      ) {
        if (
          Number.isFinite(
            drag.startTime
          ) &&
          Number.isFinite(
            currentTime
          )
        ) {
          const delta =
            Math.round(
              (
                currentTime -
                drag.startTime
              ) / seconds
            ) * seconds;

          if (
            drag.mode === "left"
          ) {
            box.start =
              Math.min(
                original.start +
                delta,
                original.end -
                seconds
              );

          } else {
            box.end =
              Math.max(
                original.end +
                delta,
                original.start +
                seconds
              );
          }
        }
      }

      if (
        drag.mode === "top" &&
        Number.isFinite(
          currentPrice
        )
      ) {
        box.high =
          Math.max(
            currentPrice,
            original.low *
            1.000001
          );
      }

      if (
        drag.mode === "bottom" &&
        Number.isFinite(
          currentPrice
        )
      ) {
        box.low =
          Math.max(
            0.00000001,
            Math.min(
              currentPrice,
              original.high *
              0.999999
            )
          );
      }

      redraw();
    }
  );

  function cancelDrag() {
    if (!drag) {
      return;
    }

    Object.assign(
      drag.box,
      drag.original
    );

    const pointerId =
      drag.pointerId;

    drag = null;

    try {
      if (
        touchLayer.hasPointerCapture(
          pointerId
        )
      ) {
        touchLayer.releasePointerCapture(
          pointerId
        );
      }
    } catch {}

    canvas.parentElement
      ?.classList.remove(
        "cl-box-dragging"
      );

    redraw();
  }

  function finishDrag(event) {
    if (
      !drag ||
      event.pointerId !==
        drag.pointerId
    ) {
      return;
    }

    const pointerId =
      drag.pointerId;

    const box =
      drag.box;

    if (!validBox(box)) {
      Object.assign(
        box,
        drag.original
      );
    }

    drag = null;

    try {
      if (
        touchLayer.hasPointerCapture(
          pointerId
        )
      ) {
        touchLayer.releasePointerCapture(
          pointerId
        );
      }
    } catch {}

    canvas.parentElement
      ?.classList.remove(
        "cl-box-dragging"
      );

    saveAndRedraw();
  }

  touchLayer.addEventListener(
    "pointerup",
    finishDrag
  );

  touchLayer.addEventListener(
    "pointercancel",
    event => {
      if (
        drag &&
        event.pointerId ===
          drag.pointerId
      ) {
        cancelDrag();
      }
    }
  );

  touchLayer.addEventListener(
    "lostpointercapture",
    () => {
      if (drag) {
        cancelDrag();
      }
    }
  );

  function bindOverlay() {
    const host =
      $("priceChartArea") ||
      $("chart")?.parentElement;

    if (!host) {
      return false;
    }

    if (
      getComputedStyle(host)
        .position === "static"
    ) {
      host.style.position =
        "relative";
    }

    if (
      canvas.parentElement !== host
    ) {
      host.append(canvas);
    }

    if (
      touchLayer.parentElement !== host
    ) {
      host.append(touchLayer);
    }

    touchLayer.hidden =
      !editing;

    const target =
      $("clRangeBoxesHost") ||
      $("rangeBoxesHost") ||
      document.querySelector(
        "[data-range-boxes-host]"
      );

    if (target) {
      if (
        panel.parentElement !== target
      ) {
        target.append(panel);
      }

    } else if (
      !panel.isConnected
    ) {
      const anchor =
        $("chartSection") ||
        host;

      if (
        anchor.parentElement
      ) {
        anchor.parentElement
          .insertBefore(
            panel,
            anchor
          );
      }
    }

    if (
      window.ResizeObserver &&
      observedHost !== host
    ) {
      resizeObserver?.disconnect();

      resizeObserver =
        new ResizeObserver(
          redraw
        );

      resizeObserver.observe(host);

      observedHost = host;
    }

    return true;
  }

  function onVisibleRange() {
    redraw();
  }

  function attach(detail) {
    const nextChart =
      detail?.chart;

    const nextCandle =
      detail?.candle ||
      detail?.candleSeries;

    if (
      !nextChart ||
      !nextCandle
    ) {
      return;
    }

    if (
      subscribedChart &&
      subscribedChart !== nextChart
    ) {
      try {
        subscribedChart.timeScale()
          .unsubscribeVisibleLogicalRangeChange(
            onVisibleRange
          );
      } catch {}
    }

    chart = nextChart;
    candle = nextCandle;

    bindOverlay();

    if (
      subscribedChart !== chart
    ) {
      subscribedChart = chart;

      try {
        chart.timeScale()
          .subscribeVisibleLogicalRangeChange(
            onVisibleRange
          );
      } catch (error) {
        console.warn(
          "Range Boxes: rango visible",
          error
        );
      }
    }

    redraw();
  }

  function acceptRows(
    data,
    sourceSelection = null
  ) {
    if (!Array.isArray(data)) {
      return;
    }

    const s =
      sourceSelection
        ? normalizeSelection(
            sourceSelection
          )
        : selection();

    const key =
      dataKey(s);

    if (
      key !==
      dataKey(selection())
    ) {
      return;
    }

    const normalized =
      normalizeRows(data);

    if (!normalized.length) {
      return;
    }

    if (
      currentKey !== key
    ) {
      currentKey = key;

      selectedId = null;

      setEditing(false);
      updateSelector();
    }

    rows = normalized;
    rowsKey = key;

    redraw();
  }

  function recoverChart() {
    const shared =
      window.CryptolexuzChart;

    if (!shared?.chart) {
      return;
    }

    attach({
      chart:
        shared.chart,

      candle:
        shared.candle ||
        shared.candleSeries
    });

    if (
      typeof shared.getRows ===
      "function"
    ) {
      try {
        const data =
          shared.getRows();

        if (
          Array.isArray(data)
        ) {
          acceptRows(data);
        }
      } catch (error) {
        console.warn(
          "Range Boxes: recuperación",
          error
        );
      }
    }
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
          !rows.length
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

  function resetSelection() {
    cancelDrag();

    rows = [];
    rowsKey = "";
    currentKey = "";
    selectedId = null;

    setEditing(false);
    updateSelector();

    const ctx =
      canvas.getContext("2d");

    if (ctx) {
      ctx.clearRect(
        0,
        0,
        canvas.width,
        canvas.height
      );
    }

    scheduleRecovery();
  }

  window.addEventListener(
    "cryptolexuz:chart-ready",
    event => {
      attach(
        event.detail || {}
      );
    }
  );

  window.addEventListener(
    "cryptolexuz:candles-updated",
    event => {
      const detail =
        event.detail || {};

      if (
        detail.chart &&
        (
          detail.candle ||
          detail.candleSeries
        )
      ) {
        attach(detail);
      }

      const data =
        detail.rows ||
        detail.candles;

      if (
        Array.isArray(data)
      ) {
        const source =
          detail.selection ||
          (
            detail.symbol &&
            detail.interval
              ? {
                  symbol:
                    detail.symbol,

                  tf:
                    detail.interval,

                  exchange:
                    detail.exchange,

                  market:
                    detail.market
                }
              : null
          );

        acceptRows(
          data,
          source
        );
      }
    }
  );

  function init() {
    if (initialized) {
      return;
    }

    initialized = true;

    addStyles();
    bindOverlay();

    updateSelector();
    scheduleRecovery();

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
        resetSelection
      );
    }

    window.addEventListener(
      "resize",
      redraw
    );

    window.addEventListener(
      "cryptolexuz:screen-change",
      () => {
        bindOverlay();
        recoverChart();
        redraw();
      }
    );

    document.addEventListener(
      "visibilitychange",
      () => {
        if (!document.hidden) {
          bindOverlay();
          recoverChart();
          redraw();
        }
      }
    );

    console.info(
      "CRYPTOLEXUZ PRO — " +
      "Range Boxes V7 cargado"
    );
  }

  window.CryptolexuzRangeBoxes = {
    version: "7",

    redraw,

    refresh: () => {
      recoverChart();
      redraw();
    },

    getBoxes: () =>
      visibleBoxes().map(
        b => ({ ...b })
      ),

    getSelection:
      selection,

    setEditing,

    isEditing: () =>
      editing,

    getConfig: () =>
      ({ ...config }),

    getStatus: () => ({
      attached:
        Boolean(
          chart &&
          candle
        ),

      editing,

      selectedId,

      marketKey:
        marketKey(selection()),

      timeframe:
        selection().tf,

      candles:
        rows.length,

      boxes:
        visibleBoxes().length
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
