
/* CRYPTOLEXUZ PRO — FIBONACCI V2
   Compatible con Lightweight Charts 4.2.2 y app.js V13.
   Dibujo táctil, niveles editables, caja BitLobo y guardado local.
*/
(function () {
  "use strict";

  const $ = id => document.getElementById(id);
  const STORE = "cryptolexuz_fibonacci_v2";

  const DEFAULT_VALUES = [
    0, .236, .382, .5, .618, .65, .705, .786,
    .88, 1, 1.272, 1.618, 2, 2.618, 3.618, 4.236
  ];

  const defaults = () => ({
    visible: true,
    showLabels: true,
    showBox: true,
    reverse: false,
    lineWidth: 1,
    color: "#bb52ff",
    boxColor: "#16a34a",
    boxUpper: .7362,
    boxLower: .6935,
    boxMiddle: .7148,
    levels: DEFAULT_VALUES.map(value => ({
      value,
      visible: true,
      color: [.618, .786, .88, 1.618].includes(value)
        ? "#22c55e"
        : "#bb52ff"
    }))
  });

  const clone = obj => JSON.parse(JSON.stringify(obj));

  let settings = defaults();
  let drawings = {};
  let chart = null;
  let candle = null;
  let canvas = null;
  let drawing = false;
  let first = null;
  let drag = -1;
  let raf = 0;

  try {
    const old = JSON.parse(localStorage.getItem(STORE));

    if (old && typeof old === "object") {
      settings = {...defaults(), ...old};

      if (!Array.isArray(old.levels)) {
        settings.levels = defaults().levels;
      }
    } else {
      const v1 = JSON.parse(
        localStorage.getItem("cryptolexuz_fibonacci_v1")
      );

      if (v1 && typeof v1 === "object") {
        settings = {...defaults(), ...v1, visible: true};
      }
    }

    drawings = JSON.parse(
      localStorage.getItem(STORE + "_drawings")
    ) || {};
  } catch (_) {}

  function persist() {
    try {
      localStorage.setItem(STORE, JSON.stringify(settings));
      localStorage.setItem(
        STORE + "_drawings",
        JSON.stringify(drawings)
      );
    } catch (err) {
      console.warn("Fibonacci: almacenamiento no disponible", err);
    }
  }

  function selection() {
    const symbol = $("symbol")?.value || "BTC-USDT";

    const exchange = /NCCO/.test(symbol)
      ? "bingx"
      : ($("exchange")?.value || "bingx");

    const market = /NCCO/.test(symbol)
      ? "perpetual"
      : ($("market")?.value || "perpetual");

    return {
      symbol,
      exchange,
      market,
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

  function active() {
    return drawings[currentKey()] || null;
  }

  function saveDrawing(d) {
    drawings[currentKey()] = d;
    persist();
    redraw();
  }

  function priceAt(a, b, ratio) {
    return a + (b - a) * ratio;
  }

  function calculate() {
    const d = active();

    if (!d) return null;

    const a = settings.reverse ? d.b.price : d.a.price;
    const b = settings.reverse ? d.a.price : d.b.price;

    return {
      anchors: d,
      levels: settings.levels
        .filter(x => x.visible)
        .map(x => ({
          ...x,
          price: priceAt(a, b, x.value)
        })),
      box: settings.showBox
        ? {
            upper: priceAt(a, b, settings.boxUpper),
            lower: priceAt(a, b, settings.boxLower),
            middle: priceAt(a, b, settings.boxMiddle)
          }
        : null
    };
  }

  function redraw() {
    if (raf) return;

    raf = requestAnimationFrame(() => {
      raf = 0;
      paint();
    });
  }

  function paint() {
    if (!canvas || !chart || !candle) return;

    const rect = canvas.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;

    if (!w || !h) return;

    const ratio = Math.min(
      window.devicePixelRatio || 1,
      2
    );

    if (
      canvas.width !== Math.round(w * ratio) ||
      canvas.height !== Math.round(h * ratio)
    ) {
      canvas.width = Math.round(w * ratio);
      canvas.height = Math.round(h * ratio);
    }

    const ctx = canvas.getContext("2d");

    if (!ctx) return;

    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, w, h);

    if (!settings.visible) return;

    const data = calculate();

    if (!data) return;

    const a = data.anchors.a;
    const b = data.anchors.b;

    const x1 = chart.timeScale().logicalToCoordinate(a.logical);
    const x2 = chart.timeScale().logicalToCoordinate(b.logical);

    const y1 = candle.priceToCoordinate(a.price);
    const y2 = candle.priceToCoordinate(b.price);

    if (![x1, x2, y1, y2].every(Number.isFinite)) {
      return;
    }

    const left = Math.max(0, Math.min(x1, x2));
    const right = Math.min(w, Math.max(x1, x2));

    if (data.box) {
      const ya = candle.priceToCoordinate(data.box.upper);
      const yb = candle.priceToCoordinate(data.box.lower);

      if (Number.isFinite(ya) && Number.isFinite(yb)) {
        ctx.fillStyle = "rgba(22,163,74,.13)";

        ctx.fillRect(
          left,
          Math.min(ya, yb),
          Math.max(0, right - left),
          Math.abs(ya - yb)
        );

        ctx.strokeStyle = settings.boxColor;
        ctx.setLineDash([4, 4]);

        const lines = [
          [ya, "Caja superior"],
          [yb, "Caja inferior"],
          [
            candle.priceToCoordinate(data.box.middle),
            "Mitad"
          ]
        ];

        for (const [y, label] of lines) {
          if (!Number.isFinite(y)) continue;

          ctx.beginPath();
          ctx.moveTo(left, y);
          ctx.lineTo(right, y);
          ctx.stroke();

          if (settings.showLabels) {
            ctx.font = "10px system-ui";
            ctx.fillStyle = settings.boxColor;

            ctx.fillText(
              label,
              Math.max(3, left + 4),
              Math.max(12, y - 3)
            );
          }
        }

        ctx.setLineDash([]);
      }
    }

    ctx.lineWidth = Math.max(
      1,
      Math.min(4, Number(settings.lineWidth) || 1)
    );

    for (const lvl of data.levels) {
      const y = candle.priceToCoordinate(lvl.price);

      if (
        !Number.isFinite(y) ||
        y < -20 ||
        y > h + 20
      ) {
        continue;
      }

      ctx.strokeStyle = lvl.color || settings.color;
      ctx.beginPath();
      ctx.moveTo(left, y);
      ctx.lineTo(right, y);
      ctx.stroke();

      if (settings.showLabels) {
        const txt =
          lvl.value.toFixed(3)
            .replace(/0+$/, "")
            .replace(/\.$/, "") +
          " · " +
          Number(lvl.price).toLocaleString("en-US", {
            maximumFractionDigits: 5
          });

        ctx.font = "10px system-ui";

        const tw = ctx.measureText(txt).width;

        const tx = Math.max(
          2,
          Math.min(w - tw - 7, right - tw - 5)
        );

        ctx.fillStyle = "rgba(8,14,32,.87)";
        ctx.fillRect(tx - 2, y - 13, tw + 5, 14);

        ctx.fillStyle = lvl.color || settings.color;
        ctx.fillText(txt, tx, y - 3);
      }
    }

    ctx.strokeStyle = "#e4eaff";
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.setLineDash([]);

    for (const [x, y] of [[x1, y1], [x2, y2]]) {
      ctx.beginPath();
      ctx.arc(x, y, 7, 0, Math.PI * 2);
      ctx.fillStyle = "#10182d";
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = "#fff";
      ctx.stroke();
    }
  }

  function point(event) {
    const r = canvas.getBoundingClientRect();

    const x = event.clientX - r.left;
    const y = event.clientY - r.top;

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

    return {x, y, logical, price};
  }

  function status(text) {
    const el = $("fibStatus");

    if (el) el.textContent = text;
  }

  function begin(event) {
    if (!drawing || !chart || !candle) return;

    const p = point(event);

    if (!p) return;

    const d = active();

    if (d) {
      const handles = [d.a, d.b].map(q => ({
        x: chart.timeScale().logicalToCoordinate(q.logical),
        y: candle.priceToCoordinate(q.price)
      }));

      drag = handles.findIndex(q =>
        Number.isFinite(q.x) &&
        Number.isFinite(q.y) &&
        Math.hypot(p.x - q.x, p.y - q.y) < 24
      );
    }

    if (drag < 0) {
      if (!first) {
        first = {
          logical: p.logical,
          price: p.price
        };

        status(
          "Primer punto colocado. Toca el segundo extremo."
        );
      } else {
        saveDrawing({
          a: first,
          b: {
            logical: p.logical,
            price: p.price
          }
        });

        first = null;

        status(
          "Fibonacci guardado. Arrastra los círculos para ajustarlo."
        );
      }
    } else {
      canvas.setPointerCapture(event.pointerId);
    }

    event.preventDefault();
    redraw();
  }

  function move(event) {
    if (!drawing || drag < 0) return;

    const p = point(event);

    if (!p) return;

    const d = active();

    if (!d) return;

    d[drag === 0 ? "a" : "b"] = {
      logical: p.logical,
      price: p.price
    };

    redraw();
    event.preventDefault();
  }

  function end() {
    if (drag >= 0) persist();

    drag = -1;
  }

  function toggleDraw() {
    drawing = !drawing;
    first = null;
    drag = -1;

    if (canvas) {
      canvas.style.pointerEvents = drawing
        ? "auto"
        : "none";

      canvas.style.touchAction = drawing
        ? "none"
        : "auto";
    }

    const btn = $("fibDraw");

    if (btn) {
      btn.textContent = drawing
        ? "✓ Terminar dibujo"
        : "✏️ Dibujar / mover";

      btn.setAttribute(
        "aria-pressed",
        String(drawing)
      );
    }

    status(
      drawing
        ? "Toca dos puntos en las velas, o arrastra los extremos existentes."
        : "Modo dibujo desactivado."
    );

    redraw();
  }

  function renderLevels() {
    const host = $("fibLevels");

    if (!host) return;

    host.replaceChildren();

    for (const lvl of settings.levels) {
      const row = document.createElement("div");

      row.style.cssText =
        "display:flex;gap:7px;align-items:center;margin:6px 0";

      const check = document.createElement("input");
      check.type = "checkbox";
      check.checked = !!lvl.visible;

      check.onchange = () => {
        lvl.visible = check.checked;
        persist();
        redraw();
      };

      const value = document.createElement("input");
      value.type = "number";
      value.step = "any";
      value.value = lvl.value;
      value.style.cssText = "width:85px;min-width:0";

      value.onchange = () => {
        const n = Number(value.value);

        if (
          !Number.isFinite(n) ||
          n < 0 ||
          n > 20
        ) {
          value.value = lvl.value;
          return;
        }

        lvl.value = n;

        settings.levels.sort(
          (a, b) => a.value - b.value
        );

        persist();
        redraw();
        renderLevels();
      };

      const color = document.createElement("input");
      color.type = "color";

      color.value = /^#[0-9a-f]{6}$/i.test(lvl.color)
        ? lvl.color
        : settings.color;

      color.onchange = () => {
        lvl.color = color.value;
        persist();
        redraw();
      };

      const del = document.createElement("button");
      del.type = "button";
      del.textContent = "✕";

      del.onclick = () => {
        settings.levels = settings.levels.filter(
          x => x !== lvl
        );

        persist();
        redraw();
        renderLevels();
      };

      row.append(check, value, color, del);
      host.appendChild(row);
    }
  }

  function addCheckbox(parent, label, key) {
    const line = document.createElement("label");

    line.style.cssText =
      "display:flex;gap:8px;align-items:center;margin:8px 0";

    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = !!settings[key];

    input.onchange = () => {
      settings[key] = input.checked;
      persist();
      redraw();
    };

    line.append(
      input,
      document.createTextNode(label)
    );

    parent.appendChild(line);
  }

  function addNumber(parent, label, key) {
    const line = document.createElement("label");

    line.style.cssText =
      "display:flex;justify-content:space-between;gap:8px;align-items:center;margin:8px 0";

    const input = document.createElement("input");
    input.type = "number";
    input.step = "any";
    input.value = settings[key];
    input.style.width = "95px";

    input.onchange = () => {
      const n = Number(input.value);

      if (Number.isFinite(n)) {
        settings[key] = n;
        persist();
        redraw();
      }
    };

    line.append(
      document.createTextNode(label),
      input
    );

    parent.appendChild(line);
  }

  function makeButton(label, id, parent, fn) {
    const b = document.createElement("button");

    b.type = "button";
    b.id = id;
    b.textContent = label;
    b.onclick = fn;

    b.style.cssText =
      "background:#243b60;color:#fff;border:1px solid #42547c;border-radius:8px;padding:9px 10px;font:inherit";

    parent.appendChild(b);

    return b;
  }

  function buildUI() {
    const area = $("priceChartArea");

    if (!area || $("fibonacciCanvas")) return;

    area.style.position = "relative";

    canvas = document.createElement("canvas");
    canvas.id = "fibonacciCanvas";

    canvas.style.cssText =
      "position:absolute;inset:0;width:100%;height:100%;z-index:8;pointer-events:none;touch-action:auto";

    area.appendChild(canvas);

    canvas.addEventListener("pointerdown", begin);
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerup", end);
    canvas.addEventListener("pointercancel", end);

    const toolbar = document.createElement("div");
    toolbar.id = "fibToolbar";

    toolbar.style.cssText =
      "display:flex;flex-wrap:wrap;gap:7px;margin:10px 0;color:#dbe7ff;font:12px system-ui";

    makeButton(
      "✏️ Dibujar / mover",
      "fibDraw",
      toolbar,
      toggleDraw
    );

    const panel = document.createElement("div");
    panel.id = "fibPanel";
    panel.hidden = true;

    panel.style.cssText =
      "background:#101a32;color:#e3ebff;border:1px solid #34466c;border-radius:12px;padding:12px;margin:8px 0;font:13px system-ui";

    makeButton(
      "⚙️ Niveles",
      "fibSettingsButton",
      toolbar,
      () => {
        panel.hidden = !panel.hidden;

        if (!panel.hidden) renderLevels();
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
          "Trazado eliminado en este activo y temporalidad."
        );
      }
    );

    const st = document.createElement("span");
    st.id = "fibStatus";

    st.style.cssText =
      "width:100%;color:#a5b0cf";

    st.textContent =
      "Pulsa Dibujar / mover para colocar el Fibonacci.";

    toolbar.appendChild(st);

    const heading = document.createElement("strong");
    heading.textContent =
      "Fibonacci completo · Configuración";

    panel.appendChild(heading);

    addCheckbox(
      panel,
      "Mostrar etiquetas",
      "showLabels"
    );

    addCheckbox(
      panel,
      "Caja verde BitLobo",
      "showBox"
    );

    addCheckbox(
      panel,
      "Invertir dirección",
      "reverse"
    );

    addNumber(
      panel,
      "Caja superior",
      "boxUpper"
    );

    addNumber(
      panel,
      "Caja media",
      "boxMiddle"
    );

    addNumber(
      panel,
      "Caja inferior",
      "boxLower"
    );

    addNumber(
      panel,
      "Grosor de línea",
      "lineWidth"
    );

    const levels = document.createElement("div");
    levels.id = "fibLevels";
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

    const host = $("chartSection") || area.parentElement;

    if (!host) return;

    const headingArea =
      host.querySelector(".chart-controls") || area;

    headingArea.insertAdjacentElement(
      "afterend",
      toolbar
    );

    toolbar.insertAdjacentElement(
      "afterend",
      panel
    );

    if (window.ResizeObserver) {
      new ResizeObserver(redraw).observe(area);
    }

    window.addEventListener("resize", redraw);

    for (const id of [
      "symbol",
      "interval",
      "market",
      "exchange"
    ]) {
      $(id)?.addEventListener("change", () => {
        first = null;
        drag = -1;

        status(
          "Activo o temporalidad cambiados. Trazado correspondiente cargado."
        );

        redraw();
      });
    }

    renderLevels();
    redraw();
  }

  function hookCharts() {
    const lib = window.LightweightCharts;

    if (
      !lib ||
      typeof lib.createChart !== "function"
    ) {
      console.warn(
        "Fibonacci: Lightweight Charts no disponible"
      );

      return;
    }

    const original = lib.createChart;

    lib.createChart = function(element, ...args) {
      const result = original.call(this, element, ...args);

      if (element && element.id === "chart") {
        chart = result;

        const originalCandle = result.addCandlestickSeries;

        result.addCandlestickSeries = function(...params) {
          const s = originalCandle.apply(this, params);

          candle = s;

          const originalSet = s.setData;

          s.setData = function(...data) {
            const ret = originalSet.apply(this, data);
            redraw();
            return ret;
          };

          const originalUpdate = s.update;

          s.update = function(...data) {
            const ret = originalUpdate.apply(this, data);
            redraw();
            return ret;
          };

          return s;
        };

        result.timeScale()
          .subscribeVisibleLogicalRangeChange(redraw);
      }

      return result;
    };
  }

  hookCharts();

  if (document.readyState === "loading") {
    document.addEventListener(
      "DOMContentLoaded",
      buildUI
    );
  } else {
    buildUI();
  }

  window.CryptolexuzFibonacci = {
    getSettings: () => clone(settings),

    updateSettings: changes => {
      settings = {...settings, ...changes};
      persist();
      redraw();
    },

    calculate,
    priceAt,
    redraw,

    reset: () => {
      settings = defaults();
      persist();
      renderLevels();
      redraw();
    },

    setLevel: (v, changes = {}) => {
      const value = Number(v);

      if (!Number.isFinite(value)) return;

      let l = settings.levels.find(
        x => x.value === value
      );

      if (l) {
        Object.assign(l, changes);
      } else {
        settings.levels.push({
          value,
          visible: true,
          color: settings.color,
          ...changes
        });
      }

      persist();
      renderLevels();
      redraw();
    },

    removeLevel: v => {
      settings.levels = settings.levels.filter(
        x => x.value !== Number(v)
      );

      persist();
      renderLevels();
      redraw();
    }
  };

  console.info(
    "CRYPTOLEXUZ Fibonacci V2 cargado"
  );
})();
