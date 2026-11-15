
import express from "express";
import cors from "cors";
import path from "path";

const app = express();
const PORT = process.env.PORT || 3000;

const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "*";

app.use(cors({
  origin: ALLOWED_ORIGIN === "*"
    ? "*"
    : ALLOWED_ORIGIN.split(",").map(s => s.trim())
}));

app.use(express.json());

// Servir la página web desde public
app.use(express.static(path.join(process.cwd(), "public")));

const BINGX = "https://open-api.bingx.com";

const INTERVALS = new Set([
  "1m", "3m", "5m", "15m", "30m",
  "1h", "2h", "4h", "6h", "8h",
  "12h", "1d", "3d", "1w", "1M"
]);

async function bingx(endpoint) {
  const response = await fetch(`${BINGX}${endpoint}`, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(10000)
  });

  if (!response.ok) {
    throw new Error(`BingX respondió HTTP ${response.status}`);
  }

  const result = await response.json();

  if (result.code !== 0) {
    throw new Error(result.msg || `BingX code ${result.code}`);
  }

  return result.data;
}

function validMarket(market) {
  if (market !== "spot" && market !== "perpetual") {
    throw new Error("Mercado inválido: usa spot o perpetual");
  }
}

function validSymbol(value) {
  const symbol = String(value || "")
    .toUpperCase()
    .replace(/_/g, "-");

  if (!/^[A-Z0-9]+-[A-Z0-9]+$/.test(symbol)) {
    throw new Error("Símbolo inválido; ejemplo BTC-USDT");
  }

  return symbol;
}

// Comprobar que el servidor funciona
app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "CRYPTOLEXUZ BingX proxy"
  });
});

// Obtener precio de mercado
app.get("/api/market/:market/ticker/:symbol", async (req, res) => {
  try {
    const { market } = req.params;
    validMarket(market);

    const symbol = validSymbol(req.params.symbol);

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
    res.status(502).json({ error: error.message });
  }
});

// Obtener velas y datos históricos
app.get("/api/market/:market/klines/:symbol", async (req, res) => {
  try {
    const { market } = req.params;
    validMarket(market);

    const symbol = validSymbol(req.params.symbol);

    const interval = String(req.query.interval || "15m");

    if (!INTERVALS.has(interval)) {
      return res.status(400).json({
        error: "Temporalidad no permitida"
      });
    }

    const limit = Math.max(
      1,
      Math.min(500, Number(req.query.limit || 100))
    );

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
    res.status(502).json({ error: error.message });
  }
});

// Iniciar servidor
app.listen(PORT, () => {
  console.log(`CRYPTOLEXUZ escuchando en puerto ${PORT}`);
});
