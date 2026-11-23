
/* CRYPTOLEXUZ PRO — LIQUIDITY.JS V11
   Libro top 10 + mapa de calor histórico + perfil lateral.
   Datos reales del proxy, sin órdenes automáticas.
*/
"use strict";
(() => {
 if(window.__clLiquidityV11)return;
 window.__clLiquidityV11=true;
 const $=id=>document.getElementById(id);
 const CFG={refreshMs:2500,timeoutMs:10000,bookLevels:10,maxDepth:200,history:180,bins:90};
 const S={snapshots:[],book:null,key:"",running:false,busy:false,gen:0,timer:null,controller:null,enabled:true,intensity:1,history:180,bins:90,resize:null};
 const F=(v,d=2)=>Number.isFinite(Number(v))?Number(v).toLocaleString("en-US",{minimumFractionDigits:d,maximumFractionDigits:d}):"—";
 const E=(tag,cls="",txt)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(txt!==undefined)e.textContent=txt;return e;};
 const commodity=x=>["NCCOGOLD2USD-USDT","NCCO1OILWTI2USD-USDT"].includes(x);
 function selection(){const symbol=$("symbol")?.value||"BTC-USDT";return {symbol,exchange:commodity(symbol)?"bingx":($("exchange")?.value||"bingx"),market:commodity(symbol)?"perpetual":($("market")?.value||"perpetual")};}
 const key=s=>[s.exchange,s.market,s.symbol].join("|");
 function style(){if($("clLiquidityStyles"))return;const x=E("style");x.id="clLiquidityStyles";x.textContent=`
 .cl-liquidity-map{min-width:0;padding:12px;background:#080e20;border:1px solid #35436d;border-radius:12px;color:#dce6ff}
 .cl-map-heading{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:10px;font-size:13px}
 .cl-muted{color:#a5b0cf;font-size:11px}
 .cl-heat-controls{display:flex;flex-wrap:wrap;align-items:center;gap:10px;margin:10px 0;font:12px system-ui}
 .cl-heat-controls label{display:flex;align-items:center;gap:5px}
 .cl-heat-controls select,.cl-heat-controls button{background:#182442;color:#e8edff;border:1px solid #4a5a80;border-radius:7px;padding:6px}
 #clHeatmap{display:block;width:100%;height:390px;background:#070b19;border-radius:8px;touch-action:pan-y}
 .cl-map-note{margin:10px 0 0;color:#a5b0cf;font-size:11px;line-height:1.6}
 .cl-map-legend{display:flex;align-items:center;gap:9px;margin-top:10px;font-size:10px;color:#b7c3e1}
 .cl-legend-gradient{flex:1;height:9px;border-radius:5px;background:linear-gradient(90deg,#220839,#8b21cd,#1686d2,#1cceac,#ffe14a,#ff791e)}
 .cl-orderbook{margin-top:15px;padding-top:12px;border-top:1px solid #35436d}
 .cl-book-title{margin:0 0 10px;font-size:13px;color:#f5f7ff}
 .cl-book-label{margin:12px 0 7px;font-size:11px;font-weight:800}.cl-sell{color:#ff476c}.cl-buy{color:#00f5a0}
 .cl-book-columns,.cl-book-row{display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;padding:6px 7px;font-size:11px}
 .cl-book-columns{color:#a5b0cf}.cl-book-columns span:not(:first-child),.cl-book-row span:not(:first-of-type){text-align:right}
 .cl-book-row{position:relative;overflow:hidden;border-radius:5px;margin-bottom:3px;font-variant-numeric:tabular-nums}
 .cl-book-row>span{position:relative;z-index:1}.cl-book-bar{position:absolute;inset:0 auto 0 0;opacity:.24;z-index:0}
 .cl-book-row.ask{color:#ff8ba1;background:rgba(255,71,108,.05)}.cl-book-row.bid{color:#65ffc7;background:rgba(0,245,160,.05)}
 .cl-book-row.ask .cl-book-bar{background:#ff476c}.cl-book-row.bid .cl-book-bar{background:#00f5a0}
 .cl-book-middle{margin:12px 0;padding:10px;text-align:center;background:#121a36;border:1px solid #35436d;border-radius:8px;font-size:12px}
 .cl-book-summary{margin-top:12px;padding:11px;border-radius:8px;background:#101831;color:#cbd5f2;font-size:11px;line-height:1.8}
 @media(min-width:700px){#clHeatmap{height:490px}.cl-book-row{font-size:12px}}
 `;document.head.append(x);}
 function cols(){const r=E("div","cl-book-columns");["Precio","Cantidad","USDT"].forEach(t=>r.append(E("span","",t)));return r;}
 function build(){const map=$("liquidityMap"),section=$("orderbookSection");if(!map||!section){console.warn("CRYPTOLEXUZ: faltan liquidityMap/orderbookSection");return false;}style();map.className="cl-liquidity-map";map.replaceChildren();const heading=E("div","cl-map-heading");heading.append(E("strong","","Mapa de calor de liquidez"));const st=E("span","cl-muted","Conectando...");st.id="clMapStatus";heading.append(st);
 const controls=E("div","cl-heat-controls");const toggleLabel=E("label");const toggle=E("input");toggle.type="checkbox";toggle.checked=true;toggle.id="clHeatEnabled";toggleLabel.append(toggle,E("span","","Mapa"));controls.append(toggleLabel);
 const il=E("label");il.append(E("span","","Intensidad"));const intensity=E("input");intensity.type="range";intensity.min="0.5";intensity.max="2.5";intensity.step="0.25";intensity.value="1";intensity.id="clHeatIntensity";il.append(intensity);controls.append(il);
 const hl=E("label");hl.append(E("span","","Historial"));const hist=E("select");hist.id="clHeatHistory";[60,120,180,300].forEach(n=>{const o=E("option","",n+" muestras");o.value=n;if(n===180)o.selected=true;hist.append(o);});hl.append(hist);controls.append(hl);
 const bl=E("label");bl.append(E("span","","Detalle"));const bins=E("select");bins.id="clHeatBins";[48,70,90,120].forEach(n=>{const o=E("option","",n+" niveles");o.value=n;if(n===90)o.selected=true;bins.append(o);});bl.append(bins);controls.append(bl);
 const clear=E("button","","Limpiar historial");clear.id="clHeatClear";clear.type="button";controls.append(clear);
 const canvas=E("canvas");canvas.id="clHeatmap";canvas.setAttribute("aria-label","Mapa de calor de liquidez con trayectoria del precio y perfil lateral");
 const legend=E("div","cl-map-legend");legend.append(E("span","","Menor"),E("div","cl-legend-gradient"),E("span","","Mayor"));
 const info=E("p","cl-map-note","Esperando profundidad real...");info.id="clHeatInfo";
 map.append(heading,controls,canvas,legend,info,E("p","cl-map-note","El mapa representa órdenes limitadas visibles, no liquidaciones. Las órdenes pueden cambiar o cancelarse. El historial empieza al abrir la página; no es histórico previo del exchange."));
 const article=section.querySelector("article")||section;let book=$("clOrderbook");if(!book){book=E("div","cl-orderbook");book.id="clOrderbook";article.append(book);}book.replaceChildren();book.append(E("h3","cl-book-title","Libro de órdenes · diez niveles por lado"),E("div","cl-book-label cl-sell","VENTAS · ASK"),cols());const asks=E("div","","Esperando órdenes...");asks.id="clAsks";book.append(asks);const spread=E("div","cl-book-middle","Spread: —");spread.id="clSpread";book.append(spread,E("div","cl-book-label cl-buy","COMPRAS · BID"),cols());const bids=E("div","","Esperando órdenes...");bids.id="clBids";book.append(bids);const summary=E("div","cl-book-summary","Esperando profundidad...");summary.id="clBookSummary";book.append(summary);
 const outer=$("liquidityMapToggle");if(outer){outer.disabled=false;outer.checked=true;}const ph=document.querySelector("#liquiditySection .section-heading .muted");if(ph)ph.textContent="Profundidad real · actualización automática";
 toggle.addEventListener("change",()=>{S.enabled=toggle.checked;draw();});intensity.addEventListener("input",()=>{S.intensity=Number(intensity.value);draw();});hist.addEventListener("change",()=>{S.history=Number(hist.value);S.snapshots=S.snapshots.slice(-S.history);draw();});bins.addEventListener("change",()=>{S.bins=Number(bins.value);draw();});clear.addEventListener("click",()=>{S.snapshots=[];draw();});return true;}
 function status(msg,color="#a5b0cf"){const n=$("clMapStatus");if(n){n.textContent=msg;n.style.color=color;}}
 function parseSide(a){if(!Array.isArray(a))return [];return a.map(z=>({price:Number(Array.isArray(z)?z[0]:z.price??z.px??z.p),quantity:Number(Array.isArray(z)?z[1]:z.quantity??z.qty??z.size??z.sz??z.amount??z.q)})).filter(z=>Number.isFinite(z.price)&&Number.isFinite(z.quantity)&&z.price>0&&z.quantity>0);}
 function normalize(raw){let d=raw;for(let i=0;i<4&&!Array.isArray(d?.bids)&&!Array.isArray(d?.asks)&&!Array.isArray(d?.b)&&!Array.isArray(d?.a);i++){d=d?.data;if(Array.isArray(d))d=d[0];}const bids=parseSide(d?.bids??d?.b).sort((a,b)=>b.price-a.price).slice(0,CFG.maxDepth);const asks=parseSide(d?.asks??d?.a).sort((a,b)=>a.price-b.price).slice(0,CFG.maxDepth);if(!bids.length||!asks.length||bids[0].price>=asks[0].price)throw Error("Libro vacío o inconsistente");return {bids,asks,mid:(bids[0].price+asks[0].price)/2};}
 function url(s){return "/api/exchange/"+encodeURIComponent(s.exchange)+"/depth/"+encodeURIComponent(s.symbol)+"?market="+encodeURIComponent(s.market)+"&limit="+CFG.maxDepth;}
 async function fetchBook(s){const c=new AbortController();S.controller=c;const t=setTimeout(()=>c.abort(),CFG.timeoutMs);try{const r=await fetch(url(s),{signal:c.signal,cache:"no-store"});if(!r.ok)throw Error("HTTP "+r.status);const raw=await r.json();if(raw?.code!==undefined&&![0,"0"].includes(raw.code))throw Error("API "+raw.code);return normalize(raw);}finally{clearTimeout(t);if(S.controller===c)S.controller=null;}}
 function renderSide(id,arr,kind){const root=$(id);if(!root)return;root.replaceChildren();const top=arr.slice(0,CFG.bookLevels),max=Math.max(1,...top.map(x=>x.price*x.quantity));for(const x of top){const row=E("div","cl-book-row "+kind),bar=E("div","cl-book-bar");bar.style.width=(x.price*x.quantity/max*100).toFixed(1)+"%";row.append(bar,E("span","",F(x.price)),E("span","",F(x.quantity,4)),E("span","",F(x.price*x.quantity,0)));root.append(row);}}
 function renderBook(b){renderSide("clAsks",b.asks,"ask");renderSide("clBids",b.bids,"bid");const ask=b.asks[0].price,bid=b.bids[0].price;const spread=$("clSpread");if(spread)spread.textContent="Spread: "+F(ask-bid,4)+" USDT · "+F((ask-bid)/ask*100,4)+"%";if($("bid"))$("bid").textContent=F(bid);if($("ask"))$("ask").textContent=F(ask);const buy=b.bids.slice(0,10).reduce((s,x)=>s+x.price*x.quantity,0),sell=b.asks.slice(0,10).reduce((s,x)=>s+x.price*x.quantity,0);const largest=a=>a.slice(0,10).reduce((m,x)=>x.price*x.quantity>(m?.price*m?.quantity||0)?x:m,null);const sum=$("clBookSummary");if(sum)sum.textContent="Compras visibles (top diez): "+F(buy,0)+" USDT · Ventas visibles: "+F(sell,0)+" USDT · Ratio: "+(sell?F(buy/sell):"—")+" · Mayor compra: "+F(largest(b.bids)?.price)+" · Mayor venta: "+F(largest(b.asks)?.price)+". Son órdenes visibles, no garantía de rechazo.";}
 function capture(b){S.snapshots.push({time:Date.now(),mid:b.mid,bids:b.bids.map(x=>({...x})),asks:b.asks.map(x=>({...x}))});if(S.snapshots.length>S.history)S.snapshots.splice(0,S.snapshots.length-S.history);}
 function palette(v){const x=Math.min(1,Math.max(0,v*S.intensity));if(x<.08)return "#220839";if(x<.22)return "#67209c";if(x<.38)return "#a92cdb";if(x<.53)return "#178bd2";if(x<.67)return "#16c9bd";if(x<.8)return "#3fdd89";if(x<.92)return "#ffe14a";return "#ff791e";}
 function draw(){const c=$("clHeatmap");if(!c)return;const rect=c.getBoundingClientRect();if(!rect.width||!rect.height)return;const dpr=Math.min(devicePixelRatio||1,2),w=rect.width,h=rect.height,W=Math.round(w*dpr),H=Math.round(h*dpr);if(c.width!==W)c.width=W;if(c.height!==H)c.height=H;const ctx=c.getContext("2d");if(!ctx)return;ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,w,h);ctx.fillStyle="#070b19";ctx.fillRect(0,0,w,h);if(!S.enabled||!S.snapshots.length){ctx.fillStyle="#a5b0cf";ctx.font="12px system-ui";ctx.textAlign="center";ctx.fillText(S.enabled?"Esperando profundidad real...":"Mapa oculto",w/2,h/2);return;}
 const snaps=S.snapshots,marginL=8,axisW=Math.min(69,w*.2),profileW=Math.min(80,w*.23),gap=8,plotR=w-axisW-profileW-gap,plotT=15,plotB=h-30,plotH=plotB-plotT,plotW=plotR-marginL;if(plotW<30||plotH<30)return;
 let lo=Infinity,hi=-Infinity;for(const s of snaps){lo=Math.min(lo,s.mid);hi=Math.max(hi,s.mid);for(const x of s.bids){lo=Math.min(lo,x.price);hi=Math.max(hi,x.price);}for(const x of s.asks){lo=Math.min(lo,x.price);hi=Math.max(hi,x.price);}}if(!Number.isFinite(lo)||!Number.isFinite(hi))return;const pad=Math.max((hi-lo)*.04,Math.abs(hi)*.000001);lo-=pad;hi+=pad;const span=hi-lo,bins=S.bins,cellH=plotH/bins,step=plotW/snaps.length,profileB=Array(bins).fill(0),profileA=Array(bins).fill(0),columns=[],values=[];
 for(const s of snaps){const buy=Array(bins).fill(0),sell=Array(bins).fill(0);for(const [orders,dest,profile] of [[s.bids,buy,profileB],[s.asks,sell,profileA]])for(const x of orders){const idx=Math.floor((x.price-lo)/span*bins);if(idx<0||idx>=bins)continue;const n=x.price*x.quantity;dest[idx]+=n;profile[idx]+=n;}const merged=buy.map((x,i)=>x+sell[i]);columns.push({buy,sell,merged});for(const n of merged)if(n>0)values.push(n);}
 values.sort((a,b)=>a-b);const reference=values.length?Math.max(1,values[Math.floor((values.length-1)*.95)]):1;const strength=v=>v>0?Math.min(1,Math.log1p(v)/Math.log1p(reference)):0;const yPrice=p=>plotB-(p-lo)/span*plotH;
 ctx.strokeStyle="rgba(155,175,220,.13)";ctx.lineWidth=1;for(let i=0;i<=5;i++){const y=plotT+i*plotH/5;ctx.beginPath();ctx.moveTo(marginL,y);ctx.lineTo(plotR,y);ctx.stroke();}
 for(let col=0;col<columns.length;col++){const x=marginL+col*step;for(let i=0;i<bins;i++){const n=columns[col].merged[i];if(n<=0)continue;ctx.fillStyle=palette(strength(n));ctx.fillRect(x,plotB-(i+1)*cellH,Math.max(1,step+.3),Math.max(1,cellH+.3));}}
 const maxProfile=Math.max(1,...profileB.map((v,i)=>v+profileA[i]));const profileX=plotR+gap;for(let i=0;i<bins;i++){const b=profileB[i],a=profileA[i],factor=(profileW-4)/maxProfile,y=plotB-(i+1)*cellH;ctx.fillStyle="#00d9a0";ctx.fillRect(profileX,y,b*factor,Math.max(1,cellH));ctx.fillStyle="#ff476c";ctx.fillRect(profileX+b*factor,y,a*factor,Math.max(1,cellH));}
 ctx.beginPath();snaps.forEach((s,i)=>{const x=marginL+(i+.5)*step,y=yPrice(s.mid);if(i===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);});ctx.strokeStyle="#fff";ctx.lineWidth=1.7;ctx.stroke();const last=snaps.at(-1),ly=yPrice(last.mid);ctx.beginPath();ctx.setLineDash([4,4]);ctx.strokeStyle="#36c5ff";ctx.moveTo(marginL,ly);ctx.lineTo(plotR,ly);ctx.stroke();ctx.setLineDash([]);
 ctx.font="10px system-ui";ctx.fillStyle="#a9b9d6";ctx.textAlign="left";for(let i=0;i<=5;i++){const p=hi-i*span/5,y=plotT+i*plotH/5;ctx.fillText(F(p,2),w-axisW+3,Math.max(10,Math.min(h-18,y+3)));}ctx.fillStyle="#36c5ff";ctx.fillText(F(last.mid,2),w-axisW+3,Math.max(11,Math.min(h-19,ly-7)));ctx.fillStyle="#a9b9d6";ctx.fillText("Inicio",marginL,h-9);ctx.textAlign="right";ctx.fillText("Ahora",plotR,h-9);
 const info=$("clHeatInfo");if(info)info.textContent=selection().symbol+" · "+snaps.length+" muestras reales · "+new Date(last.time).toLocaleTimeString("es-MX")+" · Precio medio bid/ask: "+F(last.mid)+" · Perfil lateral: compras verdes / ventas rojas.";
 }
 function reset(){S.snapshots=[];S.book=null;for(const id of ["clAsks","clBids"])if($(id))$(id).textContent="Esperando órdenes...";if($("clBookSummary"))$("clBookSummary").textContent="Esperando profundidad...";if($("clHeatInfo"))$("clHeatInfo").textContent="Esperando muestras reales...";draw();}
 async function refresh(){if(!S.running||S.busy||document.hidden)return;const s=selection(),k=key(s);if(k!==S.key){S.key=k;S.gen++;reset();}const gen=S.gen;S.busy=true;try{status("Consultando "+s.exchange.toUpperCase()+"...","#ffe15a");const b=await fetchBook(s);if(!S.running||gen!==S.gen||k!==key(selection()))return;S.book=b;capture(b);renderBook(b);draw();status(s.exchange.toUpperCase()+" · "+new Date().toLocaleTimeString("es-MX"),"#00f5a0");}catch(e){if(gen===S.gen&&S.running){console.warn("CRYPTOLEXUZ Liquidez:",e);status("Sin profundidad · "+e.message,"#ff476c");if(!S.book&&$("clBookSummary"))$("clBookSummary").textContent="No se pudo consultar el libro de órdenes. Revisa el proxy y el mercado.";}}finally{S.busy=false;}}
 function start(){if(S.running)return;S.running=true;status("Conectando...","#ffe15a");refresh();S.timer=setInterval(refresh,CFG.refreshMs);}
 function stop(){S.running=false;S.gen++;clearInterval(S.timer);S.timer=null;S.controller?.abort();status("Mapa detenido");}
 function restart(){S.gen++;S.key="";S.controller?.abort();reset();if(S.running){if(S.busy){setTimeout(()=>{if(S.running)refresh();},100);}else refresh();}}
 function init(){if(!build())return;$("liquidityMapToggle")?.addEventListener("change",e=>e.target.checked?start():stop());for(const id of ["exchange","symbol","market"])$(id)?.addEventListener("change",restart);document.addEventListener("visibilitychange",()=>{if(!document.hidden&&S.running)refresh();});window.addEventListener("resize",draw);window.addEventListener("cryptolexuz:screen-change",()=>setTimeout(draw,150));if(window.ResizeObserver){S.resize=new ResizeObserver(draw);S.resize.observe($("clHeatmap"));}window.addEventListener("beforeunload",()=>{stop();S.resize?.disconnect();});start();console.info("CRYPTOLEXUZ PRO Liquidity V11 iniciado");}
 if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init);else init();
})();
