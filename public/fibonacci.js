
/*
 CRYPTOLEXUZ PRO — FIBONACCI V3
 Compatible con app.js V13
 Lightweight Charts 4.2.2

 - Fibonacci sobre las velas
 - Dos puntos táctiles
 - Extremos arrastrables
 - Niveles configurables
 - Caja verde BitLobo
 - Guardado por mercado, activo y temporalidad
 - No modifica señales ni ejecuta órdenes
*/

(function () {
  "use strict";

  const $ = id => document.getElementById(id);

  const STORE = "cryptolexuz_fibonacci_v3";

  const RATIOS = [
    0, 0.236, 0.382, 0.5,
    0.618, 0.65, 0.705,
    0.786, 0.88, 1,
    1.272, 1.618, 2,
    2.618, 3.618, 4.236
  ];

  function defaults() {
    return {
      visible: true,
      labels: true,
      box: true,
      reverse: false,
      boxUpper: 0.7362,
      boxMiddle: 0.7148,
      boxLower: 0.6935,
      levels: RATIOS.map(value => ({
        value,
        visible: true,
        color: [
          0.618, 0.786, 0.88, 1.618
        ].includes(value)
          ? "#22c55e"
          : "#bb52ff"
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
  let frame = 0;

  function load() {
    try {
      const saved = JSON.parse(
        localStorage.getItem(STORE)
      );

      if (saved && typeof saved === "object") {
        settings = {
          ...defaults(),
          ...saved
        };

        if (!Array.isArray(settings.levels)) {
          settings.levels = defaults().levels;
        }
      }

      const stored = JSON.parse(
        localStorage.getItem(STORE + "_drawings")
      );

      if (stored && typeof stored === "object") {
        drawings = stored;
      }
    } catch (error) {
      console.warn("Fibonacci: carga local", error);
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
      console.warn("Fibonacci: guardado local", error);
    }
  }

  function marketKey() {
    const symbol = $("symbol")?.value || "BTC-USDT";

    const commodity = symbol.startsWith("NCCO");

    const exchange = commodity
      ? "bingx"
      : $("exchange")?.value || "bingx";

    const market = commodity
      ? "perpetual"
      : $("market")?.value || "perpetual";

    const interval = $("interval")?.value || "15m";

    return [
      exchange,
      market,
      symbol,
      interval
    ].join("|");
  }

  function currentDrawing() {
    return drawings[marketKey()] || null;
  }

  function priceAt(a, b, ratio) {
    return a + (b - a) * ratio;
  }

  function levelsFor(d) {
    if (!d) return [];

    const a = settings.reverse
      ? d.b.price
      : d.a.price;

    const b = settings.reverse
      ? d.a.price
      : d.b.price;

    return settings.levels
      .filter(level => level.visible)
      .map(level => ({
        ...level,
        price: priceAt(a, b, level.value)
      }));
  }

  function requestDraw() {
    if (frame) return;

    frame = requestAnimationFrame(() => {
      frame = 0;
      paint();
    });
  }

  function paint() {
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();

    const width = rect.width;
    const height = rect.height;

    if (!width || !height) return;

    const dpr = Math.min(
      window.devicePixelRatio || 1,
      2
    );

    const pixelWidth = Math.round(width * dpr);
    const pixelHeight = Math.round(height * dpr);

    if (
      canvas.width !== pixelWidth ||
      canvas.height !== pixelHeight
    ) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
    }

    const ctx = canvas.getContext("2d");

    if (!ctx) return;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    if (!chart || !candle) return;

    const timeScale = chart.timeScale();

    function coords(point) {
      if (!point) return null;

      const x = timeScale.logicalToCoordinate(
        point.logical
      );

      const y = candle.priceToCoordinate(
        point.price
      );

      if (
        !Number.isFinite(x) ||
        !Number.isFinite(y)
      ) {
        return null;
      }

      return {x, y};
    }

    function handle(point, color) {
      const p = coords(point);

      if (!p) return;

      ctx.beginPath();
      ctx.arc(p.x, p.y, 7, 0, Math.PI * 2);

      ctx.fillStyle = "#10182d";
      ctx.fill();

      ctx.lineWidth = 2;
      ctx.strokeStyle = color;
      ctx.stroke();
    }

    if (firstPoint && drawingMode) {
      handle(firstPoint, "#ffe15a");
    }

    const d = currentDrawing();

    if (!d || !settings.visible) return;

    const a = coords(d.a);
    const b = coords(d.b);

    if (!a || !b) return;

    const left = Math.max(
      0,
      Math.min(a.x, b.x)
    );

    const right = Math.min(
      width,
      Math.max(a.x, b.x)
    );

    const startPrice = settings.reverse
      ? d.b.price
      : d.a.price;

    const endPrice = settings.reverse
      ? d.a.price
      : d.b.price;

    if (settings.box && right > left) {
      const upper = priceAt(
        startPrice,
        endPrice,
        settings.boxUpper
      );

      const lower = priceAt(
        startPrice,
        endPrice,
        settings.boxLower
      );

      const middle = priceAt(
        startPrice,
        endPrice,
        settings.boxMiddle
      );

      const yu = candle.priceToCoordinate(upper);
      const yl = candle.priceToCoordinate(lower);
      const ym = candle.priceToCoordinate(middle);

      if (
        Number.isFinite(yu) &&
        Number.isFinite(yl)
      ) {
        ctx.fillStyle = "rgba(22,163,74,.15)";

        ctx.fillRect(
          left,
          Math.min(yu, yl),
          right - left,
          Math.abs(yu - yl)
        );

        ctx.strokeStyle = "#22c55e";
        ctx.lineWidth = 1;
        ctx.setLineDash([5, 4]);

        for (const y of [yu, yl, ym]) {
          if (!Number.isFinite(y)) continue;

          ctx.beginPath();
          ctx.moveTo(left, y);
          ctx.lineTo(right, y);
          ctx.stroke();
        }

        ctx.setLineDash([]);
      }
    }

    const levels = levelsFor(d);

    for (const level of levels) {
      const y = candle.priceToCoordinate(
        level.price
      );

      if (
        !Number.isFinite(y) ||
        y < -20 ||
        y > height + 20
      ) {
        continue;
      }

      ctx.strokeStyle = level.color || "#bb52ff";
      ctx.lineWidth = 1;

      ctx.beginPath();
      ctx.moveTo(left, y);
      ctx.lineTo(right, y);
      ctx.stroke();

      if (settings.labels) {
        const ratioText = String(level.value);

        const priceText = level.price.toLocaleString(
          "en-US",
          {maximumFractionDigits: 5}
        );

        const label = ratioText + " · " + priceText;

        ctx.font = "11px system-ui";

        const textWidth = ctx.measureText(label).width;

        const x = Math.max(
          4,
          Math.min(
            width - textWidth - 8,
            right - textWidth - 5
          )
        );

        ctx.fillStyle = "rgba(8,14,32,.9)";
        ctx.fillRect(
          x - 2,
          y - 14,
          textWidth + 6,
          15
        );

        ctx.fillStyle = level.color || "#bb52ff";
        ctx.fillText(label, x, y - 3);
      }
    }

    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 4]);

    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();

    ctx.setLineDash([]);

    handle(d.a, "#ffffff");
    handle(d.b, "#ffffff");
  }

  function eventPoint(event) {
    if (!canvas || !chart || !candle) {
      return null;
    }

    const rect = canvas.getBoundingClientRect();

    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    const logical = chart.timeScale()
      .coordinateToLogical(x);

    const price = candle.coordinateToPrice(y);

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

  function pointerDown(event) {
    if (!drawingMode) return;

    const p = eventPoint(event);

    if (!p) return;

    const d = currentDrawing();

    dragging = null;

    if (d) {
      for (const name of ["a", "b"]) {
        const anchor = d[name];

        const x = chart.timeScale()
          .logicalToCoordinate(anchor.logical);

        const y = candle.priceToCoordinate(
          anchor.price
        );

        if (
          Number.isFinite(x) &&
          Number.isFinite(y) &&
          Math.hypot(p.x - x, p.y - y) <= 26
        ) {
          dragging = name;
          break;
        }
      }
    }

    if (dragging) {
      try {
        canvas.setPointerCapture(event.pointerId);
      } catch (_) {}

      status("Moviendo extremo del Fibonacci.");
    } else if (!firstPoint) {
      firstPoint = {
        logical: p.logical,
        price: p.price
      };

      status(
        "Primer punto marcado. Toca el segundo punto."
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
    requestDraw();
  }

  function pointerMove(event) {
    if (!drawingMode || !dragging) return;

    const p = eventPoint(event);
    const d = currentDrawing();

    if (!p || !d) return;

    d[dragging] = {
      logical: p.logical,
      price: p.price
    };

    event.preventDefault();
    requestDraw();
  }

  function pointerEnd() {
    if (dragging) save();

    dragging = null;
  }

  function toggleDrawing() {
    drawingMode = !drawingMode;

    firstPoint = null;
    dragging = null;

    if (canvas) {
      canvas.style.pointerEvents = drawingMode
        ? "auto"
        : "none";

      canvas.style.touchAction = drawingMode
        ? "none"
        : "auto";
    }

    const button = $("fibDraw");

    if (button) {
      button.textContent = drawingMode
        ? "✓ Terminar dibujo"
        : "✏️ Dibujar / mover";

      button.setAttribute(
        "aria-pressed",
        String(drawingMode)
      );
    }

    status(
      drawingMode
        ? "Toca dos puntos sobre las velas."
        : "Modo dibujo desactivado."
    );

    requestDraw();
  }

  function button(text, action, parent, id) {
    const element = document.createElement("button");

    element.type = "button";
    element.textContent = text;

    if (id) element.id = id;

    element.style.cssText = [
      "background:#243b60",
      "color:#ffffff",
      "border:1px solid #465b87",
      "border-radius:9px",
      "padding:10px",
      "min-height:40px",
      "font:inherit"
    ].join(";");

    element.addEventListener("click", action);

    parent.appendChild(element);

    return element;
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
        "margin:8px 0"
      ].join(";");

      const visible = document.createElement("input");
      visible.type = "checkbox";
      visible.checked = level.visible;

      visible.addEventListener("change", () => {
        level.visible = visible.checked;
        save();
        requestDraw();
      });

      const number = document.createElement("input");
      number.type = "number";
      number.step = "any";
      number.value = level.value;
      number.style.width = "85px";

      number.addEventListener("change", () => {
        const n = Number(number.value);

        if (!Number.isFinite(n) || n < 0 || n > 20) {
          number.value = level.value;
          return;
        }

        level.value = n;

        settings.levels.sort(
          (a, b) => a.value - b.value
        );

        save();
        renderLevels();
        requestDraw();
      });

      const color = document.createElement("input");
      color.type = "color";
      color.value = level.color;

      color.addEventListener("change", () => {
        level.color = color.value;
        save();
        requestDraw();
      });

      const remove = button(
        "✕",
        () => {
          settings.levels = settings.levels.filter(
            item => item !== level
          );

          save();
          renderLevels();
          requestDraw();
        },
        row
      );

      remove.style.padding = "6px 10px";

      row.prepend(visible, number, color);
      host.appendChild(row);
    }
  }

  function settingCheck(parent, label, name) {
    const row = document.createElement("label");

    row.style.cssText =
      "display:flex;gap:8px;align-items:center;margin:10px 0";

    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = settings[name];

    input.addEventListener("change", () => {
      settings[name] = input.checked;
      save();
      requestDraw();
    });

    row.append(input, document.createTextNode(label));
    parent.appendChild(row);
  }

  function settingNumber(parent, label, name) {
    const row = document.createElement("label");

    row.style.cssText =
      "display:flex;justify-content:space-between;gap:8px;align-items:center;margin:10px 0";

    const input = document.createElement("input");
    input.type = "number";
    input.step = "any";
    input.value = settings[name];
    input.style.width = "90px";

    input.addEventListener("change", () => {
      const n = Number(input.value);

      if (Number.isFinite(n)) {
        settings[name] = n;
        save();
        requestDraw();
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

    if (!area || $("fibToolbar")) return;

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
      "gap:8px",
      "padding:10px 0",
      "color:#e3ebff",
      "font:12px system-ui"
    ].join(";");

    button(
      "✏️ Dibujar / mover",
      toggleDrawing,
      toolbar,
      "fibDraw"
    );

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
      "⚙️ Niveles",
      () => {
        panel.hidden = !panel.hidden;

        if (!panel.hidden) {
          renderLevels();
        }
      },
      toolbar,
      "fibSettingsButton"
    );

    button(
      "👁 Mostrar / ocultar",
      () => {
        settings.visible = !settings.visible;
        save();
        requestDraw();
      },
      toolbar,
      "fibVisible"
    );

    button(
      "🗑 Borrar trazado",
      () => {
        delete drawings[marketKey()];
        firstPoint = null;
        save();
        requestDraw();

        status(
          "Fibonacci borrado de este activo y temporalidad."
        );
      },
      toolbar,
      "fibErase"
    );

    const state = document.createElement("div");
    state.id = "fibStatus";

    state.style.cssText =
      "width:100%;color:#a5b0cf;padding:4px 0";

    state.textContent =
      "Fibonacci listo. Pulsa Dibujar / mover.";

    toolbar.appendChild(state);

    const heading = document.createElement("h3");
    heading.textContent = "Fibonacci · Configuración";

    panel.appendChild(heading);

    settingCheck(
      panel,
      "Mostrar etiquetas",
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
        const existing = settings.levels.map(
          x => x.value
        );

        let value = 1.414;

        while (existing.includes(value)) {
          value = Number((value + 0.001).toFixed(3));
        }

        settings.levels.push({
          value,
          visible: true,
          color: "#bb52ff"
        });

        settings.levels.sort(
          (a, b) => a.value - b.value
        );

        save();
        renderLevels();
        requestDraw();
      },
      panel
    );

    button(
      "Restablecer niveles",
      () => {
        settings = defaults();
        save();
        renderLevels();
        requestDraw();
      },
      panel
    );

    // Inserción directa ANTES de la gráfica.
    // No depende de otras clases CSS.
    area.parentNode.insertBefore(toolbar, area);
    area.parentNode.insertBefore(panel, area);

    renderLevels();

    if (window.ResizeObserver) {
      new ResizeObserver(requestDraw).observe(area);
    }

    window.addEventListener("resize", requestDraw);

    for (const id of [
      "symbol",
      "interval",
      "exchange",
      "market"
    ]) {
      $(id)?.addEventListener("change", () => {
        firstPoint = null;
        dragging = null;

        status(
          "Mercado cambiado. Fibonacci correspondiente."
        );

        requestDraw();
      });
    }

    requestDraw();
  }

  function connectToChart() {
    const library = window.LightweightCharts;

    if (
      !library ||
      typeof library.createChart !== "function"
    ) {
      console.warn(
        "Fibonacci V3: biblioteca de gráficas no disponible"
      );

      return;
    }

    const originalCreateChart = library.createChart;

    library.createChart = function(element, options) {
      const result = originalCreateChart.call(
        this,
        element,
        options
      );

      if (element && element.id === "chart") {
        chart = result;

        const originalAdd = result.addCandlestickSeries;

        result.addCandlestickSeries = function(options) {
          const created = originalAdd.call(
            this,
            options
          );

          candle = created;

          const originalSetData = created.setData;

          created.setData = function(data) {
            const output = originalSetData.call(
              this,
              data
            );

            requestDraw();
            return output;
          };

          const originalUpdate = created.update;

          created.update = function(data) {
            const output = originalUpdate.call(
              this,
              data
            );

            requestDraw();
            return output;
          };

          requestDraw();

          return created;
        };

        result.timeScale()
          .subscribeVisibleLogicalRangeChange(
            requestDraw
          );
      }

      return result;
    };
  }

  load();

  // Este archivo debe cargarse antes de app.js.
  connectToChart();

  if (document.readyState === "loading") {
    document.addEventListener(
      "DOMContentLoaded",
      buildUI
    );
  } else {
    buildUI();
  }

  window.CryptolexuzFibonacci = {
    getSettings: () => JSON.parse(
      JSON.stringify(settings)
    ),

    updateSettings: changes => {
      settings = {...settings, ...changes};
      save();
      requestDraw();
    },

    priceAt,

    calculate: () => {
      const drawing = currentDrawing();

      return drawing
        ? {
            anchors: drawing,
            levels: levelsFor(drawing)
          }
        : null;
    },

    setLevel: (value, changes = {}) => {
      const n = Number(value);

      if (!Number.isFinite(n)) return;

      let level = settings.levels.find(
        item => item.value === n
      );

      if (level) {
        Object.assign(level, changes);
      } else {
        settings.levels.push({
          value: n,
          visible: true,
          color: "#bb52ff",
          ...changes
        });
      }

      settings.levels.sort(
        (a, b) => a.value - b.value
      );

      save();
      renderLevels();
      requestDraw();
    },

    removeLevel: value => {
      settings.levels = settings.levels.filter(
        item => item.value !== Number(value)
      );

      save();
      renderLevels();
      requestDraw();
    },

    redraw: requestDraw
  };

  console.info(
    "CRYPTOLEXUZ PRO — Fibonacci V3 inicializado"
  );
})();
