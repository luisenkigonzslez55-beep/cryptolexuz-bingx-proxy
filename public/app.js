
/*
 CRYPTOLEXUZ PRO — APP.JS V19
 Motor de mercado, gráficas y escáner
 Lightweight Charts 4.2.2

 - BingX y exchanges compatibles con el proxy
 - Velas, volumen, EMA, MA, RSI y ADX
 - Configuración de medias persistente
 - Navegación móvil y rango visible
 - Escáner multitemporal LONG / SHORT
 - Historial y verificación conservadora
 - Integración con Fibonacci y Volume Profile
 - Sin ejecución de operaciones
*/
"use strict";

(() => {
const $ = id => document.getElementById(id);
const C = {
 green:"#00f5a0", red:"#ff476c",
 purple:"#bb52ff", orange:"#ff9a35",
 blue:"#36c5ff", yellow:"#ffe15a"
};
const GOLD="NCCOGOLD2USD-USDT";
const OIL="NCCO1OILWTI2USD-USDT";
const ASSETS=[
 "BTC-USDT","ETH-USDT","BNB-USDT",
 "SOL-USDT","XRP-USDT","DOGE-USDT",
 GOLD,OIL
];
const TF=["1d","4h","1h","30m","15m","5m","1m"];
const SEC={
 "1m":60,"5m":300,"15m":900,
 "30m":1800,"1h":3600,"4h":14400,
 "1d":86400,"1w":604800
};
const HISTORY_KEY="cryptolexuz-v16-history";
const SETTINGS_KEY="cryptolexuz-chart-settings-v1";

const enabled=new Set(["ema21","ma55","rsi","fvg"]);
const charts={},series={},moving={};
const levelLines=[];
const cache=new Map();

let rows=[],zones=[],pivots=[],sweeps=[];
let history=[],activeKey="";
let generation=0,scanGeneration=0;
let chartBusy=false,tickerBusy=false;
let scanBusy=false,verifyBusy=false;
let monitorLast=0,scanLast=0;
let socket=null,socketId=0,reconnectTimer=null;
let lastWS=0,lastRSI="RSI no disponible";
let visibleRange=null,syncing=false,restoring=false;
let userInteracting=false,interactionTimer=null;
let resizeObserver=null,resizeQueued=false;
let volumeProfileAttached=false,volumeProfileModule=null;
let chartTimer,tickerTimer,scanTimer,verifyTimer;

const defaultLines=[
 {period:55,color:C.orange,width:2,enabled:true},
 {period:21,color:C.purple,width:2,enabled:true},
 {period:100,color:C.red,width:2,enabled:true},
 {period:200,color:C.blue,width:2,enabled:false}
];

function settings(){
 try{
  const raw=JSON.parse(localStorage.getItem(SETTINGS_KEY)||"null");
  return raw&&typeof raw==="object"?raw:{};
 }catch{return {}}
}
function maSettings(){
 const s=settings();
 return Array.isArray(s.lines)&&s.lines.length
  ?s.lines
  :defaultLines;
}
function put(id,v){
 const el=$(id);
 if(el)el.textContent=String(v);
}
function fmt(v,d=2){
 if(v===null||v===undefined||v==="")return "—";
 const n=Number(v);
 return Number.isFinite(n)
  ?n.toLocaleString("en-US",{
    minimumFractionDigits:d,maximumFractionDigits:d
   })
  :"—";
}
function now(){return Math.floor(Date.now()/1000)}
function selection(){
 const symbol=$("symbol")?.value||"BTC-USDT";
 const commodity=symbol===GOLD||symbol===OIL;
 return {
  symbol,
  tf:$("interval")?.value||"15m",
  exchange:commodity?"bingx":$("exchange")?.value||"bingx",
  market:commodity?"perpetual":$("market")?.value||"perpetual"
 };
}
function key(s){
 return [s.exchange,s.market,s.symbol,s.tf].join("|");
}
function syncCommodity(){
 if([GOLD,OIL].includes($("symbol")?.value)){
  if($("exchange"))$("exchange").value="bingx";
  if($("market"))$("market").value="perpetual";
 }
}
function connection(message,color=C.yellow){
 const el=$("connection");
 if(el){
  el.textContent="● "+message;
  el.style.color=color;
 }
}
function timestamp(v){
 if(v===null||v===undefined)return NaN;
 const n=typeof v==="string"&&!/^\d+$/.test(v)
  ?Date.parse(v):Number(v);
 if(!Number.isFinite(n))return NaN;
 return Math.floor(n>1e12?n/1000:n);
}
function normalize(raw){
 let data=raw?.data?.data??
  raw?.data?.list??raw?.data?.candles??
  raw?.data??raw?.list??raw?.candles??raw;
 if(!Array.isArray(data))return [];
 const result=[];
 for(const x of data){
  if(!x)continue;
  const a=Array.isArray(x);
  const c={
   time:timestamp(a?x[0]:x.time??x.timestamp??x.openTime??x.t),
   open:Number(a?x[1]:x.open??x.o),
   high:Number(a?x[2]:x.high??x.h),
   low:Number(a?x[3]:x.low??x.l),
   close:Number(a?x[4]:x.close??x.c),
   volume:Number(a?x[5]:x.volume??x.vol??x.v??0)
  };
  if(!Object.values(c).every(Number.isFinite))continue;
  if(c.time<=0||c.time>now()+60||c.low<=0||c.volume<0)continue;
  if(c.high<Math.max(c.open,c.close,c.low))continue;
  if(c.low>Math.min(c.open,c.close))continue;
  result.push(c);
 }
 result.sort((a,b)=>a.time-b.time);
 return [...new Map(result.map(c=>[c.time,c])).values()];
}
function closed(data,tf){
 const sec=SEC[tf]||60;
 return data.filter(c=>c.time+sec<=now()-2);
}
function sma(a,p){
 const out=Array(a.length).fill(null);
 if(!Number.isInteger(p)||p<1)return out;
 let sum=0;
 for(let i=0;i<a.length;i++){
  sum+=a[i];
  if(i>=p)sum-=a[i-p];
  if(i>=p-1)out[i]=sum/p;
 }
 return out;
}
function ema(a,p){
 const out=Array(a.length).fill(null);
 if(!Number.isInteger(p)||p<1||a.length<p)return out;
 let v=a.slice(0,p).reduce((s,x)=>s+x,0)/p;
 out[p-1]=v;
 for(let i=p;i<a.length;i++){
  v+=(a[i]-v)*2/(p+1);
  out[i]=v;
 }
 return out;
}
function rsi(a,p=14){
 const out=Array(a.length).fill(null);
 if(a.length<=p)return out;
 let g=0,l=0;
 for(let i=1;i<=p;i++){
  const d=a[i]-a[i-1];
  g+=Math.max(d,0);l+=Math.max(-d,0);
 }
 g/=p;l/=p;
 const value=()=>l===0?(g===0?50:100):100-100/(1+g/l);
 out[p]=value();
 for(let i=p+1;i<a.length;i++){
  const d=a[i]-a[i-1];
  g=(g*(p-1)+Math.max(d,0))/p;
  l=(l*(p-1)+Math.max(-d,0))/p;
  out[i]=value();
 }
 return out;
}
function adx(a,p=14){
 const n=a.length;
 const ax=Array(n).fill(null);
 const plus=Array(n).fill(null);
 const minus=Array(n).fill(null);
 if(n<2*p)return {adx:ax,plus,minus};
 const tr=[],up=[],down=[],dx=[];
 for(let i=1;i<n;i++){
  const h=a[i].high-a[i-1].high;
  const l=a[i-1].low-a[i].low;
  tr[i]=Math.max(
   a[i].high-a[i].low,
   Math.abs(a[i].high-a[i-1].close),
   Math.abs(a[i].low-a[i-1].close)
  );
  up[i]=h>l&&h>0?h:0;
  down[i]=l>h&&l>0?l:0;
 }
 let t=0,sp=0,sm=0;
 for(let i=1;i<=p;i++){
  t+=tr[i];sp+=up[i];sm+=down[i];
 }
 for(let i=p;i<n;i++){
  if(i>p){
   t=t-t/p+tr[i];
   sp=sp-sp/p+up[i];
   sm=sm-sm/p+down[i];
  }
  plus[i]=t?100*sp/t:0;
  minus[i]=t?100*sm/t:0;
  dx[i]=plus[i]+minus[i]
   ?100*Math.abs(plus[i]-minus[i])/(plus[i]+minus[i]):0;
 }
 let total=0;
 for(let i=p;i<2*p;i++)total+=dx[i];
 ax[2*p-1]=total/p;
 for(let i=2*p;i<n;i++)
  ax[i]=(ax[i-1]*(p-1)+dx[i])/p;
 return {adx:ax,plus,minus};
}
function atr(a,p=14){
 if(a.length<p+1)return null;
 const tr=[];
 for(let i=1;i<a.length;i++){
  tr.push(Math.max(
   a[i].high-a[i].low,
   Math.abs(a[i].high-a[i-1].close),
   Math.abs(a[i].low-a[i-1].close)
  ));
 }
 let v=tr.slice(0,p).reduce((s,x)=>s+x,0)/p;
 for(let i=p;i<tr.length;i++)v=(v*(p-1)+tr[i])/p;
 return v;
}
function lineData(a,v){
 return a.flatMap((x,i)=>Number.isFinite(v[i])
  ?[{time:x.time,value:v[i]}]:[]);
}
function volumeBar(c){
 return {
  time:c.time,value:c.volume,
  color:c.close>=c.open
   ?"rgba(0,245,160,.7)"
   :"rgba(255,71,108,.7)"
 };
}
function chartOptions(height){
 return {
  width:300,height,
  layout:{
   background:{type:"solid",color:"#090c13"},
   textColor:"#c9d3ee",fontSize:11
  },
  grid:{
   vertLines:{color:"#18202d"},
   horzLines:{color:"#18202d"}
  },
  rightPriceScale:{
   borderColor:"#344056",minimumWidth:65
  },
  timeScale:{
   borderColor:"#344056",
   timeVisible:true,secondsVisible:false,
   rightOffset:5,barSpacing:9,minBarSpacing:2,
   lockVisibleTimeRangeOnResize:true
  },
  crosshair:{mode:LightweightCharts.CrosshairMode.Normal},
  handleScroll:{
   mouseWheel:false,
   pressedMouseMove:true,
   horzTouchDrag:true,
   vertTouchDrag:false
  },
  handleScale:{
   mouseWheel:true,pinch:true,
   axisPressedMouseMove:{time:true,price:true},
   axisDoubleClickReset:true
  },
  kineticScroll:{touch:true,mouse:true}
 };
}
function volumeProfile(){
 return window.CryptolexuzVolumeProfile||
  window.CRYPTOLEXUZ_VOLUME_PROFILE||null;
}
function visible(){
 try{
  const r=charts.price?.timeScale().getVisibleLogicalRange();
  if(r&&Number.isFinite(r.from)&&Number.isFinite(r.to))
   return {from:r.from,to:r.to};
 }catch{}
 return null;
}
function restore(r){
 if(!r||!charts.price||restoring)return;
 try{
  restoring=true;
  charts.price.timeScale().setVisibleLogicalRange(r);
  visibleRange={...r};
 }catch(e){
  console.warn("Rango visible:",e);
 }finally{restoring=false}
}
function redrawModules(){
 try{window.CryptolexuzFibonacci?.redraw?.()}catch{}
 try{volumeProfile()?.redraw?.()}catch{}
 try{window.CryptolexuzRangeBoxes?.redraw?.()}catch{}
}
function syncCharts(source,r){
 if(syncing||restoring||!r)return;
 if(!Number.isFinite(r.from)||!Number.isFinite(r.to))return;
 syncing=true;
 try{
  if(source===charts.price)visibleRange={...r};
  for(const other of Object.values(charts)){
   if(other===source)continue;
   try{
    const current=other.timeScale().getVisibleLogicalRange();
    if(current&&Math.abs(current.from-r.from)<.01&&
       Math.abs(current.to-r.to)<.01)continue;
    other.timeScale().setVisibleLogicalRange(r);
   }catch{}
  }
 }finally{syncing=false}
 requestAnimationFrame(()=>{
  drawZones();redrawModules();
 });
}
function resize(){
 for(const [k,id,defaultHeight] of [
  ["price","chart",360],
  ["volume","volumeChart",115],
  ["rsi","rsiChart",145],
  ["adx","adxChart",145]
 ]){
  const el=$(id);
  if(!charts[k]||!el||el.clientWidth<=0)continue;
  const h=k==="price"
   ?Math.max(240,el.clientHeight||defaultHeight)
   :defaultHeight;
  try{charts[k].resize(el.clientWidth,h)}catch{}
 }
 resizeCanvas();
 redrawModules();
}
function scheduleResize(){
 if(resizeQueued)return;
 resizeQueued=true;
 requestAnimationFrame(()=>{
  resizeQueued=false;resize();
 });
}
function enableTouch(){
 const el=$("chart");
 if(!el)return;
 // pan-y permite desplazamiento vertical de la página.
 // El motor de velas maneja el arrastre horizontal.
 el.style.touchAction="pan-y";
 el.style.userSelect="none";
 for(const id of ["zonesCanvas","fibonacciCanvas","clVpCanvas"]){
  const layer=$(id);
  if(layer)layer.style.pointerEvents="none";
 }
 const interact=()=>{
  userInteracting=true;
  clearTimeout(interactionTimer);
  interactionTimer=setTimeout(()=>userInteracting=false,1200);
 };
 for(const type of ["touchstart","touchmove","pointerdown","wheel"]){
  el.addEventListener(type,interact,{passive:true});
 }
}
function announceChartReady(){
 if(!charts.price||!series.price)return;
 const chart=charts.price,candle=series.price;
 window.CryptolexuzChart={
  chart,chartApi:chart,candle,candleSeries:candle,
  applyOptions:o=>chart.applyOptions(o),
  timeScale:()=>chart.timeScale(),
  getRows:()=>rows,getCandles:()=>rows,
  getSelection:selection,
  resetView,resize
 };
 window.clChart=chart;
 window.chartApi=chart;
 window.dispatchEvent(new CustomEvent("cryptolexuz:chart-ready",{
  detail:{
   chart,candle,candleSeries:candle,
   rows,candles:rows,
   getRows:()=>rows,getSelection:selection
  }
 }));
}
function attachVolumeProfile(){
 const vp=volumeProfile();
 if(!vp||!charts.price||!series.price){
  announceChartReady();return;
 }
 if(volumeProfileAttached&&volumeProfileModule===vp)return;
 try{
  vp.attach?.(charts.price,series.price,{
   getRows:()=>rows,getCandles:()=>rows,
   getSelection:selection
  });
  volumeProfileAttached=true;
  volumeProfileModule=vp;
 }catch(e){console.warn("Volume Profile:",e)}
 announceChartReady();
}
function updateModules(){
 const vp=volumeProfile();
 if(vp&&!volumeProfileAttached)attachVolumeProfile();
 try{
  if(typeof vp?.setData==="function")vp.setData(rows);
  else vp?.updateData?.(rows);
 }catch(e){console.warn("Volume Profile datos:",e)}
 window.dispatchEvent(new CustomEvent("cryptolexuz:candles-updated",{
  detail:{
   chart:charts.price,
   candle:series.price,candleSeries:series.price,
   rows,candles:rows,selection:selection()
  }
 }));
 redrawModules();
}
function rebuildMoving(){
 if(!charts.price)return;
 const cfg=maSettings();
 const wanted=new Set();
 cfg.forEach((line,i)=>{
  const name="custom"+i;
  wanted.add(name);
  const color=/^#[0-9a-f]{6}$/i.test(line.color)
   ?line.color:C.purple;
  const width=Math.max(1,Math.min(5,Number(line.width)||2));
  if(!moving[name]){
   moving[name]=charts.price.addLineSeries({
    color,lineWidth:width,
    priceLineVisible:false,lastValueVisible:false,
    crosshairMarkerVisible:false
   });
  }else{
   moving[name].applyOptions({color,lineWidth:width});
  }
 });
 for(const [name,s] of Object.entries(moving)){
  if(wanted.has(name))continue;
  charts.price.removeSeries(s);
  delete moving[name];
 }
}
function createCharts(){
 if(!window.LightweightCharts||!$("chart")){
  put("message","No se pudo cargar Lightweight Charts.");
  connection("Error de gráfica",C.red);
  return false;
 }
 charts.price=LightweightCharts.createChart(
  $("chart"),chartOptions($("chart").clientHeight||360)
 );
 series.price=charts.price.addCandlestickSeries({
  upColor:C.green,downColor:C.red,
  wickUpColor:C.green,wickDownColor:C.red,
  borderVisible:false
 });
 rebuildMoving();
 for(const [k,id,h] of [
  ["volume","volumeChart",115],
  ["rsi","rsiChart",145],
  ["adx","adxChart",145]
 ]){
  if($(id))charts[k]=LightweightCharts.createChart($(id),chartOptions(h));
 }
 if(charts.volume){
  series.volume=charts.volume.addHistogramSeries({
   priceFormat:{type:"volume"},priceScaleId:""
  });
  series.volume.priceScale().applyOptions({
   scaleMargins:{top:.12,bottom:0}
  });
 }
 if(charts.rsi){
  series.rsi=charts.rsi.addLineSeries({
   color:C.purple,lineWidth:2,priceLineVisible:false
  });
  for(const level of [30,50,70]){
   series.rsi.createPriceLine({
    price:level,color:"#657399",
    lineStyle:LightweightCharts.LineStyle.Dashed,
    axisLabelVisible:true
   });
  }
 }
 if(charts.adx){
  for(const [k,color] of [
   ["adx",C.yellow],["plus",C.green],["minus",C.red]
  ]){
   series[k]=charts.adx.addLineSeries({
    color,lineWidth:2,priceLineVisible:false
   });
  }
 }
 for(const chart of Object.values(charts)){
  chart.timeScale().subscribeVisibleLogicalRangeChange(
   r=>syncCharts(chart,r)
  );
 }
 enableTouch();
 if(window.ResizeObserver){
  resizeObserver=new ResizeObserver(scheduleResize);
  for(const id of ["chart","volumeChart","rsiChart","adxChart"]){
   if($(id))resizeObserver.observe($(id));
  }
 }
 window.addEventListener("resize",scheduleResize);
 try{
  window.CryptolexuzFibonacci?.attach?.(
   charts.price,series.price,{
    getRows:()=>rows,getSelection:selection
   }
  );
 }catch(e){console.warn("Fibonacci:",e)}
 attachVolumeProfile();
 setTimeout(scheduleResize,150);
 return true;
}
function resetView(){
 if(!charts.price||!rows.length)return;
 restore({
  from:Math.max(0,rows.length-50),
  to:rows.length+3
 });
}
function detectPivots(a){
 const out=[];
 for(let i=4;i<a.length-4;i++){
  const near=a.slice(i-4,i+5);
  if(near.every((x,j)=>j===4||x.high<a[i].high))
   out.push({index:i,price:a[i].high,type:"high"});
  if(near.every((x,j)=>j===4||x.low>a[i].low))
   out.push({index:i,price:a[i].low,type:"low"});
 }
 return out.slice(-40);
}
function detectFVG(a){
 const out=[];
 for(let i=2;i<a.length;i++){
  const bull=a[i].low>a[i-2].high;
  const bear=a[i].high<a[i-2].low;
  if(!bull&&!bear)continue;
  const top=bull?a[i].low:a[i-2].low;
  const bottom=bull?a[i-2].high:a[i].high;
  if((top-bottom)/((top+bottom)/2)<.00035)continue;
  let end=a.length-1,filled=false,inverted=false;
  for(let j=i+1;j<a.length;j++){
   if((bull&&a[j].low<=bottom)||(bear&&a[j].high>=top)){
    end=j;filled=true;
    inverted=bull?a[j].close<bottom:a[j].close>top;
    break;
   }
  }
  out.push({start:i-2,end,top,bottom,bull,filled,inverted});
 }
 return out.slice(-80);
}
function detectSweeps(a){
 const out=[];
 for(let i=20;i<a.length-1;i++){
  const prev=a.slice(i-20,i);
  const high=Math.max(...prev.map(x=>x.high));
  const low=Math.min(...prev.map(x=>x.low));
  if(a[i].high>high&&a[i].close<high)
   out.push({
    time:a[i].time,position:"aboveBar",
    color:C.red,shape:"arrowDown",text:"Barrido ↑"
   });
  if(a[i].low<low&&a[i].close>low)
   out.push({
    time:a[i].time,position:"belowBar",
    color:C.green,shape:"arrowUp",text:"Barrido ↓"
   });
 }
 return out.slice(-25);
}
function updateLevels(){
 if(!series.price)return;
 for(const line of levelLines){
  try{series.price.removePriceLine(line)}catch{}
 }
 levelLines.length=0;
 function add(price,color,title){
  if(!Number.isFinite(price))return;
  levelLines.push(series.price.createPriceLine({
   price,color,title,lineWidth:1,
   lineStyle:LightweightCharts.LineStyle.Dashed,
   axisLabelVisible:true
  }));
 }
 const recent=pivots.slice(-18);
 if(enabled.has("support")){
  const p=recent.filter(x=>x.type==="low").at(-1);
  if(p)add(p.price,C.green,"Soporte");
 }
 if(enabled.has("resistance")){
  const p=recent.filter(x=>x.type==="high").at(-1);
  if(p)add(p.price,C.red,"Resistencia");
 }
 if(enabled.has("liquidity")){
  for(const p of recent.filter(x=>x.type==="high").slice(-2))
   add(p.price,C.red,"Máximo");
  for(const p of recent.filter(x=>x.type==="low").slice(-2))
   add(p.price,C.green,"Mínimo");
 }
}
function resizeCanvas(){
 const canvas=$("zonesCanvas"),area=$("priceChartArea");
 if(!canvas||!area)return;
 const dpr=Math.min(devicePixelRatio||1,2);
 canvas.width=Math.round(area.clientWidth*dpr);
 canvas.height=Math.round(area.clientHeight*dpr);
 canvas.style.pointerEvents="none";
 canvas.getContext("2d")?.setTransform(dpr,0,0,dpr,0,0);
 drawZones();
}
function drawZones(){
 const canvas=$("zonesCanvas"),area=$("priceChartArea");
 if(!canvas||!area||!charts.price||!series.price)return;
 const ctx=canvas.getContext("2d");
 if(!ctx)return;
 ctx.clearRect(0,0,area.clientWidth,area.clientHeight);
 if(!enabled.has("fvg")&&!enabled.has("ifvg"))return;
 const scale=charts.price.timeScale();
 for(const z of zones.slice(-25)){
  if(!((!z.filled&&enabled.has("fvg"))||
       (z.inverted&&enabled.has("ifvg"))))continue;
  const x1=scale.logicalToCoordinate(z.start);
  const x2=scale.logicalToCoordinate(z.end);
  const y1=series.price.priceToCoordinate(z.top);
  const y2=series.price.priceToCoordinate(z.bottom);
  if(![x1,x2,y1,y2].every(Number.isFinite))continue;
  const left=Math.max(0,x1);
  const right=Math.min(area.clientWidth-70,x2);
  const top=Math.max(0,Math.min(y1,y2));
  const bottom=Math.min(area.clientHeight,Math.max(y1,y2));
  if(right<=left||bottom<=top)continue;
  ctx.fillStyle=z.inverted?"rgba(255,225,90,.12)"
   :z.bull?"rgba(0,245,160,.09)"
   :"rgba(255,71,108,.09)";
  ctx.fillRect(left,top,right-left,bottom-top);
  ctx.strokeStyle=z.inverted?"#ffe15a"
   :z.bull?"rgba(0,245,160,.4)"
   :"rgba(255,71,108,.4)";
  ctx.strokeRect(left,top,right-left,bottom-top);
 }
}
function updateIndicators(){
 if(!rows.length||!series.price)return;
 const closes=rows.map(x=>x.close);
 const ma={
  ema21:ema(closes,21),
  ma55:sma(closes,55),
  ma100:sma(closes,100),
  ma200:sma(closes,200)
 };
 const cfg=maSettings();
 rebuildMoving();
 cfg.forEach((line,i)=>{
  const period=Math.max(1,Math.floor(Number(line.period)||21));
  const method=period===21?"ema":"sma";
  const values=method==="ema"
   ?ema(closes,period):sma(closes,period);
  const legacy=period===21?"ema21"
   :period===55?"ma55"
   :period===100?"ma100"
   :period===200?"ma200":null;
  const on=!!line.enabled&&(!legacy||enabled.has(legacy));
  moving["custom"+i]?.setData(on?lineData(rows,values):[]);
 });
 const rv=rsi(closes),av=adx(rows);
 series.rsi?.setData(enabled.has("rsi")?lineData(rows,rv):[]);
 for(const [k,v] of [
  ["adx",av.adx],["plus",av.plus],["minus",av.minus]
 ]){
  series[k]?.setData(enabled.has("adx")?lineData(rows,v):[]);
 }
 const valid=closed(rows,selection().tf);
 const t=valid.at(-1)?.time;
 const i=rows.findIndex(x=>x.time===t);
 if(i>=0){
  put("ema21Value",fmt(ma.ema21[i]));
  put("ma55Value",fmt(ma.ma55[i]));
  put("rsiValue",fmt(rv[i],1));
  put("adxValue",fmt(av.adx[i],1));
  put("rsiChartValue",fmt(rv[i],1));
  put("adxChartValue",fmt(av.adx[i],1));
  const r=rv[i];
  lastRSI=!Number.isFinite(r)?"RSI no disponible"
   :r<30?"RSI en sobreventa; rebote no confirmado."
   :r>70?"RSI en sobrecompra; caída no confirmada."
   :r>=50?"RSI con predominio comprador."
   :"RSI con predominio vendedor.";
  put("rsiInterpretation",lastRSI);
  const ax=av.adx[i];
  put("adxInterpretation",Number.isFinite(ax)
   ?"ADX "+fmt(ax,1)+(ax>=25
    ?". Tendencia con fuerza.":". Tendencia débil.")
   :"ADX no disponible.");
  const trend=Number.isFinite(ma.ema21[i])&&
   Number.isFinite(ma.ma55[i])
   ?closes[i]>ma.ema21[i]&&ma.ema21[i]>ma.ma55[i]
    ?"Sesgo alcista"
    :closes[i]<ma.ema21[i]&&ma.ema21[i]<ma.ma55[i]
     ?"Sesgo bajista":"Mercado mixto"
   :"Historial insuficiente";
  put("indicatorReadout",trend+". "+lastRSI);
 }
 const last=valid.at(-1),previous=valid.slice(-21,-1);
 if(last&&previous.length===20){
  const avg=previous.reduce((s,x)=>s+x.volume,0)/20;
  put("volumeInterpretation",avg>0
   ?"Volumen de última vela cerrada: "+
    fmt(last.volume/avg,2)+" veces el promedio."
   :"Volumen insuficiente.");
 }
 pivots=detectPivots(rows);
 zones=detectFVG(rows);
 sweeps=detectSweeps(rows);
 updateLevels();
 series.price.setMarkers(enabled.has("sweeps")?sweeps:[]);
 if($("rsiSection"))$("rsiSection").hidden=!enabled.has("rsi");
 if($("adxSection"))$("adxSection").hidden=!enabled.has("adx");
 requestAnimationFrame(resizeCanvas);
}
async function getJSON(url,timeout=12000){
 const controller=new AbortController();
 const timer=setTimeout(()=>controller.abort(),timeout);
 try{
  const response=await fetch(url,{
   signal:controller.signal,cache:"no-store"
  });
  if(!response.ok)throw Error("HTTP "+response.status);
  return await response.json();
 }finally{clearTimeout(timer)}
}
function candleURL(s,limit=300){
 return "/api/exchange/"+encodeURIComponent(s.exchange)+
  "/klines/"+encodeURIComponent(s.symbol)+
  "?market="+encodeURIComponent(s.market)+
  "&interval="+encodeURIComponent(s.tf)+
  "&limit="+limit;
}
function tickerURL(s){
 return "/api/exchange/"+encodeURIComponent(s.exchange)+
  "/ticker/"+encodeURIComponent(s.symbol)+
  "?market="+encodeURIComponent(s.market);
}
function applyCandles(data,s){
 const changed=activeKey!==key(s);
 const old=rows;
 const previousRange=!changed?(visible()||visibleRange):null;
 const sameTimeline=!changed&&old.length===data.length&&
  old[0]?.time===data[0]?.time&&
  old.at(-1)?.time===data.at(-1)?.time;
 rows=data;
 activeKey=key(s);
 if(sameTimeline&&old.length){
  const a=old.at(-1),b=data.at(-1);
  const same=["open","high","low","close","volume"]
   .every(k=>a[k]===b[k]);
  if(same){
   put("status","Velas actualizadas");
   return;
  }
  series.price.update(b);
  series.volume?.update(volumeBar(b));
 }else{
  series.price.setData(rows);
  series.volume?.setData(rows.map(volumeBar));
 }
 updateIndicators();
 updateModules();
 if(changed){
  visibleRange=null;
  resetView();
 }else if(previousRange){
  const delta=data.length-old.length;
  const range={...previousRange};
  if(delta>0&&range.to>=old.length-2&&!userInteracting){
   range.from+=delta;
   range.to+=delta;
  }
  restore(range);
 }
 put("chartTitle",s.symbol+" · "+s.tf);
 put("volumeLabel",s.symbol===GOLD?"GOLD"
  :s.symbol===OIL?"OIL WTI":s.symbol.split("-")[0]);
 drawZones();
 redrawModules();
}
async function refresh(){
 if(chartBusy||!series.price)return;
 chartBusy=true;
 const id=generation,s=selection();
 put("status","Consultando velas...");
 try{
  const data=normalize(await getJSON(candleURL(s)));
  if(id!==generation||key(s)!==key(selection()))return;
  if(!data.length)throw Error("Sin velas válidas");
  applyCandles(data,s);
  put("status","Velas actualizadas");
  put("message","");
  monitor();
 }catch(e){
  if(id===generation){
   put("status","Error: "+e.message);
   put("message","Comprueba la conexión con el servidor.");
  }
 }finally{
  chartBusy=false;
  if(id!==generation)
   queueMicrotask(refresh);
 }
}
function tickerData(raw){
 let d=raw?.data??raw;
 if(Array.isArray(d))d=d[0];
 if(d?.data)d=d.data;
 if(Array.isArray(d))d=d[0];
 return d||{};
}
function tickerFields(d){
 const price=Number(d.lastPrice??d.last??d.price??d.close??d.c);
 const open=Number(d.openPrice??d.open24h??d.open??d.o);
 let change=Number(d.priceChangePercent??d.changePercent);
 if(!Number.isFinite(change)&&price>0&&open>0)
  change=(price/open-1)*100;
 return {price,open,change};
}
async function refreshTicker(){
 if(tickerBusy)return;
 tickerBusy=true;
 const s=selection(),id=generation;
 try{
  const d=tickerData(await getJSON(tickerURL(s),8000));
  if(id!==generation||key(s)!==key(selection()))return;
  const {price,open,change}=tickerFields(d);
  if(price>0&&Date.now()-lastWS>7000){
   put("price",fmt(price));
   connection(s.exchange.toUpperCase()+" · REST",C.yellow);
  }
  put("high",fmt(d.highPrice??d.high24h??d.high??d.h));
  put("low",fmt(d.lowPrice??d.low24h??d.low??d.l));
  put("open",fmt(open));
  put("volume",fmt(d.volume??d.volume24h??d.vol??d.v,0));
  put("change",Number.isFinite(change)
   ?(change>=0?"+":"")+fmt(change)+"%":"—");
  $("change")?.classList.toggle("negative",change<0);
  put("bid",fmt(d.bidPrice??d.bid??d.bestBid));
  put("ask",fmt(d.askPrice??d.ask??d.bestAsk));
  put("updated",new Date().toLocaleTimeString("es-MX"));
 }catch(e){
  console.warn("Ticker:",e.message);
 }finally{
  tickerBusy=false;
  if(id!==generation)queueMicrotask(refreshTicker);
 }
}
function disconnect(){
 socketId++;
 clearTimeout(reconnectTimer);
 if(socket){
  const old=socket;socket=null;
  old.onopen=old.onmessage=old.onclose=old.onerror=null;
  try{old.close()}catch{}
 }
}
function scheduleReconnect(id){
 clearTimeout(reconnectTimer);
 reconnectTimer=setTimeout(()=>{
  if(id===socketId&&!document.hidden)connect();
 },4000);
}
function connect(){
 disconnect();
 const id=socketId,s=selection();
 const protocol=location.protocol==="https:"?"wss:":"ws:";
 const url=protocol+"//"+location.host+"/ws?exchange="+
  encodeURIComponent(s.exchange)+"&market="+
  encodeURIComponent(s.market)+"&symbol="+
  encodeURIComponent(s.symbol);
 connection(s.exchange.toUpperCase()+" · conectando");
 try{socket=new WebSocket(url)}
 catch{scheduleReconnect(id);return}
 socket.onopen=()=>{
  if(id===socketId)connection("Esperando precios",C.yellow);
 };
 socket.onmessage=event=>{
  if(id!==socketId)return;
  let d;
  try{d=JSON.parse(event.data)}catch{return}
  if(d.type!=="price"||d.symbol!==s.symbol||
     d.market!==s.market||d.exchange!==s.exchange)return;
  const price=Number(d.price);
  if(!Number.isFinite(price)||price<=0)return;
  put("price",fmt(price));
  put("updated",new Date().toLocaleTimeString("es-MX"));
  lastWS=Date.now();
  connection(s.exchange.toUpperCase()+" · en vivo",C.green);
 };
 socket.onerror=()=>{
  if(id===socketId)connection("Conexión interrumpida",C.yellow);
 };
 socket.onclose=()=>{
  if(id!==socketId)return;
  socket=null;scheduleReconnect(id);
 };
}
function metric(data,tf){
 const a=closed(data,tf);
 if(a.length<60)return null;
 const closes=a.map(x=>x.close);
 const last=a.at(-1);
 const e=ema(closes,21).at(-1);
 const m=sma(closes,55).at(-1);
 const rv=rsi(closes).at(-1);
 const ad=adx(a);
 const ax=ad.adx.at(-1);
 const plus=ad.plus.at(-1),minus=ad.minus.at(-1);
 if(![e,m,rv,ax,plus,minus].every(Number.isFinite))return null;
 let bull=0,bear=0;
 if(last.close>e)bull++;
 if(last.close<e)bear++;
 if(e>m)bull++;
 if(e<m)bear++;
 if(rv>=55)bull++;
 if(rv<=45)bear++;
 if(plus>minus)bull++;
 if(minus>plus)bear++;
 const prev=a.slice(-7,-1);
 const avg=a.slice(-21,-1)
  .reduce((s,x)=>s+x.volume,0)/20;
 return {
  bull,bear,adx:ax,plus,minus,rsi:rv,
  volRatio:avg?last.volume/avg:0,
  close:last.close,closedTime:last.time,
  atr:atr(a),
  breakHigh:last.close>Math.max(...prev.map(x=>x.high)),
  breakLow:last.close<Math.min(...prev.map(x=>x.low))
 };
}
function analyze(data,tf){
 const m=metric(data,tf);
 if(!m)return {
  state:"SIN DATOS",direction:"neutral",
  detail:"Historial insuficiente.",metrics:"—",price:null
 };
 const bullish=m.bull>=3&&m.bull>m.bear;
 const bearish=m.bear>=3&&m.bear>m.bull;
 const state=bullish?"SESGO ALCISTA"
  :bearish?"SESGO BAJISTA":"LATERAL / MIXTO";
 const direction=bullish?"bullish":bearish?"bearish":"neutral";
 const opportunity=m.bull===4&&m.adx>=25&&m.rsi<70
  ?"Posible LONG"
  :m.bear===4&&m.adx>=25&&m.rsi>30
   ?"Posible SHORT":"Sin entrada confirmada";
 return {
  state,direction,
  detail:opportunity+". Requiere confirmación.",
  metrics:"RSI "+fmt(m.rsi,1)+" · ADX "+fmt(m.adx,1),
  price:m.close
 };
}
async function monitor(){
 if(Date.now()-monitorLast<60000)return;
 monitorLast=Date.now();
 const s=selection(),id=generation;
 try{
  const results=await Promise.all(
   ["5m","15m"].map(async tf=>
    normalize(await getJSON(candleURL({...s,tf})))
   )
  );
  if(id!==generation)return;
  for(let i=0;i<2;i++){
   const tf=i===0?"5m":"15m";
   const suffix=i===0?"5":"15";
   const r=analyze(results[i],tf);
   put("state"+suffix,r.state);
   put("detail"+suffix,r.detail);
   put("metrics"+suffix,r.metrics);
   const el=$("state"+suffix);
   if(el){
    el.className="state "+r.direction;
    const h=el.closest(".signal-card")?.querySelector("h3");
    if(h)h.textContent=s.symbol+" / "+tf;
   }
  }
  put("engineState","ANALIZANDO");
 }catch(e){
  if(id===generation)put("engineState","SIN CONEXIÓN");
  console.warn("Monitor:",e.message);
 }
}
function scannerUI(){
 if($("clScanner"))return;
 const host=$("clScannerHost")||$("clScreenScanner");
 if(!host)return;
 const section=document.createElement("section");
 section.id="clScanner";
 section.className="cl-module";
 section.innerHTML=`
 <h2>📡 Escáner CRYPTOLEXUZ PRO</h2>
 <p id="clScanStatus">Esperando análisis...</p>
 <div class="chart-controls">
  <button id="clScanNow" type="button">↻ Escanear</button>
  <button id="clNotify" type="button">🔔 Activar avisos</button>
 </div>
 <p class="cl-notice">
  Ocho activos · Siete temporalidades · LONG / SHORT
 </p>
 <div class="table-wrap">
  <table>
   <thead><tr>
    <th>#</th><th>Activo</th><th>Dirección</th>
    <th>Puntos</th><th>Estado</th><th>Confirmaciones</th>
   </tr></thead>
   <tbody id="clScanBody">
    <tr><td colspan="6">Iniciando...</td></tr>
   </tbody>
  </table>
 </div>
 <p id="clScanErrors" class="cl-notice"></p>`;
 host.appendChild(section);
 $("clScanNow")?.addEventListener("click",()=>scan(true));
 $("clNotify")?.addEventListener("click",async()=>{
  if(!("Notification" in window)){
   alert("Notificaciones no disponibles.");return;
  }
  const permission=await Notification.requestPermission();
  put("clNotify",permission==="granted"
   ?"🔔 Avisos activos":"🔕 Sin permiso");
 });
}
function markets(){
 const s=selection();
 return ASSETS.map(symbol=>({
  symbol,
  exchange:[GOLD,OIL].includes(symbol)?"bingx":s.exchange,
  market:[GOLD,OIL].includes(symbol)?"perpetual":s.market,
  label:symbol===GOLD?"GOLD (XAU)"
   :symbol===OIL?"OIL WTI":symbol.replace("-","/")
 }));
}
async function frames(m){
 const result={};
 for(const tf of TF){
  const s={...m,tf},k=key(s);
  const ttl=SEC[tf]>=3600?180000
   :SEC[tf]>=900?90000:50000;
  const cached=cache.get(k);
  if(cached&&Date.now()-cached.at<ttl){
   result[tf]=cached.data;continue;
  }
  const data=normalize(await getJSON(candleURL(s,300)));
  if(closed(data,tf).length<60)
   throw Error(tf+": historial insuficiente");
  result[tf]=data;
  cache.set(k,{at:Date.now(),data});
 }
 return result;
}
function rank(m,f){
 const metrics={};
 for(const tf of TF)metrics[tf]=metric(f[tf]||[],tf);
 if(!metrics["1m"]||!metrics["5m"]||!metrics["15m"])
  return {
   market:m,score:0,state:"SIN DATOS",
   direction:"NEUTRAL",confirmations:"—"
  };
 const weights={
  "1d":5,"4h":7,"1h":9,"30m":10,
  "15m":13,"5m":17,"1m":19
 };
 let bull=0,bear=0,available=0;
 for(const tf of TF){
  const v=metrics[tf];
  if(!v)continue;
  available++;
  bull+=weights[tf]*v.bull/4;
  bear+=weights[tf]*v.bear/4;
 }
 const direction=bull===bear?"NEUTRAL":bull>bear?"LONG":"SHORT";
 const fast=metrics["1m"];
 const aligned=["1m","5m","15m"].filter(tf=>{
  const v=metrics[tf];
  return direction==="LONG"?v.bull>=3
   :direction==="SHORT"?v.bear>=3:false;
 }).length;
 let score=Math.round(Math.max(bull,bear));
 score+=aligned===3?8:aligned===2?4:0;
 score+=fast.adx>=25?5:fast.adx>=20?2:0;
 if(fast.volRatio>=1.3)score+=5;
 if((direction==="LONG"&&fast.breakHigh)||
    (direction==="SHORT"&&fast.breakLow))score+=4;
 score=Math.min(100,score);
 const confirmed=direction!=="NEUTRAL"&&
  aligned===3&&fast.adx>=20&&score>=65&&
  (direction==="LONG"?fast.rsi<75:fast.rsi>25);
 return {
  market:m,score,direction,
  state:confirmed?"CONFIRMADA"
   :score>=55?"EN OBSERVACIÓN":"SIN ENTRADA",
  confirmations:aligned+"/3 rápidas · "+
   available+"/7 marcos",
  closedTime:fast.closedTime,
  price:fast.close,atr:fast.atr
 };
}
try{
 const saved=JSON.parse(localStorage.getItem(HISTORY_KEY)||"[]");
 if(Array.isArray(saved))history=saved.slice(0,300);
}catch(e){console.warn("Historial:",e)}
function saveHistory(){
 try{
  localStorage.setItem(HISTORY_KEY,JSON.stringify(history.slice(0,300)));
 }catch(e){console.warn("Guardar historial:",e)}
}
function addSignal(r){
 if(r.state!=="CONFIRMADA"||!r.closedTime||
    !Number.isFinite(r.atr)||r.atr<=0)return false;
 const id=[
  r.market.exchange,r.market.market,r.market.symbol,
  r.direction,r.closedTime
 ].join("|");
 if(history.some(x=>x.id===id))return false;
 const entry=r.price,dist=r.atr,side=r.direction;
 history.unshift({
  id,symbol:r.market.symbol,
  exchange:r.market.exchange,market:r.market.market,
  tf:"1m",direction:side,created:r.closedTime,
  entry,stop:side==="LONG"?entry-dist:entry+dist,
  target:side==="LONG"?entry+2*dist:entry-2*dist,
  state:"PENDIENTE",activated:null,ended:null,
  reason:"Alineación multitemporal + ADX + RSI",
  lastChecked:r.closedTime
 });
 history=history.slice(0,300);
 saveHistory();renderHistory();
 return true;
}
function evaluateSignal(s,data){
 if(!["PENDIENTE","ACTIVADA"].includes(s.state))return false;
 let changed=false;
 for(const c of closed(data,s.tf)){
  if(c.time<=s.lastChecked||c.time<=s.created)continue;
  s.lastChecked=c.time;changed=true;
  if(s.state==="PENDIENTE"){
   if(!(c.low<=s.entry&&c.high>=s.entry))continue;
   s.state="ACTIVADA";s.activated=c.time;
  }
  const stop=s.direction==="LONG"
   ?c.low<=s.stop:c.high>=s.stop;
  const target=s.direction==="LONG"
   ?c.high>=s.target:c.low<=s.target;
  if(stop&&target){
   s.state="NO VERIFICABLE";s.ended=c.time;break;
  }
  if(stop||target){
   // La vela de activación no permite determinar
   // el orden intravela con datos OHLC.
   if(c.time===s.activated){
    s.state="NO VERIFICABLE";
   }else{
    s.state=target?"OBJETIVO":"STOP";
   }
   s.ended=c.time;break;
  }
 }
 return changed;
}
async function verifySignals(){
 if(verifyBusy)return;
 verifyBusy=true;
 try{
  const pending=history.filter(s=>
   ["PENDIENTE","ACTIVADA"].includes(s.state));
  const groups=new Map();
  for(const s of pending){
   const k=key(s);
   if(!groups.has(k))groups.set(k,[]);
   groups.get(k).push(s);
  }
  let dirty=false;
  for(const group of groups.values()){
   const s=group[0];
   try{
    const data=normalize(await getJSON(candleURL(s,300)));
    const valid=closed(data,s.tf);
    if(!valid.length)continue;
    for(const item of group){
     if(item.lastChecked<valid[0].time-SEC[item.tf]){
      item.state="NO VERIFICABLE";
      item.ended=now();dirty=true;continue;
     }
     if(evaluateSignal(item,data))dirty=true;
    }
   }catch(e){console.warn("Verificación:",e.message)}
  }
  if(dirty){saveHistory();renderHistory()}
 }finally{verifyBusy=false}
}
function renderHistory(){
 const wins=history.filter(x=>x.state==="OBJETIVO").length;
 const losses=history.filter(x=>x.state==="STOP").length;
 put("clTotalSignals",history.length);
 put("clTargetsHit",wins);
 put("clStopsHit",losses);
 put("clWinRate",wins+losses
  ?fmt(wins/(wins+losses)*100,1)+"%":"—");
 const body=$("signalLog");
 if(!body)return;
 body.replaceChildren();
 if(!history.length){
  const tr=document.createElement("tr");
  const td=document.createElement("td");
  td.colSpan=7;
  td.textContent="Todavía no hay señales registradas.";
  tr.append(td);body.append(tr);return;
 }
 for(const s of history.slice(0,30)){
  const tr=document.createElement("tr");
  const cells=[
   new Date(s.created*1000).toLocaleString("es-MX"),
   s.tf,s.symbol,s.direction,fmt(s.entry),
   s.reason+" · TP "+fmt(s.target)+" · SL "+fmt(s.stop),
   s.state
  ];
  for(const value of cells){
   const td=document.createElement("td");
   td.textContent=value;tr.append(td);
  }
  body.append(tr);
 }
}
function notify(r){
 if(r.state!=="CONFIRMADA"||
    !("Notification" in window)||
    Notification.permission!=="granted")return;
 try{
  new Notification(
   "CRYPTOLEXUZ · "+r.market.label+" · "+r.direction,{
    body:"Señal técnica "+r.score+
     "/100 · Precio "+fmt(r.price),
    tag:r.market.symbol+"|"+r.direction+"|"+r.closedTime
   }
  );
 }catch(e){console.warn("Notificación:",e)}
}
async function scan(force=false){
 if(scanBusy||document.hidden)return;
 if(!force&&Date.now()-scanLast<55000)return;
 scanBusy=true;
 const id=scanGeneration,items=markets();
 const results=[],errors=[];
 put("clScanStatus","Analizando ocho activos...");
 let cursor=0;
 async function worker(){
  while(cursor<items.length){
   const m=items[cursor++];
   try{results.push(rank(m,await frames(m)))}
   catch(e){errors.push(m.label+": "+e.message)}
  }
 }
 try{
  await Promise.all([worker(),worker()]);
  if(id!==scanGeneration)return;
  results.sort((a,b)=>b.score-a.score);
  const body=$("clScanBody");
  if(body){
   body.replaceChildren();
   for(const [i,r] of results.entries()){
    const tr=document.createElement("tr");
    for(const value of [
     i+1,r.market.label,r.direction,
     r.score+"/100",r.state,r.confirmations
    ]){
     const td=document.createElement("td");
     td.textContent=value;
     td.style.padding="9px 6px";
     tr.append(td);
    }
    body.append(tr);
   }
   if(!results.length){
    const tr=document.createElement("tr");
    const td=document.createElement("td");
    td.colSpan=6;
    td.textContent="Sin resultados disponibles.";
    tr.append(td);body.append(tr);
   }
  }
  put("clScanErrors",errors.length
   ?"Sin datos: "+errors.join(" · "):"");
  put("clScanStatus","Última revisión: "+
   new Date().toLocaleTimeString("es-MX")+
   " · "+results.length+"/"+items.length+" activos");
  scanLast=Date.now();
  for(const r of results){
   if(addSignal(r))notify(r);
  }
  await verifySignals();
 }finally{scanBusy=false}
}
function clearMarket(){
 generation++;scanGeneration++;
 scanLast=0;monitorLast=0;activeKey="";
 rows=[];zones=[];pivots=[];sweeps=[];
 visibleRange=null;lastWS=0;
 series.price?.setData([]);
 series.volume?.setData([]);
 for(const s of Object.values(moving))s.setData([]);
 for(const k of ["rsi","adx","plus","minus"])
  series[k]?.setData([]);
 for(const line of levelLines){
  try{series.price?.removePriceLine(line)}catch{}
 }
 levelLines.length=0;
 series.price?.setMarkers([]);
 updateModules();
 put("price","—");
 put("message","Cargando nuevo mercado...");
 resizeCanvas();
}
function updateButtons(){
 document.querySelectorAll("[data-indicator]").forEach(button=>{
  const on=enabled.has(button.dataset.indicator);
  button.classList.toggle("active",on);
  button.setAttribute("aria-pressed",String(on));
 });
}
function applySavedIndicators(){
 const s=settings();
 if(s.indicators){
  for(const [k,v] of Object.entries(s.indicators)){
   const map={
    RSI:"rsi",ADX:"adx",VOL:"volume",
    FVG:"fvg",IFVG:"ifvg"
   };
   if(!map[k])continue;
   if(v)enabled.add(map[k]);
   else enabled.delete(map[k]);
  }
 }
 updateButtons();
 if(rows.length)updateIndicators();
 scheduleResize();
}
function events(){
 document.querySelectorAll("[data-indicator]").forEach(button=>{
  button.addEventListener("click",()=>{
   const k=button.dataset.indicator;
   if(enabled.has(k))enabled.delete(k);
   else enabled.add(k);
   updateButtons();
   if(rows.length)updateIndicators();
  });
 });
 $("refresh")?.addEventListener("click",()=>{
  refresh();refreshTicker();
 });
 $("chartReset")?.addEventListener("click",resetView);
 $("rsiSpeak")?.addEventListener("click",()=>{
  if(!("speechSynthesis" in window))return;
  speechSynthesis.cancel();
  const u=new SpeechSynthesisUtterance(lastRSI);
  u.lang="es-MX";speechSynthesis.speak(u);
 });
 if($("rsiSpeak")&&"speechSynthesis" in window)
  $("rsiSpeak").disabled=false;
 for(const id of ["symbol","interval","exchange","market"]){
  $(id)?.addEventListener("change",()=>{
   syncCommodity();clearMarket();connect();
   refresh();refreshTicker();scan(true);
  });
 }
 document.addEventListener("visibilitychange",()=>{
  if(document.hidden)disconnect();
  else{
   connect();refresh();refreshTicker();scan(true);
  }
 });
 window.addEventListener("cryptolexuz:screen-change",event=>{
  if(event.detail?.screen==="charts"){
   setTimeout(()=>{
    resize();
    const r=visibleRange||visible();
    if(r)restore(r);
   },120);
  }
  if(event.detail?.screen==="results")renderHistory();
 });
 window.addEventListener("cryptolexuz:indicator-settings-change",
  applySavedIndicators);
 window.addEventListener("cryptolexuz:volume-profile-ready",()=>{
  volumeProfileAttached=false;
  attachVolumeProfile();updateModules();
 });
 updateButtons();
}
function init(){
 syncCommodity();
 scannerUI();
 renderHistory();
 events();
 applySavedIndicators();
 if(!createCharts())return;
 connect();refresh();refreshTicker();scan(true);
 chartTimer=setInterval(()=>{
  if(!document.hidden)refresh();
 },15000);
 tickerTimer=setInterval(()=>{
  if(!document.hidden)refreshTicker();
 },10000);
 scanTimer=setInterval(()=>{
  if(!document.hidden)scan();
 },60000);
 verifyTimer=setInterval(()=>{
  if(!document.hidden)verifySignals().catch(console.warn);
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
if(document.readyState==="loading")
 document.addEventListener("DOMContentLoaded",init,{once:true});
else init();
})();
