
/*
 CRYPTOLEXUZ PRO — CAJAS DE RANGOS V2
 Compatible con Lightweight Charts 4.2.x

 Mejoras:
 - Interruptores independientes
 - Caja verde de rango de velas
 - Caja morada de lateralización
 - Caja de penúltima vela
 - Inicio y fin de cada rango
 - Línea central del 50% opcional
 - Niveles 4H, diario y semanal separados
 - Etiquetas ordenadas
 - Sin ejecución de órdenes reales
*/
"use strict";

(() => {
  if (window.__clRangeBoxesV2) return;
  window.__clRangeBoxesV2 = true;

  const $ = id => document.getElementById(id);

  const TF = {
    "1m":60,"3m":180,"5m":300,
    "15m":900,"30m":1800,
    "1h":3600,"2h":7200,
    "4h":14400,"6h":21600,
    "8h":28800,"12h":43200,
    "1d":86400,"1w":604800
  };

  const GOLD="NCCOGOLD2USD-USDT";
  const OIL="NCCO1OILWTI2USD-USDT";

  const defaults = {
    range:true,
    sideways:false,
    previous:false,
    midpoint:false,
    higher4h:false,
    higher1d:false,
    higher1w:false,
    boundaries:true,
    lookback:24
  };

  const config={...defaults};

  const STORE="cryptolexuz-range-boxes-v2";

  try {
    const saved=JSON.parse(
      localStorage.getItem(STORE)||"null"
    );

    if(saved&&typeof saved==="object"){
      for(const k of Object.keys(defaults)){
        if(
          k==="lookback" &&
          [12,24,36,48,72].includes(
            Number(saved[k])
          )
        ){
          config[k]=Number(saved[k]);
        }else if(
          k!=="lookback" &&
          typeof saved[k]==="boolean"
        ){
          config[k]=saved[k];
        }
      }
    }
  }catch(e){}

  function save(){
    try{
      localStorage.setItem(
        STORE,JSON.stringify(config)
      );
    }catch(e){}
  }

  let chart=null;
  let candle=null;
  let rows=[];
  let currentKey="";
  let generation=0;
  let higher=[];
  let attachedChart=null;
  let polling=false;
  let timer=null;
  let drawPending=false;
  let initialized=false;

  const cached=new Map();

  const canvas=document.createElement("canvas");
  canvas.id="clRangeOverlay";

  canvas.style.cssText=`
    position:absolute;
    inset:0;
    width:100%;
    height:100%;
    pointer-events:none;
    z-index:7;
  `;

  const panel=document.createElement("section");
  panel.id="clRangeControls";

  panel.style.cssText=`
    display:flex;
    flex-direction:column;
    gap:12px;
    padding:14px;
    margin:12px 0;
    background:#111a31;
    border:1px solid #35436a;
    border-radius:14px;
    color:#e2eaff;
    font:12px system-ui,sans-serif;
  `;

  const heading=document.createElement("div");

  heading.style.cssText=`
    display:flex;
    align-items:center;
    justify-content:space-between;
    gap:8px;
  `;

  heading.innerHTML=`
    <strong style="font-size:14px">
      🟩 Cajas de rangos
    </strong>
    <span style="
      font-size:10px;
      color:#91a4c6
    ">V2</span>
  `;

  const grid=document.createElement("div");

  grid.style.cssText=`
    display:grid;
    grid-template-columns:
      repeat(auto-fit,minmax(145px,1fr));
    gap:9px;
  `;

  function addToggle(text,key,color){
    const label=document.createElement("label");

    label.style.cssText=`
      display:flex;
      align-items:center;
      gap:8px;
      min-height:35px;
      padding:7px 9px;
      border:1px solid #2b395b;
      border-radius:9px;
      background:#0c152b;
      cursor:pointer;
      color:#dbe5ff;
    `;

    const input=document.createElement("input");
    input.type="checkbox";
    input.checked=config[key];

    input.style.accentColor=color;

    input.addEventListener("change",()=>{
      config[key]=input.checked;
      save();
      redrawSoon();
      if(key.startsWith("higher")){
        refreshHigher();
      }
    });

    label.append(
      input,
      document.createTextNode(text)
    );

    grid.append(label);
  }

  addToggle(
    "🟩 Rango de velas",
    "range","#00d99a"
  );

  addToggle(
    "🟪 Lateralización",
    "sideways","#bb52ff"
  );

  addToggle(
    "🟦 Penúltima vela",
    "previous","#36c5ff"
  );

  addToggle(
    "📏 Línea 50%",
    "midpoint","#ffe15a"
  );

  addToggle(
    "↔ Inicio y fin",
    "boundaries","#00d99a"
  );

  addToggle(
    "4H · Máx / Mín",
    "higher4h","#b38aff"
  );

  addToggle(
    "Diario · Máx / Mín",
    "higher1d","#36c5ff"
  );

  addToggle(
    "Semanal · Máx / Mín",
    "higher1w","#ff9a35"
  );

  const selectorRow=document.createElement("div");

  selectorRow.style.cssText=`
    display:flex;
    align-items:center;
    gap:10px;
    flex-wrap:wrap;
  `;

  const selectorLabel=document.createElement("span");
  selectorLabel.textContent="Velas del rango:";

  const selector=document.createElement("select");

  selector.style.cssText=`
    background:#0b1429;
    color:#e8e9ff;
    border:1px solid #485579;
    border-radius:7px;
    padding:7px 10px;
    font-size:12px;
  `;

  [12,24,36,48,72].forEach(n=>{
    const option=document.createElement("option");
    option.value=n;
    option.textContent=n+" velas";
    option.selected=n===config.lookback;
    selector.append(option);
  });

  selector.addEventListener("change",()=>{
    config.lookback=Number(selector.value);
    save();
    redrawSoon();
  });

  selectorRow.append(selectorLabel,selector);

  const note=document.createElement("div");

  note.style.cssText=`
    color:#93a8c9;
    font-size:11px;
    line-height:1.5;
  `;

  note.textContent=
    "Las cajas utilizan velas cerradas. "+
    "Activa solamente las herramientas "+
    "que necesites.";

  panel.append(
    heading,
    grid,
    selectorRow,
    note
  );

  function selection(){
    const symbol=$("symbol")?.value||"BTC-USDT";
    const commodity=[GOLD,OIL].includes(symbol);

    return {
      symbol,
      tf:$("interval")?.value||"5m",
      exchange:commodity
        ?"bingx"
        :$("exchange")?.value||"bingx",
      market:commodity
        ?"perpetual"
        :$("market")?.value||"perpetual"
    };
  }

  function makeKey(s){
    return [
      s.exchange,s.market,s.symbol,s.tf
    ].join("|");
  }

  function normalize(payload){
    const raw=[
      payload?.data?.data,
      payload?.data?.list,
      payload?.data?.candles,
      payload?.data,
      payload?.list,
      payload?.candles,
      payload
    ].find(Array.isArray)||[];

    const list=[];

    for(const z of raw){
      if(!z||typeof z!=="object")continue;

      const a=Array.isArray(z);

      let t=a
        ?z[0]
        :z.time??z.timestamp??
         z.openTime??z.t;

      t=typeof t==="string" &&
        !/^\d+$/.test(t)
        ?Date.parse(t)
        :Number(t);

      if(t>1e12)t=Math.floor(t/1000);

      const open=Number(
        a?z[1]:z.open??z.o
      );

      const high=Number(
        a?z[2]:z.high??z.h
      );

      const low=Number(
        a?z[3]:z.low??z.l
      );

      const close=Number(
        a?z[4]:z.close??z.c
      );

      if(
        [t,open,high,low,close]
          .every(Number.isFinite) &&
        t>0 &&
        low>0 &&
        high>=Math.max(open,close) &&
        low<=Math.min(open,close)
      ){
        list.push({
          time:t,open,high,low,close
        });
      }
    }

    list.sort((a,b)=>a.time-b.time);

    return [
      ...new Map(
        list.map(z=>[z.time,z])
      ).values()
    ];
  }

  function closed(data,tf){
    const sec=TF[tf]||60;
    const now=Date.now()/1000;

    return data.filter(
      c=>c.time+sec<=now-2
    );
  }

  function priceY(price){
    if(!candle)return null;

    try{
      return candle.priceToCoordinate(price);
    }catch(e){
      return null;
    }
  }

  function timeX(time){
    if(!chart)return null;

    try{
      return chart.timeScale()
        .timeToCoordinate(time);
    }catch(e){
      return null;
    }
  }

  function spacing(){
    try{
      const o=chart.timeScale().options();
      return Math.max(
        3,Number(o.barSpacing)||7
      );
    }catch(e){
      return 7;
    }
  }

  function priceFormat(value){
    return Number(value).toLocaleString(
      "en-US",{
        maximumFractionDigits:2,
        minimumFractionDigits:2
      }
    );
  }

  function label(
    ctx,text,x,y,color,
    maxWidth,maxHeight
  ){
    ctx.save();

    ctx.font="10px system-ui";

    const padding=5;
    const textWidth=ctx.measureText(text).width;
    const width=Math.min(
      maxWidth-8,textWidth+padding*2
    );

    if(width<=12){
      ctx.restore();
      return;
    }

    const left=Math.max(
      3,Math.min(
        x,maxWidth-width-3
      )
    );

    const top=Math.max(
      3,Math.min(
        y,maxHeight-19
      )
    );

    ctx.fillStyle="rgba(8,14,32,.92)";
    ctx.fillRect(
      left,top,width,17
    );

    ctx.strokeStyle=color;
    ctx.lineWidth=.7;
    ctx.strokeRect(
      left+.5,top+.5,width-1,16
    );

    ctx.fillStyle=color;
    ctx.fillText(
      text,left+padding,top+12,
      width-padding*2
    );

    ctx.restore();
  }

  function drawBox(ctx,box,opts){
    if(!box||!candle)return;

    const w=canvas.clientWidth;
    const h=canvas.clientHeight;

    const start=timeX(box.start);
    const end=timeX(box.end);

    if(
      !Number.isFinite(start)||
      !Number.isFinite(end)
    )return;

    const half=spacing()/2;

    const rawLeft=start-half;
    const rawRight=end+half;

    if(
      rawRight<0||
      rawLeft>w
    )return;

    const yHigh=priceY(box.high);
    const yLow=priceY(box.low);

    if(
      !Number.isFinite(yHigh)||
      !Number.isFinite(yLow)
    )return;

    const x1=Math.max(
      0,rawLeft
    );

    const x2=Math.min(
      w,rawRight
    );

    const top=Math.max(
      0,Math.min(yHigh,yLow)
    );

    const bottom=Math.min(
      h,Math.max(yHigh,yLow)
    );

    if(
      x2<=x1||
      bottom<=top
    )return;

    ctx.save();

    ctx.fillStyle=opts.fill;
    ctx.fillRect(
      x1,top,
      x2-x1,bottom-top
    );

    ctx.strokeStyle=opts.color;
    ctx.lineWidth=1.2;
    ctx.setLineDash([]);

    ctx.strokeRect(
      x1+.5,top+.5,
      x2-x1-1,bottom-top-1
    );

    if(config.boundaries){
      ctx.save();

      ctx.strokeStyle=opts.color;
      ctx.lineWidth=1.5;

      ctx.setLineDash([4,4]);

      ctx.beginPath();
      ctx.moveTo(x1,top);
      ctx.lineTo(x1,bottom);
      ctx.moveTo(x2,top);
      ctx.lineTo(x2,bottom);
      ctx.stroke();

      ctx.setLineDash([]);

      ctx.restore();
    }

    if(config.midpoint){
      const middle=(
        box.high+box.low
      )/2;

      const y=priceY(middle);

      if(Number.isFinite(y)){
        ctx.strokeStyle="#ffe15a";
        ctx.lineWidth=1;
        ctx.setLineDash([5,5]);

        ctx.beginPath();
        ctx.moveTo(x1,y);
        ctx.lineTo(x2,y);
        ctx.stroke();

        ctx.setLineDash([]);
      }
    }

    /*
     Etiqueta de cada caja:
     se ubica dentro de su propio rango.
    */
    label(
      ctx,
      opts.name,
      x1+5,
      top+5,
      opts.color,
      w,h
    );

    ctx.restore();
  }

  function horizontal(
    ctx,price,name,color
  ){
    const y=priceY(price);

    if(!Number.isFinite(y))return;

    const w=canvas.clientWidth;
    const h=canvas.clientHeight;

    if(y<0||y>h)return;

    ctx.save();

    ctx.strokeStyle=color;
    ctx.globalAlpha=.65;
    ctx.lineWidth=.8;
    ctx.setLineDash([4,6]);

    ctx.beginPath();
    ctx.moveTo(0,y);
    ctx.lineTo(w,y);
    ctx.stroke();

    ctx.setLineDash([]);
    ctx.globalAlpha=1;

    /*
     Etiquetas al lado izquierdo.
     Se omiten si quedan demasiado
     próximas a otras etiquetas.
    */
    ctx.restore();

    return {
      y,
      name,
      color
    };
  }

  function drawHigher(ctx){
    const levels=[];

    const groups=[
      {
        tf:"4h",
        enabled:config.higher4h,
        color:"#b38aff",
        name:"4H"
      },
      {
        tf:"1d",
        enabled:config.higher1d,
        color:"#36c5ff",
        name:"Día"
      },
      {
        tf:"1w",
        enabled:config.higher1w,
        color:"#ff9a35",
        name:"Semana"
      }
    ];

    for(const group of groups){
      if(!group.enabled)continue;

      const r=higher.find(
        x=>x.tf===group.tf
      );

      if(!r)continue;

      const hi=horizontal(
        ctx,r.high,
        group.name+" Máx",
        group.color
      );

      const lo=horizontal(
        ctx,r.low,
        group.name+" Mín",
        group.color
      );

      if(hi)levels.push(hi);
      if(lo)levels.push(lo);

      if(config.midpoint){
        const mid=horizontal(
          ctx,(r.high+r.low)/2,
          group.name+" 50%",
          "#ffe15a"
        );

        if(mid)levels.push(mid);
      }
    }

    levels.sort(
      (a,b)=>a.y-b.y
    );

    let lastY=-100;

    for(const level of levels){
      if(
        Math.abs(level.y-lastY)<22
      )continue;

      label(
        ctx,
        level.name,
        5,
        level.y-19,
        level.color,
        canvas.clientWidth,
        canvas.clientHeight
      );

      lastY=level.y;
    }
  }

  function findSideways(c){
    /*
     Busca un bloque de velas
     con compresión relativa.
     No marca lateralización
     cuando no cumple el filtro.
    */
    const maxCount=Math.min(
      18,config.lookback
    );

    if(c.length<maxCount)return null;

    for(let end=c.length;end>=maxCount;end--){
      const r=c.slice(
        end-maxCount,end
      );

      const high=Math.max(
        ...r.map(x=>x.high)
      );

      const low=Math.min(
        ...r.map(x=>x.low)
      );

      const avg=r.reduce(
        (sum,x)=>sum+x.high-x.low,
        0
      )/r.length;

      const compression=(
        high-low
      )/Math.max(avg,1e-12);

      if(compression<=5){
        return {
          start:r[0].time,
          end:r.at(-1).time,
          high,
          low
        };
      }
    }

    return null;
  }

  function draw(){
    if(
      !chart||
      !candle||
      !canvas.isConnected
    )return;

    const w=canvas.clientWidth;
    const h=canvas.clientHeight;

    if(!w||!h)return;

    const dpr=Math.min(
      window.devicePixelRatio||1,2
    );

    const pixelWidth=Math.round(w*dpr);
    const pixelHeight=Math.round(h*dpr);

    if(
      canvas.width!==pixelWidth||
      canvas.height!==pixelHeight
    ){
      canvas.width=pixelWidth;
      canvas.height=pixelHeight;
    }

    const ctx=canvas.getContext("2d");
    if(!ctx)return;

    ctx.setTransform(
      dpr,0,0,dpr,0,0
    );

    ctx.clearRect(0,0,w,h);

    const s=selection();
    const c=closed(rows,s.tf);

    if(c.length<4){
      if(config.higher4h||
         config.higher1d||
         config.higher1w){
        drawHigher(ctx);
      }
      return;
    }

    /*
     Caja verde:
     empieza en la primera vela
     del lookback y termina en la
     última vela cerrada.
    */
    if(config.range){
      const r=c.slice(
        -config.lookback
      );

      drawBox(ctx,{
        start:r[0].time,
        end:r.at(-1).time,
        high:Math.max(
          ...r.map(x=>x.high)
        ),
        low:Math.min(
          ...r.map(x=>x.low)
        )
      },{
        name:"Rango de velas",
        color:"#00d99a",
        fill:"rgba(0,217,154,.055)"
      });
    }

    /*
     Caja morada:
     utiliza un tramo de
     lateralización detectado.
    */
    if(config.sideways){
      const box=findSideways(c);

      if(box){
        drawBox(ctx,box,{
          name:"Lateralización",
          color:"#bb52ff",
          fill:"rgba(187,82,255,.055)"
        });
      }
    }

    /*
     Caja azul:
     corresponde únicamente
     a la penúltima vela cerrada.
     No se prolonga hasta el
     extremo derecho de la gráfica.
    */
    if(config.previous){
      const p=c.at(-2);

      if(p){
        drawBox(ctx,{
          start:p.time,
          end:p.time,
          high:p.high,
          low:p.low
        },{
          name:"Penúltima",
          color:"#36c5ff",
          fill:"rgba(54,197,255,.07)"
        });
      }
    }

    drawHigher(ctx);
  }

  function redrawSoon(){
    if(drawPending)return;

    drawPending=true;

    requestAnimationFrame(()=>{
      drawPending=false;
      draw();
    });
  }

  function bindOverlay(){
    const host=
      $("priceChartArea")||
      $("chart")?.parentElement;

    if(!host)return;

    if(
      getComputedStyle(host).position===
      "static"
    ){
      host.style.position="relative";
    }

    if(canvas.parentElement!==host){
      host.append(canvas);
    }

    /*
     Ubicar controles en el apartado
     de Cajas de rangos si existe.
     Evita crear dos apartados.
    */
    const target=
      $("clRangeBoxesHost")||
      $("rangeBoxesHost")||
      document.querySelector(
        "[data-range-boxes-host]"
      );

    if(target){
      if(panel.parentElement!==target){
        target.append(panel);
      }
    }else{
      const anchor=
        $("chartSection")||host;

      if(
        !panel.isConnected&&
        anchor.parentElement
      ){
        anchor.parentElement.insertBefore(
          panel,anchor
        );
      }
    }
  }

  async function getHigher(tf,s){
    const k=[
      s.exchange,s.market,
      s.symbol,tf
    ].join("|");

    const old=cached.get(k);

    if(
      old&&
      Date.now()-old.at<60000
    )return old.data;

    const url=
      "/api/exchange/"+
      encodeURIComponent(s.exchange)+
      "/klines/"+
      encodeURIComponent(s.symbol)+
      "?market="+
      encodeURIComponent(s.market)+
      "&interval="+
      encodeURIComponent(tf)+
      "&limit=12";

    const controller=new AbortController();

    const timeout=setTimeout(
      ()=>controller.abort(),9000
    );

    try{
      const response=await fetch(url,{
        signal:controller.signal,
        cache:"no-store"
      });

      if(!response.ok){
        throw Error(
          "HTTP "+response.status
        );
      }

      const payload=await response.json();

      if(
        payload?.code!==undefined &&
        ![0,"0"].includes(payload.code)
      ){
        throw Error("API error");
      }

      const a=closed(
        normalize(payload),tf
      );

      if(a.length<2){
        throw Error(
          "Sin velas cerradas"
        );
      }

      /*
       Última vela cerrada.
       No usar la vela en formación.
      */
      const p=a.at(-1);

      const result={
        tf,
        high:p.high,
        low:p.low
      };

      cached.set(k,{
        at:Date.now(),
        data:result
      });

      return result;

    }finally{
      clearTimeout(timeout);
    }
  }

  async function refreshHigher(){
    const gen=++generation;
    const s=selection();

    const requested=[
      config.higher4h?"4h":null,
      config.higher1d?"1d":null,
      config.higher1w?"1w":null
    ].filter(Boolean);

    if(!requested.length){
      higher=[];
      redrawSoon();
      return;
    }

    const results=await Promise.allSettled(
      requested.map(
        tf=>getHigher(tf,s)
      )
    );

    if(gen!==generation)return;

    higher=results
      .filter(
        r=>r.status==="fulfilled"
      )
      .map(r=>r.value);

    redrawSoon();

    note.textContent=
      "Cajas sobre velas cerradas. "+
      "Niveles superiores activos: "+
      (
        higher.map(r=>r.tf).join(", ")||
        "ninguno"
      )+
      ".";
  }

  function attach(detail){
    if(!detail?.chart||
       !detail?.candle)return;

    chart=detail.chart;
    candle=detail.candle;

    bindOverlay();

    if(attachedChart!==chart){
      attachedChart=chart;

      try{
        chart.timeScale()
          .subscribeVisibleLogicalRangeChange(
            redrawSoon
          );
      }catch(e){}
    }

    redrawSoon();
  }

  window.addEventListener(
    "cryptolexuz:chart-ready",
    e=>attach(e.detail)
  );

  window.addEventListener(
    "cryptolexuz:candles-updated",
    e=>{
      const detail=e.detail||{};

      if(detail.chart&&detail.candle){
        attach(detail);
      }

      if(Array.isArray(
        detail.rows||detail.candles
      )){
        rows=[
          ...(detail.rows||detail.candles)
        ];

        currentKey=makeKey(selection());
        redrawSoon();
      }
    }
  );

  function recoverChart(){
    const shared=window.CryptolexuzChart;

    if(shared?.chart&&
       (shared.candle||shared.candleSeries)){
      attach({
        chart:shared.chart,
        candle:shared.candle||
          shared.candleSeries
      });

      if(typeof shared.getRows==="function"){
        const data=shared.getRows();

        if(Array.isArray(data)&&data.length){
          rows=[...data];
          redrawSoon();
        }
      }
    }
  }

  async function poll(){
    if(polling||document.hidden)return;

    polling=true;

    const s=selection();
    const k=makeKey(s);

    if(k!==currentKey){
      currentKey=k;
      rows=[];
      higher=[];
      refreshHigher();
      redrawSoon();
    }

    const url=
      "/api/exchange/"+
      encodeURIComponent(s.exchange)+
      "/klines/"+
      encodeURIComponent(s.symbol)+
      "?market="+
      encodeURIComponent(s.market)+
      "&interval="+
      encodeURIComponent(s.tf)+
      "&limit=160";

    const controller=new AbortController();

    const timeout=setTimeout(
      ()=>controller.abort(),9000
    );

    try{
      const response=await fetch(url,{
        signal:controller.signal,
        cache:"no-store"
      });

      if(!response.ok){
        throw Error(
          "HTTP "+response.status
        );
      }

      const payload=await response.json();

      if(k!==currentKey)return;

      rows=normalize(payload);
      redrawSoon();

    }catch(e){
      note.textContent=
        "No se pudieron actualizar "+
        "las cajas. Revisar conexión.";
    }finally{
      clearTimeout(timeout);
      polling=false;
    }
  }

  function init(){
    if(initialized)return;
    initialized=true;

    bindOverlay();
    recoverChart();

    [
      "symbol","interval",
      "market","exchange"
    ].forEach(id=>{
      $(id)?.addEventListener(
        "change",
        ()=>{
          currentKey="";
          rows=[];
          higher=[];
          redrawSoon();

          setTimeout(()=>{
            poll();
            refreshHigher();
          },400);
        }
      );
    });

    window.addEventListener(
      "resize",redrawSoon
    );

    document.addEventListener(
      "visibilitychange",
      ()=>{
        if(!document.hidden){
          recoverChart();
          poll();
          refreshHigher();
        }
      }
    );

    poll();
    refreshHigher();

    timer=setInterval(()=>{
      if(!document.hidden){
        recoverChart();
        poll();
        refreshHigher();
      }
    },30000);
  }

  if(document.readyState==="loading"){
    document.addEventListener(
      "DOMContentLoaded",init
    );
  }else{
    init();
  }

})();
