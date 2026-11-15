JavaScript

import express from 'express';
import cors from 'cors';
import path from 'path';
import http from 'http';
import { gunzipSync } from 'zlib';
import { WebSocket, WebSocketServer } from 'ws';

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3000;
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*';

app.use(cors({
  origin: ALLOWED_ORIGIN === '*'
    ? '*'
    : ALLOWED_ORIGIN.split(',').map(s => s.trim())
}));
app.use(express.json());
app.use(express.static(path.join(process.cwd(), 'public')));

const HOSTS = {
  bingx: 'https://open-api.bingx.com',
  binanceSpot: 'https://api.binance.com',
  binanceFutures: 'https://fapi.binance.com',
  bybit: 'https://api.bybit.com',
  okx: 'https://www.okx.com'
};

const EXCHANGES = ['bingx', 'binance', 'bybit', 'okx'];

const INTERVALS = new Set([
  '1m', '3m', '5m', '15m', '30m',
  '1h', '2h', '4h', '6h', '8h',
  '12h', '1d', '3d', '1w', '1M'
]);

const bad = (message, status = 400) =>
  Object.assign(new Error(message), { status });

function validMarket(market) {
  if (!['spot', 'perpetual'].includes(market)) {
    throw bad('Mercado inválido: spot o perpetual');
  }
  return market;
}

function validSymbol(value) {
  const symbol = String(value || '')
    .toUpperCase()
    .replace(/_/g, '-');

  if (!/^[A-Z0-9]+-[A-Z0-9]+$/.test(symbol)) {
    throw bad('Símbolo inválido; ejemplo BTC-USDT');
  }
  return symbol;
}

function validExchange(value) {
  const exchange = String(value || '').toLowerCase();
  if (!EXCHANGES.includes(exchange)) {
    throw bad('Exchange inválido');
  }
  return exchange;
}

function validInterval(value) {
  const interval = String(value || '15m');
  if (!INTERVALS.has(interval)) {
    throw bad('Temporalidad no permitida');
  }
  return interval;
}

function validLimit(value, max = 300, fallback = 100) {
  const n = Number(value ?? fallback);
  if (!Number.isFinite(n)) {
    throw bad('Límite inválido');
  }
  return Math.max(1, Math.min(max, Math.floor(n)));
}

function n(value) {
  if (
    value === undefined ||
    value === null ||
    value === ''
  ) return null;

  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function url(base, route, params = {}) {
  const u = new URL(route, base);

  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      u.searchParams.set(key, String(value));
    }
  });

  return u.toString();
}

async function requestJSON(address) {
  const response = await fetch(address, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(10000)
  });

  if (!response.ok) {
    throw bad(
      `Exchange respondió HTTP ${response.status}`,
      502
    );
  }

  return response.json();
}

function unwrap(exchange, response) {
  if (exchange === 'bingx') {
    if (Number(response?.code) !== 0) {
      throw bad(response?.msg || 'Error de BingX', 502);
    }
    return response.data;
  }

  if (exchange === 'bybit') {
    if (Number(response?.retCode) !== 0) {
      throw bad(response?.retMsg || 'Error de Bybit', 502);
    }
    return response.result;
  }

  if (exchange === 'okx') {
    if (String(response?.code) !== '0') {
      throw bad(response?.msg || 'Error de OKX', 502);
    }
    return response.data;
  }

  if (
    response &&
    !Array.isArray(response) &&
    typeof response.code === 'number' &&
    response.code < 0
  ) {
    throw bad(response.msg || 'Error de Binance', 502);
  }

  return response;
}

function symbolFor(exchange, market, symbol) {
  if (exchange === 'bingx') return symbol;

  if (exchange === 'okx') {
    return market === 'perpetual'
      ? `${symbol}-SWAP`
      : symbol;
  }

  return symbol.replace('-', '');
}

function intervalFor(exchange, interval) {
  if (exchange === 'bybit') {
    const map = {
      '1m': '1',
      '3m': '3',
      '5m': '5',
      '15m': '15',
      '30m': '30',
      '1h': '60',
      '2h': '120',
      '4h': '240',
      '6h': '360',
      '12h': '720',
      '1d': 'D',
      '1w': 'W',
      '1M': 'M'
    };

    if (!map[interval]) {
      throw bad('Temporalidad no compatible con Bybit');
    }

    return map[interval];
  }

  if (exchange === 'okx') {
    const map = {
      '1m': '1m',
      '3m': '3m',
      '5m': '5m',
      '15m': '15m',
      '30m': '30m',
      '1h': '1H',
      '2h': '2H',
      '4h': '4H',
      '6h': '6H',
      '12h': '12H',
      '1d': '1Dutc',
      '1w': '1Wutc',
      '1M': '1Mutc'
    };

    if (!map[interval]) {
      throw bad('Temporalidad no compatible con OKX');
    }

    return map[interval];
  }

  return interval;
}

function endpoint(
  exchange,
  market,
  type,
  symbol,
  interval = '15m',
  limit = 100
) {
  const spot = market === 'spot';
  const s = symbolFor(exchange, market, symbol);

  if (exchange === 'bingx') {
    const routes = spot
      ? {
          ticker: '/openApi/spot/v2/ticker/price',
          klines: '/openApi/spot/v2/market/kline',
          depth: '/openApi/spot/v1/market/depth'
        }
      : {
          ticker: '/openApi/swap/v2/quote/ticker',
          klines: '/openApi/swap/v3/quote/klines',
          depth: '/openApi/swap/v2/quote/depth'
        };

    return url(HOSTS.bingx, routes[type], {
      symbol: s,
      ...(type === 'klines'
        ? { interval, limit }
        : {}),
      ...(type === 'depth'
        ? { limit: 10 }
        : {})
    });
  }

  if (exchange === 'binance') {
    const base = spot
      ? HOSTS.binanceSpot
      : HOSTS.binanceFutures;

    const prefix = spot ? '/api/v3' : '/fapi/v1';

    const routes = {
      ticker: '/ticker/24hr',
      klines: '/klines',
      depth: '/depth'
    };

    return url(base, prefix + routes[type], {
      symbol: s,
      ...(type === 'klines'
        ? {
            interval: intervalFor(exchange, interval),
            limit
          }
        : {}),
      ...(type === 'depth'
        ? { limit: 10 }
        : {})
    });
  }

  if (exchange === 'bybit') {
    const routes = {
      ticker: '/v5/market/tickers',
      klines: '/v5/market/kline',
      depth: '/v5/market/orderbook'
    };

    return url(HOSTS.bybit, routes[type], {
      category: spot ? 'spot' : 'linear',
      symbol: s,
      ...(type === 'klines'
        ? {
            interval: intervalFor(exchange, interval),
            limit
          }
        : {}),
      ...(type === 'depth'
        ? { limit: 50 }
        : {})
    });
  }

  const routes = {
    ticker: '/api/v5/market/ticker',
    klines: '/api/v5/market/candles',
    depth: '/api/v5/market/books'
  };

  return url(HOSTS.okx, routes[type], {
    instId: s,
    ...(type === 'klines'
      ? {
          bar: intervalFor(exchange, interval),
          limit: Math.min(limit, 300)
        }
      : {}),
    ...(type === 'depth'
      ? { sz: 10 }
      : {})
  });
}

function normalizeTicker(exchange, raw) {
  const d = exchange === 'bybit'
    ? raw?.list?.[0]
    : Array.isArray(raw)
      ? raw[0]
      : raw;

  if (!d) throw bad('Precio no disponible', 502);

  const lastPrice = n(
    d.lastPrice ?? d.last ?? d.price
  );

  if (lastPrice === null) {
    throw bad('Precio no disponible', 502);
  }

  const openPrice = n(
    d.openPrice ?? d.open24h ?? d.open
  );

  let priceChangePercent = n(d.priceChangePercent);

  if (
    exchange === 'bybit' &&
    n(d.price24hPcnt) !== null
  ) {
    priceChangePercent = n(d.price24hPcnt) * 100;
  }

  if (priceChangePercent === null && openPrice) {
    priceChangePercent =
      (lastPrice - openPrice) / openPrice * 100;
  }

  return {
    lastPrice,
    openPrice,
    highPrice: n(d.highPrice ?? d.high24h ?? d.high),
    lowPrice: n(d.lowPrice ?? d.low24h ?? d.low),
    volume: n(
      d.volume ?? d.volume24h ?? d.vol24h ?? d.vol
    ),
    priceChangePercent,
    bidPrice: n(
      d.bidPrice ?? d.bid1Price ?? d.bidPx
    ),
    askPrice: n(
      d.askPrice ?? d.ask1Price ?? d.askPx
    )
  };
}

function normalizeKlines(exchange, raw) {
  const rows = exchange === 'bybit'
    ? raw?.list
    : raw;

  if (!Array.isArray(rows)) {
    throw bad('Velas no disponibles', 502);
  }

  const candles = [];

  for (const item of rows) {
    const array = Array.isArray(item);

    const t = n(
      array
        ? item[0]
        : item.time ?? item.timestamp ?? item.openTime
    );

    const open = n(array ? item[1] : item.open);
    const high = n(array ? item[2] : item.high);
    const low = n(array ? item[3] : item.low);
    const close = n(array ? item[4] : item.close);
    const volume = n(
      array ? item[5] : item.volume ?? item.vol
    ) ?? 0;

    if (
      [t, open, high, low, close]
        .some(v => v === null)
    ) continue;

    if (
      high < Math.max(open, close) ||
      low > Math.min(open, close)
    ) continue;

    candles.push({
      time: Math.floor(t > 1e12 ? t / 1000 : t),
      open,
      high,
      low,
      close,
      volume
    });
  }

  candles.sort((a, b) => a.time - b.time);

  return candles.filter(
    (c, i) =>
      i === 0 || c.time !== candles[i - 1].time
  );
}

function normalizeDepth(exchange, raw) {
  const d = exchange === 'okx'
    ? raw?.[0]
    : raw;

  if (!d) {
    throw bad('Libro de órdenes no disponible', 502);
  }

  const levels = (rows, desc) =>
    (Array.isArray(rows) ? rows : [])
      .map(row => ({
        price: n(row[0]),
        quantity: n(row[1])
      }))
      .filter(row =>
        row.price > 0 &&
        row.quantity !== null &&
        row.quantity >= 0
      )
      .sort((a, b) =>
        desc
          ? b.price - a.price
          : a.price - b.price
      )
      .slice(0, 10);

  return {
    bids: levels(d.bids ?? d.b, true),
    asks: levels(d.asks ?? d.a, false),
    timestamp: Date.now()
  };
}

function handleError(res, error) {
  console.error(error.message);

  res.status(error.status || 502).json({
    ok: false,
    error: error.message
  });
}

// =====================================
// ESTADO DEL SERVIDOR
// =====================================

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'CRYPTOLEXUZ',
    version: '11.1',
    websocket: true,
    exchanges: EXCHANGES
  });
});

app.get('/api/exchanges', (_req, res) => {
  res.json({
    ok: true,
    exchanges: EXCHANGES,
    markets: ['spot', 'perpetual'],
    features: [
      'ticker',
      'klines',
      'depth',
      'websocket'
    ]
  });
});

// =====================================
// RUTAS ORIGINALES DE BINGX
// =====================================

app.get(
  '/api/market/:market/ticker/:symbol',
  async (req, res) => {
    try {
      const market = validMarket(req.params.market);
      const symbol = validSymbol(req.params.symbol);

      const data = unwrap(
        'bingx',
        await requestJSON(
          endpoint('bingx', market, 'ticker', symbol)
        )
      );

      res.json({
        source: 'BingX',
        market,
        symbol,
        data,
        fetchedAt: new Date().toISOString()
      });
    } catch (error) {
      handleError(res, error);
    }
  }
);

app.get(
  '/api/market/:market/klines/:symbol',
  async (req, res) => {
    try {
      const market = validMarket(req.params.market);
      const symbol = validSymbol(req.params.symbol);
      const interval = validInterval(req.query.interval);
      const limit = validLimit(req.query.limit, 500, 100);

      const data = unwrap(
        'bingx',
        await requestJSON(
          endpoint(
            'bingx',
            market,
            'klines',
            symbol,
            interval,
            limit
          )
        )
      );

      res.json({
        source: 'BingX',
        market,
        symbol,
        interval,
        data,
        fetchedAt: new Date().toISOString()
      });
    } catch (error) {
      handleError(res, error);
    }
  }
);

// =====================================
// RUTAS MULTIEXCHANGE
// =====================================

app.get(
  '/api/exchange/:exchange/:type/:symbol',
  async (req, res) => {
    try {
      const exchange = validExchange(
        req.params.exchange
      );

      const market = validMarket(
        String(req.query.market || 'perpetual')
      );

      const symbol = validSymbol(
        req.params.symbol
      );

      const type = String(req.params.type);

      if (!['ticker', 'klines', 'depth'].includes(type)) {
        throw bad('Tipo de consulta inválido');
      }

      const interval = type === 'klines'
        ? validInterval(req.query.interval)
        : '15m';

      const limit = validLimit(
        req.query.limit,
        300,
        300
      );

      const raw = unwrap(
        exchange,
        await requestJSON(
          endpoint(
            exchange,
            market,
            type,
            symbol,
            interval,
            limit
          )
        )
      );

      const data = type === 'ticker'
        ? normalizeTicker(exchange, raw)
        : type === 'klines'
          ? normalizeKlines(exchange, raw)
          : normalizeDepth(exchange, raw);

      res.json({
        ok: true,
        exchange,
        market,
        symbol,
        type,
        data,
        fetchedAt: new Date().toISOString()
      });

    } catch (error) {
      handleError(res, error);
    }
  }
);

// =====================================
// WEBSOCKET EN TIEMPO REAL
// =====================================

const wss = new WebSocketServer({
  noServer: true,
  perMessageDeflate: false
});

function upstreamAddress(exchange, market, symbol) {
  const s = symbolFor(exchange, market, symbol);

  if (exchange === 'bingx') {
    return market === 'spot'
      ? 'wss://open-api-ws.bingx.com/market'
      : 'wss://open-api-swap.bingx.com/swap-market';
  }

  if (exchange === 'binance') {
    return market === 'spot'
      ? `wss://stream.binance.com:9443/ws/${s.toLowerCase()}@aggTrade`
      : `wss://fstream.binance.com/ws/${s.toLowerCase()}@aggTrade`;
  }

  if (exchange === 'bybit') {
    return market === 'spot'
      ? 'wss://stream.bybit.com/v5/public/spot'
      : 'wss://stream.bybit.com/v5/public/linear';
  }

  return 'wss://ws.okx.com:8443/ws/v5/public';
}

function sendJSON(ws, data) {
  if (
    ws.readyState === WebSocket.OPEN &&
    ws.bufferedAmount < 1000000
  ) {
    ws.send(JSON.stringify(data));
  }
}

function decodeBingX(data) {
  const buffer = Buffer.isBuffer(data)
    ? data
    : Buffer.from(data);

  try {
    return gunzipSync(buffer).toString('utf8');
  } catch {
    return buffer.toString('utf8');
  }
}

function priceFromMessage(exchange, msg) {
  if (exchange === 'binance') {
    return msg.e === 'aggTrade'
      ? n(msg.p)
      : null;
  }

  if (exchange === 'bybit') {
    if (
      !String(msg.topic || '')
        .startsWith('tickers.')
    ) return null;

    const d = Array.isArray(msg.data)
      ? msg.data[0]
      : msg.data;

    return n(d?.lastPrice);
  }

  if (exchange === 'okx') {
    return msg.arg?.channel === 'tickers'
      ? n(msg.data?.[0]?.last)
      : null;
  }

  const channel = String(msg.dataType || '');

  if (
    !channel.includes('@ticker') &&
    !channel.includes('@trade')
  ) return null;

  const d = Array.isArray(msg.data)
    ? msg.data.at(-1)
    : msg.data;

  return n(
    d?.lastPrice ??
    d?.last ??
    d?.price ??
    d?.p ??
    d?.c
  );
}

wss.on(
  'connection',
  (client, _req, { exchange, market, symbol }) => {
    let upstream = null;
    let closed = false;
    let retryTimer = null;
    let heartbeatTimer = null;
    let fallbackTimer = null;
    let retryCount = 0;
    let lastReceived = 0;
    let lastSent = 0;
    let fallbackBusy = false;

    function publish(price, source = 'websocket') {
      if (
        price === null ||
        !Number.isFinite(price) ||
        price <= 0
      ) return;

      const now = Date.now();

      if (now - lastSent < 100) return;

      lastSent = now;

      sendJSON(client, {
        type: 'price',
        exchange,
        market,
        symbol,
        price,
        source,
        timestamp: now
      });
    }

    function stopUpstream() {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;

      if (upstream) {
        const old = upstream;
        upstream = null;

        old.removeAllListeners();

        try {
          old.terminate();
        } catch {}
      }
    }

    function reconnect() {
      if (closed) return;

      stopUpstream();
      clearTimeout(retryTimer);

      const delay = Math.min(
        30000,
        1000 * (2 ** Math.min(retryCount++, 5))
      );

      sendJSON(client, {
        type: 'status',
        status: 'reconnecting',
        retryInMs: delay
      });

      retryTimer = setTimeout(
        connectUpstream,
        delay
      );
    }

    async function fallbackPrice() {
      if (
        closed ||
        fallbackBusy ||
        Date.now() - lastReceived < 5000
      ) return;

      fallbackBusy = true;

      try {
        const raw = unwrap(
          exchange,
          await requestJSON(
            endpoint(exchange, market, 'ticker', symbol)
          )
        );

        publish(
          normalizeTicker(exchange, raw).lastPrice,
          'rest-fallback'
        );
      } catch (error) {
        console.warn(
          'Fallback:',
          exchange,
          error.message
        );
      } finally {
        fallbackBusy = false;
      }
    }

    function connectUpstream() {
      if (closed) return;

      clearTimeout(retryTimer);

      const ws = new WebSocket(
        upstreamAddress(exchange, market, symbol),
        {
          handshakeTimeout: 10000,
          perMessageDeflate: false
        }
      );

      upstream = ws;

      ws.on('open', () => {
        retryCount = 0;

        sendJSON(client, {
          type: 'status',
          status: 'connected',
          exchange,
          market,
          symbol
        });

        const s = symbolFor(exchange, market, symbol);

        if (exchange === 'bingx') {
          ws.send(JSON.stringify({
            id: 'cl-ticker',
            reqType: 'sub',
            dataType: `${s}@ticker`
          }));

          ws.send(JSON.stringify({
            id: 'cl-trade',
            reqType: 'sub',
            dataType: `${s}@trade`
          }));
        } else if (exchange === 'bybit') {
          ws.send(JSON.stringify({
            op: 'subscribe',
            args: [`tickers.${s}`]
          }));

          heartbeatTimer = setInterval(() => {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({
                op: 'ping'
              }));
            }
          }, 20000);

        } else if (exchange === 'okx') {
          ws.send(JSON.stringify({
            op: 'subscribe',
            args: [{
              channel: 'tickers',
              instId: s
            }]
          }));

          heartbeatTimer = setInterval(() => {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send('ping');
            }
          }, 20000);
        }
      });

      ws.on('message', buffer => {
        try {
          const text = exchange === 'bingx'
            ? decodeBingX(buffer)
            : buffer.toString('utf8');

          if (
            exchange === 'bingx' &&
            (text === 'Ping' || text === 'ping')
          ) {
            ws.send(
              text === 'Ping' ? 'Pong' : 'pong'
            );
            return;
          }

          if (text === 'pong' || text === 'Pong') {
            return;
          }

          const msg = JSON.parse(text);

          if (
            exchange === 'bingx' &&
            msg.ping !== undefined
          ) {
            ws.send(JSON.stringify({
              pong: msg.ping
            }));
            return;
          }

          const price = priceFromMessage(
            exchange,
            msg
          );

          if (price !== null && price > 0) {
            lastReceived = Date.now();
            publish(price);
          }
        } catch (error) {
          console.warn(
            'Mensaje WS:',
            exchange,
            error.message
          );
        }
      });

      ws.on('error', error => {
        console.warn(
          'WebSocket:',
          exchange,
          error.message
        );
      });

      ws.on('close', () => {
        if (ws === upstream) {
          reconnect();
        }
      });
    }

    function cleanup() {
      if (closed) return;

      closed = true;

      clearTimeout(retryTimer);
      clearInterval(fallbackTimer);

      stopUpstream();
    }

    client.on('close', cleanup);
    client.on('error', cleanup);

    sendJSON(client, {
      type: 'status',
      status: 'connecting',
      exchange,
      market,
      symbol
    });

    connectUpstream();

    fallbackTimer = setInterval(
      fallbackPrice,
      5000
    );

    fallbackPrice();
  }
);

// =====================================
// CONEXIÓN WEBSOCKET DEL NAVEGADOR
// =====================================

server.on('upgrade', (req, socket, head) => {
  try {
    const address = new URL(
      req.url,
      'http://localhost'
    );

    if (address.pathname !== '/ws') {
      return socket.destroy();
    }

    const exchange = validExchange(
      address.searchParams.get('exchange') || 'bingx'
    );

    const market = validMarket(
      address.searchParams.get('market') || 'perpetual'
    );

    const symbol = validSymbol(
      address.searchParams.get('symbol') || 'BTC-USDT'
    );

    wss.handleUpgrade(
      req,
      socket,
      head,
      ws => {
        wss.emit(
          'connection',
          ws,
          req,
          { exchange, market, symbol }
        );
      }
    );
  } catch (error) {
    console.error(
      'Upgrade WS:',
      error.message
    );

    socket.destroy();
  }
});

// =====================================
// INICIAR CRYPTOLEXUZ
// =====================================

server.listen(PORT, '0.0.0.0', () => {
  console.log(`CRYPTOLEXUZ V11.1 en puerto ${PORT}`);
});
