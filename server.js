
import express from "express";
import cors from "cors";
import http from "node:http";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { WebSocket, WebSocketServer } from "ws";

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3000;

const origin = process.env.ALLOWED_ORIGIN || "*";

app.use(cors({
  origin: origin === "*"
    ? "*"
    : origin.split(",").map(x => x.trim())
}));

app.use(express.json());
app.use(express.static(path.join(process.cwd(), "public")));

const EXCHANGES = ["bingx", "binance", "bybit", "okx"];

const HOSTS = {
  bingx: "https://open-api.bingx.com",
  binanceSpot: "https://api.binance.com",
  binanceFutures: "https://fapi.binance.com",
  bybit: "https://api.bybit.com",
  okx: "https://www.okx.com"
};

const INTERVALS = new Set([
  "1m", "3m", "5m", "15m", "30m",
  "1h", "2h", "4h", "6h", "8h",
  "12h", "1d", "3d", "1w", "1M"
]);

function fail(message, status = 400) {
  const e = new Error(message);
  e.status = status;
  return e;
}

function number(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function checkExchange(value) {
  const exchange = String(value || "").toLowerCase();
  if (!EXCHANGES.includes(exchange)) {
    throw fail("Exchange inválido");
  }
  return exchange;
}

function checkMarket(value) {
  if (value !== "spot" && value !== "perpetual") {
    throw fail("Mercado inválido");
  }
  return value;
}

function checkSymbol(value) {
  const symbol = String(value || "")
    .toUpperCase()
    .replace(/_/g, "-");

  if (!/^[A-Z0-9]+-[A-Z0-9]+$/.test(symbol)) {
    throw fail("Símbolo inválido. Ejemplo: BTC-USDT");
  }

  return symbol;
}

function checkInterval(value) {
  const interval = String(value || "15m");
  if (!INTERVALS.has(interval)) {
    throw fail("Temporalidad inválida");
  }
  return interval;
}

function checkLimit(value, maximum = 300, fallback = 100) {
  const n = Number(value ?? fallback);
  if (!Number.isFinite(n)) {
    throw fail("Límite inválido");
  }
  return Math.max(1, Math.min(maximum, Math.floor(n)));
}

function makeURL(base, route, params = {}) {
  const u = new URL(route, base);

  for (const [key, value] of Object.entries(params)) {
    if (value !== null && value !== undefined) {
      u.searchParams.set(key, String(value));
    }
  }

  return u.toString();
}

async function fetchJSON(address) {
  const response = await fetch(address, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(12000)
  });

  if (!response.ok) {
    throw fail(
      `Exchange respondió HTTP ${response.status}`,
      502
    );
  }

  return response.json();
}

function unwrap(exchange, result) {
  if (exchange === "bingx") {
    if (Number(result?.code) !== 0) {
      throw fail(result?.msg || "Error de BingX", 502);
    }
    return result.data;
  }

  if (exchange === "bybit") {
    if (Number(result?.retCode) !== 0) {
      throw fail(result?.retMsg || "Error de Bybit", 502);
    }
    return result.result;
  }

  if (exchange === "okx") {
    if (String(result?.code) !== "0") {
      throw fail(result?.msg || "Error de OKX", 502);
    }
    return result.data;
  }

  if (
    result &&
    !Array.isArray(result) &&
    typeof result.code === "number" &&
    result.code < 0
  ) {
    throw fail(result.msg || "Error de Binance", 502);
  }

  return result;
}

function exchangeSymbol(exchange, market, symbol) {
  if (exchange === "bingx") return symbol;

  if (exchange === "okx") {
    return market === "perpetual"
      ? `${symbol}-SWAP`
      : symbol;
  }

  return symbol.replace("-", "");
}

function exchangeInterval(exchange, interval) {
  if (exchange === "bybit") {
    const map = {
      "1m": "1",
      "3m": "3",
      "5m": "5",
      "15m": "15",
      "30m": "30",
      "1h": "60",
      "2h": "120",
      "4h": "240",
      "6h": "360",
      "12h": "720",
      "1d": "D",
      "1w": "W",
      "1M": "M"
    };

    if (!map[interval]) {
      throw fail("Temporalidad incompatible con Bybit");
    }

    return map[interval];
  }

  if (exchange === "okx") {
    const map = {
      "1m": "1m",
      "3m": "3m",
      "5m": "5m",
      "15m": "15m",
      "30m": "30m",
      "1h": "1H",
      "2h": "2H",
      "4h": "4H",
      "6h": "6H",
      "12h": "12H",
      "1d": "1Dutc",
      "1w": "1Wutc",
      "1M": "1Mutc"
    };

    if (!map[interval]) {
      throw fail("Temporalidad incompatible con OKX");
    }

    return map[interval];
  }

  return interval;
}

function endpoint(exchange, market, type, symbol, interval, limit) {
  const spot = market === "spot";
  const s = exchangeSymbol(exchange, market, symbol);

  if (exchange === "bingx") {
    const routes = spot
      ? {
          ticker: "/openApi/spot/v2/ticker/price",
          klines: "/openApi/spot/v2/market/kline",
          depth: "/openApi/spot/v1/market/depth"
        }
      : {
          ticker: "/openApi/swap/v2/quote/ticker",
          klines: "/openApi/swap/v3/quote/klines",
          depth: "/openApi/swap/v2/quote/depth"
        };

    return makeURL(HOSTS.bingx, routes[type], {
      symbol: s,
      ...(type === "klines" ? { interval, limit } : {}),
      ...(type === "depth" ? { limit: 10 } : {})
    });
  }

  if (exchange === "binance") {
    const base = spot
      ? HOSTS.binanceSpot
      : HOSTS.binanceFutures;

    const prefix = spot ? "/api/v3" : "/fapi/v1";

    const routes = {
      ticker: "/ticker/24hr",
      klines: "/klines",
      depth: "/depth"
    };

    return makeURL(base, prefix + routes[type], {
      symbol: s,
      ...(type === "klines"
        ? { interval: exchangeInterval(exchange, interval), limit }
        : {}),
      ...(type === "depth" ? { limit: 10 } : {})
    });
  }

  if (exchange === "bybit") {
    const routes = {
      ticker: "/v5/market/tickers",
      klines: "/v5/market/kline",
      depth: "/v5/market/orderbook"
    };

    return makeURL(HOSTS.bybit, routes[type], {
      category: spot ? "spot" : "linear",
      symbol: s,
      ...(type === "klines"
        ? { interval: exchangeInterval(exchange, interval), limit }
        : {}),
      ...(type === "depth" ? { limit: 50 } : {})
    });
  }

  const routes = {
    ticker: "/api/v5/market/ticker",
    klines: "/api/v5/market/candles",
    depth: "/api/v5/market/books"
  };

  return makeURL(HOSTS.okx, routes[type], {
    instId: s,
    ...(type === "klines"
      ? {
          bar: exchangeInterval(exchange, interval),
          limit: Math.min(limit, 300)
        }
      : {}),
    ...(type === "depth" ? { sz: 10 } : {})
  });
}

async function getRaw(
  exchange,
  market,
  type,
  symbol,
  interval = "15m",
  limit = 100
) {
  const address = endpoint(
    exchange, market, type, symbol, interval, limit
  );

  return unwrap(exchange, await fetchJSON(address));
}

function normalizeTicker(exchange, raw) {
  const d = exchange === "bybit"
    ? raw?.list?.[0]
    : Array.isArray(raw)
      ? raw[0]
      : raw;

  if (!d) throw fail("Precio no disponible", 502);

  const lastPrice = number(
    d.lastPrice ?? d.last ?? d.price
  );

  if (lastPrice === null) {
    throw fail("Precio no disponible", 502);
  }

  const openPrice = number(
    d.openPrice ?? d.open24h ?? d.open
  );

  let priceChangePercent = number(d.priceChangePercent);

  if (exchange === "bybit" && number(d.price24hPcnt) !== null) {
    priceChangePercent = number(d.price24hPcnt) * 100;
  }

  if (priceChangePercent === null && openPrice) {
    priceChangePercent =
      ((lastPrice - openPrice) / openPrice) * 100;
  }

  return {
    lastPrice,
    openPrice,
    highPrice: number(d.highPrice ?? d.high24h ?? d.high),
    lowPrice: number(d.lowPrice ?? d.low24h ?? d.low),
    volume: number(
      d.volume ?? d.volume24h ?? d.vol24h ?? d.vol
    ),
    priceChangePercent,
    bidPrice: number(
      d.bidPrice ?? d.bid1Price ?? d.bidPx
    ),
    askPrice: number(
      d.askPrice ?? d.ask1Price ?? d.askPx
    )
  };
}

function normalizeKlines(exchange, raw) {
  const rows = exchange === "bybit" ? raw?.list : raw;

  if (!Array.isArray(rows)) {
    throw fail("Velas no disponibles", 502);
  }

  const candles = [];

  for (const item of rows) {
    const array = Array.isArray(item);

    const time = number(
      array
        ? item[0]
        : item.time ?? item.timestamp ?? item.openTime
    );

    const open = number(array ? item[1] : item.open);
    const high = number(array ? item[2] : item.high);
    const low = number(array ? item[3] : item.low);
    const close = number(array ? item[4] : item.close);
    const volume = number(
      array ? item[5] : item.volume ?? item.vol
    ) ?? 0;

    if ([time, open, high, low, close].some(x => x === null)) {
      continue;
    }

    if (
      high < low ||
      high < Math.max(open, close) ||
      low > Math.min(open, close)
    ) {
      continue;
    }

    candles.push({
      time: Math.floor(time > 1e12 ? time / 1000 : time),
      open,
      high,
      low,
      close,
      volume
    });
  }

  candles.sort((a, b) => a.time - b.time);

  return candles.filter(
    (c, i) => i === 0 || c.time !== candles[i - 1].time
  );
}

function normalizeDepth(exchange, raw) {
  const d = exchange === "okx" ? raw?.[0] : raw;

  if (!d) {
    throw fail("Libro de órdenes no disponible", 502);
  }

  function levels(rows, descending) {
    return (Array.isArray(rows) ? rows : [])
      .map(row => ({
        price: number(row[0]),
        quantity: number(row[1])
      }))
      .filter(row =>
        row.price !== null &&
        row.price > 0 &&
        row.quantity !== null &&
        row.quantity >= 0
      )
      .sort((a, b) =>
        descending
          ? b.price - a.price
          : a.price - b.price
      )
      .slice(0, 10);
  }

  return {
    bids: levels(d.bids ?? d.b, true),
    asks: levels(d.asks ?? d.a, false),
    timestamp: Date.now()
  };
}

function handleError(res, e) {
  console.error("CRYPTOLEXUZ:", e.message);

  res.status(e.status || 502).json({
    ok: false,
    error: e.message
  });
}

// =======================================
// ESTADO DEL SERVIDOR
// =======================================

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "CRYPTOLEXUZ",
    version: "12.0",
    websocket: true,
    exchanges: EXCHANGES
  });
});

app.get("/api/exchanges", (_req, res) => {
  res.json({
    ok: true,
    exchanges: EXCHANGES,
    markets: ["spot", "perpetual"],
    features: ["ticker", "klines", "depth", "websocket"]
  });
});

// =======================================
// COMPATIBILIDAD CON LA PÁGINA ACTUAL
// =======================================

app.get("/api/market/:market/ticker/:symbol", async (req, res) => {
  try {
    const market = checkMarket(req.params.market);
    const symbol = checkSymbol(req.params.symbol);

    const data = await getRaw(
      "bingx", market, "ticker", symbol
    );

    res.json({
      source: "BingX",
      market,
      symbol,
      data,
      fetchedAt: new Date().toISOString()
    });
  } catch (e) {
    handleError(res, e);
  }
});

app.get("/api/market/:market/klines/:symbol", async (req, res) => {
  try {
    const market = checkMarket(req.params.market);
    const symbol = checkSymbol(req.params.symbol);
    const interval = checkInterval(req.query.interval);
    const limit = checkLimit(req.query.limit, 500, 100);

    const data = await getRaw(
      "bingx", market, "klines", symbol, interval, limit
    );

    res.json({
      source: "BingX",
      market,
      symbol,
      interval,
      data,
      fetchedAt: new Date().toISOString()
    });
  } catch (e) {
    handleError(res, e);
  }
});

// =======================================
// API DE LOS CUATRO EXCHANGES
// =======================================

app.get("/api/exchange/:exchange/:type/:symbol", async (req, res) => {
  try {
    const exchange = checkExchange(req.params.exchange);
    const market = checkMarket(
      String(req.query.market || "perpetual")
    );
    const symbol = checkSymbol(req.params.symbol);
    const type = req.params.type;

    if (!["ticker", "klines", "depth"].includes(type)) {
      throw fail("Consulta inválida");
    }

    const interval = type === "klines"
      ? checkInterval(req.query.interval)
      : "15m";

    const limit = checkLimit(req.query.limit, 300, 300);

    const raw = await getRaw(
      exchange, market, type, symbol, interval, limit
    );

    let data;

    if (type === "ticker") {
      data = normalizeTicker(exchange, raw);
    } else if (type === "klines") {
      data = normalizeKlines(exchange, raw);
    } else {
      data = normalizeDepth(exchange, raw);
    }

    res.json({
      ok: true,
      exchange,
      market,
      symbol,
      type,
      data,
      fetchedAt: new Date().toISOString()
    });
  } catch (e) {
    handleError(res, e);
  }
});

// =======================================
// WEBSOCKET
// =======================================

const wss = new WebSocketServer({
  noServer: true,
  perMessageDeflate: false
});

function upstreamAddress(exchange, market, symbol) {
  const s = exchangeSymbol(exchange, market, symbol);

  if (exchange === "bingx") {
    return market === "spot"
      ? "wss://open-api-ws.bingx.com/market"
      : "wss://open-api-swap.bingx.com/swap-market";
  }

  if (exchange === "binance") {
    const stream = `${s.toLowerCase()}@aggTrade`;

    return market === "spot"
      ? `wss://stream.binance.com:9443/ws/${stream}`
      : `wss://fstream.binance.com/ws/${stream}`;
  }

  if (exchange === "bybit") {
    return market === "spot"
      ? "wss://stream.bybit.com/v5/public/spot"
      : "wss://stream.bybit.com/v5/public/linear";
  }

  return "wss://ws.okx.com:8443/ws/v5/public";
}

function send(ws, payload) {
  if (
    ws.readyState === WebSocket.OPEN &&
    ws.bufferedAmount < 1000000
  ) {
    ws.send(JSON.stringify(payload));
  }
}

function decodeBingX(data) {
  const buffer = Buffer.isBuffer(data)
    ? data
    : Buffer.from(data);

  try {
    return gunzipSync(buffer).toString("utf8");
  } catch {
    return buffer.toString("utf8");
  }
}

function extractPrice(exchange, msg) {
  if (exchange === "binance") {
    return msg.e === "aggTrade"
      ? number(msg.p)
      : null;
  }

  if (exchange === "bybit") {
    if (!String(msg.topic || "").startsWith("tickers.")) {
      return null;
    }

    const d = Array.isArray(msg.data)
      ? msg.data[0]
      : msg.data;

    return number(d?.lastPrice);
  }

  if (exchange === "okx") {
    return msg.arg?.channel === "tickers"
      ? number(msg.data?.[0]?.last)
      : null;
  }

  const channel = String(msg.dataType || "");

  if (
    !channel.includes("@ticker") &&
    !channel.includes("@trade")
  ) {
    return null;
  }

  const d = Array.isArray(msg.data)
    ? msg.data.at(-1)
    : msg.data;

  return number(
    d?.lastPrice ??
    d?.last ??
    d?.price ??
    d?.p ??
    d?.c
  );
}

wss.on("connection", (client, _req, config) => {
  const { exchange, market, symbol } = config;

  let upstream = null;
  let closed = false;
  let retryTimer = null;
  let heartbeatTimer = null;
  let fallbackTimer = null;
  let retryCount = 0;
  let lastReceived = 0;
  let lastSent = 0;
  let fallbackBusy = false;

  function publish(price, source = "websocket") {
    if (
      price === null ||
      !Number.isFinite(price) ||
      price <= 0
    ) {
      return;
    }

    const now = Date.now();

    if (now - lastSent < 100) return;

    lastSent = now;

    send(client, {
      type: "price",
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
      } catch {
        // La conexión ya puede estar cerrada.
      }
    }
  }

  function reconnect() {
    if (closed) return;

    stopUpstream();
    clearTimeout(retryTimer);

    const delay = Math.min(
      30000,
      1000 * (2 ** Math.min(retryCount, 5))
    );

    retryCount++;

    send(client, {
      type: "status",
      status: "reconnecting",
      retryInMs: delay
    });

    retryTimer = setTimeout(connectUpstream, delay);
  }

  async function fallbackPrice() {
    if (
      closed ||
      fallbackBusy ||
      Date.now() - lastReceived < 5000
    ) {
      return;
    }

    fallbackBusy = true;

    try {
      const raw = await getRaw(
        exchange, market, "ticker", symbol
      );

      const ticker = normalizeTicker(exchange, raw);

      publish(ticker.lastPrice, "rest-fallback");
    } catch (e) {
      console.warn("Fallback:", exchange, e.message);
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

    ws.on("open", () => {
      retryCount = 0;

      send(client, {
        type: "status",
        status: "connected",
        exchange,
        market,
        symbol
      });

      const s = exchangeSymbol(exchange, market, symbol);

      if (exchange === "bingx") {
        ws.send(JSON.stringify({
          id: "cryptolexuz-ticker",
          reqType: "sub",
          dataType: `${s}@ticker`
        }));

        ws.send(JSON.stringify({
          id: "cryptolexuz-trade",
          reqType: "sub",
          dataType: `${s}@trade`
        }));
      }

      if (exchange === "bybit") {
        ws.send(JSON.stringify({
          op: "subscribe",
          args: [`tickers.${s}`]
        }));

        heartbeatTimer = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ op: "ping" }));
          }
        }, 20000);
      }

      if (exchange === "okx") {
        ws.send(JSON.stringify({
          op: "subscribe",
          args: [{
            channel: "tickers",
            instId: s
          }]
        }));

        heartbeatTimer = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send("ping");
          }
        }, 20000);
      }
    });

    ws.on("message", buffer => {
      try {
        const text = exchange === "bingx"
          ? decodeBingX(buffer)
          : buffer.toString("utf8");

        if (
          exchange === "bingx" &&
          (text === "Ping" || text === "ping")
        ) {
          ws.send(text === "Ping" ? "Pong" : "pong");
          return;
        }

        if (text === "pong" || text === "Pong") {
          return;
        }

        const msg = JSON.parse(text);

        if (
          exchange === "bingx" &&
          msg.ping !== undefined
        ) {
          ws.send(JSON.stringify({ pong: msg.ping }));
          return;
        }

        const price = extractPrice(exchange, msg);

        if (price !== null && price > 0) {
          lastReceived = Date.now();
          publish(price);
        }
      } catch (e) {
        console.warn("Mensaje WS:", exchange, e.message);
      }
    });

    ws.on("error", e => {
      console.warn("WebSocket:", exchange, e.message);
    });

    ws.on("close", () => {
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

  client.on("close", cleanup);
  client.on("error", cleanup);

  send(client, {
    type: "status",
    status: "connecting",
    exchange,
    market,
    symbol
  });

  connectUpstream();

  fallbackTimer = setInterval(fallbackPrice, 5000);
  fallbackPrice();
});

// =======================================
// CONEXIÓN DEL NAVEGADOR
// =======================================

server.on("upgrade", (req, socket, head) => {
  try {
    const address = new URL(
      req.url,
      "http://localhost"
    );

    if (address.pathname !== "/ws") {
      socket.destroy();
      return;
    }

    const exchange = checkExchange(
      address.searchParams.get("exchange") || "bingx"
    );

    const market = checkMarket(
      address.searchParams.get("market") || "perpetual"
    );

    const symbol = checkSymbol(
      address.searchParams.get("symbol") || "BTC-USDT"
    );

    wss.handleUpgrade(req, socket, head, ws => {
      wss.emit("connection", ws, req, {
        exchange,
        market,
        symbol
      });
    });
  } catch (e) {
    console.error("Upgrade WS:", e.message);
    socket.destroy();
  }
});

// =======================================
// ARRANQUE DEL SERVIDOR
// =======================================

server.listen(PORT, "0.0.0.0", () => {
  console.log("================================");
  console.log("CRYPTOLEXUZ V12.0");
  console.log("Puerto:", PORT);
  console.log("BingX | Binance | Bybit | OKX");
  console.log("WebSocket: /ws");
  console.log("================================");
});
