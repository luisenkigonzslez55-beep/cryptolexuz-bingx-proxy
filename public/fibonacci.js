
/*
 CRYPTOLEXUZ PRO — FIBONACCI V4
 Compatible con APP.JS V14
 Lightweight Charts 4.2.2

 - Barra de herramientas visible
 - Dibujo táctil con dos puntos
 - Extremos arrastrables
 - Retrocesos y extensiones
 - Caja verde BitLobo
 - Niveles personalizables
 - Guardado por activo y temporalidad
 - Sin ejecución de órdenes
*/

(function(){
"use strict";

if(window.__CL_FIB_V4__) return;
window.__CL_FIB_V4__ = true;

const $ = id => document.getElementById(id);
const STORE = "cryptolexuz_fibonacci_v3";

const RATIOS = [
  0,0.236,0.382,0.5,0.618,
  0.65,0.705,0.786,0.88,
  1,1.272,1.618,2,2.618,
  3.618,4.236
];

const IMPORTANT = new Set([
  0.618,0.786,0.88,1.618
]);

function defaults(){
  return {
    visible:true,
    labels:true,
    box:true,
    reverse:false,
    boxUpper:0.7362,
    boxMiddle:0.7148,
    boxLower:0.6935,
    levels:RATIOS.map(value=>({
      value,
      visible:true,
      color:IMPORTANT.has(value)
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
let retryTimer = null;
let retryCount = 0;

function safeNumber(value,fallback){
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function load(){
  try{
    const saved = JSON.parse(
      localStorage.getItem(STORE)
    );

    if(saved && typeof saved==="object"){
      settings = {
        ...defaults(),
        ...saved
      };

      if(!Array.isArray(settings.levels)){
        settings.levels = defaults().levels;
      }

      settings.levels = settings.levels
        .filter(x=>
          x &&
          Number.isFinite(Number(x.value))
        )
        .map(x=>({
          value:Number(x.value),
          visible:x.visible!==false,
          color:/^#[0-9a-f]{6}$/i.test(x.color)
            ? x.color
            : "#bb52ff"
        }));
    }

    const stored = JSON.parse(
      localStorage.getItem(STORE+"_drawings")
    );

    if(
      stored &&
      typeof stored==="object" &&
      !Array.isArray(stored)
    ){
      drawings = stored;
    }
  }catch(error){
    console.warn(
      "Fibonacci: error al cargar",
      error
    );
  }
}

function save(){
  try{
    localStorage.setItem(
      STORE,
      JSON.stringify(settings)
    );

    localStorage.setItem(
      STORE+"_drawings",
      JSON.stringify(drawings)
    );
  }catch(error){
    console.warn(
      "Fibonacci: error al guardar",
      error
    );
  }
}

function marketKey(){
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

function currentDrawing(){
  return drawings[marketKey()] || null;
}

function priceAt(a,b,ratio){
  return a+(b-a)*ratio;
}

function levelsFor(d){
  if(!d) return [];

  const start = settings.reverse
    ? d.b.price
    : d.a.price;

  const end = settings.reverse
    ? d.a.price
    : d.b.price;

  return settings.levels
    .filter(x=>x.visible)
    .map(x=>({
      ...x,
      price:priceAt(
        start,end,x.value
      )
    }));
}

function status(message){
  const el = $("fibStatus");

  if(el){
    el.textContent = message;
  }
}

function requestDraw(){
  if(frame) return;

  frame = requestAnimationFrame(()=>{
    frame = 0;
    paint();
  });
}

function coordinates(point){
  if(!point || !chart || !candle){
    return null;
  }

  let x,y;

  try{
    x = chart.timeScale()
      .logicalToCoordinate(point.logical);

    y = candle.priceToCoordinate(
      point.price
    );
  }catch(_){
    return null;
  }

  if(
    !Number.isFinite(x) ||
    !Number.isFinite(y)
  ){
    return null;
  }

  return {x,y};
}

function drawHandle(ctx,point,color){
  const p = coordinates(point);

  if(!p) return;

  ctx.beginPath();
  ctx.arc(p.x,p.y,7,0,Math.PI*2);

  ctx.fillStyle = "#10182d";
  ctx.fill();

  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.stroke();
}

function paint(){
  if(!canvas) return;

  const rect = canvas.getBoundingClientRect();

  const width = rect.width;
  const height = rect.height;

  if(width<=0 || height<=0) return;

  const dpr = Math.min(
    window.devicePixelRatio || 1,
    2
  );

  const pw = Math.round(width*dpr);
  const ph = Math.round(height*dpr);

  if(
    canvas.width!==pw ||
    canvas.height!==ph
  ){
    canvas.width = pw;
    canvas.height = ph;
  }

  const ctx = canvas.getContext("2d");

  if(!ctx) return;

  ctx.setTransform(dpr,0,0,dpr,0,0);
  ctx.clearRect(0,0,width,height);

  if(!chart || !candle) return;

  if(firstPoint && drawingMode){
    drawHandle(
      ctx,
      firstPoint,
      "#ffe15a"
    );
  }

  const d = currentDrawing();

  if(!d || !settings.visible) return;

  const a = coordinates(d.a);
  const b = coordinates(d.b);

  if(!a || !b) return;

  const left = Math.max(
    0,
    Math.min(a.x,b.x)
  );

  const right = Math.min(
    width,
    Math.max(a.x,b.x)
  );

  if(right<=left) return;

  const startPrice = settings.reverse
    ? d.b.price
    : d.a.price;

  const endPrice = settings.reverse
    ? d.a.price
    : d.b.price;

  if(settings.box){
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

    const yu = candle.priceToCoordinate(upper);
    const ym = candle.priceToCoordinate(middle);
    const yl = candle.priceToCoordinate(lower);

    if(
      Number.isFinite(yu) &&
      Number.isFinite(yl)
    ){
      ctx.fillStyle =
        "rgba(22,163,74,.17)";

      ctx.fillRect(
        left,
        Math.min(yu,yl),
        right-left,
        Math.abs(yu-yl)
      );

      ctx.strokeStyle = "#22c55e";
      ctx.lineWidth = 1;
      ctx.setLineDash([5,4]);

      for(const y of [yu,ym,yl]){
        if(!Number.isFinite(y)) continue;

        ctx.beginPath();
        ctx.moveTo(left,y);
        ctx.lineTo(right,y);
        ctx.stroke();
      }

      ctx.setLineDash([]);
    }
  }

  for(const level of levelsFor(d)){
    const y = candle.priceToCoordinate(
      level.price
    );

    if(
      !Number.isFinite(y) ||
      y<0 ||
      y>height
    ){
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
    ctx.moveTo(left,y);
    ctx.lineTo(right,y);
    ctx.stroke();

    if(settings.labels){
      const ratio = String(level.value);

      const price =
        level.price.toLocaleString(
          "en-US",
          {maximumFractionDigits:6}
        );

      const label = ratio+" · "+price;

      ctx.font = "11px system-ui";

      const tw =
        ctx.measureText(label).width;

      const x = Math.max(
        4,
        Math.min(
          width-tw-8,
          right-tw-5
        )
      );

      ctx.fillStyle =
        "rgba(8,14,32,.94)";

      ctx.fillRect(
        x-2,
        y-14,
        tw+6,
        15
      );

      ctx.fillStyle = color;
      ctx.fillText(
        label,
        x,
        y-3
      );
    }
  }

  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 1.5;
  ctx.setLineDash([5,4]);

  ctx.beginPath();
  ctx.moveTo(a.x,a.y);
  ctx.lineTo(b.x,b.y);
  ctx.stroke();

  ctx.setLineDash([]);

  drawHandle(ctx,d.a,"#ffffff");
  drawHandle(ctx,d.b,"#ffffff");
}

function eventPoint(event){
  if(!canvas || !chart || !candle){
    return null;
  }

  const rect =
    canvas.getBoundingClientRect();

  const x = event.clientX-rect.left;
  const y = event.clientY-rect.top;

  let logical,price;

  try{
    logical = chart.timeScale()
      .coordinateToLogical(x);

    price = candle.coordinateToPrice(y);
  }catch(_){
    return null;
  }

  if(
    !Number.isFinite(logical) ||
    !Number.isFinite(price) ||
    price<=0
  ){
    return null;
  }

  return {x,y,logical,price};
}

function pointerDown(event){
  if(!drawingMode) return;

  if(
    activePointer!==null ||
    !event.isPrimary
  ){
    return;
  }

  const p = eventPoint(event);

  if(!p) return;

  activePointer = event.pointerId;
  dragging = null;

  const d = currentDrawing();

  if(d){
    for(const name of ["a","b"]){
      const anchor = coordinates(d[name]);

      if(
        anchor &&
        Math.hypot(
          p.x-anchor.x,
          p.y-anchor.y
        )<=28
      ){
        dragging = name;
        break;
      }
    }
  }

  try{
    canvas.setPointerCapture(
      event.pointerId
    );
  }catch(_){}

  if(dragging){
    status(
      "Arrastra el extremo seleccionado."
    );
  }else if(!firstPoint){
    firstPoint = {
      logical:p.logical,
      price:p.price
    };

    status(
      "Primer punto marcado. Toca el segundo extremo."
    );
  }else{
    drawings[marketKey()] = {
      a:firstPoint,
      b:{
        logical:p.logical,
        price:p.price
      }
    };

    firstPoint = null;

    save();

    status(
      "Fibonacci dibujado. Arrastra los extremos para ajustarlo."
    );
  }

  event.preventDefault();
  requestDraw();
}

function pointerMove(event){
  if(
    !drawingMode ||
    !dragging ||
    activePointer!==event.pointerId
  ){
    return;
  }

  const p = eventPoint(event);
  const d = currentDrawing();

  if(!p || !d) return;

  d[dragging] = {
    logical:p.logical,
    price:p.price
  };

  event.preventDefault();
  requestDraw();
}

function pointerEnd(event){
  if(
    activePointer!==null &&
    event.pointerId!==activePointer
  ){
    return;
  }

  if(dragging){
    save();
  }

  dragging = null;
  activePointer = null;

  requestDraw();
}

function toggleDrawing(){
  drawingMode = !drawingMode;

  firstPoint = null;
  dragging = null;
  activePointer = null;

  if(canvas){
    canvas.style.pointerEvents =
      drawingMode ? "auto" : "none";

    canvas.style.touchAction =
      drawingMode ? "none" : "auto";
  }

  const b = $("fibDraw");

  if(b){
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
      ? "Modo dibujo: toca dos puntos. Para navegar normalmente, pulsa Terminar dibujo."
      : "Modo dibujo desactivado. Navegación normal."
  );

  requestDraw();
}

function button(text,action,parent,id){
  const el = document.createElement("button");

  el.type = "button";
  el.textContent = text;

  if(id) el.id = id;

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

  el.addEventListener("click",action);
  parent.appendChild(el);

  return el;
}

function renderLevels(){
  const host = $("fibLevels");

  if(!host) return;

  host.replaceChildren();

  for(const level of settings.levels){
    const row = document.createElement("div");

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
      ()=>{
        level.visible = visible.checked;
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
      ()=>{
        const n = Number(number.value);

        if(
          !Number.isFinite(n) ||
          n<0 ||
          n>20
        ){
          number.value = level.value;
          return;
        }

        level.value = n;

        settings.levels.sort(
          (a,b)=>a.value-b.value
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
      ()=>{
        level.color = color.value;
        save();
        requestDraw();
      }
    );

    const remove = button(
      "✕",
      ()=>{
        settings.levels =
          settings.levels.filter(
            item=>item!==level
          );

        save();
        renderLevels();
        requestDraw();
      },
      row
    );

    remove.style.padding = "7px 10px";

    row.prepend(
      visible,
      number,
      color
    );

    host.appendChild(row);
  }
}

function settingCheck(parent,label,name){
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
    ()=>{
      settings[name] = input.checked;
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

function settingNumber(parent,label,name){
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
    ()=>{
      const n = Number(input.value);

      if(Number.isFinite(n)){
        settings[name] = n;
        save();
        requestDraw();
      }else{
        input.value = settings[name];
      }
    }
  );

  row.append(
    document.createTextNode(label),
    input
  );

  parent.appendChild(row);
}

function buildUI(){
  const area = $("priceChartArea");

  if(!area) return false;

  if($("fibToolbar")){
    canvas = $("fibonacciCanvas");
    return true;
  }

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

  const toolbar =
    document.createElement("div");

  toolbar.id = "fibToolbar";

  toolbar.style.cssText = [
    "display:flex",
    "flex-wrap:wrap",
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

  button(
    "✏️ Dibujar / mover",
    toggleDrawing,
    toolbar,
    "fibDraw"
  );

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
    "⚙️ Niveles",
    ()=>{
      panel.hidden = !panel.hidden;

      if(!panel.hidden){
        renderLevels();
      }
    },
    toolbar,
    "fibSettingsButton"
  );

  button(
    "👁 Mostrar / ocultar",
    ()=>{
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
    ()=>{
      delete drawings[marketKey()];

      firstPoint = null;
      dragging = null;

      save();
      requestDraw();

      status(
        "Trazado eliminado de este activo y temporalidad."
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
    "Fibonacci V4 listo. Pulsa Dibujar / mover.";

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
    ()=>{
      const existing =
        settings.levels.map(x=>x.value);

      let next = 1.414;

      while(existing.includes(next)){
        next = Number(
          (next+0.001).toFixed(3)
        );
      }

      settings.levels.push({
        value:next,
        visible:true,
        color:"#bb52ff"
      });

      settings.levels.sort(
        (a,b)=>a.value-b.value
      );

      save();
      renderLevels();
      requestDraw();
    },
    panel
  );

  button(
    "Restablecer niveles",
    ()=>{
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

  if(window.ResizeObserver){
    new ResizeObserver(
      requestDraw
    ).observe(area);
  }

  window.addEventListener(
    "resize",
    requestDraw
  );

  for(const id of [
    "symbol",
    "interval",
    "exchange",
    "market"
  ]){
    $(id)?.addEventListener(
      "change",
      ()=>{
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

/*
 Intercepta la creación de la gráfica
 y de la serie de velas.
*/

function connectToChart(){
  const library =
    window.LightweightCharts;

  if(
    !library ||
    typeof library.createChart!=="function"
  ){
    return false;
  }

  if(library.__CL_FIB_HOOK_V4__){
    return true;
  }

  const originalCreateChart =
    library.createChart;

  library.createChart = function(
    element,
    options
  ){
    const result =
      originalCreateChart.call(
        this,
        element,
        options
      );

    if(element?.id==="chart"){
      chart = result;

      const originalAdd =
        result.addCandlestickSeries;

      result.addCandlestickSeries =
        function(options){
          const created =
            originalAdd.call(
              this,
              options
            );

          candle = created;

          const originalSetData =
            created.setData;

          created.setData = function(data){
            const output =
              originalSetData.call(
                this,
                data
              );

            requestDraw();
            return output;
          };

          const originalUpdate =
            created.update;

          created.update = function(data){
            const output =
              originalUpdate.call(
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

      attached = true;
      requestDraw();
    }

    return result;
  };

  library.__CL_FIB_HOOK_V4__ = true;

  return true;
}

function start(){
  buildUI();

  if(connectToChart()){
    if(!attached){
      status(
        "Fibonacci listo. Esperando inicialización de la gráfica."
      );
    }
  }else{
    status(
      "Fibonacci visible, esperando biblioteca de gráficas."
    );
  }

  if(!retryTimer){
    retryTimer = setInterval(()=>{
      retryCount++;

      if(!chart){
        connectToChart();
      }

      if(!$("fibToolbar")){
        buildUI();
      }

      requestDraw();

      if(
        attached ||
        retryCount>=30
      ){
        clearInterval(retryTimer);
        retryTimer = null;

        if(!attached){
          status(
            "Fibonacci cargado, pero sin enlace a la gráfica. Revisa el orden de los scripts en index.html."
          );
        }
      }
    },1000);
  }
}

load();

/*
 Se instala el enlace inmediatamente
 para que funcione cuando app.js
 cree la gráfica.
*/

connectToChart();

if(document.readyState==="loading"){
  document.addEventListener(
    "DOMContentLoaded",
    start
  );
}else{
  start();
}

window.CryptolexuzFibonacci = {
  getSettings:()=>JSON.parse(
    JSON.stringify(settings)
  ),

  updateSettings:changes=>{
    if(!changes || typeof changes!=="object"){
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

  calculate:()=>{
    const d = currentDrawing();

    return d
      ? {
          anchors:d,
          levels:levelsFor(d)
        }
      : null;
  },

  setLevel:(value,changes={})=>{
    const n = Number(value);

    if(!Number.isFinite(n)) return;

    let level = settings.levels.find(
      x=>x.value===n
    );

    if(level){
      Object.assign(level,changes);
    }else{
      settings.levels.push({
        value:n,
        visible:true,
        color:"#bb52ff",
        ...changes
      });
    }

    settings.levels.sort(
      (a,b)=>a.value-b.value
    );

    save();
    renderLevels();
    requestDraw();
  },

  removeLevel:value=>{
    settings.levels =
      settings.levels.filter(
        x=>x.value!==Number(value)
      );

    save();
    renderLevels();
    requestDraw();
  },

  redraw:requestDraw,

  isConnected:()=>!!(
    chart && candle
  ),

  version:"4"
};

console.info(
  "CRYPTOLEXUZ PRO — Fibonacci V4 cargado"
);

})();
