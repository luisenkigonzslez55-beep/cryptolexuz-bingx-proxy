
import express from "express";
import cors from "cors";
import path from "path";
import http from "http";
import { gunzipSync } from "zlib";
import { WebSocket, WebSocketServer } from "ws";

// ========================================
// CRYPTOLEXUZ - SERVIDOR MULTIEXCHANGE
// BingX, Binance, Bybit y OKX
// REST + WebSocket
// ========================================

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3000;

const ALLOWED_ORIGIN =
  process.env.ALLOWED_ORIGIN || "*";

app.use(cors({
  origin: ALLOWED_ORIGIN === "*"
    ? "*"
    : ALLOWED_ORIGIN.split(",").map(s => s.trim())
}));

app.use(express.json());

app.use(express.static(
  path.join(process.cwd(), "public")
));

const HOSTS = {
  bingx: "https://open-api.bingx.com",
  binanceSpot: "https://api.binance.com",
  binanceFutures: "https://fapi.binance.com",
  bybit: "https://api.bybit.com",
  okx: "https://www.okx.com"
};

const EXCHANGES = [
  "bingx",
  "binance",
  "bybit",
  "okx"
];

const INTERVALS = new Set([
  "1m", "3m", "5m", "15m", "30m",
  "1h", "2h", "4h", "6h", "8h",
  "12h", "1d", "3d", "1w", "1M"
]);

function validMarket(market) {
  if (market !== "spot" &&
      market !== "perpetual") {
    throw new Error(
      "Mercado inválido: usa spot o perpetual"
    );
  }
}

function validSymbol(value) {
  const symbol = String(value || "")
    .toUpperCase()
    .replace(/_/g, "-");

  if (!/^[A-Z0-9]+-[A-Z0-9]+$/.test(symbol)) {
    throw new Error(
      "Símbolo inválido; ejemplo BTC-USDT"
    );
  }

  return symbol;
}

function validExchange(value) {
  const exchange = String(value || "")
    .toLowerCase();

  if (!EXCHANGES.includes(exchange)) {
    throw new Error("Exchange inválido");
  }

  return exchange;
}

function numberValue(value) {
  if (value === null ||
      value === undefined ||
      value === "") return null;

  const n = Number(value);

  return Number.isFinite(n) ? n : null;
}

function makeURL(base, endpoint, params = {}) {
  const u = new URL(endpoint, base);

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) {
      u.searchParams.set(key, String(value));
    }
  }

  return u.toString();
}

async function requestJSON(address) {
  const response = await fetch(address, {
    headers: {
      accept: "application/json"
    },
    signal: AbortSignal.timeout(10000)
  });

  if (!response.ok) {
    throw new Error(
      `Exchange respondió HTTP ${response.status}`
    );
  }

  return response.json();
}

async function bingx(endpoint) {
  const result = await requestJSON(
    `${HOSTS.bingx}${endpoint}`
  );

  if (Number(result.code) !== 0) {
    throw new Error(
      result.msg || `BingX code ${result.code}`
    );
  }

  return result.data;
}

function unwrap(exchange, result) {
  if (exchange === "bingx") {
    if (Number(result.code) !== 0) {
      throw new Error(
        result.msg || "Error de BingX"
      );
    }
    return result.data;
  }

  if (exchange === "bybit") {
    if (Number(result.retCode) !== 0) {
      throw new Error(
        result.retMsg || "Error de Bybit"
      );
    }
    return result.result;
  }

  if (exchange === "okx") {
    if (String(result.code) !== "0") {
      throw new Error(
        result.msg || "Error de OKX"
      );
    }
    return result.data;
  }

  if (
    result &&
    !Array.isArray(result) &&
    typeof result.code === "number" &&
    result.code < 0
  ) {
    throw new Error(
      result.msg || "Error de Binance"
    );
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
      throw new Error(
        "Temporalidad no compatible con Bybit"
      );
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
      throw new Error(
        "Temporalidad no compatible con OKX"
      );
    }

    return map[interval];
  }

  if (exchange === "binance") {
    if (interval === "8h" ||
        interval === "3d") return interval;
  }

  return interval;
}

// ========================================
// RUTAS ORIGINALES DE BINGX
// Se conservan para app.js actual
// ========================================

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "CRYPTOLEXUZ",
    version: "11",
    websocket: true,
    exchanges: EXCHANGES
  });
});

app.get("/api/exchanges", (_req, res) => {
  res.json({
    ok: true,
    exchanges: EXCHANGES,
    markets: ["spot", "perpetual"],
    features: [
      "ticker",
      "klines",
      "depth",
      "websocket"
    ]
  });
});

app.get(
  "/api/market/:market/ticker/:symbol",
  async (req, res) => {
    try {
      const { market } = req.params;
      validMarket(market);

      const symbol = validSymbol(
        req.params.symbol
      );

      const endpoint = market === "perpetual"
        ? `/openApi/swap/v2/quote/ticker?symbol=${encodeURIComponent(symbol)}`
        : `/openApi/spot/v2/ticker/price?symbol=${encodeURIComponent(symbol)}`;

      const data = await bingx(endpoint);

      res.json({
        source: "BingX",
        market,
        symbol,
        data,
        fetchedAt: new Date().toISOString()
      });
    } catch (error) {
      res.status(502).json({
        error: error.message
      });
    }
  }
);

app.get(
  "/api/market/:market/klines/:symbol",
  async (req, res) => {
    try {
      const { market } = req.params;
      validMarket(market);

      const symbol = validSymbol(
        req.params.symbol
      );

      const interval = String(
        req.query.interval || "15m"
      );

      if (!INTERVALS.has(interval)) {
        return res.status(400).json({
          error: "Temporalidad no permitida"
        });
      }

      const requestedLimit = Number(
        req.query.limit || 100
      );

      const limit = Number.isFinite(requestedLimit)
        ? Math.max(
            1,
            Math.min(500, Math.floor(requestedLimit))
          )
        : 100;

      const endpoint = market === "perpetual"
        ? `/openApi/swap/v3/quote/klines?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}&limit=${limit}`
        : `/openApi/spot/v2/market/kline?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}&limit=${limit}`;

      const data = await bingx(endpoint);

      res.json({
        source: "BingX",
        market,
        symbol,
        interval,
        data,
        fetchedAt: new Date().toISOString()
      });
    } catch (error) {
      res.status(502).json({
        error: error.message
      });
    }
  }
);

// ========================================
// CONSULTAS REST MULTIEXCHANGE
// ========================================

function marketEndpoint(
  exchange,
  market,
  type,
  symbol,
  interval,
  limit
) {
  const spot = market === "spot";

  const s = exchangeSymbol(
    exchange,
    market,
    symbol
  );

  if (exchange === "bingx") {
    const paths = spot
      ? {
          ticker: "/openApi/spot/v2/ticker/24hr",
          klines: "/openApi/spot/v2/market/kline",
          depth: "/openApi/spot/v1/market/depth"
        }
      : {
          ticker: "/openApi/swap/v2/quote/ticker",
          klines: "/openApi/swap/v3/quote/klines",
          depth: "/openApi/swap/v2/quote/depth"
        };

    return makeURL(
      HOSTS.bingx,
      paths[type],
      {
        symbol: s,
        ...(type === "klines"
          ? { interval, limit }
          : {}),
        ...(type === "depth"
          ? { limit: 10 }
          : {})
      }
    );
  }

  if (exchange === "binance") {
    const base = spot
      ? HOSTS.binanceSpot
      : HOSTS.binanceFutures;

    const prefix = spot
      ? "/api/v3"
      : "/fapi/v1";

    const paths = {
      ticker: "/ticker/24hr",
      klines: "/klines",
      depth: "/depth"
    };

    return makeURL(
      base,
      prefix + paths[type],
      {
        symbol: s,
        ...(type === "klines"
          ? { interval, limit }
          : {}),
        ...(type === "depth"
          ? { limit: 10 }
          : {})
      }
    );
  }

  if (exchange === "bybit") {
    const paths = {
      ticker: "/v5/market/tickers",
      klines: "/v5/market/kline",
      depth: "/v5/market/orderbook"
    };

    return makeURL(
      HOSTS.bybit,
      paths[type],
      {
        category: spot ? "spot" : "linear",
        symbol: s,
        ...(type === "klines"
          ? {
              interval: exchangeInterval(
                exchange,
                interval
              ),
              limit
            }
          : {}),
        ...(type === "depth"
          ? { limit: 50 }
          : {})
      }
    );
  }

  const paths = {
    ticker: "/api/v5/market/ticker",
    klines: "/api/v5/market/candles",
    depth: "/api/v5/market/books"
  };

  return makeURL(
    HOSTS.okx,
    paths[type],
    {
      instId: s,
      ...(type === "klines"
        ? {
            bar: exchangeInterval(
              exchange,
              interval
            ),
            limit: Math.min(limit, 300)
          }
        : {}),
      ...(type === "depth"
        ? { sz: 10 }
        : {})
    }
  );
}

function normalizeTicker(exchange, data) {
  let d = data;

  if (exchange === "bybit") {
    d = data?.list?.[0];
  } else if (
    exchange === "okx" ||
    Array.isArray(data)
  ) {
    d = data?.[0];
  }

  if (!d) {
    throw new Error("Precio no disponible");
  }

  const price = numberValue(
    d.lastPrice ?? d.last ?? d.price
  );

  const open = numberValue(
    d.openPrice ?? d.open24h ?? d.open
  );

  let change = numberValue(
    d.priceChangePercent
  );

  if (exchange === "bybit") {
    const ratio = numberValue(
      d.price24hPcnt
    );

    if (ratio !== null) {
      change = ratio * 100;
    }
  }

  if (
    change === null &&
    price !== null &&
    open !== null &&
    open !== 0
  ) {
    change = ((price - open) / open) * 100;
  }

  return {
    lastPrice: price,
    openPrice: open,
    highPrice: numberValue(
      d.highPrice ?? d.high24h ?? d.high
    ),
    lowPrice: numberValue(
      d.lowPrice ?? d.low24h ?? d.low
    ),
    volume: numberValue(
      d.volume ??
      d.volume24h ??
      d.vol24h ??
      d.vol
    ),
    priceChangePercent: change,
    bidPrice: numberValue(
      d.bidPrice ?? d.bid1Price ?? d.bidPx
    ),
    askPrice: numberValue(
      d.askPrice ?? d.ask1Price ?? d.askPx
    )
  };
}

function normalizeKlines(exchange, data) {
  const list = exchange === "bybit"
    ? data?.list
    : data;

  if (!Array.isArray(list)) {
    throw new Error(
      "Velas no disponibles"
    );
  }

  const candles = [];

  for (const item of list) {
    const a = Array.isArray(item);

    const time = numberValue(
      a ? item[0] :
      item.time ??
      item.timestamp ??
      item.openTime
    );

    const open = numberValue(
      a ? item[1] : item.open
    );

    const high = numberValue(
      a ? item[2] : item.high
    );

    const low = numberValue(
      a ? item[3] : item.low
    );

    const close = numberValue(
      a ? item[4] : item.close
    );

    const volume = numberValue(
      a ? item[5] :
      item.volume ?? item.vol
    );

    if (
      time === null ||
      open === null ||
      high === null ||
      low === null ||
      close === null
    ) continue;

    if (
      high < low ||
      high < Math.max(open, close) ||
      low > Math.min(open, close)
    ) continue;

    candles.push({
      time: time > 1e12
        ? Math.floor(time / 1000)
        : Math.floor(time),
      open,
      high,
      low,
      close,
      volume: volume ?? 0
    });
  }

  candles.sort(
    (a, b) => a.time - b.time
  );

  return candles.filter(
    (item, i, array) =>
      i === 0 ||
      item.time !== array[i - 1].time
  );
}

function normalizeDepth(exchange, data) {
  const d = exchange === "okx"
    ? data?.[0]
    : data;

  if (!d) {
    throw new Error(
      "Libro de órdenes no disponible"
    );
  }

  function levels(rows, descending) {
    return (Array.isArray(rows) ? rows : [])
      .map(row => ({
        price: numberValue(row[0]),
        quantity: numberValue(row[1])
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
    bids: levels(
      d.bids ?? d.b,
      true
    ),
    asks: levels(
      d.asks ?? d.a,
      false
    ),
    timestamp: Date.now()
  };
}

app.get(
  "/api/exchange/:exchange/:type/:symbol",
  async (req, res) => {
    try {
      const exchange = validExchange(
        req.params.exchange
      );

      const market = String(
        req.query.market || "perpetual"
      );

      validMarket(market);

      const symbol = validSymbol(
        req.params.symbol
      );

      const type = String(
        req.params.type
      );

      if (
        !["ticker", "klines", "depth"]
          .includes(type)
      ) {
        return res.status(400).json({
          error: "Tipo de consulta inválido"
        });
      }

      const interval = String(
        req.query.interval || "15m"
      );

      if (
        type === "klines" &&
        !INTERVALS.has(interval)
      ) {
        return res.status(400).json({
          error: "Temporalidad inválida"
        });
      }

      const rawLimit = Number(
        req.query.limit || 300
      );

      const limit = Number.isFinite(rawLimit)
        ? Math.max(
            1,
            Math.min(300, Math.floor(rawLimit))
          )
        : 300;

      const address = marketEndpoint(
        exchange,
        market,
        type,
        symbol,
        interval,
        limit
      );

      const result = await requestJSON(address);

      const rawData = unwrap(
        exchange,
        result
      );

      let data;

      if (type === "ticker") {
        data = normalizeTicker(
          exchange,
          rawData
        );
      } else if (type === "klines") {
        data = normalizeKlines(
          exchange,
          rawData
        );
      } else {
        data = normalizeDepth(
          exchange,
          rawData
        );
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

    } catch (error) {
      console.error(
        "REST:",
        error.message
      );

      res.status(502).json({
        ok: false,
        error: error.message
      });
    }
  }
);

// ========================================
// WEBSOCKET EN TIEMPO REAL
// ========================================

const wss = new WebSocketServer({
  noServer: true,
  perMessageDeflate: false
});

function upstreamAddress(
  exchange,
  market,
  symbol
) {
  const s = exchangeSymbol(
    exchange,
    market,
    symbol
  );

  if (exchange === "bingx") {
    return market === "spot"
      ? "wss://open-api-ws.bingx.com/market"
      : "wss://open-api-swap.bingx.com/swap-market";
  }

  if (exchange === "binance") {
    const stream =
      `${s.toLowerCase()}@aggTrade`;

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

function sendJSON(socket, payload) {
  if (
    socket.readyState === WebSocket.OPEN &&
    socket.bufferedAmount < 1000000
  ) {
    socket.send(JSON.stringify(payload));
  }
}

function parseBingX(buffer) {
  try {
    return gunzipSync(buffer).toString("utf8");
  } catch {
    return buffer.toString("utf8");
  }
}

function extractPrice(exchange, message) {
  if (exchange === "binance") {
    if (message.e === "aggTrade") {
      return numberValue(message.p);
    }

    return null;
  }

  if (exchange === "bybit") {
    if (
      !String(message.topic || "")
        .startsWith("tickers.")
    ) return null;

    const d = Array.isArray(message.data)
      ? message.data[0]
      : message.data;

    return numberValue(d?.lastPrice);
  }

  if (exchange === "okx") {
    if (
      message.arg?.channel !== "tickers"
    ) return null;

    return numberValue(
      message.data?.[0]?.last
    );
  }

  const channel = String(
    message.dataType || ""
  );

  if (
    !channel.includes("@ticker") &&
    !channel.includes("@trade")
  ) {
    return null;
  }

  const d = Array.isArray(message.data)
    ? message.data.at(-1)
    : message.data;

  return numberValue(
    d?.lastPrice ??
    d?.last ??
    d?.price ??
    d?.p ??
    d?.c
  );
}

wss.on(
  "connection",
  (client, req, config) => {
    const {
      exchange,
      market,
      symbol
    } = config;

    let upstream = null;
    let closed = false;
    let retryTimer = null;
    let heartbeatTimer = null;
    let fallbackTimer = null;
    let retryCount = 0;
    let lastSent = 0;
    let lastReceived = 0;
    let fallbackBusy = false;

    function publish(price, source = "websocket") {
      if (
        price === null ||
        !Number.isFinite(price) ||
        price <= 0
      ) return;

      const now = Date.now();

      // Máximo diez envíos por segundo.
      if (now - lastSent < 100) return;

      lastSent = now;

      sendJSON(client, {
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
        } catch {}
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

      sendJSON(client, {
        type: "status",
        status: "reconnecting",
        retryInMs: delay
      });

      retryTimer = setTimeout(
        connectUpstream,
        delay
      );
    }

    async function fallbackPrice() {
      if (closed || fallbackBusy) return;

      const now = Date.now();

      // Solo consultar REST cuando
      // el flujo no está entregando precios.
      if (now - lastReceived < 5000) return;

      fallbackBusy = true;

      try {
        const address = marketEndpoint(
          exchange,
          market,
          "ticker",
          symbol,
          "15m",
          10
        );

        const raw = await requestJSON(address);

        const ticker = normalizeTicker(
          exchange,
          unwrap(exchange, raw)
        );

        publish(
          ticker.lastPrice,
          "rest-fallback"
        );
      } catch (error) {
        console.warn(
          "Fallback:",
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

      const address = upstreamAddress(
        exchange,
        market,
        symbol
      );

      const ws = new WebSocket(address, {
        handshakeTimeout: 10000,
        perMessageDeflate: false
      });

      upstream = ws;

      ws.on("open", () => {
        retryCount = 0;

        sendJSON(client, {
          type: "status",
          status: "connected",
          exchange,
          market,
          symbol
        });

        const s = exchangeSymbol(
          exchange,
          market,
          symbol
        );

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
        }

        if (exchange === "okx") {
          ws.send(JSON.stringify({
            op: "subscribe",
            args: [{
              channel: "tickers",
              instId: s
            }]
          }));
        }

        if (exchange === "bybit") {
          heartbeatTimer = setInterval(() => {
            if (
              ws.readyState === WebSocket.OPEN
            ) {
              ws.send(JSON.stringify({
                op: "ping"
              }));
            }
          }, 20000);
        }

        if (exchange === "okx") {
          heartbeatTimer = setInterval(() => {
            if (
              ws.readyState === WebSocket.OPEN
            ) {
              ws.send("ping");
            }
          }, 20000);
        }
      });

      ws.on("message", buffer => {
        try {
          const text = exchange === "bingx"
            ? parseBingX(buffer)
            : buffer.toString("utf8");

          if (exchange === "bingx") {
            if (text === "Ping") {
              ws.send("Pong");
              return;
            }

            if (text === "ping") {
              ws.send("pong");
              return;
            }
          }

          if (
            text === "pong" ||
            text === "Pong"
          ) return;

          const message = JSON.parse(text);

          if (
            exchange === "bingx" &&
            message.ping !== undefined
          ) {
            ws.send(JSON.stringify({
              pong: message.ping
            }));
            return;
          }

          const price = extractPrice(
            exchange,
            message
          );

          if (
            price !== null &&
            price > 0
          ) {
            lastReceived = Date.now();
            publish(price);
          }
        } catch (error) {
          console.warn(
            "Mensaje WS:",
            exchange,
            error.message
          );
        }
      });

      ws.on("error", error => {
        console.warn(
          "WebSocket:",
          exchange,
          error.message
        );
      });

      ws.on("close", () => {
        if (ws === upstream) {
          reconnect();
        }
      });
    }

    client.on("close", () => {
      closed = true;
      clearTimeout(retryTimer);
      clearInterval(fallbackTimer);
      stopUpstream();
    });

    client.on("error", () => {
      closed = true;
      clearTimeout(retryTimer);
      clearInterval(fallbackTimer);
      stopUpstream();
    });

    sendJSON(client, {
      type: "status",
      status: "connecting",
      exchange,
      market,
      symbol
    });

    connectUpstream();

    // Respaldo REST si faltan precios.
    fallbackTimer = setInterval(
      fallbackPrice,
      5000
    );

    fallbackPrice();
  }
);

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

    const exchange = validExchange(
      address.searchParams.get("exchange") ||
      "bingx"
    );

    const market =
      address.searchParams.get("market") ||
      "perpetual";

    validMarket(market);

    const symbol = validSymbol(
      address.searchParams.get("symbol") ||
      "BTC-USDT"
    );

    wss.handleUpgrade(
      req,
      socket,
      head,
      ws => {
        wss.emit(
          "connection",
          ws,
          req,
          {
            exchange,
            market,
            symbol
          }
        );
      }
    );
  } catch (error) {
    console.error(
      "Upgrade WS:",
      error.message
    );

    socket.destroy();
  }
);

// ========================================
// INICIAR CRYPTOLEXUZ
// ========================================

server.listen(PORT, "0.0.0.0", () => {
  console.log("============================");
  console.log("CRYPTOLEXUZ SERVER V11");
  console.log("Puerto:", PORT);
  console.log("BingX, Binance, Bybit, OKX");
  console.log("WebSocket: /ws");
  console.log("============================");
});
