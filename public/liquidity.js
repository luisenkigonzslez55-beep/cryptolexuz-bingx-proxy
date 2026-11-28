/*
 CRYPTOLEXUZ PRO — LIQUIDITY.JS V17 COMPLETO
 Mapa de calor tipo Bookmap sobre velas reales de app.js V32.
 Profundidad REAL obtenida del proxy BingX; historial únicamente desde
 que se activa la función en esta sesión. No son liquidaciones.
 Compatible con Lightweight Charts 4.2.2 e index.html V38+.
*/
'use strict';
(() => {
  if (window.__CL_LIQUIDITY_V17__) return;
  window.__CL_LIQUIDITY_V17__ = true;
  const $ = id => document.getElementById(id);
  const CFG = {refresh:3000,timeout:10000,depth:200,levels:10,maxSnapshots:360};
  const S = {enabled:false,running:false,busy:false,again:false,controller:null,timer:null,
    generation:0,key:'',book:null,updated:0,error:'',chart:null,candle:null,canvas:null,
    observer:null,frame:0,intensity:.85,showHeat:true,showCandles:true,side:'both',
    snapshots:[],initialized:false,visibleScreen:true};
  const fmt=(v,d=2)=>Number.isFinite(Number(v))&&v!==null?Number(v).toLocaleString('en-US',{minimumFractionDigits:d,maximumFractionDigits:d}):'—';
  const digits=v=>Math.abs(v)>=100?2:Math.abs(v)>=1?4:Math.abs(v)>=.01?6:8;
  const price=v=>v==null?'—':fmt(v,digits(v));
  const node=(tag,cls,text)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=text;return e;};
  const special=s=>/^NCCO/i.test(String(s));
  function selection(){const symbol=$('symbol')?.value||'BTC-USDT',commodity=special(symbol);return {symbol,exchange:commodity?'bingx':($('exchange')?.value||'bingx').toLowerCase(),market:commodity?'perpetual':($('market')?.value||'perpetual').toLowerCase(),tf:$('interval')?.value||'15m'};}
  const key=s=>[s.exchange,s.market,s.symbol].join('|');
  function getChart(){const obj=window.CryptolexuzChart;const chart=obj?.chart||obj?.chartApi||window.clChart,candle=obj?.candle||obj?.candleSeries;return chart&&candle&&typeof candle.priceToCoordinate==='function'?{chart,candle}:null;}
  function settingsEnabled(){try{return JSON.parse(localStorage.getItem('cryptolexuz-chart-settings-v1')||'null')?.indicators?.liquidity===true;}catch{return false;}}
  function setStatus(message,failed=false){const e=$('clLiquidityOverlayStatus');if(e){e.textContent=message;e.style.color=failed?'#ff8398':'#b4c5e7';}}
  function styles(){if($('clLiquidityV16Styles'))return;const e=node('style');e.id='clLiquidityV16Styles';e.textContent=`
    #priceChartArea{position:relative!important;isolation:isolate}
    #clLiquidityOverlayCanvas{position:absolute!important;z-index:3;pointer-events:none!important;background:transparent!important;max-width:none!important}
    #clLiquidityOverlayInfo{display:flex;flex-wrap:wrap;gap:9px;align-items:center;margin:8px 0;padding:10px;background:#10121e;border:1px solid #343b55;border-radius:10px;color:#cbd5f3;font:12px/1.5 system-ui}
    #clLiquidityOverlayInfo[hidden],#clLiquidityOverlayCanvas[hidden]{display:none!important}
    #clLiquidityOverlayInfo strong{color:#eee5ff}
    #clLiquidityOverlayInfo label{display:inline-flex;align-items:center;gap:5px}
    #clLiquidityOverlayInfo input[type=range]{accent-color:#bb52ff;width:95px}
    #clLiquidityOverlayInfo input[type=checkbox]{accent-color:#bb52ff}
    #clLiquidityOverlayInfo select{background:#1c2032;color:#fff;border:1px solid #42475f;border-radius:6px;padding:5px;max-width:140px}
    #clLiquidityOverlayStatus{flex-basis:100%;font-size:11px}
    #clLiquidityBook{margin-top:12px;padding:10px;background:#0b0e18;border:1px solid #343b55;border-radius:12px;color:#e7ecff}
    .cl-lq-columns,.cl-lq-row{display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;padding:6px 4px;font:11px system-ui;font-variant-numeric:tabular-nums}
    .cl-lq-columns{color:#aab7d4}.cl-lq-row{position:relative;border-radius:5px;overflow:hidden}
    .cl-lq-row span{z-index:1;position:relative}.cl-lq-row span:not(:first-child),.cl-lq-columns span:not(:first-child){text-align:right}
    .cl-lq-bar{position:absolute;inset:0 auto 0 0;opacity:.2;z-index:0}
    .cl-lq-row.ask{color:#ff9bb0}.cl-lq-row.bid{color:#77ffd0}
    .cl-lq-row.ask .cl-lq-bar{background:#ff476c}.cl-lq-row.bid .cl-lq-bar{background:#00f5a0}
    .cl-lq-note{font:11px/1.55 system-ui;color:#aab7d4;margin:7px 0}
    .cl-lq-split{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px}.cl-lq-split>div{min-width:0}.cl-lq-split h4{margin:5px 0;font:700 12px system-ui}
    @media(max-width:370px){.cl-lq-split{grid-template-columns:1fr}}
  `;document.head.append(e);}
  function control(label,input){const l=node('label');l.append(document.createTextNode(label+' '),input);return l;}
  function build(){const area=$('priceChartArea'),bookSection=$('orderbookSection');if(!area||!bookSection)return false;styles();
    let canvas=$('clLiquidityOverlayCanvas');if(!canvas){canvas=node('canvas');canvas.id='clLiquidityOverlayCanvas';canvas.setAttribute('aria-hidden','true');area.append(canvas);}S.canvas=canvas;
    let info=$('clLiquidityOverlayInfo');if(!info){info=node('div');info.id='clLiquidityOverlayInfo';
      info.append(node('strong','','🌡️ Mapa de calor · Bookmap'));
      const heat=node('input');heat.type='checkbox';heat.checked=S.showHeat;heat.addEventListener('change',()=>{S.showHeat=heat.checked;redraw();});info.append(control('Mapa de calor',heat));
      const candle=node('input');candle.type='checkbox';candle.checked=S.showCandles;candle.addEventListener('change',()=>{S.showCandles=candle.checked;redraw();});info.append(control('Velas',candle));
      const slider=node('input');slider.type='range';slider.min='10';slider.max='100';slider.step='5';slider.value=String(Math.round(S.intensity*100));slider.id='clLiquidityOverlayIntensity';
      const value=node('span','',slider.value+'%');slider.addEventListener('input',()=>{S.intensity=Number(slider.value)/100;value.textContent=slider.value+'%';redraw();});const intensity=control('Intensidad',slider);intensity.append(value);info.append(intensity);
      const select=node('select');for(const [v,t] of [['both','Compras y ventas'],['buy','Solo compras'],['sell','Solo ventas']]){const o=node('option','',t);o.value=v;select.append(o);}select.value=S.side;select.addEventListener('change',()=>{S.side=select.value;redraw();});info.append(control('Mostrar órdenes',select));
      const status=node('span');status.id='clLiquidityOverlayStatus';info.append(status);area.parentNode.insertBefore(info,area.nextSibling);
    }
    let root=$('clLiquidityBook');if(!root){root=node('div');root.id='clLiquidityBook';bookSection.append(root);}root.replaceChildren();root.append(node('h3','','📚 Libro de órdenes · diez niveles por lado'));
    const split=node('div','cl-lq-split');for(const [side,title] of [['asks','Ventas · ASK'],['bids','Compras · BID']]){const col=node('div');col.append(node('h4','',title));const headings=node('div','cl-lq-columns');for(const h of ['Precio','Cantidad','USDT'])headings.append(node('span','',h));const host=node('div');host.id='clLq'+side;host.textContent='Esperando órdenes...';col.append(headings,host);split.append(col);}root.append(split);
    const summary=node('p','cl-lq-note','Esperando profundidad real...');summary.id='clLiquidityBookSummary';root.append(summary,node('p','cl-lq-note','Las franjas se construyen con órdenes visibles del libro real. Su historial comienza al activar Liquidez y no representa liquidaciones.'));
    const standalone=$('liquidityMap');if(standalone)standalone.replaceChildren(node('p','cl-lq-note','Activa Liquidez en Indicadores para superponer el mapa de calor sobre las velas japonesas.'));
    const toggle=$('liquidityMapToggle');if(toggle){toggle.disabled=false;toggle.checked=S.enabled;}updateVisibility();return true;
  }
  function parseSide(data){if(!Array.isArray(data))return [];return data.map(v=>({price:Number(Array.isArray(v)?v[0]:v?.price??v?.px??v?.p),quantity:Number(Array.isArray(v)?v[1]:v?.quantity??v?.qty??v?.size??v?.sz??v?.amount??v?.q)})).filter(v=>Number.isFinite(v.price)&&v.price>0&&Number.isFinite(v.quantity)&&v.quantity>0);}
  function normalize(raw){if(raw?.code!==undefined&&![0,'0','00000'].includes(raw.code))throw Error('API '+raw.code);let d=raw;for(let i=0;i<6;i++){if(d?.bids||d?.asks||d?.b||d?.a)break;d=d?.data;if(Array.isArray(d))d=d[0];}const bids=parseSide(d?.bids??d?.b).sort((a,b)=>b.price-a.price).slice(0,CFG.depth),asks=parseSide(d?.asks??d?.a).sort((a,b)=>a.price-b.price).slice(0,CFG.depth);if(!bids.length||!asks.length)throw Error('Libro de órdenes vacío');if(bids[0].price>=asks[0].price)throw Error('Bid/ask inconsistentes');return {bids,asks,mid:(bids[0].price+asks[0].price)/2};}
  function url(s){return '/api/exchange/'+encodeURIComponent(s.exchange)+'/depth/'+encodeURIComponent(s.symbol)+'?market='+encodeURIComponent(s.market)+'&limit='+CFG.depth;}
  const sum=orders=>orders.reduce((a,o)=>a+o.price*o.quantity,0);
  const largest=orders=>orders.reduce((a,b)=>!a||b.price*b.quantity>a.price*a.quantity?b:a,null);
  function renderSide(id,orders,kind){const root=$(id);if(!root)return;root.replaceChildren();const data=orders.slice(0,CFG.levels),max=Math.max(1,...data.map(o=>o.price*o.quantity));for(const o of data){const row=node('div','cl-lq-row '+kind),bar=node('div','cl-lq-bar');bar.style.width=(100*o.price*o.quantity/max)+'%';row.append(bar);for(const t of [price(o.price),fmt(o.quantity,4),fmt(o.price*o.quantity,0)])row.append(node('span','',t));root.append(row);}}
  function renderBook(book){renderSide('clLqasks',book.asks,'ask');renderSide('clLqbids',book.bids,'bid');const bid=book.bids[0].price,ask=book.asks[0].price;if($('bid'))$('bid').textContent=price(bid);if($('ask'))$('ask').textContent=price(ask);const buys=book.bids.slice(0,CFG.levels),sells=book.asks.slice(0,CFG.levels),b=sum(buys),a=sum(sells),total=b+a,target=$('clLiquidityBookSummary');if(target)target.textContent='Bid '+price(bid)+' · Ask '+price(ask)+' · Spread '+price(ask-bid)+' ('+fmt((ask-bid)/book.mid*100,4)+'%). Compras visibles: '+fmt(b,0)+' USDT ('+fmt(total?b/total*100:0,1)+'%). Ventas visibles: '+fmt(a,0)+' USDT ('+fmt(total?a/total*100:0,1)+'%). Mayor compra: '+price(largest(buys)?.price)+'. Mayor venta: '+price(largest(sells)?.price)+'.';}
  function updateVisibility(){if(S.canvas)S.canvas.hidden=!S.enabled;const info=$('clLiquidityOverlayInfo');if(info)info.hidden=!S.enabled;const toggle=$('liquidityMapToggle');if(toggle)toggle.checked=S.enabled;}
  function clear(){if(!S.canvas)return;const ctx=S.canvas.getContext('2d');if(ctx){ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,S.canvas.width,S.canvas.height);}}
  function redraw(){if(S.frame)return;S.frame=requestAnimationFrame(()=>{S.frame=0;draw();});}
  function snapshot(book){const t=Date.now();S.snapshots.push({at:t,bids:book.bids.map(o=>[o.price,o.price*o.quantity]),asks:book.asks.map(o=>[o.price,o.price*o.quantity])});if(S.snapshots.length>CFG.maxSnapshots)S.snapshots.splice(0,S.snapshots.length-CFG.maxSnapshots);}
  // Solo dibujar la profundidad sobre el área de precios. Las velas son las
  // de Lightweight Charts y permanecen visibles a través del calor translúcido.
  function draw(){const canvas=S.canvas,api=getChart(),element=$('chart');if(!canvas||!element||!api||!S.enabled){clear();return;}
    const rect=element.getBoundingClientRect(),area=$('priceChartArea')?.getBoundingClientRect();if(!area||rect.width<80||rect.height<80)return;
    const w=rect.width,h=rect.height,dpr=Math.min(window.devicePixelRatio||1,2);canvas.style.left=(rect.left-area.left)+'px';canvas.style.top=(rect.top-area.top)+'px';canvas.style.width=w+'px';canvas.style.height=h+'px';const pw=Math.round(w*dpr),ph=Math.round(h*dpr);if(canvas.width!==pw||canvas.height!==ph){canvas.width=pw;canvas.height=ph;}
    const ctx=canvas.getContext('2d');if(!ctx)return;ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,w,h);
    const plotW=Math.max(0,Math.min(w-55,api.chart.timeScale().width?.()||w-70)),plotH=h-25;if(plotW<30||plotH<30)return;
    if(!S.book){setStatus('Esperando profundidad real...');return;}
    const priceToY=p=>api.candle.priceToCoordinate(p),step=Math.max(5,Math.min(11,Math.round(plotH/65))),bins=Math.ceil(plotH/step);
    const current=S.snapshots.at(-1);if(!current)return;
    // Mapa temporal: solo se colorean instantes realmente observados.
    // Antes de activar el módulo NO existe historial de órdenes.
    const totals=[];for(const snap of S.snapshots)for(const arr of [snap.bids,snap.asks])for(const [,amount] of arr)totals.push(amount);
    totals.sort((a,b)=>a-b);
    const ref=Math.max(1,totals[Math.floor((totals.length-1)*.92)]||1);
    const den=Math.log1p(ref);
    const heatBins=snap=>{
      const buy=new Float64Array(bins),sell=new Float64Array(bins);
      for(const [arr,target] of [[snap.bids,buy],[snap.asks,sell]])for(const [p,amount] of arr){
        const y=priceToY(p);
        if(!Number.isFinite(y)||y<0||y>=plotH)continue;
        target[Math.min(bins-1,Math.floor(y/step))]+=amount;
      }
      return {buy,sell};
    };
    const paint=(snap,x,width,opacity=1)=>{
      if(width<=0)return;
      const {buy,sell}=heatBins(snap);
      for(let i=0;i<bins;i++){
        const b=buy[i],a=sell[i];
        if(!b&&!a)continue;
        if((S.side==='buy'&&!b)||(S.side==='sell'&&!a))continue;
        const amount=S.side==='buy'?b:S.side==='sell'?a:b+a;
        const strength=Math.min(1,Math.log1p(amount)/den);
        const buyer=S.side==='buy'||(S.side==='both'&&b>=a);
        const base=buyer?'0,245,160':'255,71,108';
        const hot=buyer?'255,215,65':'255,146,60';
        const alpha=Math.min(.55,S.intensity*(.10+.44*strength)*opacity);
        ctx.fillStyle='rgba('+base+','+alpha.toFixed(3)+')';
        ctx.fillRect(x,i*step,width+.7,step+.7);
        if(strength>.55){
          ctx.fillStyle='rgba('+hot+','+(alpha*.48*strength).toFixed(3)+')';
          ctx.fillRect(x,i*step+step*.28,width+.7,Math.max(1,step*.42));
        }
      }
    };
    ctx.save();ctx.beginPath();ctx.rect(0,0,plotW,plotH);ctx.clip();
    if(S.showHeat){
      // En el inicio, mostrar el libro actual sobre el gráfico para que las
      // bandas sean visibles. Cuando haya historial, los tramos se dibujan
      // únicamente desde el momento de captura, no sobre velas anteriores.
      const history=S.snapshots;
      if(history.length<2){
        paint(current,0,plotW,.90);
      }else{
        // Capa tenue del libro actual: referencia instantánea, no historial.
        paint(current,0,plotW,.20);
        const first=history[0].at,last=history[history.length-1].at;
        const observedMs=Math.max(1,last-first);
        const maxWindow=Math.max(300000,observedMs);
        const widthPerMs=plotW/maxWindow;
        const left=plotW-observedMs*widthPerMs;
        for(let j=0;j<history.length;j++){
          const snap=history[j],next=history[j+1];
          const x=left+(snap.at-first)*widthPerMs;
          const right=next?left+(next.at-first)*widthPerMs:plotW;
          paint(snap,Math.max(0,x),Math.max(1,Math.min(plotW,right)-Math.max(0,x)),1);
        }
      }
    }
    if(S.showCandles){
      // Reforzar contornos de velas reales para que el mapa no las oculte.
      const rows=window.CryptolexuzChart?.getRows?.()||[];const ts=api.chart.timeScale();
      for(const c of rows){const x=ts.timeToCoordinate(c.time);if(!Number.isFinite(x)||x<0||x>plotW)continue;const yo=priceToY(c.open),yc=priceToY(c.close),yh=priceToY(c.high),yl=priceToY(c.low);if(![yo,yc,yh,yl].every(Number.isFinite))continue;const color=c.close>=c.open?'rgba(0,245,160,.9)':'rgba(255,71,108,.9)';ctx.strokeStyle=color;ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(x,yh);ctx.lineTo(x,yl);ctx.stroke();ctx.strokeRect(x-2.5,Math.min(yo,yc),5,Math.max(1,Math.abs(yo-yc)));}
    }
    ctx.restore();setStatus('Mapa de calor sobre velas · '+S.snapshots.length+' capturas guardadas · '+new Date(S.updated).toLocaleTimeString('es-MX')+' · '+selection().tf);
  }
  async function refresh(){if(!S.running||document.hidden)return;if(S.busy){S.again=true;return;}const selected=selection(),k=key(selected);if(k!==S.key){S.key=k;S.generation++;S.book=null;S.snapshots=[];clear();}const generation=S.generation,controller=new AbortController();S.controller=controller;S.busy=true;const timeout=setTimeout(()=>controller.abort(),CFG.timeout);
    try{setStatus('Consultando profundidad real...');const response=await fetch(url(selected),{signal:controller.signal,cache:'no-store'});if(!response.ok)throw Error('HTTP '+response.status);const book=normalize(await response.json());if(!S.running||generation!==S.generation||k!==key(selection())||controller.signal.aborted)return;S.book=book;S.updated=Date.now();S.error='';snapshot(book);renderBook(book);redraw();}
    catch(e){if(!S.running||generation!==S.generation)return;S.error=controller.signal.aborted?'Tiempo de espera agotado':String(e.message||e);setStatus('Sin profundidad: '+S.error,true);if(!S.book)clear();console.warn('CRYPTOLEXUZ Liquidez V17:',e);}
    finally{clearTimeout(timeout);if(S.controller===controller)S.controller=null;S.busy=false;if(S.again&&S.running&&!document.hidden){S.again=false;queueMicrotask(refresh);}}
  }
  function start(){if(S.running)return;S.running=true;S.key=key(selection());refresh();S.timer=setInterval(refresh,CFG.refresh);}
  function stop(){S.running=false;S.generation++;S.again=false;if(S.timer){clearInterval(S.timer);S.timer=null;}S.controller?.abort();S.controller=null;clear();}
  function restart(){S.generation++;S.key=key(selection());S.book=null;S.snapshots=[];clear();S.controller?.abort();if(S.running){if(S.busy)S.again=true;else refresh();}}
  function setEnabled(value){S.enabled=Boolean(value);updateVisibility();if(S.enabled){start();redraw();}else stop();}
  function syncFromApp(event){const next=event?.detail?.settings?.indicators?.liquidity;setEnabled(typeof next==='boolean'?next:settingsEnabled());}
  function bindChart(){const c=getChart();if(!c)return false;if(S.chart===c.chart&&S.candle===c.candle)return true;S.chart=c.chart;S.candle=c.candle;try{c.chart.timeScale().subscribeVisibleLogicalRangeChange(redraw);}catch{}try{c.chart.timeScale().subscribeVisibleTimeRangeChange(redraw);}catch{}return true;}
  function init(){if(S.initialized)return;if(!build())return;S.initialized=true;bindChart();S.enabled=settingsEnabled();updateVisibility();if(S.enabled)start();
    window.addEventListener('cryptolexuz:chart-ready',()=>{bindChart();redraw();});window.addEventListener('cryptolexuz:candles-updated',()=>{bindChart();redraw();});window.addEventListener('cryptolexuz:indicator-state-updated',syncFromApp);window.addEventListener('cryptolexuz:indicator-settings-change',syncFromApp);window.addEventListener('cryptolexuz:screen-change',redraw);
    for(const id of ['symbol','exchange','market'])$(id)?.addEventListener('change',restart);$('interval')?.addEventListener('change',()=>{setStatus('Temporalidad: '+selection().tf);redraw();});
    $('liquidityMapToggle')?.addEventListener('change',e=>{if(window.CryptolexuzApp?.setIndicator)window.CryptolexuzApp.setIndicator('liquidity',e.target.checked);else setEnabled(e.target.checked);});
    if(window.ResizeObserver){S.observer=new ResizeObserver(redraw);S.observer.observe($('chart'));S.observer.observe($('priceChartArea'));}window.addEventListener('resize',redraw);document.addEventListener('visibilitychange',()=>{if(!document.hidden&&S.running){refresh();redraw();}});window.addEventListener('beforeunload',()=>{stop();S.observer?.disconnect();});console.info('CRYPTOLEXUZ PRO — LIQUIDITY.JS V17 iniciado');
  }
  window.CryptolexuzLiquidity={version:'17',start,stop,restart,refresh,redraw,setEnabled,isRunning:()=>S.running,getSelection:selection,getBook:()=>S.book?JSON.parse(JSON.stringify(S.book)):null,getSnapshots:()=>S.snapshots.map(x=>({at:x.at,bids:x.bids.length,asks:x.asks.length})),getStatus:()=>({enabled:S.enabled,running:S.running,busy:S.busy,market:S.key,lastUpdated:S.updated,lastError:S.error,snapshots:S.snapshots.length})};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
