/*
 CRYPTOLEXUZ PRO — LIQUIDITY.JS V15 COMPLETO
 Capa opcional de profundidad REAL sobre las velas de app.js V31.
 Requiere window.CryptolexuzChart (publicado por app.js V31).
 Utiliza el botón existente [data-indicator="liquidity"].
 NO representa liquidaciones, no reconstruye un historial anterior
 ni transforma el libro de órdenes en velas ficticias.
*/
"use strict";
(() => {
  if (window.__CL_LIQUIDITY_V15__) return;
  window.__CL_LIQUIDITY_V15__ = true;
  const $ = id => document.getElementById(id);
  const CFG = {refresh:2500, timeout:10000, depth:200, levels:10};
  const S = {
    enabled:false, running:false, busy:false, again:false, controller:null,
    timer:null, generation:0, key:"", book:null, updated:0, error:"",
    chart:null, candle:null, canvas:null, observer:null, frame:0,
    intensity:0.72, initialized:false
  };
  const fmt = (v,d=2) => Number.isFinite(Number(v)) ? Number(v).toLocaleString("en-US",{maximumFractionDigits:d,minimumFractionDigits:d}) : "—";
  const digits = v => Math.abs(v)>=100?2:Math.abs(v)>=1?4:Math.abs(v)>=0.01?6:8;
  const price = v => fmt(v,digits(v));
  const node = (tag,cls,text) => {const e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=text;return e;};
  const isCommodity = s => /^NCCO/i.test(String(s));
  function selection(){
    const symbol=$("symbol")?.value||"BTC-USDT", special=isCommodity(symbol);
    return {symbol,exchange:special?"bingx":$("exchange")?.value||"bingx",market:special?"perpetual":$("market")?.value||"perpetual",tf:$("interval")?.value||"15m"};
  }
  const key = s => [s.exchange,s.market,s.symbol].join("|");
  function getChart(){
    const obj=window.CryptolexuzChart;
    const chart=obj?.chart||obj?.chartApi||window.clChart;
    const candle=obj?.candle||obj?.candleSeries;
    return chart&&candle&&typeof candle.priceToCoordinate==="function"?{chart,candle}:null;
  }
  function settingsEnabled(){
    try{const data=JSON.parse(localStorage.getItem("cryptolexuz-chart-settings-v1")||"null");return data?.indicators?.liquidity===true;}catch{return false;}
  }
  function setStatus(message,failed=false){
    const t=$("clLiquidityOverlayStatus");if(t){t.textContent=message;t.style.color=failed?"#ff8398":"#b4c5e7";}
  }
  function styles(){if($("clLiquidityV15Styles"))return;
    const style=node("style");style.id="clLiquidityV15Styles";
    style.textContent=`
      #clLiquidityOverlayCanvas{position:absolute!important;inset:0 auto auto 0;z-index:1;pointer-events:none!important;background:transparent!important;max-width:none!important}
      #priceChartArea{position:relative!important;isolation:isolate}
      #clLiquidityOverlayInfo{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;margin:7px 0;padding:8px 10px;border:1px solid #32364b;border-radius:9px;background:#10121e;color:#b4c5e7;font:11px system-ui}
      #clLiquidityOverlayInfo[hidden]{display:none!important}
      #clLiquidityOverlayInfo strong{color:#d8e2ff}
      #clLiquidityOverlayInfo input{accent-color:#bb52ff;width:85px;vertical-align:middle}
      #clLiquidityBook{margin-top:12px;padding:10px;background:#0b0e18;border:1px solid #343b55;border-radius:12px;color:#e7ecff}
      .cl-lq-columns,.cl-lq-row{display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;padding:6px 4px;font:11px system-ui;font-variant-numeric:tabular-nums}
      .cl-lq-columns{color:#aab7d4}.cl-lq-row{position:relative;border-radius:5px;overflow:hidden}
      .cl-lq-row span{z-index:1;position:relative}.cl-lq-row span:not(:first-child),.cl-lq-columns span:not(:first-child){text-align:right}
      .cl-lq-bar{position:absolute;inset:0 auto 0 0;opacity:.2;z-index:0}
      .cl-lq-row.ask{color:#ff9bb0}.cl-lq-row.bid{color:#77ffd0}
      .cl-lq-row.ask .cl-lq-bar{background:#ff476c}.cl-lq-row.bid .cl-lq-bar{background:#00f5a0}
      .cl-lq-note{font:11px/1.55 system-ui;color:#aab7d4;margin:7px 0}
      .cl-lq-split{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px}
      .cl-lq-split>div{min-width:0}
      .cl-lq-split h4{margin:5px 0;font:700 12px system-ui}
      @media(max-width:370px){.cl-lq-split{grid-template-columns:1fr}}
    `;document.head.appendChild(style);
  }
  function build(){
    const area=$("priceChartArea"),bookSection=$("orderbookSection");
    if(!area||!bookSection)return false;
    styles();
    let canvas=$("clLiquidityOverlayCanvas");
    if(!canvas){canvas=node("canvas");canvas.id="clLiquidityOverlayCanvas";canvas.setAttribute("aria-hidden","true");area.appendChild(canvas);}
    S.canvas=canvas;
    let info=$("clLiquidityOverlayInfo");
    if(!info){
      info=node("div");info.id="clLiquidityOverlayInfo";
      const label=node("strong","","🌡️ Liquidez sobre velas");
      const status=node("span");status.id="clLiquidityOverlayStatus";
      const intensity=node("label");intensity.textContent="Intensidad ";
      const range=node("input");range.type="range";range.min="0.2";range.max="1";range.step="0.05";range.value=String(S.intensity);range.id="clLiquidityOverlayIntensity";
      range.addEventListener("input",()=>{S.intensity=Number(range.value);redraw();});
      intensity.append(range);info.append(label,status,intensity);
      area.parentNode.insertBefore(info,area.nextSibling);
    }
    let root=$("clLiquidityBook");
    if(!root){root=node("div");root.id="clLiquidityBook";bookSection.appendChild(root);}
    root.replaceChildren();
    root.append(node("h3","","📚 Libro de órdenes · diez niveles por lado"));
    const split=node("div","cl-lq-split");
    for(const [side,title] of [["asks","Ventas · ASK"],["bids","Compras · BID"]]){
      const col=node("div");col.append(node("h4","",title));
      const cols=node("div","cl-lq-columns");for(const h of ["Precio","Cantidad","USDT"])cols.append(node("span","",h));
      const host=node("div");host.id="clLq"+side;host.textContent="Esperando órdenes...";
      col.append(cols,host);split.append(col);
    }
    root.append(split);
    const summary=node("p","cl-lq-note","Esperando profundidad real...");summary.id="clLiquidityBookSummary";
    root.append(summary,node("p","cl-lq-note","Las concentraciones reflejan órdenes visibles que pueden cancelarse. No indican liquidaciones ni probabilidades de rechazo."));
    const standalone=$("liquidityMap");
    if(standalone){standalone.replaceChildren(node("p","cl-lq-note","El mapa de liquidez ahora se activa desde el botón Liquidez en la fila de indicadores, sobre las velas de la gráfica."));}
    const toggle=$("liquidityMapToggle");if(toggle){toggle.disabled=false;toggle.checked=S.enabled;}
    updateVisibility();return true;
  }
  function parseSide(data){if(!Array.isArray(data))return [];
    return data.map(v=>({price:Number(Array.isArray(v)?v[0]:v?.price??v?.px??v?.p),quantity:Number(Array.isArray(v)?v[1]:v?.quantity??v?.qty??v?.size??v?.sz??v?.amount??v?.q)})).filter(v=>Number.isFinite(v.price)&&v.price>0&&Number.isFinite(v.quantity)&&v.quantity>0);
  }
  function normalize(raw){
    if(raw?.code!==undefined&&![0,"0","00000"].includes(raw.code))throw Error("API "+raw.code);
    let d=raw;
    for(let i=0;i<6;i++){
      if(d?.bids||d?.asks||d?.b||d?.a)break;
      d=d?.data;if(Array.isArray(d))d=d[0];
    }
    const bids=parseSide(d?.bids??d?.b).sort((a,b)=>b.price-a.price).slice(0,CFG.depth);
    const asks=parseSide(d?.asks??d?.a).sort((a,b)=>a.price-b.price).slice(0,CFG.depth);
    if(!bids.length||!asks.length)throw Error("Libro de órdenes vacío");
    if(bids[0].price>=asks[0].price)throw Error("Bid/ask inconsistentes");
    return {bids,asks,mid:(bids[0].price+asks[0].price)/2};
  }
  function url(s){return "/api/exchange/"+encodeURIComponent(s.exchange)+"/depth/"+encodeURIComponent(s.symbol)+"?market="+encodeURIComponent(s.market)+"&limit="+CFG.depth;}
  function sum(orders){return orders.reduce((a,o)=>a+o.price*o.quantity,0);}
  function largest(orders){return orders.reduce((a,b)=>!a||b.price*b.quantity>a.price*a.quantity?b:a,null);}
  function renderSide(id,orders,kind){
    const root=$(id);if(!root)return;root.replaceChildren();
    const data=orders.slice(0,CFG.levels),max=Math.max(1,...data.map(o=>o.price*o.quantity));
    for(const o of data){
      const row=node("div","cl-lq-row "+kind),bar=node("div","cl-lq-bar");bar.style.width=(100*o.price*o.quantity/max)+"%";row.append(bar);
      for(const t of [price(o.price),fmt(o.quantity,4),fmt(o.price*o.quantity,0)])row.append(node("span","",t));root.append(row);
    }
  }
  function renderBook(book){
    renderSide("clLqasks",book.asks,"ask");renderSide("clLqbids",book.bids,"bid");
    const bid=book.bids[0].price,ask=book.asks[0].price;
    if($("bid"))$("bid").textContent=price(bid);
    if($("ask"))$("ask").textContent=price(ask);
    const buys=book.bids.slice(0,CFG.levels),sells=book.asks.slice(0,CFG.levels);
    const b=sum(buys),a=sum(sells),total=b+a;
    const target=$("clLiquidityBookSummary");
    if(target)target.textContent="Bid "+price(bid)+" · Ask "+price(ask)+" · Spread "+price(ask-bid)+" ("+fmt((ask-bid)/book.mid*100,4)+"%). Compras visibles: "+fmt(b,0)+" USDT ("+fmt(total?b/total*100:0,1)+"%). Ventas visibles: "+fmt(a,0)+" USDT ("+fmt(total?a/total*100:0,1)+"%). Mayor compra: "+price(largest(buys)?.price)+". Mayor venta: "+price(largest(sells)?.price)+".";
  }
  function updateVisibility(){
    if(S.canvas)S.canvas.hidden=!S.enabled;
    const info=$("clLiquidityOverlayInfo");if(info)info.hidden=!S.enabled;
    const toggle=$("liquidityMapToggle");if(toggle)toggle.checked=S.enabled;
  }
  function clear(){
    const canvas=S.canvas;if(!canvas)return;
    const ctx=canvas.getContext("2d");if(ctx)ctx.clearRect(0,0,canvas.width,canvas.height);
  }
  function redraw(){if(S.frame)return;S.frame=requestAnimationFrame(()=>{S.frame=0;draw();});}
  // V31 dibuja máximos y mínimos de pivotes al activar "liquidity".
  // Son niveles técnicos, NO profundidad. Retirarlos sin tocar otras líneas.
  function removeLegacyPivotLines(api){
    try{
      const lines=api?.candle?.priceLines?.()||[];
      for(const line of lines){
        const title=line.options?.()?.title;
        if(title==="Máximo"||title==="Mínimo")api.candle.removePriceLine(line);
      }
    }catch(e){console.warn("Liquidez: limpieza de niveles heredados",e);}
  }
  function draw(){
    const canvas=S.canvas,api=getChart(),element=$("chart");
    if(!canvas||!element||!api||!S.enabled||!S.book){clear();return;}
    removeLegacyPivotLines(api);
    const rect=element.getBoundingClientRect(),area=$("priceChartArea")?.getBoundingClientRect();
    if(!area||rect.width<80||rect.height<80)return;
    const w=rect.width,h=rect.height,dpr=Math.min(devicePixelRatio||1,2);
    canvas.style.left=(rect.left-area.left)+"px";canvas.style.top=(rect.top-area.top)+"px";
    canvas.style.width=w+"px";canvas.style.height=h+"px";
    const pw=Math.round(w*dpr),ph=Math.round(h*dpr);
    if(canvas.width!==pw||canvas.height!==ph){canvas.width=pw;canvas.height=ph;}
    const ctx=canvas.getContext("2d");if(!ctx)return;
    ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,w,h);
    // Nunca dibujar sobre el eje de precios ni el eje temporal.
    const chartWidth=api.chart?.timeScale?.().width?.()||w-70;
    const plotW=Math.max(0,Math.min(w-60,chartWidth));
    if(plotW<30)return;
    const all=[...S.book.bids.map(o=>({...o,buy:true})),...S.book.asks.map(o=>({...o,buy:false}))];
    // Agrupación por píxel vertical: evita que 200 niveles sean rayas
    // invisibles en una pantalla móvil. La cantidad procede del libro REAL.
    const priceToY=p=>api.candle.priceToCoordinate(p);
    const height=h-24,step=Math.max(5,Math.min(12,Math.round(height/65)));
    const count=Math.ceil(height/step);
    const buy=new Float64Array(count),sell=new Float64Array(count);
    let visible=0;
    for(const o of all){
      const y=priceToY(o.price);
      if(!Number.isFinite(y)||y<0||y>=height)continue;
      const i=Math.min(count-1,Math.floor(y/step));
      (o.buy?buy:sell)[i]+=o.price*o.quantity;
      visible++;
    }
    if(!visible){setStatus("Profundidad recibida; precios fuera de la escala visible");return;}
    const values=[];
    for(let i=0;i<count;i++)if(buy[i]+sell[i]>0)values.push(buy[i]+sell[i]);
    values.sort((a,b)=>a-b);
    const ref=Math.max(1,values[Math.floor((values.length-1)*.90)]||1);
    const logRef=Math.log1p(ref);
    ctx.save();ctx.beginPath();ctx.rect(0,0,plotW,height);ctx.clip();
    let bands=0;
    for(let i=0;i<count;i++){
      const total=buy[i]+sell[i];if(!total)continue;
      const strength=Math.min(1,Math.log1p(total)/logRef);
      const alpha=Math.min(.42,S.intensity*(.09+.33*strength));
      const y=i*step;
      // Morado/azul para niveles menores, verde/amarillo para compras
      // y rojo/naranja para ventas. No son probabilidades.
      let color;
      if(strength<.35)color=`rgba(108,45,185,${alpha.toFixed(3)})`;
      else if(strength<.60)color=`rgba(41,117,216,${alpha.toFixed(3)})`;
      else if(buy[i]>=sell[i])color=strength>.85?`rgba(255,220,65,${alpha.toFixed(3)})`:`rgba(0,245,160,${alpha.toFixed(3)})`;
      else color=strength>.85?`rgba(255,122,25,${alpha.toFixed(3)})`:`rgba(255,71,108,${alpha.toFixed(3)})`;
      ctx.fillStyle=color;
      ctx.fillRect(0,y,plotW,step+1);
      // La barra de intensidad termina a la derecha para distinguir
      // concentraciones grandes sin cubrir las velas con opacidad alta.
      if(strength>.72){
        const barW=Math.min(plotW*.27,plotW*.27*strength);
        ctx.fillStyle=buy[i]>=sell[i]?"rgba(0,245,160,.42)":"rgba(255,71,108,.42)";
        ctx.fillRect(plotW-barW,y,barW,Math.max(2,step-1));
      }
      bands++;
    }
    ctx.restore();
    setStatus("Mapa real · "+bands+" bandas · "+new Date(S.updated).toLocaleTimeString("es-MX")+" · "+selection().tf);

  }
  async function refresh(){
    if(!S.running||document.hidden)return;
    if(S.busy){S.again=true;return;}
    const selected=selection(),k=key(selected);
    if(k!==S.key){S.key=k;S.generation++;S.book=null;clear();}
    const generation=S.generation,controller=new AbortController();
    S.controller=controller;S.busy=true;
    const timeout=setTimeout(()=>controller.abort(),CFG.timeout);
    try{
      setStatus("Consultando profundidad real...");
      const response=await fetch(url(selected),{signal:controller.signal,cache:"no-store"});
      if(!response.ok)throw Error("HTTP "+response.status);
      const book=normalize(await response.json());
      if(!S.running||generation!==S.generation||k!==key(selection())||controller.signal.aborted)return;
      S.book=book;S.updated=Date.now();S.error="";
      renderBook(book);redraw();
    }catch(e){
      if(!S.running||generation!==S.generation)return;
      S.error=controller.signal.aborted?"Tiempo de espera agotado":String(e.message||e);
      setStatus("Sin profundidad: "+S.error,true);
      if(!S.book)clear();
      console.warn("CRYPTOLEXUZ Liquidez V15:",e);
    }finally{
      clearTimeout(timeout);if(S.controller===controller)S.controller=null;
      S.busy=false;
      if(S.again&&S.running&&!document.hidden){S.again=false;queueMicrotask(refresh);}
    }
  }
  function start(){if(S.running)return;S.running=true;S.key=key(selection());refresh();S.timer=setInterval(refresh,CFG.refresh);}
  function stop(){S.running=false;S.generation++;S.again=false;
    if(S.timer){clearInterval(S.timer);S.timer=null;}
    S.controller?.abort();S.controller=null;clear();
  }
  function restart(){S.generation++;S.key=key(selection());S.book=null;clear();S.controller?.abort();if(S.running){if(S.busy)S.again=true;else refresh();}}
  function setEnabled(value){
    S.enabled=Boolean(value);updateVisibility();
    if(S.enabled){start();redraw();}else stop();
  }
  function syncFromApp(event){
    const next=event?.detail?.settings?.indicators?.liquidity;
    if(typeof next==="boolean")setEnabled(next);
    else setEnabled(settingsEnabled());
  }
  function bindChart(){const c=getChart();if(!c)return false;
    if(S.chart===c.chart&&S.candle===c.candle)return true;
    S.chart=c.chart;S.candle=c.candle;
    try{c.chart.timeScale().subscribeVisibleLogicalRangeChange(redraw);}catch{}
    try{c.chart.timeScale().subscribeVisibleTimeRangeChange(redraw);}catch{}
    return true;
  }
  function init(){if(S.initialized)return;if(!build())return;S.initialized=true;
    bindChart();
    S.enabled=settingsEnabled();updateVisibility();if(S.enabled)start();
    window.addEventListener("cryptolexuz:chart-ready",()=>{bindChart();redraw();});
    window.addEventListener("cryptolexuz:candles-updated",()=>{bindChart();redraw();});
    window.addEventListener("cryptolexuz:indicator-state-updated",syncFromApp);
    window.addEventListener("cryptolexuz:indicator-settings-change",syncFromApp);
    window.addEventListener("cryptolexuz:screen-change",redraw);
    for(const id of ["symbol","exchange","market"])$(id)?.addEventListener("change",restart);
    $("interval")?.addEventListener("change",()=>{setStatus("Temporalidad: "+selection().tf);redraw();});
    $("liquidityMapToggle")?.addEventListener("change",e=>{
      // Delegar el cambio a app.js para mantener su preferencia sincronizada.
      if(window.CryptolexuzApp?.setIndicator)window.CryptolexuzApp.setIndicator("liquidity",e.target.checked);
      else setEnabled(e.target.checked);
    });
    if(window.ResizeObserver){S.observer=new ResizeObserver(redraw);S.observer.observe($("chart"));S.observer.observe($("priceChartArea"));}
    window.addEventListener("resize",redraw);
    document.addEventListener("visibilitychange",()=>{if(!document.hidden&&S.running){refresh();redraw();}});
    window.addEventListener("beforeunload",()=>{stop();S.observer?.disconnect();});
    console.info("CRYPTOLEXUZ PRO — LIQUIDITY.JS V15 · capa sobre velas");
  }
  window.CryptolexuzLiquidity={
    version:"15",start,stop,restart,refresh,redraw,setEnabled,
    isRunning:()=>S.running,getSelection:selection,
    getBook:()=>S.book?JSON.parse(JSON.stringify(S.book)):null,
    getSnapshots:()=>[], // V14 muestra únicamente el libro actual, sin historial artificial.
    getStatus:()=>({enabled:S.enabled,running:S.running,busy:S.busy,market:S.key,lastUpdated:S.updated,lastError:S.error})
  };
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init,{once:true});else init();
})();
