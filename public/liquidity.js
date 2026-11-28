/*
 CRYPTOLEXUZ PRO — LIQUIDITY.JS V24 COMPLETO
 Mapa de calor tipo Bookmap: velas por encima del calor y escala original por defecto.
 Profundidad REAL de Bybit WebSocket con respaldo REST; historial únicamente
 desde que se activa la conexión en el servidor. No son liquidaciones.
 Compatible con Lightweight Charts 4.2.2 e index.html V38+.
*/
'use strict';
(() => {
  if (window.__CL_LIQUIDITY_V24__) return;
  window.__CL_LIQUIDITY_V24__ = true;
  const $ = id => document.getElementById(id);
  const CFG = {refresh:5000,timeout:10000,depth:500,levels:10,maxSnapshots:900};
  const S = {enabled:false,running:false,busy:false,again:false,controller:null,timer:null,
    generation:0,key:'',book:null,updated:0,error:'',chart:null,candle:null,canvas:null,
    observer:null,frame:0,intensity:.85,showHeat:true,showCandles:true,detail:false,side:'both',
    snapshots:[],initialized:false,visibleScreen:true,depthSocket:null,depthToken:0,depthReconnect:null,depthConnected:false,source:'',lastDepthAt:0};
  const fmt=(v,d=2)=>Number.isFinite(Number(v))&&v!==null?Number(v).toLocaleString('en-US',{minimumFractionDigits:d,maximumFractionDigits:d}):'—';
  const digits=v=>Math.abs(v)>=100?2:Math.abs(v)>=1?4:Math.abs(v)>=.01?6:8;
  const price=v=>v==null?'—':fmt(v,digits(v));
  const node=(tag,cls,text)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=text;return e;};
  const special=s=>/^NCCO/i.test(String(s));
  function selection(){const symbol=$('symbol')?.value||'BTC-USDT',commodity=special(symbol);return {symbol,exchange:commodity?'bingx':($('exchange')?.value||'bingx').toLowerCase(),market:commodity?'perpetual':($('market')?.value||'perpetual').toLowerCase(),tf:$('interval')?.value||'15m'};}
  const key=s=>[s.exchange,s.market,s.symbol].join('|');
  const depthKey=s=>['bybit',s.market,s.symbol].join('|');
  const bybitSupported=s=>!special(s.symbol)&&/^[A-Z0-9]+-USDT$/.test(s.symbol);
  function getChart(){const obj=window.CryptolexuzChart;const chart=obj?.chart||obj?.chartApi||window.clChart,candle=obj?.candle||obj?.candleSeries;return chart&&candle&&typeof candle.priceToCoordinate==='function'?{chart,candle}:null;}
  function settingsEnabled(){try{return JSON.parse(localStorage.getItem('cryptolexuz-chart-settings-v1')||'null')?.indicators?.liquidity===true;}catch{return false;}}
  function setStatus(message,failed=false){const e=$('clLiquidityOverlayStatus');if(e){e.textContent=message;e.style.color=failed?'#ff8398':'#b4c5e7';}}
  function styles(){if($('clLiquidityV24Styles'))return;const e=node('style');e.id='clLiquidityV24Styles';e.textContent=`
    #priceChartArea{position:relative!important;isolation:isolate}
    #clLiquidityOverlayCanvas{position:absolute!important;z-index:3;pointer-events:none!important;background:transparent!important;max-width:none!important}
    #clLiquidityDepthPanel{display:none!important}
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
      info.append(node('strong','','🌡️ Mapa de calor integrado'));
      const heat=node('input');heat.type='checkbox';heat.checked=S.showHeat;heat.addEventListener('change',()=>{S.showHeat=heat.checked;redraw();});info.append(control('Mapa de calor',heat));
      const candle=node('input');candle.type='checkbox';candle.checked=S.showCandles;candle.addEventListener('change',()=>{S.showCandles=candle.checked;redraw();});info.append(control('Resaltar velas',candle));
      const slider=node('input');slider.type='range';slider.min='10';slider.max='100';slider.step='5';slider.value=String(Math.round(S.intensity*100));slider.id='clLiquidityOverlayIntensity';
      const value=node('span','',slider.value+'%');slider.addEventListener('input',()=>{S.intensity=Number(slider.value)/100;value.textContent=slider.value+'%';redraw();});const intensity=control('Intensidad',slider);intensity.append(value);info.append(intensity);
      const detail=node('input');detail.type='checkbox';detail.checked=false;detail.id='clLiquidityDetailMode';detail.addEventListener('change',()=>{S.detail=detail.checked;redraw();});info.append(control('Zoom del libro (vista independiente)',detail));
      const select=node('select');for(const [v,t] of [['both','Compras y ventas'],['buy','Solo compras'],['sell','Solo ventas']]){const o=node('option','',t);o.value=v;select.append(o);}select.value=S.side;select.addEventListener('change',()=>{S.side=select.value;redraw();});info.append(control('Mostrar órdenes',select));
      const status=node('span');status.id='clLiquidityOverlayStatus';info.append(status);area.parentNode.insertBefore(info,area.nextSibling);
    }
    // Eliminar el panel ampliado de versiones anteriores, si quedó en el DOM.
    $('clLiquidityDepthPanel')?.remove();$('clLiquidityDepthCanvas')?.remove();
    let root=$('clLiquidityBook');if(!root){root=node('div');root.id='clLiquidityBook';bookSection.append(root);}root.replaceChildren();root.append(node('h3','','📚 Libro de órdenes · diez niveles por lado'));
    const split=node('div','cl-lq-split');for(const [side,title] of [['asks','Ventas · ASK'],['bids','Compras · BID']]){const col=node('div');col.append(node('h4','',title));const headings=node('div','cl-lq-columns');for(const h of ['Precio','Cantidad','USDT'])headings.append(node('span','',h));const host=node('div');host.id='clLq'+side;host.textContent='Esperando órdenes...';col.append(headings,host);split.append(col);}root.append(split);
    const summary=node('p','cl-lq-note','Esperando profundidad real...');summary.id='clLiquidityBookSummary';root.append(summary,node('p','cl-lq-note','Las franjas sobre las velas comienzan cuando se activa el registro; no hay historial anterior. La profundidad disponible puede abarcar solo unos pocos dólares. No son liquidaciones.'));
    const standalone=$('liquidityMap');if(standalone)standalone.replaceChildren(node('p','cl-lq-note','Activa Liquidez en Indicadores para superponer el mapa de calor sobre las velas japonesas.'));
    const toggle=$('liquidityMapToggle');if(toggle){toggle.disabled=false;toggle.checked=S.enabled;}updateVisibility();return true;
  }
  function parseSide(data){if(!Array.isArray(data))return [];return data.map(v=>({price:Number(Array.isArray(v)?v[0]:v?.price??v?.px??v?.p),quantity:Number(Array.isArray(v)?v[1]:v?.quantity??v?.qty??v?.size??v?.sz??v?.amount??v?.q)})).filter(v=>Number.isFinite(v.price)&&v.price>0&&Number.isFinite(v.quantity)&&v.quantity>0);}
  function normalize(raw){if(raw?.code!==undefined&&![0,'0','00000'].includes(raw.code))throw Error('API '+raw.code);let d=raw;for(let i=0;i<6;i++){if(d?.bids||d?.asks||d?.b||d?.a)break;d=d?.data;if(Array.isArray(d))d=d[0];}const bids=parseSide(d?.bids??d?.b).sort((a,b)=>b.price-a.price).slice(0,CFG.depth),asks=parseSide(d?.asks??d?.a).sort((a,b)=>a.price-b.price).slice(0,CFG.depth);if(!bids.length||!asks.length)throw Error('Libro de órdenes vacío');if(bids[0].price>=asks[0].price)throw Error('Bid/ask inconsistentes');return {bids,asks,mid:(bids[0].price+asks[0].price)/2};}
  function url(s){return '/api/exchange/'+encodeURIComponent(bybitSupported(s)?'bybit':s.exchange)+'/depth/'+encodeURIComponent(s.symbol)+'?market='+encodeURIComponent(s.market)+'&limit='+CFG.depth;}
  const sum=orders=>orders.reduce((a,o)=>a+o.price*o.quantity,0);
  const largest=orders=>orders.reduce((a,b)=>!a||b.price*b.quantity>a.price*a.quantity?b:a,null);
  function renderSide(id,orders,kind){const root=$(id);if(!root)return;root.replaceChildren();const data=orders.slice(0,CFG.levels),max=Math.max(1,...data.map(o=>o.price*o.quantity));for(const o of data){const row=node('div','cl-lq-row '+kind),bar=node('div','cl-lq-bar');bar.style.width=(100*o.price*o.quantity/max)+'%';row.append(bar);for(const t of [price(o.price),fmt(o.quantity,4),fmt(o.price*o.quantity,0)])row.append(node('span','',t));root.append(row);}}
  function renderBook(book){renderSide('clLqasks',book.asks,'ask');renderSide('clLqbids',book.bids,'bid');const bid=book.bids[0].price,ask=book.asks[0].price;if(selection().exchange==='bybit'){if($('bid'))$('bid').textContent=price(bid);if($('ask'))$('ask').textContent=price(ask);}const buys=book.bids.slice(0,CFG.levels),sells=book.asks.slice(0,CFG.levels),b=sum(buys),a=sum(sells),total=b+a,target=$('clLiquidityBookSummary');if(target)target.textContent='Bid '+price(bid)+' · Ask '+price(ask)+' · Spread '+price(ask-bid)+' ('+fmt((ask-bid)/book.mid*100,4)+'%). Compras visibles: '+fmt(b,0)+' USDT ('+fmt(total?b/total*100:0,1)+'%). Ventas visibles: '+fmt(a,0)+' USDT ('+fmt(total?a/total*100:0,1)+'%). Mayor compra: '+price(largest(buys)?.price)+'. Mayor venta: '+price(largest(sells)?.price)+'.';}
  function updateVisibility(){if(S.canvas)S.canvas.hidden=!S.enabled;const info=$('clLiquidityOverlayInfo');if(info)info.hidden=!S.enabled;$('clLiquidityDepthPanel')?.remove();$('clLiquidityDepthCanvas')?.remove();const toggle=$('liquidityMapToggle');if(toggle)toggle.checked=S.enabled;}
  function clear(){if(!S.canvas)return;const ctx=S.canvas.getContext('2d');if(ctx){ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,S.canvas.width,S.canvas.height);}}
  function redraw(){if(S.frame)return;S.frame=requestAnimationFrame(()=>{S.frame=0;draw();});}
  function snapshot(book,at=Date.now()){
    const t=Number(at)||Date.now();
    if(S.snapshots.length&&t<=S.snapshots[S.snapshots.length-1].at)return;
    S.snapshots.push({at:t,bids:book.bids.map(o=>[o.price,o.price*o.quantity]),asks:book.asks.map(o=>[o.price,o.price*o.quantity])});
    if(S.snapshots.length>CFG.maxSnapshots)S.snapshots.splice(0,S.snapshots.length-CFG.maxSnapshots);
  }
  function draw(){
    const canvas=S.canvas,api=getChart(),element=$('chart');
    if(!canvas||!element||!api||!S.enabled){clear();return;}
    const rect=element.getBoundingClientRect(),area=$('priceChartArea')?.getBoundingClientRect();
    if(!area||rect.width<80||rect.height<80)return;
    const w=rect.width,h=rect.height,dpr=Math.min(window.devicePixelRatio||1,2);
    canvas.style.left=(rect.left-area.left)+'px';canvas.style.top=(rect.top-area.top)+'px';
    canvas.style.width=w+'px';canvas.style.height=h+'px';
    const pw=Math.round(w*dpr),ph=Math.round(h*dpr);
    if(canvas.width!==pw||canvas.height!==ph){canvas.width=pw;canvas.height=ph;}
    const ctx=canvas.getContext('2d');if(!ctx)return;
    ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,w,h);
    const plotW=Math.max(0,Math.min(w-55,api.chart.timeScale().width?.()||w-70));
    const plotH=h-25;if(plotW<50||plotH<40)return;
    if(!S.book){setStatus('Esperando profundidad real de Bybit...');return;}
    // Modo detalle: escala independiente calculada SOLO con precios recibidos.
    // No modifica la escala original de Lightweight Charts; desactivarlo la restaura al instante.
    const prices=[...S.book.bids,...S.book.asks].map(o=>o.price).filter(Number.isFinite);
    const low=Math.min(...prices),high=Math.max(...prices);
    const mid=S.book.mid;
    const half=Math.max((high-low)*.58,mid*.00015);
    const bottom=mid-half,top=mid+half;
    const priceToY=S.detail?(p=>(top-p)/(top-bottom)*(h-25)):(p=>api.candle.priceToCoordinate(p));
    const midY=priceToY(S.book.mid);
    const profileW=Math.min(46,Math.max(30,plotW*.12));
    const heatW=plotW-profileW-3;
    const step=Math.max(3,Math.min(6,Math.round(plotH/105)));
    const bins=Math.ceil(plotH/step);
    const history=S.snapshots;
    const refValues=[];
    for(const snap of history)for(const side of [snap.bids,snap.asks])for(const [,amount] of side)if(amount>0)refValues.push(amount);
    refValues.sort((a,b)=>a-b);
    const ref=Math.max(1,refValues[Math.floor((refValues.length-1)*.96)]||1);
    const logRef=Math.log1p(ref);
    function makeBins(snap){
      const buy=new Float64Array(bins),sell=new Float64Array(bins);
      for(const [levels,target] of [[snap.bids,buy],[snap.asks,sell]])for(const [p,amount] of levels){
        const y=priceToY(p);
        if(Number.isFinite(y)&&y>=0&&y<plotH)target[Math.min(bins-1,Math.floor(y/step))]+=amount;
      }
      return {buy,sell};
    }
    function paint(snap,x,width){
      if(width<=0)return;
      const {buy,sell}=makeBins(snap);
      for(let i=0;i<bins;i++){
        const b=buy[i],a=sell[i];
        if(S.side==='buy'&&!b||S.side==='sell'&&!a||!b&&!a)continue;
        const amount=S.side==='buy'?b:S.side==='sell'?a:b+a;
        const strength=Math.min(1,Math.log1p(amount)/logRef);
        const buyer=S.side==='buy'||(S.side==='both'&&b>=a);
        // Bandas de órdenes reales: color y brillo en función de notional observado.
        const alpha=S.intensity*(.035+.27*strength);
        const rgb=buyer?(strength>.72?'235,255,62':strength>.42?'0,233,150':'12,109,130'):(strength>.72?'255,224,75':strength>.42?'255,113,43':'155,36,55');
        ctx.fillStyle='rgba('+rgb+','+alpha.toFixed(3)+')';
        ctx.fillRect(x,i*step,width+.8,step+.5);
      }
    }
    if(S.detail){
      // Ocultar el dibujo del chart subyacente sin tocar el estado de app.js.
      ctx.fillStyle='rgba(7,11,19,.92)';ctx.fillRect(0,0,plotW,plotH);
      ctx.strokeStyle='rgba(129,155,184,.14)';ctx.lineWidth=1;
      ctx.fillStyle='rgba(202,216,235,.82)';ctx.font='10px system-ui';
      for(let i=0;i<=6;i++){
        const yy=i*plotH/6,pp=top-(top-bottom)*i/6;
        ctx.beginPath();ctx.moveTo(0,yy);ctx.lineTo(plotW,yy);ctx.stroke();
        ctx.fillText(price(pp),Math.max(0,plotW-82),Math.max(11,yy-3));
      }
    }
    ctx.save();ctx.beginPath();ctx.rect(0,0,heatW,plotH);ctx.clip();
    if(S.showHeat&&Number.isFinite(midY)){
      // Gradiente ambiental, NO datos de profundidad ni órdenes inventadas.
      const y=Math.max(0,Math.min(plotH,midY));
      const red=ctx.createLinearGradient(0,0,0,Math.max(1,y));
      red.addColorStop(0,'rgba(91,19,33,'+(S.intensity*.20)+')');
      red.addColorStop(1,'rgba(58,13,29,'+(S.intensity*.09)+')');
      ctx.fillStyle=red;ctx.fillRect(0,0,heatW,y);
      const blue=ctx.createLinearGradient(0,y,0,Math.max(y+1,plotH));
      blue.addColorStop(0,'rgba(10,35,95,'+(S.intensity*.11)+')');
      blue.addColorStop(1,'rgba(15,44,110,'+(S.intensity*.25)+')');
      ctx.fillStyle=blue;ctx.fillRect(0,y,heatW,plotH-y);
    }
    if(S.showHeat&&history.length){
      const scale=api.chart.timeScale();
      const secs={'1m':60,'3m':180,'5m':300,'15m':900,'30m':1800,'1h':3600,'2h':7200,'4h':14400,'6h':21600,'8h':28800,'12h':43200,'1d':86400,'3d':259200,'1w':604800,'1M':2592000};
      const duration=secs[selection().tf]||900;
      const rows=window.CryptolexuzChart?.getRows?.()||[];
      const last=rows.at(-1),previous=rows.at(-2);
      const currentX=last?scale.timeToCoordinate(last.time):null;
      const previousX=previous?scale.timeToCoordinate(previous.time):null;
      const spacing=Number.isFinite(currentX)&&Number.isFinite(previousX)?Math.abs(currentX-previousX):Math.max(4,heatW/60);
      const firstAt=history[0]?.at||Date.now();
      const endAt=Date.now();
      const spanMs=Math.max(120000,endAt-firstAt);
      const observedX=ms=>S.detail?heatW-(endAt-ms)/spanMs*heatW:(!last||!Number.isFinite(currentX)?heatW-5:currentX+(ms/1000-last.time)/duration*spacing);
      for(let j=0;j<history.length;j++){
        const snap=history[j],next=history[j+1];
        const left=Math.max(0,Math.min(heatW,observedX(snap.at)));
        const right=Math.max(0,Math.min(heatW,next?observedX(next.at):observedX(Date.now())));
        if(right>left)paint(snap,left,right-left);
      }
      // El perfil actual se dibuja por separado: nunca se extiende falsamente al pasado.
    }
    if(S.showCandles){
      const rows=window.CryptolexuzChart?.getRows?.()||[],scale=api.chart.timeScale();
      for(const c of rows){
        const x=S.detail?heatW-(Date.now()-c.time*1000)/Math.max(120000,Date.now()-(history[0]?.at||Date.now()))*heatW:scale.timeToCoordinate(c.time);
        if(!Number.isFinite(x)||x<0||x>heatW)continue;
        const yo=priceToY(c.open),yc=priceToY(c.close),yh=priceToY(c.high),yl=priceToY(c.low);
        if(![yo,yc,yh,yl].every(Number.isFinite))continue;
        const up=c.close>=c.open,color=up?'rgba(0,255,163,.98)':'rgba(255,69,107,.98)';
        ctx.strokeStyle=color;ctx.lineWidth=2;
        ctx.beginPath();ctx.moveTo(x,yh);ctx.lineTo(x,yl);ctx.stroke();
        ctx.fillStyle=color;const candleWidth=S.detail?5:Math.max(3,Math.min(11,Math.abs((scale.timeToCoordinate(rows[1]?.time)||0)-(scale.timeToCoordinate(rows[0]?.time)||0))*.65||5));ctx.fillRect(x-candleWidth/2,Math.min(yo,yc),candleWidth,Math.max(2,Math.abs(yo-yc)));
      }
    }
    ctx.restore();
    // Perfil derecho: órdenes visibles AHORA, no órdenes históricas ni ejecuciones.
    if(S.showHeat){
      const x0=heatW+3;
      ctx.fillStyle='rgba(4,8,21,.80)';ctx.fillRect(x0,0,profileW,plotH);
      ctx.strokeStyle='rgba(157,175,208,.26)';ctx.beginPath();ctx.moveTo(x0,0);ctx.lineTo(x0,plotH);ctx.stroke();
      const snap=history.at(-1);if(snap){
        const {buy,sell}=makeBins(snap);
        const max=Math.max(1,...buy,...sell);
        for(let i=0;i<bins;i++){
          const b=buy[i],a=sell[i],y=i*step;
          if(b&&S.side!=='sell'){
            const bw=(profileW-4)*Math.sqrt(b/max);
            ctx.fillStyle='rgba(0,238,161,.86)';ctx.fillRect(x0+profileW-bw,y,bw,Math.max(1,step-1));
          }
          if(a&&S.side!=='buy'){
            const aw=(profileW-4)*Math.sqrt(a/max);
            ctx.fillStyle='rgba(255,86,103,.88)';ctx.fillRect(x0,y,aw,Math.max(1,step-1));
          }
        }
      }
      ctx.fillStyle='rgba(215,225,245,.85)';ctx.font='9px system-ui';ctx.fillText('BID / ASK',x0+3,11);
    }
    const visibleBuy=S.book.bids.filter(o=>{const y=priceToY(o.price);return Number.isFinite(y)&&y>=0&&y<plotH;}).length;
    const visibleSell=S.book.asks.filter(o=>{const y=priceToY(o.price);return Number.isFinite(y)&&y>=0&&y<plotH;}).length;
    setStatus((S.detail?'Zoom libro: velas solo si coinciden con el historial · ':'Velas en escala original · ')+(S.source||'REST')+' · '+history.length+' capturas · '+new Date(S.updated).toLocaleTimeString('es-MX')+' · '+visibleBuy+' compras / '+visibleSell+' ventas visibles · perfil lateral actual');
  }
  async function refresh(){if(!S.running||document.hidden)return;if(S.busy){S.again=true;return;}const selected=selection(),k=key(selected);if(k!==S.key){S.key=k;S.generation++;S.book=null;S.snapshots=[];clear();}const generation=S.generation,controller=new AbortController();S.controller=controller;S.busy=true;const timeout=setTimeout(()=>controller.abort(),CFG.timeout);
    try{setStatus('Consultando profundidad real...');const response=await fetch(url(selected),{signal:controller.signal,cache:'no-store'});if(!response.ok)throw Error('HTTP '+response.status);const book=normalize(await response.json());if(!S.running||generation!==S.generation||k!==key(selection())||controller.signal.aborted)return;if(S.depthConnected&&S.lastDepthAt&&Date.now()-S.lastDepthAt<12000)return;S.book=book;S.updated=Date.now();S.source=(bybitSupported(selected)?'Bybit':selected.exchange)+' REST';S.error='';snapshot(book);renderBook(book);redraw();}
    catch(e){if(!S.running||generation!==S.generation)return;S.error=controller.signal.aborted?'Tiempo de espera agotado':String(e.message||e);setStatus('Sin profundidad: '+S.error,true);if(!S.book)clear();console.warn('CRYPTOLEXUZ Liquidez V24:',e);}
    finally{clearTimeout(timeout);if(S.controller===controller)S.controller=null;S.busy=false;if(S.again&&S.running&&!document.hidden){S.again=false;queueMicrotask(refresh);}}
  }
  function closeDepth(){
    S.depthToken++;clearTimeout(S.depthReconnect);S.depthReconnect=null;
    const old=S.depthSocket;S.depthSocket=null;S.depthConnected=false;
    if(old){old.onopen=old.onmessage=old.onerror=old.onclose=null;try{old.close();}catch{}}
  }
  function acceptDepth(message){
    if(!S.running||message?.type!=='depth'||message.synced!==true)return;
    if(message.symbol!==selection().symbol||message.market!==selection().market)return;
    let book;try{book=normalize(message);}catch(e){setStatus('Profundidad no válida: '+e.message,true);return;}
    const timestamp=Number(message.timestamp)||Date.now();
    if(timestamp<=S.lastDepthAt)return;
    S.lastDepthAt=timestamp;S.book=book;S.updated=timestamp;S.source='Bybit WebSocket';S.error='';
    snapshot(book,timestamp);renderBook(book);redraw();
  }
  async function loadDepthHistory(token){
    const sel=selection();if(!bybitSupported(sel))return;
    try{
      const url='/api/depth/history/'+encodeURIComponent(sel.symbol)+'?market='+encodeURIComponent(sel.market)+'&limit=180';
      const r=await fetch(url,{cache:'no-store'});if(!r.ok)return;
      const json=await r.json();
      if(token!==S.depthToken||!S.running||!Array.isArray(json.history))return;
      for(const item of [...json.history].sort((a,b)=>Number(a.timestamp)-Number(b.timestamp)))acceptDepth(item);
    }catch(e){console.warn('Historial de profundidad:',e.message);}
  }
  function connectDepth(){
    closeDepth();if(!S.running||document.hidden)return;
    const sel=selection();
    if(!bybitSupported(sel)){setStatus('Este activo no admite profundidad Bybit; se utilizará REST.');return;}
    const token=S.depthToken;
    const protocol=location.protocol==='https:'?'wss:':'ws:';
    const address=protocol+'//'+location.host+'/ws/depth?exchange=bybit&market='+encodeURIComponent(sel.market)+'&symbol='+encodeURIComponent(sel.symbol);
    let ws;try{ws=new WebSocket(address);}catch(e){setStatus('No se pudo conectar Bybit: '+e.message,true);return;}
    S.depthSocket=ws;
    ws.onopen=()=>{if(token!==S.depthToken)return;S.depthConnected=true;setStatus('Conectado a profundidad Bybit · esperando capturas...');loadDepthHistory(token);};
    ws.onmessage=e=>{if(token!==S.depthToken)return;try{const msg=JSON.parse(e.data);if(msg.type==='depth')acceptDepth(msg);else if(msg.type==='depth-status'&&msg.status!=='connected')setStatus('Bybit: '+msg.status);}catch(err){console.warn('Profundidad:',err);}};
    ws.onerror=()=>{if(token===S.depthToken)setStatus('Conexión Bybit interrumpida; intentando recuperar...',true);};
    ws.onclose=()=>{if(token!==S.depthToken||!S.running)return;S.depthConnected=false;S.depthReconnect=setTimeout(connectDepth,4000);};
  }
  function start(){if(S.running)return;S.running=true;S.key=key(selection());S.lastDepthAt=0;S.snapshots=[];connectDepth();refresh();S.timer=setInterval(refresh,CFG.refresh);}
  function stop(){S.running=false;S.generation++;S.again=false;closeDepth();if(S.timer){clearInterval(S.timer);S.timer=null;}S.controller?.abort();S.controller=null;clear();}
  function restart(){S.generation++;S.key=key(selection());S.book=null;S.snapshots=[];S.lastDepthAt=0;clear();S.controller?.abort();closeDepth();if(S.running){connectDepth();if(S.busy)S.again=true;else refresh();}}
  function setEnabled(value){if(S.enabled===Boolean(value)&&S.running===Boolean(value))return;S.enabled=Boolean(value);updateVisibility();if(S.enabled){start();redraw();}else stop();}
  function syncFromApp(event){const next=event?.detail?.settings?.indicators?.liquidity;setEnabled(typeof next==='boolean'?next:settingsEnabled());}
  function bindChart(){const c=getChart();if(!c)return false;if(S.chart===c.chart&&S.candle===c.candle)return true;S.chart=c.chart;S.candle=c.candle;try{c.chart.timeScale().subscribeVisibleLogicalRangeChange(redraw);}catch{}try{c.chart.timeScale().subscribeVisibleTimeRangeChange(redraw);}catch{}return true;}
  function init(){if(S.initialized)return;if(!build())return;S.initialized=true;bindChart();S.enabled=settingsEnabled();updateVisibility();if(S.enabled)start();
    window.addEventListener('cryptolexuz:chart-ready',()=>{bindChart();redraw();});window.addEventListener('cryptolexuz:candles-updated',()=>{bindChart();redraw();});window.addEventListener('cryptolexuz:indicator-state-updated',syncFromApp);window.addEventListener('cryptolexuz:indicator-settings-change',syncFromApp);window.addEventListener('cryptolexuz:screen-change',redraw);
    for(const id of ['symbol','exchange','market'])$(id)?.addEventListener('change',restart);$('interval')?.addEventListener('change',()=>{setStatus('Temporalidad: '+selection().tf);redraw();});
    $('liquidityMapToggle')?.addEventListener('change',e=>{if(window.CryptolexuzApp?.setIndicator)window.CryptolexuzApp.setIndicator('liquidity',e.target.checked);else setEnabled(e.target.checked);});
    if(window.ResizeObserver){S.observer=new ResizeObserver(redraw);S.observer.observe($('chart'));S.observer.observe($('priceChartArea'));}window.addEventListener('resize',()=>{redraw();});document.addEventListener('visibilitychange',()=>{if(!document.hidden&&S.running){connectDepth();refresh();redraw();}else if(document.hidden){closeDepth();}});window.addEventListener('beforeunload',()=>{stop();S.observer?.disconnect();});console.info('CRYPTOLEXUZ PRO — LIQUIDITY.JS V24 iniciado');
  }
  window.CryptolexuzLiquidity={version:'24',start,stop,restart,refresh,redraw,setEnabled,isRunning:()=>S.running,getSelection:selection,getBook:()=>S.book?JSON.parse(JSON.stringify(S.book)):null,getSnapshots:()=>S.snapshots.map(x=>({at:x.at,bids:x.bids.length,asks:x.asks.length})),getStatus:()=>({enabled:S.enabled,running:S.running,busy:S.busy,market:S.key,lastUpdated:S.updated,lastError:S.error,source:S.source,depthConnected:S.depthConnected,snapshots:S.snapshots.length})};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
