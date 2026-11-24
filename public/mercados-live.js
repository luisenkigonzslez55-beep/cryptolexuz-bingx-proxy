
/*
 CRYPTOLEXUZ PRO
 MERCADOS LIVE V1
 Precios reales, variación 24h y favoritos.
 No modifica el motor de gráficas.
*/
"use strict";

(() => {
  if (window.__CL_MARKETS_LIVE_V1__) return;
  window.__CL_MARKETS_LIVE_V1__ = true;

  const REFRESH_MS = 20000;
  const TIMEOUT_MS = 9000;

  const $ = id => document.getElementById(id);

  const assets = [
    ["BTC-USDT", "BTC-USDT"],
    ["ETH-USDT", "ETH-USDT"],
    ["BNB-USDT", "BNB-USDT"],
    ["SOL-USDT", "SOL-USDT"],
    ["XRP-USDT", "XRP-USDT"],
    ["DOGE-USDT", "DOGE-USDT"],
    ["NCCOGOLD2USD-USDT", "NCCOGOLD2USD-USDT"],
    ["NCCO1OILWTI2USD-USDT", "NCCO1OILWTI2USD-USDT"]
  ];

  const state = {
    prices: new Map(),
    busy: false,
    lastUpdate: null
  };

  const PROXY = location.origin;

  async function fetchJSON(url) {
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      TIMEOUT_MS
    );

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        cache: "no-store"
      });

      if (!response.ok) {
        throw new Error("HTTP " + response.status);
      }

      return await response.json();
    } finally {
      clearTimeout(timer);
    }
  }

  function unwrap(json) {
    if (!json || typeof json !== "object") {
      return null;
    }

    let data = json.data ?? json.result ?? json;

    if (Array.isArray(data)) {
      data = data[0];
    }

    if (data && Array.isArray(data.tickers)) {
      data = data.tickers[0];
    }

    if (data && Array.isArray(data.data)) {
      data = data.data[0];
    }

    return data && typeof data === "object"
      ? data
      : null;
  }

  function parseTicker(json) {
    const data = unwrap(json);

    if (!data) return null;

    const price = Number(
      data.lastPrice ??
      data.last ??
      data.price ??
      data.close ??
      data.c
    );

    const open = Number(
      data.openPrice ??
      data.open ??
      data.open24h ??
      data.o
    );

    const high = Number(
      data.highPrice ??
      data.high ??
      data.high24h ??
      data.h
    );

    const low = Number(
      data.lowPrice ??
      data.low ??
      data.low24h ??
      data.l
    );

    const volume = Number(
      data.quoteVolume ??
      data.turnover ??
      data.volume ??
      data.vol ??
      data.v
    );

    let change = Number(
      data.priceChangePercent ??
      data.changePercent ??
      data.changeRate ??
      data.priceChangeRate
    );

    if (!Number.isFinite(change)) {
      change = Number.isFinite(open) && open > 0
        ? ((price - open) / open) * 100
        : NaN;
    } else if (
      data.priceChangeRate !== undefined ||
      data.changeRate !== undefined
    ) {
      change *= 100;
    }

    if (!Number.isFinite(price) || price <= 0) {
      return null;
    }

    return {
      price,
      change: Number.isFinite(change) ? change : null,
      high: Number.isFinite(high) ? high : null,
      low: Number.isFinite(low) ? low : null,
      volume: Number.isFinite(volume) ? volume : null
    };
  }

  async function getTicker(symbol, market) {
    const encoded = encodeURIComponent(symbol);

    const paths = [
      `/api/exchange/bingx/ticker/${encoded}?market=${market}`,
      `/api/exchange/bingx/ticker?symbol=${encoded}&market=${market}`,
      `/api/exchange/bingx/tickers?symbol=${encoded}&market=${market}`
    ];

    // Último recurso: endpoint público de BingX.
    if (market === "spot") {
      paths.push(
        `https://open-api.bingx.com/openApi/spot/v1/ticker/24hr?symbol=${encoded}`
      );
    } else {
      paths.push(
        `https://open-api.bingx.com/openApi/swap/v2/quote/ticker?symbol=${encoded}`
      );
    }

    for (const path of paths) {
      try {
        const json = await fetchJSON(
          path.startsWith("http")
            ? path
            : PROXY + path
        );

        const ticker = parseTicker(json);

        if (ticker) return ticker;
      } catch (error) {
        // Intentar la siguiente ruta.
      }
    }

    return null;
  }

  function formatPrice(value) {
    if (!Number.isFinite(value)) return "—";

    const digits = value >= 1000
      ? 2
      : value >= 1
        ? 4
        : 6;

    return "$" + value.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: digits
    });
  }

  function formatChange(value) {
    if (!Number.isFinite(value)) return "—%";

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

    rows.forEach(row => {
      const button = row.querySelector(
        ".cl-market-open"
      );

      if (!button) return;

      const label = button.querySelector(
        ".cl-asset-label strong"
      );

      if (!label) return;

      const asset = assets.find(
        item => item[0].replace(/-/g, "") ===
          label.textContent.replace(/[^A-Z0-9]/gi, "")
      ) || assets.find(
        item => item[0] ===
          (button.getAttribute("aria-label") || "")
            .replace("Abrir gráfica de ", "")
      );

      if (!asset) return;

      const data = state.prices.get(asset[0]);

      const priceNode = button.querySelector(
        ".cl-market-price"
      );

      const changeNode = button.querySelector(
        ".cl-market-change"
      );

      if (!priceNode || !changeNode) return;

      if (!data) {
        priceNode.textContent = "—";
        changeNode.textContent = "—%";
        changeNode.style.background = "";
        return;
      }

      priceNode.textContent = formatPrice(data.price);
      changeNode.textContent = formatChange(data.change);

      if (data.change !== null) {
        changeNode.style.background =
          data.change >= 0
            ? "rgba(0,190,130,.22)"
            : "rgba(225,50,85,.22)";

        changeNode.style.color =
          data.change >= 0
            ? "#00f5a0"
            : "#ff6382";
      } else {
        changeNode.style.background = "";
        changeNode.style.color = "";
      }
    });
  }

  function updateStatus() {
    const status = $("clMarketListStatus");
    if (!status) return;

    const count = state.prices.size;

    if (count === 0) {
      status.textContent =
        "No se pudieron consultar los precios. Revisa la conexión del servidor.";
      return;
    }

    const time = state.lastUpdate
      ? state.lastUpdate.toLocaleTimeString("es-MX")
      : "—";

    status.textContent =
      `${count} activos con precio disponible · Actualizado ${time}`;
  }

  async function refresh() {
    if (state.busy || document.hidden) return;

    state.busy = true;

    const market = $("market")?.value === "spot"
      ? "spot"
      : "perpetual";

    try {
      const results = await Promise.all(
        assets.map(async ([symbol]) => {
          const isCommodity = symbol.startsWith("NCCO");

          if (market === "spot" && isCommodity) {
            return [symbol, null];
          }

          const data = await getTicker(
            symbol,
            isCommodity ? "perpetual" : market
          );

          return [symbol, data];
        })
      );

      for (const [symbol, data] of results) {
        if (data) {
          state.prices.set(symbol, data);
        } else {
          state.prices.delete(symbol);
        }
      }

      state.lastUpdate = new Date();
      updateRows();
      updateStatus();

    } finally {
      state.busy = false;
    }
  }

  function start() {
    const list = $("clMarketList");
    if (!list) return;

    // Reaplicar precios al buscar o cambiar filtros.
    const observer = new MutationObserver(() => {
      requestAnimationFrame(updateRows);
    });

    observer.observe(list, {
      childList: true
    });

    $("market")?.addEventListener(
      "change",
      refresh
    );

    document.addEventListener(
      "visibilitychange",
      () => {
        if (!document.hidden) refresh();
      }
    );

    refresh();
    setInterval(refresh, REFRESH_MS);
  }

  if (document.readyState === "loading") {
    document.addEventListener(
      "DOMContentLoaded",
      start,
      {once:true}
    );
  } else {
    start();
  }
})();
