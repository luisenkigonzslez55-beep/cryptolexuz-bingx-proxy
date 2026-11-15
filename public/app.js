

/* CRYPTOLEXUZ PRO — APP.JS V9 · WebSocket + indicadores */
"use strict";
(() => {
const $ = id => document.getElementById(id);
const C = {green:'#00f5a0',red:'#ff476c',purple:'#bb52ff',orange:'#ff9a35',blue:'#36c5ff',yellow:'#ffe15a',muted:'#a5b0cf'};
const enabled = new Set(['ema21','ma55','rsi','fvg']);
const supported = new Set(['ema21','ma55','ma100','ma200','rsi','adx','fvg','ifvg','liquidity','sweeps','support','resistance']);
const charts={}, series={}, maSeries={}, drawnLines=[];
let rows=[],zones=[],pivots=[],sweeps=[],chartUnlocked=false,loading=false,requestId=0,lastSymbol='',lastInterval='',lastMarket='',monitorBusy=false,lastMonitorAt=0,currentRSIText='';
let ws=null,wsTimer=null,wsGeneration=0,lastWsPriceAt=0,lastPrice=null,lastPriceSource='',tickerTimer=null,chartTimer=null;
const signalHistory=[],lastStates={};

const num=(v,d=2)=>{
  if(v===null||v===undefined||v==='')return '—';
  const n=Number(v);
  return Number.isFinite(n)
    ?n.toLocaleString('en-US',{minimumFractionDigits:d,maximumFractionDigits:d})
    :'—';
};
const value=(id,text)=>{
  const el=$(id);
  if(el)el.textContent=text;
};
const selected=()=>({
  exchange:($('exchange')?.value||'bingx').toLowerCase(),
  symbol:$('symbol')?.value||'BTC-USDT',
  tf:$('interval')?.value||'15m',
  market:$('market')?.value||'perpetual'
});
const setConnection=(text,color=C.green)=>{
  const el=$('connection');
  if(el){
    el.textContent='● '+text;
    el.style.color=color;
  }
};

function toSeconds(t){
  const n=typeof t==='string'&&!/^\d+$/.test(t)
    ?new Date(t).getTime()
    :Number(t);
  return n>1e12?Math.floor(n/1000):Math.floor(n);
}

function normalize(raw){
  let data=raw;
  if(!Array.isArray(data)){
    data=data?.data?.data??
      data?.data?.list??
      data?.data?.candles??
      data?.data??
      data?.list??
      data?.candles??[];
  }
  if(!Array.isArray(data))return [];
  const out=[];
  for(const x of data){
    const a=Array.isArray(x);
    const time=toSeconds(a?x[0]:x.time??x.timestamp??x.openTime??x.t);
    const open=Number(a?x[1]:x.open??x.o);
    const high=Number(a?x[2]:x.high??x.h);
    const low=Number(a?x[3]:x.low??x.l);
    const close=Number(a?x[4]:x.close??x.c);
    const volume=Number(a?x[5]:x.volume??x.vol??x.v??0);
    if(
      [time,open,high,low,close].every(Number.isFinite)&&
      time>0&&
      high>=Math.max(open,close)&&
      low<=Math.min(open,close)
    ){
      out.push({
        time,open,high,low,close,
        volume:Number.isFinite(volume)?volume:0
      });
    }
  }
  out.sort((a,b)=>a.time-b.time);
  return out.filter((x,i,a)=>!i||x.time!==a[i-1].time);
}

function sma(a,p){
  const o=Array(a.length).fill(null);
  let sum=0;
  for(let i=0;i<a.length;i++){
    sum+=a[i];
    if(i>=p)sum-=a[i-p];
    if(i>=p-1)o[i]=sum/p;
  }
  return o;
}

function ema(a,p){
  const o=Array(a.length).fill(null);
  if(a.length<p)return o;
  let sum=0;
  for(let i=0;i<p;i++)sum+=a[i];
  let prev=sum/p;
  o[p-1]=prev;
  const k=2/(p+1);
  for(let i=p;i<a.length;i++){
    prev=a[i]*k+prev*(1-k);
    o[i]=prev;
  }
  return o;
}

function rsi(a,p=14){
  const o=Array(a.length).fill(null);
  if(a.length<=p)return o;
  let g=0,l=0;
  for(let i=1;i<=p;i++){
    const d=a[i]-a[i-1];
    g+=Math.max(0,d);
    l+=Math.max(0,-d);
  }
  g/=p;
  l/=p;
  const calc=()=>l===0?(g===0?50:100):100-100/(1+g/l);
  o[p]=calc();
  for(let i=p+1;i<a.length;i++){
    const d=a[i]-a[i-1];
    g=(g*(p-1)+Math.max(0,d))/p;
    l=(l*(p-1)+Math.max(0,-d))/p;
    o[i]=calc();
  }
  return o;
}

function adx(a,p=14){
  const n=a.length;
  const ADX=Array(n).fill(null);
  const PLUS=Array(n).fill(null);
  const MINUS=Array(n).fill(null);
  if(n<p*2)return {adx:ADX,plus:PLUS,minus:MINUS};

  const tr=Array(n).fill(0);
  const pdm=Array(n).fill(0);
  const mdm=Array(n).fill(0);

  for(let i=1;i<n;i++){
    const up=a[i].high-a[i-1].high;
    const down=a[i-1].low-a[i].low;
    pdm[i]=up>down&&up>0?up:0;
    mdm[i]=down>up&&down>0?down:0;
    tr[i]=Math.max(
      a[i].high-a[i].low,
      Math.abs(a[i].high-a[i-1].close),
      Math.abs(a[i].low-a[i-1].close)
    );
  }

  let atr=0,sp=0,sm=0;
  for(let i=1;i<=p;i++){
    atr+=tr[i];
    sp+=pdm[i];
    sm+=mdm[i];
  }

  const dx=Array(n).fill(null);
  for(let i=p;i<n;i++){
    if(i>p){
      atr=atr-atr/p+tr[i];
      sp=sp-sp/p+pdm[i];
      sm=sm-sm/p+mdm[i];
    }
    const plus=atr?100*sp/atr:0;
    const minus=atr?100*sm/atr:0;
    PLUS[i]=plus;
    MINUS[i]=minus;
    dx[i]=plus+minus
      ?100*Math.abs(plus-minus)/(plus+minus)
      :0;
  }

  const first=p*2-1;
  let total=0;
  for(let i=p;i<=first;i++)total+=dx[i];
  ADX[first]=total/p;

  for(let i=first+1;i<n;i++){
    ADX[i]=(ADX[i-1]*(p-1)+dx[i])/p;
  }

  return {adx:ADX,plus:PLUS,minus:MINUS};
}

const lineData=(a,v)=>a.flatMap((x,i)=>
  Number.isFinite(v[i])?[{time:x.time,value:v[i]}]:[]
);

function chartOptions(height){
  return {
    width:300,
    height,
    layout:{
      background:{color:'#080e20'},
      textColor:'#c9d3ee',
      fontSize:11
    },
    grid:{
      vertLines:{color:'#15213a'},
      horzLines:{color:'#15213a'}
    },
    rightPriceScale:{
      borderColor:'#34456c',
      minimumWidth:65
    },
    timeScale:{
      borderColor:'#34456c',
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
      pinch:false
    }
  };
}

function createCharts(){
  if(!window.LightweightCharts){
    value('message','No se pudo cargar la biblioteca de gráficas.');
    setConnection('Error de gráfica',C.red);
    return false;
  }
  if(!$('chart'))return false;

  charts.price=LightweightCharts.createChart(
    $('chart'),chartOptions(360)
  );
  series.price=charts.price.addCandlestickSeries({
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
    maSeries[key]=charts.price.addLineSeries({
      color,
      lineWidth:2,
      priceLineVisible:false,
      lastValueVisible:false,
      crosshairMarkerVisible:false
    });
  }

  for(const [key,id,height] of [
    ['volume','volumeChart',115],
    ['rsi','rsiChart',145],
    ['adx','adxChart',145]
  ]){
    if($(id)){
      charts[key]=LightweightCharts.createChart(
        $(id),chartOptions(height)
      );
    }
  }

  if(charts.volume){
    series.volume=charts.volume.addHistogramSeries({
      priceFormat:{type:'volume'},
      priceScaleId:''
    });
    series.volume.priceScale().applyOptions({
      scaleMargins:{top:.12,bottom:0}
    });
  }

  if(charts.rsi){
    series.rsi=charts.rsi.addLineSeries({
      color:C.purple,
      lineWidth:2,
      priceLineVisible:false
    });
    for(const level of [30,50,70]){
      series.rsi.createPriceLine({
        price:level,
        color:level===50?'#607399':'#a24d9c',
        lineWidth:1,
        lineStyle:LightweightCharts.LineStyle.Dashed,
        axisLabelVisible:true
      });
    }
  }

  if(charts.adx){
    series.adx=charts.adx.addLineSeries({
      color:C.yellow,
      lineWidth:2,
      priceLineVisible:false
    });
    series.plus=charts.adx.addLineSeries({
      color:C.green,
      lineWidth:2,
      priceLineVisible:false
    });
    series.minus=charts.adx.addLineSeries({
      color:C.red,
      lineWidth:2,
      priceLineVisible:false
    });
    series.adx.createPriceLine({
      price:25,
      color:'#7d89a8',
      lineStyle:LightweightCharts.LineStyle.Dashed,
      axisLabelVisible:true
    });
  }

  const all=Object.values(charts);
  let syncing=false;

  for(const chart of all){
    chart.timeScale().subscribeVisibleLogicalRangeChange(range=>{
      if(syncing||!range)return;
      syncing=true;
      for(const other of all){
        if(other!==chart){
          try{
            other.timeScale().setVisibleLogicalRange(range);
          }catch(_){}
        }
      }
      syncing=false;
      drawZones();
    });
  }

  const resize=()=>{
    for(const [key,id] of [
      ['price','chart'],
      ['volume','volumeChart'],
      ['rsi','rsiChart'],
      ['adx','adxChart']
    ]){
      const el=$(id);
      if(
        el&&charts[key]&&
        el.clientWidth>0&&el.clientHeight>0
      ){
        charts[key].resize(el.clientWidth,el.clientHeight);
      }
    }
    resizeCanvas();
  };

  if(window.ResizeObserver){
    const observer=new ResizeObserver(resize);
    for(const id of [
      'chart','volumeChart','rsiChart','adxChart'
    ]){
      if($(id))observer.observe($(id));
    }
  }

  window.addEventListener('resize',resize);
  setTimeout(resize,100);
  setChartNavigation(false);
  return true;
}

function setChartNavigation(unlocked){
  chartUnlocked=unlocked;
  if(!charts.price)return;

  charts.price.applyOptions({
    handleScroll:{
      mouseWheel:true,
      pressedMouseMove:true,
      horzTouchDrag:unlocked,
      vertTouchDrag:unlocked
    },
    handleScale:{
      mouseWheel:true,
      pinch:unlocked
    }
  });

  value(
    'chartNavigation',
    unlocked?'🔓 Bloquear':'🔒 Desbloquear'
  );
  value(
    'chartTouchStatus',
    unlocked
      ?'Gráfica desbloqueada: arrastra o usa dos dedos.'
      :'Gráfica bloqueada: desliza la página con un dedo.'
  );
  $('chartNavigation')?.setAttribute(
    'aria-pressed',String(unlocked)
  );
}

function resetView(){
  if(!charts.price||!rows.length)return;
  charts.price.timeScale().setVisibleLogicalRange({
    from:Math.max(0,rows.length-50),
    to:rows.length+3
  });
}

function detectPivots(a){
  const found=[];
  for(let i=4;i<a.length-4;i++){
    let hi=true,lo=true;
    for(let j=i-4;j<=i+4;j++){
      if(i===j)continue;
      if(a[j].high>=a[i].high)hi=false;
      if(a[j].low<=a[i].low)lo=false;
    }
    if(hi){
      found.push({
        index:i,
        price:a[i].high,
        type:'high'
      });
    }
    if(lo){
      found.push({
        index:i,
        price:a[i].low,
        type:'low'
      });
    }
  }
  return found.slice(-40);
}

function detectFVG(a){
  const found=[];
  for(let i=2;i<a.length;i++){
    const bull=a[i].low>a[i-2].high;
    const bear=a[i].high<a[i-2].low;
    if(!bull&&!bear)continue;

    const top=bull?a[i].low:a[i-2].low;
    const bottom=bull?a[i-2].high:a[i].high;
    const middle=(top+bottom)/2;
    if((top-bottom)/middle<.00035)continue;

    let end=a.length-1;
    let filled=false;
    let inverted=false;

    for(let j=i+1;j<a.length;j++){
      if(bull&&a[j].low<=bottom){
        end=j;
        filled=true;
        inverted=a[j].close<bottom;
        break;
      }
      if(bear&&a[j].high>=top){
        end=j;
        filled=true;
        inverted=a[j].close>top;
        break;
      }
    }

    found.push({
      start:i-2,
      end,top,bottom,bull,filled,inverted
    });
  }
  return found.slice(-80);
}

function detectSweeps(a){
  const found=[];
  for(let i=20;i<a.length-1;i++){
    const previous=a.slice(i-20,i);
    const high=Math.max(...previous.map(x=>x.high));
    const low=Math.min(...previous.map(x=>x.low));

    if(a[i].high>high&&a[i].close<high){
      found.push({
        time:a[i].time,
        position:'aboveBar',
        color:C.red,
        shape:'arrowDown',
        text:'Barrido ↑'
      });
    }

    if(a[i].low<low&&a[i].close>low){
      found.push({
        time:a[i].time,
        position:'belowBar',
        color:C.green,
        shape:'arrowUp',
        text:'Barrido ↓'
      });
    }
  }
  return found.slice(-25);
}

function clearPriceLines(){
  for(const line of drawnLines){
    try{
      series.price.removePriceLine(line);
    }catch(_){}
  }
  drawnLines.length=0;
}

function addLevel(price,color,title){
  if(!Number.isFinite(price))return;
  drawnLines.push(series.price.createPriceLine({
    price,
    color,
    lineWidth:1,
    lineStyle:LightweightCharts.LineStyle.Dashed,
    axisLabelVisible:true,
    title
  }));
}

function updateLevels(){
  clearPriceLines();
  const recent=pivots.slice(-18);

  if(enabled.has('support')){
    const x=recent.filter(x=>x.type==='low').at(-1);
    if(x)addLevel(x.price,C.green,'Soporte');
  }

  if(enabled.has('resistance')){
    const x=recent.filter(x=>x.type==='high').at(-1);
    if(x)addLevel(x.price,C.red,'Resistencia');
  }

  if(enabled.has('liquidity')){
    for(const x of recent.filter(x=>x.type==='high').slice(-2)){
      addLevel(x.price,C.red,'Máximo previo');
    }
    for(const x of recent.filter(x=>x.type==='low').slice(-2)){
      addLevel(x.price,C.green,'Mínimo previo');
    }
  }
}

function resizeCanvas(){
  const canvas=$('zonesCanvas');
  const area=$('priceChartArea');
  if(!canvas||!area)return;

  const dpr=Math.min(window.devicePixelRatio||1,2);
  canvas.width=Math.round(area.clientWidth*dpr);
  canvas.height=Math.round(area.clientHeight*dpr);

  const ctx=canvas.getContext('2d');
  if(ctx)ctx.setTransform(dpr,0,0,dpr,0,0);
  drawZones();
}

function drawZones(){
  const canvas=$('zonesCanvas');
  const area=$('priceChartArea');
  if(!canvas||!area||!charts.price||!rows.length)return;

  const ctx=canvas.getContext('2d');
  if(!ctx)return;

  const width=area.clientWidth;
  const height=area.clientHeight;
  ctx.clearRect(0,0,width,height);

  if(!enabled.has('fvg')&&!enabled.has('ifvg'))return;

  const scale=charts.price.timeScale();
  const maxX=Math.max(0,width-70);

  for(const z of zones.filter(z=>
    (!z.filled&&enabled.has('fvg'))||
    (z.inverted&&enabled.has('ifvg'))
  ).slice(-18)){
    const x1=scale.logicalToCoordinate(z.start);
    const x2=scale.logicalToCoordinate(z.end);
    const y1=series.price.priceToCoordinate(z.top);
    const y2=series.price.priceToCoordinate(z.bottom);

    if(![x1,x2,y1,y2].every(Number.isFinite))continue;

    const left=Math.max(0,x1);
    const right=Math.min(maxX,x2);
    const top=Math.max(0,Math.min(y1,y2));
    const bottom=Math.min(height,Math.max(y1,y2));

    if(right<=left||bottom<=top)continue;

    ctx.fillStyle=z.inverted
      ?'rgba(255,225,90,.10)'
      :z.bull
        ?'rgba(0,245,160,.09)'
        :'rgba(255,71,108,.09)';

    ctx.fillRect(left,top,right-left,bottom-top);

    ctx.strokeStyle=z.inverted
      ?'rgba(255,225,90,.50)'
      :z.bull
        ?'rgba(0,245,160,.40)'
        :'rgba(255,71,108,.40)';

    ctx.lineWidth=1;
    ctx.strokeRect(left,top,right-left,bottom-top);
  }
}

function rsiInterpretation(v){
  if(!Number.isFinite(v))return 'RSI no disponible.';
  if(v<30)return 'RSI '+num(v,1)+': zona de sobreventa. Puede existir presión vendedora intensa; no confirma un rebote.';
  if(v<40)return 'RSI '+num(v,1)+': predominio vendedor, todavía sin sobreventa.';
  if(v<50)return 'RSI '+num(v,1)+': impulso ligeramente bajista.';
  if(v<60)return 'RSI '+num(v,1)+': impulso ligeramente alcista.';
  if(v<70)return 'RSI '+num(v,1)+': predominio comprador.';
  return 'RSI '+num(v,1)+': zona de sobrecompra. No significa que el precio deba caer inmediatamente.';
}

function adxInterpretation(ax,plus,minus){
  if(![ax,plus,minus].every(Number.isFinite)){
    return 'ADX no disponible.';
  }

  const strength=ax<20
    ?'tendencia débil o mercado sin fuerza definida'
    :ax<25
      ?'tendencia en desarrollo'
      :ax<40
        ?'tendencia con fuerza'
        :'tendencia muy fuerte';

  const direction=plus>minus
    ?'predominio direccional comprador'
    :minus>plus
      ?'predominio direccional vendedor'
      :'equilibrio direccional';

  return 'ADX '+num(ax,1)+': '+strength+
    '. +DI '+num(plus,1)+
    ' y −DI '+num(minus,1)+
    ': '+direction+
    '. El ADX mide fuerza, no dirección.';
}

function volumeInterpretation(a){
  if(a.length<22)return 'Volumen insuficiente.';

  const closed=a.slice(0,-1);
  const last=closed.at(-1);
  const previous=closed.slice(-21,-1);
  const average=previous.reduce(
    (s,x)=>s+x.volume,0
  )/previous.length;

  if(!average)return 'No hay volumen suficiente.';

  const ratio=last.volume/average;
  const direction=last.close>=last.open
    ?'alcista'
    :'bajista';

  let strength='volumen cercano al promedio';
  if(ratio>=1.8)strength='volumen muy elevado';
  else if(ratio>=1.3)strength='volumen superior al promedio';
  else if(ratio<.7)strength='volumen reducido';

  return 'Última vela cerrada '+direction+
    ', con '+strength+
    ' ('+num(ratio,2)+
    ' veces el promedio de veinte velas). '+
    'El color de la vela no identifica por sí solo compras y ventas agresoras.';
}

function updateIndicators(){
  if(!rows.length||!series.price)return;

  const closes=rows.map(x=>x.close);
  const e21=ema(closes,21);
  const m55=sma(closes,55);
  const m100=sma(closes,100);
  const m200=sma(closes,200);
  const rv=rsi(closes);
  const av=adx(rows);

  for(const [key,arr] of Object.entries({
    ema21:e21,
    ma55:m55,
    ma100:m100,
    ma200:m200
  })){
    maSeries[key]?.setData(
      enabled.has(key)?lineData(rows,arr):[]
    );
  }

  series.rsi?.setData(
    enabled.has('rsi')?lineData(rows,rv):[]
  );
  series.adx?.setData(
    enabled.has('adx')?lineData(rows,av.adx):[]
  );
  series.plus?.setData(
    enabled.has('adx')?lineData(rows,av.plus):[]
  );
  series.minus?.setData(
    enabled.has('adx')?lineData(rows,av.minus):[]
  );

  const i=Math.max(0,rows.length-2);

  value('ema21Value',num(e21[i]));
  value('ma55Value',num(m55[i]));
  value('rsiValue',num(rv[i],1));
  value('adxValue',num(av.adx[i],1));
  value('rsiChartValue',num(rv[i],1));
  value('adxChartValue',num(av.adx[i],1));

  currentRSIText=rsiInterpretation(rv[i]);
  value('rsiInterpretation',currentRSIText);
  value(
    'adxInterpretation',
    adxInterpretation(av.adx[i],av.plus[i],av.minus[i])
  );
  value('volumeInterpretation',volumeInterpretation(rows));

  let trend='Mixta';

  if(Number.isFinite(e21[i])&&Number.isFinite(m55[i])){
    if(closes[i]>e21[i]&&e21[i]>m55[i]){
      trend='Sesgo alcista';
    }else if(closes[i]<e21[i]&&e21[i]<m55[i]){
      trend='Sesgo bajista';
    }
  }

  value('indicatorReadout',trend+'. '+currentRSIText);

  pivots=detectPivots(rows);
  zones=detectFVG(rows);
  sweeps=detectSweeps(rows);

  updateLevels();

  series.price.setMarkers(
    enabled.has('sweeps')?sweeps:[]
  );

  if($('rsiSection')){
    $('rsiSection').hidden=!enabled.has('rsi');
  }
  if($('adxSection')){
    $('adxSection').hidden=!enabled.has('adx');
  }

  requestAnimationFrame(()=>{
    for(const [key,id] of [
      ['adx','adxChart'],
      ['rsi','rsiChart']
    ]){
      const el=$(id);
      if(enabled.has(key)&&el?.clientWidth&&charts[key]){
        charts[key].resize(el.clientWidth,el.clientHeight);
      }
    }
    drawZones();
  });
}

function analyzeSignal(a){
  const closed=a.slice(0,-1);

  if(closed.length<60){
    return {
      state:'SIN DATOS',
      direction:'neutral',
      detail:'No hay suficientes velas cerradas.',
      metrics:'Esperando historial',
      price:null
    };
  }

  const closes=closed.map(x=>x.close);
  const last=closed.at(-1);
  const e=ema(closes,21).at(-1);
  const m=sma(closes,55).at(-1);
  const r=rsi(closes).at(-1);
  const aData=adx(closed);
  const ax=aData.adx.at(-1);
  const plus=aData.plus.at(-1);
  const minus=aData.minus.at(-1);

  if(![e,m,r,ax,plus,minus].every(Number.isFinite)){
    return {
      state:'SIN DATOS',
      direction:'neutral',
      detail:'Indicadores todavía no disponibles.',
      metrics:'Esperando cálculos',
      price:last.close
    };
  }

  let bull=0,bear=0;
  const reasons=[];

  if(last.close>e){
    bull++;
    reasons.push('precio sobre EMA 21');
  }else{
    bear++;
    reasons.push('precio bajo EMA 21');
  }

  if(e>m){
    bull++;
    reasons.push('EMA 21 sobre MA 55');
  }else{
    bear++;
    reasons.push('EMA 21 bajo MA 55');
  }

  if(r>=55)bull++;
  else if(r<=45)bear++;

  if(plus>minus)bull++;
  else if(minus>plus)bear++;

  const strong=ax>=25;
  const developing=ax>=20;

  let state='LATERAL / MIXTO';
  let direction='neutral';

  if(bull>=3&&bull>bear){
    state='SESGO ALCISTA';
    direction='bullish';
  }else if(bear>=3&&bear>bull){
    state='SESGO BAJISTA';
    direction='bearish';
  }

  const strength=strong
    ?'ADX confirma fuerza de tendencia'
    :developing
      ?'ADX muestra fuerza en desarrollo'
      :'ADX indica fuerza limitada';

  let opportunity='Sin entrada confirmada';

  if(direction==='bullish'&&bull===4&&strong&&r<70){
    opportunity='Posible LONG; requiere confirmación del precio';
  }

  if(direction==='bearish'&&bear===4&&strong&&r>30){
    opportunity='Posible SHORT; requiere confirmación del precio';
  }

  return {
    state,
    direction,
    detail:reasons.join(' · ')+'. '+strength+
      '. '+opportunity+'.',
    metrics:'RSI '+num(r,1)+
      ' · ADX '+num(ax,1)+
      ' · +DI '+num(plus,1)+
      ' · −DI '+num(minus,1)+
      ' · Confluencia '+Math.max(bull,bear)+'/4',
    price:last.close
  };
}

function recordSignal(tf,symbol,result){
  const key=symbol+'|'+tf;
  if(lastStates[key]===result.state)return;

  lastStates[key]=result.state;
  if(result.state==='SIN DATOS')return;

  signalHistory.unshift({
    time:new Date().toLocaleTimeString('es-MX'),
    tf,symbol,
    state:result.state,
    price:result.price,
    detail:result.detail
  });

  if(signalHistory.length>30){
    signalHistory.length=30;
  }
  renderHistory();
}

function renderHistory(){
  const tbody=$('signalLog');
  if(!tbody)return;
  tbody.replaceChildren();

  for(const s of signalHistory){
    const tr=document.createElement('tr');

    for(const text of [
      s.time,s.tf,s.symbol,s.state,
      num(s.price),s.detail,'Observación'
    ]){
      const td=document.createElement('td');
      td.textContent=text;
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
}

function showSignal(tf,symbol,result){
  const suffix=tf==='5m'?'5':'15';

  value('state'+suffix,result.state);
  value('detail'+suffix,result.detail);
  value('metrics'+suffix,result.metrics);

  const state=$('state'+suffix);
  if(state)state.className='state '+result.direction;

  const heading=state
    ?.closest('.signal-card')
    ?.querySelector('h3');

  if(heading){
    heading.textContent=symbol+' / '+
      (tf==='5m'?'5':'15')+' minutos';
  }

  recordSignal(tf,symbol,result);
}

async function getJSON(url,timeout=12000){
  const controller=new AbortController();
  const timer=setTimeout(
    ()=>controller.abort(),timeout
  );

  try{
    const response=await fetch(url,{
      signal:controller.signal,
      cache:'no-store'
    });
    if(!response.ok){
      throw new Error('HTTP '+response.status);
    }
    return await response.json();
  }finally{
    clearTimeout(timer);
  }
}

const candleURL=(
  market,symbol,tf,limit=300,exchange='bingx'
)=>'/api/exchange/'+encodeURIComponent(exchange)+
  '/klines/'+encodeURIComponent(symbol)+
  '?market='+encodeURIComponent(market)+
  '&interval='+encodeURIComponent(tf)+
  '&limit='+limit;

const tickerURL=(
  market,symbol,exchange='bingx'
)=>'/api/exchange/'+encodeURIComponent(exchange)+
  '/ticker/'+encodeURIComponent(symbol)+
  '?market='+encodeURIComponent(market);

function unwrapTicker(raw){
  let d=raw?.data??raw;
  if(Array.isArray(d))d=d[0]??{};
  if(d?.data)d=d.data;
  if(Array.isArray(d))d=d[0]??{};
  return d||{};
}

function setLivePrice(price,source='websocket'){
  const p=Number(price);
  if(!Number.isFinite(p)||p<=0)return;

  lastPrice=p;
  lastPriceSource=source;

  value('price',num(p));
  value(
    'updated',
    new Date().toLocaleTimeString('es-MX')
  );

  if(source==='websocket'){
    lastWsPriceAt=Date.now();
    setConnection(
      selected().exchange.toUpperCase()+' · en vivo',
      C.green
    );
  }else if(Date.now()-lastWsPriceAt>7000){
    setConnection(
      selected().exchange.toUpperCase()+' · respaldo REST',
      C.yellow
    );
  }
}

function updateTicker(raw,allowPrice=true){
  const d=unwrapTicker(raw);

  const price=Number(
    d.lastPrice??d.last??d.price??d.close??d.c
  );
  const high=Number(
    d.highPrice??d.high24h??d.high??d.h
  );
  const low=Number(
    d.lowPrice??d.low24h??d.low??d.l
  );
  const open=Number(
    d.openPrice??d.open24h??d.open??d.o
  );
  const volume=Number(
    d.volume??d.volume24h??d.vol??d.v
  );

  let change=Number(
    d.priceChangePercent??
    d.changePercent??
    d.changeRate
  );

  if(
    !Number.isFinite(change)&&
    Number.isFinite(price)&&
    Number.isFinite(open)&&
    open!==0
  ){
    change=(price/open-1)*100;
  }

  if(allowPrice&&Number.isFinite(price)){
    setLivePrice(price,'rest');
  }

  value('high',num(high));
  value('low',num(low));
  value('open',num(open));
  value('volume',num(volume,0));

  const el=$('change');
  if(el){
    el.textContent=Number.isFinite(change)
      ?(change>=0?'+':'')+num(change)+'%'
      :'—';

    el.classList.toggle('negative',change<0);
    el.style.color=change<0?C.red:C.green;
  }

  value('bid',num(d.bidPrice??d.bid??d.bestBid));
  value('ask',num(d.askPrice??d.ask??d.bestAsk));
}

async function monitor(symbol,market,exchange,force=false){
  if(monitorBusy)return;
  if(!force&&Date.now()-lastMonitorAt<60000)return;

  monitorBusy=true;

  try{
    const [five,fifteen]=await Promise.all([
      getJSON(candleURL(market,symbol,'5m',300,exchange)),
      getJSON(candleURL(market,symbol,'15m',300,exchange))
    ]);

    const now=selected();

    if(
      now.symbol!==symbol||
      now.market!==market||
      now.exchange!==exchange
    )return;

    showSignal(
      '5m',symbol,analyzeSignal(normalize(five))
    );
    showSignal(
      '15m',symbol,analyzeSignal(normalize(fifteen))
    );

    value('engineState','ANALIZANDO');
    lastMonitorAt=Date.now();
  }catch(error){
    value('engineState','SIN CONEXIÓN');
    console.warn('Monitor:',error.message);
  }finally{
    monitorBusy=false;
  }
}

function applyCandles(data,symbol,tf,market){
  const changed=
    symbol!==lastSymbol||
    tf!==lastInterval||
    market!==lastMarket;

  let previousRange=null;

  if(!changed){
    try{
      previousRange=charts.price
        .timeScale()
        .getVisibleLogicalRange();
    }catch(_){}
  }

  rows=data;
  series.price.setData(rows);

  series.volume?.setData(rows.map(x=>({
    time:x.time,
    value:x.volume,
    color:x.close>=x.open
      ?'rgba(0,245,160,.70)'
      :'rgba(255,71,108,.70)'
  })));

  updateIndicators();

  if(changed){
    lastSymbol=symbol;
    lastInterval=tf;
    lastMarket=market;
    resetView();
  }else if(previousRange){
    try{
      charts.price.timeScale()
        .setVisibleLogicalRange(previousRange);
    }catch(_){}
  }

  value('chartTitle',symbol+' · '+tf);
  value('volumeLabel',symbol.split('-')[0]);

  const area=$('priceChartArea');

  if(area&&!$('zonesCanvas')?.width){
    resizeCanvas();
  }else{
    drawZones();
  }
}

async function refresh(){
  if(loading||!series.price)return;

  loading=true;
  const id=++requestId;
  const {symbol,tf,market,exchange}=selected();

  value(
    'status',
    'Consultando velas de '+exchange.toUpperCase()+'...'
  );

  try{
    const candleResult=await getJSON(
      candleURL(market,symbol,tf,300,exchange)
    );

    if(id!==requestId)return;

    const now=selected();
    if(
      now.symbol!==symbol||
      now.tf!==tf||
      now.market!==market||
      now.exchange!==exchange
    )return;

    const data=normalize(candleResult);

    if(!data.length){
      throw new Error('No se recibieron velas válidas');
    }

    applyCandles(data,symbol,tf,market);

    value(
      'status',
      'Velas de '+exchange.toUpperCase()+' actualizadas'
    );
    value('message','');

    monitor(symbol,market,exchange);
  }catch(error){
    console.warn('CRYPTOLEXUZ velas:',error);
    value(
      'status',
      'Error de velas: '+error.message
    );
    value(
      'message',
      'No se pudieron actualizar las velas. '+
      'Comprueba la conexión y el servidor.'
    );
  }finally{
    loading=false;
  }
}

async function refreshTicker(){
  const {symbol,market,exchange}=selected();

  try{
    const raw=await getJSON(
      tickerURL(market,symbol,exchange),8000
    );

    const now=selected();

    if(
      now.symbol!==symbol||
      now.market!==market||
      now.exchange!==exchange
    )return;

    updateTicker(
      raw,
      Date.now()-lastWsPriceAt>7000
    );
  }catch(error){
    console.warn('Ticker REST:',error.message);
  }
}

function disconnectWS(){
  wsGeneration++;

  if(wsTimer){
    clearTimeout(wsTimer);
    wsTimer=null;
  }

  if(ws){
    const old=ws;
    ws=null;
    old.onopen=null;
    old.onmessage=null;
    old.onerror=null;
    old.onclose=null;

    try{
      old.close();
    }catch(_){}
  }
}

function connectWS(){
  disconnectWS();

  const generation=wsGeneration;
  const {exchange,symbol,market}=selected();

  const scheme=location.protocol==='https:'
    ?'wss:'
    :'ws:';

  const url=scheme+'//'+location.host+
    '/ws?exchange='+encodeURIComponent(exchange)+
    '&market='+encodeURIComponent(market)+
    '&symbol='+encodeURIComponent(symbol);

  lastWsPriceAt=0;

  setConnection(
    exchange.toUpperCase()+' · conectando',
    C.yellow
  );

  let socket;

  try{
    socket=new WebSocket(url);
  }catch(error){
    scheduleReconnect(generation);
    return;
  }

  ws=socket;

  socket.onopen=()=>{
    if(generation!==wsGeneration)return;
    setConnection(
      exchange.toUpperCase()+' · esperando precios',
      C.yellow
    );
  };

  socket.onmessage=event=>{
    if(generation!==wsGeneration)return;

    let data;
    try{
      data=JSON.parse(event.data);
    }catch(_){
      return;
    }

    if(data.type==='price'){
      const price=Number(data.price);

      if(Number.isFinite(price)&&price>0){
        setLivePrice(
          price,
          data.source==='websocket'
            ?'websocket'
            :'rest'
        );
      }
    }else if(data.type==='status'){
      if(data.status==='reconnecting'){
        setConnection(
          exchange.toUpperCase()+' · reconectando',
          C.yellow
        );
      }
    }
  };

  socket.onerror=()=>{
    if(generation===wsGeneration){
      setConnection(
        exchange.toUpperCase()+
        ' · conexión interrumpida',
        C.yellow
      );
    }
  };

  socket.onclose=()=>{
    if(generation!==wsGeneration)return;
    ws=null;

    setConnection(
      exchange.toUpperCase()+' · reconectando',
      C.yellow
    );

    scheduleReconnect(generation);
  };
}

function scheduleReconnect(generation){
  if(generation!==wsGeneration)return;

  if(wsTimer)clearTimeout(wsTimer);

  wsTimer=setTimeout(()=>{
    if(
      generation===wsGeneration&&
      !document.hidden
    ){
      connectWS();
    }
  },3000);
}

function toggleIndicator(key){
  if(!supported.has(key))return;

  if(enabled.has(key)){
    enabled.delete(key);
  }else{
    enabled.add(key);
  }

  updateButtons();
  updateIndicators();
}

function updateButtons(){
  document.querySelectorAll('[data-indicator]')
    .forEach(button=>{
      const key=button.dataset.indicator;

      if(!supported.has(key)){
        button.disabled=true;
        return;
      }

      const active=enabled.has(key);
      button.classList.toggle('active',active);
      button.setAttribute(
        'aria-pressed',String(active)
      );
    });
}

function speakRSI(){
  if(!('speechSynthesis' in window))return;

  speechSynthesis.cancel();

  const speech=new SpeechSynthesisUtterance(
    currentRSIText||'El RSI no está disponible.'
  );

  speech.lang='es-MX';
  speech.rate=.95;
  speechSynthesis.speak(speech);
}

function setupEvents(){
  document.querySelectorAll('[data-indicator]')
    .forEach(button=>{
      button.addEventListener('click',()=>{
        toggleIndicator(button.dataset.indicator);
      });
    });

  $('refresh')?.addEventListener('click',()=>{
    refresh();
    refreshTicker();
  });

  $('chartNavigation')?.addEventListener(
    'click',()=>{
      setChartNavigation(!chartUnlocked);
    }
  );

  $('chartReset')?.addEventListener(
    'click',resetView
  );

  $('rsiSpeak')?.addEventListener(
    'click',speakRSI
  );

  if($('rsiSpeak')&&'speechSynthesis' in window){
    $('rsiSpeak').disabled=false;
    $('rsiSpeak').textContent=
      '🔊 Escuchar interpretación RSI';
  }

  for(const id of [
    'symbol','interval','market','exchange'
  ]){
    $(id)?.addEventListener('change',()=>{
      lastMonitorAt=0;
      requestId++;
      loading=false;
      lastWsPriceAt=0;
      lastPrice=null;

      value('price','—');

      connectWS();
      refresh();
      refreshTicker();
    });
  }

  updateButtons();
}

function init(){
  setupEvents();

  if(!createCharts())return;

  connectWS();
  refresh();
  refreshTicker();

  chartTimer=setInterval(()=>{
    if(!document.hidden)refresh();
  },15000);

  tickerTimer=setInterval(()=>{
    if(!document.hidden)refreshTicker();
  },10000);

  document.addEventListener(
    'visibilitychange',()=>{
      if(document.hidden){
        disconnectWS();
      }else{
        connectWS();
        refresh();
        refreshTicker();
      }
    }
  );

  window.addEventListener(
    'beforeunload',disconnectWS
  );
}

if(document.readyState==='loading'){
  document.addEventListener(
    'DOMContentLoaded',init
  );
}else{
  init();
}
})();
