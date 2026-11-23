
/*
 CRYPTOLEXUZ PRO — RANGE BOXES V3
 Lightweight Charts 4.2.x

 - Cajas automáticas de rangos
 - Caja de lateralización
 - Caja de penúltima vela
 - Cajas fijas con cuerpo y mechas
 - Extensión táctil hacia ambos lados
 - Precios fijos al extender
 - Persistencia por activo y mercado
 - Compatible con app.js V17
 - Sin ejecución automática de órdenes
*/
"use strict";

(() => {
  if (window.__clRangeBoxesV3) return;
  window.__clRangeBoxesV3 = true;

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

  const STORE="cryptolexuz-fixed-boxes-v3";
  const PREFS="cryptolexuz-range-prefs-v3";

  const config={
    range:true,
    sideways:false,
    previous:false,
    midpoint:false,
    boundaries:true,
    higher4h:false,
    higher1d:false,
    higher1w:false,
    fixed:true,
    lookback:24
  };

  try {
    const saved=JSON.parse(
      localStorage.getItem(PREFS)||"null"
    );

    if(saved&&typeof saved==="object"){
      for(const key of Object.keys(config)){
        if(key==="lookback"){
          if([12,24,36,48,72].includes(
            Number(saved[key])
          )){
            config[key]=Number(saved[key]);
          }
        }else if(typeof saved[key]==="boolean"){
          config[key]=saved[key];
        }
      }
    }
  }catch(e){}

  function savePrefs(){
    try{
      localStorage.setItem(
        PREFS,JSON.stringify(config)
      );
    }catch(e){}
  }

  let fixedBoxes=[];

  try{
    const saved=JSON.parse(
      localStorage.getItem(STORE)||"[]"
    );

    if(Array.isArray(saved)){
      fixedBoxes=saved.filter(b=>
        b &&
        typeof b.symbol==="string" &&
        Number.isFinite(b.high) &&
        Number.isFinite(b.low) &&
        Number.isFinite(b.start) &&
        Number.isFinite(b.end)
      );
    }
  }catch(e){}

  function saveBoxes(){
    try{
      localStorage.setItem(
        STORE,JSON.stringify(fixedBoxes)
      );
    }catch(e){
      console.warn("Guardar cajas:",e);
    }
  }

  let chart=null;
  let candle=null;
  let rows=[];
  let higher=[];
  let currentKey="";
  let generation=0;
  let attachedChart=null;
  let drawing=false;
  let fetching=false;
  let initialized=false;
  let drag=null;
  let activeBoxId=null;
  let lastPointer=null;

  const cache=new Map();

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
    justify-content:space-between;
    align-items:center;
    gap:8px;
  `;

  heading.innerHTML=`
    <strong style="font-size:14px">
      🟩 Cajas de rangos
    </strong>
    <span style="color:#93a8c9">
      V3
    </span>
  `;

  const grid=document.createElement("div");
  grid.style.cssText=`
    display:grid;
    grid-template-columns:
      repeat(auto-fit,minmax(145px,1fr));
    gap:8px;
  `;

  function addToggle(text,key,color){
    const label=document.createElement("label");

    label.style.cssText=`
      display:flex;
      align-items:center;
      gap:7px;
      padding:8px;
      min-height:34px;
      background:#0b1429;
      border:1px solid #344365;
      border-radius:9px;
      cursor:pointer;
    `;

    const input=document.createElement("input");
    input.type="checkbox";
    input.checked=config[key];
    input.style.accentColor=color;

    input.addEventListener("change",()=>{
      config[key]=input.checked;
      savePrefs();
      redrawSoon();

      if(key.startsWith("higher")){
        refreshHigher();
      }

      updateInteraction();
    });

    label.append(
      input,
      document.createTextNode(text)
    );

    grid.append(label);
  }

  addToggle("🟩 Rango","range","#00d99a");
  addToggle("🟪 Lateral","sideways","#bb52ff");
  addToggle("🟦 Penúltima","previous","#36c5ff");
  addToggle("📌 Cajas fijas","fixed","#ffe15a");
  addToggle("📏 Línea 50%","midpoint","#ffe15a");
  addToggle("↔ Bordes","boundaries","#00d99a");
  addToggle("4H","higher4h","#b38aff");
  addToggle("Diario","higher1d","#36c5ff");
  addToggle("Semanal","higher1w","#ff9a35");

  const controls=document.createElement("div");

  controls.style.cssText=`
    display:flex;
    flex-wrap:wrap;
    align-items:center;
    gap:8px;
  `;

  function button(text){
    const el=document.createElement("button");
    el.type="button";
    el.textContent=text;

    el.style.cssText=`
      padding:9px 12px;
      border:1px solid #465a85;
      border-radius:9px;
      background:#202d4e;
      color:#eaf0ff;
      font:12px system-ui;
      cursor:pointer;
    `;

    return el;
  }

  const pinRange=button("📌 Fijar rango");
  const pinPrevious=button("📌 Fijar vela");
  const removeBox=button("🗑 Eliminar caja");

  const selectBox=document.createElement("select");

  selectBox.style.cssText=`
    background:#0b1429;
    color:#eaf0ff;
    border:1px solid #485579;
    border-radius:8px;
    padding:9px;
    max-width:100%;
  `;

  const selector=document.createElement("select");

  selector.style.cssText=`
    background:#0b1429;
    color:#eaf0ff;
    border:1px solid #485579;
    border-radius:8px;
    padding:9px;
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
    savePrefs();
    redrawSoon();
  });

  controls.append(
    pinRange,
    pinPrevious,
    removeBox,
    selectBox,
    selector
  );

  const note=document.createElement("div");

  note.style.cssText=`
    color:#9eafd0;
    font-size:11px;
    line-height:1.6;
  `;

  note.textContent=
    "Fija una caja y arrastra sus extremos "+
    "en la gráfica. Los precios no cambian.";

  panel.append(
    heading,grid,controls,note
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

  function marketKey(s){
    return [
      s.exchange,s.market,s.symbol
    ].join("|");
  }

  function dataKey(s){
    return marketKey(s)+"|"+s.tf;
  }

  function visibleBoxes(){
    const k=marketKey(selection());

    return fixedBoxes.filter(
      b=>b.marketKey===k
    );
  }

  function selectedBox(){
    return visibleBoxes().find(
      b=>b.id===activeBoxId
    );
  }

  function saveAndDraw(){
    saveBoxes();
    updateBoxSelector();
    redrawSoon();
  }

  function updateBoxSelector(){
    const boxes=visibleBoxes();

    if(
      !boxes.some(b=>b.id===activeBoxId)
    ){
      activeBoxId=boxes.at(-1)?.id||null;
    }

    selectBox.replaceChildren();

    if(!boxes.length){
      const option=document.createElement("option");
      option.textContent="Sin cajas fijadas";
      option.value="";
      selectBox.append(option);
      removeBox.disabled=true;
      return;
    }

    removeBox.disabled=false;

    for(const b of boxes){
      const option=document.createElement("option");
      option.value=b.id;
      option.textContent=b.name;
      option.selected=b.id===activeBoxId;
      selectBox.append(option);
    }
  }

  selectBox.addEventListener("change",()=>{
    activeBoxId=selectBox.value;
    redrawSoon();
  });

  removeBox.addEventListener("click",()=>{
    const b=selectedBox();
    if(!b)return;

    if(!confirm(
      "¿Eliminar la caja seleccionada?"
    ))return;

    fixedBoxes=fixedBoxes.filter(
      x=>x.id!==b.id
    );

    activeBoxId=null;
    saveAndDraw();
  });

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
    try{
      return candle?.priceToCoordinate(price);
    }catch(e){
      return null;
    }
  }

  function timeX(time){
    try{
      return chart?.timeScale()
        .timeToCoordinate(time);
    }catch(e){
      return null;
    }
  }

  function barSpacing(){
    try{
      return Math.max(
        3,
        Number(
          chart.timeScale().options()
            .barSpacing
        )||7
      );
    }catch(e){
      return 7;
    }
  }

  function coordinateAtTime(time){
    if(!chart)return null;

    const scale=chart.timeScale();
    const s=selection();

    const exact=timeX(time);

    if(Number.isFinite(exact)){
      return exact;
    }

    /*
     Si el tiempo cae entre velas de otra
     temporalidad, interpolamos usando
     los tiempos de las velas visibles.
    */
    const data=rows;

    if(!data.length)return null;

    let before=null;
    let after=null;

    for(const c of data){
      if(c.time<=time)before=c;
      if(c.time>=time){
        after=c;
        break;
      }
    }

    if(before&&after){
      const x1=timeX(before.time);
      const x2=timeX(after.time);

      if(
        Number.isFinite(x1)&&
        Number.isFinite(x2)
      ){
        if(after.time===before.time)return x1;

        const ratio=(
          time-before.time
        )/(after.time-before.time);

        return x1+(x2-x1)*ratio;
      }
    }

    const edge=before||after;

    if(!edge)return null;

    const edgeX=timeX(edge.time);

    if(!Number.isFinite(edgeX))return null;

    return edgeX+
      (time-edge.time)/
      (TF[s.tf]||60)*
      barSpacing();
  }

  function timeAtCoordinate(x){
    if(!chart)return null;

    const scale=chart.timeScale();
    const s=selection();

    try{
      const logical=scale.coordinateToLogical(x);

      if(!Number.isFinite(logical))
        return null;

      const base=rows[0];

      if(!base)return null;

      const first=scale.timeToCoordinate(
        base.time
      );

      if(!Number.isFinite(first))
        return null;

      const diff=(x-first)/barSpacing();

      return Math.round(
        base.time+diff*(TF[s.tf]||60)
      );
    }catch(e){
      return null;
    }
  }

  function formatPrice(n){
    return Number(n).toLocaleString(
      "en-US",{
        minimumFractionDigits:2,
        maximumFractionDigits:2
      }
    );
  }

  function drawLabel(
    ctx,text,x,y,color,w,h
  ){
    ctx.save();

    ctx.font="10px system-ui";

    const width=Math.min(
      Math.max(50,ctx.measureText(text).width+12),
      w-8
    );

    const left=Math.max(
      3,Math.min(x,w-width-3)
    );

    const top=Math.max(
      3,Math.min(y,h-20)
    );

    ctx.fillStyle="rgba(8,14,32,.94)";
    ctx.fillRect(
      left,top,width,18
    );

    ctx.strokeStyle=color;
    ctx.lineWidth=.8;
    ctx.strokeRect(
      left+.5,top+.5,width-1,17
    );

    ctx.fillStyle=color;
    ctx.fillText(
      text,left+6,top+12,
      width-12
    );

    ctx.restore();
  }

  function drawBox(ctx,b,opts){
    if(!chart||!candle)return null;

    const w=canvas.clientWidth;
    const h=canvas.clientHeight;

    const xa=coordinateAtTime(b.start);
    const xb=coordinateAtTime(b.end);

    const ya=priceY(b.high);
    const yb=priceY(b.low);

    if(![
      xa,xb,ya,yb
    ].every(Number.isFinite)){
      return null;
    }

    const left=Math.min(xa,xb);
    const right=Math.max(xa,xb);

    const top=Math.min(ya,yb);
    const bottom=Math.max(ya,yb);

    if(
      right<0||
      left>w||
      bottom<0||
      top>h
    )return null;

    const x1=Math.max(0,left);
    const x2=Math.min(w,right);

    const y1=Math.max(0,top);
    const y2=Math.min(h,bottom);

    if(x2<=x1||y2<=y1)return null;

    ctx.save();

    ctx.fillStyle=opts.fill;
    ctx.fillRect(
      x1,y1,x2-x1,y2-y1
    );

    ctx.strokeStyle=opts.color;
    ctx.lineWidth=opts.selected?2:1.2;
    ctx.setLineDash([]);

    ctx.strokeRect(
      x1+.5,y1+.5,
      x2-x1-1,y2-y1-1
    );

    if(config.boundaries){
      ctx.setLineDash([4,4]);
      ctx.lineWidth=1.5;

      ctx.beginPath();
      ctx.moveTo(x1,y1);
      ctx.lineTo(x1,y2);
      ctx.moveTo(x2,y1);
      ctx.lineTo(x2,y2);
      ctx.stroke();

      ctx.setLineDash([]);
    }

    if(config.midpoint){
      const mid=(b.high+b.low)/2;
      const ym=priceY(mid);

      if(Number.isFinite(ym)){
        ctx.strokeStyle="#ffe15a";
        ctx.lineWidth=1;
        ctx.setLineDash([5,5]);

        ctx.beginPath();
        ctx.moveTo(x1,ym);
        ctx.lineTo(x2,ym);
        ctx.stroke();

        ctx.setLineDash([]);
      }
    }

    drawLabel(
      ctx,opts.name,
      x1+4,y1+4,
      opts.color,w,h
    );

    if(opts.fixed){
      /*
       Manijas táctiles en ambos extremos.
      */
      for(const x of [x1,x2]){
        const cy=(y1+y2)/2;

        ctx.fillStyle=opts.color;
        ctx.fillRect(
          x-5,cy-13,10,26
        );

        ctx.strokeStyle="#081020";
        ctx.lineWidth=1;
        ctx.strokeRect(
          x-5,cy-13,10,26
        );
      }
    }

    ctx.restore();

    return {
      id:b.id,
      left,
      right,
      top,
      bottom
    };
  }

  function drawHigher(ctx){
    const colors={
      "4h":"#b38aff",
      "1d":"#36c5ff",
      "1w":"#ff9a35"
    };

    const names={
      "4h":"4H",
      "1d":"Día",
      "1w":"Semana"
    };

    const active={
      "4h":config.higher4h,
      "1d":config.higher1d,
      "1w":config.higher1w
    };

    const labels=[];

    for(const r of higher){
      if(!active[r.tf])continue;

      const levels=[
        [r.high,"Máx"],
        [r.low,"Mín"]
      ];

      if(config.midpoint){
        levels.push([
          (r.high+r.low)/2,"50%"
        ]);
      }

      for(const [price,name] of levels){
        const y=priceY(price);

        if(!Number.isFinite(y))continue;

        ctx.save();
        ctx.strokeStyle=colors[r.tf];
        ctx.globalAlpha=.55;
        ctx.lineWidth=.8;
        ctx.setLineDash([4,6]);

        ctx.beginPath();
        ctx.moveTo(0,y);
        ctx.lineTo(canvas.clientWidth,y);
        ctx.stroke();

        ctx.restore();

        labels.push({
          y,
          text:names[r.tf]+" "+name,
          color:colors[r.tf]
        });
      }
    }

    labels.sort((a,b)=>a.y-b.y);

    let last=-100;

    for(const item of labels){
      if(Math.abs(item.y-last)<23)
        continue;

      drawLabel(
        ctx,item.text,
        5,item.y-19,
        item.color,
        canvas.clientWidth,
        canvas.clientHeight
      );

      last=item.y;
    }
  }

  function rangeBox(c){
    const r=c.slice(-config.lookback);

    if(!r.length)return null;

    return {
      start:r[0].time,
      end:r.at(-1).time,
      high:Math.max(
        ...r.map(x=>x.high)
      ),
      low:Math.min(
        ...r.map(x=>x.low)
      )
    };
  }

  function sidewaysBox(c){
    const n=Math.min(
      18,config.lookback
    );

    if(c.length<n)return null;

    const r=c.slice(-n);

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

    if(
      (high-low)/
      Math.max(avg,1e-12)>5
    )return null;

    return {
      start:r[0].time,
      end:r.at(-1).time,
      high,low
    };
  }

  function previousBox(c){
    const p=c.at(-2);

    if(!p)return null;

    return {
      start:p.time,
      end:p.time+(TF[selection().tf]||60),
      high:p.high,
      low:p.low
    };
  }

  let hitboxes=[];

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

    const pw=Math.round(w*dpr);
    const ph=Math.round(h*dpr);

    if(
      canvas.width!==pw||
      canvas.height!==ph
    ){
      canvas.width=pw;
      canvas.height=ph;
    }

    const ctx=canvas.getContext("2d");

    if(!ctx)return;

    ctx.setTransform(
      dpr,0,0,dpr,0,0
    );

    ctx.clearRect(0,0,w,h);

    hitboxes=[];

    const s=selection();
    const c=closed(rows,s.tf);

    if(c.length>=4){
      if(config.range){
        const b=rangeBox(c);

        if(b){
          drawBox(ctx,b,{
            name:"Rango de velas",
            color:"#00d99a",
            fill:"rgba(0,217,154,.045)"
          });
        }
      }

      if(config.sideways){
        const b=sidewaysBox(c);

        if(b){
          drawBox(ctx,b,{
            name:"Lateralización",
            color:"#bb52ff",
            fill:"rgba(187,82,255,.05)"
          });
        }
      }

      if(config.previous){
        const b=previousBox(c);

        if(b){
          drawBox(ctx,b,{
            name:"Penúltima",
            color:"#36c5ff",
            fill:"rgba(54,197,255,.06)"
          });
        }
      }
    }

    drawHigher(ctx);

    if(config.fixed){
      for(const b of visibleBoxes()){
        const selected=b.id===activeBoxId;

        const hit=drawBox(ctx,b,{
          name:b.name,
          color:selected
            ?"#ffe15a"
            :"#36c5ff",
          fill:selected
            ?"rgba(255,225,90,.07)"
            :"rgba(54,197,255,.055)",
          fixed:true,
          selected
        });

        if(hit){
          hitboxes.push(hit);
        }
      }
    }
  }

  function redrawSoon(){
    if(drawing)return;

    drawing=true;

    requestAnimationFrame(()=>{
      drawing=false;
      draw();
    });
  }

  function createFixed(source,name){
    if(!source)return;

    const s=selection();

    const duration=TF[s.tf]||60;

    const start=source.start;
    const end=Math.max(
      source.end,
      start+duration
    );

    const id=
      "box-"+Date.now()+"-"+
      Math.random().toString(36).slice(2,8);

    const box={
      id,
      marketKey:marketKey(s),
      symbol:s.symbol,
      exchange:s.exchange,
      market:s.market,
      sourceTf:s.tf,
      name,
      high:source.high,
      low:source.low,
      start,
      end
    };

    fixedBoxes.push(box);

    activeBoxId=id;

    config.fixed=true;
    savePrefs();

    saveAndDraw();

    note.textContent=
      "Caja fijada. Arrastra las manijas "+
      "izquierda o derecha para extenderla. "+
      "Máximo y mínimo permanecen fijos.";
  }

  pinRange.addEventListener("click",()=>{
    const c=closed(
      rows,selection().tf
    );

    if(c.length<4){
      note.textContent=
        "Esperando velas cerradas.";
      return;
    }

    createFixed(
      rangeBox(c),
      "Rango "+selection().tf
    );
  });

  pinPrevious.addEventListener("click",()=>{
    const c=closed(
      rows,selection().tf
    );

    if(c.length<3){
      note.textContent=
        "Esperando velas cerradas.";
      return;
    }

    createFixed(
      previousBox(c),
      "Vela "+selection().tf
    );
  });

  function hitTest(x,y){
    const tolerance=20;

    for(let i=hitboxes.length-1;i>=0;i--){
      const b=hitboxes[i];

      if(
        y<b.top-tolerance||
        y>b.bottom+tolerance
      )continue;

      if(
        Math.abs(x-b.left)<=tolerance
      ){
        return {
          id:b.id,
          edge:"left"
        };
      }

      if(
        Math.abs(x-b.right)<=tolerance
      ){
        return {
          id:b.id,
          edge:"right"
        };
      }
    }

    return null;
  }

  function pointerPosition(e){
    const rect=canvas.getBoundingClientRect();

    return {
      x:e.clientX-rect.left,
      y:e.clientY-rect.top
    };
  }

  function pointerDown(e){
    if(!config.fixed)return;

    const p=pointerPosition(e);
    const hit=hitTest(p.x,p.y);

    if(!hit)return;

    const b=fixedBoxes.find(
      x=>x.id===hit.id
    );

    if(!b)return;

    activeBoxId=b.id;

    drag={
      id:b.id,
      edge:hit.edge,
      pointerId:e.pointerId,
      startX:p.x,
      originalStart:b.start,
      originalEnd:b.end
    };

    lastPointer=p;

    canvas.style.pointerEvents="auto";
    canvas.style.touchAction="none";

    try{
      canvas.setPointerCapture(e.pointerId);
    }catch(err){}

    updateBoxSelector();
    redrawSoon();

    e.preventDefault();
  }

  function pointerMove(e){
    if(!drag)return;

    if(
      e.pointerId!==drag.pointerId
    )return;

    const p=pointerPosition(e);
    const b=fixedBoxes.find(
      x=>x.id===drag.id
    );

    if(!b)return;

    const s=selection();
    const sec=TF[s.tf]||60;

    const deltaBars=Math.round(
      (p.x-drag.startX)/
      barSpacing()
    );

    const deltaTime=deltaBars*sec;

    if(drag.edge==="left"){
      b.start=Math.min(
        drag.originalStart+deltaTime,
        b.end-sec
      );
    }else{
      b.end=Math.max(
        drag.originalEnd+deltaTime,
        b.start+sec
      );
    }

    lastPointer=p;

    redrawSoon();

    e.preventDefault();
  }

  function pointerUp(e){
    if(!drag)return;

    if(
      e.pointerId!==drag.pointerId
    )return;

    try{
      canvas.releasePointerCapture(
        e.pointerId
      );
    }catch(err){}

    drag=null;
    lastPointer=null;

    canvas.style.touchAction="";
    updateInteraction();

    saveAndDraw();
  }

  /*
   El canvas solo captura eventos
   cuando se inicia una interacción
   con las manijas.
  */
  function updateInteraction(){
    canvas.style.pointerEvents=
      config.fixed?"auto":"none";

    canvas.style.touchAction=
      config.fixed?"pan-y":"auto";
  }

  canvas.addEventListener(
    "pointerdown",pointerDown
  );

  canvas.addEventListener(
    "pointermove",pointerMove
  );

  canvas.addEventListener(
    "pointerup",pointerUp
  );

  canvas.addEventListener(
    "pointercancel",pointerUp
  );

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

    updateInteraction();
  }

  async function getHigher(tf,s){
    const k=[
      s.exchange,s.market,s.symbol,tf
    ].join("|");

    const old=cache.get(k);

    if(
      old&&
      Date.now()-old.at<60000
    ){
      return old.data;
    }

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

      if(a.length<1){
        throw Error(
          "Sin velas cerradas"
        );
      }

      const p=a.at(-1);

      const result={
        tf,
        high:p.high,
        low:p.low
      };

      cache.set(k,{
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
  }

  function attach(detail){
    if(
      !detail?.chart||
      !detail?.candle
    )return;

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
      const d=e.detail||{};

      if(d.chart&&d.candle){
        attach(d);
      }

      const data=d.rows||d.candles;

      if(Array.isArray(data)){
        rows=[...data];
        currentKey=dataKey(selection());
        redrawSoon();
      }
    }
  );

  function recoverChart(){
    const shared=window.CryptolexuzChart;

    if(
      shared?.chart&&
      (shared.candle||shared.candleSeries)
    ){
      attach({
        chart:shared.chart,
        candle:shared.candle||
          shared.candleSeries
      });

      if(
        typeof shared.getRows==="function"
      ){
        const data=shared.getRows();

        if(
          Array.isArray(data)&&
          data.length
        ){
          rows=[...data];
          redrawSoon();
        }
      }
    }
  }

  async function poll(){
    if(fetching||document.hidden)return;

    fetching=true;

    const s=selection();
    const k=dataKey(s);

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
      fetching=false;
    }
  }

  function init(){
    if(initialized)return;
    initialized=true;

    bindOverlay();
    recoverChart();
    updateBoxSelector();

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
          activeBoxId=null;

          updateBoxSelector();
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

    setInterval(()=>{
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
