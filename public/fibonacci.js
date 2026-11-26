
/*
 CRYPTOLEXUZ PRO — FIBONACCI.JS V9 COMPLETO

 Compatible con:
 - Lightweight Charts 4.2.2
 - APP.JS V24
 - STYLES.CSS V25
 - INDEX.HTML V32

 Correcciones:
 - Primer punto visible al dibujar.
 - Dibujo táctil y arrastre de anclas.
 - Captura y liberación segura del puntero.
 - Persistencia por mercado, activo y temporalidad.
 - Migración de datos V8, V7 y V2.
 - Actualización al cambiar velas y temporalidades.
 - Desplazamiento vertical libre al desactivar dibujo.
 - Sin caja verde BitLobo.
 - Niveles configurables.
 - No duplica barras de herramientas.
*/

"use strict";

(() => {
  if (window.CryptolexuzFibonacci?.version === "9") {
    return;
  }

  const $ = id => document.getElementById(id);

  const STORE = "cryptolexuz_fibonacci_v9";

  const OLD_STORES = [
    "cryptolexuz_fibonacci_v8",
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

  const HIGHLIGHT = new Set([
    0.618, 0.786, 0.88, 1.618
  ]);

  const PURPLE = "#bb52ff";
  const ORANGE = "#ffb347";

  const MIN_LEVEL = -20;
  const MAX_LEVEL = 20;
  const MAX_LEVELS = 80;

  function defaults() {
    return {
      visible: true,
      showLabels: true,
      reverse: false,
      lineWidth: 1,
      color: PURPLE,
      showBox: false,
      levels: BASE_LEVELS.map(value => ({
        value,
        visible: true,
        color: HIGHLIGHT.has(value)
          ? ORANGE
          : PURPLE
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
  let dragKey = null;

  let raf = 0;
  let initialized = false;
  let subscribedChart = null;
  let resizeObserver = null;

  function clone(value) {
    if (value === undefined) return null;

    try {
      return JSON.parse(JSON.stringify(value));
    } catch {
      return null;
    }
  }

  function finite(value) {
    if (
      value === null ||
      value === undefined ||
      value === ""
    ) {
      return null;
    }

    const number = Number(value);

    return Number.isFinite(number)
      ? number
      : null;
  }

  function validColor(
    value,
    fallback = PURPLE
  ) {
    return /^#[0-9a-f]{6}$/i.test(
      String(value)
    )
      ? value
      : fallback;
  }

  function normalizeLevel(item) {
    const value = finite(item?.value);

    if (
      value === null ||
      value < MIN_LEVEL ||
      value > MAX_LEVEL
    ) {
      return null;
    }

    return {
      value,
      visible: item.visible !== false,
      color: validColor(
        item.color,
        HIGHLIGHT.has(value)
          ? ORANGE
          : PURPLE
      )
    };
  }

  function normalizeSettings(source) {
    const base = defaults();

    if (
      !source ||
      typeof source !== "object"
    ) {
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
        Math.min(
          5,
          finite(source.lineWidth) ?? 1
        )
      )
    };

    if (Array.isArray(source.levels)) {
      const seen = new Set();

      result.levels = source.levels
        .map(normalizeLevel)
        .filter(level => {
          if (!level) return false;

          if (seen.has(level.value)) {
            return false;
          }

          seen.add(level.value);
          return true;
        })
        .slice(0, MAX_LEVELS)
        .sort((a, b) => a.value - b.value);
    }

    return result;
  }

  function readJSON(key) {
    try {
      return JSON.parse(
        localStorage.getItem(key) || "null"
      );
    } catch {
      return null;
    }
  }

  function load() {
    let source = readJSON(STORE);

    if (!source) {
      for (const key of OLD_STORES) {
        source = readJSON(key);

        if (source) break;
      }
    }

    settings = normalizeSettings(source);

    let saved = readJSON(
      STORE + "_drawings"
    );

    if (!saved) {
      for (const key of OLD_STORES) {
        saved = readJSON(
          key + "_drawings"
        );

        if (saved) break;
      }
    }

    if (
      saved &&
      typeof saved === "object" &&
      !Array.isArray(saved)
    ) {
      drawings = saved;
    }

    persist();
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
        "Fibonacci: no se pudo guardar",
        error
      );
    }
  }

  function selection() {
    let selected = null;

    if (
      typeof getSelection === "function"
    ) {
      try {
        selected = getSelection();
      } catch (_) {}
    }

    selected =
      selected &&
      typeof selected === "object"
        ? selected
        : {};

    const symbol = String(
      selected.symbol ||
      $("symbol")?.value ||
      "BTC-USDT"
    );

    const commodity = /^NCCO/i.test(
      symbol
    );

    return {
      exchange: commodity
        ? "bingx"
        : String(
            selected.exchange ||
            $("exchange")?.value ||
            "bingx"
          ),

      market: commodity
        ? "perpetual"
        : String(
            selected.market ||
            $("market")?.value ||
            "perpetual"
          ),

      symbol,

      tf: String(
        selected.tf ||
        selected.interval ||
        $("interval")?.value ||
        "15m"
      )
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
      const data = getRows();

      return Array.isArray(data)
        ? data
        : [];
    } catch {
      return [];
    }
  }

  function timeNumber(value) {
    if (typeof value === "number") {
      if (!Number.isFinite(value)) {
        return null;
      }

      return value > 1e11
        ? Math.floor(value / 1000)
        : value;
    }

    if (typeof value === "string") {
      const numeric = Number(value);

      if (Number.isFinite(numeric)) {
        return timeNumber(numeric);
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

    return (
      x !== null &&
      y !== null &&
      x === y
    );
  }

  function timeIndex(time) {
    return rows().findIndex(
      item => sameTime(
        item.time,
        time
      )
    );
  }

  function nearestIndex(logical) {
    const data = rows();

    if (
      !data.length ||
      !Number.isFinite(logical)
    ) {
      return -1;
    }

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
    const index = nearestIndex(
      point.logical
    );

    if (
      index < 0 ||
      !data[index] ||
      !Number.isFinite(point.price) ||
      point.price <= 0
    ) {
      return null;
    }

    return {
      time: data[index].time,
      price: point.price
    };
  }

  function migrateAnchor(anchor) {
    if (
      !anchor ||
      typeof anchor !== "object"
    ) {
      return null;
    }

    const price = finite(anchor.price);

    if (
      price === null ||
      price <= 0
    ) {
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

    const logical = finite(
      anchor.logical
    );

    if (logical !== null) {
      const index = nearestIndex(
        logical
      );

      const data = rows();

      if (
        index >= 0 &&
        data[index]
      ) {
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
    if (
      !value?.a ||
      !value?.b
    ) {
      return;
    }

    drawings[currentKey()] = {
      a: clone(value.a),
      b: clone(value.b)
    };

    persist();
    redraw();
  }

  function priceAt(start, end, ratio) {
    return start +
      (end - start) * ratio;
  }

  function calculate() {
    const saved = active();

    if (!saved) return null;

    const start = settings.reverse
      ? saved.b.price
      : saved.a.price;

    const end = settings.reverse
      ? saved.a.price
      : saved.b.price;

    return {
      anchors: saved,

      levels: settings.levels
        .filter(level => level.visible)
        .map(level => ({
          ...level,
          price: priceAt(
            start,
            end,
            level.value
          )
        })),

      box: null
    };
  }

  function coordinateForTime(time) {
    if (!chart) return null;

    const scale = chart.timeScale();

    try {
      const x = scale.timeToCoordinate(
        time
      );

      if (Number.isFinite(x)) {
        return x;
      }
    } catch (_) {}

    const index = timeIndex(time);

    if (index < 0) return null;

    try {
      const x = scale.logicalToCoordinate(
        index
      );

      return Number.isFinite(x)
        ? x
        : null;
    } catch {
      return null;
    }
  }

  function coordinateForAnchor(anchor) {
    if (
      !anchor ||
      !chart ||
      !candle
    ) {
      return null;
    }

    const x = coordinateForTime(
      anchor.time
    );

    let y = null;

    try {
      y = candle.priceToCoordinate(
        anchor.price
      );
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
    const number = Number(value);

    if (!Number.isFinite(number)) {
      return "—";
    }

    return number.toLocaleString(
      "en-US",
      {
        maximumFractionDigits:
          Math.abs(number) < 1
            ? 8
            : 6
      }
    );
  }

  function drawHandle(ctx, point, color) {
    if (!point) return;

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

    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  function paint() {
    if (!canvas) return;

    const rect =
      canvas.getBoundingClientRect();

    const width = rect.width;
    const height = rect.height;

    if (
      width <= 0 ||
      height <= 0
    ) {
      return;
    }

    const ratio = Math.min(
      window.devicePixelRatio || 1,
      2
    );

    const pixelWidth = Math.round(
      width * ratio
    );

    const pixelHeight = Math.round(
      height * ratio
    );

    if (
      canvas.width !== pixelWidth ||
      canvas.height !== pixelHeight
    ) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
    }

    const ctx = canvas.getContext("2d");

    if (!ctx) return;

    ctx.setTransform(
      ratio, 0, 0, ratio, 0, 0
    );

    ctx.clearRect(
      0, 0, width, height
    );

    if (
      !chart ||
      !candle
    ) {
      return;
    }

    ctx.save();

    ctx.beginPath();
    ctx.rect(0, 0, width, height);
    ctx.clip();

    const result = settings.visible
      ? calculate()
      : null;

    if (result) {
      const a = coordinateForAnchor(
        result.anchors.a
      );

      const b = coordinateForAnchor(
        result.anchors.b
      );

      if (a && b) {
        const left = Math.max(
          0,
          Math.min(a.x, b.x)
        );

        const right = Math.min(
          width,
          Math.max(a.x, b.x)
        );

        if (right > left) {
          ctx.lineWidth = Math.max(
            1,
            Math.min(
              5,
              Number(settings.lineWidth) || 1
            )
          );

          for (const level of result.levels) {
            let y = null;

            try {
              y = candle.priceToCoordinate(
                level.price
              );
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

              ctx.fillStyle =
                "rgba(8,9,12,.92)";

              ctx.fillRect(
                x - 2,
                y - 14,
                textWidth + 5,
                15
              );

              ctx.fillStyle = color;

              ctx.fillText(
                label,
                x,
                y - 3
              );
            }
          }
        }

        ctx.strokeStyle = "#e4eaff";
        ctx.lineWidth = 1.5;
        ctx.setLineDash([5, 4]);

        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();

        ctx.setLineDash([]);

        drawHandle(
          ctx,
          a,
          "#ffffff"
        );

        drawHandle(
          ctx,
          b,
          "#ffffff"
        );
      }
    }

    /*
     Corrección V9:
     El primer punto se muestra incluso
     cuando todavía no existe el segundo.
    */

    if (
      first &&
      drawing
    ) {
      const point = coordinateForAnchor(
        first
      );

      if (point) {
        drawHandle(
          ctx,
          point,
          ORANGE
        );
      }
    }

    ctx.restore();
  }

  function pointerPoint(event) {
    if (
      !canvas ||
      !chart ||
      !candle
    ) {
      return null;
    }

    const rect =
      canvas.getBoundingClientRect();

    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    let logical = null;
    let price = null;

    try {
      logical = chart.timeScale()
        .coordinateToLogical(x);

      price = candle.coordinateToPrice(y);
    } catch {
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
    const element = $("fibStatus");

    if (element) {
      element.textContent = message;
    }
  }

  function capturePointer(event) {
    pointerId = event.pointerId;

    try {
      canvas?.setPointerCapture(
        pointerId
      );
    } catch (_) {}
  }

  function releasePointer() {
    if (
      canvas &&
      pointerId !== null
    ) {
      try {
        if (
          canvas.hasPointerCapture(
            pointerId
          )
        ) {
          canvas.releasePointerCapture(
            pointerId
          );
        }
      } catch (_) {}
    }

    pointerId = null;
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
      pointerId !== null ||
      event.isPrimary === false
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

    const saved = active();

    dragging = null;
    dragKey = null;

    if (saved) {
      for (const key of ["a", "b"]) {
        const handle = coordinateForAnchor(
          saved[key]
        );

        if (
          handle &&
          Math.hypot(
            point.x - handle.x,
            point.y - handle.y
          ) <= 26
        ) {
          dragging = key;
          dragKey = currentKey();
          break;
        }
      }
    }

    if (dragging) {
      capturePointer(event);

      status(
        "Moviendo extremo del Fibonacci..."
      );
    } else {
      const anchor = anchorFromPoint(
        point
      );

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
          "Fibonacci guardado. Arrastra los extremos para ajustarlo."
        );
      }
    }

    event.preventDefault();
    redraw();
  }

  function move(event) {
    if (
      !drawing ||
      !dragging ||
      pointerId === null ||
      event.pointerId !== pointerId
    ) {
      return;
    }

    if (
      dragKey !== currentKey()
    ) {
      end();
      return;
    }

    const point = pointerPoint(event);

    if (!point) return;

    const saved = active();

    if (!saved) return;

    const anchor = anchorFromPoint(
      point
    );

    if (!anchor) return;

    saved[dragging] = anchor;

    drawings[currentKey()] = saved;

    redraw();
    event.preventDefault();
  }

  function end(event) {
    if (
      event &&
      pointerId !== null &&
      event.pointerId !== pointerId
    ) {
      return;
    }

    if (dragging) {
      persist();
    }

    dragging = null;
    dragKey = null;

    releasePointer();
    redraw();
  }

  function setDrawingMode(enabled) {
    drawing = Boolean(enabled);

    first = null;
    end();

    if (canvas) {
      canvas.style.setProperty(
        "pointer-events",
        drawing ? "auto" : "none",
        "important"
      );

      canvas.style.setProperty(
        "touch-action",
        drawing ? "none" : "pan-y",
        "important"
      );
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

      button.classList.toggle(
        "active",
        drawing
      );
    }

    status(
      drawing
        ? "Selecciona dos velas. Arrastra los extremos para ajustar."
        : "Dibujo desactivado. La gráfica está libre."
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
    let button = $(id);

    if (button) return button;

    button = document.createElement(
      "button"
    );

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
      "cursor:pointer",
      "touch-action:manipulation"
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
    const line = document.createElement(
      "label"
    );

    line.style.cssText = [
      "display:flex",
      "gap:8px",
      "align-items:center",
      "margin:9px 0"
    ].join(";");

    const input = document.createElement(
      "input"
    );

    input.type = "checkbox";
    input.checked = Boolean(
      settings[key]
    );

    input.addEventListener(
      "change",
      () => {
        settings[key] = input.checked;

        persist();
        redraw();
      }
    );

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
    const line = document.createElement(
      "label"
    );

    line.style.cssText = [
      "display:flex",
      "justify-content:space-between",
      "gap:8px",
      "align-items:center",
      "margin:9px 0"
    ].join(";");

    const input = document.createElement(
      "input"
    );

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

    input.addEventListener(
      "change",
      () => {
        const number = finite(
          input.value
        );

        if (number === null) {
          input.value = settings[key];
          return;
        }

        settings[key] = Math.max(
          1,
          Math.min(5, number)
        );

        input.value = settings[key];

        persist();
        redraw();
      }
    );

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
      const row = document.createElement(
        "div"
      );

      row.style.cssText = [
        "display:flex",
        "gap:7px",
        "align-items:center",
        "margin:7px 0"
      ].join(";");

      const check = document.createElement(
        "input"
      );

      check.type = "checkbox";
      check.checked = level.visible;

      check.addEventListener(
        "change",
        () => {
          level.visible = check.checked;

          persist();
          redraw();
        }
      );

      const input = document.createElement(
        "input"
      );

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

      input.addEventListener(
        "change",
        () => {
          const number = finite(
            input.value
          );

          if (
            number === null ||
            number < MIN_LEVEL ||
            number > MAX_LEVEL
          ) {
            input.value = level.value;
            return;
          }

          const duplicate =
            settings.levels.some(
              item =>
                item !== level &&
                item.value === number
            );

          if (duplicate) {
            input.value = level.value;
            return;
          }

          level.value = number;

          settings.levels.sort(
            (a, b) => a.value - b.value
          );

          persist();
          renderLevels();
          redraw();
        }
      );

      const color = document.createElement(
        "input"
      );

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

      color.addEventListener(
        "input",
        () => {
          level.color = color.value;

          persist();
          redraw();
        }
      );

      const remove = document.createElement(
        "button"
      );

      remove.type = "button";
      remove.textContent = "✕";

      remove.style.cssText = [
        "padding:7px 10px",
        "border:1px solid #573748",
        "border-radius:6px",
        "background:#34202d",
        "color:#ff9aa9"
      ].join(";");

      remove.addEventListener(
        "click",
        () => {
          settings.levels =
            settings.levels.filter(
              item => item !== level
            );

          persist();
          renderLevels();
          redraw();
        }
      );

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

    const host =
      $("clFibonacciHost") ||
      $("chartSection");

    if (!area || !host) {
      return;
    }

    initialized = true;

    area.style.position = "relative";

    canvas =
      $("fibonacciCanvas") ||
      document.createElement("canvas");

    canvas.id = "fibonacciCanvas";

    canvas.style.cssText = [
      "position:absolute",
      "inset:0",
      "width:100%",
      "height:100%",
      "z-index:50",
      "pointer-events:none!important",
      "touch-action:pan-y!important"
    ].join(";");

    if (canvas.parentElement !== area) {
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

    canvas.addEventListener(
      "lostpointercapture",
      end
    );

    let toolbar = $("fibToolbar");

    if (!toolbar) {
      toolbar = document.createElement(
        "div"
      );

      toolbar.id = "fibToolbar";

      toolbar.style.cssText = [
        "display:flex",
        "flex-wrap:wrap",
        "gap:7px",
        "margin:10px 0",
        "font:12px system-ui"
      ].join(";");

      host.appendChild(toolbar);
    }

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
        if (!panel) return;

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
        settings.visible =
          !settings.visible;

        persist();
        redraw();
      }
    );

    makeButton(
      "🗑 Borrar trazado",
      "fibErase",
      toolbar,
      () => {
        clearDrawing();

        status(
          "Fibonacci eliminado de este activo y temporalidad."
        );
      }
    );

    let info = $("fibStatus");

    if (!info) {
      info = document.createElement(
        "span"
      );

      info.id = "fibStatus";

      info.style.cssText = [
        "width:100%",
        "color:#b9a5d1",
        "line-height:1.5"
      ].join(";");

      info.textContent =
        "Pulsa Dibujar / mover para colocar Fibonacci.";

      toolbar.appendChild(info);
    }

    panel = $("fibPanel");

    if (!panel) {
      panel = document.createElement(
        "div"
      );

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

      const heading =
        document.createElement("strong");

      heading.textContent =
        "Fibonacci V9 · Configuración";

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

      const levels =
        document.createElement("div");

      levels.id = "fibLevels";
      levels.style.marginTop = "13px";

      panel.appendChild(levels);

      makeButton(
        "+ Agregar nivel",
        "fibAdd",
        panel,
        () => {
          if (
            settings.levels.length >=
            MAX_LEVELS
          ) {
            status(
              "Se alcanzó el máximo de niveles."
            );
            return;
          }

          let value = 1.414;

          while (
            settings.levels.some(
              item => item.value === value
            )
          ) {
            value = Number(
              (value + 0.001).toFixed(4)
            );
          }

          settings.levels.push({
            value,
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
        resetSettings
      );

      host.appendChild(panel);
    }

    if (window.ResizeObserver) {
      resizeObserver = new ResizeObserver(
        redraw
      );

      resizeObserver.observe(area);
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
      $(id)?.addEventListener(
        "change",
        () => {
          first = null;

          setDrawingMode(false);

          status(
            "Mercado cambiado. Se cargará su Fibonacci guardado."
          );

          redraw();
        }
      );
    }

    renderLevels();
    setDrawingMode(false);
    redraw();
  }

  function attach(
    newChart,
    newCandle,
    options = {}
  ) {
    if (
      !newChart ||
      !newCandle
    ) {
      return;
    }

    if (
      subscribedChart &&
      subscribedChart !== newChart
    ) {
      try {
        subscribedChart.timeScale()
          .unsubscribeVisibleLogicalRangeChange(
            redraw
          );
      } catch (_) {}

      subscribedChart = null;
    }

    chart = newChart;
    candle = newCandle;

    if (
      typeof options.getRows ===
      "function"
    ) {
      getRows = options.getRows;
    }

    if (
      typeof options.getSelection ===
      "function"
    ) {
      getSelection = options.getSelection;
    }

    if (subscribedChart !== newChart) {
      try {
        chart.timeScale()
          .subscribeVisibleLogicalRangeChange(
            redraw
          );

        subscribedChart = newChart;
      } catch (error) {
        console.warn(
          "Fibonacci: suscripción al gráfico",
          error
        );
      }
    }

    if (
      document.readyState ===
      "loading"
    ) {
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

    const newChart =
      api.chart ||
      api.chartApi ||
      window.chartApi;

    const newCandle =
      api.candle ||
      api.candleSeries;

    if (
      !newChart ||
      !newCandle
    ) {
      return false;
    }

    attach(
      newChart,
      newCandle,
      {
        getRows:
          typeof api.getRows === "function"
            ? api.getRows
            : typeof api.getCandles ===
              "function"
              ? api.getCandles
              : undefined,

        getSelection:
          typeof api.getSelection ===
          "function"
            ? api.getSelection
            : undefined
      }
    );

    return true;
  }

  function resetSettings() {
    settings = defaults();

    persist();
    renderLevels();
    redraw();
  }

  function setLevel(
    value,
    changes = {}
  ) {
    const number = finite(value);

    if (
      number === null ||
      number < MIN_LEVEL ||
      number > MAX_LEVEL
    ) {
      return false;
    }

    let level = settings.levels.find(
      item => item.value === number
    );

    if (!level) {
      if (
        settings.levels.length >=
        MAX_LEVELS
      ) {
        return false;
      }

      level = {
        value: number,
        visible: true,
        color: settings.color
      };

      settings.levels.push(level);
    }

    if (
      changes.visible !== undefined
    ) {
      level.visible = Boolean(
        changes.visible
      );
    }

    if (
      changes.color !== undefined
    ) {
      level.color = validColor(
        changes.color,
        settings.color
      );
    }

    settings.levels.sort(
      (a, b) => a.value - b.value
    );

    persist();
    renderLevels();
    redraw();

    return true;
  }

  function removeLevel(value) {
    const number = finite(value);

    if (number === null) {
      return;
    }

    settings.levels =
      settings.levels.filter(
        item => item.value !== number
      );

    persist();
    renderLevels();
    redraw();
  }

  function clearDrawing() {
    delete drawings[currentKey()];

    first = null;
    end();

    persist();
    redraw();
  }

  load();

  window.CryptolexuzFibonacci = {
    version: "9",

    attach,
    redraw,
    calculate,
    priceAt,

    getSettings: () =>
      clone(settings),

    updateSettings: changes => {
      settings = normalizeSettings({
        ...settings,
        ...changes,
        showBox: false
      });

      persist();
      renderLevels();
      redraw();
    },

    reset: resetSettings,
    setLevel,
    removeLevel,

    getDrawing: () =>
      clone(active()),

    clearDrawing,

    startDrawing: () =>
      setDrawingMode(true),

    stopDrawing: () =>
      setDrawingMode(false),

    isDrawing: () => drawing,

    getSelection: () =>
      clone(selection())
  };

  window.addEventListener(
    "cryptolexuz:chart-ready",
    event => {
      const detail =
        event.detail || {};

      const newChart =
        detail.chart ||
        detail.chartApi;

      const newCandle =
        detail.candle ||
        detail.candleSeries;

      if (
        newChart &&
        newCandle
      ) {
        attach(
          newChart,
          newCandle,
          {
            getRows: detail.getRows,
            getSelection:
              detail.getSelection
          }
        );
      } else {
        attachFromGlobal();
      }
    }
  );

  window.addEventListener(
    "cryptolexuz:candles-updated",
    event => {
      const detail =
        event.detail || {};

      if (
        Array.isArray(detail.rows)
      ) {
        getRows = () => detail.rows;
      }

      redraw();
    }
  );

  window.addEventListener(
    "cryptolexuz:screen-change",
    event => {
      const screen =
        event.detail?.screen;

      if (
        screen === "charts" ||
        screen === "graficas" ||
        screen === "chart"
      ) {
        requestAnimationFrame(
          redraw
        );
      }
    }
  );

  if (
    document.readyState ===
    "loading"
  ) {
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
    "CRYPTOLEXUZ PRO — Fibonacci V9 cargado"
  );
})();
