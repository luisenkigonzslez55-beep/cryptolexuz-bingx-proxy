import express from "express";
import cors from "cors";

const app = express();
const PORT = process.env.PORT || 3000;
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "*";
app.use(cors({ origin: ALLOWED_ORIGIN === "*" ? "*" : ALLOWED_ORIGIN.split(",").map(s => s.trim()) }));
app.use(express.json());

const BINGX = "https://open-api.bingx.com";
const INTERVALS = new Set(["1m","3m","5m","15m","30m","1h","2h","4h","6h","8h","12h","1d","3d","1w","1M"]);

async function bingx(path) {
  const r = await fetch(`${BINGX}${path}`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw new Error(`BingX respondió HTTP ${r.status}`);
  const j = await r.json();
  if (j.code !== 0) throw new Error(j.msg || `BingX code ${j.code}`);
  return j.data;
}
function validMarket(m) {
  if (m !== "spot" && m !== "perpetual") throw new Error("Mercado inválido: usa spot o perpetual");
}
function validSymbol(s) {
  const symbol = String(s || "").toUpperCase().replace(/_/g, "-");
  if (!/^[A-Z0-9]+-[A-Z0-9]+$/.test(symbol)) throw new Error("Símbolo inválido; ejemplo BTC-USDT");
  return symbol;
}

app.get("/health", (_req, res) => res.json({ ok: true, service: "CRYPTOLEXUZ BingX proxy" }));

app.get("/api/market/:market/ticker/:symbol", async (req, res) => {
  try {
    const { market } = req.params; validMarket(market);
    const symbol = validSymbol(req.params.symbol);
    const path = market === "perpetual"
      ? `/openApi/swap/v2/quote/ticker?symbol=${encodeURIComponent(symbol)}`
      : `/openApi/spot/v2/ticker/price?symbol=${encodeURIComponent(symbol)}`;
    res.json({ source: "BingX", market, symbol, data: await bingx(path), fetchedAt: new Date().toISOString() });
  } catch (e) { res.status(502).json({ error: e.message }); }
});

app.get("/api/market/:market/klines/:symbol", async (req, res) => {
  try {
    const { market } = req.params; validMarket(market);
    const symbol = validSymbol(req.params.symbol);
    const interval = String(req.query.interval || "15m");
    if (!INTERVALS.has(interval)) return res.status(400).json({ error: "Temporalidad no permitida" });
    const limit = Math.max(1, Math.min(500, Number(req.query.limit || 100)));
    const path = market === "perpetual"
      ? `/openApi/swap/v3/quote/klines?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}&limit=${limit}`
      : `/openApi/spot/v2/market/kline?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}&limit=${limit}`;
    res.json({ source: "BingX", market, symbol, interval, data: await bingx(path), fetchedAt: new Date().toISOString() });
  } catch (e) { res.status(502).json({ error: e.message }); }
});

app.listen(PORT, () => console.log(`CRYPTOLEXUZ proxy escuchando en puerto ${PORT}`));
