
/*
 CRYPTOLEXUZ PRO — RANGE BOXES V5
 Caja morada interactiva

 - Sin caja verde
 - Arrastre con un dedo
 - Ajuste de bordes y altura
 - Persistencia por mercado
 - Compatible con Lightweight Charts 4.2.2
 - Sin ejecución de órdenes
*/
"use strict";

(() => {
 if(window.__clRangeBoxesV5)return;
 window.__clRangeBoxesV5=true;

 const $=id=>document.getElementById(id);
 const GOLD="NCCOGOLD2USD-USDT";
 const OIL="NCCO1OILWTI2USD-USDT";
 const TF={
  "1m":60,"3m":180,"5m":300,
  "15m":900,"30m":1800,"1h":3600,
  "2h":7200,"4h":14400,"6h":21600,
  "8h":28800,"12h":43200,
  "1d":86400,"1w":604800
 };

 const STORE="cryptolexuz-purple-boxes-v5";
 const OLD_STORE="cryptolexuz-fixed-boxes-v3";
 const PREFS="cryptolexuz-purple-prefs-v5";

 const COLOR="#bb52ff";
 const FILL="rgba(187,82,255,.12)";

 function read(key,fallback){
  try{
   const value=JSON.parse(localStorage.getItem(key)||"null");
   return value===null?fallback:value;
  }catch{return fallback}
 }

 const config={
  sideways:true,
  previous:false,
  fixed:true,
  midpoint:false,
  boundaries:true,
  extendRight:true,
  lookback:24
 };

 Object.assign(config,read(PREFS,{}));

 function savePrefs(){
  try{localStorage.setItem(PREFS,JSON.stringify(config))}
  catch(e){console.warn(e)}
 }

 /*
  Migración de cajas fijas anteriores.
  No se recupera la caja verde automática.
 */
 let boxes=read(STORE,null);

 if(!Array.isArray(boxes)){
  const old=read(OLD_STORE,[]);
  boxes=Array.isArray(old)?old:[];
 }

 boxes=boxes.filter(b=>
  b&&typeof b.id==="string"&&
  typeof b.marketKey==="string"&&
  [b.high,b.low,b.start,b.end]
   .every(v=>Number.isFinite(Number(v)))
 ).map(b=>({
  ...b,
  high:Number(b.high),
  low:Number(b.low),
  start:Number(b.start),
  end:Number(b.end),
  name:"Caja morada"
 }));

 function saveBoxes(){
  try{localStorage.setItem(STORE,JSON.stringify(boxes))}
  catch(e){console.warn(e)}
 }

 let chart=null;
 let candle=null;
 let rows=[];
 let currentKey="";
 let selectedId=null;
 let attachedChart=null;
 let raf=0;
 let drag=null;
 let initialized=false;

 const canvas=document.createElement("canvas");
 canvas.id="clRangeOverlay";
 canvas.style.cssText=`
  position:absolute;
  inset:0;
  width:100%;
  height:100%;
  z-index:70;
  pointer-events:none;
  touch-action:none;
 `;

 const panel=document.createElement("section");
 panel.id="clRangeControls";
 panel.className="cl-module";
 panel.style.cssText=`
  display:grid;
  gap:12px;
  margin:12px 0;
  padding:14px;
  border:1px solid #5d367c;
  border-radius:13px;
  background:#181222;
  color:#f0e5ff;
  font:12px system-ui,sans-serif;
 `;

 const heading=document.createElement("div");
 heading.innerHTML=`
  <strong style="font-size:15px">
   🟪 Caja morada
  </strong>
  <span style="float:right;color:#b89bd1">
   V5
  </span>
 `;

 const grid=document.createElement("div");
 grid.style.cssText=`
  display:grid;
  grid-template-columns:repeat(2,minmax(0,1fr));
  gap:8px;
 `;

 function toggle(label,key){
  const item=document.createElement("label");
  item.style.cssText=`
   display:flex;
   align-items:center;
   gap:7px;
   padding:9px;
   background:#251b32;
   border:1px solid #51366a;
   border-radius:8px;
  `;
  const input=document.createElement("input");
  input.type="checkbox";
  input.checked=!!config[key];
  input.style.accentColor=COLOR;
  input.addEventListener("change",()=>{
   config[key]=input.checked;
   savePrefs();
   redraw();
  });
  item.append(input,document.createTextNode(label));
  grid.append(item);
  return input;
 }

 const fixedToggle=toggle("Mostrar cajas","fixed");
 toggle("Lateralización","sideways");
 toggle("Penúltima vela","previous");
 toggle("Extender lateral","extendRight");
 toggle("Línea central","midpoint");
 toggle("Mostrar bordes","boundaries");

 const controls=document.createElement("div");
 controls.style.cssText=`
  display:flex;
  flex-wrap:wrap;
  gap:8px;
 `;

 function button(text){
  const b=document.createElement("button");
  b.type="button";
  b.textContent=text;
  b.style.cssText=`
   padding:10px;
   background:#332044;
   color:#fff;
   border:1px solid #7849a3;
   border-radius:9px;
   font:12px system-ui;
  `;
  return b;
 }

 const create=button("＋ Crear caja morada");
 const fromPrevious=button("📌 Fijar vela");
 const remove=button("🗑 Eliminar caja");
 const moveMode=button("✋ Mover caja: desactivado");

 const selector=document.createElement("select");
 selector.style.cssText=`
  max-width:100%;
  padding:10px;
  border:1px solid #7849a3;
  border-radius:8px;
  background:#251b32;
  color:#fff;
 `;

 const lookback=document.createElement("select");
 lookback.style.cssText=selector.style.cssText;

 for(const n of [12,24,36,48,72]){
  const option=document.createElement("option");
  option.value=n;
  option.textContent=n+" velas";
  option.selected=n===Number(config.lookback);
  lookback.append(option);
 }

 lookback.addEventListener("change",()=>{
  config.lookback=Number(lookback.value);
  savePrefs();
  redraw();
 });

 controls.append(
  create,fromPrevious,remove,
  selector,moveMode,lookback
 );

 const note=document.createElement("p");
 note.style.cssText=`
  margin:0;
  color:#c4aed7;
  line-height:1.6;
 `;
 note.textContent=
  "Activa Mover caja para arrastrarla con un dedo. "+
  "Arrastra sus bordes para cambiar tamaño. "+
  "Desactívalo para mover las velas normalmente.";

 panel.append(heading,grid,controls,note);

 function selection(){
  const symbol=$("symbol")?.value||"BTC-USDT";
  const commodity=[GOLD,OIL].includes(symbol);
  return {
   symbol,
   tf:$("interval")?.value||"15m",
   exchange:commodity?"bingx":$("exchange")?.value||"bingx",
   market:commodity?"perpetual":$("market")?.value||"perpetual"
  };
 }

 function marketKey(s){
  return [s.exchange,s.market,s.symbol].join("|");
 }

 function visibleBoxes(){
  return boxes.filter(b=>b.marketKey===marketKey(selection()));
 }

 function selected(){
  return visibleBoxes().find(b=>b.id===selectedId);
 }

 function updateSelector(){
  const list=visibleBoxes();

  if(!list.some(b=>b.id===selectedId))
   selectedId=list.at(-1)?.id||null;

  selector.replaceChildren();

  if(!list.length){
   const o=document.createElement("option");
   o.textContent="Sin cajas";
   o.value="";
   selector.append(o);
  }

  list.forEach((b,i)=>{
   const o=document.createElement("option");
   o.value=b.id;
   o.textContent="Caja morada "+(i+1);
   o.selected=b.id===selectedId;
   selector.append(o);
  });

  remove.disabled=!list.length;
  moveMode.disabled=!list.length;
 }

 selector.addEventListener("change",()=>{
  selectedId=selector.value;
  redraw();
 });

 function saveAndDraw(){
  saveBoxes();
  updateSelector();
  redraw();
 }

 function closed(){
  const sec=TF[selection().tf]||60;
  const now=Date.now()/1000;
  return rows.filter(c=>c.time+sec<=now-2);
 }

 function sourceRange(){
  const data=closed().slice(-Number(config.lookback||24));
  if(data.length<4)return null;
  return {
   start:data[0].time,
   end:data.at(-1).time,
   high:Math.max(...data.map(x=>x.high)),
   low:Math.min(...data.map(x=>x.low))
  };
 }

 function createBox(source){
  if(!source)return;
  const s=selection();
  const sec=TF[s.tf]||60;

  const box={
   id:"purple-"+Date.now()+"-"+
    Math.random().toString(36).slice(2,8),
   marketKey:marketKey(s),
   symbol:s.symbol,
   sourceTf:s.tf,
   name:"Caja morada",
   start:source.start,
   end:Math.max(source.end,source.start+sec),
   high:source.high,
   low:source.low
  };

  boxes.push(box);
  selectedId=box.id;
  config.fixed=true;
  fixedToggle.checked=true;
  savePrefs();
  saveAndDraw();
 }

 create.addEventListener("click",()=>{
  const r=sourceRange();
  if(!r){
   note.textContent="Esperando suficientes velas cerradas.";
   return;
  }
  createBox(r);
 });

 fromPrevious.addEventListener("click",()=>{
  const data=closed();
  const p=data.at(-2);
  if(!p){
   note.textContent="Esperando velas cerradas.";
   return;
  }
  const sec=TF[selection().tf]||60;
  createBox({
   start:p.time,end:p.time+sec,
   high:p.high,low:p.low
  });
 });

 remove.addEventListener("click",()=>{
  const b=selected();
  if(!b)return;
  if(!confirm("¿Eliminar la caja morada seleccionada?"))return;
  boxes=boxes.filter(x=>x.id!==b.id);
  selectedId=null;
  saveAndDraw();
 });

 let editing=false;

 moveMode.addEventListener("click",()=>{
  editing=!editing;
  moveMode.textContent=editing
   ?"✋ Mover caja: activado"
   :"✋ Mover caja: desactivado";
  canvas.style.pointerEvents=editing?"auto":"none";
  redraw();
 });

 function priceY(price){
  try{return candle.priceToCoordinate(price)}
  catch{return null}
 }

 function timeX(time){
  try{return chart.timeScale().timeToCoordinate(time)}
  catch{return null}
 }

 function coordinateAtTime(time){
  if(!chart||!rows.length)return null;
  const exact=timeX(time);
  if(Number.isFinite(exact))return exact;

  const scale=chart.timeScale();
  const sec=TF[selection().tf]||60;
  const first=rows[0],last=rows.at(-1);
  const edge=time<first.time?first:last;
  const edgeX=timeX(edge.time);
  if(!Number.isFinite(edgeX))return null;

  let spacing=7;
  try{
   spacing=Number(scale.options().barSpacing)||7;
  }catch{}

  return edgeX+(time-edge.time)/sec*spacing;
 }

 function timeAtX(x){
  if(!chart||!rows.length)return null;
  const scale=chart.timeScale();
  const t=scale.coordinateToTime(x);
  if(typeof t==="number")return t;

  const logical=scale.coordinateToLogical(x);
  if(!Number.isFinite(logical))return null;

  const index=Math.round(logical);
  const sec=TF[selection().tf]||60;

  if(index<0)return rows[0].time+index*sec;
  if(index>=rows.length)
   return rows.at(-1).time+(index-rows.length+1)*sec;

  return rows[index].time;
 }

 function priceAtY(y){
  try{return candle.coordinateToPrice(y)}
  catch{return null}
 }

 function geometry(b){
  const x1=coordinateAtTime(b.start);
  const x2=coordinateAtTime(b.end);
  const y1=priceY(b.high);
  const y2=priceY(b.low);
  if(![x1,x2,y1,y2].every(Number.isFinite))return null;
  return {
   left:Math.min(x1,x2),
   right:Math.max(x1,x2),
   top:Math.min(y1,y2),
   bottom:Math.max(y1,y2)
  };
 }

 function drawBox(ctx,b,label,active=false,extend=false){
  const g=geometry(b);
  if(!g)return;

  const w=canvas.clientWidth,h=canvas.clientHeight;
  const left=Math.max(0,g.left);
  const right=Math.min(w,extend?w:g.right);
  const top=Math.max(0,g.top);
  const bottom=Math.min(h,g.bottom);

  if(right<=left||bottom<=top)return;

  ctx.save();
  ctx.fillStyle=FILL;
  ctx.fillRect(left,top,right-left,bottom-top);

  ctx.strokeStyle=active?"#e2b2ff":COLOR;
  ctx.lineWidth=active?2:1.2;
  ctx.strokeRect(left,top,right-left,bottom-top);

  if(config.midpoint){
   const y=priceY((b.high+b.low)/2);
   if(Number.isFinite(y)){
    ctx.setLineDash([5,5]);
    ctx.strokeStyle="#e2b2ff";
    ctx.beginPath();
    ctx.moveTo(left,y);
    ctx.lineTo(right,y);
    ctx.stroke();
    ctx.setLineDash([]);
   }
  }

  ctx.fillStyle="#e2b2ff";
  ctx.font="11px system-ui";
  ctx.fillText(label,left+5,Math.max(13,top+13));

  if(active&&editing){
   ctx.fillStyle="#fff";
   for(const [x,y] of [
    [left,(top+bottom)/2],
    [right,(top+bottom)/2],
    [(left+right)/2,top],
    [(left+right)/2,bottom]
   ]){
    ctx.fillRect(x-4,y-4,8,8);
   }
  }

  ctx.restore();
 }

 function sidewaysBox(){
  const data=closed().slice(-18);
  if(data.length<12)return null;
  const high=Math.max(...data.map(x=>x.high));
  const low=Math.min(...data.map(x=>x.low));
  const avg=data.reduce(
   (sum,x)=>sum+x.high-x.low,0
  )/data.length;
  if((high-low)/Math.max(avg,1e-12)>5)return null;
  return {
   start:data[0].time,
   end:data.at(-1).time,
   high,low
  };
 }

 function draw(){
  if(!chart||!candle||!canvas.isConnected)return;
  const w=canvas.clientWidth,h=canvas.clientHeight;
  if(!w||!h)return;

  const dpr=Math.min(devicePixelRatio||1,2);
  const pw=Math.round(w*dpr),ph=Math.round(h*dpr);
  if(canvas.width!==pw)canvas.width=pw;
  if(canvas.height!==ph)canvas.height=ph;

  const ctx=canvas.getContext("2d");
  if(!ctx)return;
  ctx.setTransform(dpr,0,0,dpr,0,0);
  ctx.clearRect(0,0,w,h);

  if(config.sideways){
   const b=sidewaysBox();
   if(b)drawBox(ctx,b,"Lateralización",false,config.extendRight);
  }

  if(config.previous){
   const data=closed(),p=data.at(-2);
   if(p){
    const sec=TF[selection().tf]||60;
    drawBox(ctx,{
     start:p.time,end:p.time+sec,
     high:p.high,low:p.low
    },"Penúltima vela",false,false);
   }
  }

  if(config.fixed){
   visibleBoxes().forEach((b,i)=>{
    drawBox(ctx,b,"Caja "+(i+1),b.id===selectedId,false);
   });
  }
 }

 function redraw(){
  if(raf)return;
  raf=requestAnimationFrame(()=>{
   raf=0;draw();
  });
 }

 /*
  Gestos de edición.
  Se interceptan únicamente cuando
  el modo de edición está activado.
 */
 function point(event){
  const rect=canvas.getBoundingClientRect();
  return {
   x:event.clientX-rect.left,
   y:event.clientY-rect.top
  };
 }

 function hitTest(p){
  const list=visibleBoxes().slice().reverse();
  for(const b of list){
   const g=geometry(b);
   if(!g)continue;
   const margin=13;
   if(p.x<g.left-margin||p.x>g.right+margin||
      p.y<g.top-margin||p.y>g.bottom+margin)continue;

   if(Math.abs(p.x-g.left)<=margin)
    return {box:b,mode:"left"};
   if(Math.abs(p.x-g.right)<=margin)
    return {box:b,mode:"right"};
   if(Math.abs(p.y-g.top)<=margin)
    return {box:b,mode:"top"};
   if(Math.abs(p.y-g.bottom)<=margin)
    return {box:b,mode:"bottom"};
   return {box:b,mode:"move"};
  }
  return null;
 }

 canvas.addEventListener("pointerdown",event=>{
  if(!editing||event.button>0)return;
  const p=point(event);
  const hit=hitTest(p);
  if(!hit)return;

  event.preventDefault();
  selectedId=hit.box.id;
  updateSelector();

  drag={
   pointerId:event.pointerId,
   box:hit.box,
   mode:hit.mode,
   x:p.x,y:p.y,
   original:{...hit.box}
  };

  canvas.setPointerCapture(event.pointerId);
  redraw();
 });

 canvas.addEventListener("pointermove",event=>{
  if(!drag||drag.pointerId!==event.pointerId)return;
  event.preventDefault();

  const p=point(event);
  const b=drag.box;
  const old=drag.original;
  const sec=TF[selection().tf]||60;

  const t0=timeAtX(drag.x);
  const t1=timeAtX(p.x);
  const price0=priceAtY(drag.y);
  const price1=priceAtY(p.y);

  if(drag.mode==="move"){
   if(Number.isFinite(t0)&&Number.isFinite(t1)){
    const dt=Math.round((t1-t0)/sec)*sec;
    b.start=old.start+dt;
    b.end=old.end+dt;
   }
   if(Number.isFinite(price0)&&Number.isFinite(price1)){
    const delta=price1-price0;
    b.high=old.high+delta;
    b.low=old.low+delta;
   }
  }else if(drag.mode==="left"||drag.mode==="right"){
   if(Number.isFinite(t1)){
    const snapped=Math.round(t1/sec)*sec;
    if(drag.mode==="left")
     b.start=Math.min(snapped,old.end-sec);
    else
     b.end=Math.max(snapped,old.start+sec);
   }
  }else if(Number.isFinite(price1)&&price1>0){
   if(drag.mode==="top")
    b.high=Math.max(price1,old.low*1.000001);
   else
    b.low=Math.max(0.00000001,
     Math.min(price1,old.high*.999999));
  }

  redraw();
 });

 function finishDrag(event){
  if(!drag||drag.pointerId!==event.pointerId)return;
  try{canvas.releasePointerCapture(event.pointerId)}catch{}
  drag=null;
  saveAndDraw();
 }

 canvas.addEventListener("pointerup",finishDrag);
 canvas.addEventListener("pointercancel",finishDrag);

 function bindOverlay(){
  const host=$("priceChartArea")||$("chart")?.parentElement;
  if(!host)return;
  if(getComputedStyle(host).position==="static")
   host.style.position="relative";

  if(canvas.parentElement!==host)host.append(canvas);

  const target=$("clRangeBoxesHost")||
   $("rangeBoxesHost")||
   document.querySelector("[data-range-boxes-host]");

  if(target){
   if(panel.parentElement!==target)target.append(panel);
  }else if(!panel.isConnected){
   const anchor=$("chartSection")||host;
   anchor.parentElement?.insertBefore(panel,anchor);
  }
  canvas.style.pointerEvents=editing?"auto":"none";
 }

 function attach(detail){
  if(!detail?.chart||!(detail.candle||detail.candleSeries))return;
  chart=detail.chart;
  candle=detail.candle||detail.candleSeries;
  bindOverlay();

  if(attachedChart!==chart){
   attachedChart=chart;
   chart.timeScale().subscribeVisibleLogicalRangeChange(redraw);
  }
  redraw();
 }

 window.addEventListener("cryptolexuz:chart-ready",e=>attach(e.detail));

 window.addEventListener("cryptolexuz:candles-updated",e=>{
  const d=e.detail||{};
  if(d.chart)attach(d);
  const data=d.rows||d.candles;
  if(Array.isArray(data)){
   rows=data;
   const k=marketKey(selection());
   if(k!==currentKey){
    currentKey=k;
    selectedId=null;
    updateSelector();
   }
   redraw();
  }
 });

 function recoverChart(){
  const shared=window.CryptolexuzChart;
  if(!shared?.chart)return;
  attach({
   chart:shared.chart,
   candle:shared.candle||shared.candleSeries
  });
  if(typeof shared.getRows==="function"){
   const data=shared.getRows();
   if(Array.isArray(data)){
    rows=data;redraw();
   }
  }
 }

 function init(){
  if(initialized)return;
  initialized=true;
  bindOverlay();
  recoverChart();
  updateSelector();

  for(const id of ["symbol","interval","market","exchange"]){
   $(id)?.addEventListener("change",()=>{
    rows=[];
    currentKey="";
    selectedId=null;
    updateSelector();
    redraw();
    setTimeout(recoverChart,200);
   });
  }

  window.addEventListener("resize",redraw);
  window.addEventListener("cryptolexuz:screen-change",()=>{
   recoverChart();
   redraw();
  });

  document.addEventListener("visibilitychange",()=>{
   if(!document.hidden){
    recoverChart();
    redraw();
   }
  });

  setTimeout(recoverChart,300);
 }

 window.CryptolexuzRangeBoxes={
  redraw,
  getBoxes:()=>visibleBoxes(),
  getSelection:selection
 };

 if(document.readyState==="loading")
  document.addEventListener("DOMContentLoaded",init,{once:true});
 else init();
})();
