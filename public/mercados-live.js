
/*
 CRYPTOLEXUZ PRO
 MERCADOS LIVE V2

 Precios reales desde el proxy de BingX.
 Criptomonedas, GOLD y OIL WTI.
 Favoritos y filtros compatibles con index.html V24.

 No modifica gráficas, Fibonacci, escáner
 ni otros módulos.
*/

"use strict";

(() => {
  if (window.__CL_MARKETS_LIVE_V2__) return;
  window.__CL_MARKETS_LIVE_V2__ = true;

  const REFRESH_MS = 20000;
  const TIMEOUT_MS = 12000;

  const $ = id => document.getElementById(id);

  const assets = [
    {
      symbol: "BTC-USDT",
      names: ["BTCUSDT", "BTC-USDT"]
    },
    {
      symbol: "ETH-USDT",
      names: ["ETHUSDT", "ETH-USDT"]
    },
    {
      symbol: "BNB-USDT",
      names: ["BNBUSDT", "BNB-USDT"]
    },
    {
      symbol: "SOL-USDT",
      names: ["SOLUSDT", "SOL-USDT"]
    },
    {
      symbol: "XRP-USDT",
      names: ["XRPUSDT", "XRP-USDT"]
    },
    {
      symbol: "DOGE-USDT",
      names: ["DOGEUSDT", "DOGE-USDT"]
    },
    {
      symbol: "NCCOGOLD2USD-USDT",
      names: [
        "GOLD (XAU)",
        "GOLD",
        "XAU",
        "NCCOGOLD2USD-USDT"
      ],
      commodity: true
    },
    {
      symbol: "NCCO1OILWTI2USD-USDT",
      names: [
        "OIL WTI",
        "OIL",
        "WTI",
        "NCCO1OILWTI2USD-USDT"
      ],
      commodity: true
    }
  ];

  const state = {
    prices: new Map(),
    busy: false,
    lastUpdate: null,
    market: "perpetual"
  };

  const normalizeName = value =>
    String(value || "")
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "");

  const assetLookup = new Map();

  for (const asset of assets) {
    assetLookup.set(
      normalizeName(asset.symbol),
      asset
    );

    for (const name of asset.names) {
      assetLookup.set(normalizeName(name), asset);
    }
  }

  function findAsset(row) {
    const open = row.querySelector(".cl-market-open");

    if (!open) return null;

    const label = open.querySelector(
      ".cl-asset-label strong"
    );

    const name = label?.textContent || "";

    const aria = (
      open.getAttribute("aria-label") || ""
    ).replace(/^Abrir gráfica de\s*/i, "");

    return (
      assetLookup.get(normalizeName(name)) ||
      assetLookup.get(normalizeName(aria)) ||
      null
    );
  }

  async function fetchJSON(url) {
    const controller = new AbortController();

    const timer = setTimeout(
      () => controller.abort(),
      TIMEOUT_MS
    );

    try {
      const response = await fetch(url, {
        method: "GET",
        cache: "no-store",
        signal: controller.signal,
        headers: {
          Accept: "application/json"
        }
      });

      if (!response.ok) {
        throw new Error(
          "HTTP " + response.status
        );
      }

      return await response.json();

    } finally {
      clearTimeout(timer);
    }
  }

  function validNumber(value) {
    if (
      value === null ||
      value === undefined ||
      value === ""
    ) {
      return null;
    }

    const number = Number(value);

    return Number.isFinite(number)
      ? number
      : null;
  }

  function parseTicker(json) {
    if (!json || typeof json !== "object") {
      return null;
    }

    if (json.ok === false) {
      return null;
    }

    let data = json.data ?? json.result ?? json;

    if (Array.isArray(data)) {
      data = data[0];
    }

    if (data?.list && Array.isArray(data.list)) {
      data = data.list[0];
    }

    if (data?.tickers && Array.isArray(data.tickers)) {
      data = data.tickers[0];
    }

    if (data?.data && Array.isArray(data.data)) {
      data = data.data[0];
    }

    if (!data || typeof data !== "object") {
      return null;
    }

    const price = validNumber(
      data.lastPrice ??
      data.last ??
      data.price ??
      data.close ??
      data.c
    );

    if (price === null || price <= 0) {
      return null;
    }

    const open = validNumber(
      data.openPrice ??
      data.open24h ??
      data.open ??
      data.o
    );

    const high = validNumber(
      data.highPrice ??
      data.high24h ??
      data.high ??
      data.h
    );

    const low = validNumber(
      data.lowPrice ??
      data.low24h ??
      data.low ??
      data.l
    );

    const volume = validNumber(
      data.quoteVolume ??
      data.turnover ??
      data.volume ??
      data.vol ??
      data.v
    );

    let change = validNumber(
      data.priceChangePercent ??
      data.changePercent ??
      data.changeRate ??
      data.priceChangeRate
    );

    if (
      data.priceChangePercent === undefined &&
      (
        data.changeRate !== undefined ||
        data.priceChangeRate !== undefined
      ) &&
      change !== null
    ) {
      change *= 100;
    }

    if (
      change === null &&
      open !== null &&
      open > 0
    ) {
      change = ((price - open) / open) * 100;
    }

    return {
      price,
      change,
      open,
      high,
      low,
      volume,
      receivedAt: Date.now()
    };
  }

  async function getTicker(asset, market) {
    const actualMarket = asset.commodity
      ? "perpetual"
      : market;

    const url =
      "/api/exchange/bingx/ticker/" +
      encodeURIComponent(asset.symbol) +
      "?market=" +
      encodeURIComponent(actualMarket);

    try {
      const json = await fetchJSON(url);
      return parseTicker(json);

    } catch (error) {
      console.warn(
        "[MERCADOS LIVE]",
        asset.symbol,
        error.message
      );

      return null;
    }
  }

  function formatPrice(value) {
    if (!Number.isFinite(value)) {
      return "—";
    }

    let digits;

    if (value >= 100) {
      digits = 2;
    } else if (value >= 1) {
      digits = 4;
    } else if (value >= 0.01) {
      digits = 5;
    } else {
      digits = 8;
    }

    return "$" + value.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: digits
    });
  }

  function formatChange(value) {
    if (!Number.isFinite(value)) {
      return "—%";
    }

    return (
      (value > 0 ? "+" : "") +
      value.toFixed(2) +
      "%"
    );
  }

  function updateRows() {
    const rows = document.querySelectorAll(
      "#clMarketList .cl-market-row"
    );

    for (const row of rows) {
      const asset = findAsset(row);

      if (!asset) continue;

      const button = row.querySelector(
        ".cl-market-open"
      );

      if (!button) continue;

      const priceNode = button.querySelector(
        ".cl-market-price"
      );

      const changeNode = button.querySelector(
        ".cl-market-change"
      );

      if (!priceNode || !changeNode) continue;

      const data = state.prices.get(asset.symbol);

      if (!data) {
        priceNode.textContent = "—";
        changeNode.textContent = "—%";
        changeNode.style.background = "";
        changeNode.style.color = "";
        continue;
      }

      priceNode.textContent = formatPrice(
        data.price
      );

      changeNode.textContent = formatChange(
        data.change
      );

      if (Number.isFinite(data.change)) {
        const positive = data.change >= 0;

        changeNode.style.background = positive
          ? "rgba(0,190,130,.22)"
          : "rgba(225,50,85,.22)";

        changeNode.style.color = positive
          ? "#00f5a0"
          : "#ff6382";

      } else {
        changeNode.style.background = "";
        changeNode.style.color = "";
      }
    }
  }

  function updateStatus() {
    const status = $("clMarketListStatus");

    if (!status) return;

    const available = [...state.prices.values()]
      .filter(Boolean).length;

    if (!available) {
      status.textContent =
        "Sin cotizaciones disponibles. " +
        "Comprueba la conexión con BingX.";
      return;
    }

    const time = state.lastUpdate
      ? state.lastUpdate.toLocaleTimeString("es-MX")
      : "—";

    status.textContent =
      available +
      " activos con cotización disponible · " +
      "Actualizado " +
      time;
  }

  async function refresh() {
    if (state.busy || document.hidden) {
      return;
    }

    state.busy = true;

    const market = $("market")?.value === "spot"
      ? "spot"
      : "perpetual";

    state.market = market;

    try {
      const results = await Promise.all(
        assets.map(async asset => {
          const data = await getTicker(
            asset,
            market
          );

          return {
            symbol: asset.symbol,
            data
          };
        })
      );

      // Evitar mezclar respuestas de Spot y Perpetuos.
      const currentMarket =
        $("market")?.value === "spot"
          ? "spot"
          : "perpetual";

      if (currentMarket !== market) {
        return;
      }

      for (const result of results) {
        if (result.data) {
          state.prices.set(
            result.symbol,
            result.data
          );
        } else {
          state.prices.delete(
            result.symbol
          );
        }
      }

      state.lastUpdate = new Date();

      updateRows();
      updateStatus();

    } catch (error) {
      console.error(
        "[MERCADOS LIVE]",
        error
      );

    } finally {
      state.busy = false;
    }
  }

  function start() {
    const list = $("clMarketList");

    if (!list) {
      console.warn(
        "No existe clMarketList"
      );
      return;
    }

    // El index vuelve a crear filas al buscar
    // y cambiar filtros. Recuperar sus precios.
    const observer = new MutationObserver(() => {
      requestAnimationFrame(updateRows);
    });

    observer.observe(list, {
      childList: true
    });

    $("market")?.addEventListener(
      "change",
      () => {
        state.prices.clear();
        updateRows();
        refresh();
      }
    );

    document.addEventListener(
      "visibilitychange",
      () => {
        if (!document.hidden) {
          refresh();
        }
      }
    );

    window.addEventListener(
      "online",
      refresh
    );

    refresh();

    setInterval(
      refresh,
      REFRESH_MS
    );
  }

  if (document.readyState === "loading") {
    document.addEventListener(
      "DOMContentLoaded",
      start,
      { once: true }
    );
  } else {
    start();
  }

})();
