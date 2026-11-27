/* CRYPTOLEXUZ PRO — signals-engine.js V1
   Motor independiente: solo análisis de velas cerradas.
   No modifica app.js, historial, notificaciones ni ejecuta órdenes.
*/
'use strict';
(() => {
  if (window.CryptolexuzSignalsEngine?.version === '1.0.0') return;
  const TF = {'1m':60,'3m':180,'5m':300,'15m':900,'30m':1800,'1h':3600,'2h':7200,'4h':14400,'6h':21600,'8h':28800,'12h':43200,'1d':86400,'3d':259200,'1w':604800,'1M':2592000};
  const CONFIG = Object.freeze({minClosedCandles:60,minADX:25,minVolRatio:1.35,minScore:80,rrTP1:1.5,rrTP2:2.5,slAtrMult:1.15});
  const valid = Number.isFinite;
  const now = () => Math.floor(Date.now()/1000);
  function closedCandles(input,tf,asOf=now()){
    if(!Array.isArray(input)||!TF[tf])return [];
    const out=[];
    for(const x of input){
      if(!x)continue;
      const c={time:Number(x.time),open:Number(x.open),high:Number(x.high),low:Number(x.low),close:Number(x.close),volume:Number(x.volume)};
      if(!Object.values(c).every(valid)||c.time<=0||c.low<=0||c.volume<0||c.high<Math.max(c.open,c.close,c.low)||c.low>Math.min(c.open,c.close,c.high)||c.time+TF[tf]>asOf-2)continue;
      out.push(c);
    }
    out.sort((a,b)=>a.time-b.time);
    return [...new Map(out.map(c=>[c.time,c])).values()];
  }
  function sma(v,p){const out=Array(v.length).fill(null);let sum=0;for(let i=0;i<v.length;i++){sum+=v[i];if(i>=p)sum-=v[i-p];if(i>=p-1)out[i]=sum/p;}return out;}
  function ema(v,p){const out=Array(v.length).fill(null);if(v.length<p)return out;let x=v.slice(0,p).reduce((a,b)=>a+b,0)/p;out[p-1]=x;for(let i=p;i<v.length;i++)out[i]=x+=(v[i]-x)*2/(p+1);return out;}
  function rsi(v,p=14){
    const out=Array(v.length).fill(null);if(v.length<=p)return out;
    let g=0,l=0;for(let i=1;i<=p;i++){const d=v[i]-v[i-1];g+=Math.max(0,d);l+=Math.max(0,-d);}
    g/=p;l/=p;const calc=()=>l===0?(g===0?50:100):100-100/(1+g/l);out[p]=calc();
    for(let i=p+1;i<v.length;i++){const d=v[i]-v[i-1];g=(g*(p-1)+Math.max(0,d))/p;l=(l*(p-1)+Math.max(0,-d))/p;out[i]=calc();}
    return out;
  }
  function adx(c,p=14){
    const n=c.length,a=Array(n).fill(null),plus=Array(n).fill(null),minus=Array(n).fill(null);
    if(n<2*p)return {adx:a,plus,minus};
    const tr=[],up=[],down=[],dx=[];for(let i=1;i<n;i++){
      const h=c[i].high-c[i-1].high,l=c[i-1].low-c[i].low;
      tr[i]=Math.max(c[i].high-c[i].low,Math.abs(c[i].high-c[i-1].close),Math.abs(c[i].low-c[i-1].close));
      up[i]=h>l&&h>0?h:0;down[i]=l>h&&l>0?l:0;
    }
    let t=0,u=0,d=0;for(let i=1;i<=p;i++){t+=tr[i];u+=up[i];d+=down[i];}
    for(let i=p;i<n;i++){
      if(i>p){t=t-t/p+tr[i];u=u-u/p+up[i];d=d-d/p+down[i];}
      plus[i]=t?100*u/t:0;minus[i]=t?100*d/t:0;
      const sum=plus[i]+minus[i];dx[i]=sum?100*Math.abs(plus[i]-minus[i])/sum:0;
    }
    a[2*p-1]=dx.slice(p,2*p).reduce((s,x)=>s+x,0)/p;
    for(let i=2*p;i<n;i++)a[i]=(a[i-1]*(p-1)+dx[i])/p;
    return {adx:a,plus,minus};
  }
  function atr(c,p=14){
    if(c.length<p+1)return null;const t=[];
    for(let i=1;i<c.length;i++)t.push(Math.max(c[i].high-c[i].low,Math.abs(c[i].high-c[i-1].close),Math.abs(c[i].low-c[i-1].close)));
    let a=t.slice(0,p).reduce((s,x)=>s+x,0)/p;for(let i=p;i<t.length;i++)a=(a*(p-1)+t[i])/p;
    return valid(a)&&a>0?a:null;
  }
  function ao(c){const mid=c.map(x=>(x.high+x.low)/2),fast=sma(mid,5),slow=sma(mid,34);return mid.map((_,i)=>valid(fast[i])&&valid(slow[i])?fast[i]-slow[i]:null);}
  function analyzeTimeframe(input,tf,asOf=now()){
    const c=closedCandles(input,tf,asOf);if(c.length<CONFIG.minClosedCandles)return null;
    const v=c.map(x=>x.close),last=c.at(-1),e=ema(v,21).at(-1),m=sma(v,55).at(-1),r=rsi(v).at(-1);
    const d=adx(c),strength=d.adx.at(-1),plus=d.plus.at(-1),minus=d.minus.at(-1),a=ao(c),aNow=a.at(-1),aPrev=a.at(-2),range=atr(c);
    if(![e,m,r,strength,plus,minus,range].every(valid))return null;
    let bull=0,bear=0;
    if(last.close>e)bull++;if(last.close<e)bear++;
    if(e>m)bull++;if(e<m)bear++;
    if(r>=52)bull++;if(r<=48)bear++;
    if(plus>minus)bull++;if(minus>plus)bear++;
    const prev=c.slice(-7,-1),vol=c.slice(-21,-1).reduce((s,x)=>s+x.volume,0)/20;
    return {tf,time:last.time,close:last.close,ema21:e,ma55:m,rsi:r,adx:strength,plusDI:plus,minusDI:minus,atr:range,
      bullPts:bull,bearPts:bear,volRatio:vol>0?last.volume/vol:0,
      aoBull:valid(aNow)&&valid(aPrev)&&aNow>0&&aNow>aPrev,
      aoBear:valid(aNow)&&valid(aPrev)&&aNow<0&&aNow<aPrev,
      breakoutLong:last.close>Math.max(...prev.map(x=>x.high)),
      breakoutShort:last.close<Math.min(...prev.map(x=>x.low))};
  }
  function empty(symbol,reason,metrics={}){
    return {version:'1.0.0',symbol,direction:'NEUTRAL',state:'SIN ENTRADA',ready:false,score:0,entryPrice:null,stopLoss:null,tp1:null,tp2:null,closedTime:null,confirmations:{},metrics,summary:reason,estimatedProbability:null,execution:false};
  }
  function evaluateSignal({symbol='BTC-USDT',candlesByTf={},asOf=now()}={}){
    const m={};for(const tf of ['1h','15m','5m','1m'])m[tf]=analyzeTimeframe(candlesByTf?.[tf],tf,asOf);
    const h=m['1h'],f=m['15m'],v=m['5m'],one=m['1m'];
    if(!h||!f||!v||!one)return empty(symbol,'Faltan velas cerradas suficientes en 1h, 15m, 5m o 1m.',m);
    const bullish=f.bullPts>=3&&v.bullPts>=3&&f.bullPts>f.bearPts&&v.bullPts>v.bearPts;
    const bearish=f.bearPts>=3&&v.bearPts>=3&&f.bearPts>f.bullPts&&v.bearPts>v.bullPts;
    const direction=bullish&&!bearish?'LONG':bearish&&!bullish?'SHORT':'NEUTRAL';
    if(direction==='NEUTRAL')return empty(symbol,'Sin alineación entre 15m y 5m.',m);
    const long=direction==='LONG';
    const confirmations={
      alignment:true,trend1h:long?h.bullPts>=3:h.bearPts>=3,
      adx:v.adx>=CONFIG.minADX&&f.adx>=20,
      volume:v.volRatio>=CONFIG.minVolRatio,
      ao:long?v.aoBull&&one.aoBull:v.aoBear&&one.aoBear,
      rsi:long?v.rsi>=52&&v.rsi<=70:v.rsi>=30&&v.rsi<=48,
      breakout:long?v.breakoutLong:v.breakoutShort,
      timing1m:long?one.bullPts>=2:one.bearPts>=2,
      atr:valid(v.atr)&&v.atr>0
    };
    const weights={alignment:25,trend1h:12,adx:15,volume:12,ao:12,rsi:10,breakout:8,timing1m:6};
    const score=Object.entries(weights).reduce((s,[k,w])=>s+(confirmations[k]?w:0),0);
    const ready=score>=CONFIG.minScore&&Object.values(confirmations).every(Boolean);
    const entry=ready?v.close:null,risk=ready?v.atr*CONFIG.slAtrMult:null;
    const stop=ready?(long?entry-risk:entry+risk):null;
    const tp1=ready?(long?entry+risk*CONFIG.rrTP1:entry-risk*CONFIG.rrTP1):null;
    const tp2=ready?(long?entry+risk*CONFIG.rrTP2:entry-risk*CONFIG.rrTP2):null;
    const safe=ready&&[entry,stop,tp1,tp2].every(x=>valid(x)&&x>0);
    return {version:'1.0.0',symbol,direction,state:safe?'CONFIRMADA':score>=70?'EN OBSERVACIÓN':'SIN ENTRADA',
      ready:Boolean(safe),score,entryPrice:safe?entry:null,stopLoss:safe?stop:null,tp1:safe?tp1:null,tp2:safe?tp2:null,
      closedTime:v.time,confirmations,metrics:m,summary:safe?'Condiciones técnicas completas; niveles orientativos.':'Confirmaciones incompletas.',
      estimatedProbability:null,execution:false};
  }
  window.CryptolexuzSignalsEngine=Object.freeze({
    version:'1.0.0',CONFIG,TF,closedCandles,sma,ema,rsi,adx,atr,awesomeOscillator:ao,analyzeTimeframe,evaluateSignal
  });
  window.dispatchEvent(new CustomEvent('cryptolexuz:signals-engine-ready',{detail:{version:'1.0.0'}}));
})();
