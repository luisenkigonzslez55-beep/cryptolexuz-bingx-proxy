
/*
 CRYPTOLEXUZ PRO — FIBONACCI.JS V7
 Compatible con app.js V15 y Lightweight Charts 4.2.2.
 Anclas por tiempo de vela, dibujo táctil, niveles
 configurables y caja verde BitLobo.
*/
"use strict";

(() => {
  const $ = id => document.getElementById(id);
  const STORE = "cryptolexuz_fibonacci_v7";
  const OLD_STORE = "cryptolexuz_fibonacci_v2";

  const BASE_LEVELS = [
    0, 0.236, 0.382, 0.5, 0.618,
    0.65, 0.705, 0.786, 0.88, 1,
    1.272, 1.618, 2, 2.618, 3.618, 4.236
  ];

  function defaults() {
    return {
      visible: true,
      showLabels: true,
      showBox: true,
      reverse: false,
      lineWidth: 1,
      color: "#bb52ff",
      boxColor: "#22c55e",
      boxUpper: 0.7362,
      boxMiddle: 0.7148,
      boxLower: 0.6935,
      levels: BASE_LEVELS.map(value => ({
        value,
        visible: true,
        color: [0.618,0.786,0.88,1.618].includes(value)
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
  let panel = null;

  let getRows = () => [];
  let getSelection = null;

  let drawing = false;
  let first = null;
  let dragging = null;
  let raf = 0;
  let lastMarket = "";
  let initialized = false;

  function clone(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  function load() {
    try {
      const saved = JSON.parse(
        localStorage.getItem(STORE) || "null"
      );

      const old = JSON.parse(
        localStorage.getItem(OLD_STORE) || "null"
      );

      const source = saved || old;

      if(source && typeof source === "object") {
        settings = {
          ...defaults(),
          ...source
        };

        if(!Array.isArray(source.levels)) {
          settings.levels = defaults().levels;
        }
      }

      const savedDrawings = JSON.parse(
        localStorage.getItem(STORE + "_drawings") ||
        localStorage.getItem(OLD_STORE + "_drawings") ||
        "{}"
      );

      if(
        savedDrawings &&
        typeof savedDrawings === "object"
      ) {
        drawings = savedDrawings;
      }
    } catch(error) {
      console.warn("Fibonacci: no se pudo leer memoria",error);
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
    } catch(error) {
      console.warn("Fibonacci: no se pudo guardar",error);
    }
  }

  function selection() {
    if(typeof getSelection === "function") {
      try {
        return getSelection();
      } catch(_) {}
    }

    const symbol = $("symbol")?.value || "BTC-USDT";
    const commodity = /NCCO/.test(symbol);

    return {
      symbol,
      exchange: commodity
        ? "bingx"
        : $("exchange")?.value || "bingx",
      market: commodity
        ? "perpetual"
        : $("market")?.value || "perpetual",
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
      const data = getRows();
      return Array.isArray(data) ? data : [];
    } catch(_) {
      return [];
    }
  }

  function timeNumber(time) {
    if(typeof time === "number") return time;

    if(typeof time === "string") {
      const n = Number(time);
      if(Number.isFinite(n)) return n;

      const date = Date.parse(time);
      return Number.isFinite(date)
        ? Math.floor(date/1000)
        : null;
    }

    return null;
  }

  function nearestIndex(logical) {
    const data = rows();
    if(!data.length) return -1;

    return Math.max(
      0,
      Math.min(
        data.length-1,
        Math.round(logical)
      )
    );
  }

  function anchorFromPoint(p) {
    const data = rows();
    const index = nearestIndex(p.logical);

    if(index<0 || !data[index]) return null;

    return {
      time: data[index].time,
      price: p.price
    };
  }

  function migrateAnchor(anchor) {
    if(!anchor) return null;

    if(
      anchor.time !== undefined &&
      anchor.time !== null
    ) {
      return {
        time: anchor.time,
        price: Number(anchor.price)
      };
    }

    if(Number.isFinite(Number(anchor.logical))) {
      const index = nearestIndex(Number(anchor.logical));
      const data = rows();

      if(index>=0 && data[index]) {
        return {
          time: data[index].time,
          price: Number(anchor.price)
        };
      }
    }

    return null;
  }

  function active() {
    const d = drawings[currentKey()];
    if(!d) return null;

    const a = migrateAnchor(d.a);
    const b = migrateAnchor(d.b);

    if(!a || !b) return null;

    if(
      !Number.isFinite(a.price) ||
      !Number.isFinite(b.price) ||
      a.price<=0 ||
      b.price<=0
    ) return null;

    if(
      d.a.time === undefined ||
      d.b.time === undefined
    ) {
      drawings[currentKey()] = {a,b};
      persist();
    }

    return {a,b};
  }

  function saveDrawing(d) {
    drawings[currentKey()] = d;
    persist();
    redraw();
  }

  function priceAt(a,b,ratio) {
    return a + (b-a)*ratio;
  }

  function calculate() {
    const d = active();
    if(!d) return null;

    const start = settings.reverse
      ? d.b.price
      : d.a.price;

    const end = settings.reverse
      ? d.a.price
      : d.b.price;

    const levels = settings.levels
      .filter(x => x.visible)
      .map(x => ({
        ...x,
        price: priceAt(start,end,Number(x.value))
      }));

    const box = settings.showBox
      ? {
          upper: priceAt(
            start,end,Number(settings.boxUpper)
          ),
          middle: priceAt(
            start,end,Number(settings.boxMiddle)
          ),
          lower: priceAt(
            start,end,Number(settings.boxLower)
          )
        }
      : null;

    return {
      anchors:d,
      levels,
      box
    };
  }

  function coordinateForTime(time) {
    if(!chart) return null;

    const data = rows();
    const target = timeNumber(time);

    if(target===null) return null;

    let index = data.findIndex(
      x => timeNumber(x.time) === target
    );

    if(index<0) {
      return null;
    }

    return chart.timeScale()
      .logicalToCoordinate(index);
  }

  function coordinateForAnchor(anchor) {
    if(!candle) return null;

    const x = coordinateForTime(anchor.time);
    const y = candle.priceToCoordinate(anchor.price);

    if(
      !Number.isFinite(x) ||
      !Number.isFinite(y)
    ) return null;

    return {x,y};
  }

  function redraw() {
    if(raf) return;

    raf = requestAnimationFrame(() => {
      raf = 0;
      paint();
    });
  }

  function paint() {
    if(!canvas || !chart || !candle) return;

    const rect = canvas.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;

    if(width<=0 || height<=0) return;

    const ratio = Math.min(
      window.devicePixelRatio || 1,
      2
    );

    const realWidth = Math.round(width*ratio);
    const realHeight = Math.round(height*ratio);

    if(
      canvas.width !== realWidth ||
      canvas.height !== realHeight
    ) {
      canvas.width = realWidth;
      canvas.height = realHeight;
    }

    const ctx = canvas.getContext("2d");
    if(!ctx) return;

    ctx.setTransform(ratio,0,0,ratio,0,0);
    ctx.clearRect(0,0,width,height);

    if(!settings.visible) return;

    const result = calculate();
    if(!result) return;

    const a = coordinateForAnchor(result.anchors.a);
    const b = coordinateForAnchor(result.anchors.b);

    if(!a || !b) return;

    const left = Math.max(0,Math.min(a.x,b.x));
    const right = Math.min(
      width,
      Math.max(a.x,b.x)
    );

    if(right<=left) return;

    const box = result.box;

    if(box) {
      const upper = candle.priceToCoordinate(box.upper);
      const lower = candle.priceToCoordinate(box.lower);
      const middle = candle.priceToCoordinate(box.middle);

      if(
        Number.isFinite(upper) &&
        Number.isFinite(lower)
      ) {
        ctx.fillStyle = "rgba(34,197,94,.15)";

        ctx.fillRect(
          left,
          Math.min(upper,lower),
          right-left,
          Math.abs(upper-lower)
        );

        ctx.strokeStyle = settings.boxColor;
        ctx.lineWidth = 1;
        ctx.setLineDash([4,4]);

        for(const [y,label] of [
          [upper,"Caja superior"],
          [middle,"Mitad de caja"],
          [lower,"Caja inferior"]
        ]) {
          if(!Number.isFinite(y)) continue;

          ctx.beginPath();
          ctx.moveTo(left,y);
          ctx.lineTo(right,y);
          ctx.stroke();

          if(settings.showLabels) {
            ctx.font = "11px system-ui";
            ctx.fillStyle = settings.boxColor;

            ctx.fillText(
              label,
              Math.max(4,left+5),
              Math.max(12,y-4)
            );
          }
        }

        ctx.setLineDash([]);
      }
    }

    ctx.lineWidth = Math.max(
      1,
      Math.min(4,Number(settings.lineWidth)||1)
    );

    for(const level of result.levels) {
      const y = candle.priceToCoordinate(level.price);

      if(
        !Number.isFinite(y) ||
        y < -20 ||
        y > height+20
      ) continue;

      const color = level.color || settings.color;

      ctx.strokeStyle = color;
      ctx.beginPath();
      ctx.moveTo(left,y);
      ctx.lineTo(right,y);
      ctx.stroke();

      if(settings.showLabels) {
        const label =
          Number(level.value).toFixed(4)
            .replace(/0+$/,"")
            .replace(/\.$/,"") +
          " · " +
          Number(level.price).toLocaleString(
            "en-US",
            {maximumFractionDigits:6}
          );

        ctx.font = "11px system-ui";

        const textWidth = ctx.measureText(label).width;

        const x = Math.max(
          3,
          Math.min(
            width-textWidth-6,
            right-textWidth-5
          )
        );

        ctx.fillStyle = "rgba(8,14,32,.92)";
        ctx.fillRect(
          x-2,y-14,textWidth+5,15
        );

        ctx.fillStyle = color;
        ctx.fillText(label,x,y-3);
      }
    }

    ctx.strokeStyle = "#e4eaff";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5,4]);

    ctx.beginPath();
    ctx.moveTo(a.x,a.y);
    ctx.lineTo(b.x,b.y);
    ctx.stroke();

    ctx.setLineDash([]);

    for(const p of [a,b]) {
      ctx.beginPath();
      ctx.arc(p.x,p.y,7,0,Math.PI*2);

      ctx.fillStyle = "#10182d";
      ctx.fill();

      ctx.lineWidth = 2;
      ctx.strokeStyle = "#ffffff";
      ctx.stroke();
    }

    if(first) {
      const p = coordinateForAnchor(first);

      if(p) {
        ctx.beginPath();
        ctx.arc(p.x,p.y,7,0,Math.PI*2);
        ctx.fillStyle = "#22c55e";
        ctx.fill();
      }
    }
  }

  function pointerPoint(event) {
    if(!canvas || !chart || !candle) return null;

    const rect = canvas.getBoundingClientRect();

    const x = event.clientX-rect.left;
    const y = event.clientY-rect.top;

    const logical = chart.timeScale()
      .coordinateToLogical(x);

    const price = candle.coordinateToPrice(y);

    if(
      !Number.isFinite(logical) ||
      !Number.isFinite(price) ||
      price<=0
    ) return null;

    return {
      x,y,logical,price
    };
  }

  function status(message) {
    const el = $("fibStatus");
    if(el) el.textContent = message;
  }

  function begin(event) {
    if(
      !drawing ||
      !chart ||
      !candle ||
      !canvas
    ) return;

    const p = pointerPoint(event);
    if(!p) return;

    const d = active();
    dragging = null;

    if(d) {
      for(const key of ["a","b"]) {
        const handle = coordinateForAnchor(d[key]);

        if(
          handle &&
          Math.hypot(
            p.x-handle.x,
            p.y-handle.y
          )<25
        ) {
          dragging = key;
          break;
        }
      }
    }

    if(dragging) {
      try {
        canvas.setPointerCapture(event.pointerId);
      } catch(_) {}

      status("Moviendo extremo del Fibonacci...");
    } else {
      const anchor = anchorFromPoint(p);
      if(!anchor) return;

      if(!first) {
        first = anchor;

        status(
          "Primer punto colocado. Toca el segundo extremo."
        );
      } else {
        saveDrawing({
          a:first,
          b:anchor
        });

        first = null;

        status(
          "Fibonacci guardado. Puedes mover sus extremos."
        );
      }
    }

    event.preventDefault();
    redraw();
  }

  function move(event) {
    if(!drawing || !dragging) return;

    const p = pointerPoint(event);
    if(!p) return;

    const d = active();
    if(!d) return;

    const anchor = anchorFromPoint(p);
    if(!anchor) return;

    d[dragging] = anchor;

    drawings[currentKey()] = d;

    redraw();
    event.preventDefault();
  }

  function end() {
    if(dragging) {
      persist();
    }

    dragging = null;
  }

  function toggleDraw() {
    drawing = !drawing;
    first = null;
    dragging = null;

    if(canvas) {
      canvas.style.pointerEvents = drawing
        ? "auto"
        : "none";

      canvas.style.touchAction = drawing
        ? "none"
        : "auto";
    }

    const button = $("fibDraw");

    if(button) {
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
        ? "Toca dos velas para dibujar. Arrastra los círculos para ajustar."
        : "Dibujo desactivado. Puedes mover la gráfica con un dedo."
    );

    redraw();
  }

  function makeButton(label,id,parent,callback) {
    const button = document.createElement("button");

    button.type = "button";
    button.id = id;
    button.textContent = label;

    button.style.cssText = [
      "background:#243b60",
      "color:#fff",
      "border:1px solid #42547c",
      "border-radius:8px",
      "padding:9px 10px",
      "font:inherit"
    ].join(";");

    button.addEventListener("click",callback);
    parent.appendChild(button);

    return button;
  }

  function addCheckbox(parent,label,key) {
    const line = document.createElement("label");

    line.style.cssText =
      "display:flex;gap:8px;align-items:center;margin:8px 0";

    const input = document.createElement("input");

    input.type = "checkbox";
    input.checked = Boolean(settings[key]);

    input.addEventListener("change",() => {
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

  function addNumber(parent,label,key) {
    const line = document.createElement("label");

    line.style.cssText = [
      "display:flex",
      "justify-content:space-between",
      "gap:8px",
      "align-items:center",
      "margin:8px 0"
    ].join(";");

    const input = document.createElement("input");

    input.type = "number";
    input.step = "any";
    input.value = settings[key];
    input.style.width = "95px";

    input.addEventListener("change",() => {
      const n = Number(input.value);

      if(Number.isFinite(n)) {
        settings[key] = n;
        persist();
        redraw();
      } else {
        input.value = settings[key];
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
    if(!host) return;

    host.replaceChildren();

    for(const level of settings.levels) {
      const row = document.createElement("div");

      row.style.cssText = [
        "display:flex",
        "gap:7px",
        "align-items:center",
        "margin:6px 0"
      ].join(";");

      const check = document.createElement("input");
      check.type = "checkbox";
      check.checked = Boolean(level.visible);

      check.addEventListener("change",() => {
        level.visible = check.checked;
        persist();
        redraw();
      });

      const input = document.createElement("input");

      input.type = "number";
      input.step = "any";
      input.value = level.value;

      input.style.cssText =
        "width:85px;min-width:0";

      input.addEventListener("change",() => {
        const n = Number(input.value);

        if(
          !Number.isFinite(n) ||
          n<0 ||
          n>20
        ) {
          input.value = level.value;
          return;
        }

        level.value = n;

        settings.levels.sort(
          (a,b) => a.value-b.value
        );

        persist();
        redraw();
        renderLevels();
      });

      const color = document.createElement("input");

      color.type = "color";

      color.value = /^#[0-9a-f]{6}$/i.test(level.color)
        ? level.color
        : settings.color;

      color.addEventListener("change",() => {
        level.color = color.value;
        persist();
        redraw();
      });

      const remove = document.createElement("button");

      remove.type = "button";
      remove.textContent = "✕";

      remove.addEventListener("click",() => {
        settings.levels = settings.levels.filter(
          x => x!==level
        );

        persist();
        redraw();
        renderLevels();
      });

      row.append(check,input,color,remove);
      host.appendChild(row);
    }
  }

  function buildUI() {
    if(initialized) return;

    const area = $("priceChartArea");
    const host = $("chartSection");

    if(!area || !host) {
      console.warn(
        "Fibonacci: falta priceChartArea o chartSection"
      );
      return;
    }

    initialized = true;
    area.style.position = "relative";

    const existing = $("fibonacciCanvas");

    canvas = existing ||
      document.createElement("canvas");

    canvas.id = "fibonacciCanvas";

    canvas.style.cssText = [
      "position:absolute",
      "inset:0",
      "width:100%",
      "height:100%",
      "z-index:8",
      "pointer-events:none",
      "touch-action:auto"
    ].join(";");

    if(!existing) {
      area.appendChild(canvas);
    }

    canvas.addEventListener("pointerdown",begin);
    canvas.addEventListener("pointermove",move);
    canvas.addEventListener("pointerup",end);
    canvas.addEventListener("pointercancel",end);

    const toolbar = document.createElement("div");

    toolbar.id = "fibToolbar";

    toolbar.style.cssText = [
      "display:flex",
      "flex-wrap:wrap",
      "gap:7px",
      "margin:10px 0",
      "color:#dbe7ff",
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

        if(!panel.hidden) {
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
          "Trazado eliminado de este activo y temporalidad."
        );
      }
    );

    const info = document.createElement("span");

    info.id = "fibStatus";

    info.style.cssText =
      "width:100%;color:#a5b0cf";

    info.textContent =
      "Pulsa Dibujar / mover para colocar Fibonacci.";

    toolbar.appendChild(info);

    panel = document.createElement("div");
    panel.id = "fibPanel";
    panel.hidden = true;

    panel.style.cssText = [
      "background:#101a32",
      "color:#e3ebff",
      "border:1px solid #34466c",
      "border-radius:12px",
      "padding:12px",
      "margin:8px 0",
      "font:13px system-ui"
    ].join(";");

    const heading = document.createElement("strong");

    heading.textContent =
      "Fibonacci V7 · Configuración BitLobo";

    panel.appendChild(heading);

    addCheckbox(
      panel,
      "Mostrar etiquetas",
      "showLabels"
    );

    addCheckbox(
      panel,
      "Mostrar caja verde BitLobo",
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
      "Mitad de caja",
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
          value:1.414,
          visible:true,
          color:settings.color
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

    const controls = host.querySelector(
      ".chart-controls"
    );

    const insertionPoint = controls || area;

    insertionPoint.insertAdjacentElement(
      "afterend",
      toolbar
    );

    toolbar.insertAdjacentElement(
      "afterend",
      panel
    );

    if(window.ResizeObserver) {
      new ResizeObserver(redraw).observe(area);
    }

    window.addEventListener("resize",redraw);

    for(const id of [
      "symbol",
      "interval",
      "market",
      "exchange"
    ]) {
      $(id)?.addEventListener("change",() => {
        first = null;
        dragging = null;
        lastMarket = currentKey();

        status(
          "Mercado cambiado. Se cargará su trazado guardado."
        );

        redraw();
      });
    }

    renderLevels();
    redraw();
  }

  function attach(newChart,newCandle,options={}) {
    if(!newChart || !newCandle) return;

    const changed =
      chart!==newChart ||
      candle!==newCandle;

    chart = newChart;
    candle = newCandle;

    if(typeof options.getRows==="function") {
      getRows = options.getRows;
    }

    if(typeof options.getSelection==="function") {
      getSelection = options.getSelection;
    }

    if(changed) {
      chart.timeScale()
        .subscribeVisibleLogicalRangeChange(redraw);
    }

    if(document.readyState==="loading") {
      document.addEventListener(
        "DOMContentLoaded",
        buildUI,
        {once:true}
      );
    } else {
      buildUI();
    }

    redraw();
  }

  function resetSettings() {
    settings = defaults();

    persist();
    renderLevels();
    redraw();
  }

  function setLevel(v,changes={}) {
    const number = Number(v);

    if(!Number.isFinite(number)) return;

    let level = settings.levels.find(
      x => Number(x.value)===number
    );

    if(level) {
      Object.assign(level,changes);
    } else {
      settings.levels.push({
        value:number,
        visible:true,
        color:settings.color,
        ...changes
      });
    }

    settings.levels.sort(
      (a,b) => a.value-b.value
    );

    persist();
    renderLevels();
    redraw();
  }

  function removeLevel(v) {
    settings.levels = settings.levels.filter(
      x => Number(x.value)!==Number(v)
    );

    persist();
    renderLevels();
    redraw();
  }

  load();

  window.CryptolexuzFibonacci = {
    version:"7",
    attach,
    redraw,
    calculate,
    priceAt,

    getSettings:() => clone(settings),

    updateSettings:changes => {
      settings = {
        ...settings,
        ...changes
      };

      persist();
      renderLevels();
      redraw();
    },

    reset:resetSettings,
    setLevel,
    removeLevel,

    getDrawing:() => clone(active()),

    clearDrawing:() => {
      delete drawings[currentKey()];
      first = null;
      persist();
      redraw();
    }
  };

  window.addEventListener(
    "cryptolexuz:chart-ready",
    event => {
      const detail = event.detail || {};

      attach(
        detail.chart,
        detail.candle
      );
    }
  );

  console.info(
    "CRYPTOLEXUZ PRO — Fibonacci V7 cargado"
  );
})();
