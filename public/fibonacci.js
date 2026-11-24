
/*
 CRYPTOLEXUZ PRO — FIBONACCI.JS V8
 Compatible con app.js V19 y Lightweight Charts 4.2.2.

 - Sin caja verde BitLobo.
 - Niveles Fibonacci configurables.
 - Dibujo y edición táctil.
 - Anclas guardadas por tiempo de vela.
 - Persistencia por exchange, mercado, activo y temporalidad.
 - Gráfica libre cuando el modo dibujo está desactivado.
 - Compatible con eventos de CRYPTOLEXUZ PRO.
*/

"use strict";

(() => {
  if (window.CryptolexuzFibonacci?.version === "8") return;

  const $ = id => document.getElementById(id);

  const STORE = "cryptolexuz_fibonacci_v8";
  const OLD_STORES = [
    "cryptolexuz_fibonacci_v7",
    "cryptolexuz_fibonacci_v2"
  ];

  const BASE_LEVELS = [
    0, 0.236, 0.382, 0.5,
    0.618, 0.65, 0.705,
    0.786, 0.88, 1,
    1.272, 1.618, 2,
    2.618, 3.618, 4.236
  ];

  const HIGHLIGHT = [
    0.618, 0.786, 0.88, 1.618
  ];

  const DEFAULT_COLOR = "#bb52ff";

  function defaults() {
    return {
      visible: true,
      showLabels: true,
      reverse: false,
      lineWidth: 1,
      color: DEFAULT_COLOR,

      // La caja verde fue retirada.
      showBox: false,

      levels: BASE_LEVELS.map(value => ({
        value,
        visible: true,
        color: HIGHLIGHT.includes(value)
          ? "#ffb347"
          : DEFAULT_COLOR
      }))
    };
  }

  let settings = defaults();
  let drawings = {};

  let chart = null;
  let candle = null;
  let canvas = null;
  let panel = null;

  let getRows = () => [];
  let getSelection = null;

  let drawing = false;
  let first = null;
  let dragging = null;
  let pointerId = null;

  let raf = 0;
  let initialized = false;
  let subscribedChart = null;

  function clone(value) {
    if (value === undefined) return null;
    return JSON.parse(JSON.stringify(value));
  }

  function finite(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  function validColor(value, fallback = DEFAULT_COLOR) {
    return /^#[0-9a-f]{6}$/i.test(String(value))
      ? value
      : fallback;
  }

  function normalizeSettings(source) {
    const base = defaults();

    if (!source || typeof source !== "object") {
      return base;
    }

    const result = {
      ...base,
      visible: source.visible !== false,
      showLabels: source.showLabels !== false,
      reverse: Boolean(source.reverse),
      showBox: false,
      color: validColor(source.color),
      lineWidth: Math.max(
        1,
        Math.min(5, finite(source.lineWidth) || 1)
      )
    };

    if (Array.isArray(source.levels)) {
      result.levels = source.levels
        .map(item => {
          const value = finite(item?.value);

          if (value === null || value < -20 || value > 20) {
            return null;
          }

          const oldGreen =
            String(item.color || "").toLowerCase() ===
            "#22c55e";

          return {
            value,
            visible: item.visible !== false,
            color: oldGreen
              ? "#ffb347"
              : validColor(item.color, result.color)
          };
        })
        .filter(Boolean)
        .sort((a, b) => a.value - b.value);
    }

    return result;
  }

  function load() {
    try {
      let source = JSON.parse(
        localStorage.getItem(STORE) || "null"
      );

      if (!source) {
        for (const key of OLD_STORES) {
          source = JSON.parse(
            localStorage.getItem(key) || "null"
          );

          if (source) break;
        }
      }

      settings = normalizeSettings(source);

      let savedDrawings = JSON.parse(
        localStorage.getItem(STORE + "_drawings") ||
        "null"
      );

      if (!savedDrawings) {
        for (const key of OLD_STORES) {
          savedDrawings = JSON.parse(
            localStorage.getItem(key + "_drawings") ||
            "null"
          );

          if (savedDrawings) break;
        }
      }

      if (
        savedDrawings &&
        typeof savedDrawings === "object" &&
        !Array.isArray(savedDrawings)
      ) {
        drawings = savedDrawings;
      }

    } catch (error) {
      console.warn(
        "Fibonacci: error al cargar configuración",
        error
      );
    }
  }

  function persist() {
    try {
      localStorage.setItem(
        STORE,
        JSON.stringify(settings)
      );

      localStorage.setItem(
        STORE + "_drawings",
        JSON.stringify(drawings)
      );
    } catch (error) {
      console.warn(
        "Fibonacci: error al guardar",
        error
      );
    }
  }

  function selection() {
    if (typeof getSelection === "function") {
      try {
        const selected = getSelection();

        if (selected && typeof selected === "object") {
          const symbol =
            selected.symbol || $("symbol")?.value || "BTC-USDT";

          return {
            exchange: selected.exchange ||
              $("exchange")?.value || "bingx",

            market: selected.market ||
              $("market")?.value || "perpetual",

            symbol,

            tf: selected.tf ||
              selected.interval ||
              $("interval")?.value || "15m"
          };
        }
      } catch (_) {}
    }

    const symbol = $("symbol")?.value || "BTC-USDT";
    const commodity = /^NCCO/.test(symbol);

    return {
      exchange: commodity
        ? "bingx"
        : $("exchange")?.value || "bingx",

      market: commodity
        ? "perpetual"
        : $("market")?.value || "perpetual",

      symbol,
      tf: $("interval")?.value || "15m"
    };
  }

  function currentKey() {
    const s = selection();

    return [
      s.exchange,
      s.market,
      s.symbol,
      s.tf
    ].join("|");
  }

  function rows() {
    try {
      const result = getRows();
      return Array.isArray(result) ? result : [];
    } catch (_) {
      return [];
    }
  }

  function timeNumber(value) {
    if (typeof value === "number") {
      return Number.isFinite(value) ? value : null;
    }

    if (typeof value === "string") {
      const numeric = Number(value);

      if (Number.isFinite(numeric)) {
        return numeric;
      }

      const parsed = Date.parse(value);

      return Number.isFinite(parsed)
        ? Math.floor(parsed / 1000)
        : null;
    }

    if (
      value &&
      typeof value === "object" &&
      Number.isInteger(value.year) &&
      Number.isInteger(value.month) &&
      Number.isInteger(value.day)
    ) {
      return Math.floor(
        Date.UTC(
          value.year,
          value.month - 1,
          value.day
        ) / 1000
      );
    }

    return null;
  }

  function sameTime(a, b) {
    const x = timeNumber(a);
    const y = timeNumber(b);

    return x !== null && y !== null && x === y;
  }

  function timeIndex(time) {
    const data = rows();

    return data.findIndex(
      item => sameTime(item.time, time)
    );
  }

  function nearestIndex(logical) {
    const data = rows();

    if (!data.length || !Number.isFinite(logical)) {
      return -1;
    }

    // En la serie de velas el índice lógico corresponde
    // a la posición de la vela en los datos cargados.
    return Math.max(
      0,
      Math.min(
        data.length - 1,
        Math.round(logical)
      )
    );
  }

  function anchorFromPoint(point) {
    if (!point) return null;

    const data = rows();
    const index = nearestIndex(point.logical);

    if (index < 0 || !data[index]) {
      return null;
    }

    return {
      time: data[index].time,
      price: point.price
    };
  }

  function migrateAnchor(anchor) {
    if (!anchor || typeof anchor !== "object") {
      return null;
    }

    const price = finite(anchor.price);

    if (price === null || price <= 0) {
      return null;
    }

    if (
      anchor.time !== undefined &&
      anchor.time !== null
    ) {
      return {
        time: anchor.time,
        price
      };
    }

    const logical = finite(anchor.logical);

    if (logical !== null) {
      const index = nearestIndex(logical);
      const data = rows();

      if (index >= 0 && data[index]) {
        return {
          time: data[index].time,
          price
        };
      }
    }

    return null;
  }

  function active() {
    const key = currentKey();
    const saved = drawings[key];

    if (!saved) return null;

    const a = migrateAnchor(saved.a);
    const b = migrateAnchor(saved.b);

    if (!a || !b) return null;

    if (
      saved.a?.time === undefined ||
      saved.b?.time === undefined
    ) {
      drawings[key] = { a, b };
      persist();
    }

    return { a, b };
  }

  function saveDrawing(value) {
    drawings[currentKey()] = value;
    persist();
    redraw();
  }

  function priceAt(start, end, ratio) {
    return start + (end - start) * ratio;
  }

  function calculate() {
    const d = active();

    if (!d) return null;

    const start = settings.reverse
      ? d.b.price
      : d.a.price;

    const end = settings.reverse
      ? d.a.price
      : d.b.price;

    const levels = settings.levels
      .filter(level => level.visible)
      .map(level => ({
        ...level,
        price: priceAt(
          start,
          end,
          Number(level.value)
        )
      }));

    return {
      anchors: d,
      levels,
      box: null
    };
  }

  function coordinateForTime(time) {
    if (!chart) return null;

    const scale = chart.timeScale();

    // Se usa primero la conversión temporal nativa.
    try {
      const x = scale.timeToCoordinate(time);

      if (Number.isFinite(x)) {
        return x;
      }
    } catch (_) {}

    // Alternativa para datos cuyo tiempo coincida
    // con una vela cargada.
    const index = timeIndex(time);

    if (index < 0) return null;

    try {
      const x = scale.logicalToCoordinate(index);

      return Number.isFinite(x) ? x : null;
    } catch (_) {
      return null;
    }
  }

  function coordinateForAnchor(anchor) {
    if (!anchor || !candle) return null;

    const x = coordinateForTime(anchor.time);

    let y = null;

    try {
      y = candle.priceToCoordinate(anchor.price);
    } catch (_) {}

    if (
      !Number.isFinite(x) ||
      !Number.isFinite(y)
    ) {
      return null;
    }

    return { x, y };
  }

  function redraw() {
    if (raf) return;

    raf = requestAnimationFrame(() => {
      raf = 0;
      paint();
    });
  }

  function formatLevel(value) {
    return Number(value)
      .toFixed(4)
      .replace(/0+$/, "")
      .replace(/\.$/, "");
  }

  function formatPrice(value) {
    const n = Number(value);

    if (!Number.isFinite(n)) return "—";

    return n.toLocaleString("en-US", {
      maximumFractionDigits: n < 1 ? 8 : 6
    });
  }

  function paint() {
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;

    if (width <= 0 || height <= 0) return;

    const ratio = Math.min(
      window.devicePixelRatio || 1,
      2
    );

    const pixelWidth = Math.round(width * ratio);
    const pixelHeight = Math.round(height * ratio);

    if (
      canvas.width !== pixelWidth ||
      canvas.height !== pixelHeight
    ) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
    }

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, width, height);

    if (!settings.visible || !chart || !candle) {
      return;
    }

    const result = calculate();

    if (!result) return;

    const a = coordinateForAnchor(result.anchors.a);
    const b = coordinateForAnchor(result.anchors.b);

    if (!a || !b) return;

    const left = Math.max(
      0,
      Math.min(a.x, b.x)
    );

    const right = Math.min(
      width,
      Math.max(a.x, b.x)
    );

    if (right <= left) return;

    ctx.save();

    ctx.beginPath();
    ctx.rect(0, 0, width, height);
    ctx.clip();

    ctx.lineWidth = Math.max(
      1,
      Math.min(5, Number(settings.lineWidth) || 1)
    );

    // Únicamente niveles Fibonacci.
    // No se dibuja ninguna caja verde.
    for (const level of result.levels) {
      let y = null;

      try {
        y = candle.priceToCoordinate(level.price);
      } catch (_) {}

      if (
        !Number.isFinite(y) ||
        y < -20 ||
        y > height + 20
      ) {
        continue;
      }

      const color = validColor(
        level.color,
        settings.color
      );

      ctx.strokeStyle = color;
      ctx.beginPath();
      ctx.moveTo(left, y);
      ctx.lineTo(right, y);
      ctx.stroke();

      if (settings.showLabels) {
        const label =
          formatLevel(level.value) +
          " · " +
          formatPrice(level.price);

        ctx.font = "11px system-ui";

        const textWidth =
          ctx.measureText(label).width;

        const x = Math.max(
          4,
          Math.min(
            width - textWidth - 5,
            right - textWidth - 5
          )
        );

        ctx.fillStyle = "rgba(8,9,12,.92)";

        ctx.fillRect(
          x - 2,
          y - 14,
          textWidth + 5,
          15
        );

        ctx.fillStyle = color;
        ctx.fillText(label, x, y - 3);
      }
    }

    // Directriz entre anclas.
    ctx.strokeStyle = "#e4eaff";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 4]);

    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();

    ctx.setLineDash([]);

    // Extremos ajustables.
    for (const point of [a, b]) {
      ctx.beginPath();
      ctx.arc(
        point.x,
        point.y,
        7,
        0,
        Math.PI * 2
      );

      ctx.fillStyle = "#171327";
      ctx.fill();

      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    if (first) {
      const point = coordinateForAnchor(first);

      if (point) {
        ctx.beginPath();
        ctx.arc(
          point.x,
          point.y,
          7,
          0,
          Math.PI * 2
        );

        ctx.fillStyle = DEFAULT_COLOR;
        ctx.fill();
      }
    }

    ctx.restore();
  }

  function pointerPoint(event) {
    if (!canvas || !chart || !candle) {
      return null;
    }

    const rect = canvas.getBoundingClientRect();

    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    let logical = null;
    let price = null;

    try {
      logical = chart.timeScale()
        .coordinateToLogical(x);

      price = candle.coordinateToPrice(y);
    } catch (_) {
      return null;
    }

    if (
      !Number.isFinite(logical) ||
      !Number.isFinite(price) ||
      price <= 0
    ) {
      return null;
    }

    return {
      x,
      y,
      logical,
      price
    };
  }

  function status(message) {
    const target = $("fibStatus");

    if (target) {
      target.textContent = message;
    }
  }

  function begin(event) {
    if (
      !drawing ||
      !chart ||
      !candle ||
      !canvas
    ) {
      return;
    }

    if (
      event.pointerType === "mouse" &&
      event.button !== 0
    ) {
      return;
    }

    const point = pointerPoint(event);

    if (!point) return;

    dragging = null;

    const existing = active();

    if (existing) {
      for (const key of ["a", "b"]) {
        const handle = coordinateForAnchor(
          existing[key]
        );

        if (
          handle &&
          Math.hypot(
            point.x - handle.x,
            point.y - handle.y
          ) <= 26
        ) {
          dragging = key;
          break;
        }
      }
    }

    if (dragging) {
      pointerId = event.pointerId;

      try {
        canvas.setPointerCapture(pointerId);
      } catch (_) {}

      status("Moviendo extremo del Fibonacci...");
    } else {
      const anchor = anchorFromPoint(point);

      if (!anchor) return;

      if (!first) {
        first = anchor;

        status(
          "Primer punto colocado. Selecciona el segundo extremo."
        );
      } else {
        saveDrawing({
          a: first,
          b: anchor
        });

        first = null;

        status(
          "Fibonacci guardado. Puedes ajustar sus extremos."
        );
      }
    }

    event.preventDefault();
    redraw();
  }

  function move(event) {
    if (!drawing || !dragging) return;

    if (
      pointerId !== null &&
      event.pointerId !== pointerId
    ) {
      return;
    }

    const point = pointerPoint(event);

    if (!point) return;

    const existing = active();

    if (!existing) return;

    const anchor = anchorFromPoint(point);

    if (!anchor) return;

    existing[dragging] = anchor;

    drawings[currentKey()] = existing;

    redraw();
    event.preventDefault();
  }

  function end(event) {
    if (
      pointerId !== null &&
      event &&
      event.pointerId !== pointerId
    ) {
      return;
    }

    if (dragging) {
      persist();
    }

    dragging = null;

    if (
      canvas &&
      pointerId !== null
    ) {
      try {
        if (canvas.hasPointerCapture(pointerId)) {
          canvas.releasePointerCapture(pointerId);
        }
      } catch (_) {}
    }

    pointerId = null;
  }

  function setDrawingMode(enabled) {
    drawing = Boolean(enabled);

    first = null;
    end();

    if (canvas) {
      canvas.style.pointerEvents = drawing
        ? "auto"
        : "none";

      canvas.style.touchAction = drawing
        ? "none"
        : "auto";
    }

    const button = $("fibDraw");

    if (button) {
      button.textContent = drawing
        ? "✓ Terminar dibujo"
        : "✏️ Dibujar / mover";

      button.setAttribute(
        "aria-pressed",
        String(drawing)
      );
    }

    status(
      drawing
        ? "Selecciona dos velas. Arrastra los extremos para ajustar."
        : "Dibujo desactivado. La gráfica vuelve a estar libre."
    );

    redraw();
  }

  function toggleDraw() {
    setDrawingMode(!drawing);
  }

  function makeButton(
    label,
    id,
    parent,
    callback
  ) {
    const button = document.createElement("button");

    button.type = "button";
    button.id = id;
    button.textContent = label;

    button.style.cssText = [
      "background:#292039",
      "color:#f2e5ff",
      "border:1px solid #68448c",
      "border-radius:8px",
      "padding:9px 10px",
      "font:inherit",
      "cursor:pointer"
    ].join(";");

    button.addEventListener(
      "click",
      callback
    );

    parent.appendChild(button);

    return button;
  }

  function addCheckbox(
    parent,
    label,
    key
  ) {
    const line = document.createElement("label");

    line.style.cssText = [
      "display:flex",
      "gap:8px",
      "align-items:center",
      "margin:9px 0"
    ].join(";");

    const input = document.createElement("input");

    input.type = "checkbox";
    input.checked = Boolean(settings[key]);

    input.addEventListener("change", () => {
      settings[key] = input.checked;

      persist();
      redraw();
    });

    line.append(
      input,
      document.createTextNode(label)
    );

    parent.appendChild(line);
  }

  function addNumber(
    parent,
    label,
    key
  ) {
    const line = document.createElement("label");

    line.style.cssText = [
      "display:flex",
      "justify-content:space-between",
      "gap:8px",
      "align-items:center",
      "margin:9px 0"
    ].join(";");

    const input = document.createElement("input");

    input.type = "number";
    input.min = "1";
    input.max = "5";
    input.step = "1";
    input.value = settings[key];

    input.style.cssText = [
      "width:90px",
      "padding:8px",
      "background:#202332",
      "border:1px solid #45405b",
      "border-radius:7px",
      "color:#fff"
    ].join(";");

    input.addEventListener("change", () => {
      const n = finite(input.value);

      if (n !== null) {
        settings[key] = Math.max(
          1,
          Math.min(5, n)
        );

        input.value = settings[key];

        persist();
        redraw();
      }
    });

    line.append(
      document.createTextNode(label),
      input
    );

    parent.appendChild(line);
  }

  function renderLevels() {
    const host = $("fibLevels");

    if (!host) return;

    host.replaceChildren();

    for (const level of settings.levels) {
      const row = document.createElement("div");

      row.style.cssText = [
        "display:flex",
        "gap:7px",
        "align-items:center",
        "margin:7px 0"
      ].join(";");

      const check = document.createElement("input");

      check.type = "checkbox";
      check.checked = Boolean(level.visible);

      check.addEventListener("change", () => {
        level.visible = check.checked;

        persist();
        redraw();
      });

      const input = document.createElement("input");

      input.type = "number";
      input.step = "any";
      input.value = level.value;

      input.style.cssText = [
        "width:85px",
        "min-width:0",
        "padding:7px",
        "border:1px solid #45405b",
        "border-radius:6px",
        "background:#202332",
        "color:#fff"
      ].join(";");

      input.addEventListener("change", () => {
        const n = finite(input.value);

        if (
          n === null ||
          n < -20 ||
          n > 20
        ) {
          input.value = level.value;
          return;
        }

        level.value = n;

        settings.levels.sort(
          (a, b) => a.value - b.value
        );

        persist();
        renderLevels();
        redraw();
      });

      const color = document.createElement("input");

      color.type = "color";
      color.value = validColor(
        level.color,
        settings.color
      );

      color.style.cssText = [
        "width:37px",
        "height:35px",
        "padding:2px",
        "border:0",
        "background:transparent"
      ].join(";");

      color.addEventListener("input", () => {
        level.color = color.value;

        persist();
        redraw();
      });

      const remove = document.createElement("button");

      remove.type = "button";
      remove.textContent = "✕";

      remove.style.cssText = [
        "padding:7px 10px",
        "border:1px solid #573748",
        "border-radius:6px",
        "background:#34202d",
        "color:#ff9aa9"
      ].join(";");

      remove.addEventListener("click", () => {
        settings.levels = settings.levels.filter(
          item => item !== level
        );

        persist();
        renderLevels();
        redraw();
      });

      row.append(
        check,
        input,
        color,
        remove
      );

      host.appendChild(row);
    }
  }

  function buildUI() {
    if (initialized) return;

    const area = $("priceChartArea");
    const host = $("clFibonacciHost") ||
      $("chartSection");

    if (!area || !host) return;

    initialized = true;

    area.style.position = "relative";

    canvas = $("fibonacciCanvas") ||
      document.createElement("canvas");

    canvas.id = "fibonacciCanvas";

    canvas.style.cssText = [
      "position:absolute",
      "inset:0",
      "width:100%",
      "height:100%",
      "z-index:50",
      "pointer-events:none",
      "touch-action:auto"
    ].join(";");

    if (!canvas.parentElement) {
      area.appendChild(canvas);
    }

    canvas.addEventListener(
      "pointerdown",
      begin
    );

    canvas.addEventListener(
      "pointermove",
      move
    );

    canvas.addEventListener(
      "pointerup",
      end
    );

    canvas.addEventListener(
      "pointercancel",
      end
    );

    const toolbar = document.createElement("div");

    toolbar.id = "fibToolbar";

    toolbar.style.cssText = [
      "display:flex",
      "flex-wrap:wrap",
      "gap:7px",
      "margin:10px 0",
      "font:12px system-ui"
    ].join(";");

    makeButton(
      "✏️ Dibujar / mover",
      "fibDraw",
      toolbar,
      toggleDraw
    );

    makeButton(
      "⚙️ Niveles",
      "fibSettingsButton",
      toolbar,
      () => {
        panel.hidden = !panel.hidden;

        if (!panel.hidden) {
          renderLevels();
        }
      }
    );

    makeButton(
      "👁 Mostrar / ocultar",
      "fibVisible",
      toolbar,
      () => {
        settings.visible = !settings.visible;

        persist();
        redraw();
      }
    );

    makeButton(
      "🗑 Borrar trazado",
      "fibErase",
      toolbar,
      () => {
        delete drawings[currentKey()];
        first = null;

        persist();
        redraw();

        status(
          "Fibonacci eliminado de este activo y temporalidad."
        );
      }
    );

    const info = document.createElement("span");

    info.id = "fibStatus";

    info.style.cssText = [
      "width:100%",
      "color:#b9a5d1",
      "line-height:1.5"
    ].join(";");

    info.textContent =
      "Pulsa Dibujar / mover para colocar Fibonacci.";

    toolbar.appendChild(info);

    panel = document.createElement("div");

    panel.id = "fibPanel";
    panel.hidden = true;

    panel.style.cssText = [
      "background:#171323",
      "color:#f2e5ff",
      "border:1px solid #5c4177",
      "border-radius:12px",
      "padding:12px",
      "margin:8px 0",
      "font:13px system-ui"
    ].join(";");

    const heading = document.createElement("strong");

    heading.textContent =
      "Fibonacci V8 · Configuración";

    panel.appendChild(heading);

    addCheckbox(
      panel,
      "Mostrar etiquetas",
      "showLabels"
    );

    addCheckbox(
      panel,
      "Invertir dirección",
      "reverse"
    );

    addNumber(
      panel,
      "Grosor de línea",
      "lineWidth"
    );

    const levels = document.createElement("div");

    levels.id = "fibLevels";
    levels.style.marginTop = "13px";

    panel.appendChild(levels);

    makeButton(
      "+ Agregar nivel",
      "fibAdd",
      panel,
      () => {
        settings.levels.push({
          value: 1.414,
          visible: true,
          color: settings.color
        });

        settings.levels.sort(
          (a, b) => a.value - b.value
        );

        persist();
        renderLevels();
        redraw();
      }
    );

    makeButton(
      "Restablecer niveles",
      "fibReset",
      panel,
      () => {
        settings = defaults();

        persist();
        renderLevels();
        redraw();
      }
    );

    host.appendChild(toolbar);
    host.appendChild(panel);

    if (window.ResizeObserver) {
      new ResizeObserver(redraw).observe(area);
    }

    window.addEventListener(
      "resize",
      redraw
    );

    for (const id of [
      "symbol",
      "interval",
      "market",
      "exchange"
    ]) {
      $(id)?.addEventListener("change", () => {
        first = null;
        end();

        // Al cambiar el activo, desactivar la
        // edición para no bloquear la gráfica.
        setDrawingMode(false);

        status(
          "Mercado cambiado. Se cargará su Fibonacci guardado."
        );

        redraw();
      });
    }

    renderLevels();
    redraw();
  }

  function attach(
    newChart,
    newCandle,
    options = {}
  ) {
    if (!newChart || !newCandle) return;

    if (
      subscribedChart &&
      subscribedChart !== newChart
    ) {
      try {
        subscribedChart.timeScale()
          .unsubscribeVisibleLogicalRangeChange(redraw);
      } catch (_) {}
    }

    chart = newChart;
    candle = newCandle;

    if (typeof options.getRows === "function") {
      getRows = options.getRows;
    }

    if (
      typeof options.getSelection === "function"
    ) {
      getSelection = options.getSelection;
    }

    if (subscribedChart !== newChart) {
      try {
        chart.timeScale()
          .subscribeVisibleLogicalRangeChange(redraw);

        subscribedChart = newChart;
      } catch (error) {
        console.warn(
          "Fibonacci: no se pudo suscribir al gráfico",
          error
        );
      }
    }

    if (document.readyState === "loading") {
      document.addEventListener(
        "DOMContentLoaded",
        buildUI,
        { once: true }
      );
    } else {
      buildUI();
    }

    redraw();
  }

  function attachFromGlobal() {
    const api = window.CryptolexuzChart;

    if (!api) return false;

    const nextChart =
      api.chart ||
      api.chartApi ||
      window.chartApi;

    const nextCandle =
      api.candle ||
      api.candleSeries;

    if (!nextChart || !nextCandle) {
      return false;
    }

    attach(nextChart, nextCandle, {
      getRows:
        typeof api.getRows === "function"
          ? api.getRows
          : typeof api.getCandles === "function"
            ? api.getCandles
            : undefined,

      getSelection:
        typeof api.getSelection === "function"
          ? api.getSelection
          : undefined
    });

    return true;
  }

  function resetSettings() {
    settings = defaults();

    persist();
    renderLevels();
    redraw();
  }

  function setLevel(value, changes = {}) {
    const number = finite(value);

    if (
      number === null ||
      number < -20 ||
      number > 20
    ) {
      return;
    }

    let level = settings.levels.find(
      item => Number(item.value) === number
    );

    if (level) {
      Object.assign(level, changes);

      level.color = validColor(
        level.color,
        settings.color
      );
    } else {
      settings.levels.push({
        value: number,
        visible: true,
        color: settings.color,
        ...changes
      });
    }

    settings.levels.sort(
      (a, b) => a.value - b.value
    );

    persist();
    renderLevels();
    redraw();
  }

  function removeLevel(value) {
    settings.levels = settings.levels.filter(
      item =>
        Number(item.value) !== Number(value)
    );

    persist();
    renderLevels();
    redraw();
  }

  function clearDrawing() {
    delete drawings[currentKey()];

    first = null;

    persist();
    redraw();
  }

  load();

  window.CryptolexuzFibonacci = {
    version: "8",

    attach,
    redraw,
    calculate,
    priceAt,

    getSettings: () => clone(settings),

    updateSettings: changes => {
      settings = normalizeSettings({
        ...settings,
        ...changes
      });

      persist();
      renderLevels();
      redraw();
    },

    reset: resetSettings,
    setLevel,
    removeLevel,

    getDrawing: () => clone(active()),
    clearDrawing,

    startDrawing: () => setDrawingMode(true),
    stopDrawing: () => setDrawingMode(false),

    isDrawing: () => drawing
  };

  window.addEventListener(
    "cryptolexuz:chart-ready",
    event => {
      const detail = event.detail || {};

      attach(
        detail.chart || detail.chartApi,
        detail.candle || detail.candleSeries,
        {
          getRows: detail.getRows,
          getSelection: detail.getSelection
        }
      );

      if (
        typeof detail.getRows !== "function" ||
        typeof detail.getSelection !== "function"
      ) {
        attachFromGlobal();
      }
    }
  );

  window.addEventListener(
    "cryptolexuz:candles-updated",
    event => {
      const detail = event.detail || {};

      if (Array.isArray(detail.rows)) {
        getRows = () => detail.rows;
      }

      redraw();
    }
  );

  window.addEventListener(
    "cryptolexuz:screen-change",
    event => {
      if (event.detail?.screen === "charts") {
        requestAnimationFrame(redraw);
      }
    }
  );

  if (document.readyState === "loading") {
    document.addEventListener(
      "DOMContentLoaded",
      () => {
        buildUI();
        attachFromGlobal();
      },
      { once: true }
    );
  } else {
    buildUI();
    attachFromGlobal();
  }

  console.info(
    "CRYPTOLEXUZ PRO — Fibonacci V8 cargado"
  );
})();
