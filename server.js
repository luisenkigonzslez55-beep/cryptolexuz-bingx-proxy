

import express from 'express';
import cors from 'cors';
import http from 'node:http';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { WebSocket, WebSocketServer } from 'ws';

// CRYPTOLEXUZ PRO V13 — API multi-exchange y WebSocket compartido.
const app = express();
const server = http.createServer(app);
const PORT = Number(process.env.PORT || 3000);
const allowedOrigin = process.env.ALLOWED_ORIGIN || '*';
app.disable('x-powered-by');
app.use(cors({ origin: allowedOrigin === '*' ? '*' : allowedOrigin.split(',').map(x => x.trim()) }));
app.use(express.json({ limit: '32kb' }));
app.use(express.static(path.join(process.cwd(), 'public')));

const EXCHANGES = ['bingx', 'binance', 'bybit', 'okx'];
const INTERVALS = new Set(['1m','3m','5m','15m','30m','1h','2h','4h','6h','8h','12h','1d','3d','1w','1M']);
const HOSTS = {
  bingx: 'https://open-api.bingx.com',
  binanceSpot: 'https://api.binance.com',
  binanceFutures: 'https://fapi.binance.com',
  bybit: 'https://api.bybit.com',
  okx: 'https://www.okx.com'
};
const now = () => Date.now();
const n = x => x === null || x === undefined || x === '' ? null : Number.isFinite(Number(x)) ? Number(x) : null;
function fail(message, status = 400) { const e = new Error(message); e.status = status; return e; }
function exchangeCheck(x) { x = String(x || '').toLowerCase(); if (!EXCHANGES.includes(x)) throw fail('Exchange inválido'); return x; }
function marketCheck(x) { if (x !== 'spot' && x !== 'perpetual') throw fail('Mercado inválido'); return x; }
function symbolCheck(x) { x = String(x || '').toUpperCase().replace(/_/g, '-'); if (!/^[A-Z0-9]{2,20}-[A-Z0-9]{2,20}$/.test(x)) throw fail('Símbolo inválido'); return x; }
function intervalCheck(x) { x = String(x || '15m'); if (!INTERVALS.has(x)) throw fail('Temporalidad inválida'); return x; }
function limitCheck(x, max = 300, fallback = 100) { const v = n(x ?? fallback); if (v === null) throw fail('Límite inválido'); return Math.max(1, Math.min(max, Math.floor(v))); }
function makeURL(base, route, params = {}) { const u = new URL(route, base); for (const [k,v] of Object.entries(params)) if (v !== null && v !== undefined) u.searchParams.set(k, String(v)); return u.toString(); }

async function fetchJSON(url) {
  let response;
  try { response = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(10000) }); }
  catch (e) { throw fail(`No se pudo contactar al exchange: ${e.name === 'TimeoutError' ? 'tiempo agotado' : 'error de red'}`, 502); }
  if (!response.ok) throw fail(`Exchange respondió HTTP ${response.status}`, 502);
  try { return await response.json(); } catch { throw fail('El exchange devolvió una respuesta no válida', 502); }
}
function unwrap(exchange, result) {
  if (exchange === 'bingx') { if (Number(result?.code) !== 0) throw fail(String(result?.msg || 'Error de BingX'), 502); return result.data; }
  if (exchange === 'bybit') { if (Number(result?.retCode) !== 0) throw fail(String(result?.retMsg || 'Error de Bybit'), 502); return result.result; }
  if (exchange === 'okx') { if (String(result?.code) !== '0') throw fail(String(result?.msg || 'Error de OKX'), 502); return result.data; }
  if (result && !Array.isArray(result) && typeof result.code === 'number' && result.code < 0) throw fail(String(result.msg || 'Error de Binance'), 502);
  return result;
}
function exchangeSymbol(exchange, market, symbol) {
  if (exchange === 'bingx') return symbol;
  if (exchange === 'okx') return market === 'perpetual' ? `${symbol}-SWAP` : symbol;
  return symbol.replace('-', '');
}
function exchangeInterval(exchange, tf) {
  if (exchange === 'bybit') {
    const map = { '1m':'1','3m':'3','5m':'5','15m':'15','30m':'30','1h':'60','2h':'120','4h':'240','6h':'360','12h':'720','1d':'D','1w':'W','1M':'M' };
    if (!map[tf]) throw fail('Temporalidad incompatible con Bybit'); return map[tf];
  }
  if (exchange === 'okx') {
    const map = { '1m':'1m','3m':'3m','5m':'5m','15m':'15m','30m':'30m','1h':'1H','2h':'2H','4h':'4H','6h':'6H','12h':'12H','1d':'1Dutc','1w':'1Wutc','1M':'1Mutc' };
    if (!map[tf]) throw fail('Temporalidad incompatible con OKX'); return map[tf];
  }
  return tf;
}
function endpoint(exchange, market, type, symbol, tf, limit) {
  const spot = market === 'spot', s = exchangeSymbol(exchange, market, symbol);
  if (exchange === 'bingx') {
    const routes = spot ? { ticker:'/openApi/spot/v2/ticker/24hr', klines:'/openApi/spot/v2/market/kline', depth:'/openApi/spot/v1/market/depth' } : { ticker:'/openApi/swap/v2/quote/ticker', klines:'/openApi/swap/v3/quote/klines', depth:'/openApi/swap/v2/quote/depth' };
    return makeURL(HOSTS.bingx, routes[type], { symbol:s, ...(type === 'klines' ? {interval:tf,limit} : {}), ...(type === 'depth' ? {limit:10} : {}) });
  }
  if (exchange === 'binance') {
    const base = spot ? HOSTS.binanceSpot : HOSTS.binanceFutures;
    return makeURL(base, `${spot ? '/api/v3' : '/fapi/v1'}/${type === 'ticker' ? 'ticker/24hr' : type === 'klines' ? 'klines' : 'depth'}`, { symbol:s, ...(type === 'klines' ? {interval:tf,limit} : {}), ...(type === 'depth' ? {limit:10} : {}) });
  }
  if (exchange === 'bybit') {
    return makeURL(HOSTS.bybit, `/v5/market/${type === 'ticker' ? 'tickers' : type === 'klines' ? 'kline' : 'orderbook'}`, { category:spot ? 'spot' : 'linear', symbol:s, ...(type === 'klines' ? {interval:exchangeInterval(exchange,tf),limit} : {}), ...(type === 'depth' ? {limit:50} : {}) });
  }
  return makeURL(HOSTS.okx, `/api/v5/market/${type === 'ticker' ? 'ticker' : type === 'klines' ? 'candles' : 'books'}`, { instId:s, ...(type === 'klines' ? {bar:exchangeInterval(exchange,tf),limit} : {}), ...(type === 'depth' ? {sz:10} : {}) });
}
async function getRaw(exchange, market, type, symbol, tf = '15m', limit = 100) {
  return unwrap(exchange, await fetchJSON(endpoint(exchange, market, type, symbol, tf, limit)));
}
function normalizeTicker(exchange, raw) {
  const d = exchange === 'bybit' ? raw?.list?.[0] : Array.isArray(raw) ? raw[0] : raw;
  if (!d || typeof d !== 'object') throw fail('Ticker no disponible', 502);
  const lastPrice = n(d.lastPrice ?? d.last ?? d.price ?? d.close);
  if (lastPrice === null || lastPrice <= 0) throw fail('Precio no disponible', 502);
  const openPrice = n(d.openPrice ?? d.open24h ?? d.open ?? d.openPrice24h);
  let priceChangePercent = n(d.priceChangePercent);
  if (exchange === 'bybit' && n(d.price24hPcnt) !== null) priceChangePercent = n(d.price24hPcnt) * 100;
  if (exchange === 'okx' && n(d.sodUtc0) > 0) priceChangePercent = (lastPrice / n(d.sodUtc0) - 1) * 100;
  if (priceChangePercent === null && openPrice > 0) priceChangePercent = (lastPrice / openPrice - 1) * 100;
  return {
    lastPrice, openPrice,
    highPrice:n(d.highPrice ?? d.high24h ?? d.high24hPrice ?? d.high),
    lowPrice:n(d.lowPrice ?? d.low24h ?? d.low24hPrice ?? d.low),
    volume:n(d.volume ?? d.volume24h ?? d.vol24h ?? d.vol24hBase ?? d.vol),
    priceChangePercent,
    bidPrice:n(d.bidPrice ?? d.bid1Price ?? d.bidPx),
    askPrice:n(d.askPrice ?? d.ask1Price ?? d.askPx)
  };
}
function normalizeKlines(exchange, raw) {
  const source = exchange === 'bybit' ? raw?.list : raw;
  if (!Array.isArray(source)) throw fail('Velas no disponibles', 502);
  const candles = [];
  for (const item of source) {
    const a = Array.isArray(item);
    // OKX: [ts,open,high,low,close,vol,...]; Binance/Bybit: mismo prefijo.
    // BingX puede entregar objetos OHLCV o arreglos con el mismo prefijo.
    const time = n(a ? item[0] : item?.time ?? item?.timestamp ?? item?.openTime ?? item?.t);
    const open = n(a ? item[1] : item?.open ?? item?.o);
    const high = n(a ? item[2] : item?.high ?? item?.h);
    const low = n(a ? item[3] : item?.low ?? item?.l);
    const close = n(a ? item[4] : item?.close ?? item?.c);
    const volume = n(a ? item[5] : item?.volume ?? item?.vol ?? item?.v) ?? 0;
    if ([time,open,high,low,close].some(v => v === null)) continue;
    if (time <= 0 || open <= 0 || high <= 0 || low <= 0 || close <= 0 || volume < 0) continue;
    if (high < Math.max(open,close,low) || low > Math.min(open,close,high)) continue;
    const seconds = Math.floor(time > 1e12 ? time / 1000 : time);
    if (seconds > Math.floor(now()/1000) + 86400 || seconds < 946684800) continue;
    candles.push({time:seconds,open,high,low,close,volume});
  }
  candles.sort((a,b) => a.time-b.time);
  const unique = new Map(candles.map(c => [c.time,c]));
  const result = [...unique.values()];
  if (!result.length) throw fail('No se recibieron velas válidas', 502);
  return result;
}
function normalizeDepth(exchange, raw) {
  const d = exchange === 'okx' ? raw?.[0] : raw;
  if (!d) throw fail('Libro de órdenes no disponible', 502);
  function levels(items, desc) {
    return (Array.isArray(items) ? items : []).map(x => ({price:n(x[0]),quantity:n(x[1])})).filter(x => x.price > 0 && x.quantity !== null && x.quantity >= 0).sort((a,b) => desc ? b.price-a.price : a.price-b.price).slice(0,10);
  }
  return {bids:levels(d.bids ?? d.b,true),asks:levels(d.asks ?? d.a,false),timestamp:now()};
}
function handleError(res,e) { console.error('[API]',e.message); if (!res.headersSent) res.status(e.status || 502).json({ok:false,error:e.message}); }

app.get('/health',(_req,res) => res.json({ok:true,service:'CRYPTOLEXUZ',version:'13.0',websocket:true,exchanges:EXCHANGES,activeFeeds:feeds.size,uptimeSeconds:Math.floor(process.uptime())}));
app.get('/api/exchanges',(_req,res) => res.json({ok:true,exchanges:EXCHANGES,markets:['spot','perpetual'],features:['ticker','klines','depth','websocket']}));
app.get('/api/market/:market/:type/:symbol',async(req,res) => {
  try {
    const market = marketCheck(req.params.market), symbol = symbolCheck(req.params.symbol), type = req.params.type;
    if (!['ticker','klines'].includes(type)) throw fail('Consulta inválida');
    const interval = intervalCheck(req.query.interval), limit = limitCheck(req.query.limit,500,100);
    const data = await getRaw('bingx',market,type,symbol,interval,limit);
    res.json({source:'BingX',market,symbol,interval,data,fetchedAt:new Date().toISOString()});
  } catch(e) { handleError(res,e); }
});
app.get('/api/exchange/:exchange/:type/:symbol',async(req,res) => {
  try {
    const exchange = exchangeCheck(req.params.exchange), market = marketCheck(String(req.query.market || 'perpetual'));
    const symbol = symbolCheck(req.params.symbol), type = req.params.type;
    if (!['ticker','klines','depth'].includes(type)) throw fail('Consulta inválida');
    const tf = type === 'klines' ? intervalCheck(req.query.interval) : '15m';
    const limit = limitCheck(req.query.limit,300,300);
    const raw = await getRaw(exchange,market,type,symbol,tf,limit);
    const data = type === 'ticker' ? normalizeTicker(exchange,raw) : type === 'klines' ? normalizeKlines(exchange,raw) : normalizeDepth(exchange,raw);
    res.json({ok:true,exchange,market,symbol,type,data,fetchedAt:new Date().toISOString()});
  } catch(e) { handleError(res,e); }
});

// Una conexión al exchange por cada combinación exchange/mercado/símbolo.
const wss = new WebSocketServer({noServer:true,perMessageDeflate:false});
const feeds = new Map();
function send(client,payload) {
  if (client.readyState === WebSocket.OPEN && client.bufferedAmount < 1000000) {
    try { client.send(JSON.stringify(payload)); } catch(e) { console.warn('[CLIENT WS]',e.message); }
  }
}
function upstreamAddress(exchange,market,symbol) {
  const s = exchangeSymbol(exchange,market,symbol);
  if (exchange === 'bingx') return market === 'spot' ? 'wss://open-api-ws.bingx.com/market' : 'wss://open-api-swap.bingx.com/swap-market';
  if (exchange === 'binance') return market === 'spot' ? `wss://stream.binance.com:9443/ws/${s.toLowerCase()}@aggTrade` : `wss://fstream.binance.com/ws/${s.toLowerCase()}@aggTrade`;
  if (exchange === 'bybit') return market === 'spot' ? 'wss://stream.bybit.com/v5/public/spot' : 'wss://stream.bybit.com/v5/public/linear';
  return 'wss://ws.okx.com:8443/ws/v5/public';
}
function decodeBingX(data) { const b = Buffer.isBuffer(data) ? data : Buffer.from(data); try { return gunzipSync(b).toString('utf8'); } catch { return b.toString('utf8'); } }
function extractPrice(exchange,msg) {
  if (exchange === 'binance') return msg.e === 'aggTrade' ? n(msg.p) : null;
  if (exchange === 'bybit') { if (!String(msg.topic || '').startsWith('tickers.')) return null; const d = Array.isArray(msg.data) ? msg.data[0] : msg.data; return n(d?.lastPrice); }
  if (exchange === 'okx') return msg.arg?.channel === 'tickers' ? n(msg.data?.[0]?.last) : null;
  const channel = String(msg.dataType || '');
  if (!channel.includes('@ticker') && !channel.includes('@trade')) return null;
  const d = Array.isArray(msg.data) ? msg.data.at(-1) : msg.data;
  return n(d?.lastPrice ?? d?.last ?? d?.price ?? d?.p ?? d?.c);
}
function feedKey(config) { return `${config.exchange}|${config.market}|${config.symbol}`; }
function createFeed(config) {
  const key = feedKey(config);
  const feed = {key,...config,clients:new Set(),upstream:null,retryTimer:null,heartbeatTimer:null,fallbackTimer:null,idleTimer:null,staleTimer:null,retryCount:0,lastReceived:0,lastSent:0,lastPrice:null,fallbackBusy:false,stopped:false};
  feeds.set(key,feed);
  const broadcast = payload => { for (const client of feed.clients) send(client,payload); };
  const publish = (price,source='websocket') => {
    if (!Number.isFinite(price) || price <= 0) return;
    // No sustituir un precio válido por un salto aislado > 20%; el REST seguirá conciliando.
    if (feed.lastPrice && Math.abs(price/feed.lastPrice-1) > .20) { console.warn('[PRICE OUTLIER]',key,price); return; }
    feed.lastPrice = price;
    const time = now();
    if (time-feed.lastSent < 100) return;
    feed.lastSent = time;
    broadcast({type:'price',exchange:feed.exchange,market:feed.market,symbol:feed.symbol,price,source,timestamp:time});
  };
  const stopUpstream = () => {
    clearInterval(feed.heartbeatTimer); feed.heartbeatTimer = null;
    if (feed.upstream) { const old = feed.upstream; feed.upstream = null; old.removeAllListeners(); try { old.terminate(); } catch {} }
  };
  const reconnect = () => {
    if (feed.stopped || !feed.clients.size) return;
    stopUpstream(); clearTimeout(feed.retryTimer);
    const delay = Math.min(30000,1000*2**Math.min(feed.retryCount++,5));
    broadcast({type:'status',status:'reconnecting',retryInMs:delay});
    feed.retryTimer = setTimeout(connect,delay);
  };
  async function fallbackPrice() {
    if (feed.stopped || !feed.clients.size || feed.fallbackBusy || now()-feed.lastReceived < 5000) return;
    feed.fallbackBusy = true;
    try { const ticker = normalizeTicker(feed.exchange,await getRaw(feed.exchange,feed.market,'ticker',feed.symbol)); publish(ticker.lastPrice,'rest-fallback'); }
    catch(e) { console.warn('[FALLBACK]',key,e.message); }
    finally { feed.fallbackBusy = false; }
  }
  function connect() {
    if (feed.stopped || !feed.clients.size) return;
    clearTimeout(feed.retryTimer);
    let ws;
    try { ws = new WebSocket(upstreamAddress(feed.exchange,feed.market,feed.symbol),{handshakeTimeout:10000,perMessageDeflate:false}); }
    catch(e) { console.warn('[WS CONNECT]',key,e.message); reconnect(); return; }
    feed.upstream = ws;
    ws.on('open',() => {
      if (feed.stopped || feed.upstream !== ws) return;
      feed.retryCount = 0; feed.lastReceived = now();
      broadcast({type:'status',status:'connected',exchange:feed.exchange,market:feed.market,symbol:feed.symbol});
      const s = exchangeSymbol(feed.exchange,feed.market,feed.symbol);
      if (feed.exchange === 'bingx') {
        ws.send(JSON.stringify({id:'cryptolexuz-ticker',reqType:'sub',dataType:`${s}@ticker`}));
        ws.send(JSON.stringify({id:'cryptolexuz-trade',reqType:'sub',dataType:`${s}@trade`}));
      } else if (feed.exchange === 'bybit') {
        ws.send(JSON.stringify({op:'subscribe',args:[`tickers.${s}`]}));
        feed.heartbeatTimer = setInterval(() => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({op:'ping'})); },20000);
      } else if (feed.exchange === 'okx') {
        ws.send(JSON.stringify({op:'subscribe',args:[{channel:'tickers',instId:s}]}));
        feed.heartbeatTimer = setInterval(() => { if (ws.readyState === WebSocket.OPEN) ws.send('ping'); },20000);
      }
    });
    ws.on('message',buffer => {
      try {
        const text = feed.exchange === 'bingx' ? decodeBingX(buffer) : buffer.toString('utf8');
        if (feed.exchange === 'bingx' && (text === 'Ping' || text === 'ping')) { ws.send(text === 'Ping' ? 'Pong' : 'pong'); return; }
        if (text === 'pong' || text === 'Pong') return;
        const msg = JSON.parse(text);
        if (feed.exchange === 'bingx' && msg.ping !== undefined) { ws.send(JSON.stringify({pong:msg.ping})); return; }
        const price = extractPrice(feed.exchange,msg);
        if (price !== null && price > 0) { feed.lastReceived = now(); publish(price); }
      } catch(e) { console.warn('[WS MESSAGE]',key,e.message); }
    });
    ws.on('error',e => console.warn('[UPSTREAM WS]',key,e.message));
    ws.on('close',() => { if (feed.upstream === ws) reconnect(); });
  }
  feed.stop = () => {
    if (feed.stopped) return;
    feed.stopped = true;
    clearTimeout(feed.retryTimer); clearTimeout(feed.idleTimer);
    clearInterval(feed.fallbackTimer); clearInterval(feed.staleTimer);
    stopUpstream(); feeds.delete(key);
  };
  feed.start = () => {
    connect();
    feed.fallbackTimer = setInterval(fallbackPrice,5000);
    feed.staleTimer = setInterval(() => {
      if (feed.stopped || !feed.clients.size) return;
      if (feed.upstream?.readyState === WebSocket.OPEN && now()-feed.lastReceived > 60000) {
        console.warn('[WS STALE]',key); reconnect();
      }
    },15000);
    fallbackPrice();
  };
  return feed;
}
wss.on('connection',(client,_req,config) => {
  const key = feedKey(config);
  let feed = feeds.get(key);
  const fresh = !feed;
  if (!feed) feed = createFeed(config);
  clearTimeout(feed.idleTimer); feed.idleTimer = null;
  feed.clients.add(client);
  send(client,{type:'status',status:'connecting',...config});
  if (feed.lastPrice) send(client,{type:'price',...config,price:feed.lastPrice,source:'rest-fallback',timestamp:now()});
  if (fresh) feed.start();
  const cleanup = () => {
    feed.clients.delete(client);
    if (!feed.clients.size && !feed.stopped) feed.idleTimer = setTimeout(() => { if (!feed.clients.size) feed.stop(); },15000);
  };
  client.on('close',cleanup); client.on('error',cleanup);
});
server.on('upgrade',(req,socket,head) => {
  try {
    const u = new URL(req.url,'http://localhost');
    if (u.pathname !== '/ws') { socket.destroy(); return; }
    const config = {exchange:exchangeCheck(u.searchParams.get('exchange') || 'bingx'),market:marketCheck(u.searchParams.get('market') || 'perpetual'),symbol:symbolCheck(u.searchParams.get('symbol') || 'BTC-USDT')};
    wss.handleUpgrade(req,socket,head,ws => wss.emit('connection',ws,req,config));
  } catch(e) { console.warn('[WS UPGRADE]',e.message); socket.destroy(); }
});
server.on('error',e => { console.error('[SERVER]',e); process.exitCode = 1; });
server.listen(PORT,'0.0.0.0',() => console.log(`CRYPTOLEXUZ PRO V13 escuchando en puerto ${PORT}`));
