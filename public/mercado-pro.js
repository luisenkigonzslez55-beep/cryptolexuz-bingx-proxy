
/* CRYPTOLEXUZ PRO — MERCADO PRO V2
   Indicador de tendencia, Volume Profile y mapa de liquidez.
   Compatible con el index.html de CRYPTOLEXUZ PRO.
   No ejecuta operaciones.
*/
"use strict";

(() => {
  if (window.__clMercadoProV2) return;
  window.__clMercadoProV2 = true;

  const $ = id => document.getElementById(id);

  const API = location.origin;

  const COLORS = {
    green: "#00f5a0",
    red: "#ff476c",
    purple: "#bb52ff",
    yellow: "#ffe15a",
    blue: "#36c5ff"
  };

  const state = {
    symbol: "BTC-USDT",
    interval: "15m",
    rows: [],
    depth: null,
    busy: false,
    updated: 0
  };

  const fmt = (n, d = 2) =>
    Number.isFinite(Number(n))
      ? Number(n).toLocaleString("en-US", {
          minimumFractionDigits: d,
          maximumFractionDigits: d
        })
      : "—";

  function element(tag, cls, text) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function normalize(payload) {
    const candidates = [
      payload?.data?.data,
      payload?.data?.list,
      payload?.data?.candles,
      payload?.data,
      payload?.list,
      payload
    ];

    const raw = candidates.find(Array.isArray) || [];

    return raw.map(v => {
      const a = Array.isArray(v);

      let time = Number(
        a ? v[0] :
        v.time ?? v.timestamp ?? v.openTime ?? v.t
      );

      if (time > 1e12) time = Math.floor(time / 1000);

      return {
        time,
        open: Number(a ? v[1] : v.open ?? v.o),
        high: Number(a ? v[2] : v.high ?? v.h),
        low: Number(a ? v[3] : v.low ?? v.l),
        close: Number(a ? v[4] : v.close ?? v.c),
        volume: Number(a ? v[5] : v.volume ?? v.vol ?? v.v ?? 0)
      };
    })
    .filter(c =>
      Object.values(c).every(Number.isFinite) &&
      c.time > 0 &&
      c.low > 0 &&
      c.high >= Math.max(c.open, c.close) &&
      c.low <= Math.min(c.open, c.close)
    )
    .sort((a, b) => a.time - b.time)
    .filter((c, i, arr) =>
      i === arr.length - 1 || c.time !== arr[i + 1].time
    );
  }

  async function getJSON(url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        cache: "no-store"
      });

      if (!response.ok) throw Error("HTTP " + response.status);

      const payload = await response.json();

      if (
        payload?.code !== undefined &&
        ![0, "0"].includes(payload.code)
      ) {
        throw Error(payload.msg || "Error de API");
      }

      return payload;
    } finally {
      clearTimeout(timer);
    }
  }

  function ema(values, length) {
    if (values.length < length) return NaN;

    let result =
      values.slice(0, length).reduce((a, b) => a + b, 0) /
      length;

    const multiplier = 2 / (length + 1);

    for (let i = length; i < values.length; i++) {
      result =
        values[i] * multiplier +
        result * (1 - multiplier);
    }

    return result;
  }

  function sma(values, length) {
    if (values.length < length) return NaN;

    return values.slice(-length)
      .reduce((a, b) => a + b, 0) / length;
  }

  function rsi(values, length = 14) {
    if (values.length <= length) return NaN;

    let gain = 0;
    let loss = 0;

    for (let i = 1; i <= length; i++) {
      const change = values[i] - values[i -1];
      gain += Math.max(change, 0);
      loss += Math.max(-change, 0);
    }

    gain /= length;
    loss /= length;

    for (let i = length + 1; i < values.length; i++) {
      const change = values[i] - values[i - 1];

      gain =
        (gain * (length - 1) + Math.max(change, 0)) /
        length;

      loss =
        (loss * (length - 1) + Math.max(-change, 0)) /
        length;
    }

    if (loss === 0) return gain === 0 ? 50 : 100;

    return 100 - 100 / (1 + gain / loss);
  }

  function atr(rows, length = 14) {
    if (rows.length <= length) return NaN;

    const ranges = [];

    for (let i = 1; i < rows.length; i++) {
      const current = rows[i];
      const previous = rows[i - 1];

      ranges.push(Math.max(
        current.high - current.low,
        Math.abs(current.high - previous.close),
        Math.abs(current.low - previous.close)
      ));
    }

    return sma(ranges, length);
  }

  function scoreTrend(rows) {
    if (rows.length < 60) return null;

    const closes = rows.map(r => r.close);
    const last = rows.at(-1);

    const e21 = ema(closes, 21);
    const m55 = sma(closes, 55);
    const strengthRSI = rsi(closes);
    const volatility = atr(rows);

    const recent = rows.slice(-12);
    const previous = rows.slice(-24, -12);

    const recentHigh = Math.max(...recent.map(r => r.high));
    const recentLow = Math.min(...recent.map(r => r.low));
    const previousHigh = Math.max(...previous.map(r => r.high));
    const previousLow = Math.min(...previous.map(r => r.low));

    let score = 50;

    score += last.close > e21 ? 12 : -12;
    score += e21 > m55 ? 14 : -14;
    score += last.close > m55 ? 9 : -9;

    score += Math.max(
      -10,
      Math.min(10, (strengthRSI - 50) * 0.5)
    );

    if (recentHigh > previousHigh) score += 8;
    else score -= 8;

    if (recentLow > previousLow) score += 7;
    else score -= 7;

    score = Math.max(0, Math.min(100, Math.round(score)));

    let label = "LATERAL / MIXTO";

    if (score >= 75) label = "ALCISTA FUERTE";
    else if (score >= 60) label = "ALCISTA";
    else if (score <= 25) label = "BAJISTA FUERTE";
    else if (score <= 40) label = "BAJISTA";

    return {
      score,
      label,
      price: last.close,
      ema21: e21,
      ma55: m55,
      rsi: strengthRSI,
      atr: volatility,
      support: Math.min(...rows.slice(-50).map(r => r.low)),
      resistance: Math.max(...rows.slice(-50).map(r => r.high)),
      volumeRatio:
        last.volume /
        Math.max(
          sma(rows.slice(-21, -1).map(r => r.volume), 20),
          0.000001
        )
    };
  }

  function volumeProfile(rows, bins = 60) {
    if (!rows.length) return null;

    const minimum = Math.min(...rows.map(r => r.low));
    const maximum = Math.max(...rows.map(r => r.high));

    if (maximum <= minimum) return null;

    const step = (maximum - minimum) / bins;
    const levels = Array.from({ length: bins }, (_, i) => ({
      price: minimum + (i + 0.5) * step,
      volume: 0,
      buy: 0,
      sell: 0
    }));

    for (const candle of rows) {
      const first = Math.max(
        0,
        Math.floor((candle.low - minimum) / step)
      );

      const last = Math.min(
        bins - 1,
        Math.floor((candle.high - minimum) / step)
      );

      const count = last - first + 1;
      const allocation = candle.volume / count;

      for (let i = first; i <= last; i++) {
        levels[i].volume += allocation;

        if (candle.close >= candle.open) {
          levels[i].buy += allocation;
        } else {
          levels[i].sell += allocation;
        }
      }
    }

    const poc = levels.reduce((best, current) =>
      current.volume > best.volume ? current : best
    );

    const total = levels.reduce((sum, x) => sum + x.volume, 0);

    const ranked = [...levels].sort(
      (a, b) => b.volume - a.volume
    );

    let accumulated = 0;
    const valueLevels = [];

    for (const level of ranked) {
      valueLevels.push(level);
      accumulated += level.volume;
      if (accumulated >= total * 0.7) break;
    }

    return {
      levels,
      poc: poc.price,
      vah: Math.max(...valueLevels.map(x => x.price)),
      val: Math.min(...valueLevels.map(x => x.price)),
      maximum: Math.max(...levels.map(x => x.volume))
    };
  }

  function injectCSS() {
    if ($("clMarketProCSS")) return;

    const style = element("style");
    style.id = "clMarketProCSS";

    style.textContent = `
      .clmp-panel{
        background:#10172d;
        border:1px solid #35416e;
        border-radius:15px;
        padding:14px;
        margin:15px 0;
        color:#e8eeff;
        min-width:0;
      }
      .clmp-panel h2{
        font-size:18px;
        margin:0 0 12px;
      }
      .clmp-muted{
        color:#aebcdd;
        font-size:12px;
        line-height:1.6;
      }
      .clmp-controls{
        display:flex;
        gap:8px;
        flex-wrap:wrap;
        margin-bottom:12px;
      }
      .clmp-controls button{
        background:#191d3b;
        color:#e8eeff;
        border:1px solid #46537f;
        border-radius:9px;
        padding:9px 12px;
      }
      .clmp-controls button.active{
        border-color:#bb52ff;
        background:#372052;
      }
      .clmp-gauge{
        position:relative;
        height:18px;
        background:linear-gradient(
          90deg,
          #ff476c 0%,
          #ff9a35 25%,
          #ffe15a 50%,
          #36c5ff 75%,
          #00f5a0 100%
        );
        border-radius:20px;
        margin:25px 0 14px;
      }
      .clmp-needle{
        position:absolute;
        top:-8px;
        height:34px;
        width:4px;
        background:white;
        border-radius:3px;
        box-shadow:0 0 7px #fff;
        transform:translateX(-50%);
      }
      .clmp-trend-label{
        font-size:22px;
        font-weight:800;
        text-align:center;
        margin:10px 0;
      }
      .clmp-score{
        text-align:center;
        color:#aebcdd;
        font-size:14px;
      }
      .clmp-metrics{
        display:grid;
        grid-template-columns:repeat(2,minmax(0,1fr));
        gap:9px;
        margin-top:15px;
      }
      .clmp-metric{
        padding:12px;
        background:#151d39;
        border:1px solid #35416e;
        border-radius:11px;
        min-width:0;
      }
      .clmp-metric span{
        display:block;
        font-size:11px;
        color:#aebcdd;
        margin-bottom:8px;
      }
      .clmp-metric strong{
        font-size:15px;
        overflow-wrap:anywhere;
      }
      .clmp-profile-row{
        display:grid;
        grid-template-columns:90px minmax(0,1fr);
        align-items:center;
        gap:8px;
        margin:3px 0;
        font-size:11px;
      }
      .clmp-profile-track{
        height:10px;
        background:#080e20;
        border-radius:3px;
        overflow:hidden;
      }
      .clmp-profile-fill{
        height:100%;
        background:linear-gradient(90deg,#00f5a0,#ffe15a);
      }
      .clmp-profile-row.poc{
        color:#ffe15a;
        font-weight:700;
      }
      .clmp-profile-row.poc .clmp-profile-fill{
        background:#ff9a35;
      }
      .clmp-depth-grid{
        display:grid;
        grid-template-columns:repeat(2,minmax(0,1fr));
        gap:10px;
      }
      .clmp-depth-card{
        border:1px solid #35416e;
        border-radius:11px;
        padding:10px;
        background:#151d39;
      }
      .clmp-depth-card h3{
        font-size:14px;
        margin:0 0 10px;
      }
      .clmp-depth-line{
        display:flex;
        justify-content:space-between;
        gap:5px;
        font-size:11px;
        margin:7px 0;
      }
      .clmp-depth-bar{
        height:7px;
        background:#27334c;
        border-radius:5px;
        overflow:hidden;
        margin-bottom:9px;
      }
      .clmp-depth-bar div{
        height:100%;
      }
      .clmp-heatmap{
        width:100%;
        display:block;
        background:#080e20;
        border:1px solid #35416e;
        border-radius:9px;
      }
      @media(max-width:370px){
        .clmp-metrics{gap:6px}
        .clmp-metric{padding:8px}
        .clmp-depth-grid{grid-template-columns:1fr}
      }
    `;

    document.head.appendChild(style);
  }

  function metric(label, value) {
    const box = element("div", "clmp-metric");
    box.append(
      element("span", "", label),
      element("strong", "", value)
    );
    return box;
  }

  function createPanel(id, title, parent) {
    let panel = $(id);
    if (panel) return panel;

    panel = element("section", "clmp-panel");
    panel.id = id;
    panel.appendChild(element("h2", "", title));

    parent.appendChild(panel);
    return panel;
  }

  function build() {
    injectCSS();

    const charts =
      $("clScreenCharts") ||
      document.querySelector("main");

    if (!charts) return;

    const trend = createPanel(
      "clMarketTrend",
      "📈 INDICADOR DE TENDENCIA",
      charts
    );

    const profile = createPanel(
      "clMarketVolumeProfile",
      "📊 VOLUME PROFILE",
      charts
    );

    const depth = createPanel(
      "clMarketDepth",
      "🌡️ MAPA DE LIQUIDEZ",
      charts
    );

    if (!$("clMarketTrendBody")) {
      const body = element("div");
      body.id = "clMarketTrendBody";
      trend.appendChild(body);
    }

    if (!$("clMarketProfileBody")) {
      const body = element("div");
      body.id = "clMarketProfileBody";
      profile.appendChild(body);
    }

    if (!$("clMarketDepthBody")) {
      const body = element("div");
      body.id = "clMarketDepthBody";
      depth.appendChild(body);
    }

    const chartSection = $("chartSection");

    if (chartSection) {
      chartSection.insertAdjacentElement("afterend", trend);
      trend.insertAdjacentElement("afterend", profile);
      profile.insertAdjacentElement("afterend", depth);
    }
  }

  function renderTrend(result) {
    const host = $("clMarketTrendBody");
    if (!host) return;

    host.replaceChildren();

    if (!result) {
      host.appendChild(element(
        "p",
        "clmp-muted",
        "Esperando datos suficientes para calcular la tendencia."
      ));
      return;
    }

    const gauge = element("div", "clmp-gauge");
    const needle = element("div", "clmp-needle");

    needle.style.left = result.score + "%";
    gauge.appendChild(needle);

    let color = COLORS.yellow;

    if (result.score >= 60) color = COLORS.green;
    if (result.score <= 40) color = COLORS.red;

    const label = element(
      "div",
      "clmp-trend-label",
      result.label
    );

    label.style.color = color;

    host.append(
      gauge,
      label,
      element(
        "div",
        "clmp-score",
        "Fuerza alcista: " + result.score + "/100"
      )
    );

    const metrics = element("div", "clmp-metrics");

    metrics.append(
      metric("Precio", fmt(result.price)),
      metric("EMA 21", fmt(result.ema21)),
      metric("MA 55", fmt(result.ma55)),
      metric("RSI 14", fmt(result.rsi, 1)),
      metric("Soporte", fmt(result.support)),
      metric("Resistencia", fmt(result.resistance)),
      metric("ATR 14", fmt(result.atr)),
      metric("Volumen / media", fmt(result.volumeRatio, 2) + "x")
    );

    host.appendChild(metrics);

    host.appendChild(element(
      "p",
      "clmp-muted",
      "Puntuación técnica calculada con medias, RSI y estructura. No representa probabilidad de acierto."
    ));
  }

  function renderProfile(profile) {
    const host = $("clMarketProfileBody");
    if (!host) return;

    host.replaceChildren();

    if (!profile) {
      host.appendChild(element(
        "p",
        "clmp-muted",
        "Esperando volumen de mercado..."
      ));
      return;
    }

    const metrics = element("div", "clmp-metrics");

    metrics.append(
      metric("POC", fmt(profile.poc)),
      metric("VAH", fmt(profile.vah)),
      metric("VAL", fmt(profile.val)),
      metric("Niveles", String(profile.levels.length))
    );

    host.appendChild(metrics);

    const levels = [...profile.levels].reverse();

    const wrapper = element("div");
    wrapper.style.marginTop = "16px";

    for (const level of levels) {
      const row = element("div", "clmp-profile-row");

      if (
        Math.abs(level.price - profile.poc) <
        Math.abs(profile.levels[1].price - profile.levels[0].price) / 2
      ) {
        row.classList.add("poc");
      }

      const price = element(
        "span",
        "",
        fmt(level.price)
      );

      const track = element("div", "clmp-profile-track");
      const fill = element("div", "clmp-profile-fill");

      fill.style.width =
        Math.max(
          0,
          100 * level.volume / Math.max(profile.maximum, 1)
        ) + "%";

      track.appendChild(fill);
      row.append(price, track);
      wrapper.appendChild(row);
    }

    host.appendChild(wrapper);

    host.appendChild(element(
      "p",
      "clmp-muted",
      "Perfil estimado: distribuye el volumen de cada vela entre los precios recorridos. No equivale a volumen negociado exacto por precio."
    ));
  }

  function normalizeDepth(payload) {
    const data =
      payload?.data?.data ??
      payload?.data ??
      payload;

    const bids = data?.bids ?? data?.b ?? [];
    const asks = data?.asks ?? data?.a ?? [];

    const parse = items =>
      items.map(item => ({
        price: Number(Array.isArray(item) ? item[0] : item.price),
        size: Number(
          Array.isArray(item)
            ? item[1]
            : item.quantity ?? item.qty ?? item.size
        )
      }))
      .filter(x =>
        Number.isFinite(x.price) &&
        Number.isFinite(x.size) &&
        x.price > 0 &&
        x.size > 0
      );

    return {
      bids: parse(bids),
      asks: parse(asks)
    };
  }

  async function loadDepth(symbol) {
    const endpoints = [
      `/api/exchange/bingx/depth/${encodeURIComponent(symbol)}?market=perpetual&limit=100`,
      `/api/exchange/bingx/orderbook/${encodeURIComponent(symbol)}?market=perpetual&limit=100`
    ];

    for (const endpoint of endpoints) {
      try {
        const payload = await getJSON(API + endpoint);
        const depth = normalizeDepth(payload);

        if (depth.bids.length && depth.asks.length) {
          return depth;
        }
      } catch (_) {}
    }

    return null;
  }

  function renderDepth(depth, currentPrice) {
    const host = $("clMarketDepthBody");
    if (!host) return;

    host.replaceChildren();

    if (!depth) {
      host.appendChild(element(
        "p",
        "clmp-muted",
        "No hay profundidad disponible desde el servidor. El mapa no mostrará liquidaciones inventadas."
      ));
      return;
    }

    const bids = [...depth.bids]
      .sort((a, b) => b.price - a.price);

    const asks = [...depth.asks]
      .sort((a, b) => a.price - b.price);

    const totalBid = bids.reduce((s, x) => s + x.size, 0);
    const totalAsk = asks.reduce((s, x) => s + x.size, 0);

    const total = totalBid + totalAsk;

    const metrics = element("div", "clmp-metrics");

    metrics.append(
      metric(
        "Presión compradora",
        fmt(total ? totalBid / total * 100 : 0, 1) + "%"
      ),
      metric(
        "Presión vendedora",
        fmt(total ? totalAsk / total * 100 : 0, 1) + "%"
      )
    );

    host.appendChild(metrics);

    const grid = element("div", "clmp-depth-grid");
    grid.style.marginTop = "15px";

    const maximum = Math.max(
      1,
      ...bids.map(x => x.size),
      ...asks.map(x => x.size)
    );

    function depthCard(title, levels, color) {
      const card = element("div", "clmp-depth-card");

      const heading = element("h3", "", title);
      heading.style.color = color;

      card.appendChild(heading);

      for (const level of levels.slice(0, 10)) {
        const line = element("div", "clmp-depth-line");

        line.append(
          element("span", "", fmt(level.price)),
          element("span", "", fmt(level.size, 4))
        );

        const bar = element("div", "clmp-depth-bar");
        const fill = element("div");

        fill.style.width =
          100 * level.size / maximum + "%";

        fill.style.background = color;

        bar.appendChild(fill);
        card.append(line, bar);
      }

      return card;
    }

    grid.append(
      depthCard("▲ COMPRAS", bids, COLORS.green),
      depthCard("▼ VENTAS", asks, COLORS.red)
    );

    host.appendChild(grid);

    const heatmap = element("canvas", "clmp-heatmap");
    heatmap.width = 700;
    heatmap.height = 360;

    host.appendChild(heatmap);

    const ctx = heatmap.getContext("2d");
    if (!ctx) return;

    ctx.fillStyle = "#080e20";
    ctx.fillRect(0, 0, 700, 360);

    const all = [...bids, ...asks];
    const low = Math.min(...all.map(x => x.price));
    const high = Math.max(...all.map(x => x.price));

    if (high <= low) return;

    const priceToY = price =>
      340 - ((price - low) / (high - low)) * 320;

    ctx.strokeStyle = "#27334c";
    ctx.lineWidth = 1;

    for (let i = 0; i <= 6; i++) {
      const y = 20 + i * 53;

      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(700, y);
      ctx.stroke();
    }

    for (const level of all) {
      const y = priceToY(level.price);
      const intensity = level.size / maximum;

      const width = 80 + intensity * 570;

      ctx.fillStyle =
        intensity > 0.75 ? "#ff476c" :
        intensity > 0.5 ? "#ff9a35" :
        intensity > 0.25 ? "#ffe15a" :
        "#00a87d";

      ctx.globalAlpha = 0.3 + intensity * 0.7;
      ctx.fillRect(0, y - 3, width, 6);
    }

    ctx.globalAlpha = 1;

    if (Number.isFinite(currentPrice)) {
      const y = priceToY(currentPrice);

      ctx.strokeStyle = "#ffffff";
      ctx.setLineDash([5, 5]);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(700, y);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    host.appendChild(element(
      "p",
      "clmp-muted",
      "Mapa de profundidad actual del libro de órdenes. No es un historial de heatmap ni un mapa de liquidaciones. Las órdenes visibles pueden cambiar o cancelarse."
    ));
  }

  async function update() {
    if (state.busy || document.hidden) return;

    build();

    state.busy = true;

    const symbol = $("symbol")?.value || "BTC-USDT";
    const interval = $("interval")?.value || "15m";
    const exchange = $("exchange")?.value || "bingx";
    const market = $("market")?.value || "perpetual";

    state.symbol = symbol;
    state.interval = interval;

    try {
      const url =
        `${API}/api/exchange/${encodeURIComponent(exchange)}` +
        `/klines/${encodeURIComponent(symbol)}` +
        `?market=${encodeURIComponent(market)}` +
        `&interval=${encodeURIComponent(interval)}&limit=300`;

      const payload = await getJSON(url);
      const rows = normalize(payload);

      if (rows.length < 60) {
        throw Error("Velas insuficientes");
      }

      const seconds = {
        "1m": 60,
        "5m": 300,
        "15m": 900,
        "30m": 1800,
        "1h": 3600,
        "4h": 14400,
        "1d": 86400,
        "1w": 604800
      }[interval] || 900;

      const now = Math.floor(Date.now() / 1000);

      const closed = rows.filter(
        r => r.time + seconds <= now - 2
      );

      if (closed.length < 60) {
        throw Error("No hay suficientes velas cerradas");
      }

      state.rows = closed;

      renderTrend(scoreTrend(closed));
      renderProfile(volumeProfile(closed.slice(-180), 60));

      const depth =
        exchange === "bingx" && market === "perpetual"
          ? await loadDepth(symbol)
          : null;

      state.depth = depth;

      renderDepth(depth, closed.at(-1).close);
      state.updated = Date.now();

    } catch (error) {
      const message =
        "No se pudo actualizar: " +
        String(error.message || error);

      for (const id of [
        "clMarketTrendBody",
        "clMarketProfileBody",
        "clMarketDepthBody"
      ]) {
        const host = $(id);

        if (host) {
          host.replaceChildren(
            element("p", "clmp-muted", message)
          );
        }
      }
    } finally {
      state.busy = false;
    }
  }

  function init() {
    build();
    update();

    $("symbol")?.addEventListener("change", update);
    $("interval")?.addEventListener("change", update);
    $("exchange")?.addEventListener("change", update);
    $("market")?.addEventListener("change", update);

    $("refresh")?.addEventListener("click", update);

    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) update();
    });

    setInterval(update, 60000);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
