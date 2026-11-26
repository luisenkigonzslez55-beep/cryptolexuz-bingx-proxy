
/*
 CRYPTOLEXUZ PRO — LIQUIDITY.JS V13 COMPLETO

 MAPA DE CALOR DE PROFUNDIDAD REAL

 Compatible con:
 - BingX / OKX mediante proxy
 - CRYPTOLEXUZ PRO
 - Vista móvil y computadora

 Funciones:
 - Mapa de calor tipo Bookmap
 - Libro de órdenes Top 10
 - Spread, bid, ask y concentración
 - Historial de snapshots reales
 - Trayectoria del precio medio bid/ask
 - Perfil lateral de liquidez
 - Escala de precios
 - Intensidad configurable
 - Zoom vertical táctil y con rueda
 - Reinicio seguro al cambiar de mercado
 - Sin datos simulados

 No representa liquidaciones.
 No ejecuta operaciones.
*/

"use strict";

(() => {
  if (window.__CL_LIQUIDITY_V13__) return;
  window.__CL_LIQUIDITY_V13__ = true;

  const $ = id => document.getElementById(id);

  const CFG = {
    refresh: 2500,
    timeout: 10000,
    depth: 200,
    bookLevels: 10,
    maxSnapshots: 300
  };

  const C = {
    bg: "#000000",
    green: "#00f5a0",
    red: "#ff476c",
    blue: "#36c5ff",
    purple: "#bb52ff",
    yellow: "#ffe15a",
    muted: "#9ba9c9"
  };

  const S = {
    running: false,
    busy: false,
    generation: 0,
    timer: null,
    controller: null,
    key: "",
    snapshots: [],
    lastBook: null,
    maxHistory: 180,
    bins: 100,
    intensity: 1,
    zoom: 1,
    showMap: true,
    showPrice: true,
    showProfile: true,
    observer: null,
    initialized: false,
    frame: 0,
    pinchDistance: 0,
    pendingRefresh: false,
    lastError: "",
    lastUpdated: 0
  };

  function el(tag, cls = "", value) {
    const node = document.createElement(tag);

    if (cls) node.className = cls;

    if (value !== undefined) {
      node.textContent = String(value);
    }

    return node;
  }

  function fmt(value, digits = 2) {
    const number = Number(value);

    if (!Number.isFinite(number)) {
      return "—";
    }

    return number.toLocaleString("en-US", {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits
    });
  }

  function priceDigits(value) {
    const n = Math.abs(Number(value));

    if (n >= 100) return 2;
    if (n >= 1) return 4;
    if (n >= 0.01) return 6;

    return 8;
  }

  function fmtPrice(value) {
    return fmt(value, priceDigits(value));
  }

  function commodity(symbol) {
    return /^NCCO/i.test(String(symbol));
  }

  function selection() {
    const symbol =
      $("symbol")?.value || "BTC-USDT";

    const special = commodity(symbol);

    return {
      symbol,
      exchange: special
        ? "bingx"
        : $("exchange")?.value || "bingx",
      market: special
        ? "perpetual"
        : $("market")?.value || "perpetual"
    };
  }

  function marketKey(s = selection()) {
    return [
      s.exchange,
      s.market,
      s.symbol
    ].join("|");
  }

  function status(message, color = C.muted) {
    const target = $("clMapStatus");

    if (!target) return;

    target.textContent = message;
    target.style.color = color;
  }

  function styles() {
    if ($("clLiquidityStyles")) return;

    const style = el("style");
    style.id = "clLiquidityStyles";

    style.textContent = `
      .cl-liquidity-map {
        width:100%;
        min-width:0;
        box-sizing:border-box;
        padding:10px;
        color:#edf1ff;
        background:#080b16;
        border:1px solid #34416b;
        border-radius:14px;
        overflow:hidden;
      }

      .cl-map-heading {
        display:flex;
        align-items:center;
        justify-content:space-between;
        flex-wrap:wrap;
        gap:8px;
        margin-bottom:10px;
        font-size:13px;
      }

      .cl-muted {
        color:#9ba9c9;
        font-size:11px;
      }

      .cl-heat-toolbar {
        display:flex;
        flex-wrap:wrap;
        align-items:center;
        gap:8px;
        margin-bottom:10px;
        font-size:11px;
      }

      .cl-heat-toolbar label {
        display:flex;
        align-items:center;
        gap:5px;
      }

      .cl-heat-toolbar select,
      .cl-heat-toolbar button {
        padding:7px;
        color:#f2eaff;
        background:#192442;
        border:1px solid #45557e;
        border-radius:7px;
        font-size:11px;
      }

      .cl-heat-toolbar input[type="range"] {
        width:85px;
        accent-color:#bb52ff;
      }

      .cl-heat-toolbar input[type="checkbox"] {
        accent-color:#bb52ff;
      }

      .cl-heat-stage {
        position:relative;
        width:100%;
        height:440px;
        overflow:hidden;
        background:#000;
        border:1px solid #202b4b;
        border-radius:9px;
      }

      #clHeatmap {
        display:block;
        width:100%;
        height:100%;
        touch-action:pan-x;
      }

      .cl-heat-legend {
        display:flex;
        align-items:center;
        gap:8px;
        margin:10px 0;
        font-size:10px;
        color:#aab7d4;
      }

      .cl-heat-gradient {
        height:10px;
        flex:1;
        border-radius:5px;
        background:linear-gradient(
          90deg,
          #250b42 0%,
          #7320ae 20%,
          #1689ca 40%,
          #22cfa7 60%,
          #ffe24d 80%,
          #ff7819 100%
        );
      }

      .cl-map-note {
        margin:9px 0;
        color:#9ba9c9;
        font-size:11px;
        line-height:1.6;
      }

      .cl-orderbook {
        margin-top:15px;
        padding-top:12px;
        border-top:1px solid #34416b;
      }

      .cl-book-title {
        margin:0 0 10px;
        color:#f5f7ff;
        font-size:13px;
      }

      .cl-book-label {
        margin:12px 0 7px;
        font-size:11px;
        font-weight:800;
      }

      .cl-sell { color:#ff476c; }
      .cl-buy { color:#00f5a0; }

      .cl-book-columns,
      .cl-book-row {
        display:grid;
        grid-template-columns:1fr 1fr 1fr;
        gap:6px;
        padding:6px 7px;
        font-size:11px;
        font-variant-numeric:tabular-nums;
      }

      .cl-book-columns {
        color:#9ba9c9;
      }

      .cl-book-columns span:not(:first-child),
      .cl-book-row span:not(:first-of-type) {
        text-align:right;
      }

      .cl-book-row {
        position:relative;
        overflow:hidden;
        margin-bottom:3px;
        border-radius:5px;
      }

      .cl-book-row > span {
        position:relative;
        z-index:1;
      }

      .cl-book-bar {
        position:absolute;
        inset:0 auto 0 0;
        z-index:0;
        opacity:.23;
      }

      .cl-book-row.ask {
        color:#ff8ba1;
        background:rgba(255,71,108,.05);
      }

      .cl-book-row.bid {
        color:#65ffc7;
        background:rgba(0,245,160,.05);
      }

      .cl-book-row.ask .cl-book-bar {
        background:#ff476c;
      }

      .cl-book-row.bid .cl-book-bar {
        background:#00f5a0;
      }

      .cl-book-middle {
        margin:12px 0;
        padding:10px;
        text-align:center;
        background:#121a36;
        border:1px solid #35436d;
        border-radius:8px;
        font-size:12px;
      }

      .cl-book-summary {
        margin-top:12px;
        padding:11px;
        color:#cbd5f2;
        background:#101831;
        border-radius:8px;
        font-size:11px;
        line-height:1.8;
      }

      @media (min-width:700px) {
        .cl-heat-stage {
          height:560px;
        }
      }
    `;

    document.head.appendChild(style);
  }

  function createColumns() {
    const row = el("div", "cl-book-columns");

    ["Precio", "Cantidad", "USDT"].forEach(
      value => row.appendChild(
        el("span", "", value)
      )
    );

    return row;
  }

  function build() {
    const map = $("liquidityMap");
    const section = $("orderbookSection");

    if (!map || !section) {
      console.warn(
        "Liquidez: faltan contenedores HTML"
      );
      return false;
    }

    styles();

    map.classList.add("cl-liquidity-map");
    map.replaceChildren();

    const heading = el(
      "div",
      "cl-map-heading"
    );

    heading.appendChild(
      el(
        "strong",
        "",
        "Mapa de calor · Liquidez"
      )
    );

    const stateLabel = el(
      "span",
      "cl-muted",
      "Preparando..."
    );

    stateLabel.id = "clMapStatus";
    heading.appendChild(stateLabel);

    const toolbar = el(
      "div",
      "cl-heat-toolbar"
    );

    function checkbox(id, text, checked) {
      const label = el("label");
      const input = el("input");

      input.type = "checkbox";
      input.id = id;
      input.checked = checked;

      label.append(
        input,
        el("span", "", text)
      );

      toolbar.appendChild(label);

      return input;
    }

    checkbox(
      "clHeatEnabled",
      "Calor",
      S.showMap
    );

    checkbox(
      "clHeatPrice",
      "Precio",
      S.showPrice
    );

    checkbox(
      "clHeatProfile",
      "Perfil",
      S.showProfile
    );

    const intensityLabel = el("label");

    intensityLabel.appendChild(
      el("span", "", "Intensidad")
    );

    const intensity = el("input");

    intensity.type = "range";
    intensity.id = "clHeatIntensity";
    intensity.min = "0.5";
    intensity.max = "2.5";
    intensity.step = "0.25";
    intensity.value = String(S.intensity);

    intensityLabel.appendChild(intensity);
    toolbar.appendChild(intensityLabel);

    function select(id, title, values, selected) {
      const label = el("label");

      label.appendChild(
        el("span", "", title)
      );

      const input = el("select");
      input.id = id;

      values.forEach(value => {
        const option = el(
          "option",
          "",
          value
        );

        option.value = String(value);
        option.selected =
          Number(value) === Number(selected);

        input.appendChild(option);
      });

      label.appendChild(input);
      toolbar.appendChild(label);

      return input;
    }

    select(
      "clHeatHistory",
      "Historial",
      [60, 120, 180, 300],
      S.maxHistory
    );

    select(
      "clHeatBins",
      "Detalle",
      [60, 80, 100, 140],
      S.bins
    );

    const resetZoom = el(
      "button",
      "",
      "Restablecer zoom"
    );

    resetZoom.id = "clHeatResetZoom";
    resetZoom.type = "button";

    toolbar.appendChild(resetZoom);

    const stage = el(
      "div",
      "cl-heat-stage"
    );

    const canvas = el("canvas");
    canvas.id = "clHeatmap";

    canvas.setAttribute(
      "aria-label",
      "Mapa histórico de liquidez real"
    );

    stage.appendChild(canvas);

    const legend = el(
      "div",
      "cl-heat-legend"
    );

    legend.append(
      el("span", "", "Menor"),
      el("div", "cl-heat-gradient"),
      el("span", "", "Mayor")
    );

    const info = el(
      "p",
      "cl-map-note",
      "Esperando profundidad real..."
    );

    info.id = "clHeatInfo";

    const note = el(
      "p",
      "cl-map-note",
      "Cada columna corresponde a una consulta " +
      "real del libro de órdenes. Las bandas " +
      "muestran liquidez limitada visible, no " +
      "liquidaciones. Las órdenes pueden " +
      "cancelarse o modificarse."
    );

    map.append(
      heading,
      toolbar,
      stage,
      legend,
      info,
      note
    );

    const article =
      section.querySelector("article") ||
      section;

    let book = $("clOrderbook");

    if (!book) {
      book = el(
        "div",
        "cl-orderbook"
      );

      book.id = "clOrderbook";
      article.appendChild(book);
    }

    book.replaceChildren();

    book.append(
      el(
        "h3",
        "cl-book-title",
        "Libro de órdenes · diez niveles por lado"
      ),
      el(
        "div",
        "cl-book-label cl-sell",
        "VENTAS · ASK"
      ),
      createColumns()
    );

    const asks = el(
      "div",
      "",
      "Esperando órdenes..."
    );

    asks.id = "clAsks";
    book.appendChild(asks);

    const spread = el(
      "div",
      "cl-book-middle",
      "Spread: —"
    );

    spread.id = "clSpread";
    book.appendChild(spread);

    book.append(
      el(
        "div",
        "cl-book-label cl-buy",
        "COMPRAS · BID"
      ),
      createColumns()
    );

    const bids = el(
      "div",
      "",
      "Esperando órdenes..."
    );

    bids.id = "clBids";
    book.appendChild(bids);

    const summary = el(
      "div",
      "cl-book-summary",
      "Esperando profundidad..."
    );

    summary.id = "clBookSummary";
    book.appendChild(summary);

    const toggle = $("liquidityMapToggle");

    if (toggle) {
      toggle.disabled = false;
    }

    const subtitle = document.querySelector(
      "#liquiditySection .section-heading .muted"
    );

    if (subtitle) {
      subtitle.textContent =
        "Mapa histórico · profundidad real";
    }

    return true;
  }

  function parseSide(side) {
    if (!Array.isArray(side)) return [];

    const result = [];

    for (const item of side) {
      if (!item) continue;

      const price = Number(
        Array.isArray(item)
          ? item[0]
          : item.price ?? item.px ?? item.p
      );

      const quantity = Number(
        Array.isArray(item)
          ? item[1]
          : item.quantity ??
            item.qty ??
            item.size ??
            item.sz ??
            item.amount ??
            item.q
      );

      if (
        !Number.isFinite(price) ||
        !Number.isFinite(quantity) ||
        price <= 0 ||
        quantity <= 0
      ) {
        continue;
      }

      result.push({
        price,
        quantity
      });
    }

    return result;
  }

  function normalize(raw) {
    if (
      raw?.code !== undefined &&
      ![0, "0", "00000"].includes(raw.code)
    ) {
      throw new Error(
        "API " + raw.code
      );
    }

    let data = raw;

    for (let i = 0; i < 5; i++) {
      if (
        data?.bids ||
        data?.asks ||
        data?.b ||
        data?.a
      ) {
        break;
      }

      data = data?.data;

      if (Array.isArray(data)) {
        data = data[0];
      }
    }

    const bids = parseSide(
      data?.bids ?? data?.b
    ).sort(
      (a, b) => b.price - a.price
    );

    const asks = parseSide(
      data?.asks ?? data?.a
    ).sort(
      (a, b) => a.price - b.price
    );

    if (!bids.length || !asks.length) {
      throw new Error(
        "Libro de órdenes vacío"
      );
    }

    if (bids[0].price >= asks[0].price) {
      throw new Error(
        "Precios bid/ask inconsistentes"
      );
    }

    return {
      bids: bids.slice(0, CFG.depth),
      asks: asks.slice(0, CFG.depth),
      mid:
        (bids[0].price + asks[0].price) / 2
    };
  }

  function depthURL(s) {
    return (
      "/api/exchange/" +
      encodeURIComponent(s.exchange) +
      "/depth/" +
      encodeURIComponent(s.symbol) +
      "?market=" +
      encodeURIComponent(s.market) +
      "&limit=" +
      CFG.depth
    );
  }

  async function fetchBook(s, signal) {
    const response = await fetch(
      depthURL(s),
      {
        signal,
        cache: "no-store"
      }
    );

    if (!response.ok) {
      throw new Error(
        "HTTP " + response.status
      );
    }

    return normalize(
      await response.json()
    );
  }

  function renderSide(id, side, kind) {
    const root = $(id);

    if (!root) return;

    root.replaceChildren();

    const levels = side.slice(
      0,
      CFG.bookLevels
    );

    const max = Math.max(
      1,
      ...levels.map(
        order =>
          order.price * order.quantity
      )
    );

    levels.forEach(order => {
      const row = el(
        "div",
        "cl-book-row " + kind
      );

      const bar = el(
        "div",
        "cl-book-bar"
      );

      const notional =
        order.price * order.quantity;

      bar.style.width =
        (notional / max * 100) + "%";

      row.append(
        bar,
        el(
          "span",
          "",
          fmtPrice(order.price)
        ),
        el(
          "span",
          "",
          fmt(order.quantity, 4)
        ),
        el(
          "span",
          "",
          fmt(notional, 0)
        )
      );

      root.appendChild(row);
    });
  }

  function totalNotional(orders) {
    return orders.reduce(
      (sum, order) =>
        sum +
        order.price * order.quantity,
      0
    );
  }

  function largestOrder(orders) {
    return orders.reduce(
      (best, order) => {
        if (!best) return order;

        const current =
          order.price * order.quantity;

        const previous =
          best.price * best.quantity;

        return current > previous
          ? order
          : best;
      },
      null
    );
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

    const bid = book.bids[0].price;
    const ask = book.asks[0].price;

    if ($("bid")) {
      $("bid").textContent =
        fmtPrice(bid);
    }

    if ($("ask")) {
      $("ask").textContent =
        fmtPrice(ask);
    }

    const spread = ask - bid;

    const spreadElement = $("clSpread");

    if (spreadElement) {
      spreadElement.textContent =
        "Bid: " +
        fmtPrice(bid) +
        " · Ask: " +
        fmtPrice(ask) +
        " · Spread: " +
        fmtPrice(spread) +
        " (" +
        fmt(spread / book.mid * 100, 4) +
        "%)";
    }

    const buys = book.bids.slice(
      0,
      CFG.bookLevels
    );

    const sells = book.asks.slice(
      0,
      CFG.bookLevels
    );

    const buyTotal =
      totalNotional(buys);

    const sellTotal =
      totalNotional(sells);

    const combined =
      buyTotal + sellTotal;

    const buyPercent = combined
      ? buyTotal / combined * 100
      : 0;

    const sellPercent = combined
      ? sellTotal / combined * 100
      : 0;

    const strongestBuy =
      largestOrder(buys);

    const strongestSell =
      largestOrder(sells);

    const summary = $("clBookSummary");

    if (summary) {
      summary.textContent =
        "Compras visibles: " +
        fmt(buyTotal, 0) +
        " USDT (" +
        fmt(buyPercent, 1) +
        "%). Ventas visibles: " +
        fmt(sellTotal, 0) +
        " USDT (" +
        fmt(sellPercent, 1) +
        "%). Mayor concentración compradora: " +
        fmtPrice(strongestBuy?.price) +
        ". Mayor concentración vendedora: " +
        fmtPrice(strongestSell?.price) +
        ". Datos calculados sobre diez " +
        "niveles por lado. No equivalen " +
        "a probabilidades de rechazo.";
    }
  }

  function capture(book) {
    S.snapshots.push({
      time: Date.now(),
      mid: book.mid,
      bids: book.bids.map(
        order => ({ ...order })
      ),
      asks: book.asks.map(
        order => ({ ...order })
      )
    });

    if (
      S.snapshots.length > S.maxHistory
    ) {
      S.snapshots.splice(
        0,
        S.snapshots.length - S.maxHistory
      );
    }
  }

  function heatColor(value) {
    const x = Math.max(
      0,
      Math.min(
        1,
        value * S.intensity
      )
    );

    if (x < 0.08) return "#1d0936";
    if (x < 0.20) return "#53208b";
    if (x < 0.34) return "#9825c9";
    if (x < 0.49) return "#176fbd";
    if (x < 0.63) return "#15b7cf";
    if (x < 0.76) return "#27d7a3";
    if (x < 0.89) return "#ffe34d";

    return "#ff7919";
  }

  function requestDraw() {
    if (S.frame) return;

    S.frame = requestAnimationFrame(() => {
      S.frame = 0;
      draw();
    });
  }

  function draw() {
    const canvas = $("clHeatmap");

    if (!canvas) return;

    const rect =
      canvas.getBoundingClientRect();

    const w = rect.width;
    const h = rect.height;

    if (w < 50 || h < 50) return;

    const dpr = Math.min(
      window.devicePixelRatio || 1,
      2
    );

    const pixelWidth =
      Math.round(w * dpr);

    const pixelHeight =
      Math.round(h * dpr);

    if (
      canvas.width !== pixelWidth ||
      canvas.height !== pixelHeight
    ) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
    }

    const ctx =
      canvas.getContext("2d");

    if (!ctx) return;

    ctx.setTransform(
      dpr,
      0,
      0,
      dpr,
      0,
      0
    );

    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, w, h);

    const snaps = S.snapshots;

    if (!snaps.length) {
      ctx.fillStyle = C.muted;
      ctx.font = "12px system-ui";
      ctx.textAlign = "center";

      ctx.fillText(
        "Esperando profundidad real...",
        w / 2,
        h / 2
      );

      return;
    }

    const left = 5;
    const axis = Math.min(
      75,
      w * 0.22
    );

    const profileWidth =
      S.showProfile
        ? Math.min(85, w * 0.23)
        : 0;

    const gap =
      S.showProfile ? 7 : 0;

    const right =
      w - axis - profileWidth - gap;

    const top = 14;
    const bottom = h - 28;

    const plotW = right - left;
    const plotH = bottom - top;

    if (
      plotW < 20 ||
      plotH < 20
    ) {
      return;
    }

    const last =
      snaps[snaps.length - 1];

    /*
     Determinar el rango de precios
     usando los niveles reales
     registrados.
    */

    let observedMin = Infinity;
    let observedMax = -Infinity;

    let pathMin = Infinity;
    let pathMax = -Infinity;

    for (const snap of snaps) {
      observedMin = Math.min(
        observedMin,
        snap.mid
      );

      observedMax = Math.max(
        observedMax,
        snap.mid
      );

      pathMin = Math.min(
        pathMin,
        snap.mid
      );

      pathMax = Math.max(
        pathMax,
        snap.mid
      );

      for (const order of snap.bids) {
        observedMin = Math.min(
          observedMin,
          order.price
        );

        observedMax = Math.max(
          observedMax,
          order.price
        );
      }

      for (const order of snap.asks) {
        observedMin = Math.min(
          observedMin,
          order.price
        );

        observedMax = Math.max(
          observedMax,
          order.price
        );
      }
    }

    if (
      !Number.isFinite(observedMin) ||
      !Number.isFinite(observedMax)
    ) {
      return;
    }

    const fullRange = Math.max(
      observedMax - observedMin,
      last.mid * 0.00005
    );

    let half =
      fullRange * 0.54 / S.zoom;

    let center = last.mid;

    /*
     El zoom modifica la escala
     vertical. La trayectoria puede
     quedar parcialmente fuera del
     área al ampliar, como corresponde.
    */

    const min = Math.max(
      Number.EPSILON,
      center - half
    );

    const max =
      center + half;

    const range = max - min;

    if (range <= 0) return;

    const bins = S.bins;
    const cellH = plotH / bins;
    const colW = plotW / snaps.length;

    const yPrice = price =>
      bottom -
      (price - min) / range * plotH;

    const matrices = [];
    const nonzero = [];

    for (const snap of snaps) {
      const column =
        new Float64Array(bins);

      for (const orders of [
        snap.bids,
        snap.asks
      ]) {
        for (const order of orders) {
          const index = Math.floor(
            (order.price - min) /
            range * bins
          );

          if (
            index < 0 ||
            index >= bins
          ) {
            continue;
          }

          column[index] +=
            order.price * order.quantity;
        }
      }

      for (const value of column) {
        if (value > 0) {
          nonzero.push(value);
        }
      }

      matrices.push(column);
    }

    nonzero.sort(
      (a, b) => a - b
    );

    const reference = nonzero.length
      ? Math.max(
          1,
          nonzero[
            Math.floor(
              (nonzero.length - 1) * 0.95
            )
          ]
        )
      : 1;

    const logReference =
      Math.log1p(reference);

    function strength(value) {
      if (value <= 0) return 0;

      return Math.min(
        1,
        Math.log1p(value) /
        logReference
      );
    }

    /*
     Cuadrícula horizontal.
    */

    ctx.strokeStyle =
      "rgba(160,170,220,.13)";

    ctx.lineWidth = 1;

    for (let i = 0; i <= 6; i++) {
      const y =
        top + i * plotH / 6;

      ctx.beginPath();
      ctx.moveTo(left, y);
      ctx.lineTo(right, y);
      ctx.stroke();
    }

    /*
     Bandas de calor.
     Cada columna procede de
     una muestra real.
    */

    if (S.showMap) {
      matrices.forEach(
        (column, columnIndex) => {
          const x =
            left + columnIndex * colW;

          for (
            let row = 0;
            row < bins;
            row++
          ) {
            const value =
              column[row];

            if (value <= 0) continue;

            const y =
              bottom -
              (row + 1) * cellH;

            ctx.fillStyle = heatColor(
              strength(value)
            );

            ctx.fillRect(
              x,
              y,
              Math.ceil(colW + 0.4),
              Math.max(1, cellH + 0.4)
            );
          }
        }
      );
    }

    /*
     Perfil lateral:
     solamente órdenes visibles
     en la última muestra.
    */

    if (S.showProfile) {
      const buys =
        new Float64Array(bins);

      const sells =
        new Float64Array(bins);

      for (const [
        orders,
        target
      ] of [
        [last.bids, buys],
        [last.asks, sells]
      ]) {
        for (const order of orders) {
          const index = Math.floor(
            (order.price - min) /
            range * bins
          );

          if (
            index < 0 ||
            index >= bins
          ) {
            continue;
          }

          target[index] +=
            order.price * order.quantity;
        }
      }

      let peak = 1;

      for (let i = 0; i < bins; i++) {
        peak = Math.max(
          peak,
          buys[i] + sells[i]
        );
      }

      const x0 = right + gap;

      const scale =
        Math.max(0, profileWidth - 4) /
        peak;

      for (let i = 0; i < bins; i++) {
        const y =
          bottom -
          (i + 1) * cellH;

        const buyWidth =
          buys[i] * scale;

        const sellWidth =
          sells[i] * scale;

        ctx.fillStyle = C.green;

        ctx.fillRect(
          x0,
          y,
          buyWidth,
          Math.max(1, cellH)
        );

        ctx.fillStyle = C.red;

        ctx.fillRect(
          x0 + buyWidth,
          y,
          sellWidth,
          Math.max(1, cellH)
        );
      }
    }

    /*
     Trayectoria blanca del precio.
     Se utiliza el precio medio
     bid/ask de cada snapshot.
    */

    if (S.showPrice) {
      ctx.save();

      ctx.beginPath();
      ctx.rect(
        left,
        top,
        plotW,
        plotH
      );
      ctx.clip();

      ctx.beginPath();

      snaps.forEach((snap, i) => {
        const x =
          left + (i + 0.5) * colW;

        const y =
          yPrice(snap.mid);

        if (i === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      });

      ctx.strokeStyle =
        "rgba(0,0,0,.85)";
      ctx.lineWidth = 3.5;
      ctx.stroke();

      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 1.6;
      ctx.stroke();

      ctx.restore();
    }

    /*
     Línea del precio actual.
    */

    const py =
      yPrice(last.mid);

    if (py >= top && py <= bottom) {
      ctx.beginPath();
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = C.blue;
      ctx.lineWidth = 1;

      ctx.moveTo(left, py);
      ctx.lineTo(right, py);
      ctx.stroke();

      ctx.setLineDash([]);
    }

    /*
     Escala lateral de precios.
    */

    ctx.font = "10px system-ui";
    ctx.textAlign = "left";
    ctx.fillStyle = "#aab7d4";

    for (let i = 0; i <= 6; i++) {
      const price =
        max - i * range / 6;

      const y =
        top + i * plotH / 6;

      ctx.fillText(
        fmtPrice(price),
        w - axis + 3,
        Math.max(
          11,
          Math.min(h - 20, y + 3)
        )
      );
    }

    if (py >= top && py <= bottom) {
      ctx.fillStyle = C.blue;

      ctx.fillText(
        fmtPrice(last.mid),
        w - axis + 3,
        Math.max(
          12,
          Math.min(h - 20, py - 7)
        )
      );
    }

    /*
     Eje temporal:
     tiempos reales de consulta.
    */

    const first = snaps[0];

    const timeText = time =>
      new Date(time).toLocaleTimeString(
        "es-MX",
        {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit"
        }
      );

    ctx.fillStyle = "#aab7d4";
    ctx.font = "10px system-ui";

    ctx.textAlign = "left";

    ctx.fillText(
      timeText(first.time),
      left,
      h - 9
    );

    ctx.textAlign = "right";

    ctx.fillText(
      timeText(last.time),
      right,
      h - 9
    );

    const info = $("clHeatInfo");

    if (info) {
      info.textContent =
        selection().symbol +
        " · " +
        snaps.length +
        " muestras reales · " +
        timeText(first.time) +
        " a " +
        timeText(last.time) +
        " · Precio medio: " +
        fmtPrice(last.mid) +
        " · Profundidad: " +
        last.bids.length +
        " compras / " +
        last.asks.length +
        " ventas";
    }
  }

  function reset() {
    S.snapshots = [];
    S.lastBook = null;
    S.lastUpdated = 0;
    S.lastError = "";

    if ($("clAsks")) {
      $("clAsks").textContent =
        "Esperando órdenes...";
    }

    if ($("clBids")) {
      $("clBids").textContent =
        "Esperando órdenes...";
    }

    if ($("clSpread")) {
      $("clSpread").textContent =
        "Spread: —";
    }

    if ($("clBookSummary")) {
      $("clBookSummary").textContent =
        "Esperando profundidad...";
    }

    if ($("clHeatInfo")) {
      $("clHeatInfo").textContent =
        "Esperando muestras reales...";
    }

    requestDraw();
  }

  function abortRequest() {
    if (S.controller) {
      S.controller.abort();
      S.controller = null;
    }
  }

  async function refresh() {
    if (
      !S.running ||
      document.hidden
    ) {
      return;
    }

    if (S.busy) {
      S.pendingRefresh = true;
      return;
    }

    const selected = selection();
    const currentKey =
      marketKey(selected);

    if (currentKey !== S.key) {
      S.key = currentKey;
      S.generation++;
      reset();
    }

    const generation =
      S.generation;

    const controller =
      new AbortController();

    S.controller = controller;
    S.busy = true;

    let timeout = null;

    try {
      status(
        "Consultando " +
        selected.exchange.toUpperCase(),
        C.yellow
      );

      timeout = setTimeout(
        () => controller.abort(),
        CFG.timeout
      );

      const book = await fetchBook(
        selected,
        controller.signal
      );

      if (
        !S.running ||
        generation !== S.generation ||
        currentKey !== marketKey() ||
        controller.signal.aborted
      ) {
        return;
      }

      S.lastBook = book;
      S.lastUpdated = Date.now();
      S.lastError = "";

      capture(book);
      renderBook(book);
      requestDraw();

      status(
        selected.exchange.toUpperCase() +
        " · " +
        new Date(
          S.lastUpdated
        ).toLocaleTimeString("es-MX"),
        C.green
      );

    } catch (error) {
      if (
        generation !== S.generation ||
        !S.running
      ) {
        return;
      }

      const message =
        controller.signal.aborted
          ? "Tiempo de espera agotado"
          : error.message;

      S.lastError = message;

      console.warn(
        "CRYPTOLEXUZ Liquidez:",
        error
      );

      status(
        "Sin profundidad · " + message,
        C.red
      );

      if (
        !S.lastBook &&
        $("clBookSummary")
      ) {
        $("clBookSummary").textContent =
          "No se pudo consultar el libro. " +
          "Verifica el proxy y la conexión.";
      }

    } finally {
      if (timeout !== null) {
        clearTimeout(timeout);
      }

      if (S.controller === controller) {
        S.controller = null;
      }

      S.busy = false;

      if (
        S.pendingRefresh &&
        S.running &&
        !document.hidden
      ) {
        S.pendingRefresh = false;

        /*
         Permite terminar la petición
         anterior antes de iniciar
         la nueva.
        */

        queueMicrotask(() => {
          if (S.running) {
            refresh();
          }
        });
      }
    }
  }

  function start() {
    if (S.running) return;

    S.running = true;
    S.key = marketKey();

    status(
      "Conectando...",
      C.yellow
    );

    refresh();

    S.timer = setInterval(
      refresh,
      CFG.refresh
    );
  }

  function stop() {
    S.running = false;
    S.generation++;
    S.pendingRefresh = false;

    if (S.timer) {
      clearInterval(S.timer);
      S.timer = null;
    }

    abortRequest();

    status(
      "Mapa detenido",
      C.muted
    );
  }

  function restart() {
    S.generation++;
    S.key = marketKey();

    abortRequest();
    reset();

    if (S.running) {
      S.pendingRefresh = true;

      if (!S.busy) {
        S.pendingRefresh = false;
        refresh();
      }
    }
  }

  function setZoom(value) {
    const next = Number(value);

    if (!Number.isFinite(next)) {
      return;
    }

    S.zoom = Math.max(
      0.5,
      Math.min(6, next)
    );

    requestDraw();
  }

  function events() {
    $("clHeatEnabled")?.addEventListener(
      "change",
      event => {
        S.showMap =
          event.target.checked;

        requestDraw();
      }
    );

    $("clHeatPrice")?.addEventListener(
      "change",
      event => {
        S.showPrice =
          event.target.checked;

        requestDraw();
      }
    );

    $("clHeatProfile")?.addEventListener(
      "change",
      event => {
        S.showProfile =
          event.target.checked;

        requestDraw();
      }
    );

    $("clHeatIntensity")?.addEventListener(
      "input",
      event => {
        S.intensity =
          Number(event.target.value) || 1;

        requestDraw();
      }
    );

    $("clHeatHistory")?.addEventListener(
      "change",
      event => {
        const next =
          Number(event.target.value);

        S.maxHistory = Math.max(
          1,
          Math.min(
            CFG.maxSnapshots,
            next || 180
          )
        );

        S.snapshots =
          S.snapshots.slice(-S.maxHistory);

        requestDraw();
      }
    );

    $("clHeatBins")?.addEventListener(
      "change",
      event => {
        const next =
          Number(event.target.value);

        S.bins = Math.max(
          20,
          Math.min(200, next || 100)
        );

        requestDraw();
      }
    );

    $("clHeatResetZoom")?.addEventListener(
      "click",
      () => setZoom(1)
    );

    $("liquidityMapToggle")?.addEventListener(
      "change",
      event => {
        if (event.target.checked) {
          start();
        } else {
          stop();
        }
      }
    );

    for (const id of [
      "exchange",
      "symbol",
      "market"
    ]) {
      $(id)?.addEventListener(
        "change",
        restart
      );
    }

    const canvas = $("clHeatmap");

    if (canvas) {
      canvas.addEventListener(
        "wheel",
        event => {
          event.preventDefault();

          setZoom(
            S.zoom *
            (event.deltaY < 0
              ? 1.12
              : 0.89)
          );
        },
        { passive: false }
      );

      canvas.addEventListener(
        "touchstart",
        event => {
          if (event.touches.length !== 2) {
            S.pinchDistance = 0;
            return;
          }

          S.pinchDistance = Math.hypot(
            event.touches[0].clientX -
            event.touches[1].clientX,
            event.touches[0].clientY -
            event.touches[1].clientY
          );
        },
        { passive: true }
      );

      canvas.addEventListener(
        "touchmove",
        event => {
          if (
            event.touches.length !== 2 ||
            S.pinchDistance <= 0
          ) {
            return;
          }

          event.preventDefault();

          const distance = Math.hypot(
            event.touches[0].clientX -
            event.touches[1].clientX,
            event.touches[0].clientY -
            event.touches[1].clientY
          );

          if (distance > 0) {
            setZoom(
              S.zoom *
              distance / S.pinchDistance
            );

            S.pinchDistance = distance;
          }
        },
        { passive: false }
      );

      function finishPinch() {
        S.pinchDistance = 0;
      }

      canvas.addEventListener(
        "touchend",
        finishPinch
      );

      canvas.addEventListener(
        "touchcancel",
        finishPinch
      );

      if (window.ResizeObserver) {
        S.observer = new ResizeObserver(
          requestDraw
        );

        S.observer.observe(canvas);
      }
    }

    document.addEventListener(
      "visibilitychange",
      () => {
        if (
          !document.hidden &&
          S.running
        ) {
          refresh();
          requestDraw();
        }
      }
    );

    window.addEventListener(
      "resize",
      requestDraw
    );

    window.addEventListener(
      "cryptolexuz:screen-change",
      requestDraw
    );

    window.addEventListener(
      "beforeunload",
      () => {
        stop();
        S.observer?.disconnect();
      }
    );
  }

  function init() {
    if (S.initialized) return;

    if (!build()) {
      console.warn(
        "Liquidity V13: inicialización pendiente"
      );
      return;
    }

    S.initialized = true;

    events();
    reset();

    const toggle =
      $("liquidityMapToggle");

    if (!toggle || toggle.checked) {
      start();
    } else {
      status("Mapa detenido");
    }

    console.info(
      "CRYPTOLEXUZ PRO — Liquidity V13 cargado"
    );
  }

  window.CryptolexuzLiquidity = {
    version: "13",

    start,
    stop,
    restart,
    refresh,
    redraw: requestDraw,

    isRunning: () => S.running,

    getSelection: selection,

    getBook: () =>
      S.lastBook
        ? JSON.parse(
            JSON.stringify(S.lastBook)
          )
        : null,

    getSnapshots: () =>
      JSON.parse(
        JSON.stringify(S.snapshots)
      ),

    getStatus: () => ({
      running: S.running,
      busy: S.busy,
      market: S.key,
      samples: S.snapshots.length,
      lastUpdated: S.lastUpdated,
      lastError: S.lastError
    }),

    setZoom
  };

  if (document.readyState === "loading") {
    document.addEventListener(
      "DOMContentLoaded",
      init,
      { once: true }
    );
  } else {
    init();
  }
})();
