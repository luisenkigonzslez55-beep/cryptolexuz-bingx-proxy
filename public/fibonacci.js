
/*
 CRYPTOLEXUZ PRO — FIBONACCI V6
 Compatible con APP.JS V14
 Lightweight Charts 4.2.2

 - Navegación horizontal táctil
 - Zoom con dos dedos
 - Dibujo con dos puntos
 - Extremos arrastrables
 - Retrocesos y extensiones
 - Caja verde BitLobo
 - Niveles configurables
 - Guardado por activo y temporalidad
 - Barra de herramientas visible
*/

(function () {
  "use strict";

  if (window.__CL_FIB_V6__) return;
  window.__CL_FIB_V6__ = true;

  const $ = id => document.getElementById(id);

  const STORE = "cryptolexuz_fibonacci_v3";

  const DEFAULT_LEVELS = [
    0, 0.236, 0.382, 0.5,
    0.618, 0.65, 0.705,
    0.786, 0.88, 1,
    1.272, 1.618, 2,
    2.618, 3.618, 4.236
  ];

  const IMPORTANT = [
    0.618, 0.786, 0.88, 1.618
  ];

  const COLORS = {
    purple: "#bb52ff",
    green: "#22c55e",
    yellow: "#ffe15a",
    white: "#ffffff"
  };

  function defaults() {
    return {
      visible: true,
      labels: true,
      box: true,
      reverse: false,
      boxUpper: 0.7362,
      boxMiddle: 0.7148,
      boxLower: 0.6935,
      levels: DEFAULT_LEVELS.map(value => ({
        value,
        visible: true,
        color: IMPORTANT.includes(value)
          ? COLORS.green
          : COLORS.purple
      }))
    };
  }

  let settings = defaults();
  let drawings = {};

  let chart = null;
  let candle = null;
  let canvas = null;

  let drawingMode = false;
  let firstPoint = null;
  let dragging = null;
  let pointer = null;

  let redrawPending = false;
  let observer = null;
  let initialized = false;

  function load() {
    try {
      const saved = JSON.parse(
        localStorage.getItem(STORE) || "null"
      );

      if (saved && typeof saved === "object") {
        settings = {
          ...defaults(),
          ...saved
        };

        if (!Array.isArray(settings.levels)) {
          settings.levels = defaults().levels;
        }

        settings.levels = settings.levels
          .filter(x =>
            x &&
            Number.isFinite(Number(x.value))
          )
          .map(x => ({
            value: Number(x.value),
            visible: x.visible !== false,
            color: /^#[0-9a-f]{6}$/i.test(
              x.color || ""
            )
              ? x.color
              : COLORS.purple
          }));
      }

      const storedDrawings = JSON.parse(
        localStorage.getItem(
          STORE + "_drawings"
        ) || "{}"
      );

      if (
        storedDrawings &&
        typeof storedDrawings === "object" &&
        !Array.isArray(storedDrawings)
      ) {
        drawings = storedDrawings;
      }
    } catch (error) {
      console.warn("Fibonacci V6 load:", error);
    }
  }

  function save() {
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
      console.warn("Fibonacci V6 save:", error);
    }
  }

  function marketKey() {
    const symbol =
      $("symbol")?.value || "BTC-USDT";

    const commodity = symbol.startsWith("NCCO");

    return [
      commodity
        ? "bingx"
        : $("exchange")?.value || "bingx",
      commodity
        ? "perpetual"
        : $("market")?.value || "perpetual",
      symbol,
      $("interval")?.value || "15m"
    ].join("|");
  }

  function currentDrawing() {
    return drawings[marketKey()] || null;
  }

  function status(text, warning = false) {
    const el = $("fibStatus");

    if (!el) return;

    el.textContent = text;
    el.style.color = warning
      ? "#ff9a35"
      : "#a5b0cf";
  }

  function priceAt(a, b, ratio) {
    return a + (b - a) * ratio;
  }

  function levelsFor(d) {
    if (!d) return [];

    const start = settings.reverse
      ? d.b.price
      : d.a.price;

    const end = settings.reverse
      ? d.a.price
      : d.b.price;

    return settings.levels
      .filter(level => level.visible)
      .map(level => ({
        ...level,
        price: priceAt(
          start,
          end,
          level.value
        )
      }));
  }

  function redraw() {
    if (redrawPending) return;

    redrawPending = true;

    requestAnimationFrame(() => {
      redrawPending = false;
      paint();
    });
  }

  function position(point) {
    if (!point || !chart || !candle) {
      return null;
    }

    try {
      const x = chart.timeScale()
        .logicalToCoordinate(point.logical);

      const y = candle.priceToCoordinate(
        point.price
      );

      if (
        !Number.isFinite(x) ||
        !Number.isFinite(y)
      ) return null;

      return { x, y };
    } catch (_) {
      return null;
    }
  }

  function eventPoint(event) {
    if (!canvas || !chart || !candle) {
      return null;
    }

    const rect = canvas.getBoundingClientRect();

    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    try {
      const logical = chart.timeScale()
        .coordinateToLogical(x);

      const price = candle.coordinateToPrice(y);

      if (
        !Number.isFinite(logical) ||
        !Number.isFinite(price) ||
        price <= 0
      ) return null;

      return { x, y, logical, price };
    } catch (_) {
      return null;
    }
  }

  function drawHandle(ctx, point, color) {
    const p = position(point);

    if (!p) return;

    ctx.beginPath();
    ctx.arc(p.x, p.y, 7, 0, Math.PI * 2);

    ctx.fillStyle = "#10182d";
    ctx.fill();

    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  function paint() {
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;

    if (width <= 0 || height <= 0) return;

    const dpr = Math.min(
      window.devicePixelRatio || 1,
      2
    );

    const w = Math.round(width * dpr);
    const h = Math.round(height * dpr);

    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;

    const ctx = canvas.getContext("2d");

    if (!ctx) return;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    if (!chart || !candle) return;

    if (firstPoint && drawingMode) {
      drawHandle(
        ctx,
        firstPoint,
        COLORS.yellow
      );
    }

    const d = currentDrawing();

    if (!d || !settings.visible) return;

    const a = position(d.a);
    const b = position(d.b);

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

    const start = settings.reverse
      ? d.b.price
      : d.a.price;

    const end = settings.reverse
      ? d.a.price
      : d.b.price;

    if (settings.box) {
      const upper = priceAt(
        start,
        end,
        settings.boxUpper
      );

      const middle = priceAt(
        start,
        end,
        settings.boxMiddle
      );

      const lower = priceAt(
        start,
        end,
        settings.boxLower
      );

      const yu = candle.priceToCoordinate(upper);
      const ym = candle.priceToCoordinate(middle);
      const yl = candle.priceToCoordinate(lower);

      if (
        Number.isFinite(yu) &&
        Number.isFinite(yl)
      ) {
        ctx.fillStyle = "rgba(22,163,74,.17)";

        ctx.fillRect(
          left,
          Math.min(yu, yl),
          right - left,
          Math.abs(yu - yl)
        );

        ctx.strokeStyle = COLORS.green;
        ctx.lineWidth = 1;
        ctx.setLineDash([5, 4]);

        for (const y of [yu, ym, yl]) {
          if (!Number.isFinite(y)) continue;

          ctx.beginPath();
          ctx.moveTo(left, y);
          ctx.lineTo(right, y);
          ctx.stroke();
        }

        ctx.setLineDash([]);
      }
    }

    for (const level of levelsFor(d)) {
      const y = candle.priceToCoordinate(
        level.price
      );

      if (
        !Number.isFinite(y) ||
        y < 0 ||
        y > height
      ) continue;

      const color =
        level.color || COLORS.purple;

      ctx.strokeStyle = color;
      ctx.lineWidth = IMPORTANT.includes(
        level.value
      ) ? 1.6 : 1;

      ctx.beginPath();
      ctx.moveTo(left, y);
      ctx.lineTo(right, y);
      ctx.stroke();

      if (settings.labels) {
        const label =
          level.value + " · " +
          level.price.toLocaleString(
            "en-US",
            { maximumFractionDigits: 6 }
          );

        ctx.font = "11px system-ui";

        const textWidth =
          ctx.measureText(label).width;

        const x = Math.max(
          4,
          Math.min(
            width - textWidth - 8,
            right - textWidth - 5
          )
        );

        ctx.fillStyle = "rgba(8,14,32,.94)";

        ctx.fillRect(
          x - 2,
          y - 14,
          textWidth + 6,
          15
        );

        ctx.fillStyle = color;
        ctx.fillText(label, x, y - 3);
      }
    }

    ctx.strokeStyle = COLORS.white;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 4]);

    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();

    ctx.setLineDash([]);

    drawHandle(ctx, d.a, COLORS.white);
    drawHandle(ctx, d.b, COLORS.white);
  }

  function pointerDown(event) {
    if (
      !drawingMode ||
      pointer !== null ||
      event.isPrimary === false
    ) return;

    const p = eventPoint(event);

    if (!p) return;

    pointer = event.pointerId;
    dragging = null;

    const d = currentDrawing();

    if (d) {
      for (const end of ["a", "b"]) {
        const anchor = position(d[end]);

        if (
          anchor &&
          Math.hypot(
            p.x - anchor.x,
            p.y - anchor.y
          ) <= 28
        ) {
          dragging = end;
          break;
        }
      }
    }

    try {
      canvas.setPointerCapture(event.pointerId);
    } catch (_) {}

    if (dragging) {
      status("Arrastra el extremo seleccionado.");
    } else if (!firstPoint) {
      firstPoint = {
        logical: p.logical,
        price: p.price
      };

      status(
        "Primer punto marcado. Toca el segundo."
      );
    } else {
      drawings[marketKey()] = {
        a: firstPoint,
        b: {
          logical: p.logical,
          price: p.price
        }
      };

      firstPoint = null;
      save();

      status(
        "Fibonacci dibujado. Puedes mover sus extremos."
      );
    }

    event.preventDefault();
    redraw();
  }

  function pointerMove(event) {
    if (
      !drawingMode ||
      !dragging ||
      pointer !== event.pointerId
    ) return;

    const p = eventPoint(event);
    const d = currentDrawing();

    if (!p || !d) return;

    d[dragging] = {
      logical: p.logical,
      price: p.price
    };

    event.preventDefault();
    redraw();
  }

  function pointerEnd(event) {
    if (pointer !== event.pointerId) return;

    if (dragging) save();

    dragging = null;
    pointer = null;

    redraw();
  }

  function setDrawingMode(active) {
    drawingMode = !!active;

    firstPoint = null;
    dragging = null;
    pointer = null;

    if (canvas) {
      canvas.style.pointerEvents =
        drawingMode ? "auto" : "none";

      canvas.style.touchAction =
        drawingMode ? "none" : "auto";
    }

    const button = $("fibDraw");

    if (button) {
      button.textContent = drawingMode
        ? "✓ Terminar dibujo"
        : "✏️ Dibujar / mover";

      button.style.background = drawingMode
        ? "#176b57"
        : "#243b60";

      button.setAttribute(
        "aria-pressed",
        String(drawingMode)
      );
    }

    status(
      drawingMode
        ? "Toca dos puntos. Arrastra los extremos para ajustarlos."
        : "Navegación activa: arrastra las velas horizontalmente."
    );

    redraw();
  }

  function button(label, action, parent, id) {
    const b = document.createElement("button");

    b.type = "button";
    b.textContent = label;

    if (id) b.id = id;

    b.style.cssText = [
      "background:#243b60",
      "color:#fff",
      "border:1px solid #465b87",
      "border-radius:9px",
      "padding:10px 12px",
      "min-height:42px",
      "font:inherit",
      "cursor:pointer"
    ].join(";");

    b.addEventListener("click", action);
    parent.appendChild(b);

    return b;
  }

  function renderLevels() {
    const host = $("fibLevels");

    if (!host) return;

    host.replaceChildren();

    for (const level of settings.levels) {
      const row = document.createElement("div");

      row.style.cssText = [
        "display:flex",
        "align-items:center",
        "gap:8px",
        "margin:8px 0",
        "flex-wrap:wrap"
      ].join(";");

      const check = document.createElement("input");
      check.type = "checkbox";
      check.checked = level.visible;

      check.addEventListener("change", () => {
        level.visible = check.checked;
        save();
        redraw();
      });

      const number = document.createElement("input");
      number.type = "number";
      number.step = "any";
      number.value = level.value;
      number.style.width = "88px";

      number.addEventListener("change", () => {
        const n = Number(number.value);

        if (
          !Number.isFinite(n) ||
          n < 0 ||
          n > 20
        ) {
          number.value = level.value;
          return;
        }

        level.value = n;

        settings.levels.sort(
          (a, b) => a.value - b.value
        );

        save();
        renderLevels();
        redraw();
      });

      const color = document.createElement("input");
      color.type = "color";
      color.value = level.color;

      color.addEventListener("change", () => {
        level.color = color.value;
        save();
        redraw();
      });

      const remove = button(
        "✕",
        () => {
          settings.levels =
            settings.levels.filter(
              item => item !== level
            );

          save();
          renderLevels();
          redraw();
        },
        row
      );

      remove.style.padding = "7px 10px";

      row.prepend(check, number, color);
      host.appendChild(row);
    }
  }

  function settingCheck(parent, label, key) {
    const row = document.createElement("label");

    row.style.cssText =
      "display:flex;align-items:center;gap:9px;margin:12px 0";

    const input = document.createElement("input");

    input.type = "checkbox";
    input.checked = !!settings[key];

    input.addEventListener("change", () => {
      settings[key] = input.checked;
      save();
      redraw();
    });

    row.append(
      input,
      document.createTextNode(label)
    );

    parent.appendChild(row);
  }

  function settingNumber(parent, label, key) {
    const row = document.createElement("label");

    row.style.cssText =
      "display:flex;align-items:center;justify-content:space-between;gap:10px;margin:12px 0";

    const input = document.createElement("input");

    input.type = "number";
    input.step = "any";
    input.value = settings[key];
    input.style.width = "90px";

    input.addEventListener("change", () => {
      const n = Number(input.value);

      if (Number.isFinite(n)) {
        settings[key] = n;
        save();
        redraw();
      } else {
        input.value = settings[key];
      }
    });

    row.append(
      document.createTextNode(label),
      input
    );

    parent.appendChild(row);
  }

  function buildUI() {
    const area = $("priceChartArea");

    if (!area) return false;

    if ($("fibToolbar") && $("fibonacciCanvas")) {
      canvas = $("fibonacciCanvas");
      return true;
    }

    $("fibToolbar")?.remove();
    $("fibPanel")?.remove();
    $("fibonacciCanvas")?.remove();

    area.style.position = "relative";

    canvas = document.createElement("canvas");
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

    area.appendChild(canvas);

    canvas.addEventListener(
      "pointerdown",
      pointerDown
    );

    canvas.addEventListener(
      "pointermove",
      pointerMove
    );

    canvas.addEventListener(
      "pointerup",
      pointerEnd
    );

    canvas.addEventListener(
      "pointercancel",
      pointerEnd
    );

    const toolbar = document.createElement("div");
    toolbar.id = "fibToolbar";

    toolbar.style.cssText = [
      "display:flex",
      "flex-wrap:wrap",
      "align-items:center",
      "gap:8px",
      "padding:12px",
      "margin:10px 0",
      "background:#101a32",
      "border:1px solid #34466c",
      "border-radius:12px",
      "color:#e3ebff",
      "font:13px system-ui",
      "position:relative",
      "z-index:5"
    ].join(";");

    const panel = document.createElement("div");
    panel.id = "fibPanel";
    panel.hidden = true;

    panel.style.cssText = [
      "background:#101a32",
      "color:#e3ebff",
      "border:1px solid #34466c",
      "border-radius:12px",
      "padding:14px",
      "margin:8px 0",
      "font:13px system-ui"
    ].join(";");

    button(
      "✏️ Dibujar / mover",
      () => setDrawingMode(!drawingMode),
      toolbar,
      "fibDraw"
    );

    button(
      "⚙️ Niveles",
      () => {
        panel.hidden = !panel.hidden;

        if (!panel.hidden) renderLevels();
      },
      toolbar,
      "fibSettingsButton"
    );

    button(
      "👁 Mostrar / ocultar",
      () => {
        settings.visible = !settings.visible;
        save();
        redraw();
      },
      toolbar,
      "fibVisible"
    );

    button(
      "🗑 Borrar trazado",
      () => {
        delete drawings[marketKey()];
        firstPoint = null;
        dragging = null;
        save();
        redraw();
        status("Fibonacci eliminado.");
      },
      toolbar,
      "fibErase"
    );

    const state = document.createElement("div");
    state.id = "fibStatus";

    state.style.cssText =
      "width:100%;color:#a5b0cf;padding:4px 0;line-height:1.5";

    state.textContent = "Fibonacci V6 iniciando...";
    toolbar.appendChild(state);

    const heading = document.createElement("h3");
    heading.textContent = "Fibonacci · Configuración";
    panel.appendChild(heading);

    settingCheck(
      panel,
      "Mostrar etiquetas y precios",
      "labels"
    );

    settingCheck(
      panel,
      "Mostrar caja verde BitLobo",
      "box"
    );

    settingCheck(
      panel,
      "Invertir dirección",
      "reverse"
    );

    settingNumber(
      panel,
      "Caja superior",
      "boxUpper"
    );

    settingNumber(
      panel,
      "Caja media",
      "boxMiddle"
    );

    settingNumber(
      panel,
      "Caja inferior",
      "boxLower"
    );

    const levelsTitle = document.createElement("h4");
    levelsTitle.textContent = "Niveles personalizados";
    panel.appendChild(levelsTitle);

    const levels = document.createElement("div");
    levels.id = "fibLevels";
    panel.appendChild(levels);

    button(
      "+ Agregar nivel",
      () => {
        let next = 1.414;

        while (
          settings.levels.some(
            x => x.value === next
          )
        ) {
          next = Number(
            (next + 0.001).toFixed(3)
          );
        }

        settings.levels.push({
          value: next,
          visible: true,
          color: COLORS.purple
        });

        settings.levels.sort(
          (a, b) => a.value - b.value
        );

        save();
        renderLevels();
        redraw();
      },
      panel
    );

    button(
      "Restablecer niveles",
      () => {
        settings = defaults();
        save();
        renderLevels();
        redraw();
        status("Niveles restablecidos.");
      },
      panel
    );

    area.parentNode.insertBefore(toolbar, area);
    area.parentNode.insertBefore(panel, area);

    renderLevels();

    const fallback = $("fibFallback");
    if (fallback) fallback.hidden = true;

    if (window.ResizeObserver) {
      observer = new ResizeObserver(redraw);
      observer.observe(area);
    }

    window.addEventListener("resize", redraw);

    for (const id of [
      "symbol",
      "interval",
      "exchange",
      "market"
    ]) {
      $(id)?.addEventListener("change", () => {
        firstPoint = null;
        dragging = null;
        pointer = null;
        redraw();
      });
    }

    initialized = true;
    redraw();

    return true;
  }

  function enableNavigation() {
    if (!chart) return;

    chart.applyOptions({
      handleScroll: {
        mouseWheel: true,
        pressedMouseMove: true,
        horzTouchDrag: true,
        vertTouchDrag: false
      },

      handleScale: {
        mouseWheel: true,
        pinch: true,
        axisPressedMouseMove: true
      }
    });

    const note = $("chartTouchStatus");

    if (note) {
      note.textContent =
        "Arrastra las velas horizontalmente. Usa dos dedos para ampliar o reducir.";
    }
  }

  function attachCandle(created) {
    if (!created || candle === created) return;

    candle = created;

    for (const name of ["setData", "update"]) {
      const original = created[name];

      if (typeof original !== "function") continue;

      created[name] = function (...args) {
        const result = original.apply(this, args);
        redraw();
        return result;
      };
    }

    status(
      "Fibonacci V6 conectado. Pulsa Dibujar / mover."
    );

    redraw();
  }

  function attachChart(created) {
    if (!created || chart === created) return;

    chart = created;

    const originalAdd = created.addCandlestickSeries;

    if (typeof originalAdd === "function") {
      created.addCandlestickSeries = function (...args) {
        const result = originalAdd.apply(this, args);
        attachCandle(result);
        return result;
      };
    }

    try {
      created.timeScale()
        .subscribeVisibleLogicalRangeChange(
          redraw
        );
    } catch (error) {
      console.warn(
        "Fibonacci V6 escala:",
        error
      );
    }

    enableNavigation();
    redraw();
  }

  function installHook() {
    const library = window.LightweightCharts;

    if (
      !library ||
      typeof library.createChart !== "function"
    ) return false;

    if (library.__CL_FIB_HOOK_V6__) return true;

    const original = library.createChart;

    library.createChart = function (
      element,
      ...args
    ) {
      const result = original.call(
        this,
        element,
        ...args
      );

      if (element?.id === "chart") {
        attachChart(result);
      }

      return result;
    };

    library.__CL_FIB_HOOK_V6__ = true;
    return true;
  }

  function start() {
    buildUI();

    if (!installHook()) {
      status(
        "Esperando Lightweight Charts...",
        true
      );
    }

    // APP.JS V14 ejecuta setChartNavigation()
    // al crear las gráficas. Este ajuste posterior
    // recupera el arrastre horizontal.

    setTimeout(enableNavigation, 100);
    setTimeout(enableNavigation, 600);
    setTimeout(enableNavigation, 1500);

    if (chart && candle) {
      status(
        "Fibonacci V6 conectado. Listo para dibujar."
      );
    } else {
      status(
        "Esperando conexión con la gráfica...",
        true
      );
    }
  }

  load();

  // Captura la creación de la gráfica
  // antes de que APP.JS V14 se ejecute.
  installHook();

  window.CryptolexuzFibonacci = {
    version: "6",

    getSettings: () =>
      JSON.parse(JSON.stringify(settings)),

    updateSettings: changes => {
      if (
        !changes ||
        typeof changes !== "object"
      ) return;

      settings = {
        ...settings,
        ...changes
      };

      save();
      renderLevels();
      redraw();
    },

    priceAt,

    calculate: () => {
      const d = currentDrawing();

      return d
        ? {
            anchors: d,
            levels: levelsFor(d)
          }
        : null;
    },

    setLevel: (value, changes = {}) => {
      const n = Number(value);

      if (!Number.isFinite(n)) return;

      let level = settings.levels.find(
        x => x.value === n
      );

      if (level) {
        Object.assign(level, changes);
      } else {
        settings.levels.push({
          value: n,
          visible: true,
          color: COLORS.purple,
          ...changes
        });
      }

      settings.levels.sort(
        (a, b) => a.value - b.value
      );

      save();
      renderLevels();
      redraw();
    },

    removeLevel: value => {
      settings.levels =
        settings.levels.filter(
          x => x.value !== Number(value)
        );

      save();
      renderLevels();
      redraw();
    },

    redraw,

    isConnected: () => !!(chart && candle)
  };

  if (document.readyState === "loading") {
    document.addEventListener(
      "DOMContentLoaded",
      start
    );
  } else {
    start();
  }

  console.info(
    "CRYPTOLEXUZ PRO — Fibonacci V6 cargado"
  );
})();
