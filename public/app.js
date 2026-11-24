
/*
 CRYPTOLEXUZ PRO — APP.JS V21
 CORRECCIÓN DE PARPADEO

 - Actualización incremental de velas
 - Actualización incremental de volumen
 - Actualización incremental de RSI y ADX
 - Medias MA y EMA independientes
 - Sincronización estable entre gráficas
 - Evita restaurar el rango en cada actualización
 - Evita notificar módulos si no cambiaron las velas
 - Conserva escáner, historial y notificaciones
 - Conserva Fibonacci, cajas y Volume Profile
 - Compatible con Lightweight Charts 4.2.2
 - No ejecuta órdenes
*/

"use strict";

(() => {

if (window.__cryptolexuzAppV21) return;
window.__cryptolexuzAppV21 = true;

const $ = id => document.getElementById(id);

const C = {
  green:"#00f5a0",
  red:"#ff476c",
  purple:"#bb52ff",
  orange:"#ff9a35",
  blue:"#36c5ff",
  yellow:"#ffe15a"
};

const GOLD = "NCCOGOLD2USD-USDT";
const OIL = "NCCO1OILWTI2USD-USDT";

const ASSETS = [
  "BTC-USDT","ETH-USDT","BNB-USDT",
  "SOL-USDT","XRP-USDT","DOGE-USDT",
  GOLD,OIL
];

const TF = [
  "1d","4h","1h","30m",
  "15m","5m","1m"
];

const SEC = {
  "1m":60,"3m":180,"5m":300,
  "15m":900,"30m":1800,
  "1h":3600,"2h":7200,
  "4h":14400,"6h":21600,
  "8h":28800,"12h":43200,
  "1d":86400,"3d":259200,
  "1w":604800,"1M":2592000
};

const HISTORY_KEY = "cryptolexuz-v16-history";
const SETTINGS_KEY = "cryptolexuz-chart-settings-v1";

const enabled = new Set([
  "ema21","ma55","rsi","fvg"
]);

const charts = {};
const series = {};
const moving = {};
const levelLines = [];
const cache = new Map();
const chartSizes = new Map();

let rows = [];
let zones = [];
let pivots = [];
let sweeps = [];
let history = [];

let activeKey = "";
let generation = 0;
let scanGeneration = 0;

let chartBusy = false;
let tickerBusy = false;
let scanBusy = false;
let verifyBusy = false;

let monitorLast = 0;
let scanLast = 0;

let socket = null;
let socketId = 0;
let reconnectTimer = null;
let lastWS = 0;
let lastRSI = "RSI no disponible";

let syncing = false;
let restoring = false;
let userInteracting = false;
let interactionTimer = null;

let resizeObserver = null;
let resizeQueued = false;
let zoneQueued = false;

let volumeProfileAttached = false;
let volumeProfileModule = null;

let chartTimer;
let tickerTimer;
let scanTimer;
let verifyTimer;

let movingSignature = "";
let lastLevelSignature = "";
let lastMarkerSignature = "";

const defaultLines = [
  {period:55,color:C.orange,width:2,enabled:true},
  {period:21,color:C.purple,width:2,enabled:true},
  {period:100,color:C.red,width:3,enabled:false},
  {period:200,color:C.blue,width:2,enabled:false}
];

/* UTILIDADES */

function put(id,value) {
  const e = $(id);
  if (!e) return;
  const text = String(value);
  if (e.textContent !== text) e.textContent = text;
}

function fmt(value,digits=2) {
  if (value === null || value === undefined ||
      value === "") return "—";

  const n = Number(value);

  return Number.isFinite(n)
    ? n.toLocaleString("en-US",{
        minimumFractionDigits:digits,
        maximumFractionDigits:digits
      })
    : "—";
}

function now() {
  return Math.floor(Date.now()/1000);
}

function settings() {
  try {
    const value = JSON.parse(
      localStorage.getItem(SETTINGS_KEY) || "null"
    );
    return value && typeof value === "object" &&
      !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

function selection() {
  const symbol = $("symbol")?.value || "BTC-USDT";
  const commodity = symbol === GOLD || symbol === OIL;

  return {
    symbol,
    tf:$("interval")?.value || "15m",
    exchange:commodity
      ? "bingx"
      : $("exchange")?.value || "bingx",
    market:commodity
      ? "perpetual"
      : $("market")?.value || "perpetual"
  };
}

function key(s) {
  return [
    s.exchange,s.market,s.symbol,s.tf
  ].join("|");
}

function syncCommodity() {
  if (![GOLD,OIL].includes($("symbol")?.value)) return;
  if ($("exchange")) $("exchange").value = "bingx";
  if ($("market")) $("market").value = "perpetual";
}

function connection(message,color=C.yellow) {
  put("connection","● "+message);
  if ($("connection")) {
    $("connection").style.color = color;
  }
}

/* DATOS */

function timestamp(value) {
  if (value === null || value === undefined) return NaN;

  const n = typeof value === "string" &&
    !/^\d+$/.test(value)
      ? Date.parse(value)
      : Number(value);

  return Number.isFinite(n)
    ? Math.floor(n > 1e12 ? n/1000 : n)
    : NaN;
}

function normalize(raw) {
  const data =
    raw?.data?.data ??
    raw?.data?.list ??
    raw?.data?.candles ??
    raw?.data ??
    raw?.list ??
    raw?.candles ??
    raw;

  if (!Array.isArray(data)) return [];

  const result = [];

  for (const x of data) {
    if (!x) continue;

    const a = Array.isArray(x);

    const c = {
      time:timestamp(a
        ? x[0]
        : x.time ?? x.timestamp ?? x.openTime ?? x.t),
      open:Number(a ? x[1] : x.open ?? x.o),
      high:Number(a ? x[2] : x.high ?? x.h),
      low:Number(a ? x[3] : x.low ?? x.l),
      close:Number(a ? x[4] : x.close ?? x.c),
      volume:Number(a
        ? x[5]
        : x.volume ?? x.vol ?? x.v ?? 0)
    };

    if (!Object.values(c).every(Number.isFinite)) continue;
    if (c.time <= 0 || c.time > now()+60) continue;
    if (c.low <= 0 || c.volume < 0) continue;
    if (c.high < Math.max(c.open,c.close,c.low)) continue;
    if (c.low > Math.min(c.open,c.close)) continue;

    result.push(c);
  }

  result.sort((a,b)=>a.time-b.time);

  return [...new Map(
    result.map(c=>[c.time,c])
  ).values()];
}

function closed(data,tf) {
  const seconds = SEC[tf] || 60;
  return data.filter(c=>c.time+seconds <= now()-2);
}

/* INDICADORES MATEMÁTICOS */

function sma(values,period) {
  const out = Array(values.length).fill(null);
  period = Math.floor(Number(period));

  if (!Number.isFinite(period) || period < 1) return out;

  let sum = 0;

  for (let i=0;i<values.length;i++) {
    sum += values[i];
    if (i>=period) sum -= values[i-period];
    if (i>=period-1) out[i] = sum/period;
  }

  return out;
}

function ema(values,period) {
  const out = Array(values.length).fill(null);
  period = Math.floor(Number(period));

  if (!Number.isFinite(period) ||
      period<1 || values.length<period) return out;

  let value = values.slice(0,period)
    .reduce((a,b)=>a+b,0)/period;

  out[period-1] = value;

  for (let i=period;i<values.length;i++) {
    value += (values[i]-value)*2/(period+1);
    out[i] = value;
  }

  return out;
}

function rsi(values,period=14) {
  const out = Array(values.length).fill(null);
  if (values.length<=period) return out;

  let gains=0,losses=0;

  for (let i=1;i<=period;i++) {
    const d=values[i]-values[i-1];
    gains+=Math.max(d,0);
    losses+=Math.max(-d,0);
  }

  gains/=period;
  losses/=period;

  const calculate=()=>losses===0
    ? gains===0 ? 50 : 100
    : 100-100/(1+gains/losses);

  out[period]=calculate();

  for (let i=period+1;i<values.length;i++) {
    const d=values[i]-values[i-1];

    gains=(gains*(period-1)+Math.max(d,0))/period;
    losses=(losses*(period-1)+Math.max(-d,0))/period;

    out[i]=calculate();
  }

  return out;
}

function adx(data,period=14) {
  const n=data.length;
  const ax=Array(n).fill(null);
  const plus=Array(n).fill(null);
  const minus=Array(n).fill(null);

  if (n<2*period) return {adx:ax,plus,minus};

  const tr=[],up=[],down=[],dx=[];

  for (let i=1;i<n;i++) {
    const high=data[i].high-data[i-1].high;
    const low=data[i-1].low-data[i].low;

    tr[i]=Math.max(
      data[i].high-data[i].low,
      Math.abs(data[i].high-data[i-1].close),
      Math.abs(data[i].low-data[i-1].close)
    );

    up[i]=high>low && high>0 ? high : 0;
    down[i]=low>high && low>0 ? low : 0;
  }

  let totalTR=0,totalPlus=0,totalMinus=0;

  for (let i=1;i<=period;i++) {
    totalTR+=tr[i];
    totalPlus+=up[i];
    totalMinus+=down[i];
  }

  for (let i=period;i<n;i++) {
    if (i>period) {
      totalTR=totalTR-totalTR/period+tr[i];
      totalPlus=totalPlus-totalPlus/period+up[i];
      totalMinus=totalMinus-totalMinus/period+down[i];
    }

    plus[i]=totalTR ? 100*totalPlus/totalTR : 0;
    minus[i]=totalTR ? 100*totalMinus/totalTR : 0;

    dx[i]=plus[i]+minus[i]
      ? 100*Math.abs(plus[i]-minus[i])/
        (plus[i]+minus[i])
      : 0;
  }

  let total=0;

  for (let i=period;i<2*period;i++) total+=dx[i];

  ax[2*period-1]=total/period;

  for (let i=2*period;i<n;i++) {
    ax[i]=(ax[i-1]*(period-1)+dx[i])/period;
  }

  return {adx:ax,plus,minus};
}

function atr(data,period=14) {
  if (data.length<period+1) return null;

  const values=[];

  for (let i=1;i<data.length;i++) {
    values.push(Math.max(
      data[i].high-data[i].low,
      Math.abs(data[i].high-data[i-1].close),
      Math.abs(data[i].low-data[i-1].close)
    ));
  }

  let value=values.slice(0,period)
    .reduce((a,b)=>a+b,0)/period;

  for (let i=period;i<values.length;i++) {
    value=(value*(period-1)+values[i])/period;
  }

  return value;
}

function lineData(data,values) {
  return data.flatMap((c,i)=>
    Number.isFinite(values[i])
      ? [{time:c.time,value:values[i]}]
      : []
  );
}

function volumeBar(c) {
  return {
    time:c.time,
    value:c.volume,
    color:c.close>=c.open
      ? "rgba(0,245,160,.7)"
      : "rgba(255,71,108,.7)"
  };
}

/* MOTOR DE ACTUALIZACIÓN INCREMENTAL */

function sameCandle(a,b) {
  return !!(
    a && b &&
    a.time===b.time &&
    a.open===b.open &&
    a.high===b.high &&
    a.low===b.low &&
    a.close===b.close &&
    a.volume===b.volume
  );
}

/*
 Devuelve:
 - none: ningún cambio
 - append: una vela nueva
 - last: solo cambió la última
 - rebuild: cambió el historial
*/
function classifyChange(oldData,newData) {
  if (!oldData.length) return "rebuild";

  if (oldData.length===newData.length) {
    let sameEarlier=true;

    for (let i=0;i<oldData.length-1;i++) {
      if (!sameCandle(oldData[i],newData[i])) {
        sameEarlier=false;
        break;
      }
    }

    if (sameEarlier) {
      return sameCandle(oldData.at(-1),newData.at(-1))
        ? "none"
        : "last";
    }
  }

  if (
    newData.length===oldData.length+1 &&
    oldData.every((c,i)=>sameCandle(c,newData[i]))
  ) return "append";

  /*
   El servidor puede devolver una ventana móvil
   de longitud constante. Si se desplazó una vela,
   no es necesario reconstruir la serie completa.
  */
  if (
    newData.length===oldData.length &&
    newData.length>1 &&
    oldData.slice(1).every(
      (c,i)=>sameCandle(c,newData[i])
    )
  ) return "shift";

  return "rebuild";
}

/*
 Cada serie recuerda su último punto.
 Si la fecha no cambió, se usa update().
 Si apareció una fecha nueva, también se usa update().
 setData() se reserva para reconstrucciones.
*/

const seriesState=new WeakMap();

function setLineStable(target,data,force=false) {
  if (!target) return;

  const old=seriesState.get(target);

  if (force || !old) {
    target.setData(data);
    seriesState.set(target,{
      length:data.length,
      last:data.at(-1) || null
    });
    return;
  }

  const next=data.at(-1);

  if (!next) {
    if (old.length) target.setData([]);
    seriesState.set(target,{length:0,last:null});
    return;
  }

  if (
    old.length===data.length &&
    old.last?.time===next.time
  ) {
    if (old.last.value!==next.value ||
        old.last.color!==next.color) {
      target.update(next);
    }
  } else if (
    data.length===old.length+1 &&
    next.time>old.last.time
  ) {
    target.update(next);
  } else if (
    data.length===old.length &&
    next.time>old.last.time
  ) {
    /*
     Ventana móvil: update() añade la nueva barra.
     Se mantiene el historial existente hasta
     una reconstrucción programada.
    */
    target.update(next);
  } else {
    target.setData(data);
  }

  seriesState.set(target,{
    length:data.length,
    last:{...next}
  });
}

/* OPCIONES DE GRÁFICAS */

function chartOptions(height) {
  return {
    width:300,
    height,

    layout:{
      background:{
        type:"solid",
        color:"#090c13"
      },
      textColor:"#c9d3ee",
      fontSize:11
    },

    grid:{
      vertLines:{color:"#18202d"},
      horzLines:{color:"#18202d"}
    },

    rightPriceScale:{
      borderColor:"#344056",
      minimumWidth:65
    },

    timeScale:{
      borderColor:"#344056",
      timeVisible:true,
      secondsVisible:false,
      rightOffset:5,
      barSpacing:9,
      minBarSpacing:2,
      lockVisibleTimeRangeOnResize:true
    },

    crosshair:{
      mode:LightweightCharts.CrosshairMode.Normal
    },

    handleScroll:{
      mouseWheel:false,
      pressedMouseMove:true,
      horzTouchDrag:true,
      vertTouchDrag:false
    },

    handleScale:{
      mouseWheel:true,
      pinch:true,
      axisPressedMouseMove:{
        time:true,
        price:true
      },
      axisDoubleClickReset:true
    },

    kineticScroll:{
      touch:true,
      mouse:true
    }
  };
}

function visible() {
  try {
    const r=charts.price?.timeScale()
      .getVisibleLogicalRange();

    if (r &&
        Number.isFinite(r.from) &&
        Number.isFinite(r.to)) {
      return {from:r.from,to:r.to};
    }
  } catch {}

  return null;
}

function sameRange(a,b,tolerance=.05) {
  return !!(
    a && b &&
    Math.abs(a.from-b.from)<tolerance &&
    Math.abs(a.to-b.to)<tolerance
  );
}

function restore(range) {
  if (!range || !charts.price || restoring) return;

  if (sameRange(visible(),range)) return;

  restoring=true;

  try {
    charts.price.timeScale()
      .setVisibleLogicalRange(range);
  } catch(error) {
    console.warn("Rango visible:",error);
  } finally {
    restoring=false;
  }
}

/*
 Sincronización unidireccional:
 La gráfica de precio es la referencia principal.
 Volumen, RSI y ADX siguen su rango.
 Evita que cuatro gráficas se corrijan entre sí.
*/

let syncQueued=false;
let pendingRange=null;

function syncCharts(source,range) {
  if (
    syncing || restoring || !range ||
    !Number.isFinite(range.from) ||
    !Number.isFinite(range.to)
  ) return;

  if (source!==charts.price) return;

  pendingRange={from:range.from,to:range.to};

  if (syncQueued) return;
  syncQueued=true;

  requestAnimationFrame(()=>{
    syncQueued=false;

    const target=pendingRange;
    pendingRange=null;

    if (!target) return;

    syncing=true;

    try {
      for (const name of ["volume","rsi","adx"]) {
        const chart=charts[name];
        if (!chart) continue;

        const current=chart.timeScale()
          .getVisibleLogicalRange();

        if (sameRange(current,target)) continue;

        chart.timeScale()
          .setVisibleLogicalRange(target);
      }
    } finally {
      syncing=false;
    }

    scheduleZoneDraw();
  });
}

function redrawModules() {
  try {
    window.CryptolexuzFibonacci?.redraw?.();
  } catch {}

  try {
    window.CryptolexuzRangeBoxes?.redraw?.();
  } catch {}

  try {
    volumeProfile()?.redraw?.();
  } catch {}
}

function scheduleZoneDraw() {
  if (zoneQueued) return;

  zoneQueued=true;

  requestAnimationFrame(()=>{
    zoneQueued=false;
    drawZones();
  });
}

function resizeCanvas() {
  const canvas=$("zonesCanvas");
  const area=$("priceChartArea");

  if (!canvas || !area) return false;

  const width=area.clientWidth;
  const height=area.clientHeight;

  if (width<=0 || height<=0) return false;

  const dpr=Math.min(window.devicePixelRatio||1,2);
  const w=Math.round(width*dpr);
  const h=Math.round(height*dpr);

  if (canvas.width===w && canvas.height===h) {
    return false;
  }

  canvas.width=w;
  canvas.height=h;
  canvas.style.pointerEvents="none";

  canvas.getContext("2d")?.setTransform(
    dpr,0,0,dpr,0,0
  );

  scheduleZoneDraw();
  return true;
}

function resize() {
  let changed=false;

  for (const [name,id,fallback] of [
    ["price","chart",360],
    ["volume","volumeChart",115],
    ["rsi","rsiChart",145],
    ["adx","adxChart",145]
  ]) {
    const element=$(id);
    const chart=charts[name];

    if (!element || !chart ||
        element.clientWidth<=0) continue;

    const width=Math.round(element.clientWidth);

    const height=name==="price"
      ? Math.max(240,Math.round(
          element.clientHeight||fallback
        ))
      : fallback;

    const old=chartSizes.get(name);

    if (old &&
        old.width===width &&
        old.height===height) continue;

    chart.resize(width,height);
    chartSizes.set(name,{width,height});
    changed=true;
  }

  const canvasChanged=resizeCanvas();

  if (changed || canvasChanged) {
    redrawModules();
  }
}

function scheduleResize() {
  if (resizeQueued) return;
  resizeQueued=true;

  requestAnimationFrame(()=>{
    resizeQueued=false;
    resize();
  });
}

function enableTouch() {
  const element=$("chart");
  if (!element) return;

  element.style.touchAction="pan-y";
  element.style.userSelect="none";

  for (const id of [
    "zonesCanvas",
    "fibonacciCanvas",
    "clVpCanvas"
  ]) {
    if ($(id)) $(id).style.pointerEvents="none";
  }

  const interact=()=>{
    userInteracting=true;
    clearTimeout(interactionTimer);

    interactionTimer=setTimeout(()=>{
      userInteracting=false;
    },1200);
  };

  for (const type of [
    "touchstart","touchmove",
    "pointerdown","wheel"
  ]) {
    element.addEventListener(type,interact,{
      passive:true
    });
  }
}

/* INTEGRACIÓN DE MÓDULOS */

function volumeProfile() {
  return window.CryptolexuzVolumeProfile ||
    window.CRYPTOLEXUZ_VOLUME_PROFILE ||
    null;
}

function announceChartReady() {
  if (!charts.price || !series.price) return;

  const chart=charts.price;
  const candle=series.price;

  window.CryptolexuzChart={
    chart,
    chartApi:chart,
    candle,
    candleSeries:candle,
    applyOptions:o=>chart.applyOptions(o),
    timeScale:()=>chart.timeScale(),
    getRows:()=>rows,
    getCandles:()=>rows,
    getSelection:selection,
    resetView,
    resize
  };

  window.clChart=chart;
  window.chartApi=chart;

  window.dispatchEvent(new CustomEvent(
    "cryptolexuz:chart-ready",{
      detail:{
        chart,
        candle,
        candleSeries:candle,
        rows,
        candles:rows,
        getRows:()=>rows,
        getSelection:selection
      }
    }
  ));
}

function attachVolumeProfile() {
  const vp=volumeProfile();

  if (!vp || !charts.price || !series.price) {
    announceChartReady();
    return;
  }

  if (
    volumeProfileAttached &&
    volumeProfileModule===vp
  ) return;

  try {
    vp.attach?.(
      charts.price,
      series.price,{
        getRows:()=>rows,
        getCandles:()=>rows,
        getSelection:selection
      }
    );

    volumeProfileAttached=true;
    volumeProfileModule=vp;
  } catch(error) {
    console.warn("Volume Profile:",error);
  }

  announceChartReady();
}

function updateModules(force=false) {
  const vp=volumeProfile();

  if (vp && !volumeProfileAttached) {
    attachVolumeProfile();
  }

  /*
   Los módulos externos reciben datos solo cuando
   cambió la información de las velas.
  */

  try {
    if (typeof vp?.setData==="function") {
      vp.setData(rows);
    } else {
      vp?.updateData?.(rows);
    }
  } catch(error) {
    console.warn("Volume Profile datos:",error);
  }

  window.dispatchEvent(new CustomEvent(
    "cryptolexuz:candles-updated",{
      detail:{
        chart:charts.price,
        candle:series.price,
        candleSeries:series.price,
        rows,
        candles:rows,
        selection:selection(),
        force
      }
    }
  ));

  /*
   No forzamos redraw() en cada vela.
   Los módulos reciben candles-updated y
   pueden actualizar sus propias capas.
  */

  if (force) redrawModules();
}

/* MEDIAS MÓVILES */

function movingConfigurations() {
  const s=settings();

  if (
    Array.isArray(s.maLines) ||
    Array.isArray(s.emaLines)
  ) {
    return [
      ...(Array.isArray(s.maLines)
        ? s.maLines.map(x=>({...x,method:"sma"}))
        : []),
      ...(Array.isArray(s.emaLines)
        ? s.emaLines.map(x=>({...x,method:"ema"}))
        : [])
    ];
  }

  const legacy=Array.isArray(s.lines) &&
    s.lines.length ? s.lines : defaultLines;

  return legacy.map(x=>({
    ...x,
    method:Number(x.period)===21 ? "ema" : "sma"
  }));
}

function movingConfigSignature() {
  return JSON.stringify(movingConfigurations());
}

function rebuildMoving() {
  if (!charts.price) return;

  const configurations=movingConfigurations();
  const signature=movingConfigSignature();

  if (signature===movingSignature) return;

  movingSignature=signature;

  const wanted=new Set();

  configurations.forEach((line,index)=>{
    const name="custom"+index;
    wanted.add(name);

    const color=/^#[0-9a-f]{6}$/i.test(line.color)
      ? line.color : C.purple;

    const width=Math.max(1,Math.min(
      5,Number(line.width)||2
    ));

    if (!moving[name]) {
      moving[name]=charts.price.addLineSeries({
        color,
        lineWidth:width,
        priceLineVisible:false,
        lastValueVisible:false,
        crosshairMarkerVisible:false
      });
    } else {
      moving[name].applyOptions({
        color,
        lineWidth:width
      });
    }
  });

  for (const [name,line] of Object.entries(moving)) {
    if (wanted.has(name)) continue;

    try {
      charts.price.removeSeries(line);
    } catch {}

    delete moving[name];
  }
}

function updateMoving(closes,force=false) {
  rebuildMoving();

  movingConfigurations().forEach((line,index)=>{
    const period=Math.max(1,Math.floor(
      Number(line.period)||21
    ));

    const method=line.method==="ema" ? "ema" : "sma";

    const values=method==="ema"
      ? ema(closes,period)
      : sma(closes,period);

    const legacy=method==="ema" && period===21
      ? "ema21"
      : method==="sma" && period===55
        ? "ma55"
        : method==="sma" && period===100
          ? "ma100"
          : method==="sma" && period===200
            ? "ma200"
            : null;

    const on=Boolean(line.enabled) &&
      (!legacy || enabled.has(legacy));

    setLineStable(
      moving["custom"+index],
      on ? lineData(rows,values) : [],
      force
    );
  });
}

/* CREAR GRÁFICAS UNA SOLA VEZ */

function createCharts() {
  if (!window.LightweightCharts || !$("chart")) {
    put("message","No se pudo cargar Lightweight Charts.");
    connection("Error de gráfica",C.red);
    return false;
  }

  charts.price=LightweightCharts.createChart(
    $("chart"),
    chartOptions($("chart").clientHeight||360)
  );

  series.price=charts.price.addCandlestickSeries({
    upColor:C.green,
    downColor:C.red,
    wickUpColor:C.green,
    wickDownColor:C.red,
    borderVisible:false
  });

  rebuildMoving();

  for (const [name,id,height] of [
    ["volume","volumeChart",115],
    ["rsi","rsiChart",145],
    ["adx","adxChart",145]
  ]) {
    if (!$(id)) continue;

    charts[name]=LightweightCharts.createChart(
      $(id),chartOptions(height)
    );
  }

  if (charts.volume) {
    series.volume=charts.volume.addHistogramSeries({
      priceFormat:{type:"volume"},
      priceScaleId:""
    });

    series.volume.priceScale().applyOptions({
      scaleMargins:{top:.12,bottom:0}
    });
  }

  if (charts.rsi) {
    series.rsi=charts.rsi.addLineSeries({
      color:C.purple,
      lineWidth:2,
      priceLineVisible:false
    });

    for (const level of [30,50,70]) {
      series.rsi.createPriceLine({
        price:level,
        color:"#657399",
        lineStyle:LightweightCharts.LineStyle.Dashed,
        axisLabelVisible:true
      });
    }
  }

  if (charts.adx) {
    for (const [name,color] of [
      ["adx",C.yellow],
      ["plus",C.green],
      ["minus",C.red]
    ]) {
      series[name]=charts.adx.addLineSeries({
        color,
        lineWidth:2,
        priceLineVisible:false
      });
    }
  }

  charts.price.timeScale()
    .subscribeVisibleLogicalRangeChange(
      range=>syncCharts(charts.price,range)
    );

  enableTouch();

  if (window.ResizeObserver) {
    resizeObserver=new ResizeObserver(scheduleResize);

    for (const id of [
      "chart","volumeChart","rsiChart","adxChart"
    ]) {
      if ($(id)) resizeObserver.observe($(id));
    }
  }

  window.addEventListener("resize",scheduleResize);

  try {
    window.CryptolexuzFibonacci?.attach?.(
      charts.price,
      series.price,{
        getRows:()=>rows,
        getSelection:selection
      }
    );
  } catch(error) {
    console.warn("Fibonacci:",error);
  }

  attachVolumeProfile();
  setTimeout(scheduleResize,150);

  return true;
}

function resetView() {
  if (!charts.price || !rows.length) return;

  restore({
    from:Math.max(0,rows.length-50),
    to:rows.length+3
  });
}

/* ESTRUCTURA DE MERCADO */

function detectPivots(data) {
  const output=[];

  for (let i=4;i<data.length-4;i++) {
    const nearby=data.slice(i-4,i+5);

    if (nearby.every((x,j)=>
      j===4 || x.high<data[i].high
    )) {
      output.push({
        index:i,
        price:data[i].high,
        type:"high"
      });
    }

    if (nearby.every((x,j)=>
      j===4 || x.low>data[i].low
    )) {
      output.push({
        index:i,
        price:data[i].low,
        type:"low"
      });
    }
  }

  return output.slice(-40);
}

function detectFVG(data) {
  const output=[];

  for (let i=2;i<data.length;i++) {
    const bull=data[i].low>data[i-2].high;
    const bear=data[i].high<data[i-2].low;

    if (!bull && !bear) continue;

    const top=bull ? data[i].low : data[i-2].low;
    const bottom=bull ? data[i-2].high : data[i].high;

    if ((top-bottom)/((top+bottom)/2)<.00035) {
      continue;
    }

    let end=data.length-1;
    let filled=false;
    let inverted=false;

    for (let j=i+1;j<data.length;j++) {
      if (
        (bull && data[j].low<=bottom) ||
        (bear && data[j].high>=top)
      ) {
        end=j;
        filled=true;

        inverted=bull
          ? data[j].close<bottom
          : data[j].close>top;

        break;
      }
    }

    output.push({
      start:i-2,end,top,bottom,
      bull,filled,inverted
    });
  }

  return output.slice(-80);
}

function detectSweeps(data) {
  const output=[];

  for (let i=20;i<data.length-1;i++) {
    const previous=data.slice(i-20,i);

    const high=Math.max(...previous.map(x=>x.high));
    const low=Math.min(...previous.map(x=>x.low));

    if (data[i].high>high && data[i].close<high) {
      output.push({
        time:data[i].time,
        position:"aboveBar",
        color:C.red,
        shape:"arrowDown",
        text:"Barrido ↑"
      });
    }

    if (data[i].low<low && data[i].close>low) {
      output.push({
        time:data[i].time,
        position:"belowBar",
        color:C.green,
        shape:"arrowUp",
        text:"Barrido ↓"
      });
    }
  }

  return output.slice(-25);
}

function updateLevels() {
  if (!series.price) return;

  const recent=pivots.slice(-18);
  const requested=[];

  if (enabled.has("support")) {
    const p=recent.filter(x=>x.type==="low").at(-1);
    if (p) requested.push([p.price,C.green,"Soporte"]);
  }

  if (enabled.has("resistance")) {
    const p=recent.filter(x=>x.type==="high").at(-1);
    if (p) requested.push([p.price,C.red,"Resistencia"]);
  }

  if (enabled.has("liquidity")) {
    for (const p of recent
      .filter(x=>x.type==="high").slice(-2)) {
      requested.push([p.price,C.red,"Máximo"]);
    }

    for (const p of recent
      .filter(x=>x.type==="low").slice(-2)) {
      requested.push([p.price,C.green,"Mínimo"]);
    }
  }

  const signature=JSON.stringify(requested);
  if (signature===lastLevelSignature) return;

  lastLevelSignature=signature;

  for (const line of levelLines) {
    try {
      series.price.removePriceLine(line);
    } catch {}
  }

  levelLines.length=0;

  for (const [price,color,title] of requested) {
    levelLines.push(series.price.createPriceLine({
      price,color,title,
      lineWidth:1,
      lineStyle:LightweightCharts.LineStyle.Dashed,
      axisLabelVisible:true
    }));
  }
}

/* CAPA FVG */

function drawZones() {
  const canvas=$("zonesCanvas");
  const area=$("priceChartArea");

  if (!canvas || !area ||
      !charts.price || !series.price) return;

  const ctx=canvas.getContext("2d");
  if (!ctx) return;

  const width=area.clientWidth;
  const height=area.clientHeight;

  if (width<=0 || height<=0) return;

  ctx.clearRect(0,0,width,height);

  if (!enabled.has("fvg") &&
      !enabled.has("ifvg")) return;

  const scale=charts.price.timeScale();

  for (const zone of zones.slice(-25)) {
    if (!(
      (!zone.filled && enabled.has("fvg")) ||
      (zone.inverted && enabled.has("ifvg"))
    )) continue;

    const x1=scale.logicalToCoordinate(zone.start);
    const x2=scale.logicalToCoordinate(zone.end);
    const y1=series.price.priceToCoordinate(zone.top);
    const y2=series.price.priceToCoordinate(zone.bottom);

    if (![x1,x2,y1,y2].every(Number.isFinite)) continue;

    const left=Math.max(0,x1);
    const right=Math.min(width-70,x2);
    const top=Math.max(0,Math.min(y1,y2));
    const bottom=Math.min(height,Math.max(y1,y2));

    if (right<=left || bottom<=top) continue;

    ctx.fillStyle=zone.inverted
      ? "rgba(255,225,90,.12)"
      : zone.bull
        ? "rgba(0,245,160,.09)"
        : "rgba(255,71,108,.09)";

    ctx.fillRect(
      left,top,right-left,bottom-top
    );

    ctx.strokeStyle=zone.inverted
      ? "#ffe15a"
      : zone.bull
        ? "rgba(0,245,160,.4)"
        : "rgba(255,71,108,.4)";

    ctx.strokeRect(
      left,top,right-left,bottom-top
    );
  }
}

/* ACTUALIZACIÓN ESTABLE DE INDICADORES */

function updateIndicators(force=false) {
  if (!rows.length || !series.price) return;

  const closes=rows.map(x=>x.close);

  const ma={
    ema21:ema(closes,21),
    ma55:sma(closes,55)
  };

  updateMoving(closes,force);

  const rv=rsi(closes);
  const av=adx(rows);

  setLineStable(
    series.rsi,
    enabled.has("rsi") ? lineData(rows,rv) : [],
    force
  );

  for (const [name,values] of [
    ["adx",av.adx],
    ["plus",av.plus],
    ["minus",av.minus]
  ]) {
    setLineStable(
      series[name],
      enabled.has("adx")
        ? lineData(rows,values)
        : [],
      force
    );
  }

  const valid=closed(rows,selection().tf);
  const lastClosed=valid.at(-1);

  const index=rows.findIndex(
    x=>x.time===lastClosed?.time
  );

  if (index>=0) {
    put("ema21Value",fmt(ma.ema21[index]));
    put("ma55Value",fmt(ma.ma55[index]));
    put("rsiValue",fmt(rv[index],1));
    put("adxValue",fmt(av.adx[index],1));
    put("rsiChartValue",fmt(rv[index],1));
    put("adxChartValue",fmt(av.adx[index],1));

    const r=rv[index];

    lastRSI=!Number.isFinite(r)
      ? "RSI no disponible"
      : r<30
        ? "RSI en sobreventa; rebote no confirmado."
        : r>70
          ? "RSI en sobrecompra; caída no confirmada."
          : r>=50
            ? "RSI con predominio comprador."
            : "RSI con predominio vendedor.";

    put("rsiInterpretation",lastRSI);

    const strength=av.adx[index];

    put(
      "adxInterpretation",
      Number.isFinite(strength)
        ? "ADX "+fmt(strength,1)+
          (strength>=25
            ? ". Tendencia con fuerza."
            : ". Tendencia débil.")
        : "ADX no disponible."
    );

    const trend=
      Number.isFinite(ma.ema21[index]) &&
      Number.isFinite(ma.ma55[index])
        ? closes[index]>ma.ema21[index] &&
          ma.ema21[index]>ma.ma55[index]
          ? "Sesgo alcista"
          : closes[index]<ma.ema21[index] &&
            ma.ema21[index]<ma.ma55[index]
            ? "Sesgo bajista"
            : "Mercado mixto"
        : "Historial insuficiente";

    put("indicatorReadout",trend+". "+lastRSI);
  }

  const last=valid.at(-1);
  const previous=valid.slice(-21,-1);

  if (last && previous.length===20) {
    const average=previous.reduce(
      (sum,x)=>sum+x.volume,0
    )/20;

    put(
      "volumeInterpretation",
      average>0
        ? "Volumen de última vela cerrada: "+
          fmt(last.volume/average,2)+
          " veces el promedio."
        : "Volumen insuficiente."
    );
  }

  /*
   La estructura y las zonas se recalculan,
   pero las líneas y marcadores solo cambian
   cuando realmente varía su contenido.
  */

  pivots=detectPivots(rows);
  zones=detectFVG(rows);
  sweeps=detectSweeps(rows);

  updateLevels();

  const markers=enabled.has("sweeps") ? sweeps : [];
  const markerSignature=JSON.stringify(markers);

  if (markerSignature!==lastMarkerSignature) {
    series.price.setMarkers(markers);
    lastMarkerSignature=markerSignature;
  }

  if ($("rsiSection")) {
    $("rsiSection").hidden=!enabled.has("rsi");
  }

  if ($("adxSection")) {
    $("adxSection").hidden=!enabled.has("adx");
  }

  scheduleZoneDraw();
}

/* CONEXIÓN API */

async function getJSON(url,timeout=12000) {
  const controller=new AbortController();

  const timer=setTimeout(
    ()=>controller.abort(),timeout
  );

  try {
    const response=await fetch(url,{
      signal:controller.signal,
      cache:"no-store"
    });

    if (!response.ok) {
      throw Error("HTTP "+response.status);
    }

    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

function candleURL(s,limit=300) {
  return (
    "/api/exchange/"+
    encodeURIComponent(s.exchange)+
    "/klines/"+
    encodeURIComponent(s.symbol)+
    "?market="+encodeURIComponent(s.market)+
    "&interval="+encodeURIComponent(s.tf)+
    "&limit="+limit
  );
}

function tickerURL(s) {
  return (
    "/api/exchange/"+
    encodeURIComponent(s.exchange)+
    "/ticker/"+
    encodeURIComponent(s.symbol)+
    "?market="+encodeURIComponent(s.market)
  );
}

/* APLICAR VELAS SIN RECONSTRUIR */

function applyCandles(data,s) {
  const changed=activeKey!==key(s);
  const previous=rows;
  const type=changed
    ? "rebuild"
    : classifyChange(previous,data);

  if (type==="none") {
    put("status","Velas actualizadas");
    return;
  }

  const previousRange=!changed ? visible() : null;
  const last=data.at(-1);

  rows=data;
  activeKey=key(s);

  if (type==="last" || type==="append" ||
      type==="shift") {
    /*
     El precio y el volumen solo reciben
     la vela nueva o modificada.
    */
    series.price.update(last);
    series.volume?.update(volumeBar(last));
  } else {
    series.price.setData(rows);
    series.volume?.setData(rows.map(volumeBar));
  }

  /*
   Solo se fuerza setData en indicadores
   cuando hubo reconstrucción histórica.
  */
  const force=type==="rebuild";

  updateIndicators(force);
  updateModules(force);

  if (changed) {
    resetView();
  } else if (
    type==="rebuild" &&
    previousRange &&
    !userInteracting
  ) {
    /*
     Restaurar el rango únicamente cuando
     se reemplazó el historial completo.
     Nunca al actualizar la última vela.
    */
    restore(previousRange);
  }

  put("chartTitle",s.symbol+" · "+s.tf);

  put(
    "volumeLabel",
    s.symbol===GOLD
      ? "GOLD"
      : s.symbol===OIL
        ? "OIL WTI"
        : s.symbol.split("-")[0]
  );

  scheduleZoneDraw();
}

async function refresh() {
  if (chartBusy || !series.price) return;

  chartBusy=true;

  const id=generation;
  const s=selection();

  try {
    const data=normalize(
      await getJSON(candleURL(s))
    );

    if (
      id!==generation ||
      key(s)!==key(selection())
    ) return;

    if (!data.length) throw Error("Sin velas válidas");

    applyCandles(data,s);

    put("status","Velas actualizadas");
    put("message","");

    monitor();
  } catch(error) {
    if (id===generation) {
      put("status","Error: "+error.message);
      put(
        "message",
        "Comprueba la conexión con el servidor."
      );
    }
  } finally {
    chartBusy=false;

    if (id!==generation) {
      queueMicrotask(refresh);
    }
  }
}

/* TICKER */

function tickerData(raw) {
  let data=raw?.data??raw;

  if (Array.isArray(data)) data=data[0];
  if (data?.data) data=data.data;
  if (Array.isArray(data)) data=data[0];

  return data||{};
}

function tickerFields(data) {
  const price=Number(
    data.lastPrice??data.last??
    data.price??data.close??data.c
  );

  const open=Number(
    data.openPrice??data.open24h??
    data.open??data.o
  );

  let change=Number(
    data.priceChangePercent??data.changePercent
  );

  if (!Number.isFinite(change) &&
      price>0 && open>0) {
    change=(price/open-1)*100;
  }

  return {price,open,change};
}

async function refreshTicker() {
  if (tickerBusy) return;
  tickerBusy=true;

  const s=selection();
  const id=generation;

  try {
    const data=tickerData(
      await getJSON(tickerURL(s),8000)
    );

    if (
      id!==generation ||
      key(s)!==key(selection())
    ) return;

    const {price,open,change}=tickerFields(data);

    if (price>0 && Date.now()-lastWS>7000) {
      put("price",fmt(price));
      connection(
        s.exchange.toUpperCase()+" · REST",
        C.yellow
      );
    }

    put("high",fmt(
      data.highPrice??data.high24h??
      data.high??data.h
    ));

    put("low",fmt(
      data.lowPrice??data.low24h??
      data.low??data.l
    ));

    put("open",fmt(open));

    put("volume",fmt(
      data.volume??data.volume24h??
      data.vol??data.v,0
    ));

    put(
      "change",
      Number.isFinite(change)
        ? (change>=0?"+":"")+fmt(change)+"%"
        : "—"
    );

    $("change")?.classList.toggle(
      "negative",change<0
    );

    put("bid",fmt(
      data.bidPrice??data.bid??data.bestBid
    ));

    put("ask",fmt(
      data.askPrice??data.ask??data.bestAsk
    ));

    put(
      "updated",
      new Date().toLocaleTimeString("es-MX")
    );
  } catch(error) {
    console.warn("Ticker:",error.message);
  } finally {
    tickerBusy=false;

    if (id!==generation) {
      queueMicrotask(refreshTicker);
    }
  }
}

/* WEBSOCKET */

function disconnect() {
  socketId++;
  clearTimeout(reconnectTimer);

  if (socket) {
    const old=socket;
    socket=null;

    old.onopen=null;
    old.onmessage=null;
    old.onclose=null;
    old.onerror=null;

    try { old.close(); } catch {}
  }
}

function scheduleReconnect(id) {
  clearTimeout(reconnectTimer);

  reconnectTimer=setTimeout(()=>{
    if (id===socketId && !document.hidden) {
      connect();
    }
  },4000);
}

function connect() {
  disconnect();

  const id=socketId;
  const s=selection();

  const protocol=location.protocol==="https:"
    ? "wss:" : "ws:";

  const url=protocol+"//"+location.host+
    "/ws?exchange="+encodeURIComponent(s.exchange)+
    "&market="+encodeURIComponent(s.market)+
    "&symbol="+encodeURIComponent(s.symbol);

  connection(s.exchange.toUpperCase()+" · conectando");

  try {
    socket=new WebSocket(url);
  } catch {
    scheduleReconnect(id);
    return;
  }

  socket.onopen=()=>{
    if (id===socketId) {
      connection("Esperando precios",C.yellow);
    }
  };

  socket.onmessage=event=>{
    if (id!==socketId) return;

    let data;

    try {
      data=JSON.parse(event.data);
    } catch {
      return;
    }

    if (
      data.type!=="price" ||
      data.symbol!==s.symbol ||
      data.market!==s.market ||
      data.exchange!==s.exchange
    ) return;

    const price=Number(data.price);

    if (!Number.isFinite(price) || price<=0) return;

    put("price",fmt(price));
    put(
      "updated",
      new Date().toLocaleTimeString("es-MX")
    );

    lastWS=Date.now();

    connection(
      s.exchange.toUpperCase()+" · en vivo",
      C.green
    );
  };

  socket.onerror=()=>{
    if (id===socketId) {
      connection("Conexión interrumpida",C.yellow);
    }
  };

  socket.onclose=()=>{
    if (id!==socketId) return;
    socket=null;
    scheduleReconnect(id);
  };
}

/* ANÁLISIS MULTITEMPORAL */

function metric(data,tf) {
  const candles=closed(data,tf);
  if (candles.length<60) return null;

  const closes=candles.map(x=>x.close);
  const last=candles.at(-1);

  const e=ema(closes,21).at(-1);
  const m=sma(closes,55).at(-1);
  const rv=rsi(closes).at(-1);
  const ad=adx(candles);

  const strength=ad.adx.at(-1);
  const plus=ad.plus.at(-1);
  const minus=ad.minus.at(-1);

  if (![e,m,rv,strength,plus,minus]
    .every(Number.isFinite)) return null;

  let bull=0,bear=0;

  if (last.close>e) bull++;
  if (last.close<e) bear++;

  if (e>m) bull++;
  if (e<m) bear++;

  if (rv>=55) bull++;
  if (rv<=45) bear++;

  if (plus>minus) bull++;
  if (minus>plus) bear++;

  const previous=candles.slice(-7,-1);

  const average=candles.slice(-21,-1)
    .reduce((sum,x)=>sum+x.volume,0)/20;

  return {
    bull,bear,
    adx:strength,plus,minus,rsi:rv,
    volRatio:average ? last.volume/average : 0,
    close:last.close,
    closedTime:last.time,
    atr:atr(candles),
    breakHigh:last.close>
      Math.max(...previous.map(x=>x.high)),
    breakLow:last.close<
      Math.min(...previous.map(x=>x.low))
  };
}

function analyze(data,tf) {
  const m=metric(data,tf);

  if (!m) {
    return {
      state:"SIN DATOS",
      direction:"neutral",
      detail:"Historial insuficiente.",
      metrics:"—",
      price:null
    };
  }

  const bullish=m.bull>=3 && m.bull>m.bear;
  const bearish=m.bear>=3 && m.bear>m.bull;

  const state=bullish
    ? "SESGO ALCISTA"
    : bearish
      ? "SESGO BAJISTA"
      : "LATERAL / MIXTO";

  const direction=bullish
    ? "bullish"
    : bearish
      ? "bearish"
      : "neutral";

  const opportunity=
    m.bull===4 && m.adx>=25 && m.rsi<70
      ? "Posible LONG"
      : m.bear===4 && m.adx>=25 && m.rsi>30
        ? "Posible SHORT"
        : "Sin entrada confirmada";

  return {
    state,direction,
    detail:opportunity+". Requiere confirmación.",
    metrics:"RSI "+fmt(m.rsi,1)+
      " · ADX "+fmt(m.adx,1),
    price:m.close
  };
}

async function monitor() {
  if (Date.now()-monitorLast<60000) return;
  monitorLast=Date.now();

  const s=selection();
  const id=generation;

  try {
    const results=await Promise.all(
      ["5m","15m"].map(async tf=>
        normalize(await getJSON(candleURL({...s,tf})))
      )
    );

    if (id!==generation) return;

    for (let i=0;i<2;i++) {
      const tf=i===0 ? "5m" : "15m";
      const suffix=i===0 ? "5" : "15";
      const result=analyze(results[i],tf);

      put("state"+suffix,result.state);
      put("detail"+suffix,result.detail);
      put("metrics"+suffix,result.metrics);

      const element=$("state"+suffix);

      if (element) {
        element.className="state "+result.direction;

        const heading=element.closest(".signal-card")
          ?.querySelector("h3");

        if (heading) {
          heading.textContent=s.symbol+" / "+tf;
        }
      }
    }

    put("engineState","ANALIZANDO");
  } catch(error) {
    if (id===generation) {
      put("engineState","SIN CONEXIÓN");
    }
    console.warn("Monitor:",error.message);
  }
}

/* ESCÁNER */

function scannerUI() {
  if ($("clScanner")) return;

  const host=$("clScannerHost") ||
    $("clScreenScanner");

  if (!host) return;

  const section=document.createElement("section");
  section.id="clScanner";
  section.className="cl-module";

  section.innerHTML=`
    <h2>📡 Escáner CRYPTOLEXUZ PRO</h2>
    <p id="clScanStatus">Esperando análisis...</p>

    <div class="chart-controls">
      <button id="clScanNow" type="button">
        ↻ Escanear
      </button>
      <button id="clNotify" type="button">
        🔔 Activar avisos
      </button>
    </div>

    <p class="cl-notice">
      Ocho activos · Siete temporalidades ·
      LONG / SHORT
    </p>

    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>Activo</th>
            <th>Dirección</th>
            <th>Puntos</th>
            <th>Estado</th>
            <th>Confirmaciones</th>
          </tr>
        </thead>
        <tbody id="clScanBody">
          <tr><td colspan="6">Iniciando...</td></tr>
        </tbody>
      </table>
    </div>

    <p id="clScanErrors" class="cl-notice"></p>
  `;

  host.appendChild(section);

  $("clScanNow")?.addEventListener(
    "click",()=>scan(true)
  );

  $("clNotify")?.addEventListener("click",async()=>{
    if (!("Notification" in window)) {
      alert("Notificaciones no disponibles.");
      return;
    }

    const permission=await Notification.requestPermission();

    put(
      "clNotify",
      permission==="granted"
        ? "🔔 Avisos activos"
        : "🔕 Sin permiso"
    );
  });
}

function markets() {
  const s=selection();

  return ASSETS.map(symbol=>({
    symbol,
    exchange:[GOLD,OIL].includes(symbol)
      ? "bingx" : s.exchange,
    market:[GOLD,OIL].includes(symbol)
      ? "perpetual" : s.market,
    label:symbol===GOLD
      ? "GOLD (XAU)"
      : symbol===OIL
        ? "OIL WTI"
        : symbol.replace("-","/")
  }));
}

async function frames(market) {
  const result={};

  for (const tf of TF) {
    const s={...market,tf};
    const k=key(s);

    const ttl=SEC[tf]>=3600
      ? 180000
      : SEC[tf]>=900
        ? 90000
        : 50000;

    const cached=cache.get(k);

    if (cached && Date.now()-cached.at<ttl) {
      result[tf]=cached.data;
      continue;
    }

    const data=normalize(
      await getJSON(candleURL(s,300))
    );

    if (closed(data,tf).length<60) {
      throw Error(tf+": historial insuficiente");
    }

    result[tf]=data;
    cache.set(k,{at:Date.now(),data});
  }

  return result;
}

function rank(market,framesData) {
  const metrics={};

  for (const tf of TF) {
    metrics[tf]=metric(framesData[tf]||[],tf);
  }

  if (!metrics["1m"] ||
      !metrics["5m"] ||
      !metrics["15m"]) {
    return {
      market,score:0,
      state:"SIN DATOS",
      direction:"NEUTRAL",
      confirmations:"—"
    };
  }

  const weights={
    "1d":5,"4h":7,"1h":9,
    "30m":10,"15m":13,
    "5m":17,"1m":19
  };

  let bull=0,bear=0,available=0;

  for (const tf of TF) {
    const value=metrics[tf];
    if (!value) continue;

    available++;
    bull+=weights[tf]*value.bull/4;
    bear+=weights[tf]*value.bear/4;
  }

  const direction=bull===bear
    ? "NEUTRAL"
    : bull>bear ? "LONG" : "SHORT";

  const fast=metrics["1m"];

  const aligned=["1m","5m","15m"].filter(tf=>{
    const value=metrics[tf];

    return direction==="LONG"
      ? value.bull>=3
      : direction==="SHORT"
        ? value.bear>=3
        : false;
  }).length;

  let score=Math.round(Math.max(bull,bear));

  score+=aligned===3 ? 8 : aligned===2 ? 4 : 0;
  score+=fast.adx>=25 ? 5 : fast.adx>=20 ? 2 : 0;

  if (fast.volRatio>=1.3) score+=5;

  if (
    (direction==="LONG" && fast.breakHigh) ||
    (direction==="SHORT" && fast.breakLow)
  ) score+=4;

  score=Math.min(100,score);

  const confirmed=
    direction!=="NEUTRAL" &&
    aligned===3 &&
    fast.adx>=20 &&
    score>=65 &&
    (direction==="LONG"
      ? fast.rsi<75
      : fast.rsi>25);

  return {
    market,score,direction,
    state:confirmed
      ? "CONFIRMADA"
      : score>=55
        ? "EN OBSERVACIÓN"
        : "SIN ENTRADA",
    confirmations:aligned+
      "/3 rápidas · "+available+"/7 marcos",
    closedTime:fast.closedTime,
    price:fast.close,
    atr:fast.atr
  };
}

/* HISTORIAL */

try {
  const saved=JSON.parse(
    localStorage.getItem(HISTORY_KEY)||"[]"
  );

  if (Array.isArray(saved)) {
    history=saved.slice(0,300);
  }
} catch(error) {
  console.warn("Historial:",error);
}

function saveHistory() {
  try {
    localStorage.setItem(
      HISTORY_KEY,
      JSON.stringify(history.slice(0,300))
    );
  } catch(error) {
    console.warn("Guardar historial:",error);
  }
}

function addSignal(result) {
  if (
    result.state!=="CONFIRMADA" ||
    !result.closedTime ||
    !Number.isFinite(result.atr) ||
    result.atr<=0
  ) return false;

  const id=[
    result.market.exchange,
    result.market.market,
    result.market.symbol,
    result.direction,
    result.closedTime
  ].join("|");

  if (history.some(x=>x.id===id)) return false;

  const entry=result.price;
  const distance=result.atr;
  const side=result.direction;

  history.unshift({
    id,
    symbol:result.market.symbol,
    exchange:result.market.exchange,
    market:result.market.market,
    tf:"1m",
    direction:side,
    created:result.closedTime,
    entry,
    stop:side==="LONG"
      ? entry-distance
      : entry+distance,
    target:side==="LONG"
      ? entry+2*distance
      : entry-2*distance,
    state:"PENDIENTE",
    activated:null,
    ended:null,
    reason:"Alineación multitemporal + ADX + RSI",
    lastChecked:result.closedTime
  });

  history=history.slice(0,300);
  saveHistory();
  renderHistory();

  return true;
}

function evaluateSignal(signal,data) {
  if (!["PENDIENTE","ACTIVADA"]
    .includes(signal.state)) return false;

  let changed=false;

  for (const candle of closed(data,signal.tf)) {
    if (
      candle.time<=signal.lastChecked ||
      candle.time<=signal.created
    ) continue;

    signal.lastChecked=candle.time;
    changed=true;

    if (signal.state==="PENDIENTE") {
      if (!(
        candle.low<=signal.entry &&
        candle.high>=signal.entry
      )) continue;

      signal.state="ACTIVADA";
      signal.activated=candle.time;
    }

    const stop=signal.direction==="LONG"
      ? candle.low<=signal.stop
      : candle.high>=signal.stop;

    const target=signal.direction==="LONG"
      ? candle.high>=signal.target
      : candle.low<=signal.target;

    if (stop && target) {
      signal.state="NO VERIFICABLE";
      signal.ended=candle.time;
      break;
    }

    if (stop || target) {
      signal.state=candle.time===signal.activated
        ? "NO VERIFICABLE"
        : target ? "OBJETIVO" : "STOP";

      signal.ended=candle.time;
      break;
    }
  }

  return changed;
}

async function verifySignals() {
  if (verifyBusy) return;
  verifyBusy=true;

  try {
    const pending=history.filter(x=>
      ["PENDIENTE","ACTIVADA"].includes(x.state)
    );

    const groups=new Map();

    for (const signal of pending) {
      const k=key(signal);

      if (!groups.has(k)) groups.set(k,[]);
      groups.get(k).push(signal);
    }

    let dirty=false;

    for (const group of groups.values()) {
      const first=group[0];

      try {
        const data=normalize(
          await getJSON(candleURL(first,300))
        );

        const valid=closed(data,first.tf);
        if (!valid.length) continue;

        for (const item of group) {
          if (
            item.lastChecked<
            valid[0].time-(SEC[item.tf]||60)
          ) {
            item.state="NO VERIFICABLE";
            item.ended=now();
            dirty=true;
            continue;
          }

          if (evaluateSignal(item,data)) dirty=true;
        }
      } catch(error) {
        console.warn("Verificación:",error.message);
      }
    }

    if (dirty) {
      saveHistory();
      renderHistory();
    }
  } finally {
    verifyBusy=false;
  }
}

function renderHistory() {
  const wins=history.filter(
    x=>x.state==="OBJETIVO"
  ).length;

  const losses=history.filter(
    x=>x.state==="STOP"
  ).length;

  put("clTotalSignals",history.length);
  put("clTargetsHit",wins);
  put("clStopsHit",losses);

  put(
    "clWinRate",
    wins+losses
      ? fmt(wins/(wins+losses)*100,1)+"%"
      : "—"
  );

  const body=$("signalLog");
  if (!body) return;

  body.replaceChildren();

  if (!history.length) {
    const tr=document.createElement("tr");
    const td=document.createElement("td");
    td.colSpan=7;
    td.textContent="Todavía no hay señales registradas.";
    tr.append(td);
    body.append(tr);
    return;
  }

  for (const signal of history.slice(0,30)) {
    const tr=document.createElement("tr");

    const cells=[
      new Date(signal.created*1000)
        .toLocaleString("es-MX"),
      signal.tf,
      signal.symbol,
      signal.direction,
      fmt(signal.entry),
      signal.reason+
        " · TP "+fmt(signal.target)+
        " · SL "+fmt(signal.stop),
      signal.state
    ];

    for (const value of cells) {
      const td=document.createElement("td");
      td.textContent=value;
      tr.append(td);
    }

    body.append(tr);
  }
}

function notifySignal(result) {
  if (
    result.state!=="CONFIRMADA" ||
    !("Notification" in window) ||
    Notification.permission!=="granted"
  ) return;

  try {
    new Notification(
      "CRYPTOLEXUZ · "+
      result.market.label+
      " · "+result.direction,{
        body:"Señal técnica "+
          result.score+
          "/100 · Precio "+fmt(result.price),
        tag:result.market.symbol+"|"+
          result.direction+"|"+
          result.closedTime
      }
    );
  } catch(error) {
    console.warn("Notificación:",error);
  }
}

async function scan(force=false) {
  if (scanBusy || document.hidden) return;

  if (!force && Date.now()-scanLast<55000) {
    return;
  }

  scanBusy=true;

  const id=scanGeneration;
  const items=markets();
  const results=[];
  const errors=[];

  put("clScanStatus","Analizando ocho activos...");

  let cursor=0;

  async function worker() {
    while (cursor<items.length) {
      const market=items[cursor++];

      try {
        results.push(
          rank(market,await frames(market))
        );
      } catch(error) {
        errors.push(
          market.label+": "+error.message
        );
      }
    }
  }

  try {
    await Promise.all([worker(),worker()]);

    if (id!==scanGeneration) return;

    results.sort((a,b)=>b.score-a.score);

    const body=$("clScanBody");

    if (body) {
      body.replaceChildren();

      for (const [index,result] of results.entries()) {
        const tr=document.createElement("tr");

        for (const value of [
          index+1,
          result.market.label,
          result.direction,
          result.score+"/100",
          result.state,
          result.confirmations
        ]) {
          const td=document.createElement("td");
          td.textContent=value;
          td.style.padding="9px 6px";
          tr.append(td);
        }

        body.append(tr);
      }

      if (!results.length) {
        const tr=document.createElement("tr");
        const td=document.createElement("td");
        td.colSpan=6;
        td.textContent="Sin resultados disponibles.";
        tr.append(td);
        body.append(tr);
      }
    }

    put(
      "clScanErrors",
      errors.length
        ? "Sin datos: "+errors.join(" · ")
        : ""
    );

    put(
      "clScanStatus",
      "Última revisión: "+
      new Date().toLocaleTimeString("es-MX")+
      " · "+results.length+
      "/"+items.length+" activos"
    );

    scanLast=Date.now();

    for (const result of results) {
      if (addSignal(result)) {
        notifySignal(result);
      }
    }

    await verifySignals();
  } finally {
    scanBusy=false;
  }
}

/* CAMBIO DE MERCADO */

function clearMarket() {
  generation++;
  scanGeneration++;

  scanLast=0;
  monitorLast=0;
  activeKey="";

  rows=[];
  zones=[];
  pivots=[];
  sweeps=[];

  lastWS=0;
  lastLevelSignature="";
  lastMarkerSignature="";

  series.price?.setData([]);
  series.volume?.setData([]);

  if (series.volume) {
    seriesState.delete(series.volume);
  }

  for (const line of Object.values(moving)) {
    line.setData([]);
    seriesState.delete(line);
  }

  for (const name of [
    "rsi","adx","plus","minus"
  ]) {
    series[name]?.setData([]);
    if (series[name]) {
      seriesState.delete(series[name]);
    }
  }

  for (const line of levelLines) {
    try {
      series.price?.removePriceLine(line);
    } catch {}
  }

  levelLines.length=0;

  series.price?.setMarkers([]);

  updateModules(true);

  put("price","—");
  put("message","Cargando nuevo mercado...");

  scheduleZoneDraw();
}

/* INDICADORES Y AJUSTES */

function updateButtons() {
  document.querySelectorAll(
    "[data-indicator]"
  ).forEach(button=>{
    const on=enabled.has(button.dataset.indicator);

    button.classList.toggle("active",on);
    button.setAttribute("aria-pressed",String(on));
  });
}

function applySavedIndicators() {
  const s=settings();

  if (s.indicators) {
    const map={
      RSI:"rsi",
      ADX:"adx",
      VOL:"volume",
      FVG:"fvg",
      IFVG:"ifvg"
    };

    for (const [name,value] of
      Object.entries(s.indicators)) {
      if (!map[name]) continue;

      if (value) enabled.add(map[name]);
      else enabled.delete(map[name]);
    }
  }

  /*
   Si cambian períodos, colores o líneas,
   se actualiza la configuración de medias.
  */
  const signature=movingConfigSignature();

  if (signature!==movingSignature) {
    movingSignature="";
    rebuildMoving();

    for (const line of Object.values(moving)) {
      seriesState.delete(line);
    }
  }

  updateButtons();

  if (rows.length) {
    updateIndicators(true);
  }

  scheduleResize();
}

/* EVENTOS */

function events() {
  document.querySelectorAll(
    "[data-indicator]"
  ).forEach(button=>{
    button.addEventListener("click",()=>{
      const name=button.dataset.indicator;

      if (enabled.has(name)) enabled.delete(name);
      else enabled.add(name);

      updateButtons();

      if (rows.length) {
        updateIndicators(true);
      }
    });
  });

  $("refresh")?.addEventListener("click",()=>{
    refresh();
    refreshTicker();
  });

  $("chartReset")?.addEventListener(
    "click",resetView
  );

  $("rsiSpeak")?.addEventListener("click",()=>{
    if (!("speechSynthesis" in window)) return;

    speechSynthesis.cancel();

    const utterance=new SpeechSynthesisUtterance(
      lastRSI
    );

    utterance.lang="es-MX";
    speechSynthesis.speak(utterance);
  });

  if (
    $("rsiSpeak") &&
    "speechSynthesis" in window
  ) {
    $("rsiSpeak").disabled=false;
  }

  for (const id of [
    "symbol","interval","exchange","market"
  ]) {
    $(id)?.addEventListener("change",()=>{
      syncCommodity();
      clearMarket();
      connect();
      refresh();
      refreshTicker();
      scan(true);
    });
  }

  document.addEventListener(
    "visibilitychange",()=>{
      if (document.hidden) {
        disconnect();
      } else {
        connect();
        refresh();
        refreshTicker();
        scan(true);
      }
    }
  );

  window.addEventListener(
    "cryptolexuz:screen-change",event=>{
      if (event.detail?.screen==="charts") {
        setTimeout(scheduleResize,120);
      }

      if (event.detail?.screen==="results") {
        renderHistory();
      }
    }
  );

  window.addEventListener(
    "cryptolexuz:indicator-settings-change",
    applySavedIndicators
  );

  window.addEventListener(
    "cryptolexuz:volume-profile-ready",()=>{
      volumeProfileAttached=false;
      attachVolumeProfile();
      updateModules(true);
    }
  );

  updateButtons();
}

/* INICIO */

function init() {
  syncCommodity();
  scannerUI();
  renderHistory();

  events();
  applySavedIndicators();

  if (!createCharts()) return;

  connect();
  refresh();
  refreshTicker();
  scan(true);

  chartTimer=setInterval(()=>{
    if (!document.hidden) refresh();
  },15000);

  tickerTimer=setInterval(()=>{
    if (!document.hidden) refreshTicker();
  },10000);

  scanTimer=setInterval(()=>{
    if (!document.hidden) scan();
  },60000);

  verifyTimer=setInterval(()=>{
    if (!document.hidden) {
      verifySignals().catch(console.warn);
    }
  },60000);

  window.addEventListener("beforeunload",()=>{
    disconnect();

    clearInterval(chartTimer);
    clearInterval(tickerTimer);
    clearInterval(scanTimer);
    clearInterval(verifyTimer);

    clearTimeout(interactionTimer);
    resizeObserver?.disconnect();
  });
}

if (document.readyState==="loading") {
  document.addEventListener(
    "DOMContentLoaded",
    init,
    {once:true}
  );
} else {
  init();
}

})();
