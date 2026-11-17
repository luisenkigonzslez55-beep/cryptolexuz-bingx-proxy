
/*
 CRYPTOLEXUZ PRO — APP.JS V14 COMPLETO
 BTC, ETH, BNB, SOL, XRP, DOGE, GOLD y OIL WTI.
 Escáner multitemporal, indicadores y datos en vivo.
 Navegación móvil sin botón Bloquear.
 Integración compatible con fibonacci.js.
*/
"use strict";

(() => {
const $ = id => document.getElementById(id);

const C = {
  green:"#00f5a0",
  red:"#ff476c",
  purple:"#bb52ff",
  orange:"#ff9a35",
  blue:"#36c5ff",
  yellow:"#ffe15a",
  muted:"#a5b0cf"
};

const TF = ["1d","4h","1h","30m","15m","5m","1m"];

const TF_SECONDS = {
  "1m":60,
  "3m":180,
  "5m":300,
  "15m":900,
  "30m":1800,
  "1h":3600,
  "2h":7200,
  "4h":14400,
  "6h":21600,
  "8h":28800,
  "12h":43200,
  "1d":86400,
  "3d":259200,
  "1w":604800
};

const CRYPTOS = [
  "BTC-USDT",
  "ETH-USDT",
  "BNB-USDT",
  "SOL-USDT",
  "XRP-USDT",
  "DOGE-USDT"
];

const GOLD_SYMBOL = "NCCOGOLD2USD-USDT";
const OIL_SYMBOL = "NCCO1OILWTI2USD-USDT";

const COMMODITIES = new Set([
  GOLD_SYMBOL,
  OIL_SYMBOL
]);

const supported = new Set([
  "ema21",
  "ma55",
  "ma100",
  "ma200",
  "rsi",
  "adx",
  "fvg",
  "ifvg",
  "liquidity",
  "sweeps",
  "support",
  "resistance"
]);

const enabled = new Set([
  "ema21",
  "ma55",
  "rsi",
  "fvg"
]);

const charts = {};
const series = {};
const maSeries = {};
const drawnLines = [];

const scanCache = new Map();
const alertHistory = new Map();
const signalHistory = [];
const lastStates = {};

let rows = [];
let zones = [];
let pivots = [];
let sweeps = [];
let activeKey = "";

let requestId = 0;
let loading = false;

let ws = null;
let wsGeneration = 0;
let wsTimer = null;

let lastWsPriceAt = 0;
let lastLiveEvent = null;
let indicatorTimer = null;
let lastIndicatorUpdateAt = 0;
let currentRSIText = "";

let lastMonitorAt = 0;
let monitorBusy = false;
let scanBusy = false;
let scanLastAt = 0;
let scanResults = [];
let scanErrors = [];

let chartTimer = null;
let tickerTimer = null;
let scanTimer = null;

/* UTILIDADES */

function num(v,d=2){
  if(v===null || v===undefined || v===""){
    return "—";
  }

  const n = Number(v);

  return Number.isFinite(n)
    ? n.toLocaleString("en-US",{
        minimumFractionDigits:d,
        maximumFractionDigits:d
      })
    : "—";
}

function value(id,text){
  const el = $(id);
  if(el) el.textContent = text;
}

function normalizeSymbol(input){
  return ["XAU-USDT","GOLD-USDT"].includes(input)
    ? GOLD_SYMBOL
    : input;
}

function selected(){
  const symbol = normalizeSymbol(
    $("symbol")?.value || "BTC-USDT"
  );

  const commodity = COMMODITIES.has(symbol);

  return {
    exchange:commodity
      ? "bingx"
      : ($("exchange")?.value || "bingx").toLowerCase(),
    symbol,
    tf:$("interval")?.value || "15m",
    market:commodity
      ? "perpetual"
      : ($("market")?.value || "perpetual")
  };
}

function syncCommoditySelection(){
  const symbol = normalizeSymbol(
    $("symbol")?.value || ""
  );

  if(COMMODITIES.has(symbol)){
    if($("exchange")) $("exchange").value = "bingx";
    if($("market")) $("market").value = "perpetual";
  }
}

const keyOf = s => [
  s.exchange,
  s.market,
  s.symbol,
  s.tf
].join("|");

function setConnection(text,color=C.green){
  const el = $("connection");

  if(el){
    el.textContent = "● " + text;
    el.style.color = color;
  }
}

function toSeconds(t){
  const n = typeof t==="string" && !/^\d+$/.test(t)
    ? new Date(t).getTime()
    : Number(t);

  return Number.isFinite(n)
    ? Math.floor(n>1e12 ? n/1000 : n)
    : NaN;
}

/* NORMALIZACIÓN DE VELAS */

function normalize(raw){
  let data = raw;

  if(!Array.isArray(data)){
    data =
      data?.data?.data ??
      data?.data?.list ??
      data?.data?.candles ??
      data?.data ??
      data?.list ??
      data?.candles ??
      [];
  }

  if(!Array.isArray(data)) return [];

  const out = [];
  const now = Math.floor(Date.now()/1000);

  for(const x of data){
    if(!x || typeof x!=="object") continue;

    const a = Array.isArray(x);

    const time = toSeconds(
      a ? x[0] :
      x.time ?? x.timestamp ?? x.openTime ?? x.t
    );

    const open = Number(a ? x[1] : x.open ?? x.o);
    const high = Number(a ? x[2] : x.high ?? x.h);
    const low = Number(a ? x[3] : x.low ?? x.l);
    const close = Number(a ? x[4] : x.close ?? x.c);

    const volume = Number(
      a ? x[5] : x.volume ?? x.vol ?? x.v ?? 0
    );

    if(![
      time,open,high,low,close,volume
    ].every(Number.isFinite)) continue;

    if(
      time<=0 ||
      time>now+60 ||
      Math.min(open,high,low,close)<=0 ||
      volume<0 ||
      high<Math.max(open,close,low) ||
      low>Math.min(open,close,high)
    ) continue;

    out.push({
      time,open,high,low,close,volume
    });
  }

  out.sort((a,b)=>a.time-b.time);

  return [
    ...new Map(
      out.map(x=>[x.time,x])
    ).values()
  ];
}

function candleStart(timestamp,tf){
  const s = TF_SECONDS[tf];

  if(!s) return NaN;

  return tf==="1w"
    ? Math.floor((timestamp-4*86400)/s)*s+4*86400
    : Math.floor(timestamp/s)*s;
}

function volumeBar(x){
  return {
    time:x.time,
    value:x.volume,
    color:x.close>=x.open
      ? "rgba(0,245,160,.70)"
      : "rgba(255,71,108,.70)"
  };
}

/* INDICADORES */

function sma(a,p){
  const out = Array(a.length).fill(null);
  let sum = 0;

  for(let i=0;i<a.length;i++){
    sum += a[i];

    if(i>=p) sum -= a[i-p];
    if(i>=p-1) out[i] = sum/p;
  }

  return out;
}

function ema(a,p){
  const out = Array(a.length).fill(null);

  if(a.length<p) return out;

  let sum = 0;

  for(let i=0;i<p;i++) sum += a[i];

  let previous = sum/p;
  out[p-1] = previous;

  const k = 2/(p+1);

  for(let i=p;i<a.length;i++){
    previous = a[i]*k + previous*(1-k);
    out[i] = previous;
  }

  return out;
}

function rsi(a,p=14){
  const out = Array(a.length).fill(null);

  if(a.length<=p) return out;

  let gains = 0;
  let losses = 0;

  for(let i=1;i<=p;i++){
    const d = a[i]-a[i-1];

    gains += Math.max(0,d);
    losses += Math.max(0,-d);
  }

  gains /= p;
  losses /= p;

  const calc = () => losses===0
    ? (gains===0 ? 50 : 100)
    : 100-100/(1+gains/losses);

  out[p] = calc();

  for(let i=p+1;i<a.length;i++){
    const d = a[i]-a[i-1];

    gains = (gains*(p-1)+Math.max(0,d))/p;
    losses = (losses*(p-1)+Math.max(0,-d))/p;

    out[i] = calc();
  }

  return out;
}

function adx(a,p=14){
  const n = a.length;

  const ADX = Array(n).fill(null);
  const PLUS = Array(n).fill(null);
  const MINUS = Array(n).fill(null);

  if(n<p*2){
    return {
      adx:ADX,
      plus:PLUS,
      minus:MINUS
    };
  }

  const tr = Array(n).fill(0);
  const pdm = Array(n).fill(0);
  const mdm = Array(n).fill(0);

  for(let i=1;i<n;i++){
    const up = a[i].high-a[i-1].high;
    const down = a[i-1].low-a[i].low;

    pdm[i] = up>down && up>0 ? up : 0;
    mdm[i] = down>up && down>0 ? down : 0;

    tr[i] = Math.max(
      a[i].high-a[i].low,
      Math.abs(a[i].high-a[i-1].close),
      Math.abs(a[i].low-a[i-1].close)
    );
  }

  let atr = 0;
  let sp = 0;
  let sm = 0;

  for(let i=1;i<=p;i++){
    atr += tr[i];
    sp += pdm[i];
    sm += mdm[i];
  }

  const dx = Array(n).fill(null);

  for(let i=p;i<n;i++){
    if(i>p){
      atr = atr-atr/p+tr[i];
      sp = sp-sp/p+pdm[i];
      sm = sm-sm/p+mdm[i];
    }

    PLUS[i] = atr ? 100*sp/atr : 0;
    MINUS[i] = atr ? 100*sm/atr : 0;

    dx[i] = PLUS[i]+MINUS[i]
      ? 100*Math.abs(PLUS[i]-MINUS[i])/
        (PLUS[i]+MINUS[i])
      : 0;
  }

  const first = p*2-1;
  let total = 0;

  for(let i=p;i<=first;i++) total += dx[i];

  ADX[first] = total/p;

  for(let i=first+1;i<n;i++){
    ADX[i] = (ADX[i-1]*(p-1)+dx[i])/p;
  }

  return {
    adx:ADX,
    plus:PLUS,
    minus:MINUS
  };
}

function lineData(a,values){
  return a.flatMap((x,i)=>
    Number.isFinite(values[i])
      ? [{time:x.time,value:values[i]}]
      : []
  );
}

/* CONFIGURACIÓN DE GRÁFICAS */

function chartOptions(height){
  return {
    width:300,
    height,

    layout:{
      background:{color:"#080e20"},
      textColor:"#c9d3ee",
      fontSize:11
    },

    grid:{
      vertLines:{color:"#15213a"},
      horzLines:{color:"#15213a"}
    },

    rightPriceScale:{
      borderColor:"#34456c",
      minimumWidth:65
    },

    timeScale:{
      borderColor:"#34456c",
      timeVisible:true,
      secondsVisible:false
    },

    crosshair:{
      mode:LightweightCharts.CrosshairMode.Normal
    },

    handleScroll:{
      mouseWheel:true,
      pressedMouseMove:true,
      horzTouchDrag:false,
      vertTouchDrag:false
    },

    handleScale:{
      mouseWheel:true,
      pinch:true,
      axisPressedMouseMove:true
    }
  };
}

function createCharts(){
  if(!window.LightweightCharts || !$("chart")){
    value("message","No se pudo cargar la gráfica.");
    setConnection("Error de gráfica",C.red);
    return false;
  }

  charts.price = LightweightCharts.createChart(
    $("chart"),
    chartOptions(360)
  );

  series.price = charts.price.addCandlestickSeries({
    upColor:C.green,
    downColor:C.red,
    wickUpColor:C.green,
    wickDownColor:C.red,
    borderVisible:false,
    priceLineVisible:true
  });

  for(const [key,color] of Object.entries({
    ema21:C.purple,
    ma55:C.orange,
    ma100:C.red,
    ma200:C.blue
  })){
    maSeries[key] = charts.price.addLineSeries({
      color,
      lineWidth:2,
      priceLineVisible:false,
      lastValueVisible:false,
      crosshairMarkerVisible:false
    });
  }

  for(const [key,id,height] of [
    ["volume","volumeChart",115],
    ["rsi","rsiChart",145],
    ["adx","adxChart",145]
  ]){
    if($(id)){
      charts[key] = LightweightCharts.createChart(
        $(id),
        chartOptions(height)
      );
    }
  }

  if(charts.volume){
    series.volume = charts.volume.addHistogramSeries({
      priceFormat:{type:"volume"},
      priceScaleId:""
    });

    series.volume.priceScale().applyOptions({
      scaleMargins:{
        top:.12,
        bottom:0
      }
    });
  }

  if(charts.rsi){
    series.rsi = charts.rsi.addLineSeries({
      color:C.purple,
      lineWidth:2,
      priceLineVisible:false
    });

    for(const level of [30,50,70]){
      series.rsi.createPriceLine({
        price:level,
        color:level===50?"#607399":"#a24d9c",
        lineWidth:1,
        lineStyle:LightweightCharts.LineStyle.Dashed,
        axisLabelVisible:true
      });
    }
  }

  if(charts.adx){
    for(const [key,color] of [
      ["adx",C.yellow],
      ["plus",C.green],
      ["minus",C.red]
    ]){
      series[key] = charts.adx.addLineSeries({
        color,
        lineWidth:2,
        priceLineVisible:false
      });
    }

    series.adx.createPriceLine({
      price:25,
      color:"#7d89a8",
      lineStyle:LightweightCharts.LineStyle.Dashed,
      axisLabelVisible:true
    });
  }

  const all = Object.values(charts);
  let syncing = false;

  for(const chart of all){
    chart.timeScale()
      .subscribeVisibleLogicalRangeChange(range=>{
        if(syncing || !range) return;

        syncing = true;

        try{
          for(const other of all){
            if(other!==chart){
              try{
                other.timeScale()
                  .setVisibleLogicalRange(range);
              }catch(_){}
            }
          }
        }finally{
          syncing = false;
        }

        drawZones();
      });
  }

  const resize = () => {
    for(const [key,id] of [
      ["price","chart"],
      ["volume","volumeChart"],
      ["rsi","rsiChart"],
      ["adx","adxChart"]
    ]){
      const el = $(id);

      if(
        el &&
        charts[key] &&
        el.clientWidth>0 &&
        el.clientHeight>0
      ){
        charts[key].resize(
          el.clientWidth,
          el.clientHeight
        );
      }
    }

    resizeCanvas();
  };

  if(window.ResizeObserver){
    const observer = new ResizeObserver(resize);

    for(const id of [
      "chart",
      "volumeChart",
      "rsiChart",
      "adxChart"
    ]){
      if($(id)) observer.observe($(id));
    }
  }

  window.addEventListener("resize",resize);

  setTimeout(resize,100);

  setChartNavigation();

  return true;
}

/* NAVEGACIÓN TÁCTIL */

function setChartNavigation(){
  if(!charts.price) return;

  charts.price.applyOptions({
    handleScroll:{
      mouseWheel:true,
      pressedMouseMove:true,
      horzTouchDrag:false,
      vertTouchDrag:false
    },

    handleScale:{
      mouseWheel:true,
      pinch:true,
      axisPressedMouseMove:true
    }
  });

  $("chartNavigation")?.remove();

  value(
    "chartTouchStatus",
    "Desliza la página con un dedo. Usa dos dedos para ampliar o reducir las velas."
  );
}

function resetView(){
  if(!charts.price || !rows.length) return;

  charts.price.timeScale().setVisibleLogicalRange({
    from:Math.max(0,rows.length-50),
    to:rows.length+3
  });
}

/* ESTRUCTURA DEL PRECIO */

function detectPivots(a){
  const found = [];

  for(let i=4;i<a.length-4;i++){
    let hi = true;
    let lo = true;

    for(let j=i-4;j<=i+4;j++){
      if(i===j) continue;

      if(a[j].high>=a[i].high) hi = false;
      if(a[j].low<=a[i].low) lo = false;
    }

    if(hi){
      found.push({
        index:i,
        price:a[i].high,
        type:"high"
      });
    }

    if(lo){
      found.push({
        index:i,
        price:a[i].low,
        type:"low"
      });
    }
  }

  return found.slice(-40);
}

function detectFVG(a){
  const found = [];

  for(let i=2;i<a.length;i++){
    const bull = a[i].low>a[i-2].high;
    const bear = a[i].high<a[i-2].low;

    if(!bull && !bear) continue;

    const top = bull
      ? a[i].low
      : a[i-2].low;

    const bottom = bull
      ? a[i-2].high
      : a[i].high;

    const middle = (top+bottom)/2;

    if((top-bottom)/middle<.00035) continue;

    let end = a.length-1;
    let filled = false;
    let inverted = false;

    for(let j=i+1;j<a.length;j++){
      if(bull && a[j].low<=bottom){
        end = j;
        filled = true;
        inverted = a[j].close<bottom;
        break;
      }

      if(bear && a[j].high>=top){
        end = j;
        filled = true;
        inverted = a[j].close>top;
        break;
      }
    }

    found.push({
      start:i-2,
      end,
      top,
      bottom,
      bull,
      filled,
      inverted
    });
  }

  return found.slice(-80);
}

function detectSweeps(a){
  const found = [];

  for(let i=20;i<a.length-1;i++){
    const previous = a.slice(i-20,i);

    const high = Math.max(
      ...previous.map(x=>x.high)
    );

    const low = Math.min(
      ...previous.map(x=>x.low)
    );

    if(a[i].high>high && a[i].close<high){
      found.push({
        time:a[i].time,
        position:"aboveBar",
        color:C.red,
        shape:"arrowDown",
        text:"Barrido ↑"
      });
    }

    if(a[i].low<low && a[i].close>low){
      found.push({
        time:a[i].time,
        position:"belowBar",
        color:C.green,
        shape:"arrowUp",
        text:"Barrido ↓"
      });
    }
  }

  return found.slice(-25);
}

function updateLevels(){
  for(const line of drawnLines){
    try{
      series.price.removePriceLine(line);
    }catch(_){}
  }

  drawnLines.length = 0;

  const recent = pivots.slice(-18);

  function add(price,color,title){
    if(!Number.isFinite(price)) return;

    drawnLines.push(
      series.price.createPriceLine({
        price,
        color,
        lineWidth:1,
        lineStyle:LightweightCharts.LineStyle.Dashed,
        axisLabelVisible:true,
        title
      })
    );
  }

  if(enabled.has("support")){
    const x = recent.filter(
      x=>x.type==="low"
    ).at(-1);

    if(x) add(x.price,C.green,"Soporte");
  }

  if(enabled.has("resistance")){
    const x = recent.filter(
      x=>x.type==="high"
    ).at(-1);

    if(x) add(x.price,C.red,"Resistencia");
  }

  if(enabled.has("liquidity")){
    for(const x of recent.filter(
      x=>x.type==="high"
    ).slice(-2)){
      add(x.price,C.red,"Máximo previo");
    }

    for(const x of recent.filter(
      x=>x.type==="low"
    ).slice(-2)){
      add(x.price,C.green,"Mínimo previo");
    }
  }
}

/* CAPA DE FVG */

function resizeCanvas(){
  const canvas = $("zonesCanvas");
  const area = $("priceChartArea");

  if(!canvas || !area) return;

  const dpr = Math.min(
    window.devicePixelRatio || 1,
    2
  );

  canvas.width = Math.round(
    area.clientWidth*dpr
  );

  canvas.height = Math.round(
    area.clientHeight*dpr
  );

  canvas.getContext("2d")?.setTransform(
    dpr,0,0,dpr,0,0
  );

  drawZones();
}

function drawZones(){
  const canvas = $("zonesCanvas");
  const area = $("priceChartArea");

  if(!canvas || !area || !charts.price) return;

  const ctx = canvas.getContext("2d");

  if(!ctx) return;

  const width = area.clientWidth;
  const height = area.clientHeight;

  ctx.clearRect(0,0,width,height);

  if(
    !rows.length ||
    (!enabled.has("fvg") && !enabled.has("ifvg"))
  ) return;

  const scale = charts.price.timeScale();
  const maxX = Math.max(0,width-70);

  const visible = zones.filter(z=>
    (!z.filled && enabled.has("fvg")) ||
    (z.inverted && enabled.has("ifvg"))
  ).slice(-18);

  for(const z of visible){
    const x1 = scale.logicalToCoordinate(z.start);
    const x2 = scale.logicalToCoordinate(z.end);

    const y1 = series.price.priceToCoordinate(z.top);
    const y2 = series.price.priceToCoordinate(z.bottom);

    if(![x1,x2,y1,y2].every(Number.isFinite)){
      continue;
    }

    const left = Math.max(0,x1);
    const right = Math.min(maxX,x2);

    const top = Math.max(
      0,
      Math.min(y1,y2)
    );

    const bottom = Math.min(
      height,
      Math.max(y1,y2)
    );

    if(right<=left || bottom<=top) continue;

    ctx.fillStyle = z.inverted
      ? "rgba(255,225,90,.10)"
      : z.bull
        ? "rgba(0,245,160,.09)"
        : "rgba(255,71,108,.09)";

    ctx.fillRect(
      left,top,right-left,bottom-top
    );

    ctx.strokeStyle = z.inverted
      ? "rgba(255,225,90,.50)"
      : z.bull
        ? "rgba(0,245,160,.40)"
        : "rgba(255,71,108,.40)";

    ctx.lineWidth = 1;

    ctx.strokeRect(
      left,top,right-left,bottom-top
    );
  }
}

/* INTERPRETACIONES */

function rsiInterpretation(v){
  if(!Number.isFinite(v)){
    return "RSI no disponible.";
  }

  if(v<30){
    return "RSI "+num(v,1)+
      ": sobreventa; no confirma rebote.";
  }

  if(v<40){
    return "RSI "+num(v,1)+
      ": predominio vendedor.";
  }

  if(v<50){
    return "RSI "+num(v,1)+
      ": impulso ligeramente bajista.";
  }

  if(v<60){
    return "RSI "+num(v,1)+
      ": impulso ligeramente alcista.";
  }

  if(v<70){
    return "RSI "+num(v,1)+
      ": predominio comprador.";
  }

  return "RSI "+num(v,1)+
    ": sobrecompra; no implica caída inmediata.";
}

function adxInterpretation(ax,plus,minus){
  if(![ax,plus,minus].every(Number.isFinite)){
    return "ADX no disponible.";
  }

  const strength = ax<20
    ? "tendencia débil"
    : ax<25
      ? "tendencia en desarrollo"
      : ax<40
        ? "tendencia con fuerza"
        : "tendencia muy fuerte";

  const direction = plus>minus
    ? "predominio comprador"
    : minus>plus
      ? "predominio vendedor"
      : "equilibrio";

  return "ADX "+num(ax,1)+": "+strength+
    ". +DI "+num(plus,1)+
    " y −DI "+num(minus,1)+
    ": "+direction+".";
}

function volumeInterpretation(a){
  if(a.length<22){
    return "Volumen insuficiente.";
  }

  const closed = a.slice(0,-1);
  const last = closed.at(-1);
  const previous = closed.slice(-21,-1);

  const average = previous.reduce(
    (s,x)=>s+x.volume,0
  )/previous.length;

  if(!average){
    return "No hay volumen suficiente.";
  }

  const ratio = last.volume/average;

  const strength = ratio>=1.8
    ? "volumen muy elevado"
    : ratio>=1.3
      ? "volumen superior al promedio"
      : ratio<.7
        ? "volumen reducido"
        : "volumen cercano al promedio";

  return "Última vela cerrada "+
    (last.close>=last.open?"alcista":"bajista")+
    ", con "+strength+
    " ("+num(ratio,2)+" veces el promedio).";
}

/* ACTUALIZACIÓN DE INDICADORES */

function updateIndicators(){
  if(!rows.length || !series.price) return;

  const closes = rows.map(x=>x.close);

  const e21 = ema(closes,21);
  const m55 = sma(closes,55);
  const m100 = sma(closes,100);
  const m200 = sma(closes,200);

  const rv = rsi(closes);
  const av = adx(rows);

  for(const [key,arr] of Object.entries({
    ema21:e21,
    ma55:m55,
    ma100:m100,
    ma200:m200
  })){
    maSeries[key]?.setData(
      enabled.has(key)
        ? lineData(rows,arr)
        : []
    );
  }

  series.rsi?.setData(
    enabled.has("rsi")
      ? lineData(rows,rv)
      : []
  );

  for(const [key,arr] of [
    ["adx",av.adx],
    ["plus",av.plus],
    ["minus",av.minus]
  ]){
    series[key]?.setData(
      enabled.has("adx")
        ? lineData(rows,arr)
        : []
    );
  }

  const i = Math.max(0,rows.length-2);

  value("ema21Value",num(e21[i]));
  value("ma55Value",num(m55[i]));

  value("rsiValue",num(rv[i],1));
  value("adxValue",num(av.adx[i],1));

  value("rsiChartValue",num(rv[i],1));
  value("adxChartValue",num(av.adx[i],1));

  currentRSIText = rsiInterpretation(rv[i]);

  value("rsiInterpretation",currentRSIText);

  value(
    "adxInterpretation",
    adxInterpretation(
      av.adx[i],
      av.plus[i],
      av.minus[i]
    )
  );

  value(
    "volumeInterpretation",
    volumeInterpretation(rows)
  );

  let trend = "Mixta";

  if(
    Number.isFinite(e21[i]) &&
    Number.isFinite(m55[i])
  ){
    if(
      closes[i]>e21[i] &&
      e21[i]>m55[i]
    ){
      trend = "Sesgo alcista";
    }else if(
      closes[i]<e21[i] &&
      e21[i]<m55[i]
    ){
      trend = "Sesgo bajista";
    }
  }

  value(
    "indicatorReadout",
    trend+". "+currentRSIText
  );

  pivots = detectPivots(rows);
  zones = detectFVG(rows);
  sweeps = detectSweeps(rows);

  updateLevels();

  series.price.setMarkers(
    enabled.has("sweeps") ? sweeps : []
  );

  if($("rsiSection")){
    $("rsiSection").hidden = !enabled.has("rsi");
  }

  if($("adxSection")){
    $("adxSection").hidden = !enabled.has("adx");
  }

  requestAnimationFrame(()=>{
    for(const [key,id] of [
      ["adx","adxChart"],
      ["rsi","rsiChart"]
    ]){
      const el = $(id);

      if(
        enabled.has(key) &&
        el?.clientWidth &&
        charts[key]
      ){
        charts[key].resize(
          el.clientWidth,
          el.clientHeight
        );
      }
    }

    drawZones();
  });
}

/* MOTOR DE SEÑALES */

function metricFor(data){
  const closed = data.slice(0,-1);

  if(closed.length<60) return null;

  const closes = closed.map(x=>x.close);
  const last = closed.at(-1);

  const e = ema(closes,21).at(-1);
  const m = sma(closes,55).at(-1);
  const rv = rsi(closes).at(-1);

  const ad = adx(closed);

  const ax = ad.adx.at(-1);
  const plus = ad.plus.at(-1);
  const minus = ad.minus.at(-1);

  if(![
    e,m,rv,ax,plus,minus
  ].every(Number.isFinite)){
    return null;
  }

  const volBase = closed.slice(-21,-1)
    .reduce((sum,x)=>sum+x.volume,0)/20;

  const volRatio = volBase>0
    ? last.volume/volBase
    : null;

  let bull = 0;
  let bear = 0;

  if(last.close>e) bull++;
  if(last.close<e) bear++;

  if(e>m) bull++;
  if(e<m) bear++;

  if(rv>=55) bull++;
  if(rv<=45) bear++;

  if(plus>minus) bull++;
  if(minus>plus) bear++;

  const previous = closed.slice(-7,-1);

  return {
    bull,
    bear,
    adx:ax,
    rsi:rv,
    plus,
    minus,
    volRatio,
    close:last.close,
    closedTime:last.time,

    breakHigh:last.close>Math.max(
      ...previous.map(x=>x.high)
    ),

    breakLow:last.close<Math.min(
      ...previous.map(x=>x.low)
    )
  };
}

function analyzeSignal(data){
  const m = metricFor(data);

  if(!m){
    return {
      state:"SIN DATOS",
      direction:"neutral",
      detail:"Historial insuficiente.",
      metrics:"Esperando indicadores",
      price:null
    };
  }

  let state = "LATERAL / MIXTO";
  let direction = "neutral";

  if(m.bull>=3 && m.bull>m.bear){
    state = "SESGO ALCISTA";
    direction = "bullish";
  }else if(m.bear>=3 && m.bear>m.bull){
    state = "SESGO BAJISTA";
    direction = "bearish";
  }

  const opportunity =
    m.bull===4 && m.adx>=25 && m.rsi<70
      ? "Posible LONG"
      : m.bear===4 && m.adx>=25 && m.rsi>30
        ? "Posible SHORT"
        : "Sin entrada confirmada";

  return {
    state,
    direction,
    detail:opportunity+
      ". Requiere confirmación del precio.",

    metrics:
      "RSI "+num(m.rsi,1)+
      " · ADX "+num(m.adx,1)+
      " · +DI "+num(m.plus,1)+
      " · −DI "+num(m.minus,1),

    price:m.close
  };
}

function recordSignal(tf,symbol,result){
  if(result.state==="SIN DATOS") return;

  const key = symbol+"|"+tf;

  if(lastStates[key]===result.state) return;

  lastStates[key] = result.state;

  signalHistory.unshift({
    time:new Date().toLocaleTimeString("es-MX"),
    tf,
    symbol,
    state:result.state,
    price:result.price,
    detail:result.detail
  });

  if(signalHistory.length>30){
    signalHistory.length = 30;
  }

  renderHistory();
}

function renderHistory(){
  const tbody = $("signalLog");

  if(!tbody) return;

  tbody.replaceChildren();

  for(const s of signalHistory){
    const tr = document.createElement("tr");

    for(const text of [
      s.time,
      s.tf,
      s.symbol,
      s.state,
      num(s.price),
      s.detail,
      "Observación"
    ]){
      const td = document.createElement("td");
      td.textContent = text;
      tr.appendChild(td);
    }

    tbody.appendChild(tr);
  }
}

function showSignal(tf,symbol,result){
  const suffix = tf==="5m" ? "5" : "15";

  value("state"+suffix,result.state);
  value("detail"+suffix,result.detail);
  value("metrics"+suffix,result.metrics);

  const state = $("state"+suffix);

  if(state){
    state.className = "state "+result.direction;

    const heading = state.closest(".signal-card")
      ?.querySelector("h3");

    if(heading){
      heading.textContent =
        symbol+" / "+
        (tf==="5m"?"5":"15")+
        " minutos";
    }
  }

  recordSignal(tf,symbol,result);
}

/* API */

async function getJSON(url,timeout=12000){
  const controller = new AbortController();

  const timer = setTimeout(
    ()=>controller.abort(),
    timeout
  );

  try{
    const response = await fetch(url,{
      signal:controller.signal,
      cache:"no-store"
    });

    if(!response.ok){
      throw new Error("HTTP "+response.status);
    }

    return await response.json();
  }finally{
    clearTimeout(timer);
  }
}

function candleURL(
  market,
  symbol,
  tf,
  limit=300,
  exchange="bingx"
){
  return "/api/exchange/"+
    encodeURIComponent(exchange)+
    "/klines/"+
    encodeURIComponent(symbol)+
    "?market="+encodeURIComponent(market)+
    "&interval="+encodeURIComponent(tf)+
    "&limit="+limit;
}

function tickerURL(
  market,
  symbol,
  exchange="bingx"
){
  return "/api/exchange/"+
    encodeURIComponent(exchange)+
    "/ticker/"+
    encodeURIComponent(symbol)+
    "?market="+encodeURIComponent(market);
}

function unwrapTicker(raw){
  let d = raw?.data ?? raw;

  if(Array.isArray(d)){
    d = d[0] ?? {};
  }

  if(d?.data) d = d.data;

  if(Array.isArray(d)){
    d = d[0] ?? {};
  }

  return d || {};
}

/* PRECIOS EN VIVO */

function setLivePrice(price,source="websocket"){
  const p = Number(price);

  if(!Number.isFinite(p) || p<=0) return;

  value("price",num(p));

  value(
    "updated",
    new Date().toLocaleTimeString("es-MX")
  );

  if(source==="websocket"){
    lastWsPriceAt = Date.now();

    setConnection(
      selected().exchange.toUpperCase()+
      " · en vivo",
      C.green
    );
  }else if(Date.now()-lastWsPriceAt>7000){
    setConnection(
      selected().exchange.toUpperCase()+
      " · respaldo REST",
      C.yellow
    );
  }
}

function scheduleIndicators(){
  if(indicatorTimer) return;

  const delay = Math.max(
    0,
    1500-(Date.now()-lastIndicatorUpdateAt)
  );

  indicatorTimer = setTimeout(()=>{
    indicatorTimer = null;
    lastIndicatorUpdateAt = Date.now();

    if(rows.length){
      updateIndicators();
    }
  },delay);
}

function applyLiveCandle(
  price,
  timestamp=Date.now()
){
  if(
    !series.price ||
    !rows.length ||
    !Number.isFinite(price) ||
    price<=0 ||
    activeKey!==keyOf(selected())
  ) return;

  const s = selected();
  const eventSeconds = Math.floor(timestamp/1000);
  const bucket = candleStart(eventSeconds,s.tf);
  const last = rows.at(-1);
  const interval = TF_SECONDS[s.tf];

  if(
    !Number.isFinite(bucket) ||
    !last ||
    !interval ||
    bucket<last.time ||
    eventSeconds>Math.floor(Date.now()/1000)+10
  ) return;

  if(Math.abs(price/last.close-1)>.20){
    value(
      "status",
      "Precio atípico: verificar REST"
    );
    return;
  }

  if(bucket-last.time>interval*2){
    refresh();
    return;
  }

  let candle;

  if(bucket===last.time){
    candle = {
      ...last,
      high:Math.max(last.high,price),
      low:Math.min(last.low,price),
      close:price
    };

    rows[rows.length-1] = candle;
  }else{
    candle = {
      time:bucket,
      open:price,
      high:price,
      low:price,
      close:price,
      volume:0
    };

    rows.push(candle);

    if(rows.length>350){
      rows.shift();

      series.price.setData(rows);

      series.volume?.setData(
        rows.map(volumeBar)
      );

      scheduleIndicators();
      return;
    }
  }

  series.price.update(candle);

  series.volume?.update(
    volumeBar(candle)
  );

  scheduleIndicators();
}

function receiveLivePrice(
  price,
  source,
  timestamp,
  config
){
  const p = Number(price);
  const ts = Number(timestamp);
  const s = selected();

  if(
    !Number.isFinite(p) ||
    p<=0 ||
    config.exchange!==s.exchange ||
    config.market!==s.market ||
    config.symbol!==s.symbol
  ) return;

  const eventTime =
    Number.isFinite(ts) &&
    Math.abs(ts-Date.now())<60000
      ? ts
      : Date.now();

  lastLiveEvent = {
    price:p,
    timestamp:eventTime,
    receivedAt:Date.now(),
    key:keyOf(s)
  };

  setLivePrice(p,source);
  applyLiveCandle(p,eventTime);
}

function updateTicker(
  raw,
  allowPrice=true,
  selection=selected()
){
  const d = unwrapTicker(raw);

  const price = Number(
    d.lastPrice ?? d.last ??
    d.price ?? d.close ?? d.c
  );

  const high = Number(
    d.highPrice ?? d.high24h ??
    d.high ?? d.h
  );

  const low = Number(
    d.lowPrice ?? d.low24h ??
    d.low ?? d.l
  );

  const open = Number(
    d.openPrice ?? d.open24h ??
    d.open ?? d.o
  );

  const volume = Number(
    d.volume ?? d.volume24h ??
    d.vol ?? d.v
  );

  let change = Number(
    d.priceChangePercent ??
    d.changePercent ??
    d.changeRate
  );

  if(
    !Number.isFinite(change) &&
    Number.isFinite(price) &&
    Number.isFinite(open) &&
    open!==0
  ){
    change = (price/open-1)*100;
  }

  if(
    allowPrice &&
    Number.isFinite(price) &&
    price>0
  ){
    receiveLivePrice(
      price,
      "rest",
      Date.now(),
      selection
    );
  }

  value("high",num(high));
  value("low",num(low));
  value("open",num(open));
  value("volume",num(volume,0));

  const el = $("change");

  if(el){
    el.textContent = Number.isFinite(change)
      ? (change>=0?"+":"")+num(change)+"%"
      : "—";

    el.classList.toggle(
      "negative",
      change<0
    );

    el.style.color = change<0
      ? C.red
      : C.green;
  }

  value(
    "bid",
    num(d.bidPrice ?? d.bid ?? d.bestBid)
  );

  value(
    "ask",
    num(d.askPrice ?? d.ask ?? d.bestAsk)
  );
}

/* MONITOR DE CINCO Y QUINCE MINUTOS */

async function monitor(symbol,market,exchange){
  if(
    monitorBusy ||
    Date.now()-lastMonitorAt<60000
  ) return;

  monitorBusy = true;

  try{
    const [five,fifteen] = await Promise.all([
      getJSON(
        candleURL(
          market,symbol,"5m",300,exchange
        )
      ),

      getJSON(
        candleURL(
          market,symbol,"15m",300,exchange
        )
      )
    ]);

    const now = selected();

    if(
      now.symbol!==symbol ||
      now.market!==market ||
      now.exchange!==exchange
    ) return;

    showSignal(
      "5m",
      symbol,
      analyzeSignal(normalize(five))
    );

    showSignal(
      "15m",
      symbol,
      analyzeSignal(normalize(fifteen))
    );

    value("engineState","ANALIZANDO");

    lastMonitorAt = Date.now();
  }catch(error){
    value("engineState","SIN CONEXIÓN");

    console.warn(
      "Monitor:",
      error.message
    );
  }finally{
    monitorBusy = false;
  }
}

/* ACTUALIZACIÓN DE GRÁFICA */

function applyCandles(data,s){
  const changed = activeKey!==keyOf(s);

  let previousRange = null;

  if(!changed){
    try{
      previousRange = charts.price.timeScale()
        .getVisibleLogicalRange();
    }catch(_){}
  }

  rows = data;
  activeKey = keyOf(s);

  series.price.setData(rows);

  series.volume?.setData(
    rows.map(volumeBar)
  );

  updateIndicators();

  if(changed){
    resetView();
  }else if(previousRange){
    try{
      charts.price.timeScale()
        .setVisibleLogicalRange(previousRange);
    }catch(_){}
  }

  value(
    "chartTitle",
    s.symbol+" · "+s.tf
  );

  value(
    "volumeLabel",
    s.symbol===OIL_SYMBOL
      ? "OIL WTI"
      : s.symbol===GOLD_SYMBOL
        ? "GOLD"
        : s.symbol.split("-")[0]
  );

  if(
    $("priceChartArea") &&
    !$("zonesCanvas")?.width
  ){
    resizeCanvas();
  }else{
    drawZones();
  }
}

async function refresh(){
  if(loading || !series.price) return;

  loading = true;

  const id = ++requestId;
  const s = selected();
  const started = Date.now();

  value(
    "status",
    "Consultando velas de "+
    s.exchange.toUpperCase()+"..."
  );

  try{
    const result = await getJSON(
      candleURL(
        s.market,
        s.symbol,
        s.tf,
        300,
        s.exchange
      )
    );

    if(
      id!==requestId ||
      keyOf(s)!==keyOf(selected())
    ) return;

    const data = normalize(result);

    if(!data.length){
      throw new Error(
        "No se recibieron velas válidas"
      );
    }

    const live = lastLiveEvent;

    if(
      live &&
      live.key===keyOf(s) &&
      live.receivedAt>=started
    ){
      const bucket = candleStart(
        Math.floor(live.timestamp/1000),
        s.tf
      );

      const last = data.at(-1);

      if(
        bucket===last.time &&
        live.price>0 &&
        Math.abs(live.price/last.close-1)<.20
      ){
        last.high = Math.max(
          last.high,
          live.price
        );

        last.low = Math.min(
          last.low,
          live.price
        );

        last.close = live.price;
      }else if(
        bucket>last.time &&
        bucket-last.time<=TF_SECONDS[s.tf]*2 &&
        Math.abs(live.price/last.close-1)<.20
      ){
        data.push({
          time:bucket,
          open:live.price,
          high:live.price,
          low:live.price,
          close:live.price,
          volume:0
        });
      }
    }

    applyCandles(data,s);

    value("status","Velas actualizadas");
    value("message","");

    monitor(
      s.symbol,
      s.market,
      s.exchange
    );
  }catch(error){
    if(
      id===requestId &&
      keyOf(s)===keyOf(selected())
    ){
      value(
        "status",
        "Error de velas: "+error.message
      );

      value(
        "message",
        "Comprueba la conexión y el servidor."
      );
    }

    console.warn("Velas:",error);
  }finally{
    loading = false;
  }
}

async function refreshTicker(){
  const s = selected();

  try{
    const raw = await getJSON(
      tickerURL(
        s.market,
        s.symbol,
        s.exchange
      ),
      8000
    );

    if(keyOf(s)!==keyOf(selected())){
      return;
    }

    updateTicker(
      raw,
      Date.now()-lastWsPriceAt>7000,
      s
    );
  }catch(error){
    console.warn(
      "Ticker:",
      error.message
    );
  }
}

/* WEBSOCKET */

function disconnectWS(){
  wsGeneration++;

  if(wsTimer){
    clearTimeout(wsTimer);
    wsTimer = null;
  }

  if(ws){
    const old = ws;
    ws = null;

    old.onopen = null;
    old.onmessage = null;
    old.onerror = null;
    old.onclose = null;

    try{
      old.close();
    }catch(_){}
  }
}

function connectWS(){
  disconnectWS();

  const generation = wsGeneration;

  const {
    exchange,
    symbol,
    market
  } = selected();

  const config = {
    exchange,
    symbol,
    market
  };

  const scheme = location.protocol==="https:"
    ? "wss:"
    : "ws:";

  const url =
    scheme+"//"+location.host+
    "/ws?exchange="+encodeURIComponent(exchange)+
    "&market="+encodeURIComponent(market)+
    "&symbol="+encodeURIComponent(symbol);

  lastWsPriceAt = 0;

  setConnection(
    exchange.toUpperCase()+" · conectando",
    C.yellow
  );

  let socket;

  try{
    socket = new WebSocket(url);
  }catch(_){
    scheduleReconnect(generation);
    return;
  }

  ws = socket;

  socket.onopen = ()=>{
    if(generation===wsGeneration){
      setConnection(
        exchange.toUpperCase()+
        " · esperando precios",
        C.yellow
      );
    }
  };

  socket.onmessage = event=>{
    if(generation!==wsGeneration) return;

    let data;

    try{
      data = JSON.parse(event.data);
    }catch(_){
      return;
    }

    if(data.type==="price"){
      if(
        data.exchange!==exchange ||
        data.market!==market ||
        data.symbol!==symbol
      ) return;

      receiveLivePrice(
        Number(data.price),
        data.source==="websocket"
          ? "websocket"
          : "rest",
        Number(data.timestamp),
        config
      );
    }else if(
      data.type==="status" &&
      data.status==="reconnecting"
    ){
      setConnection(
        exchange.toUpperCase()+
        " · reconectando",
        C.yellow
      );
    }
  };

  socket.onerror = ()=>{
    if(generation===wsGeneration){
      setConnection(
        exchange.toUpperCase()+
        " · conexión interrumpida",
        C.yellow
      );
    }
  };

  socket.onclose = ()=>{
    if(generation!==wsGeneration) return;

    ws = null;

    setConnection(
      exchange.toUpperCase()+
      " · reconectando",
      C.yellow
    );

    scheduleReconnect(generation);
  };
}

function scheduleReconnect(generation){
  if(generation!==wsGeneration) return;

  if(wsTimer){
    clearTimeout(wsTimer);
  }

  wsTimer = setTimeout(()=>{
    if(
      generation===wsGeneration &&
      !document.hidden
    ){
      connectWS();
    }
  },3000);
}

/* ACTIVOS */

function ensureCommodityOptions(){
  const select = $("symbol");

  if(!select) return;

  const goldAliases = new Set([
    "XAU-USDT",
    "GOLD-USDT",
    GOLD_SYMBOL
  ]);

  const goldOptions = [...select.options]
    .filter(o=>goldAliases.has(o.value));

  const gold = goldOptions[0] ||
    document.createElement("option");

  gold.value = GOLD_SYMBOL;
  gold.textContent = "GOLD (XAU) · BingX";

  if(!gold.parentElement){
    select.appendChild(gold);
  }

  for(const duplicate of goldOptions.slice(1)){
    duplicate.remove();
  }

  const oilOptions = [...select.options]
    .filter(o=>o.value===OIL_SYMBOL);

  const oil = oilOptions[0] ||
    document.createElement("option");

  oil.value = OIL_SYMBOL;
  oil.textContent = "OIL WTI · BingX";

  if(!oil.parentElement){
    select.appendChild(oil);
  }

  for(const duplicate of oilOptions.slice(1)){
    duplicate.remove();
  }
}

/* ESCÁNER MULTITEMPORAL */

function ensureScannerUI(){
  if($("clScanner")) return;

  const section = document.createElement("section");

  section.id = "clScanner";

  section.style.cssText = [
    "margin:16px 0",
    "padding:16px",
    "background:#0c1529",
    "color:#dbe7ff",
    "border:1px solid #263b60",
    "border-radius:14px",
    "font:14px system-ui,sans-serif"
  ].join(";");

  section.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap">
      <div>
        <strong style="font-size:17px">📡 Escáner CRYPTOLEXUZ V14</strong>
        <div id="clScanStatus" style="color:#a5b0cf;font-size:12px;margin-top:4px">
          Esperando primer análisis...
        </div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button type="button" id="clNotify" style="background:#243b60;color:white;border:0;border-radius:8px;padding:9px">
          🔔 Activar avisos
        </button>
        <button type="button" id="clScanNow" style="background:#166c60;color:white;border:0;border-radius:8px;padding:9px">
          ↻ Escanear
        </button>
      </div>
    </div>

    <div style="font-size:12px;color:#a5b0cf;margin:12px 0">
      8 activos · 7 temporalidades · Ranking LONG/SHORT · Actualización cada minuto con la página activa.
    </div>

    <div style="overflow-x:auto">
      <table style="border-collapse:collapse;width:100%;font-size:12px;min-width:560px">
        <thead>
          <tr style="color:#a5b0cf;text-align:left">
            <th style="padding:8px">#</th>
            <th>Activo</th>
            <th>Dirección</th>
            <th>Puntos</th>
            <th>Estado</th>
            <th>Confirmaciones</th>
          </tr>
        </thead>
        <tbody id="clScanBody">
          <tr>
            <td colspan="6" style="padding:12px">
              Iniciando...
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div id="clScanErrors" style="color:#ff9a35;font-size:12px;margin-top:10px"></div>
  `;

  const main = document.querySelector("main") ||
    document.body;

  const intro = main.querySelector(".intro");

  if(intro){
    intro.insertAdjacentElement(
      "afterend",
      section
    );
  }else{
    main.insertBefore(
      section,
      main.firstChild
    );
  }

  $("clScanNow").addEventListener(
    "click",
    ()=>runScanner(true)
  );

  $("clNotify").addEventListener(
    "click",
    async()=>{
      if(!("Notification" in window)){
        alert(
          "Este navegador no admite notificaciones."
        );
        return;
      }

      try{
        const result =
          await Notification.requestPermission();

        $("clNotify").textContent =
          result==="granted"
            ? "🔔 Avisos activos"
            : "🔕 Sin permiso";
      }catch(error){
        console.warn(
          "Notificaciones:",
          error
        );
      }
    }
  );

  if(
    "Notification" in window &&
    Notification.permission==="granted"
  ){
    $("clNotify").textContent =
      "🔔 Avisos activos";
  }
}

function scanMarkets(){
  const s = selected();

  const markets = CRYPTOS.map(symbol=>({
    symbol,
    exchange:s.exchange,
    market:s.market,
    label:symbol.replace("-","/")
  }));

  markets.push({
    symbol:GOLD_SYMBOL,
    exchange:"bingx",
    market:"perpetual",
    label:"GOLD (XAU)",
    gold:true
  });

  markets.push({
    symbol:OIL_SYMBOL,
    exchange:"bingx",
    market:"perpetual",
    label:"OIL WTI",
    oil:true
  });

  return markets;
}

function rankAsset(market,frames){
  const metrics = {};

  for(const tf of TF){
    metrics[tf] = metricFor(
      frames[tf] || []
    );
  }

  if(
    !metrics["1m"] ||
    !metrics["5m"] ||
    !metrics["15m"]
  ){
    return {
      market,
      score:0,
      state:"DATOS INSUFICIENTES",
      direction:"NEUTRAL",
      confirmations:"—",
      metrics
    };
  }

  const weights = {
    "1d":5,
    "4h":7,
    "1h":9,
    "30m":10,
    "15m":13,
    "5m":17,
    "1m":19
  };

  let bull = 0;
  let bear = 0;
  let available = 0;

  for(const tf of TF){
    const m = metrics[tf];

    if(!m) continue;

    available++;

    const w = weights[tf];

    bull += w*(m.bull/4);
    bear += w*(m.bear/4);
  }

  const direction = bull>=bear
    ? "LONG"
    : "SHORT";

  const fast = metrics["1m"];
  const mid = metrics["5m"];
  const confirm = metrics["15m"];

  const aligned = [
    fast,
    mid,
    confirm
  ].filter(m=>
    direction==="LONG"
      ? m.bull>=3
      : m.bear>=3
  ).length;

  const breakout = direction==="LONG"
    ? fast.breakHigh
    : fast.breakLow;

  let score = Math.round(
    Math.max(bull,bear)
  );

  score += aligned===3
    ? 8
    : aligned===2
      ? 4
      : 0;

  score += fast.adx>=25
    ? 5
    : fast.adx>=20
      ? 2
      : 0;

  if(
    Number.isFinite(fast.volRatio) &&
    fast.volRatio>=1.3
  ){
    score += 5;
  }

  if(breakout) score += 4;

  score = Math.min(100,score);

  const confirmed =
    aligned===3 &&
    fast.adx>=20 &&
    score>=65 &&
    (
      direction==="LONG"
        ? fast.rsi<75
        : fast.rsi>25
    );

  const state = confirmed
    ? "CONFIRMADA"
    : score>=55
      ? "EN OBSERVACIÓN"
      : "SIN ENTRADA";

  return {
    market,
    score,
    state,
    direction,
    confirmations:
      aligned+"/3 rápidas · "+
      available+"/7 marcos",
    metrics,
    closedTime:fast.closedTime,
    price:fast.close
  };
}

async function fetchFrames(market){
  const frames = {};

  for(const tf of TF){
    const cacheKey = [
      market.exchange,
      market.market,
      market.symbol,
      tf
    ].join("|");

    const cached = scanCache.get(cacheKey);

    const ttl = TF_SECONDS[tf]>=3600
      ? 180000
      : TF_SECONDS[tf]>=900
        ? 90000
        : 50000;

    if(
      cached &&
      Date.now()-cached.at<ttl
    ){
      frames[tf] = cached.data;
      continue;
    }

    const raw = await getJSON(
      candleURL(
        market.market,
        market.symbol,
        tf,
        130,
        market.exchange
      ),
      12000
    );

    const data = normalize(raw);

    if(data.length<60){
      throw new Error(
        tf+": historial insuficiente"
      );
    }

    frames[tf] = data;

    scanCache.set(cacheKey,{
      at:Date.now(),
      data
    });
  }

  return frames;
}

async function resolveGold(market){
  try{
    const raw = await getJSON(
      candleURL(
        "perpetual",
        GOLD_SYMBOL,
        "1m",
        80,
        "bingx"
      ),
      10000
    );

    const data = normalize(raw);

    if(data.length<60){
      throw new Error(
        "Sin velas suficientes"
      );
    }

    return {
      ...market,
      symbol:GOLD_SYMBOL
    };
  }catch(error){
    throw new Error(
      "GOLD (XAU) no disponible en API: "+
      error.message
    );
  }
}

async function scanOne(market){
  const m = market.gold
    ? await resolveGold(market)
    : market;

  const frames = await fetchFrames(m);

  return rankAsset(m,frames);
}

function renderScanner(){
  const body = $("clScanBody");

  if(!body) return;

  body.replaceChildren();

  for(const [i,r] of scanResults.entries()){
    const tr = document.createElement("tr");

    tr.style.borderTop =
      "1px solid #233452";

    if(r.market.oil){
      tr.dataset.commodity = "oil-wti";
    }

    const texts = [
      String(i+1),
      r.market.label,
      r.direction,
      r.score+"/100",
      r.state,
      r.confirmations
    ];

    texts.forEach((text,j)=>{
      const td = document.createElement("td");

      td.textContent = text;
      td.style.padding = "10px 8px";

      if(j===2){
        td.style.color =
          r.direction==="LONG"
            ? C.green
            : r.direction==="SHORT"
              ? C.red
              : C.muted;
      }

      if(
        j===4 &&
        r.state==="CONFIRMADA"
      ){
        td.style.color = C.green;
      }

      tr.appendChild(td);
    });

    body.appendChild(tr);
  }

  if(!scanResults.length){
    const tr = document.createElement("tr");
    const td = document.createElement("td");

    td.colSpan = 6;
    td.textContent =
      "No se obtuvieron resultados válidos";

    td.style.padding = "12px";

    tr.appendChild(td);
    body.appendChild(tr);
  }

  value(
    "clScanErrors",
    scanErrors.length
      ? "Sin datos: "+scanErrors.join(" · ")
      : ""
  );
}

function notifySignal(r){
  if(
    r.state!=="CONFIRMADA" ||
    !r.closedTime
  ) return;

  const key = [
    r.market.exchange,
    r.market.symbol,
    r.direction,
    r.closedTime
  ].join("|");

  if(alertHistory.has(key)) return;

  alertHistory.set(key,Date.now());

  if(alertHistory.size>150){
    for(const k of [
      ...alertHistory.keys()
    ].slice(0,50)){
      alertHistory.delete(k);
    }
  }

  if(
    !("Notification" in window) ||
    Notification.permission!=="granted"
  ) return;

  try{
    const notification = new Notification(
      "CRYPTOLEXUZ · "+
      r.market.label+
      " · "+r.direction,
      {
        body:
          "Señal técnica "+
          r.score+"/100 · "+
          r.confirmations+
          " · Precio "+num(r.price),
        tag:key
      }
    );

    notification.onclick = ()=>{
      window.focus();
      notification.close();
    };
  }catch(error){
    console.warn(
      "Notificación:",
      error.message
    );
  }
}

async function runScanner(force=false){
  if(scanBusy || document.hidden) return;

  if(
    !force &&
    Date.now()-scanLastAt<55000
  ) return;

  scanBusy = true;

  const markets = scanMarkets();
  const results = [];
  const errors = [];

  value(
    "clScanStatus",
    "Analizando "+
    markets.length+
    " activos y siete temporalidades..."
  );

  let index = 0;

  async function worker(){
    while(index<markets.length){
      const market = markets[index++];

      try{
        results.push(
          await scanOne(market)
        );
      }catch(error){
        errors.push(
          market.label+": "+error.message
        );
      }
    }
  }

  try{
    await Promise.all([
      worker(),
      worker()
    ]);

    scanResults = results.sort(
      (a,b)=>b.score-a.score
    );

    scanErrors = errors;
    scanLastAt = Date.now();

    renderScanner();

    value(
      "clScanStatus",
      "Última revisión: "+
      new Date().toLocaleTimeString("es-MX")+
      " · "+results.length+
      "/"+markets.length+" activos"
    );

    for(const r of scanResults){
      notifySignal(r);
    }
  }finally{
    scanBusy = false;
  }
}

/* BOTONES DE INDICADORES */

function toggleIndicator(key){
  if(!supported.has(key)) return;

  if(enabled.has(key)){
    enabled.delete(key);
  }else{
    enabled.add(key);
  }

  updateButtons();

  if(rows.length){
    updateIndicators();
  }
}

function updateButtons(){
  document.querySelectorAll(
    "[data-indicator]"
  ).forEach(button=>{
    const key = button.dataset.indicator;

    if(!supported.has(key)){
      button.disabled = true;
      return;
    }

    const active = enabled.has(key);

    button.classList.toggle(
      "active",
      active
    );

    button.setAttribute(
      "aria-pressed",
      String(active)
    );
  });
}

function speakRSI(){
  if(!("speechSynthesis" in window)) return;

  speechSynthesis.cancel();

  const speech = new SpeechSynthesisUtterance(
    currentRSIText ||
    "El RSI no está disponible."
  );

  speech.lang = "es-MX";
  speech.rate = .95;

  speechSynthesis.speak(speech);
}

/* CAMBIOS DE MERCADO */

function resetMarketState(){
  requestId++;
  loading = false;

  lastWsPriceAt = 0;
  lastLiveEvent = null;
  activeKey = "";

  rows = [];
  zones = [];
  pivots = [];
  sweeps = [];

  if(indicatorTimer){
    clearTimeout(indicatorTimer);
    indicatorTimer = null;
  }

  series.price?.setData([]);
  series.volume?.setData([]);

  for(const s of Object.values(maSeries)){
    s.setData([]);
  }

  for(const k of [
    "rsi",
    "adx",
    "plus",
    "minus"
  ]){
    series[k]?.setData([]);
  }

  value("price","—");

  value(
    "message",
    "Cargando nuevo activo o temporalidad..."
  );
}

/* EVENTOS */

function setupEvents(){
  document.querySelectorAll(
    "[data-indicator]"
  ).forEach(button=>{
    button.addEventListener(
      "click",
      ()=>toggleIndicator(
        button.dataset.indicator
      )
    );
  });

  $("refresh")?.addEventListener(
    "click",
    ()=>{
      refresh();
      refreshTicker();
    }
  );

  $("chartReset")?.addEventListener(
    "click",
    resetView
  );

  $("rsiSpeak")?.addEventListener(
    "click",
    speakRSI
  );

  if(
    $("rsiSpeak") &&
    "speechSynthesis" in window
  ){
    $("rsiSpeak").disabled = false;

    $("rsiSpeak").textContent =
      "🔊 Escuchar interpretación RSI";
  }

  for(const id of [
    "symbol",
    "interval",
    "market",
    "exchange"
  ]){
    $(id)?.addEventListener(
      "change",
      ()=>{
        syncCommoditySelection();

        lastMonitorAt = 0;

        resetMarketState();

        connectWS();
        refresh();
        refreshTicker();
        runScanner(true);
      }
    );
  }

  updateButtons();
}

/* INICIO DE CRYPTOLEXUZ */

function init(){
  ensureCommodityOptions();
  syncCommoditySelection();
  ensureScannerUI();
  setupEvents();

  if(!createCharts()) return;

  connectWS();
  refresh();
  refreshTicker();
  runScanner(true);

  chartTimer = setInterval(()=>{
    if(!document.hidden){
      refresh();
    }
  },15000);

  tickerTimer = setInterval(()=>{
    if(!document.hidden){
      refreshTicker();
    }
  },10000);

  scanTimer = setInterval(()=>{
    if(!document.hidden){
      runScanner();
    }
  },60000);

  document.addEventListener(
    "visibilitychange",
    ()=>{
      if(document.hidden){
        disconnectWS();
      }else{
        connectWS();
        refresh();
        refreshTicker();
        runScanner(true);
      }
    }
  );

  window.addEventListener(
    "beforeunload",
    ()=>{
      disconnectWS();

      if(indicatorTimer){
        clearTimeout(indicatorTimer);
      }

      clearInterval(chartTimer);
      clearInterval(tickerTimer);
      clearInterval(scanTimer);
    }
  );
}

if(document.readyState==="loading"){
  document.addEventListener(
    "DOMContentLoaded",
    init
  );
}else{
  init();
}

})();
