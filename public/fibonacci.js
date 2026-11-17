
/*
 CRYPTOLEXUZ PRO — FIBONACCI V5
 Compatible con APP.JS V14
 Lightweight Charts 4.2.2

 - Barra de herramientas siempre visible
 - Dibujo con dos toques
 - Extremos arrastrables
 - Retrocesos y extensiones
 - Caja verde BitLobo
 - Niveles configurables
 - Guardado por activo y temporalidad
 - Diagnóstico de conexión
*/

(function () {
  "use strict";

  if (window.__CL_FIB_V5__) return;
  window.__CL_FIB_V5__ = true;

  const $ = id => document.getElementById(id);

  const STORE = "cryptolexuz_fibonacci_v3";

  const DEFAULT_RATIOS = [
    0, 0.236, 0.382, 0.5,
    0.618, 0.65, 0.705,
    0.786, 0.88, 1,
    1.272, 1.618, 2,
    2.618, 3.618, 4.236
  ];

  const IMPORTANT = new Set([
    0.618, 0.786, 0.88, 1.618
  ]);

  function defaults() {
    return {
      visible: true,
      labels: true,
      box: true,
      reverse: false,
      boxUpper: 0.7362,
      boxMiddle: 0.7148,
      boxLower: 0.6935,
      levels: DEFAULT_RATIOS.map(value => ({
        value,
        visible: true,
        color: IMPORTANT.has(value)
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
  let activePointer = null;

  let frame = 0;
  let attached = false;
  let attempts = 0;
  let retryTimer = null;
  let resizeObserver = null;

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
            color: /^#[0-9a-f]{6}$/i.test(x.color)
              ? x.color
              : "#bb52ff"
          }));
      }

      const savedDrawings = JSON.parse(
        localStorage.getItem(
          STORE + "_drawings"
        ) || "null"
      );

      if (
        savedDrawings &&
        typeof savedDrawings === "object" &&
        !Array.isArray(savedDrawings)
      ) {
        drawings = savedDrawings;
      }
    } catch (error) {
      console.warn("Fibonacci: carga", error);
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
      console.warn("Fibonacci: guardado", error);
    }
  }

  function marketKey() {
    const symbol =
      $("symbol")?.value || "BTC-USDT";

    const commodity =
      symbol.startsWith("NCCO");

    const exchange = commodity
      ? "bingx"
      : $("exchange")?.value || "bingx";

    const market = commodity
      ? "perpetual"
      : $("market")?.value || "perpetual";

    const interval =
      $("interval")?.value || "15m";

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

  function levelsFor(drawing) {
    if (!drawing) return [];

    const start = settings.reverse
      ? drawing.b.price
      : drawing.a.price;

    const end = settings.reverse
      ? drawing.a.price
      : drawing.b.price;

    return settings.levels
      .filter(x => x.visible)
      .map(x => ({
        ...x,
        price: priceAt(
          start,
          end,
          x.value
        )
      }));
  }

  function status(message, warning = false) {
    const el = $("fibStatus");

    if (!el) return;

    el.textContent = message;
    el.style.color = warning
      ? "#ff9a35"
      : "#a5b0cf";
  }

  function requestDraw() {
    if (frame) return;

    frame = requestAnimationFrame(() => {
      frame = 0;
      paint();
    });
  }

  function coordinates(point) {
    if (!point || !chart || !candle) {
      return null;
    }

    try {
      const x = chart.timeScale()
        .logicalToCoordinate(
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

      return { x, y };
    } catch (_) {
      return null;
    }
  }

  function drawHandle(ctx, point, color) {
    const p = coordinates(point);

    if (!p) return;

    ctx.beginPath();
    ctx.arc(
      p.x,
      p.y,
      7,
      0,
      Math.PI * 2
    );

    ctx.fillStyle = "#10182d";
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

    if (width <= 0 || height <= 0) {
      return;
    }

    const dpr = Math.min(
      window.devicePixelRatio || 1,
      2
    );

    const pw = Math.round(width * dpr);
    const ph = Math.round(height * dpr);

    if (
      canvas.width !== pw ||
      canvas.height !== ph
    ) {
      canvas.width = pw;
      canvas.height = ph;
    }

    const ctx = canvas.getContext("2d");

    if (!ctx) return;

    ctx.setTransform(
      dpr, 0, 0, dpr, 0, 0
    );

    ctx.clearRect(
      0, 0, width, height
    );

    if (!chart || !candle) return;

    if (firstPoint && drawingMode) {
      drawHandle(
        ctx,
        firstPoint,
        "#ffe15a"
      );
    }

    const d = currentDrawing();

    if (!d || !settings.visible) {
      return;
    }

    const a = coordinates(d.a);
    const b = coordinates(d.b);

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

    const startPrice = settings.reverse
      ? d.b.price
      : d.a.price;

    const endPrice = settings.reverse
      ? d.a.price
      : d.b.price;

    if (settings.box) {
      const upper = priceAt(
        startPrice,
        endPrice,
        settings.boxUpper
      );

      const middle = priceAt(
        startPrice,
        endPrice,
        settings.boxMiddle
      );

      const lower = priceAt(
        startPrice,
        endPrice,
        settings.boxLower
      );

      const yu =
        candle.priceToCoordinate(upper);

      const ym =
        candle.priceToCoordinate(middle);

      const yl =
        candle.priceToCoordinate(lower);

      if (
        Number.isFinite(yu) &&
        Number.isFinite(yl)
      ) {
        ctx.fillStyle =
          "rgba(22,163,74,.17)";

        ctx.fillRect(
          left,
          Math.min(yu, yl),
          right - left,
          Math.abs(yu - yl)
        );

        ctx.strokeStyle = "#22c55e";
        ctx.lineWidth = 1;
        ctx.setLineDash([5, 4]);

        for (const y of [yu, ym, yl]) {
          if (!Number.isFinite(y)) {
            continue;
          }

          ctx.beginPath();
          ctx.moveTo(left, y);
          ctx.lineTo(right, y);
          ctx.stroke();
        }

        ctx.setLineDash([]);
      }
    }

    for (const level of levelsFor(d)) {
      const y =
        candle.priceToCoordinate(
          level.price
        );

      if (
        !Number.isFinite(y) ||
        y < 0 ||
        y > height
      ) {
        continue;
      }

      const color =
        level.color || "#bb52ff";

      ctx.strokeStyle = color;
      ctx.lineWidth =
        IMPORTANT.has(level.value)
          ? 1.6
          : 1;

      ctx.beginPath();
      ctx.moveTo(left, y);
      ctx.lineTo(right, y);
      ctx.stroke();

      if (settings.labels) {
        const price =
          level.price.toLocaleString(
            "en-US",
            {
              maximumFractionDigits: 6
            }
          );

        const label =
          String(level.value) +
          " · " +
          price;

        ctx.font = "11px system-ui";

        const tw =
          ctx.measureText(label).width;

        const x = Math.max(
          4,
          Math.min(
            width - tw - 8,
            right - tw - 5
          )
        );

        ctx.fillStyle =
          "rgba(8,14,32,.94)";

        ctx.fillRect(
          x - 2,
          y - 14,
          tw + 6,
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

    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 4]);

    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();

    ctx.setLineDash([]);

    drawHandle(
      ctx,
      d.a,
      "#ffffff"
    );

    drawHandle(
      ctx,
      d.b,
      "#ffffff"
    );
  }

  function eventPoint(event) {
    if (!canvas || !chart || !candle) {
      return null;
    }

    const rect =
      canvas.getBoundingClientRect();

    const x =
      event.clientX - rect.left;

    const y =
      event.clientY - rect.top;

    try {
      const logical =
        chart.timeScale()
          .coordinateToLogical(x);

      const price =
        candle.coordinateToPrice(y);

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
    } catch (_) {
      return null;
    }
  }

  function pointerDown(event) {
    if (
      !drawingMode ||
      activePointer !== null ||
      event.isPrimary === false
    ) {
      return;
    }

    const p = eventPoint(event);

    if (!p) return;

    activePointer = event.pointerId;
    dragging = null;

    const d = currentDrawing();

    if (d) {
      for (const name of ["a", "b"]) {
        const anchor =
          coordinates(d[name]);

        if (
          anchor &&
          Math.hypot(
            p.x - anchor.x,
            p.y - anchor.y
          ) <= 28
        ) {
          dragging = name;
          break;
        }
      }
    }

    try {
      canvas.setPointerCapture(
        event.pointerId
      );
    } catch (_) {}

    if (dragging) {
      status(
        "Arrastra el extremo seleccionado."
      );
    } else if (!firstPoint) {
      firstPoint = {
        logical: p.logical,
        price: p.price
      };

      status(
        "Primer punto marcado. Toca el segundo extremo."
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
    if (
      !drawingMode ||
      !dragging ||
      activePointer !== event.pointerId
    ) {
      return;
    }

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

  function pointerEnd(event) {
    if (
      activePointer !== null &&
      event.pointerId !== activePointer
    ) {
      return;
    }

    if (dragging) save();

    dragging = null;
    activePointer = null;

    requestDraw();
  }

  function toggleDrawing() {
    drawingMode = !drawingMode;

    firstPoint = null;
    dragging = null;
    activePointer = null;

    if (canvas) {
      canvas.style.pointerEvents =
        drawingMode
          ? "auto"
          : "none";

      canvas.style.touchAction =
        drawingMode
          ? "none"
          : "auto";
    }

    const b = $("fibDraw");

    if (b) {
      b.textContent = drawingMode
        ? "✓ Terminar dibujo"
        : "✏️ Dibujar / mover";

      b.setAttribute(
        "aria-pressed",
        String(drawingMode)
      );

      b.style.background = drawingMode
        ? "#176b57"
        : "#243b60";
    }

    status(
      drawingMode
        ? "Modo dibujo: toca dos puntos. Termina el dibujo para navegar."
        : "Navegación normal. Fibonacci guardado."
    );

    requestDraw();
  }

  function button(
    label,
    action,
    parent,
    id
  ) {
    const el =
      document.createElement("button");

    el.type = "button";
    el.textContent = label;

    if (id) el.id = id;

    el.style.cssText = [
      "background:#243b60",
      "color:#ffffff",
      "border:1px solid #465b87",
      "border-radius:9px",
      "padding:10px 12px",
      "min-height:42px",
      "font:inherit",
      "cursor:pointer"
    ].join(";");

    el.addEventListener(
      "click",
      action
    );

    parent.appendChild(el);

    return el;
  }

  function renderLevels() {
    const host = $("fibLevels");

    if (!host) return;

    host.replaceChildren();

    for (const level of settings.levels) {
      const row =
        document.createElement("div");

      row.style.cssText = [
        "display:flex",
        "align-items:center",
        "gap:8px",
        "margin:8px 0",
        "flex-wrap:wrap"
      ].join(";");

      const visible =
        document.createElement("input");

      visible.type = "checkbox";
      visible.checked = level.visible;

      visible.addEventListener(
        "change",
        () => {
          level.visible =
            visible.checked;

          save();
          requestDraw();
        }
      );

      const number =
        document.createElement("input");

      number.type = "number";
      number.step = "any";
      number.value = level.value;

      number.style.cssText =
        "width:88px;max-width:100%;padding:7px;background:#172744;color:white;border:1px solid #465b87;border-radius:6px";

      number.addEventListener(
        "change",
        () => {
          const n =
            Number(number.value);

          if (
            !Number.isFinite(n) ||
            n < 0 ||
            n > 20
          ) {
            number.value =
              level.value;

            return;
          }

          level.value = n;

          settings.levels.sort(
            (a, b) =>
              a.value - b.value
          );

          save();
          renderLevels();
          requestDraw();
        }
      );

      const color =
        document.createElement("input");

      color.type = "color";
      color.value = level.color;

      color.addEventListener(
        "change",
        () => {
          level.color = color.value;
          save();
          requestDraw();
        }
      );

      const remove = button(
        "✕",
        () => {
          settings.levels =
            settings.levels.filter(
              item => item !== level
            );

          save();
          renderLevels();
          requestDraw();
        },
        row
      );

      remove.style.padding =
        "7px 10px";

      row.prepend(
        visible,
        number,
        color
      );

      host.appendChild(row);
    }
  }

  function settingCheck(
    parent,
    label,
    name
  ) {
    const row =
      document.createElement("label");

    row.style.cssText =
      "display:flex;align-items:center;gap:9px;margin:12px 0";

    const input =
      document.createElement("input");

    input.type = "checkbox";
    input.checked = !!settings[name];

    input.addEventListener(
      "change",
      () => {
        settings[name] =
          input.checked;

        save();
        requestDraw();
      }
    );

    row.append(
      input,
      document.createTextNode(label)
    );

    parent.appendChild(row);
  }

  function settingNumber(
    parent,
    label,
    name
  ) {
    const row =
      document.createElement("label");

    row.style.cssText =
      "display:flex;align-items:center;justify-content:space-between;gap:10px;margin:12px 0";

    const input =
      document.createElement("input");

    input.type = "number";
    input.step = "any";
    input.value = settings[name];

    input.style.cssText =
      "width:90px;padding:7px;background:#172744;color:white;border:1px solid #465b87;border-radius:6px";

    input.addEventListener(
      "change",
      () => {
        const n =
          Number(input.value);

        if (Number.isFinite(n)) {
          settings[name] = n;
          save();
          requestDraw();
        } else {
          input.value =
            settings[name];
        }
      }
    );

    row.append(
      document.createTextNode(label),
      input
    );

    parent.appendChild(row);
  }

  function buildUI() {
    const area =
      $("priceChartArea");

    if (!area) return false;

    if (
      $("fibToolbar") &&
      $("fibonacciCanvas")
    ) {
      canvas =
        $("fibonacciCanvas");

      return true;
    }

    const oldToolbar =
      $("fibToolbar");

    const oldPanel =
      $("fibPanel");

    const oldCanvas =
      $("fibonacciCanvas");

    oldToolbar?.remove();
    oldPanel?.remove();
    oldCanvas?.remove();

    area.style.position = "relative";

    canvas =
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

    const toolbar =
      document.createElement("div");

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

    const panel =
      document.createElement("div");

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
      toggleDrawing,
      toolbar,
      "fibDraw"
    );

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
        settings.visible =
          !settings.visible;

        save();
        requestDraw();

        status(
          settings.visible
            ? "Fibonacci visible."
            : "Fibonacci oculto."
        );
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
        requestDraw();

        status(
          "Fibonacci eliminado de este mercado."
        );
      },
      toolbar,
      "fibErase"
    );

    const state =
      document.createElement("div");

    state.id = "fibStatus";

    state.style.cssText = [
      "width:100%",
      "color:#a5b0cf",
      "padding:4px 0",
      "line-height:1.5"
    ].join(";");

    state.textContent =
      "Fibonacci V5 iniciando...";

    toolbar.appendChild(state);

    const heading =
      document.createElement("h3");

    heading.textContent =
      "Fibonacci · Configuración";

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

    const levelsTitle =
      document.createElement("h4");

    levelsTitle.textContent =
      "Niveles personalizados";

    panel.appendChild(levelsTitle);

    const levels =
      document.createElement("div");

    levels.id = "fibLevels";

    panel.appendChild(levels);

    button(
      "+ Agregar nivel",
      () => {
        const existing =
          settings.levels.map(
            x => x.value
          );

        let next = 1.414;

        while (
          existing.includes(next)
        ) {
          next = Number(
            (next + 0.001).toFixed(3)
          );
        }

        settings.levels.push({
          value: next,
          visible: true,
          color: "#bb52ff"
        });

        settings.levels.sort(
          (a, b) =>
            a.value - b.value
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

        status(
          "Niveles restablecidos."
        );
      },
      panel
    );

    area.parentNode.insertBefore(
      toolbar,
      area
    );

    area.parentNode.insertBefore(
      panel,
      area
    );

    renderLevels();

    if (
      window.ResizeObserver &&
      !resizeObserver
    ) {
      resizeObserver =
        new ResizeObserver(
          requestDraw
        );

      resizeObserver.observe(area);
    }

    window.addEventListener(
      "resize",
      requestDraw
    );

    for (const id of [
      "symbol",
      "interval",
      "exchange",
      "market"
    ]) {
      $(id)?.addEventListener(
        "change",
        () => {
          firstPoint = null;
          dragging = null;
          activePointer = null;

          status(
            "Mercado cambiado. Mostrando su Fibonacci guardado."
          );

          requestDraw();
        }
      );
    }

    requestDraw();

    return true;
  }

  function attachChart(created) {
    if (!created || chart === created) {
      return;
    }

    chart = created;
    candle = null;
    attached = true;

    const originalAdd =
      created.addCandlestickSeries;

    if (
      typeof originalAdd === "function" &&
      !created.__CL_FIB_SERIES_V5__
    ) {
      created.addCandlestickSeries =
        function (...args) {
          const result =
            originalAdd.apply(
              this,
              args
            );

          attachCandle(result);

          return result;
        };

      created.__CL_FIB_SERIES_V5__ =
        true;
    }

    try {
      created.timeScale()
        .subscribeVisibleLogicalRangeChange(
          requestDraw
        );
    } catch (error) {
      console.warn(
        "Fibonacci: escala",
        error
      );
    }

    status(
      "Gráfica conectada. Preparando velas..."
    );

    requestDraw();
  }

  function attachCandle(created) {
    if (!created || candle === created) {
      return;
    }

    candle = created;

    for (const method of [
      "setData",
      "update"
    ]) {
      const original =
        created[method];

      if (
        typeof original !== "function"
      ) {
        continue;
      }

      created[method] =
        function (...args) {
          const result =
            original.apply(
              this,
              args
            );

          requestDraw();

          return result;
        };
    }

    status(
      "Fibonacci V5 conectado. Pulsa Dibujar / mover."
    );

    requestDraw();
  }

  function installHook() {
    const library =
      window.LightweightCharts;

    if (
      !library ||
      typeof library.createChart !==
        "function"
    ) {
      return false;
    }

    if (
      library.__CL_FIB_HOOK_V5__
    ) {
      return true;
    }

    const original =
      library.createChart;

    library.createChart =
      function (element, ...args) {
        const result =
          original.call(
            this,
            element,
            ...args
          );

        if (
          element?.id === "chart"
        ) {
          attachChart(result);
        }

        return result;
      };

    library.__CL_FIB_HOOK_V5__ =
      true;

    return true;
  }

  function start() {
    const uiReady = buildUI();
    const hookReady = installHook();

    if (!uiReady) {
      console.error(
        "Fibonacci V5: falta #priceChartArea"
      );
      return;
    }

    if (!hookReady) {
      status(
        "Esperando biblioteca Lightweight Charts...",
        true
      );
    } else if (!chart) {
      status(
        "Fibonacci cargado. Esperando creación de gráfica..."
      );
    }

    if (retryTimer) return;

    retryTimer = setInterval(() => {
      attempts++;

      if (!$("fibToolbar")) {
        buildUI();
      }

      if (!chart) {
        installHook();
      }

      if (chart && candle) {
        status(
          "Fibonacci V5 conectado. Pulsa Dibujar / mover."
        );

        clearInterval(retryTimer);
        retryTimer = null;
      } else if (attempts >= 30) {
        clearInterval(retryTimer);
        retryTimer = null;

        status(
          chart
            ? "Fibonacci visible, pero no se detectó la serie de velas."
            : "Fibonacci visible, pero no se detectó la gráfica. Comprueba la carga de app.js.",
          true
        );
      }

      requestDraw();
    }, 1000);
  }

  load();

  // Se instala antes de que APP.JS cree
  // la gráfica, cuando el orden de scripts
  // del index.html es correcto.
  installHook();

  if (
    document.readyState === "loading"
  ) {
    document.addEventListener(
      "DOMContentLoaded",
      start
    );
  } else {
    start();
  }

  window.CryptolexuzFibonacci = {
    version: "5",

    getSettings: () =>
      JSON.parse(
        JSON.stringify(settings)
      ),

    updateSettings: changes => {
      if (
        !changes ||
        typeof changes !== "object"
      ) {
        return;
      }

      settings = {
        ...settings,
        ...changes
      };

      save();
      renderLevels();
      requestDraw();
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

    setLevel: (
      value,
      changes = {}
    ) => {
      const n = Number(value);

      if (!Number.isFinite(n)) {
        return;
      }

      let level =
        settings.levels.find(
          x => x.value === n
        );

      if (level) {
        Object.assign(
          level,
          changes
        );
      } else {
        settings.levels.push({
          value: n,
          visible: true,
          color: "#bb52ff",
          ...changes
        });
      }

      settings.levels.sort(
        (a, b) =>
          a.value - b.value
      );

      save();
      renderLevels();
      requestDraw();
    },

    removeLevel: value => {
      settings.levels =
        settings.levels.filter(
          x =>
            x.value !== Number(value)
        );

      save();
      renderLevels();
      requestDraw();
    },

    redraw: requestDraw,

    isConnected: () =>
      !!(chart && candle)
  };

  console.info(
    "CRYPTOLEXUZ PRO — Fibonacci V5 cargado"
  );
})();
