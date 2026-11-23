
/*
 CRYPTOLEXUZ PRO — LIQUIDITY.JS V12
 MAPA DE CALOR ESTILO BOOKMAP

 Conserva:
 - BingX / OKX
 - Libro de órdenes Top 10
 - Spread, bid, ask y resumen
 - Interruptor original
 - Historial de profundidad real

 Mejora:
 - Bandas horizontales de liquidez
 - Trayectoria blanca del precio
 - Perfil lateral
 - Escala de precios
 - Diseño móvil panorámico
 - Intensidad, detalle e historial
 - Zoom vertical táctil
 - Sin datos simulados
*/
"use strict";

(() => {
  if (window.__CL_LIQUIDITY_V12__) return;
  window.__CL_LIQUIDITY_V12__ = true;

  const $ = id => document.getElementById(id);

  const CFG = {
    refresh: 2500,
    timeout: 10000,
    depth: 200,
    bookLevels: 10,
    maxSnapshots: 300
  };

  const C = {
    bg: "#050713",
    green: "#00f5a0",
    red: "#ff476c",
    blue: "#36c5ff",
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
    dragging: false,
    touchY: 0,
    observer: null
  };

  function el(tag, cls = "", text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  function fmt(value, digits = 2) {
    const n = Number(value);
    if (!Number.isFinite(n)) return "—";
    return n.toLocaleString("en-US", {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits
    });
  }

  function commodity(symbol) {
    return [
      "NCCOGOLD2USD-USDT",
      "NCCO1OILWTI2USD-USDT"
    ].includes(symbol);
  }

  function selection() {
    const symbol =
      $("symbol")?.value || "BTC-USDT";

    return {
      symbol,
      exchange: commodity(symbol)
        ? "bingx"
        : $("exchange")?.value || "bingx",
      market: commodity(symbol)
        ? "perpetual"
        : $("market")?.value || "perpetual"
    };
  }

  function key(s) {
    return [
      s.exchange,
      s.market,
      s.symbol
    ].join("|");
  }

  function status(text, color = C.muted) {
    const n = $("clMapStatus");
    if (!n) return;
    n.textContent = text;
    n.style.color = color;
  }

  function styles() {
    if ($("clLiquidityStyles")) {
      $("clLiquidityStyles").remove();
    }

    const css = el("style");
    css.id = "clLiquidityStyles";

    css.textContent = `
      .cl-liquidity-map {
        width:100%;
        min-width:0;
        box-sizing:border-box;
        background:#070b19;
        border:1px solid #34416b;
        border-radius:14px;
        padding:10px;
        color:#e9efff;
        overflow:hidden;
      }

      .cl-map-heading {
        display:flex;
        justify-content:space-between;
        align-items:center;
        flex-wrap:wrap;
        gap:8px;
        margin-bottom:10px;
        font-size:13px;
      }

      .cl-muted {
        font-size:11px;
        color:#9ba9c9;
      }

      .cl-heat-toolbar {
        display:flex;
        flex-wrap:wrap;
        align-items:center;
        gap:9px;
        margin-bottom:10px;
        font-size:11px;
      }

      .cl-heat-toolbar label {
        display:flex;
        align-items:center;
        gap:4px;
      }

      .cl-heat-toolbar select,
      .cl-heat-toolbar button {
        background:#192442;
        border:1px solid #45557e;
        border-radius:7px;
        color:#e7eeff;
        padding:6px;
        font-size:11px;
      }

      .cl-heat-toolbar input[type=range] {
        width:80px;
        accent-color:#bb52ff;
      }

      .cl-heat-stage {
        position:relative;
        width:100%;
        height:440px;
        overflow:hidden;
        border-radius:9px;
        background:#050713;
        border:1px solid #202b4b;
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
        color:#9ba9c9;
        font-size:11px;
        line-height:1.6;
        margin:9px 0;
      }

      .cl-orderbook {
        margin-top:15px;
        padding-top:12px;
        border-top:1px solid #34416b;
      }

      .cl-book-title {
        margin:0 0 10px;
        font-size:13px;
        color:#f5f7ff;
      }

      .cl-book-label {
        margin:12px 0 7px;
        font-size:11px;
        font-weight:800;
      }

      .cl-sell {color:#ff476c}
      .cl-buy {color:#00f5a0}

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
        border-radius:5px;
        margin-bottom:3px;
      }

      .cl-book-row > span {
        position:relative;
        z-index:1;
      }

      .cl-book-bar {
        position:absolute;
        inset:0 auto 0 0;
        opacity:.23;
        z-index:0;
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
        border-radius:8px;
        background:#101831;
        color:#cbd5f2;
        font-size:11px;
        line-height:1.8;
      }

      @media(min-width:700px) {
        .cl-heat-stage {
          height:560px;
        }
      }
    `;

    document.head.append(css);
  }

  function createColumns() {
    const n = el("div", "cl-book-columns");

    ["Precio", "Cantidad", "USDT"].forEach(
      text => n.append(el("span", "", text))
    );

    return n;
  }

  function build() {
    const map = $("liquidityMap");
    const section = $("orderbookSection");

    if (!map || !section) {
      console.warn(
        "CRYPTOLEXUZ: faltan contenedores de liquidez"
      );
      return false;
    }

    styles();

    map.className = "cl-liquidity-map";
    map.replaceChildren();

    const heading = el("div", "cl-map-heading");
    heading.append(
      el("strong", "", "Mapa de calor · Liquidez")
    );

    const stateLabel = el(
      "span", "cl-muted", "Conectando..."
    );
    stateLabel.id = "clMapStatus";
    heading.append(stateLabel);

    const toolbar = el("div", "cl-heat-toolbar");

    function check(id, text, checked) {
      const label = el("label");
      const input = el("input");
      input.type = "checkbox";
      input.id = id;
      input.checked = checked;
      label.append(input, el("span", "", text));
      toolbar.append(label);
      return input;
    }

    check("clHeatEnabled", "Calor", true);
    check("clHeatPrice", "Precio", true);
    check("clHeatProfile", "Perfil", true);

    const intensityLabel = el("label");
    intensityLabel.append(
      el("span", "", "Intensidad")
    );

    const intensity = el("input");
    intensity.type = "range";
    intensity.id = "clHeatIntensity";
    intensity.min = "0.5";
    intensity.max = "2.5";
    intensity.step = "0.25";
    intensity.value = "1";

    intensityLabel.append(intensity);
    toolbar.append(intensityLabel);

    function select(id, label, values, current) {
      const wrap = el("label");
      wrap.append(el("span", "", label));

      const input = el("select");
      input.id = id;

      values.forEach(value => {
        const option = el(
          "option", "", String(value)
        );
        option.value = value;
        option.selected = value === current;
        input.append(option);
      });

      wrap.append(input);
      toolbar.append(wrap);
      return input;
    }

    select(
      "clHeatHistory",
      "Historial",
      [60, 120, 180, 300],
      180
    );

    select(
      "clHeatBins",
      "Detalle",
      [60, 80, 100, 140],
      100
    );

    const resetZoom = el(
      "button", "", "Restablecer zoom"
    );
    resetZoom.type = "button";
    resetZoom.id = "clHeatResetZoom";
    toolbar.append(resetZoom);

    const stage = el("div", "cl-heat-stage");

    const canvas = el("canvas");
    canvas.id = "clHeatmap";
    canvas.setAttribute(
      "aria-label",
      "Mapa histórico de liquidez visible"
    );

    stage.append(canvas);

    const legend = el("div", "cl-heat-legend");
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
      "Las franjas representan órdenes limitadas " +
      "visibles registradas durante esta sesión. " +
      "No representan liquidaciones ni garantizan " +
      "que el precio vaya a rebotar."
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
      section.querySelector("article") || section;

    let book = $("clOrderbook");

    if (!book) {
      book = el("div", "cl-orderbook");
      book.id = "clOrderbook";
      article.append(book);
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
      "div", "", "Esperando órdenes..."
    );
    asks.id = "clAsks";
    book.append(asks);

    const spread = el(
      "div",
      "cl-book-middle",
      "Spread: —"
    );
    spread.id = "clSpread";
    book.append(spread);

    book.append(
      el(
        "div",
        "cl-book-label cl-buy",
        "COMPRAS · BID"
      ),
      createColumns()
    );

    const bids = el(
      "div", "", "Esperando órdenes..."
    );
    bids.id = "clBids";
    book.append(bids);

    const summary = el(
      "div",
      "cl-book-summary",
      "Esperando profundidad..."
    );
    summary.id = "clBookSummary";
    book.append(summary);

    const outer = $("liquidityMapToggle");
    if (outer) {
      outer.disabled = false;
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

    return side.map(x => {
      const price = Number(
        Array.isArray(x)
          ? x[0]
          : x.price ?? x.px ?? x.p
      );

      const quantity = Number(
        Array.isArray(x)
          ? x[1]
          : x.quantity ??
            x.qty ??
            x.size ??
            x.sz ??
            x.amount ??
            x.q
      );

      return { price, quantity };
    }).filter(x =>
      Number.isFinite(x.price) &&
      Number.isFinite(x.quantity) &&
      x.price > 0 &&
      x.quantity > 0
    );
  }

  function normalize(raw) {
    if (
      raw?.code !== undefined &&
      ![0, "0"].includes(raw.code)
    ) {
      throw Error("API " + raw.code);
    }

    let d = raw;

    for (let i = 0; i < 4; i++) {
      if (
        d?.bids || d?.asks ||
        d?.b || d?.a
      ) break;

      d = d?.data;
      if (Array.isArray(d)) d = d[0];
    }

    const bids = parseSide(
      d?.bids ?? d?.b
    ).sort((a, b) => b.price - a.price);

    const asks = parseSide(
      d?.asks ?? d?.a
    ).sort((a, b) => a.price - b.price);

    if (
      !bids.length ||
      !asks.length ||
      bids[0].price >= asks[0].price
    ) {
      throw Error(
        "Libro de órdenes vacío o inconsistente"
      );
    }

    return {
      bids: bids.slice(0, CFG.depth),
      asks: asks.slice(0, CFG.depth),
      mid: (
        bids[0].price + asks[0].price
      ) / 2
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
      "&limit=" + CFG.depth
    );
  }

  async function fetchBook(s) {
    const controller = new AbortController();
    S.controller = controller;

    const timeout = setTimeout(
      () => controller.abort(),
      CFG.timeout
    );

    try {
      const response = await fetch(
        depthURL(s),
        {
          signal: controller.signal,
          cache: "no-store"
        }
      );

      if (!response.ok) {
        throw Error(
          "HTTP " + response.status
        );
      }

      return normalize(
        await response.json()
      );

    } finally {
      clearTimeout(timeout);

      if (S.controller === controller) {
        S.controller = null;
      }
    }
  }

  function renderSide(id, side, kind) {
    const root = $(id);
    if (!root) return;

    root.replaceChildren();

    const levels = side.slice(
      0, CFG.bookLevels
    );

    const max = Math.max(
      1,
      ...levels.map(
        x => x.price * x.quantity
      )
    );

    levels.forEach(x => {
      const row = el(
        "div",
        "cl-book-row " + kind
      );

      const bar = el("div", "cl-book-bar");

      bar.style.width =
        (x.price * x.quantity / max * 100) +
        "%";

      row.append(
        bar,
        el("span", "", fmt(x.price)),
        el("span", "", fmt(x.quantity, 4)),
        el(
          "span",
          "",
          fmt(x.price * x.quantity, 0)
        )
      );

      root.append(row);
    });
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
      $("bid").textContent = fmt(bid);
    }

    if ($("ask")) {
      $("ask").textContent = fmt(ask);
    }

    const spread = $("clSpread");

    if (spread) {
      spread.textContent =
        "Spread: " +
        fmt(ask - bid, 4) +
        " USDT · " +
        fmt((ask - bid) / ask * 100, 4) +
        "%";
    }

    const buys = book.bids.slice(0, 10);
    const sells = book.asks.slice(0, 10);

    const total = arr => arr.reduce(
      (sum, x) =>
        sum + x.price * x.quantity,
      0
    );

    const buyTotal = total(buys);
    const sellTotal = total(sells);

    const largest = arr => arr.reduce(
      (best, x) =>
        !best ||
        x.price * x.quantity >
        best.price * best.quantity
          ? x
          : best,
      null
    );

    const summary = $("clBookSummary");

    if (summary) {
      summary.textContent =
        "Compras visibles: " +
        fmt(buyTotal, 0) +
        " USDT · Ventas visibles: " +
        fmt(sellTotal, 0) +
        " USDT · Ratio: " +
        (sellTotal
          ? fmt(buyTotal / sellTotal)
          : "—") +
        " · Mayor compra: " +
        fmt(largest(buys)?.price) +
        " · Mayor venta: " +
        fmt(largest(sells)?.price) +
        ". Cálculos sobre diez niveles por lado.";
    }
  }

  function capture(book) {
    S.snapshots.push({
      time: Date.now(),
      mid: book.mid,
      bids: book.bids.map(x => ({ ...x })),
      asks: book.asks.map(x => ({ ...x }))
    });

    if (S.snapshots.length > S.maxHistory) {
      S.snapshots.splice(
        0,
        S.snapshots.length - S.maxHistory
      );
    }
  }

  function heatColor(v) {
    const x = Math.max(
      0,
      Math.min(1, v * S.intensity)
    );

    if (x < .08) return "#1d0936";
    if (x < .20) return "#53208b";
    if (x < .34) return "#9825c9";
    if (x < .49) return "#176fbd";
    if (x < .63) return "#15b7cf";
    if (x < .76) return "#27d7a3";
    if (x < .89) return "#ffe34d";

    return "#ff7919";
  }

  function draw() {
    const canvas = $("clHeatmap");
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();

    if (
      rect.width < 50 ||
      rect.height < 50
    ) return;

    const dpr = Math.min(
      window.devicePixelRatio || 1,
      2
    );

    const w = rect.width;
    const h = rect.height;

    const cw = Math.round(w * dpr);
    const ch = Math.round(h * dpr);

    if (
      canvas.width !== cw ||
      canvas.height !== ch
    ) {
      canvas.width = cw;
      canvas.height = ch;
    }

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, w, h);

    const snaps = S.snapshots;

    if (!snaps.length) {
      ctx.fillStyle = C.muted;
      ctx.font = "12px system-ui";
      ctx.textAlign = "center";

      ctx.fillText(
        "Esperando datos reales...",
        w / 2,
        h / 2
      );
      return;
    }

    const left = 5;
    const axis = Math.min(69, w * .19);
    const profile = S.showProfile
      ? Math.min(85, w * .23)
      : 0;

    const gap = S.showProfile ? 7 : 0;

    const right = w - axis - profile - gap;
    const top = 14;
    const bottom = h - 28;

    const plotW = right - left;
    const plotH = bottom - top;

    if (plotW < 20 || plotH < 20) return;

    /*
     Escala centrada en el último precio.
     Se utiliza la profundidad realmente
     observada, con zoom vertical.
    */
    const allPrices = [];

    snaps.forEach(s => {
      allPrices.push(s.mid);

      s.bids.forEach(x =>
        allPrices.push(x.price)
      );

      s.asks.forEach(x =>
        allPrices.push(x.price)
      );
    });

    let min = Math.min(...allPrices);
    let max = Math.max(...allPrices);

    const last = snaps[snaps.length - 1];

    const fullRange = Math.max(
      max - min,
      last.mid * .00005
    );

    const center = last.mid;

    const half = (
      fullRange * 1.08 / S.zoom
    ) / 2;

    min = center - half;
    max = center + half;

    /*
     Garantizar que la trayectoria
     registrada permanezca dentro
     de la escala, cuando sea posible.
    */
    const pathMin = Math.min(
      ...snaps.map(s => s.mid)
    );

    const pathMax = Math.max(
      ...snaps.map(s => s.mid)
    );

    if (pathMin < min || pathMax > max) {
      const pathCenter =
        (pathMin + pathMax) / 2;

      const pathHalf = Math.max(
        half,
        (pathMax - pathMin) * .55
      );

      min = pathCenter - pathHalf;
      max = pathCenter + pathHalf;
    }

    const range = max - min;
    const bins = S.bins;
    const cellH = plotH / bins;

    const yPrice = price =>
      bottom -
      (price - min) / range * plotH;

    /*
     Cada columna representa una
     muestra real. Se distribuyen
     sobre el ancho disponible.
     No se inventan muestras pasadas.
    */
    const colW = plotW / snaps.length;

    const matrices = [];
    const profileBid = Array(bins).fill(0);
    const profileAsk = Array(bins).fill(0);

    const nonzero = [];

    snaps.forEach(s => {
      const bids = Array(bins).fill(0);
      const asks = Array(bins).fill(0);

      for (const [levels, target, prof] of [
        [s.bids, bids, profileBid],
        [s.asks, asks, profileAsk]
      ]) {
        levels.forEach(order => {
          const idx = Math.floor(
            (order.price - min) /
            range * bins
          );

          if (idx < 0 || idx >= bins) {
            return;
          }

          const notional =
            order.price * order.quantity;

          target[idx] += notional;
          prof[idx] += notional;
        });
      }

      const combined = bids.map(
        (value, i) => value + asks[i]
      );

      combined.forEach(value => {
        if (value > 0) nonzero.push(value);
      });

      matrices.push(combined);
    });

    nonzero.sort((a, b) => a - b);

    const reference = nonzero.length
      ? Math.max(
          1,
          nonzero[
            Math.floor(
              (nonzero.length - 1) * .95
            )
          ]
        )
      : 1;

    const strength = value =>
      value > 0
        ? Math.min(
            1,
            Math.log1p(value) /
            Math.log1p(reference)
          )
        : 0;

    /*
     Cuadrícula de precios.
    */
    ctx.strokeStyle =
      "rgba(160,170,220,.13)";
    ctx.lineWidth = 1;

    for (let i = 0; i <= 6; i++) {
      const y = top + i * plotH / 6;

      ctx.beginPath();
      ctx.moveTo(left, y);
      ctx.lineTo(right, y);
      ctx.stroke();
    }

    /*
     Bandas horizontales de calor.

     Las franjas mantienen el mismo
     nivel de precio entre muestras
     consecutivas cuando existe
     liquidez observada en ese nivel.
    */
    if (S.showMap) {
      matrices.forEach((column, x) => {
        const px = left + x * colW;

        for (let row = 0; row < bins; row++) {
          const value = column[row];
          if (value <= 0) continue;

          const py =
            bottom - (row + 1) * cellH;

          ctx.fillStyle = heatColor(
            strength(value)
          );

          ctx.fillRect(
            px,
            py,
            Math.ceil(colW + .4),
            Math.max(1, cellH + .4)
          );
        }
      });
    }

    /*
     Perfil lateral.
     Se calcula con la última muestra,
     para mostrar la liquidez visible
     actual y no sumar repetidamente
     las mismas órdenes históricas.
    */
    if (S.showProfile) {
      const pb = Array(bins).fill(0);
      const pa = Array(bins).fill(0);

      for (const [orders, target] of [
        [last.bids, pb],
        [last.asks, pa]
      ]) {
        orders.forEach(order => {
          const idx = Math.floor(
            (order.price - min) /
            range * bins
          );

          if (idx >= 0 && idx < bins) {
            target[idx] +=
              order.price * order.quantity;
          }
        });
      }

      const peak = Math.max(
        1,
        ...pb.map((v, i) => v + pa[i])
      );

      const x0 = right + gap;

      for (let i = 0; i < bins; i++) {
        const y =
          bottom - (i + 1) * cellH;

        const scale =
          (profile - 4) / peak;

        const bw = pb[i] * scale;
        const aw = pa[i] * scale;

        ctx.fillStyle = C.green;
        ctx.fillRect(
          x0,
          y,
          bw,
          Math.max(1, cellH)
        );

        ctx.fillStyle = C.red;
        ctx.fillRect(
          x0 + bw,
          y,
          aw,
          Math.max(1, cellH)
        );
      }
    }

    /*
     Trayectoria del precio.
     Por ahora usa el precio medio
     bid/ask registrado en cada
     snapshot real del libro.
    */
    if (S.showPrice) {
      ctx.beginPath();

      snaps.forEach((s, i) => {
        const x =
          left + (i + .5) * colW;

        const y = yPrice(s.mid);

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
    }

    /*
     Precio actual.
    */
    const py = yPrice(last.mid);

    ctx.beginPath();
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = C.blue;
    ctx.lineWidth = 1;
    ctx.moveTo(left, py);
    ctx.lineTo(right, py);
    ctx.stroke();
    ctx.setLineDash([]);

    /*
     Etiquetas de precio.
    */
    ctx.font = "10px system-ui";
    ctx.textAlign = "left";
    ctx.fillStyle = "#aab7d4";

    for (let i = 0; i <= 6; i++) {
      const price =
        max - i * range / 6;

      const y = top + i * plotH / 6;

      ctx.fillText(
        fmt(price),
        w - axis + 3,
        Math.max(
          11,
          Math.min(h - 20, y + 3)
        )
      );
    }

    ctx.fillStyle = C.blue;

    ctx.fillText(
      fmt(last.mid),
      w - axis + 3,
      Math.max(
        12,
        Math.min(h - 20, py - 7)
      )
    );

    /*
     Eje temporal real.
    */
    const first = snaps[0];

    const timeText = t =>
      new Date(t).toLocaleTimeString(
        "es-MX",
        {
          hour: "2-digit",
          minute: "2-digit"
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

    /*
     Estado informativo.
    */
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
        fmt(last.mid) +
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

    if ($("clAsks")) {
      $("clAsks").textContent =
        "Esperando órdenes...";
    }

    if ($("clBids")) {
      $("clBids").textContent =
        "Esperando órdenes...";
    }

    if ($("clBookSummary")) {
      $("clBookSummary").textContent =
        "Esperando profundidad...";
    }

    if ($("clHeatInfo")) {
      $("clHeatInfo").textContent =
        "Esperando muestras reales...";
    }

    draw();
  }

  async function refresh() {
    if (
      !S.running ||
      S.busy ||
      document.hidden
    ) return;

    const s = selection();
    const currentKey = key(s);

    if (currentKey !== S.key) {
      S.key = currentKey;
      S.generation++;
      reset();
    }

    const generation = S.generation;
    S.busy = true;

    try {
      status(
        "Consultando " +
        s.exchange.toUpperCase(),
        "#ffe15a"
      );

      const book = await fetchBook(s);

      if (
        !S.running ||
        generation !== S.generation ||
        currentKey !== key(selection())
      ) return;

      S.lastBook = book;

      capture(book);
      renderBook(book);
      draw();

      status(
        s.exchange.toUpperCase() +
        " · " +
        new Date().toLocaleTimeString(
          "es-MX"
        ),
        C.green
      );

    } catch (error) {
      if (
        generation !== S.generation ||
        !S.running
      ) return;

      console.warn(
        "CRYPTOLEXUZ Liquidez:",
        error
      );

      status(
        "Sin profundidad · " +
        error.message,
        C.red
      );

      if (
        !S.lastBook &&
        $("clBookSummary")
      ) {
        $("clBookSummary").textContent =
          "No se pudo consultar el libro. " +
          "Revisa la conexión del proxy.";
      }

    } finally {
      S.busy = false;
    }
  }

  function start() {
    if (S.running) return;

    S.running = true;

    status(
      "Conectando...",
      "#ffe15a"
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

    if (S.timer) {
      clearInterval(S.timer);
      S.timer = null;
    }

    S.controller?.abort();

    status("Mapa detenido");
  }

  function restart() {
    S.generation++;
    S.key = "";

    S.controller?.abort();
    reset();

    if (S.running) {
      if (S.busy) {
        setTimeout(() => {
          if (S.running) refresh();
        }, 150);
      } else {
        refresh();
      }
    }
  }

  function events() {
    $("clHeatEnabled")?.addEventListener(
      "change",
      e => {
        S.showMap = e.target.checked;
        draw();
      }
    );

    $("clHeatPrice")?.addEventListener(
      "change",
      e => {
        S.showPrice = e.target.checked;
        draw();
      }
    );

    $("clHeatProfile")?.addEventListener(
      "change",
      e => {
        S.showProfile = e.target.checked;
        draw();
      }
    );

    $("clHeatIntensity")?.addEventListener(
      "input",
      e => {
        S.intensity = Number(
          e.target.value
        );
        draw();
      }
    );

    $("clHeatHistory")?.addEventListener(
      "change",
      e => {
        S.maxHistory = Number(
          e.target.value
        );

        S.snapshots = S.snapshots.slice(
          -S.maxHistory
        );

        draw();
      }
    );

    $("clHeatBins")?.addEventListener(
      "change",
      e => {
        S.bins = Number(e.target.value);
        draw();
      }
    );

    $("clHeatResetZoom")?.addEventListener(
      "click",
      () => {
        S.zoom = 1;
        draw();
      }
    );

    $("liquidityMapToggle")?.addEventListener(
      "change",
      e => {
        if (e.target.checked) {
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
        e => {
          e.preventDefault();

          S.zoom = Math.max(
            .5,
            Math.min(
              6,
              S.zoom * (
                e.deltaY < 0
                  ? 1.12
                  : .89
              )
            )
          );

          draw();
        },
        { passive: false }
      );

      canvas.addEventListener(
        "touchstart",
        e => {
          if (e.touches.length !== 2) {
            return;
          }

          S.dragging = true;

          S.touchY = Math.abs(
            e.touches[0].clientY -
            e.touches[1].clientY
          );
        },
        { passive: true }
      );

      canvas.addEventListener(
        "touchmove",
        e => {
          if (
            !S.dragging ||
            e.touches.length !== 2
          ) return;

          const distance = Math.abs(
            e.touches[0].clientY -
            e.touches[1].clientY
          );

          if (S.touchY > 0) {
            S.zoom = Math.max(
              .5,
              Math.min(
                6,
                S.zoom *
                distance / S.touchY
              )
            );
          }

          S.touchY = distance;
          draw();
        },
        { passive: true }
      );

      canvas.addEventListener(
        "touchend",
        () => {
          S.dragging = false;
        }
      );

      if (window.ResizeObserver) {
        S.observer = new ResizeObserver(
          () => draw()
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
          draw();
        }
      }
    );

    window.addEventListener(
      "resize",
      draw
    );

    window.addEventListener(
      "cryptolexuz:screen-change",
      () => setTimeout(draw, 150)
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
    if (!build()) return;

    events();
    reset();

    const toggle = $("liquidityMapToggle");

    if (!toggle || toggle.checked) {
      start();
    } else {
      status("Mapa detenido");
    }

    console.info(
      "CRYPTOLEXUZ PRO · Liquidity V12"
    );
  }

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
