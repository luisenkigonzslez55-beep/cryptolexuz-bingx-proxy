
/* CRYPTOLEXUZ PRO — SCALPING RÁPIDO V1
   Monitor informativo. No coloca órdenes ni garantiza rentabilidad.
   BTC y GOLD 100x; OIL WTI 50x. Metas de ROI sobre margen: 50/100/200%.
*/
"use strict";
(() => {
  if (window.__clScalpingRapidoV1) return;
  window.__clScalpingRapidoV1 = true;

  const ASSETS = [
    { name: "BITCOIN", symbol: "BTC-USDT", leverage: 100, icon: "₿" },
    { name: "ORO", symbol: "NCCOGOLD2USD-USDT", leverage: 100, icon: "◈" },
    { name: "PETRÓLEO WTI", symbol: "NCCO1OILWTI2USD-USDT", leverage: 50, icon: "◉" }
  ];
  const $ = id => document.getElementById(id);
  const fmt = (n, digits = 2) => Number(n).toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: digits });
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const state = new Map();
  let busy = false;
  let lastRun = 0;

  function normalized(payload) {
    const candidates = [payload?.data?.data, payload?.data?.list, payload?.data?.candles, payload?.data, payload?.list, payload];
    const raw = candidates.find(Array.isArray) || [];
    const output = [];
    for (const v of raw) {
      if (!v || typeof v !== "object") continue;
      const a = Array.isArray(v);
      const num = x => x === null || x === undefined || x === "" ? NaN : Number(x);
      let time = a ? v[0] : (v.time ?? v.timestamp ?? v.openTime ?? v.t);
      time = typeof time === "string" && !/^\d+$/.test(time) ? Date.parse(time) : Number(time);
      if (time > 1e12) time = Math.floor(time / 1000);
      const open = num(a ? v[1] : (v.open ?? v.o));
      const high = num(a ? v[2] : (v.high ?? v.h));
      const low = num(a ? v[3] : (v.low ?? v.l));
      const close = num(a ? v[4] : (v.close ?? v.c));
      const volume = num(a ? v[5] : (v.volume ?? v.vol ?? v.v ?? 0));
      if (![time, open, high, low, close, volume].every(Number.isFinite)) continue;
      if (time <= 0 || high < Math.max(open, close) || low > Math.min(open, close) || low <= 0 || volume < 0) continue;
      output.push({ time, open, high, low, close, volume });
    }
    output.sort((a,b) => a.time - b.time);
    return [...new Map(output.map(x => [x.time, x])).values()];
  }

  async function candles(asset, tf) {
    const url = `/api/exchange/bingx/klines/${encodeURIComponent(asset.symbol)}?market=perpetual&interval=${tf}&limit=180`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 11000);
    try {
      const response = await fetch(url, { signal: controller.signal, cache: "no-store" });
      if (!response.ok) throw Error(`HTTP ${response.status}`);
      const payload = await response.json();
      if (payload?.code !== undefined && ![0, "0"].includes(payload.code)) throw Error(payload.msg || "Respuesta de API no válida");
      const rows = normalized(payload);
      // El último registro podría ser una vela todavía abierta; excluirlo.
      const closed = rows.filter(c => c.time + (tf === "1m" ? 60 : 300) <= Math.floor(Date.now() / 1000) - 2);
      if (closed.length < 65) throw Error(`Faltan velas cerradas de ${tf}`);
      if (Math.floor(Date.now() / 1000) - closed.at(-1).time > (tf === "1m" ? 240 : 900)) throw Error(`Datos de ${tf} desactualizados`);
      return closed;
    } finally { clearTimeout(timer); }
  }

  function ema(values, len) {
    if (values.length < len) return NaN;
    let out = values.slice(0, len).reduce((a,b) => a+b,0) / len;
    for (let i=len; i<values.length; i++) out = values[i] * 2 / (len+1) + out * (len-1) / (len+1);
    return out;
  }
  function sma(values, len) { return values.length < len ? NaN : values.slice(-len).reduce((a,b) => a+b,0) / len; }
  function atr(rows, len=14) {
    const r = [];
    for (let i=1;i<rows.length;i++) r.push(Math.max(rows[i].high-rows[i].low, Math.abs(rows[i].high-rows[i-1].close), Math.abs(rows[i].low-rows[i-1].close)));
    return sma(r,len);
  }
  function digits(asset) { return asset.symbol === "BTC-USDT" ? 2 : asset.symbol.includes("GOLD") ? 3 : 3; }
  function analyze(asset, one, five, side) {
    const long = side === "LONG";
    const last = one.at(-1);
    const closes1 = one.map(c => c.close);
    const closes5 = five.map(c => c.close);
    const e1 = ema(closes1,21), m1 = sma(closes1,55);
    const e5 = ema(closes5,21), m5 = sma(closes5,55);
    const aligned = long
      ? last.close > e1 && e1 > m1 && five.at(-1).close > e5 && e5 > m5
      : last.close < e1 && e1 < m1 && five.at(-1).close < e5 && e5 < m5;
    if (!aligned) return { status: "ESPERANDO CONFIRMACIÓN", reason: "Medias de uno y cinco minutos sin alineación suficiente" };
    const volatility = atr(one);
    if (!Number.isFinite(volatility) || volatility <= 0) return { status: "ESPERANDO CONFIRMACIÓN", reason: "Volatilidad no verificable" };
    const prior = one.slice(-13,-3);
    const level = long ? Math.max(...prior.map(c=>c.high)) : Math.min(...prior.map(c=>c.low));
    const recent = one.slice(-3);
    const broke = recent.some(c => long ? c.close > level + 0.04*volatility : c.close < level - 0.04*volatility);
    const retest = long
      ? last.low <= level + 0.25*volatility && last.close > level
      : last.high >= level - 0.25*volatility && last.close < level;
    const baseline = sma(one.slice(-24,-4).map(c=>c.volume),20);
    const vol = Math.max(...recent.map(c=>c.volume));
    const volumeOk = baseline > 0 && vol >= baseline * 1.3;
    if (!broke || !retest || !volumeOk) return {
      status: "ESPERANDO CONFIRMACIÓN",
      reason: `Ruptura: ${broke?'sí':'no'} · Retesteo: ${retest?'sí':'no'} · Volumen: ${volumeOk?'sí':'no'}`
    };
    const entry = long ? last.high : last.low;
    const stop = long ? Math.min(...one.slice(-6).map(c=>c.low)) - 0.2*volatility : Math.max(...one.slice(-6).map(c=>c.high)) + 0.2*volatility;
    const risk = Math.abs(entry-stop);
    const riskPct = 100*risk/entry;
    if (risk <= 0 || riskPct < 0.02 || riskPct > 0.6) return {status:"ESPERANDO CONFIRMACIÓN",reason:"Stop estructural demasiado estrecho o amplio para este filtro"};
    const direction = long ? 1 : -1;
    const targets = [50,100,200].map(roi => ({ roi, price: entry * (1 + direction * roi / (100 * asset.leverage)) }));
    if (targets.some(t=>t.price <= 0)) return {status:"ESPERANDO CONFIRMACIÓN",reason:"Objetivo de precio no válido"};
    // Evitar mostrar una oportunidad cuya entrada ya se activó en la vela cerrada más reciente.
    const rr = targets.map(t => ({...t, rr: Math.abs(t.price-entry)/risk}));
    return {status:"CONFIGURACIÓN DETECTADA · ENTRADA CONDICIONAL",reason:"Ruptura, retesteo, volumen y tendencia alineados",side,entry,stop,riskPct,targets:rr,at:last.time,precision:digits(asset)};
  }

  function el(tag, className, value) {
    const e = document.createElement(tag);
    if (className) e.className = className;
    if (value !== undefined) e.textContent = String(value);
    return e;
  }
  function build() {
    if ($("clQuickScalp")) return;
    const host = $("clScanner") || $("clScannerIntro") || document.querySelector("main");
    if (!host) return;
    const section = el("section","cl-quick-scalp"); section.id="clQuickScalp";
    const top = el("div","clqs-top");
    top.append(el("h2","","⚡ SCALPING RÁPIDO"));
    const refresh = el("button","clqs-refresh","Actualizar"); refresh.type="button"; refresh.addEventListener("click",()=>run(true));
    top.append(refresh); section.append(top);
    section.append(el("p","clqs-note","Monitor informativo · BTC y oro 100x · Petróleo 50x · Solo futuros perpetuos BingX. Objetivos de ROI bruto sobre margen: +50%, +100%, +200%. No son relaciones riesgo-beneficio."));
    const grid = el("div","clqs-grid"); grid.id="clQuickScalpGrid"; section.append(grid);
    const foot = el("p","clqs-note"); foot.id="clQuickScalpStatus"; foot.textContent="Preparando análisis de velas cerradas…"; section.append(foot);
    host.prepend(section);
    if (!$('clQuickScalpCSS')) {
      const style = el('style'); style.id='clQuickScalpCSS'; style.textContent=`
        .cl-quick-scalp{margin:16px 0;padding:15px;background:#0e1730;color:#e7eeff;border:1px solid #344269;border-radius:15px}
        .clqs-top{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap}
        .clqs-top h2{font-size:17px;margin:0;color:#ffe15a}
        .clqs-refresh{background:#29214c;color:#fff;border:1px solid #7657ac;border-radius:9px;padding:8px 12px;cursor:pointer}
        .clqs-note{font-size:12px;line-height:1.5;color:#acbad6;margin:10px 0}
        .clqs-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,270px),1fr));gap:12px}
        .clqs-asset{background:#111d36;border:1px solid #35496b;border-radius:12px;padding:12px;min-width:0}
        .clqs-title{font-size:15px;font-weight:700;display:flex;justify-content:space-between;gap:8px;margin-bottom:10px}
        .clqs-lev{color:#ffe15a}
        .clqs-sides{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
        .clqs-side{padding:10px 8px;border-radius:10px;min-width:0;background:#0b1429;border:1px solid #2a3a56}
        .clqs-side.long{border-top:2px solid #00f5a0}.clqs-side.short{border-top:2px solid #ff476c}
        .clqs-side h4{font-size:13px;margin:0 0 8px}.clqs-side.long h4{color:#00f5a0}.clqs-side.short h4{color:#ff476c}
        .clqs-status{font-size:11px;color:#ffe15a;line-height:1.45;margin-bottom:8px;overflow-wrap:anywhere}
        .clqs-line{font-size:11px;margin:4px 0;overflow-wrap:anywhere}
        .clqs-line strong{color:#e7eeff}.clqs-target{color:#00f5a0}
        .clqs-reason{font-size:11px;color:#aebbd4;line-height:1.45;margin-top:8px;overflow-wrap:anywhere}
        @media(max-width:370px){.clqs-sides{grid-template-columns:1fr}}
      `; document.head.append(style);
    }
    for (const asset of ASSETS) {
      const card = el('article','clqs-asset');
      const title = el('div','clqs-title'); title.append(el('span','',`${asset.icon} ${asset.name}`),el('span','clqs-lev',`${asset.leverage}x`)); card.append(title);
      const sides = el('div','clqs-sides');
      for (const side of ['LONG','SHORT']) {
        const pane=el('div',`clqs-side ${side.toLowerCase()}`); pane.id=`clqs-${asset.symbol.replace(/[^a-z0-9]/gi,'_')}-${side}`;
        sides.append(pane);
      }
      card.append(sides); grid.append(card);
    }
    render();
  }
  function renderPane(asset,side,data) {
    const pane=$(`clqs-${asset.symbol.replace(/[^a-z0-9]/gi,'_')}-${side}`); if(!pane)return;
    pane.replaceChildren(); pane.append(el('h4','',side==='LONG'?'▲ LONG':'▼ SHORT'));
    pane.append(el('div','clqs-status',data?.status||'ESPERANDO CONFIRMACIÓN'));
    if(data?.entry) {
      pane.append(el('div','clqs-line',`Entrada: ${fmt(data.entry,data.precision)}`));
      pane.append(el('div','clqs-line',`Stop: ${fmt(data.stop,data.precision)}`));
      pane.append(el('div','clqs-line',`Riesgo teórico: ${fmt(data.riskPct,3)}% precio · ${fmt(data.riskPct*asset.leverage,1)}% margen`));
      for(const t of data.targets) pane.append(el('div','clqs-line clqs-target',`TP +${t.roi}% margen: ${fmt(t.price,data.precision)} · R/B ${fmt(t.rr,2)}`));
      pane.append(el('div','clqs-line',`Señal evaluada: ${new Date(data.at*1000).toLocaleTimeString('es-MX')}`));
    } else {
      pane.append(el('div','clqs-line','Entrada: — · Stop: —'));
      pane.append(el('div','clqs-line','TP 50%: — · TP 100%: — · TP 200%: —'));
    }
    pane.append(el('div','clqs-reason',data?.reason||'Esperando velas cerradas'));
  }
  function render(){for(const a of ASSETS)for(const s of ['LONG','SHORT'])renderPane(a,s,state.get(`${a.symbol}|${s}`));}
  async function run(force=false){
    build(); if(busy||document.hidden)return;
    if(!force&&Date.now()-lastRun<45000)return;
    busy=true; lastRun=Date.now();
    const status=$('clQuickScalpStatus'); if(status)status.textContent='Actualizando análisis con velas cerradas…';
    for(const a of ASSETS){
      try{
        const [one,five]=await Promise.all([candles(a,'1m'),candles(a,'5m')]);
        for(const side of ['LONG','SHORT'])state.set(`${a.symbol}|${side}`,analyze(a,one,five,side));
      }catch(e){for(const side of ['LONG','SHORT'])state.set(`${a.symbol}|${side}`,{status:'DATOS NO DISPONIBLES',reason:String(e.message||e)});}
      render(); await sleep(100);
    }
    if(status)status.textContent=`Última revisión: ${new Date().toLocaleTimeString('es-MX')} · Datos públicos, no órdenes reales. El objetivo de ROI no incluye comisiones, financiación ni deslizamiento. Una señal condicional no equivale a una entrada ejecutada.`;
    busy=false;
  }
  function init(){build();run(true);setInterval(()=>run(),60000);document.addEventListener('visibilitychange',()=>{if(!document.hidden)run(true)});}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
