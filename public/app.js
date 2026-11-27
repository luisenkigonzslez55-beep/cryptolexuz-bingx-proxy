/* CRYPTOLEXUZ PRO — APP.JS V30 COMPLETO — TEMPORALIDADES E INDICADORES CORREGIDOS
   Compatible con INDEX.HTML V34/V35 y Lightweight Charts 4.2.2.
   Terminal informativa; no ejecuta órdenes.
*/
'use strict';
(() => {
  if (window.__cryptolexuzAppV30) return;
  window.__cryptolexuzAppV30 = true;
  const $ = id => document.getElementById(id);
  const C = { green:'#00f5a0', red:'#ff476c', purple:'#bb52ff', orange:'#ff9a35', blue:'#36c5ff', yellow:'#ffe15a' };
  const GOLD='NCCOGOLD2USD-USDT', OIL='NCCO1OILWTI2USD-USDT';
  const ASSETS=['BTC-USDT','ETH-USDT','BNB-USDT','SOL-USDT','XRP-USDT','DOGE-USDT',GOLD,OIL];
  const ALL_TF=['1m','3m','5m','15m','30m','1h','2h','4h','6h','8h','12h','1d','3d','1w','1M'];
  const SCAN_TF=['1d','4h','1h','30m','15m','5m','1m'];
  const SEC={'1m':60,'3m':180,'5m':300,'15m':900,'30m':1800,'1h':3600,'2h':7200,'4h':14400,'6h':21600,'8h':28800,'12h':43200,'1d':86400,'3d':259200,'1w':604800,'1M':2592000};
  const SETTINGS_KEY='cryptolexuz-chart-settings-v1', HISTORY_KEY='cryptolexuz-v27-history', LEGACY_HISTORY_KEY='cryptolexuz-v16-history';
  const MA_DEFAULT=[{period:55,color:C.orange,width:2,enabled:true},{period:100,color:C.red,width:3,enabled:false},{period:200,color:C.blue,width:2,enabled:false}];
  const EMA_DEFAULT=[{period:21,color:C.purple,width:2,enabled:true}];
  const IND_DEFAULT={MA:true,EMA:true,VOL:true,RSI:true,ADX:false,AO:false,FVG:true,IFVG:false,liquidity:false,sweeps:false,support:false,resistance:false};
  const charts={}, series={}, moving=new Map(), seriesCache=new WeakMap(), chartIntervals=new Map();
  const timers=[], cache=new Map(), levelLines=[];
  let prefs, rows=[], zones=[], pivots=[], history=[], currentKey='', chartRequest=0, tickerRequest=0, monitorRequest=0, scanRequest=0;
  let chartBusy=false, tickerBusy=false, monitorBusy=false, scanBusy=false, verifyBusy=false;
  let chartAgain=false, tickerAgain=false, monitorAgain=false, scanAgain=false;
  let socket=null, socketToken=0, reconnectTimer=null, lastWS=0, scanLast=0, monitorLast=0;
  let resizePending=false, overlayPending=false, syncingRange=false, markerSignature='', levelSignature='', lastRSI='RSI no disponible.';
  let profileAttached=null, lastProfileRows=null;
  const now=()=>Math.floor(Date.now()/1000);
  const emit=(name,detail={})=>window.dispatchEvent(new CustomEvent(name,{detail}));
  const put=(id,value)=>{const e=$(id);if(e&&e.textContent!==String(value))e.textContent=String(value);};
  const fmt=(v,n=2)=>Number.isFinite(Number(v))&&v!==null&&v!==undefined&&v!==''?Number(v).toLocaleString('en-US',{minimumFractionDigits:n,maximumFractionDigits:n}):'—';
  const safeJSON=(text,fallback)=>{try{return JSON.parse(text)||fallback;}catch{return fallback;}};
  const clone=a=>a.map(x=>({...x}));
  function normalizeLines(input,defaults){
    if(!Array.isArray(input))return clone(defaults);
    return input.slice(0,12).map(x=>({period:Math.max(1,Math.min(1000,Math.round(Number(x.period)||21))),color:/^#[0-9a-f]{6}$/i.test(x.color)?x.color:(defaults.find(d=>d.period===Number(x.period))?.color||C.purple),width:Math.max(1,Math.min(5,Number(x.width)||2)),enabled:x.enabled!==false}));
  }
  function readSettings(){
    let saved={};try{saved=safeJSON(localStorage.getItem(SETTINGS_KEY),{});}catch(e){console.warn('Lectura de ajustes:',e);}
    const legacy=Array.isArray(saved.lines)?saved.lines:[];
    return {maLines:normalizeLines(saved.maLines||(legacy.length?legacy.filter(x=>Number(x.period)!==21):null),MA_DEFAULT),emaLines:normalizeLines(saved.emaLines||(legacy.length?legacy.filter(x=>Number(x.period)===21):null),EMA_DEFAULT),height:Math.max(240,Math.min(600,Number(saved.height)||360)),options:{countdown:true,multiperiod:true,bidask:false,...saved.options},indicators:{...IND_DEFAULT,...saved.indicators}};
  }
  function saveSettings(){try{localStorage.setItem(SETTINGS_KEY,JSON.stringify(prefs));}catch(e){console.warn('Ajustes:',e);}}
  prefs=readSettings();
  function selection(){const symbol=$('symbol')?.value||'BTC-USDT',commodity=symbol===GOLD||symbol===OIL;return {symbol,tf:$('interval')?.value||'15m',exchange:commodity?'bingx':($('exchange')?.value||'bingx').toLowerCase(),market:commodity?'perpetual':($('market')?.value||'perpetual').toLowerCase()};}
  const key=s=>[s.exchange,s.market,s.symbol,s.tf].join('|');
  function syncCommodity(){if([GOLD,OIL].includes($('symbol')?.value)){if($('exchange'))$('exchange').value='bingx';if($('market'))$('market').value='perpetual';}}
  function syncTimeframes(){const tf=selection().tf;document.querySelectorAll('[data-tf],[data-cl-tf]').forEach(b=>{const active=(b.dataset.tf||b.dataset.clTf)===tf;b.classList.toggle('active',active);b.setAttribute('aria-pressed',String(active));});put('chartTitle',selection().symbol+' · '+tf);}
  function populateTimeframes(){const select=$('interval');if(!select)return;const previous=select.value||'15m';const existing=new Map(Array.from(select.options).map(o=>[o.value,o]));const fragment=document.createDocumentFragment();for(const tf of ALL_TF){const option=existing.get(tf)||document.createElement('option');option.value=tf;option.textContent=tf;fragment.append(option);}select.replaceChildren(fragment);select.value=Object.hasOwn(SEC,previous)?previous:'15m';syncTimeframes();}
  function setTimeframe(tf){if(!Object.hasOwn(SEC,tf)||!$('interval'))return;const select=$('interval');if(select.value!==tf){select.value=tf;select.dispatchEvent(new Event('change',{bubbles:true}));}else syncTimeframes();}
  function connection(label,color=C.yellow){put('connection','● '+label);if($('connection'))$('connection').style.color=color;}
  function timestamp(value){const v=typeof value==='string'&&!/^\d+$/.test(value)?Date.parse(value):Number(value);return Number.isFinite(v)?Math.floor(v>1e12?v/1000:v):NaN;}
  function normalize(payload){
    const source=[payload?.data?.data,payload?.data?.list,payload?.data?.candles,payload?.data,payload?.list,payload?.candles,payload].find(Array.isArray)||[];
    const output=[];
    for(const item of source){if(!item)continue;const a=Array.isArray(item);const c={time:timestamp(a?item[0]:item.time??item.timestamp??item.openTime??item.t),open:Number(a?item[1]:item.open??item.o),high:Number(a?item[2]:item.high??item.h),low:Number(a?item[3]:item.low??item.l),close:Number(a?item[4]:item.close??item.c),volume:Number(a?item[5]:item.volume??item.vol??item.v??0)};
      if(Object.values(c).every(Number.isFinite)&&c.time>0&&c.time<=now()+60&&c.low>0&&c.volume>=0&&c.high>=Math.max(c.open,c.close,c.low)&&c.low<=Math.min(c.open,c.close))output.push(c);
    }
    output.sort((a,b)=>a.time-b.time);return [...new Map(output.map(c=>[c.time,c])).values()];
  }
  function closed(data,tf){const seconds=SEC[tf]||60;return data.filter(c=>c.time+seconds<=now()-2);}
  function sma(values,period){const out=Array(values.length).fill(null);period=Math.floor(Number(period));if(period<1||!Number.isFinite(period))return out;let sum=0;for(let i=0;i<values.length;i++){sum+=values[i];if(i>=period)sum-=values[i-period];if(i>=period-1)out[i]=sum/period;}return out;}
  function ema(values,period){const out=Array(values.length).fill(null);period=Math.floor(Number(period));if(period<1||values.length<period)return out;let value=values.slice(0,period).reduce((a,b)=>a+b,0)/period;out[period-1]=value;for(let i=period;i<values.length;i++){value+=(values[i]-value)*2/(period+1);out[i]=value;}return out;}
  function rsi(values,period=14){const out=Array(values.length).fill(null);if(values.length<=period)return out;let gain=0,loss=0;for(let i=1;i<=period;i++){const d=values[i]-values[i-1];gain+=Math.max(0,d);loss+=Math.max(0,-d);}gain/=period;loss/=period;const value=()=>loss===0?(gain===0?50:100):100-100/(1+gain/loss);out[period]=value();for(let i=period+1;i<values.length;i++){const d=values[i]-values[i-1];gain=(gain*(period-1)+Math.max(0,d))/period;loss=(loss*(period-1)+Math.max(0,-d))/period;out[i]=value();}return out;}
  function adx(data,period=14){const n=data.length,ax=Array(n).fill(null),plus=Array(n).fill(null),minus=Array(n).fill(null);if(n<2*period)return {adx:ax,plus,minus};const tr=[],up=[],down=[],dx=[];for(let i=1;i<n;i++){const h=data[i].high-data[i-1].high,l=data[i-1].low-data[i].low;tr[i]=Math.max(data[i].high-data[i].low,Math.abs(data[i].high-data[i-1].close),Math.abs(data[i].low-data[i-1].close));up[i]=h>l&&h>0?h:0;down[i]=l>h&&l>0?l:0;}let t=0,p=0,m=0;for(let i=1;i<=period;i++){t+=tr[i];p+=up[i];m+=down[i];}for(let i=period;i<n;i++){if(i>period){t=t-t/period+tr[i];p=p-p/period+up[i];m=m-m/period+down[i];}plus[i]=t?100*p/t:0;minus[i]=t?100*m/t:0;const sum=plus[i]+minus[i];dx[i]=sum?100*Math.abs(plus[i]-minus[i])/sum:0;}let total=0;for(let i=period;i<2*period;i++)total+=dx[i];ax[2*period-1]=total/period;for(let i=2*period;i<n;i++)ax[i]=(ax[i-1]*(period-1)+dx[i])/period;return {adx:ax,plus,minus};}
  function atr(data,period=14){if(data.length<period+1)return null;const r=[];for(let i=1;i<data.length;i++)r.push(Math.max(data[i].high-data[i].low,Math.abs(data[i].high-data[i-1].close),Math.abs(data[i].low-data[i-1].close)));let v=r.slice(0,period).reduce((a,b)=>a+b,0)/period;for(let i=period;i<r.length;i++)v=(v*(period-1)+r[i])/period;return v;}
  function awesomeOscillator(data){const middle=data.map(c=>(c.high+c.low)/2),fast=sma(middle,5),slow=sma(middle,34);return middle.map((_,i)=>Number.isFinite(fast[i])&&Number.isFinite(slow[i])?fast[i]-slow[i]:null);}
  function lineData(data,values){return data.flatMap((c,i)=>Number.isFinite(values[i])?[{time:c.time,value:values[i]}]:[]);}
  function volumeBar(c){return {time:c.time,value:c.volume,color:c.close>=c.open?'rgba(0,245,160,.7)':'rgba(255,71,108,.7)'};}
  function aoBars(data,values){return data.flatMap((c,i)=>Number.isFinite(values[i])?[{time:c.time,value:values[i],color:!Number.isFinite(values[i-1])||values[i]>=values[i-1]?C.green:C.red}]:[]);}
  function setSeries(target,data,force=false){if(!target)return;const prev=seriesCache.get(target),first=data[0],last=data.at(-1);if(force||!prev||!data.length||prev.length>data.length||prev.first!==first?.time||prev.lastTime>last?.time||data.length>prev.length+1){target.setData(data);}else if(last&&last.time===prev.lastTime){if(last.value!==prev.lastValue||last.color!==prev.lastColor)target.update(last);}else if(last&&last.time>prev.lastTime){target.update(last);}else target.setData(data);seriesCache.set(target,{length:data.length,first:first?.time,lastTime:last?.time,lastValue:last?.value,lastColor:last?.color});}
  function chartOptions(height){return {width:Math.max(300,$('chart')?.clientWidth||300),height,layout:{background:{type:'solid',color:'#000000'},textColor:'#c9d3ee',fontSize:11},grid:{vertLines:{color:'#141414'},horzLines:{color:'#141414'}},rightPriceScale:{borderColor:'#343434',minimumWidth:65},timeScale:{borderColor:'#343434',timeVisible:true,secondsVisible:false,rightOffset:5,barSpacing:9,minBarSpacing:2},crosshair:{mode:LightweightCharts.CrosshairMode.Normal},handleScroll:{mouseWheel:false,pressedMouseMove:true,horzTouchDrag:true,vertTouchDrag:false},handleScale:{mouseWheel:true,pinch:true,axisPressedMouseMove:{time:true,price:true},axisDoubleClickReset:true},kineticScroll:{touch:true,mouse:true}};}
  function range(){try{const r=charts.price?.timeScale().getVisibleLogicalRange();return Number.isFinite(r?.from)&&Number.isFinite(r?.to)?{from:r.from,to:r.to}:null;}catch{return null;}}
  function restore(r){if(!r||!charts.price)return;try{charts.price.timeScale().setVisibleLogicalRange(r);}catch{}}
  function resetView(){if(!charts.price||!rows.length)return;restore({from:Math.max(0,rows.length-50),to:rows.length+3});}
  function syncRanges(r){if(syncingRange||!r||!Number.isFinite(r.from)||!Number.isFinite(r.to))return;syncingRange=true;try{for(const name of ['volume','rsi','adx','ao']){if(charts[name]){const old=charts[name].timeScale().getVisibleLogicalRange();if(!old||Math.abs(old.from-r.from)>.05||Math.abs(old.to-r.to)>.05)charts[name].timeScale().setVisibleLogicalRange(r);}}}catch{}finally{syncingRange=false;}scheduleOverlay();}
  function resize(){for(const [name,id,height] of [['price','chart',360],['volume','volumeChart',115],['rsi','rsiChart',145],['adx','adxChart',145],['ao','aoChart',145]]){const el=$(id);if(!charts[name]||!el||el.clientWidth<1)continue;const h=name==='price'?Math.max(240,el.clientHeight||prefs.height):height;charts[name].resize(Math.round(el.clientWidth),Math.round(h));}resizeCanvas();scheduleOverlay();redrawModules();}
  function scheduleResize(){if(resizePending)return;resizePending=true;requestAnimationFrame(()=>{resizePending=false;resize();});}
  function resizeCanvas(){const c=$('zonesCanvas'),a=$('priceChartArea');if(!c||!a||!a.clientWidth||!a.clientHeight)return;const dpr=Math.min(window.devicePixelRatio||1,2),w=Math.round(a.clientWidth*dpr),h=Math.round(a.clientHeight*dpr);if(c.width!==w)c.width=w;if(c.height!==h)c.height=h;c.style.pointerEvents='none';c.getContext('2d')?.setTransform(dpr,0,0,dpr,0,0);}
  function scheduleOverlay(){if(overlayPending)return;overlayPending=true;requestAnimationFrame(()=>{overlayPending=false;drawZones();});}
  function redrawModules(){for(const name of ['CryptolexuzFibonacci','CryptolexuzRangeBoxes','CryptolexuzVolumeProfile']){try{window[name]?.redraw?.();}catch(e){console.warn(name,e);}}}
  function announceReady(){if(!charts.price||!series.price)return;const chart=charts.price,candle=series.price;window.CryptolexuzChart={chart,chartApi:chart,candle,candleSeries:candle,applyOptions:x=>chart.applyOptions(x),timeScale:()=>chart.timeScale(),getRows:()=>rows,getCandles:()=>rows,getSelection:selection,resetView,resize};window.clChart=chart;window.chartApi=chart;emit('cryptolexuz:chart-ready',{chart,candle,candleSeries:candle,rows,candles:rows,getRows:()=>rows,getSelection:selection});}
  function attachProfile(){const p=window.CryptolexuzVolumeProfile||window.CRYPTOLEXUZ_VOLUME_PROFILE;if(!p||!charts.price||!series.price||p===profileAttached)return;try{p.attach?.(charts.price,series.price,{getRows:()=>rows,getCandles:()=>rows,getSelection:selection});profileAttached=p;}catch(e){console.warn('Volume Profile:',e);}}
  function updateModules(force=false){attachProfile();const p=window.CryptolexuzVolumeProfile||window.CRYPTOLEXUZ_VOLUME_PROFILE;if(p&&lastProfileRows!==rows){try{if(typeof p.setData==='function')p.setData(rows);else p.updateData?.(rows);lastProfileRows=rows;}catch(e){console.warn('Volume Profile:',e);}}emit('cryptolexuz:candles-updated',{chart:charts.price,candle:series.price,candleSeries:series.price,rows,candles:rows,selection:selection(),force});if(force)redrawModules();}
  function movingConfigurations(){return [...prefs.maLines.map(x=>({...x,method:'sma',enabled:x.enabled!==false&&prefs.indicators.MA!==false})),...prefs.emaLines.map(x=>({...x,method:'ema',enabled:x.enabled!==false&&prefs.indicators.EMA!==false}))];}
  function rebuildMoving(){if(!charts.price)return;const wanted=new Set();for(const conf of movingConfigurations()){const id=conf.method+':'+conf.period;wanted.add(id);let item=moving.get(id);if(!item){item=charts.price.addLineSeries({color:conf.color,lineWidth:conf.width,priceLineVisible:false,lastValueVisible:false,crosshairMarkerVisible:false});moving.set(id,item);}else item.applyOptions({color:conf.color,lineWidth:conf.width});}for(const [id,item] of moving){if(!wanted.has(id)){try{charts.price.removeSeries(item);}catch{}seriesCache.delete(item);moving.delete(id);}}}
  function updateMoving(closes,force=false){rebuildMoving();for(const conf of movingConfigurations()){const target=moving.get(conf.method+':'+conf.period);const active=conf.enabled!==false;const values=active?(conf.method==='ema'?ema(closes,conf.period):sma(closes,conf.period)):[];setSeries(target,active?lineData(rows,values):[],force);}}
  const namedLines={ema21:['ema',21],ma55:['sma',55],ma100:['sma',100],ma200:['sma',200]};
  const indicatorMap={rsi:'RSI',adx:'ADX',ao:'AO',volume:'VOL',vol:'VOL',fvg:'FVG',ifvg:'IFVG',liquidity:'liquidity',sweeps:'sweeps',support:'support',resistance:'resistance',ma:'MA',ema:'EMA'};
  function indicatorActive(name){name=String(name||'').toLowerCase();if(namedLines[name]){const [method,period]=namedLines[name],group=method==='ema'?'EMA':'MA',list=method==='ema'?prefs.emaLines:prefs.maLines;return prefs.indicators[group]!==false&&list.some(x=>x.period===period&&x.enabled!==false);}const k=indicatorMap[name];return k?prefs.indicators[k]!==false:false;}
  function updateButtons(){document.querySelectorAll('[data-indicator],[data-osc]').forEach(b=>{const name=b.dataset.indicator||b.dataset.osc,active=indicatorActive(name);if(!indicatorMap[String(name).toLowerCase()]&&!namedLines[String(name).toLowerCase()]){b.setAttribute('aria-disabled','true');return;}b.removeAttribute('aria-disabled');b.classList.toggle('active',active);b.setAttribute('aria-pressed',String(active));});}
  function updatePanelVisibility(){for(const [id,name] of [['rsiSection','RSI'],['adxSection','ADX'],['aoSection','AO']])if($(id))$(id).hidden=!prefs.indicators[name];const volume=$('volumeChart')?.closest('.volume-section');if(volume)volume.hidden=!prefs.indicators.VOL;scheduleResize();}
  function setIndicator(name,active){name=String(name||'').toLowerCase();if(namedLines[name]){const [method,period]=namedLines[name],group=method==='ema'?'EMA':'MA',list=method==='ema'?prefs.emaLines:prefs.maLines;let line=list.find(x=>x.period===period);if(!line){const d=(method==='ema'?EMA_DEFAULT:MA_DEFAULT).find(x=>x.period===period);line={...(d||{period,color:C.purple,width:2,enabled:false})};list.push(line);}line.enabled=Boolean(active);if(active)prefs.indicators[group]=true;}else{const k=indicatorMap[name];if(!k)return;prefs.indicators[k]=Boolean(active);}saveSettings();updateButtons();updatePanelVisibility();if(rows.length)updateIndicators(true);emit('cryptolexuz:indicator-state-updated',{settings:prefs});}
  function toggleIndicator(name){setIndicator(name,!indicatorActive(name));}
  function applySavedIndicators(){prefs=readSettings();updateButtons();updatePanelVisibility();if($('chart'))$('chart').style.height=prefs.height+'px';if(rows.length)updateIndicators(true);scheduleResize();}
  function createCharts(){if(!window.LightweightCharts||!$('chart')){put('message','No se pudo cargar Lightweight Charts.');connection('Error de gráfica',C.red);return false;}charts.price=LightweightCharts.createChart($('chart'),chartOptions(prefs.height));series.price=charts.price.addCandlestickSeries({upColor:C.green,downColor:C.red,wickUpColor:C.green,wickDownColor:C.red,borderVisible:false});rebuildMoving();for(const [name,id,height] of [['volume','volumeChart',115],['rsi','rsiChart',145],['adx','adxChart',145],['ao','aoChart',145]])if($(id))charts[name]=LightweightCharts.createChart($(id),chartOptions(height));if(charts.volume){series.volume=charts.volume.addHistogramSeries({priceFormat:{type:'volume'},priceScaleId:''});series.volume.priceScale().applyOptions({scaleMargins:{top:.12,bottom:0}});}if(charts.rsi){series.rsi=charts.rsi.addLineSeries({color:C.purple,lineWidth:2,priceLineVisible:false});for(const level of [30,50,70])series.rsi.createPriceLine({price:level,color:'#657399',lineStyle:LightweightCharts.LineStyle.Dashed,axisLabelVisible:true});}if(charts.adx)for(const [name,color] of [['adx',C.yellow],['plus',C.green],['minus',C.red]])series[name]=charts.adx.addLineSeries({color,lineWidth:2,priceLineVisible:false});if(charts.ao){series.ao=charts.ao.addHistogramSeries({priceFormat:{type:'price',precision:5,minMove:.00001},priceScaleId:''});series.ao.createPriceLine({price:0,color:'#657399',lineStyle:LightweightCharts.LineStyle.Dashed,axisLabelVisible:true});}charts.price.timeScale().subscribeVisibleLogicalRangeChange(syncRanges);$('chart').style.touchAction='pan-y';if($('zonesCanvas'))$('zonesCanvas').style.pointerEvents='none';if(window.ResizeObserver){const observer=new ResizeObserver(scheduleResize);for(const id of ['chart','volumeChart','rsiChart','adxChart','aoChart'])if($(id))observer.observe($(id));}window.addEventListener('resize',scheduleResize);try{window.CryptolexuzFibonacci?.attach?.(charts.price,series.price,{getRows:()=>rows,getSelection:selection});}catch(e){console.warn('Fibonacci:',e);}announceReady();attachProfile();setTimeout(scheduleResize,150);return true;}
  function detectPivots(data){const result=[];for(let i=4;i<data.length-4;i++){const neighbors=data.slice(i-4,i+5);if(neighbors.every((c,j)=>j===4||c.high<data[i].high))result.push({index:i,price:data[i].high,type:'high'});if(neighbors.every((c,j)=>j===4||c.low>data[i].low))result.push({index:i,price:data[i].low,type:'low'});}return result.slice(-40);}
  function detectFVG(data){const result=[];for(let i=2;i<data.length;i++){const bull=data[i].low>data[i-2].high,bear=data[i].high<data[i-2].low;if(!bull&&!bear)continue;const top=bull?data[i].low:data[i-2].low,bottom=bull?data[i-2].high:data[i].high;if((top-bottom)/((top+bottom)/2)<.00035)continue;let end=data.length-1,filled=false,inverted=false;for(let j=i+1;j<data.length;j++){const touched=bull?data[j].low<=bottom:data[j].high>=top;if(touched){end=j;filled=true;inverted=bull?data[j].close<bottom:data[j].close>top;break;}}result.push({start:i-2,end,top,bottom,bull,filled,inverted});}return result.slice(-80);}
  function detectSweeps(data){const result=[];for(let i=20;i<data.length-1;i++){const previous=data.slice(i-20,i),high=Math.max(...previous.map(c=>c.high)),low=Math.min(...previous.map(c=>c.low));if(data[i].high>high&&data[i].close<high)result.push({time:data[i].time,position:'aboveBar',color:C.red,shape:'arrowDown',text:'Barrido ↑'});if(data[i].low<low&&data[i].close>low)result.push({time:data[i].time,position:'belowBar',color:C.green,shape:'arrowUp',text:'Barrido ↓'});}return result.slice(-25);}
  function updateLevels(){if(!series.price)return;const recent=pivots.slice(-18),requested=[];for(const [name,type,color,label] of [['support','low',C.green,'Soporte'],['resistance','high',C.red,'Resistencia']])if(prefs.indicators[name]){const p=recent.filter(x=>x.type===type).at(-1);if(p)requested.push([p.price,color,label]);}if(prefs.indicators.liquidity){for(const p of recent.filter(x=>x.type==='high').slice(-2))requested.push([p.price,C.red,'Máximo']);for(const p of recent.filter(x=>x.type==='low').slice(-2))requested.push([p.price,C.green,'Mínimo']);}const signature=JSON.stringify(requested);if(signature===levelSignature)return;levelSignature=signature;for(const line of levelLines)try{series.price.removePriceLine(line);}catch{}levelLines.length=0;for(const [price,color,title] of requested)levelLines.push(series.price.createPriceLine({price,color,title,lineWidth:1,lineStyle:LightweightCharts.LineStyle.Dashed,axisLabelVisible:true}));}
  function drawZones(){const canvas=$('zonesCanvas'),area=$('priceChartArea');if(!canvas||!area||!charts.price||!series.price)return;resizeCanvas();const ctx=canvas.getContext('2d');if(!ctx)return;const w=area.clientWidth,h=area.clientHeight;ctx.clearRect(0,0,w,h);if(!prefs.indicators.FVG&&!prefs.indicators.IFVG)return;for(const zone of zones.slice(-25)){if(!((!zone.filled&&prefs.indicators.FVG)||(zone.inverted&&prefs.indicators.IFVG)))continue;const scale=charts.price.timeScale(),x1=scale.logicalToCoordinate(zone.start),x2=scale.logicalToCoordinate(zone.end),y1=series.price.priceToCoordinate(zone.top),y2=series.price.priceToCoordinate(zone.bottom);if(![x1,x2,y1,y2].every(Number.isFinite))continue;const left=Math.max(0,x1),right=Math.min(w-70,x2),top=Math.max(0,Math.min(y1,y2)),bottom=Math.min(h,Math.max(y1,y2));if(right<=left||bottom<=top)continue;ctx.fillStyle=zone.inverted?'rgba(255,225,90,.12)':zone.bull?'rgba(0,245,160,.09)':'rgba(255,71,108,.09)';ctx.fillRect(left,top,right-left,bottom-top);ctx.strokeStyle=zone.inverted?'#ffe15a':zone.bull?'rgba(0,245,160,.4)':'rgba(255,71,108,.4)';ctx.strokeRect(left,top,right-left,bottom-top);}}
  function updateIndicators(force=false){if(!rows.length||!series.price)return;const closes=rows.map(c=>c.close),e=ema(closes,21),m=sma(closes,55),rv=rsi(closes),av=adx(rows),ao=awesomeOscillator(rows);updateMoving(closes,force);setSeries(series.rsi,prefs.indicators.RSI?lineData(rows,rv):[],force);for(const [name,values] of [['adx',av.adx],['plus',av.plus],['minus',av.minus]])setSeries(series[name],prefs.indicators.ADX?lineData(rows,values):[],force);setSeries(series.ao,prefs.indicators.AO?aoBars(rows,ao):[],force);const valid=closed(rows,selection().tf),last=valid.at(-1),index=last?rows.findIndex(c=>c.time===last.time):-1;if(index>=0){for(const [id,value,digits] of [['ema21Value',e[index],2],['ma55Value',m[index],2],['rsiValue',rv[index],1],['adxValue',av.adx[index],1],['rsiChartValue',rv[index],1],['adxChartValue',av.adx[index],1],['aoValue',ao[index],5]])put(id,fmt(value,digits));const r=rv[index];lastRSI=!Number.isFinite(r)?'RSI no disponible.':r<30?'RSI en sobreventa; rebote no confirmado.':r>70?'RSI en sobrecompra; caída no confirmada.':r>=50?'RSI con predominio comprador.':'RSI con predominio vendedor.';put('rsiInterpretation',lastRSI);const strength=av.adx[index];put('adxInterpretation',Number.isFinite(strength)?'ADX '+fmt(strength,1)+(strength>=25?'. Tendencia con fuerza.':'. Tendencia débil.'):'ADX no disponible.');const a=ao[index],p=ao[index-1];put('aoInterpretation',!Number.isFinite(a)?'AO sin historial suficiente.':p<=0&&a>0?'AO: cruce alcista de cero.':p>=0&&a<0?'AO: cruce bajista de cero.':a>0&&a>p?'AO positivo y aumentando.':a>0?'AO positivo, perdiendo impulso.':a<p?'AO negativo y descendiendo.':'AO negativo, recuperando impulso.');const trend=Number.isFinite(e[index])&&Number.isFinite(m[index])?(closes[index]>e[index]&&e[index]>m[index]?'Sesgo alcista':closes[index]<e[index]&&e[index]<m[index]?'Sesgo bajista':'Mercado mixto'):'Historial insuficiente';put('indicatorReadout',trend+'. '+lastRSI);}const previous=valid.slice(-21,-1);if(last&&previous.length===20){const avg=previous.reduce((s,c)=>s+c.volume,0)/20;put('volumeInterpretation',avg?'Volumen de última vela cerrada: '+fmt(last.volume/avg,2)+' veces el promedio.':'Volumen insuficiente.');}pivots=detectPivots(rows);zones=detectFVG(rows);const markers=prefs.indicators.sweeps?detectSweeps(rows):[],signature=JSON.stringify(markers);if(markerSignature!==signature){series.price.setMarkers(markers);markerSignature=signature;}updateLevels();scheduleOverlay();}
  async function getJSON(url,timeout=12000){const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeout);try{const response=await fetch(url,{signal:controller.signal,cache:'no-store'});if(!response.ok)throw Error('HTTP '+response.status);const data=await response.json();if(data?.code!==undefined&&![0,'0'].includes(data.code))throw Error(data.msg||data.message||'Error del exchange');return data;}finally{clearTimeout(timer);}}
  const candleURL=(s,limit=300)=>'/api/exchange/'+encodeURIComponent(s.exchange)+'/klines/'+encodeURIComponent(s.symbol)+'?market='+encodeURIComponent(s.market)+'&interval='+encodeURIComponent(s.tf)+'&limit='+limit;
  const tickerURL=s=>'/api/exchange/'+encodeURIComponent(s.exchange)+'/ticker/'+encodeURIComponent(s.symbol)+'?market='+encodeURIComponent(s.market);
  function sameCandle(a,b){return Boolean(a&&b&&a.time===b.time&&a.open===b.open&&a.high===b.high&&a.low===b.low&&a.close===b.close&&a.volume===b.volume);}
  function classifyChange(oldData,newData){if(!oldData.length||!newData.length)return'rebuild';if(oldData.length===newData.length&&oldData.slice(0,-1).every((c,i)=>sameCandle(c,newData[i])))return sameCandle(oldData.at(-1),newData.at(-1))?'none':'last';if(newData.length===oldData.length+1&&oldData.every((c,i)=>sameCandle(c,newData[i])))return'append';return'rebuild';}
  function applyCandles(data,s){const changed=currentKey!==key(s),type=changed?'rebuild':classifyChange(rows,data);if(type==='none'){put('status','Velas actualizadas');return;}const previous=changed?null:range();rows=data;currentKey=key(s);const last=data.at(-1);if(type==='last'||type==='append'){series.price.update(last);series.volume?.update(volumeBar(last));}else{series.price.setData(rows);series.volume?.setData(rows.map(volumeBar));if(series.volume)seriesCache.delete(series.volume);}const force=type==='rebuild'||changed;updateIndicators(force);updateModules(force);if(changed)resetView();else if(force&&previous)restore(previous);put('chartTitle',s.symbol+' · '+s.tf);put('volumeLabel',s.symbol===GOLD?'GOLD':s.symbol===OIL?'OIL WTI':s.symbol.split('-')[0]);scheduleOverlay();}
  async function refresh(){if(!series.price)return;if(chartBusy){chartAgain=true;return;}chartBusy=true;const id=chartRequest,s=selection();try{put('status','Cargando '+s.symbol+' · '+s.tf);const data=normalize(await getJSON(candleURL(s)));if(id!==chartRequest||key(s)!==key(selection()))return;if(!data.length)throw Error('Sin velas válidas: revisar formato de respuesta del proxy');applyCandles(data,s);put('status','Velas actualizadas');put('message','');}catch(e){if(id===chartRequest){put('status','Error: '+e.message);put('message','No se pudieron cargar las velas: '+e.message);console.error('CRYPTOLEXUZ V30 velas:',candleURL(s),e);}}finally{chartBusy=false;if(chartAgain){chartAgain=false;queueMicrotask(refresh);}}}
  function tickerData(payload){let data=payload?.data??payload;if(Array.isArray(data))data=data[0];if(data?.data)data=data.data;if(Array.isArray(data))data=data[0];return data||{};}
  async function refreshTicker(){if(tickerBusy){tickerAgain=true;return;}tickerBusy=true;const s=selection(),id=tickerRequest;try{const d=tickerData(await getJSON(tickerURL(s),8000));if(id!==tickerRequest||key(s)!==key(selection()))return;const price=Number(d.lastPrice??d.last??d.price??d.close??d.c),open=Number(d.openPrice??d.open24h??d.open??d.o);let change=Number(d.priceChangePercent??d.changePercent);if(!Number.isFinite(change)&&price>0&&open>0)change=(price/open-1)*100;if(price>0&&Date.now()-lastWS>7000){put('price',fmt(price));connection(s.exchange.toUpperCase()+' · REST');}for(const [id,value,n] of [['high',d.highPrice??d.high24h??d.high??d.h,2],['low',d.lowPrice??d.low24h??d.low??d.l,2],['open',open,2],['volume',d.volume??d.volume24h??d.vol??d.v,0],['bid',d.bidPrice??d.bid??d.bestBid,2],['ask',d.askPrice??d.ask??d.bestAsk,2]])put(id,fmt(value,n));put('change',Number.isFinite(change)?(change>=0?'+':'')+fmt(change)+'%':'—');$('change')?.classList.toggle('negative',change<0);put('updated',new Date().toLocaleTimeString('es-MX'));}catch(e){console.warn('Ticker:',tickerURL(s),e.message);put('tickerStatus','Ticker sin conexión: '+e.message);}finally{tickerBusy=false;if(tickerAgain){tickerAgain=false;queueMicrotask(refreshTicker);}}}
  function disconnect(){socketToken++;clearTimeout(reconnectTimer);if(socket){const old=socket;socket=null;old.onopen=old.onmessage=old.onclose=old.onerror=null;try{old.close();}catch{}}}
  function connect(){disconnect();const token=socketToken,s=selection(),protocol=location.protocol==='https:'?'wss:':'ws:',url=protocol+'//'+location.host+'/ws?exchange='+encodeURIComponent(s.exchange)+'&market='+encodeURIComponent(s.market)+'&symbol='+encodeURIComponent(s.symbol);connection(s.exchange.toUpperCase()+' · conectando');try{socket=new WebSocket(url);}catch{scheduleReconnect(token);return;}socket.onopen=()=>{if(token===socketToken)connection('Esperando precios');};socket.onmessage=event=>{if(token!==socketToken)return;let data;try{data=JSON.parse(event.data);}catch{return;}if(data.type!=='price'||data.symbol!==s.symbol||data.market!==s.market||data.exchange!==s.exchange)return;const price=Number(data.price);if(!Number.isFinite(price)||price<=0)return;put('price',fmt(price));put('updated',new Date().toLocaleTimeString('es-MX'));lastWS=Date.now();connection(s.exchange.toUpperCase()+' · en vivo',C.green);};socket.onerror=()=>{if(token===socketToken)connection('Conexión interrumpida',C.red);};socket.onclose=()=>{if(token===socketToken){socket=null;scheduleReconnect(token);}};}
  function scheduleReconnect(token){clearTimeout(reconnectTimer);reconnectTimer=setTimeout(()=>{if(token===socketToken&&!document.hidden)connect();},4000);}
  function metric(data,tf){const candles=closed(data,tf);if(candles.length<60)return null;const closes=candles.map(c=>c.close),last=candles.at(-1),e=ema(closes,21).at(-1),m=sma(closes,55).at(-1),rv=rsi(closes).at(-1),ad=adx(candles),strength=ad.adx.at(-1),plus=ad.plus.at(-1),minus=ad.minus.at(-1),ao=awesomeOscillator(candles),aoNow=ao.at(-1),aoPrevious=ao.at(-2);if(![e,m,rv,strength,plus,minus].every(Number.isFinite))return null;let bull=0,bear=0;if(last.close>e)bull++;if(last.close<e)bear++;if(e>m)bull++;if(e<m)bear++;if(rv>=55)bull++;if(rv<=45)bear++;if(plus>minus)bull++;if(minus>plus)bear++;const previous=candles.slice(-7,-1),average=candles.slice(-21,-1).reduce((s,c)=>s+c.volume,0)/20;return {bull,bear,adx:strength,plus,minus,rsi:rv,ao:aoNow,aoPrevious,aoBull:Number.isFinite(aoNow)&&Number.isFinite(aoPrevious)&&aoNow>0&&aoNow>aoPrevious,aoBear:Number.isFinite(aoNow)&&Number.isFinite(aoPrevious)&&aoNow<0&&aoNow<aoPrevious,volRatio:average?last.volume/average:0,close:last.close,closedTime:last.time,atr:atr(candles),breakHigh:last.close>Math.max(...previous.map(c=>c.high)),breakLow:last.close<Math.min(...previous.map(c=>c.low))};}
  function analyze(data,tf){const m=metric(data,tf);if(!m)return {state:'SIN DATOS',direction:'neutral',detail:'Historial insuficiente.',metrics:'—',price:null};const bullish=m.bull>=3&&m.bull>m.bear,bearish=m.bear>=3&&m.bear>m.bull,opportunity=m.bull===4&&m.adx>=25&&m.rsi<70?'Posible LONG':m.bear===4&&m.adx>=25&&m.rsi>30?'Posible SHORT':'Sin entrada confirmada',aoText=m.aoBull?'AO alcista':m.aoBear?'AO bajista':'AO sin confirmación';return {state:bullish?'SESGO ALCISTA':bearish?'SESGO BAJISTA':'LATERAL / MIXTO',direction:bullish?'bullish':bearish?'bearish':'neutral',detail:opportunity+'. '+aoText+'. Requiere confirmación.',metrics:'RSI '+fmt(m.rsi,1)+' · ADX '+fmt(m.adx,1),price:m.close};}
  async function monitor(force=false){if(monitorBusy){monitorAgain=true;return;}if(!force&&Date.now()-monitorLast<60000)return;monitorBusy=true;monitorLast=Date.now();const s=selection(),id=monitorRequest;try{put('engineState','ANALIZANDO');const result=await Promise.allSettled(['5m','15m'].map(async tf=>normalize(await getJSON(candleURL({...s,tf})))));if(id!==monitorRequest)return;let success=0;for(let i=0;i<2;i++){const tf=i?'15m':'5m',suffix=i?'15':'5',item=result[i],r=item.status==='fulfilled'?analyze(item.value,tf):{state:'SIN CONEXIÓN',direction:'neutral',detail:'No se pudieron cargar velas.',metrics:'—'};if(item.status==='fulfilled'&&r.state!=='SIN DATOS')success++;put('state'+suffix,r.state);put('detail'+suffix,r.detail);put('metrics'+suffix,r.metrics);const el=$('state'+suffix);if(el){el.className='state '+r.direction;const h=el.closest('.signal-card')?.querySelector('h3');if(h)h.textContent=s.symbol+' / '+tf;}}put('engineState',success?'ANALIZANDO':'SIN CONEXIÓN');}catch(e){if(id===monitorRequest)put('engineState','SIN CONEXIÓN');console.warn('Monitor:',e);}finally{monitorBusy=false;if(monitorAgain){monitorAgain=false;queueMicrotask(()=>monitor(true));}}}
  function scannerUI(){if($('clScanner'))return;const host=$('clScannerHost')||$('clScreenScanner');if(!host)return;const section=document.createElement('section');section.id='clScanner';section.className='cl-module';section.innerHTML='<h2>📡 Escáner CRYPTOLEXUZ PRO</h2><p id="clScanStatus">Esperando análisis...</p><div class="chart-controls"><button id="clScanNow" type="button">↻ Escanear</button><button id="clNotify" type="button">🔔 Activar avisos</button></div><p class="cl-notice">Ocho activos · Siete temporalidades · LONG / SHORT</p><div id="clScanBody" class="cl-scan-grid" aria-live="polite">Iniciando...</div><p id="clScanErrors" class="cl-notice"></p>';host.appendChild(section);$('clScanNow')?.addEventListener('click',()=>scan(true));$('clNotify')?.addEventListener('click',async()=>{if(!('Notification'in window)){alert('Notificaciones no disponibles.');return;}try{const p=await Notification.requestPermission();put('clNotify',p==='granted'?'🔔 Avisos activos':'🔕 Sin permiso');}catch(e){console.warn('Notificaciones:',e);}});}
  function markets(){const s=selection();return ASSETS.map(symbol=>({symbol,exchange:[GOLD,OIL].includes(symbol)?'bingx':s.exchange,market:[GOLD,OIL].includes(symbol)?'perpetual':s.market,label:symbol===GOLD?'GOLD (XAU)':symbol===OIL?'OIL WTI':symbol.replace('-','/')}));}
  async function frames(market){const result={};for(const tf of SCAN_TF){const s={...market,tf},cacheKey=key(s),ttl=SEC[tf]>=3600?180000:SEC[tf]>=900?90000:50000,stored=cache.get(cacheKey);if(stored&&Date.now()-stored.at<ttl){result[tf]=stored.data;continue;}const data=normalize(await getJSON(candleURL(s,300)));if(closed(data,tf).length<60)throw Error(tf+': historial insuficiente');result[tf]=data;cache.set(cacheKey,{at:Date.now(),data});}return result;}
  // V27: Confirmaciones estrictas basadas exclusivamente en velas cerradas.
  const V27={minScore:85,minADX:25,minVolume:1.35,cooldownSeconds:15*60,maxPendingSeconds:30*60,minimumRR:1.8};
  function rank(market,framesData){
    const metrics={};for(const tf of SCAN_TF)metrics[tf]=metric(framesData[tf]||[],tf);
    const fast=metrics['1m'],m5=metrics['5m'],m15=metrics['15m'],m1h=metrics['1h'];
    if(!fast||!m5||!m15)return {market,score:0,state:'SIN DATOS',direction:'NEUTRAL',confirmations:'Historial insuficiente'};
    const long=m15.bull>=3&&m5.bull>=3&&m15.bull>m15.bear&&m5.bull>m5.bear;
    const short=m15.bear>=3&&m5.bear>=3&&m15.bear>m15.bull&&m5.bear>m5.bull;
    const direction=long&&!short?'LONG':short&&!long?'SHORT':'NEUTRAL';
    const valid=direction!=='NEUTRAL';
    const momentum=valid&&(direction==='LONG'?m5.aoBull&&fast.aoBull:m5.aoBear&&fast.aoBear);
    const trend=valid&&(direction==='LONG'?m1h?.bull>=3:m1h?.bear>=3);
    const volume=m5.volRatio>=V27.minVolume;
    const strength=m5.adx>=V27.minADX&&m15.adx>=20;
    const rsiOK=valid&&(direction==='LONG'?m5.rsi>=52&&m5.rsi<=68:m5.rsi>=32&&m5.rsi<=48);
    const breakout=valid&&(direction==='LONG'?m5.breakHigh:m5.breakLow);
    const timing=valid&&(direction==='LONG'?fast.bull>=3:fast.bear>=3);
    const atrOK=Number.isFinite(m5.atr)&&m5.atr>0;
    const score=(valid?25:0)+(trend?12:0)+(strength?15:0)+(volume?12:0)+(momentum?12:0)+(rsiOK?10:0)+(breakout?8:0)+(timing?6:0);
    const confirmed=valid&&trend&&strength&&volume&&momentum&&rsiOK&&breakout&&timing&&atrOK&&score>=V27.minScore;
    const flags=[`15m/5m ${valid?'alineados':'sin alinear'}`,`1h ${trend?'✓':'×'}`,`ADX ${strength?'✓':'×'}`,`VOL ${volume?'✓':'×'}`,`AO ${momentum?'✓':'×'}`,`RSI ${rsiOK?'✓':'×'}`,`ruptura 5m ${breakout?'✓':'×'}`];
    return {market,score,direction,state:confirmed?'CONFIRMADA':score>=70?'EN OBSERVACIÓN':'SIN ENTRADA',confirmations:flags.join(' · '),closedTime:m5.closedTime,price:m5.close,atr:m5.atr,tf:'5m',reason:'V27: 15m/5m alineados; 1h, ADX, volumen, AO, RSI y ruptura 5m',strategyVersion:'V27'};
  }
  // Mantener los registros V26 en su propia clave. No alterar ni mezclar sus métricas.
  const legacyHistory=(()=>{try{return safeJSON(localStorage.getItem(LEGACY_HISTORY_KEY),[]);}catch{return [];}})();
  history=(()=>{try{return safeJSON(localStorage.getItem(HISTORY_KEY),[]);}catch{return [];}})();
  if(!Array.isArray(history))history=[];
  history=history.slice(0,300);
  function saveHistory(){try{localStorage.setItem(HISTORY_KEY,JSON.stringify(history.slice(0,300)));}catch(e){console.warn('Historial:',e);}}
  function hasActiveSignal(result){return history.some(x=>x.symbol===result.market.symbol&&x.exchange===result.market.exchange&&x.market===result.market.market&&x.direction===result.direction&&['PENDIENTE','ACTIVADA'].includes(x.state));}
  function inCooldown(result){const recent=history.find(x=>x.symbol===result.market.symbol&&x.exchange===result.market.exchange&&x.market===result.market.market&&x.direction===result.direction&&x.ended);return Boolean(recent&&now()-recent.ended<V27.cooldownSeconds);}
  function addSignal(result){
    if(result.state!=='CONFIRMADA'||!result.closedTime||!Number.isFinite(result.atr)||result.atr<=0||hasActiveSignal(result)||inCooldown(result))return false;
    const id=['V27',result.market.exchange,result.market.market,result.market.symbol,result.direction,result.closedTime].join('|');
    if(history.some(x=>x.id===id))return false;
    const entry=result.price,distance=result.atr,side=result.direction;
    if(!Number.isFinite(entry)||entry<=0||!Number.isFinite(distance)||distance<=0)return false;
    history.unshift({id,version:'V27',symbol:result.market.symbol,exchange:result.market.exchange,market:result.market.market,tf:result.tf||'5m',direction:side,created:result.closedTime,entry,stop:side==='LONG'?entry-distance:entry+distance,target:side==='LONG'?entry+2*distance:entry-2*distance,state:'PENDIENTE',activated:null,ended:null,reason:result.reason,score:result.score,lastChecked:result.closedTime});
    history=history.slice(0,300);saveHistory();renderHistory();return true;
  }
  function evaluateSignal(signal,data){
    if(!['PENDIENTE','ACTIVADA'].includes(signal.state))return false;
    let changed=false;
    const valid=closed(data,signal.tf);
    for(const candle of valid){
      if(candle.time<=signal.lastChecked||candle.time<=signal.created)continue;
      signal.lastChecked=candle.time;changed=true;
      if(signal.state==='PENDIENTE'){
        if(candle.time-signal.created>V27.maxPendingSeconds){signal.state='NO ACTIVADA';signal.ended=candle.time;break;}
        if(!(candle.low<=signal.entry&&candle.high>=signal.entry))continue;
        signal.state='ACTIVADA';signal.activated=candle.time;
      }
      const stop=signal.direction==='LONG'?candle.low<=signal.stop:candle.high>=signal.stop;
      const target=signal.direction==='LONG'?candle.high>=signal.target:candle.low<=signal.target;
      if(stop&&target){signal.state='NO VERIFICABLE';signal.ended=candle.time;break;}
      if(stop||target){signal.state=candle.time===signal.activated?'NO VERIFICABLE':target?'OBJETIVO':'STOP';signal.ended=candle.time;break;}
    }
    if(signal.state==='PENDIENTE'&&now()-signal.created>V27.maxPendingSeconds+(SEC[signal.tf]||300)){
      signal.state='NO ACTIVADA';signal.ended=now();changed=true;
    }
    return changed;
  }
  async function verifySignals(){
    if(verifyBusy)return;verifyBusy=true;
    try{
      const groups=new Map();
      for(const signal of history.filter(x=>['PENDIENTE','ACTIVADA'].includes(x.state))){const k=key(signal);if(!groups.has(k))groups.set(k,[]);groups.get(k).push(signal);}
      let dirty=false;
      for(const group of groups.values()){
        const first=group[0];
        try{
          const data=normalize(await getJSON(candleURL(first,300))),valid=closed(data,first.tf);
          if(!valid.length)continue;
          for(const item of group){
            if(item.lastChecked<valid[0].time-(SEC[item.tf]||300)){item.state='NO VERIFICABLE';item.ended=now();dirty=true;continue;}
            if(evaluateSignal(item,data))dirty=true;
          }
        }catch(e){console.warn('Verificación:',e.message);}
      }
      if(dirty){saveHistory();renderHistory();}
    }finally{verifyBusy=false;}
  }
  function priceText(value){if(!Number.isFinite(Number(value)))return '—';const v=Math.abs(Number(value));return fmt(value,v<0.01?8:v<1?6:v<10?5:v<100?4:2);}
  function renderHistory(){
    const wins=history.filter(x=>x.state==='OBJETIVO').length,losses=history.filter(x=>x.state==='STOP').length;
    put('clTotalSignals',history.length);put('clTargetsHit',wins);put('clStopsHit',losses);put('clWinRate',wins+losses?fmt(wins/(wins+losses)*100,1)+'%':'—');
    let details=$('clV27Stats');
    if(!details){const host=$('historySection')||$('clScreenResults');if(host){details=document.createElement('p');details.id='clV27Stats';details.style.cssText='padding:12px;color:#b9c5df;font-size:13px;line-height:1.6';host.prepend(details);}}
    if(details){const pending=history.filter(x=>x.state==='PENDIENTE').length,active=history.filter(x=>x.state==='ACTIVADA').length,uncertain=history.filter(x=>x.state==='NO VERIFICABLE').length,notActivated=history.filter(x=>x.state==='NO ACTIVADA').length;details.textContent=`Motor V27 · Pendientes ${pending} · Activadas ${active} · No activadas ${notActivated} · No verificables ${uncertain} · Historial V26 separado: ${Array.isArray(legacyHistory)?legacyHistory.length:0} registros. Estadísticas V27 únicamente.`;}
    const body=$('signalLog');if(!body)return;body.replaceChildren();
    if(!history.length){const tr=document.createElement('tr'),td=document.createElement('td');td.colSpan=7;td.textContent='Sin señales V27 todavía. El historial anterior se conserva por separado.';tr.append(td);body.append(tr);return;}
    for(const signal of history.slice(0,30)){const tr=document.createElement('tr');for(const value of [new Date(signal.created*1000).toLocaleString('es-MX'),signal.tf,signal.symbol,signal.direction,priceText(signal.entry),signal.reason+' · TP '+priceText(signal.target)+' · SL '+priceText(signal.stop),signal.state]){const td=document.createElement('td');td.textContent=value;tr.append(td);}body.append(tr);}
  }
  function notifySignal(result){if(result.state!=='CONFIRMADA'||!('Notification'in window)||Notification.permission!=='granted')return;try{new Notification('CRYPTOLEXUZ V27 · '+result.market.label+' · '+result.direction,{body:'Señal técnica '+result.score+'/100 · Precio '+priceText(result.price),tag:result.market.symbol+'|'+result.direction+'|'+result.closedTime});}catch(e){console.warn('Notificación:',e);}}
  async function scan(force=false){
    if(document.hidden)return;if(scanBusy){if(force)scanAgain=true;return;}if(!force&&Date.now()-scanLast<55000)return;
    scanBusy=true;const id=scanRequest,items=markets(),results=[],errors=[];put('clScanStatus','V27 · Analizando ocho activos...');let cursor=0;
    async function worker(){while(cursor<items.length){const market=items[cursor++];try{results.push(rank(market,await frames(market)));}catch(e){errors.push(market.label+': '+e.message);}}}
    try{
      await Promise.all([worker(),worker()]);if(id!==scanRequest)return;
      results.sort((a,b)=>b.score-a.score);
      const body=$('clScanBody');
      if(body){
        body.classList.add('cl-scan-grid');
        body.replaceChildren();
        for(const r of results){
          const box=document.createElement('article');
          box.className='cl-scan-tile';
          const direction=r.direction==='LONG'?'long':r.direction==='SHORT'?'short':'neutral';
          const state=r.state==='CONFIRMADA'?'CONFIRMADA':r.state==='EN OBSERVACIÓN'?'EN OBSERVACIÓN':'SIN SEÑAL';
          box.classList.add('cl-tile-'+direction);
          const name=document.createElement('strong');name.className='cl-tile-symbol';name.textContent=r.market.label;
          const badge=document.createElement('span');badge.className='cl-tile-status';badge.textContent=state;
          const dir=document.createElement('span');dir.className='cl-tile-direction';dir.textContent=r.direction;
          const top=document.createElement('div');top.className='cl-tile-head';top.append(name,badge);
          // Estos niveles son una propuesta técnica, NO órdenes ni entradas ejecutadas.
          // Sólo mostrar precios cuando exista señal confirmada y ATR válido.
          const valid=r.state==='CONFIRMADA'&&['LONG','SHORT'].includes(r.direction)&&Number.isFinite(r.price)&&r.price>0&&Number.isFinite(r.atr)&&r.atr>0;
          const entry=valid?r.price:null;
          const stop=valid?(r.direction==='LONG'?entry-r.atr:entry+r.atr):null;
          const tp1=valid?(r.direction==='LONG'?entry+r.atr:entry-r.atr):null;
          const tp2=valid?(r.direction==='LONG'?entry+2*r.atr:entry-2*r.atr):null;
          const levels=document.createElement('div');levels.className='cl-tile-levels';
          for(const [label,value,kind] of [['Entrada',entry,'entry'],['Stop',stop,'stop'],['TP1',tp1,'tp'],['TP2',tp2,'tp']]){
            const cell=document.createElement('div');cell.className='cl-tile-level '+kind;
            const cap=document.createElement('small');cap.textContent=label;
            const price=document.createElement('b');price.textContent=value===null?'—':priceText(value);
            cell.append(cap,price);levels.append(cell);
          }
          const score=document.createElement('div');score.className='cl-tile-stat';score.textContent='Puntos: '+r.score+'/100';
          const p1=document.createElement('div');p1.className='cl-tile-stat';p1.textContent='Prob. TP1: —';
          const p2=document.createElement('div');p2.className='cl-tile-stat';p2.textContent='Prob. TP2: —';
          const detail=document.createElement('details');detail.className='cl-tile-details';
          const summary=document.createElement('summary');summary.textContent='Confirmaciones';
          const desc=document.createElement('p');desc.textContent=r.confirmations;
          detail.append(summary,desc);
          box.append(top,dir,levels,score,p1,p2,detail);body.append(box);
        }
        if(!results.length)body.textContent='Sin resultados disponibles.';
      }
      put('clScanErrors',errors.length?'Sin datos: '+errors.join(' · '):'');put('clScanStatus','V27 · Última revisión: '+new Date().toLocaleTimeString('es-MX')+' · '+results.length+'/'+items.length+' activos');scanLast=Date.now();
      // Primero actualizar estados; después decidir si puede abrirse una nueva señal.
      await verifySignals();for(const r of results)if(addSignal(r))notifySignal(r);
    }catch(e){put('clScanStatus','Error del escáner: '+e.message);console.warn('Escáner:',e);}finally{scanBusy=false;if(scanAgain){scanAgain=false;queueMicrotask(()=>scan(true));}}
  }
  function clearMarket(){chartRequest++;tickerRequest++;monitorRequest++;scanRequest++;scanLast=0;monitorLast=0;currentKey='';rows=[];zones=[];pivots=[];lastWS=0;levelSignature='';markerSignature='';series.price?.setData([]);series.volume?.setData([]);if(series.volume)seriesCache.delete(series.volume);for(const line of moving.values()){line.setData([]);seriesCache.delete(line);}for(const name of ['rsi','adx','plus','minus','ao']){series[name]?.setData([]);if(series[name])seriesCache.delete(series[name]);}for(const line of levelLines)try{series.price?.removePriceLine(line);}catch{}levelLines.length=0;series.price?.setMarkers([]);for(const id of ['ema21Value','ma55Value','rsiValue','adxValue','rsiChartValue','adxChartValue','aoValue'])put(id,'—');lastProfileRows=null;updateModules(true);put('price','—');put('message','Cargando nuevo mercado...');scheduleOverlay();}
  function marketChanged(){syncCommodity();syncTimeframes();clearMarket();connect();refresh();refreshTicker();monitor(true);scan(true);scheduleResize();}
  function events(){
    document.addEventListener('click',event=>{const target=event.target instanceof Element?event.target:event.target?.parentElement;if(!target)return;const tf=target.closest('[data-tf],[data-cl-tf]');if(tf){setTimeframe(tf.dataset.tf||tf.dataset.clTf);return;}const indicator=target.closest('[data-indicator]');if(indicator){toggleIndicator(indicator.dataset.indicator);return;}const osc=target.closest('[data-osc]');if(osc){const name=osc.dataset.osc;if(indicatorMap[String(name).toLowerCase()]||namedLines[String(name).toLowerCase()])toggleIndicator(name);}},false);
    $('refresh')?.addEventListener('click',()=>{refresh();refreshTicker();monitor(true);});
    $('chartReset')?.addEventListener('click',resetView);
    $('rsiSpeak')?.addEventListener('click',()=>{if(!('speechSynthesis'in window))return;speechSynthesis.cancel();const utterance=new SpeechSynthesisUtterance(lastRSI);utterance.lang='es-MX';speechSynthesis.speak(utterance);});
    if($('rsiSpeak')&&'speechSynthesis'in window)$('rsiSpeak').disabled=false;
    for(const id of ['symbol','interval','exchange','market'])$(id)?.addEventListener('change',marketChanged);
    document.addEventListener('visibilitychange',()=>{if(document.hidden)disconnect();else{connect();refresh();refreshTicker();monitor(true);scan(true);}});
    window.addEventListener('cryptolexuz:screen-change',e=>{if(e.detail?.screen==='charts')setTimeout(()=>{scheduleResize();if(!rows.length)refresh();},120);if(e.detail?.screen==='results')renderHistory();});
    window.addEventListener('cryptolexuz:indicator-settings-change',()=>{applySavedIndicators();});
    window.addEventListener('cryptolexuz:volume-profile-ready',()=>{profileAttached=null;attachProfile();updateModules(true);});
    syncTimeframes();updateButtons();
  }
  window.CryptolexuzIndicators={getSettings:()=>readSettings(),getEnabled:()=>Object.keys(prefs.indicators).filter(k=>prefs.indicators[k]),isEnabled:indicatorActive,setIndicator,toggleIndicator,refresh:()=>{applySavedIndicators();refresh();},awesomeOscillator,sma,ema,rsi,adx};
  function init(){populateTimeframes();syncCommodity();scannerUI();renderHistory();events();applySavedIndicators();if(!createCharts())return;window.CryptolexuzApp={version:'V30',refresh,refreshTicker,scan,monitor,resize,resetView,setTimeframe,setIndicator,toggleIndicator,getRows:()=>rows,getSelection:selection};connect();refresh();refreshTicker();monitor(true);scan(true);for(const [ms,fn] of [[15000,refresh],[10000,refreshTicker],[60000,monitor],[60000,scan],[60000,verifySignals]])timers.push(setInterval(()=>{if(!document.hidden)Promise.resolve(fn()).catch(console.warn);},ms));window.addEventListener('beforeunload',()=>{disconnect();for(const t of timers)clearInterval(t);});console.info('CRYPTOLEXUZ PRO — APP.JS V30 iniciado');}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
