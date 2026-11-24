
/*
 CRYPTOLEXUZ PRO — RANGE BOXES V6
 Compatible con Lightweight Charts 4.2.2

 - Sin caja verde
 - Cajas moradas editables con un dedo
 - Movimiento y ajuste de cuatro bordes
 - Gráfica libre fuera del modo edición
 - Persistencia por activo y mercado
 - Compatible con app.js V19 y styles.css V21
 - Sin ejecución de órdenes
*/
"use strict";

(() => {
  if (window.__clRangeBoxesV6) return;
  window.__clRangeBoxesV6 = true;

  const $ = id => document.getElementById(id);

  const TF = {
    "1m":60, "3m":180, "5m":300,
    "15m":900, "30m":1800,
    "1h":3600, "2h":7200,
    "4h":14400, "6h":21600,
    "8h":28800, "12h":43200,
    "1d":86400, "3d":259200,
    "1w":604800, "1M":2592000
  };

  const GOLD = "NCCOGOLD2USD-USDT";
  const OIL = "NCCO1OILWTI2USD-USDT";

  const STORE = "cryptolexuz-purple-boxes-v6";
  const PREVIOUS_STORE = "cryptolexuz-purple-boxes-v5";
  const LEGACY_STORE = "cryptolexuz-fixed-boxes-v3";
  const PREFS = "cryptolexuz-purple-prefs-v6";

  const PURPLE = "#bb52ff";
  const PURPLE_LIGHT = "#e4b9ff";

  function readJSON(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch {
      return fallback;
    }
  }

  const config = {
    fixed: true,
    sideways: true,
    previous: false,
    midpoint: false,
    boundaries: true,
    extendRight: true,
    lookback: 24
  };

  const savedPrefs = readJSON(
    PREFS,
    readJSON("cryptolexuz-purple-prefs-v5", {})
  );

  if (savedPrefs && typeof savedPrefs === "object") {
    for (const key of Object.keys(config)) {
      if (key === "lookback") {
        const n = Number(savedPrefs[key]);
        if ([12,24,36,48,72].includes(n)) {
          config.lookback = n;
        }
      } else if (typeof savedPrefs[key] === "boolean") {
        config[key] = savedPrefs[key];
      }
    }
  }

  function savePrefs() {
    try {
      localStorage.setItem(PREFS, JSON.stringify(config));
    } catch (error) {
      console.warn("Preferencias de cajas:", error);
    }
  }

  const stored = readJSON(
    STORE,
    readJSON(
      PREVIOUS_STORE,
      readJSON(LEGACY_STORE, [])
    )
  );

  let boxes = Array.isArray(stored) ? stored : [];

  boxes = boxes.filter(b =>
    b &&
    typeof b.id === "string" &&
    typeof b.marketKey === "string" &&
    [b.start,b.end,b.high,b.low]
      .every(v => Number.isFinite(Number(v))) &&
    Number(b.high) > Number(b.low) &&
    Number(b.low) > 0 &&
    Number(b.end) > Number(b.start)
  ).map(b => ({
    ...b,
    start: Number(b.start),
    end: Number(b.end),
    high: Number(b.high),
    low: Number(b.low),
    name: "Caja morada"
  }));

  function saveBoxes() {
    try {
      localStorage.setItem(STORE, JSON.stringify(boxes));
    } catch (error) {
      console.warn("Guardar cajas:", error);
    }
  }

  let chart = null;
  let candle = null;
  let rows = [];
  let currentKey = "";
  let attachedChart = null;
  let selectedId = null;
  let initialized = false;
  let editing = false;
  let drag = null;
  let frame = 0;
  let resizeObserver = null;

  const canvas = document.createElement("canvas");
  canvas.id = "clRangeOverlay";

  const touchLayer = document.createElement("div");
  touchLayer.className = "cl-box-touch-layer";
  touchLayer.hidden = true;
  touchLayer.setAttribute(
    "aria-label",
    "Superficie de edición de caja morada"
  );

  const panel = document.createElement("section");
  panel.id = "clRangeControls";
  panel.className = "cl-module";

  panel.style.cssText = `
    display:grid;
    gap:12px;
    margin:12px 0;
    padding:14px;
    border:1px solid #493365;
    border-radius:13px;
    background:#151123;
    color:#f0e5ff;
    font:12px system-ui,sans-serif;
  `;

  const heading = document.createElement("div");
  heading.style.cssText = `
    display:flex;
    justify-content:space-between;
    align-items:center;
    gap:8px;
  `;

  heading.innerHTML = `
    <strong style="font-size:15px">
      🟪 Cajas moradas
    </strong>
    <span style="color:#b89bd1">V6</span>
  `;

  const grid = document.createElement("div");
  grid.style.cssText = `
    display:grid;
    grid-template-columns:repeat(2,minmax(0,1fr));
    gap:8px;
  `;

  function addToggle(label, key) {
    const wrapper = document.createElement("label");

    wrapper.style.cssText = `
      display:flex;
      align-items:center;
      gap:7px;
      min-height:40px;
      padding:8px;
      border:1px solid #51366a;
      border-radius:8px;
      background:#251b32;
      cursor:pointer;
    `;

    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = config[key];
    input.style.accentColor = PURPLE;

    input.addEventListener("change", () => {
      config[key] = input.checked;
      savePrefs();
      redraw();
    });

    wrapper.append(
      input,
      document.createTextNode(label)
    );

    grid.append(wrapper);
    return input;
  }

  const fixedToggle = addToggle(
    "Mostrar cajas fijas", "fixed"
  );

  addToggle("Lateralización", "sideways");
  addToggle("Penúltima vela", "previous");
  addToggle("Extender lateral", "extendRight");
  addToggle("Línea central", "midpoint");
  addToggle("Mostrar bordes", "boundaries");

  function makeButton(text) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = text;
    button.className = "cl-purple-box-button";
    return button;
  }

  const createButton = makeButton("＋ Crear caja");
  const candleButton = makeButton("📌 Fijar vela");
  const deleteButton = makeButton("🗑 Eliminar");
  const editButton = makeButton("✋ Editar: NO");

  editButton.setAttribute("aria-pressed", "false");

  const selectBox = document.createElement("select");

  selectBox.style.cssText = `
    min-width:0;
    max-width:100%;
    padding:10px;
    border:1px solid #7849a3;
    border-radius:8px;
    background:#251b32;
    color:#fff;
  `;

  const lookback = document.createElement("select");
  lookback.style.cssText = selectBox.style.cssText;

  for (const n of [12,24,36,48,72]) {
    const option = document.createElement("option");
    option.value = String(n);
    option.textContent = n + " velas";
    option.selected = n === config.lookback;
    lookback.append(option);
  }

  lookback.addEventListener("change", () => {
    config.lookback = Number(lookback.value);
    savePrefs();
    redraw();
  });

  const controls = document.createElement("div");
  controls.style.cssText = `
    display:flex;
    flex-wrap:wrap;
    align-items:center;
    gap:8px;
  `;

  controls.append(
    createButton,
    candleButton,
    deleteButton,
    selectBox,
    editButton,
    lookback
  );

  const note = document.createElement("p");
  note.style.cssText = `
    margin:0;
    color:#c4aed7;
    line-height:1.6;
  `;

  note.textContent =
    "Crea una caja y activa Editar. " +
    "Arrastra su interior para moverla; " +
    "arrastra los bordes para cambiar su tamaño. " +
    "Desactiva Editar para navegar por las velas.";

  panel.append(heading, grid, controls, note);

  function selection() {
    const symbol = $("symbol")?.value || "BTC-USDT";
    const commodity = [GOLD,OIL].includes(symbol);

    return {
      symbol,
      tf: $("interval")?.value || "15m",
      exchange: commodity
        ? "bingx"
        : $("exchange")?.value || "bingx",
      market: commodity
        ? "perpetual"
        : $("market")?.value || "perpetual"
    };
  }

  function marketKey(s) {
    return [
      s.exchange,
      s.market,
      s.symbol
    ].join("|");
  }

  function dataKey(s) {
    return marketKey(s) + "|" + s.tf;
  }

  function visibleBoxes() {
    const key = marketKey(selection());
    return boxes.filter(b => b.marketKey === key);
  }

  function selectedBox() {
    return visibleBoxes().find(b => b.id === selectedId);
  }

  function updateSelector() {
    const list = visibleBoxes();

    if (!list.some(b => b.id === selectedId)) {
      selectedId = list.at(-1)?.id || null;
    }

    selectBox.replaceChildren();

    if (!list.length) {
      const option = document.createElement("option");
      option.value = "";
      option.textContent = "Sin cajas";
      selectBox.append(option);
    }

    list.forEach((box, index) => {
      const option = document.createElement("option");
      option.value = box.id;
      option.textContent = "Caja morada " + (index + 1);
      option.selected = box.id === selectedId;
      selectBox.append(option);
    });

    deleteButton.disabled = !list.length;
    editButton.disabled = !list.length;
    selectBox.disabled = !list.length;

    if (!list.length && editing) {
      setEditing(false);
    }
  }

  function saveAndRedraw() {
    saveBoxes();
    updateSelector();
    redraw();
  }

  selectBox.addEventListener("change", () => {
    selectedId = selectBox.value;
    redraw();
  });

  function closedRows() {
    const sec = TF[selection().tf] || 60;
    const now = Date.now() / 1000;

    return rows.filter(c =>
      Number.isFinite(c.time) &&
      Number.isFinite(c.high) &&
      Number.isFinite(c.low) &&
      c.time + sec <= now - 2
    );
  }

  function rangeSource() {
    const data = closedRows().slice(-config.lookback);

    if (data.length < 4) return null;

    return {
      start: data[0].time,
      end: data.at(-1).time,
      high: Math.max(...data.map(c => c.high)),
      low: Math.min(...data.map(c => c.low))
    };
  }

  function createBox(source) {
    if (!source) return;

    const s = selection();
    const sec = TF[s.tf] || 60;

    const box = {
      id: "purple-" + Date.now() + "-" +
        Math.random().toString(36).slice(2, 8),
      marketKey: marketKey(s),
      symbol: s.symbol,
      exchange: s.exchange,
      market: s.market,
      sourceTf: s.tf,
      name: "Caja morada",
      start: source.start,
      end: Math.max(source.end, source.start + sec),
      high: source.high,
      low: source.low
    };

    if (
      ![box.start,box.end,box.high,box.low]
        .every(Number.isFinite) ||
      box.low <= 0 ||
      box.high <= box.low
    ) return;

    boxes.push(box);
    selectedId = box.id;

    config.fixed = true;
    fixedToggle.checked = true;

    savePrefs();
    saveAndRedraw();

    note.textContent =
      "Caja creada. Activa Editar para " +
      "moverla o ajustar sus cuatro bordes.";
  }

  createButton.addEventListener("click", () => {
    const source = rangeSource();

    if (!source) {
      note.textContent =
        "Esperando suficientes velas cerradas.";
      return;
    }

    createBox(source);
  });

  candleButton.addEventListener("click", () => {
    const data = closedRows();
    const previous = data.at(-2);

    if (!previous) {
      note.textContent =
        "Esperando velas cerradas.";
      return;
    }

    const sec = TF[selection().tf] || 60;

    createBox({
      start: previous.time,
      end: previous.time + sec,
      high: previous.high,
      low: previous.low
    });
  });

  deleteButton.addEventListener("click", () => {
    const box = selectedBox();
    if (!box) return;

    if (!confirm("¿Eliminar la caja morada?")) {
      return;
    }

    boxes = boxes.filter(b => b.id !== box.id);
    selectedId = null;
    saveAndRedraw();
  });

  function setEditing(enabled) {
    editing = Boolean(enabled);
    drag = null;

    touchLayer.hidden = !editing;

    const host = $("priceChartArea");
    host?.classList.toggle("cl-box-editing", editing);
    host?.classList.remove("cl-box-dragging");

    editButton.textContent = editing
      ? "✋ Editar: SÍ"
      : "✋ Editar: NO";

    editButton.classList.toggle("active", editing);
    editButton.setAttribute(
      "aria-pressed",
      String(editing)
    );

    redraw();
  }

  editButton.addEventListener("click", () => {
    if (!editing && !visibleBoxes().length) return;
    setEditing(!editing);
  });

  function priceY(value) {
    try {
      return candle?.priceToCoordinate(value);
    } catch {
      return null;
    }
  }

  function priceAtY(value) {
    try {
      return candle?.coordinateToPrice(value);
    } catch {
      return null;
    }
  }

  function timeX(value) {
    try {
      return chart?.timeScale().timeToCoordinate(value);
    } catch {
      return null;
    }
  }

  /*
   La conversión a índice lógico evita
   depender de que exista una vela exacta
   en el extremo de una caja.
  */
  function timeCoordinate(value) {
    if (!chart || !rows.length) return null;

    const exact = timeX(value);
    if (Number.isFinite(exact)) return exact;

    const sec = TF[selection().tf] || 60;
    const scale = chart.timeScale();

    let low = 0;
    let high = rows.length;

    while (low < high) {
      const mid = (low + high) >> 1;

      if (rows[mid].time < value) {
        low = mid + 1;
      } else {
        high = mid;
      }
    }

    const before = rows[Math.max(0, low - 1)];
    const after = rows[Math.min(rows.length - 1, low)];

    if (
      before &&
      after &&
      before.time !== after.time &&
      value >= before.time &&
      value <= after.time
    ) {
      const x1 = timeX(before.time);
      const x2 = timeX(after.time);

      if (
        Number.isFinite(x1) &&
        Number.isFinite(x2)
      ) {
        return x1 + (x2 - x1) *
          (value - before.time) /
          (after.time - before.time);
      }
    }

    const edge = value < rows[0].time
      ? rows[0]
      : rows.at(-1);

    const edgeX = timeX(edge.time);
    if (!Number.isFinite(edgeX)) return null;

    let spacing = 7;

    try {
      spacing = Number(scale.options().barSpacing) || 7;
    } catch {}

    return edgeX +
      ((value - edge.time) / sec) * spacing;
  }

  function timeAtX(x) {
    if (!chart || !rows.length) return null;

    const scale = chart.timeScale();
    const sec = TF[selection().tf] || 60;

    let logical;

    try {
      logical = scale.coordinateToLogical(x);
    } catch {
      return null;
    }

    if (!Number.isFinite(logical)) return null;

    const index = Math.round(logical);

    if (index < 0) {
      return rows[0].time + index * sec;
    }

    if (index >= rows.length) {
      return rows.at(-1).time +
        (index - rows.length + 1) * sec;
    }

    return rows[index].time;
  }

  function geometry(box) {
    const x1 = timeCoordinate(box.start);
    const x2 = timeCoordinate(box.end);
    const y1 = priceY(box.high);
    const y2 = priceY(box.low);

    if (![x1,x2,y1,y2].every(Number.isFinite)) {
      return null;
    }

    return {
      left: Math.min(x1,x2),
      right: Math.max(x1,x2),
      top: Math.min(y1,y2),
      bottom: Math.max(y1,y2)
    };
  }

  function drawBox(ctx, box, label, options = {}) {
    const g = geometry(box);
    if (!g) return;

    const width = canvas.clientWidth;
    const height = canvas.clientHeight;

    const left = Math.max(0, g.left);
    const right = Math.min(
      width,
      options.extend ? width : g.right
    );

    const top = Math.max(0, g.top);
    const bottom = Math.min(height, g.bottom);

    if (right <= left || bottom <= top) return;

    ctx.save();

    ctx.fillStyle = "rgba(187,82,255,.11)";
    ctx.fillRect(
      left, top,
      right - left,
      bottom - top
    );

    ctx.strokeStyle = options.active
      ? PURPLE_LIGHT
      : PURPLE;

    ctx.lineWidth = options.active ? 2 : 1.2;

    if (config.boundaries) {
      ctx.strokeRect(
        left + .5,
        top + .5,
        Math.max(0, right - left - 1),
        Math.max(0, bottom - top - 1)
      );
    }

    if (config.midpoint) {
      const mid = (box.high + box.low) / 2;
      const y = priceY(mid);

      if (Number.isFinite(y)) {
        ctx.beginPath();
        ctx.strokeStyle = PURPLE_LIGHT;
        ctx.lineWidth = 1;
        ctx.setLineDash([5,5]);
        ctx.moveTo(left, y);
        ctx.lineTo(right, y);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    ctx.font = "11px system-ui";
    ctx.fillStyle = PURPLE_LIGHT;
    ctx.fillText(
      label,
      left + 5,
      Math.max(13, top + 13),
      Math.max(10, right - left - 8)
    );

    if (options.active && editing) {
      const points = [
        [left, (top + bottom) / 2],
        [right, (top + bottom) / 2],
        [(left + right) / 2, top],
        [(left + right) / 2, bottom]
      ];

      ctx.fillStyle = "#ffffff";

      for (const [x,y] of points) {
        ctx.fillRect(x - 5, y - 5, 10, 10);
      }
    }

    ctx.restore();
  }

  function sidewaysSource() {
    const data = closedRows().slice(-18);

    if (data.length < 12) return null;

    const high = Math.max(...data.map(c => c.high));
    const low = Math.min(...data.map(c => c.low));

    const avg = data.reduce(
      (sum,c) => sum + c.high - c.low,
      0
    ) / data.length;

    if (
      (high - low) /
      Math.max(avg, 1e-12) > 5
    ) return null;

    return {
      start: data[0].time,
      end: data.at(-1).time,
      high,
      low
    };
  }

  function draw() {
    if (!chart || !candle || !canvas.isConnected) {
      return;
    }

    const width = canvas.clientWidth;
    const height = canvas.clientHeight;

    if (!width || !height) return;

    const dpr = Math.min(
      window.devicePixelRatio || 1,
      2
    );

    const pixelWidth = Math.round(width * dpr);
    const pixelHeight = Math.round(height * dpr);

    if (canvas.width !== pixelWidth) {
      canvas.width = pixelWidth;
    }

    if (canvas.height !== pixelHeight) {
      canvas.height = pixelHeight;
    }

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.setTransform(dpr,0,0,dpr,0,0);
    ctx.clearRect(0,0,width,height);

    if (config.sideways) {
      const source = sidewaysSource();

      if (source) {
        drawBox(
          ctx,
          source,
          "Lateralización",
          {extend: config.extendRight}
        );
      }
    }

    if (config.previous) {
      const data = closedRows();
      const previous = data.at(-2);

      if (previous) {
        const sec = TF[selection().tf] || 60;

        drawBox(ctx, {
          start: previous.time,
          end: previous.time + sec,
          high: previous.high,
          low: previous.low
        }, "Penúltima vela");
      }
    }

    if (config.fixed) {
      visibleBoxes().forEach((box,index) => {
        drawBox(
          ctx,
          box,
          "Caja morada " + (index + 1),
          {active: box.id === selectedId}
        );
      });
    }
  }

  function redraw() {
    if (frame) return;

    frame = requestAnimationFrame(() => {
      frame = 0;
      draw();
    });
  }

  function pointerPosition(event) {
    const rect = touchLayer.getBoundingClientRect();

    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top
    };
  }

  function hitTest(point) {
    const list = visibleBoxes().slice().reverse();

    for (const box of list) {
      const g = geometry(box);
      if (!g) continue;

      const margin = 14;

      if (
        point.x < g.left - margin ||
        point.x > g.right + margin ||
        point.y < g.top - margin ||
        point.y > g.bottom + margin
      ) continue;

      const nearLeft =
        Math.abs(point.x - g.left) <= margin;

      const nearRight =
        Math.abs(point.x - g.right) <= margin;

      const nearTop =
        Math.abs(point.y - g.top) <= margin;

      const nearBottom =
        Math.abs(point.y - g.bottom) <= margin;

      if (nearLeft) {
        return {box, mode:"left"};
      }

      if (nearRight) {
        return {box, mode:"right"};
      }

      if (nearTop) {
        return {box, mode:"top"};
      }

      if (nearBottom) {
        return {box, mode:"bottom"};
      }

      return {box, mode:"move"};
    }

    return null;
  }

  touchLayer.addEventListener(
    "pointerdown",
    event => {
      if (!editing || drag) return;
      if (event.pointerType === "mouse" &&
          event.button !== 0) return;

      const point = pointerPosition(event);
      const hit = hitTest(point);

      if (!hit) return;

      event.preventDefault();

      selectedId = hit.box.id;
      updateSelector();

      drag = {
        pointerId: event.pointerId,
        box: hit.box,
        mode: hit.mode,
        startPoint: point,
        original: {...hit.box},
        startTime: timeAtX(point.x),
        startPrice: priceAtY(point.y)
      };

      touchLayer.setPointerCapture(event.pointerId);

      $("priceChartArea")?.classList.add(
        "cl-box-dragging"
      );

      redraw();
    }
  );

  touchLayer.addEventListener(
    "pointermove",
    event => {
      if (!drag ||
          event.pointerId !== drag.pointerId) {
        return;
      }

      event.preventDefault();

      const point = pointerPosition(event);
      const box = drag.box;
      const original = drag.original;
      const sec = TF[selection().tf] || 60;

      const currentTime = timeAtX(point.x);
      const currentPrice = priceAtY(point.y);

      if (drag.mode === "move") {
        if (
          Number.isFinite(drag.startTime) &&
          Number.isFinite(currentTime)
        ) {
          const delta = Math.round(
            (currentTime - drag.startTime) / sec
          ) * sec;

          box.start = original.start + delta;
          box.end = original.end + delta;
        }

        if (
          Number.isFinite(drag.startPrice) &&
          Number.isFinite(currentPrice)
        ) {
          const delta =
            currentPrice - drag.startPrice;

          const newLow = original.low + delta;
          const newHigh = original.high + delta;

          if (newLow > 0) {
            box.low = newLow;
            box.high = newHigh;
          }
        }
      }

      if (
        drag.mode === "left" ||
        drag.mode === "right"
      ) {
        if (Number.isFinite(currentTime)) {
          const delta = Math.round(
            (currentTime - drag.startTime) / sec
          ) * sec;

          if (drag.mode === "left") {
            box.start = Math.min(
              original.start + delta,
              original.end - sec
            );
          } else {
            box.end = Math.max(
              original.end + delta,
              original.start + sec
            );
          }
        }
      }

      if (
        drag.mode === "top" &&
        Number.isFinite(currentPrice)
      ) {
        box.high = Math.max(
          currentPrice,
          original.low * 1.000001
        );
      }

      if (
        drag.mode === "bottom" &&
        Number.isFinite(currentPrice)
      ) {
        box.low = Math.max(
          0.00000001,
          Math.min(
            currentPrice,
            original.high * 0.999999
          )
        );
      }

      redraw();
    }
  );

  function finishDrag(event) {
    if (
      !drag ||
      event.pointerId !== drag.pointerId
    ) return;

    try {
      touchLayer.releasePointerCapture(
        event.pointerId
      );
    } catch {}

    drag = null;

    $("priceChartArea")?.classList.remove(
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
        event.pointerId === drag.pointerId
      ) {
        Object.assign(drag.box, drag.original);
      }

      finishDrag(event);
    }
  );

  function bindOverlay() {
    const host =
      $("priceChartArea") ||
      $("chart")?.parentElement;

    if (!host) return;

    if (
      getComputedStyle(host).position === "static"
    ) {
      host.style.position = "relative";
    }

    if (canvas.parentElement !== host) {
      host.append(canvas);
    }

    if (touchLayer.parentElement !== host) {
      host.append(touchLayer);
    }

    touchLayer.hidden = !editing;

    const target =
      $("clRangeBoxesHost") ||
      $("rangeBoxesHost") ||
      document.querySelector(
        "[data-range-boxes-host]"
      );

    if (target) {
      if (panel.parentElement !== target) {
        target.append(panel);
      }
    } else if (!panel.isConnected) {
      const anchor = $("chartSection") || host;

      if (anchor.parentElement) {
        anchor.parentElement.insertBefore(
          panel,
          anchor
        );
      }
    }
  }

  function attach(detail) {
    if (
      !detail?.chart ||
      !(detail.candle || detail.candleSeries)
    ) return;

    chart = detail.chart;
    candle = detail.candle || detail.candleSeries;

    bindOverlay();

    if (attachedChart !== chart) {
      attachedChart = chart;

      try {
        chart.timeScale()
          .subscribeVisibleLogicalRangeChange(
            redraw
          );
      } catch (error) {
        console.warn("Rangos visibles:", error);
      }
    }

    redraw();
  }

  window.addEventListener(
    "cryptolexuz:chart-ready",
    event => attach(event.detail)
  );

  window.addEventListener(
    "cryptolexuz:candles-updated",
    event => {
      const detail = event.detail || {};

      if (
        detail.chart &&
        (detail.candle || detail.candleSeries)
      ) {
        attach(detail);
      }

      const data = detail.rows || detail.candles;

      if (Array.isArray(data)) {
        rows = data;

        const key = dataKey(selection());

        if (key !== currentKey) {
          currentKey = key;
          selectedId = null;
          setEditing(false);
          updateSelector();
        }

        redraw();
      }
    }
  );

  function recoverChart() {
    const shared = window.CryptolexuzChart;

    if (!shared?.chart) return;

    attach({
      chart: shared.chart,
      candle: shared.candle ||
        shared.candleSeries
    });

    if (typeof shared.getRows === "function") {
      const data = shared.getRows();

      if (Array.isArray(data)) {
        rows = data;
        redraw();
      }
    }
  }

  function init() {
    if (initialized) return;
    initialized = true;

    bindOverlay();
    recoverChart();
    updateSelector();

    for (const id of [
      "symbol",
      "interval",
      "market",
      "exchange"
    ]) {
      $(id)?.addEventListener("change", () => {
        currentKey = "";
        rows = [];
        selectedId = null;

        setEditing(false);
        updateSelector();
        redraw();

        setTimeout(recoverChart, 250);
      });
    }

    window.addEventListener("resize", redraw);

    window.addEventListener(
      "cryptolexuz:screen-change",
      () => {
        recoverChart();
        redraw();
      }
    );

    if (window.ResizeObserver) {
      resizeObserver = new ResizeObserver(redraw);

      const host =
        $("priceChartArea") ||
        $("chart")?.parentElement;

      if (host) {
        resizeObserver.observe(host);
      }
    }

    document.addEventListener(
      "visibilitychange",
      () => {
        if (!document.hidden) {
          recoverChart();
          redraw();
        }
      }
    );

    setTimeout(recoverChart, 300);
  }

  window.CryptolexuzRangeBoxes = {
    redraw,
    getBoxes: visibleBoxes,
    getSelection: selection,
    setEditing,
    isEditing: () => editing
  };

  if (document.readyState === "loading") {
    document.addEventListener(
      "DOMContentLoaded",
      init,
      {once:true}
    );
  } else {
    init();
  }
})();
