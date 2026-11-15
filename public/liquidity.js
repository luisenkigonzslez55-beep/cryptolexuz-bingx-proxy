

/* =====================================================
   CRYPTOLEXUZ PRO — LIQUIDITY.JS V10
   Libro de órdenes · Top 10 · Mapa de calor
   Datos públicos reales de BingX y OKX
   ===================================================== */

"use strict";

(() => {
  const $ = id => document.getElementById(id);

  const CONFIG = {
    refreshMs: 2500,
    timeoutMs: 10000,
    maxSnapshots: 70,
    maxLevels: 10,
    heatRows: 48
  };

  const state = {
    snapshots: [],
    lastBook: null,
    selectionKey: "",
    running: false,
    busy: false,
    generation: 0,
    timer: null,
    controller: null,
    observer: null
  };

  const COLORS = {
    green: "#00f5a0",
    red: "#ff476c",
    purple: "#bb52ff",
    yellow: "#ffe15a",
    muted: "#a5b0cf"
  };

  function format(value, digits = 2) {
    const n = Number(value);

    return Number.isFinite(n)
      ? n.toLocaleString("en-US", {
          minimumFractionDigits: digits,
          maximumFractionDigits: digits
        })
      : "—";
  }

  function element(tag, className = "", text) {
    const node = document.createElement(tag);

    if (className) node.className = className;

    if (text !== undefined) {
      node.textContent = text;
    }

    return node;
  }

  function selection() {
    const exchangeValue =
      $("exchange")?.value || "bingx";

    const exchange =
      ["bingx", "okx"].includes(exchangeValue)
        ? exchangeValue
        : "bingx";

    return {
      exchange,
      symbol: $("symbol")?.value || "BTC-USDT",
      market: $("market")?.value || "perpetual"
    };
  }

  function selectionKey(s) {
    return [
      s.exchange,
      s.symbol,
      s.market
    ].join("|");
  }

  function status(message, color = COLORS.muted) {
    const node = $("clMapStatus");

    if (node) {
      node.textContent = message;
      node.style.color = color;
    }
  }

  function installStyles() {
    if ($("clLiquidityStyles")) return;

    const style = element("style");
    style.id = "clLiquidityStyles";

    style.textContent = `
      .cl-liquidity-map {
        min-width: 0;
        padding: 10px;
        background: #080e20;
        border: 1px solid #35436d;
        border-radius: 10px;
      }

      .cl-map-heading {
        display: flex;
        justify-content: space-between;
        align-items: center;
        flex-wrap: wrap;
        gap: 8px;
        margin-bottom: 10px;
        font-size: 12px;
      }

      .cl-muted {
        color: #a5b0cf;
        font-size: 11px;
      }

      #clHeatmap {
        display: block;
        width: 100%;
        height: 270px;
        background: #070b19;
        border-radius: 8px;
      }

      .cl-map-note {
        margin: 10px 0 0;
        color: #a5b0cf;
        font-size: 11px;
        line-height: 1.6;
      }

      .cl-map-legend {
        display: flex;
        align-items: center;
        justify-content: space-between;
        flex-wrap: wrap;
        gap: 8px;
        margin-top: 10px;
        font-size: 10px;
        color: #b7c3e1;
      }

      .cl-legend-gradient {
        width: 110px;
        height: 8px;
        border-radius: 5px;
        background: linear-gradient(
          90deg,
          #48218c,
          #9b31df,
          #ff476c,
          #ffe15a
        );
      }

      .cl-orderbook {
        margin-top: 15px;
        padding-top: 12px;
        border-top: 1px solid #35436d;
      }

      .cl-book-title {
        margin: 0 0 10px;
        font-size: 13px;
        color: #f5f7ff;
      }

      .cl-book-label {
        margin: 12px 0 7px;
        font-size: 11px;
        font-weight: 800;
      }

      .cl-sell {
        color: #ff476c;
      }

      .cl-buy {
        color: #00f5a0;
      }

      .cl-book-columns {
        display: grid;
        grid-template-columns: 1fr 1fr 1fr;
        gap: 6px;
        padding: 5px 7px;
        color: #a5b0cf;
        font-size: 10px;
      }

      .cl-book-columns span:not(:first-child) {
        text-align: right;
      }

      .cl-book-row {
        position: relative;
        display: grid;
        grid-template-columns: 1fr 1fr 1fr;
        gap: 6px;
        margin-bottom: 3px;
        padding: 6px 7px;
        overflow: hidden;
        border-radius: 5px;
        font-size: 11px;
        font-variant-numeric: tabular-nums;
      }

      .cl-book-row > span {
        position: relative;
        z-index: 1;
      }

      .cl-book-row > span:not(:first-of-type) {
        text-align: right;
      }

      .cl-book-bar {
        position: absolute;
        top: 0;
        bottom: 0;
        left: 0;
        opacity: .24;
        z-index: 0;
      }

      .cl-book-row.ask {
        color: #ff8ba1;
        background: rgba(255,71,108,.05);
      }

      .cl-book-row.bid {
        color: #65ffc7;
        background: rgba(0,245,160,.05);
      }

      .cl-book-row.ask .cl-book-bar {
        background: #ff476c;
      }

      .cl-book-row.bid .cl-book-bar {
        background: #00f5a0;
      }

      .cl-book-middle {
        margin: 12px 0;
        padding: 10px;
        text-align: center;
        background: #121a36;
        border: 1px solid #35436d;
        border-radius: 8px;
        color: #f5f7ff;
        font-size: 12px;
      }

      .cl-book-summary {
        margin-top: 12px;
        padding: 11px;
        border-radius: 8px;
        background: #101831;
        color: #cbd5f2;
        font-size: 11px;
        line-height: 1.8;
      }

      .cl-book-error {
        padding: 10px;
        color: #ff8ba1;
        font-size: 11px;
      }

      @media (min-width: 700px) {
        #clHeatmap {
          height: 350px;
        }

        .cl-book-row {
          font-size: 12px;
        }
      }
    `;

    document.head.appendChild(style);
  }

  function buildUI() {
    const map = $("liquidityMap");
    const section = $("orderbookSection");

    if (!map || !section) {
      console.warn(
        "CRYPTOLEXUZ: faltan contenedores de liquidez."
      );
      return false;
    }

    installStyles();

    map.className = "cl-liquidity-map";
    map.replaceChildren();

    const heading = element(
      "div",
      "cl-map-heading"
    );

    const title = element(
      "strong",
      "",
      "Mapa de profundidad visible"
    );

    const stateLabel = element(
      "span",
      "cl-muted",
      "Iniciando..."
    );

    stateLabel.id = "clMapStatus";

    heading.append(title, stateLabel);

    const canvas = element("canvas");
    canvas.id = "clHeatmap";

    canvas.setAttribute(
      "aria-label",
      "Mapa de calor de órdenes visibles"
    );

    const legend = element(
      "div",
      "cl-map-legend"
    );

    legend.append(
      element("span", "", "Menor concentración"),
      element("div", "cl-legend-gradient"),
      element("span", "", "Mayor concentración")
    );

    const note = element(
      "p",
      "cl-map-note",
      "Historial registrado desde que se abre " +
      "esta página. Las órdenes visibles pueden " +
      "cambiar o cancelarse. No representa " +
      "liquidaciones ni órdenes ocultas."
    );

    map.append(
      heading,
      canvas,
      legend,
      note
    );

    const article =
      section.querySelector("article");

    if (!article) return false;

    let book = $("clOrderbook");

    if (!book) {
      book = element(
        "div",
        "cl-orderbook"
      );

      book.id = "clOrderbook";
      article.appendChild(book);
    }

    book.replaceChildren();

    const bookTitle = element(
      "h3",
      "cl-book-title",
      "Libro de órdenes · 10 niveles por lado"
    );

    const sellTitle = element(
      "div",
      "cl-book-label cl-sell",
      "VENTAS · ASK"
    );

    const sellColumns = createColumns();

    const asks = element(
      "div",
      "",
      "Esperando órdenes..."
    );

    asks.id = "clAsks";

    const middle = element(
      "div",
      "cl-book-middle",
      "Spread: —"
    );

    middle.id = "clSpread";

    const buyTitle = element(
      "div",
      "cl-book-label cl-buy",
      "COMPRAS · BID"
    );

    const buyColumns = createColumns();

    const bids = element(
      "div",
      "",
      "Esperando órdenes..."
    );

    bids.id = "clBids";

    const summary = element(
      "div",
      "cl-book-summary",
      "Esperando profundidad..."
    );

    summary.id = "clBookSummary";

    book.append(
      bookTitle,
      sellTitle,
      sellColumns,
      asks,
      middle,
      buyTitle,
      buyColumns,
      bids,
      summary
    );

    const toggle = $("liquidityMapToggle");

    if (toggle) {
      toggle.disabled = false;
      toggle.checked = true;
    }

    const placeholder = document.querySelector(
      "#liquiditySection .section-heading .muted"
    );

    if (placeholder) {
      placeholder.textContent =
        "Profundidad real · actualización automática";
    }

    return true;
  }

  function createColumns() {
    const row = element(
      "div",
      "cl-book-columns"
    );

    row.append(
      element("span", "", "Precio"),
      element("span", "", "Cantidad"),
      element("span", "", "USDT")
    );

    return row;
  }

  function parseSide(side) {
    if (!Array.isArray(side)) return [];

    return side.map(item => {
      if (Array.isArray(item)) {
        return {
          price: Number(item[0]),
          quantity: Number(item[1])
        };
      }

      return {
        price: Number(
          item.price ??
          item.px ??
          item.p
        ),
        quantity: Number(
          item.quantity ??
          item.qty ??
          item.size ??
          item.sz ??
          item.amount ??
          item.q
        )
      };
    }).filter(level =>
      Number.isFinite(level.price) &&
      Number.isFinite(level.quantity) &&
      level.price > 0 &&
      level.quantity > 0
    );
  }

  function normalizeBook(raw) {
    let data = raw?.data ?? raw;

    if (data?.data) {
      data = data.data;
    }

    if (Array.isArray(data)) {
      data = data[0] ?? {};
    }

    const bids = parseSide(
      data?.bids ?? data?.b ?? []
    ).sort((a, b) => b.price - a.price);

    const asks = parseSide(
      data?.asks ?? data?.a ?? []
    ).sort((a, b) => a.price - b.price);

    return {
      bids: bids.slice(0, CONFIG.maxLevels),
      asks: asks.slice(0, CONFIG.maxLevels)
    };
  }

  function depthURL(s) {
    return (
      "/api/exchange/" +
      encodeURIComponent(s.exchange) +
      "/depth/" +
      encodeURIComponent(s.symbol) +
      "?market=" +
      encodeURIComponent(s.market)
    );
  }

  async function fetchBook(s) {
    const controller = new AbortController();
    state.controller = controller;

    const timeout = setTimeout(
      () => controller.abort(),
      CONFIG.timeoutMs
    );

    try {
      const response = await fetch(depthURL(s), {
        signal: controller.signal,
        cache: "no-store"
      });

      if (!response.ok) {
        throw new Error(
          "Error HTTP " + response.status
        );
      }

      const raw = await response.json();
      const book = normalizeBook(raw);

      if (!book.bids.length || !book.asks.length) {
        throw new Error(
          "El exchange no devolvió niveles válidos"
        );
      }

      return book;

    } finally {
      clearTimeout(timeout);

      if (state.controller === controller) {
        state.controller = null;
      }
    }
  }

  function renderSide(id, levels, type) {
    const root = $(id);
    if (!root) return;

    root.replaceChildren();

    if (!levels.length) {
      root.textContent = "Sin niveles disponibles";
      return;
    }

    const maxNotional = Math.max(
      ...levels.map(
        level => level.price * level.quantity
      ),
      0.00000001
    );

    for (const level of levels) {
      const notional =
        level.price * level.quantity;

      const ratio =
        notional / maxNotional;

      const row = element(
        "div",
        "cl-book-row " + type
      );

      const bar = element(
        "div",
        "cl-book-bar"
      );

      bar.style.width =
        (ratio * 100).toFixed(1) + "%";

      row.append(
        bar,
        element(
          "span",
          "",
          format(level.price, 2)
        ),
        element(
          "span",
          "",
          format(level.quantity, 4)
        ),
        element(
          "span",
          "",
          format(notional, 0)
        )
      );

      root.appendChild(row);
    }
  }

  function renderBook(book) {
    renderSide(
      "clAsks",
      book.asks,
      "ask"
    );

    renderSide(
      "clBids",
      book.bids,
      "bid"
    );

    const bestAsk =
      book.asks[0]?.price;

    const bestBid =
      book.bids[0]?.price;

    if (
      Number.isFinite(bestAsk) &&
      Number.isFinite(bestBid)
    ) {
      const spread = bestAsk - bestBid;

      const percent = bestAsk > 0
        ? spread / bestAsk * 100
        : 0;

      const label = $("clSpread");

      if (label) {
        label.textContent =
          "Spread: " +
          format(spread, 4) +
          " USDT · " +
          format(percent, 4) +
          "%";
      }

      if ($("bid")) {
        $("bid").textContent =
          format(bestBid);
      }

      if ($("ask")) {
        $("ask").textContent =
          format(bestAsk);
      }
    }

    const bidTotal = book.bids.reduce(
      (sum, level) => sum + level.quantity,
      0
    );

    const askTotal = book.asks.reduce(
      (sum, level) => sum + level.quantity,
      0
    );

    const bidNotional = book.bids.reduce(
      (sum, level) =>
        sum + level.price * level.quantity,
      0
    );

    const askNotional = book.asks.reduce(
      (sum, level) =>
        sum + level.price * level.quantity,
      0
    );

    const ratio = askNotional > 0
      ? bidNotional / askNotional
      : null;

    const largestBid = [...book.bids]
      .sort(
        (a, b) =>
          b.price * b.quantity -
          a.price * a.quantity
      )[0];

    const largestAsk = [...book.asks]
      .sort(
        (a, b) =>
          b.price * b.quantity -
          a.price * a.quantity
      )[0];

    const summary = $("clBookSummary");

    if (summary) {
      summary.textContent =
        "Liquidez compradora visible: " +
        format(bidNotional, 0) +
        " USDT. " +
        "Liquidez vendedora visible: " +
        format(askNotional, 0) +
        " USDT. " +
        "Ratio compras/ventas: " +
        (ratio === null
          ? "—"
          : format(ratio, 2)) +
        ". Mayor compra: " +
        format(largestBid?.price) +
        ". Mayor venta: " +
        format(largestAsk?.price) +
        ". Estas cifras corresponden únicamente " +
        "a los diez niveles visibles por lado.";
    }
  }

  function capture(book) {
    state.snapshots.push({
      timestamp: Date.now(),
      bids: book.bids.map(level => ({
        ...level
      })),
      asks: book.asks.map(level => ({
        ...level
      }))
    });

    if (
      state.snapshots.length >
      CONFIG.maxSnapshots
    ) {
      state.snapshots.shift();
    }
  }

  function heatColor(intensity) {
    const value = Math.max(
      0,
      Math.min(1, intensity)
    );

    if (value < 0.25) {
      return `rgba(72,30,145,${0.20 + value})`;
    }

    if (value < 0.50) {
      return `rgba(150,30,220,${0.35 + value})`;
    }

    if (value < 0.75) {
      return `rgba(255,75,110,${0.45 + value * 0.4})`;
    }

    return `rgba(255,210,45,${0.65 + value * 0.35})`;
  }

  function renderHeatmap() {
    const canvas = $("clHeatmap");
    if (!canvas) return;

    const width = Math.max(
      250,
      Math.round(canvas.clientWidth || 300)
    );

    const height = Math.max(
      200,
      Math.round(canvas.clientHeight || 270)
    );

    const dpr = Math.min(
      window.devicePixelRatio || 1,
      2
    );

    canvas.width =
      Math.round(width * dpr);

    canvas.height =
      Math.round(height * dpr);

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.setTransform(
      dpr, 0, 0, dpr, 0, 0
    );

    ctx.fillStyle = "#070b19";
    ctx.fillRect(
      0, 0, width, height
    );

    const snapshots = state.snapshots;

    if (!snapshots.length) {
      ctx.fillStyle = COLORS.muted;
      ctx.font = "12px system-ui";
      ctx.textAlign = "center";

      ctx.fillText(
        "Esperando profundidad real...",
        width / 2,
        height / 2
      );

      return;
    }

    const prices = snapshots.flatMap(
      snapshot => [
        ...snapshot.bids.map(
          level => level.price
        ),
        ...snapshot.asks.map(
          level => level.price
        )
      ]
    );

    if (!prices.length) return;

    const minPrice = Math.min(...prices);
    const maxPrice = Math.max(...prices);

    const range = Math.max(
      maxPrice - minPrice,
      0.000001
    );

    const left = 6;
    const right = 74;
    const top = 12;
    const bottom = 28;

    const plotWidth =
      width - left - right;

    const plotHeight =
      height - top - bottom;

    const columns =
      CONFIG.maxSnapshots;

    const rows =
      CONFIG.heatRows;

    const matrix = Array.from(
      { length: columns },
      () => Array(rows).fill(0)
    );

    let maxLiquidity = 0;

    snapshots.forEach(
      (snapshot, index) => {
        const column =
          columns -
          snapshots.length +
          index;

        const levels = [
          ...snapshot.bids,
          ...snapshot.asks
        ];

        for (const level of levels) {
          const normalized =
            (level.price - minPrice) /
            range;

          const row = Math.max(
            0,
            Math.min(
              rows - 1,
              Math.floor(
                normalized * (rows - 1)
              )
            )
          );

          const notional =
            level.price * level.quantity;

          matrix[column][row] += notional;

          maxLiquidity = Math.max(
            maxLiquidity,
            matrix[column][row]
          );
        }
      }
    );

    const cellWidth =
      plotWidth / columns;

    const cellHeight =
      plotHeight / rows;

    for (let x = 0; x < columns; x++) {
      for (let y = 0; y < rows; y++) {
        const liquidity =
          matrix[x][y];

        if (liquidity <= 0) continue;

        const intensity =
          maxLiquidity > 0
            ? liquidity / maxLiquidity
            : 0;

        ctx.fillStyle =
          heatColor(intensity);

        ctx.fillRect(
          left + x * cellWidth,
          top +
            (rows - 1 - y) *
            cellHeight,
          Math.ceil(cellWidth),
          Math.ceil(cellHeight)
        );
      }
    }

    ctx.strokeStyle =
      "rgba(120,140,190,.18)";

    ctx.lineWidth = 1;

    ctx.font = "10px system-ui";
    ctx.textAlign = "left";
    ctx.fillStyle = COLORS.muted;

    for (let i = 0; i <= 4; i++) {
      const y =
        top + i * plotHeight / 4;

      ctx.beginPath();
      ctx.moveTo(left, y);
      ctx.lineTo(
        width - right,
        y
      );
      ctx.stroke();

      const price =
        maxPrice - i * range / 4;

      ctx.fillText(
        format(price, 2),
        width - right + 6,
        Math.max(12, Math.min(
          height - 5,
          y + 3
        ))
      );
    }

    const bestBid =
      state.lastBook?.bids[0]?.price;

    const bestAsk =
      state.lastBook?.asks[0]?.price;

    if (
      Number.isFinite(bestBid) &&
      Number.isFinite(bestAsk)
    ) {
      const middle =
        (bestBid + bestAsk) / 2;

      const y =
        top +
        (maxPrice - middle) /
        range * plotHeight;

      ctx.strokeStyle =
        "rgba(54,197,255,.85)";

      ctx.lineWidth = 1;

      ctx.setLineDash([5, 4]);

      ctx.beginPath();
      ctx.moveTo(left, y);
      ctx.lineTo(
        width - right,
        y
      );
      ctx.stroke();

      ctx.setLineDash([]);
    }

    ctx.fillStyle = COLORS.muted;
    ctx.font = "10px system-ui";

    ctx.textAlign = "left";

    ctx.fillText(
      "Inicio",
      left,
      height - 8
    );

    ctx.textAlign = "right";

    ctx.fillText(
      "Ahora",
      width - right,
      height - 8
    );
  }

  function resetHistory() {
    state.snapshots = [];
    state.lastBook = null;

    const asks = $("clAsks");
    const bids = $("clBids");
    const summary = $("clBookSummary");

    if (asks) {
      asks.textContent =
        "Esperando órdenes...";
    }

    if (bids) {
      bids.textContent =
        "Esperando órdenes...";
    }

    if (summary) {
      summary.textContent =
        "Esperando profundidad...";
    }

    renderHeatmap();
  }

  async function refreshBook() {
    if (!state.running || state.busy) {
      return;
    }

    if (document.hidden) {
      return;
    }

    const s = selection();
    const key = selectionKey(s);

    if (key !== state.selectionKey) {
      state.selectionKey = key;
      state.generation++;
      resetHistory();
    }

    const generation =
      state.generation;

    state.busy = true;

    try {
      status(
        "Consultando " +
        s.exchange.toUpperCase() +
        "...",
        COLORS.yellow
      );

      const book = await fetchBook(s);

      if (
        !state.running ||
        generation !== state.generation ||
        key !== selectionKey(selection())
      ) {
        return;
      }

      state.lastBook = book;

      capture(book);
      renderBook(book);
      renderHeatmap();

      const time =
        new Date().toLocaleTimeString(
          "es-MX"
        );

      status(
        s.exchange.toUpperCase() +
        " · " + time,
        COLORS.green
      );

    } catch (error) {
      if (
        generation !== state.generation ||
        !state.running
      ) {
        return;
      }

      console.warn(
        "CRYPTOLEXUZ Liquidez:",
        error
      );

      status(
        "Sin profundidad · " +
        error.message,
        COLORS.red
      );

      if (!state.lastBook) {
        const summary =
          $("clBookSummary");

        if (summary) {
          summary.textContent =
            "No fue posible consultar " +
            "el libro de órdenes. " +
            "Comprueba el servidor " +
            "y el mercado seleccionado.";
        }
      }

    } finally {
      state.busy = false;
    }
  }

  function start() {
    if (state.running) return;

    state.running = true;

    status(
      "Conectando...",
      COLORS.yellow
    );

    refreshBook();

    state.timer = setInterval(
      refreshBook,
      CONFIG.refreshMs
    );
  }

  function stop() {
    state.running = false;
    state.generation++;

    if (state.timer) {
      clearInterval(state.timer);
      state.timer = null;
    }

    if (state.controller) {
      state.controller.abort();
      state.controller = null;
    }

    status(
      "Mapa detenido",
      COLORS.muted
    );
  }

  function restart() {
    state.generation++;
    state.selectionKey = "";
    resetHistory();

    if (state.controller) {
      state.controller.abort();
    }

    if (state.running) {
      refreshBook();
    }
  }

  function setupEvents() {
    const toggle =
      $("liquidityMapToggle");

    if (toggle) {
      toggle.addEventListener(
        "change",
        () => {
          if (toggle.checked) {
            start();
          } else {
            stop();
          }
        }
      );
    }

    for (const id of [
      "exchange",
      "symbol",
      "market"
    ]) {
      const node = $(id);

      if (node) {
        node.addEventListener(
          "change",
          restart
        );
      }
    }

    document.addEventListener(
      "visibilitychange",
      () => {
        if (
          !document.hidden &&
          state.running
        ) {
          refreshBook();
        }
      }
    );

    window.addEventListener(
      "resize",
      renderHeatmap
    );
  }

  function init() {
    if (!buildUI()) return;

    setupEvents();
    resetHistory();
    start();

    console.info(
      "CRYPTOLEXUZ PRO: " +
      "módulo de liquidez iniciado."
    );
  }

  if (document.readyState === "loading") {
    document.addEventListener(
      "DOMContentLoaded",
      init
    );
  } else {
    init();
  }

})();
