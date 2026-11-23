
/*
 CRYPTOLEXUZ PRO — MERCADO PRO V3
 Tendencia, Volume Profile estimado y mapa de profundidad.
 BTC, ETH, BNB, SOL, XRP, DOGE, GOLD y OIL WTI.

 No ejecuta órdenes.
 No inventa liquidaciones ni datos de mercado.
 Compatible con index.html de CRYPTOLEXUZ PRO.
*/
"use strict";

(() => {
  if (window.__clMercadoProV3) return;
  window.__clMercadoProV3 = true;

  const $ = id => document.getElementById(id);

  const COLORS = {
    green: "#00f5a0",
    red: "#ff476c",
    purple: "#bb52ff",
    yellow: "#ffe15a",
    orange: "#ff9a35",
    blue: "#36c5ff"
  };

  const TF_SECONDS = {
    "1m": 60,
    "3m": 180,
    "5m": 300,
    "15m": 900,
    "30m": 1800,
    "1h": 3600,
    "2h": 7200,
    "4h": 14400,
    "6h": 21600,
    "8h": 28800,
    "12h": 43200,
    "1d": 86400,
    "3d": 259200,
    "1w": 604800
  };

  const COMMODITIES = new Set([
    "NCCOGOLD2USD-USDT",
    "NCCO1OILWTI2USD-USDT"
  ]);

  const state = {
    generation: 0,
    controller: null,
    timer: null,
    updated: 0,
    rows: [],
    depth: null,
    profile: null,
    trend: null,
    busy: false
  };

  function fmt(value, digits = 2) {
    const number = Number(value);

    if (!Number.isFinite(number)) return "—";

    return number.toLocaleString("en-US", {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits
    });
  }

  function el(tag, cls = "", content) {
    const node = document.createElement(tag);

    if (cls) node.className = cls;

    if (content !== undefined) {
      node.textContent = String(content);
    }

    return node;
  }

  function selected() {
    const symbol = $("symbol")?.value || "BTC-USDT";
    let exchange = $("exchange")?.value || "bingx";
    let market = $("market")?.value || "perpetual";

    if (COMMODITIES.has(symbol)) {
      exchange = "bingx";
      market = "perpetual";
    }

    return {
      symbol,
      exchange,
      market,
      interval: $("interval")?.value || "15m"
    };
  }

  function selectionKey(selection) {
    return [
      selection.exchange,
      selection.market,
      selection.symbol,
      selection.interval
    ].join("|");
  }

  function normalize(payload) {
    const candidates = [
      payload?.data?.data,
      payload?.data?.list,
      payload?.data?.candles,
      payload?.data?.rows,
      payload?.data,
      payload?.list,
      payload?.candles,
      payload
    ];

    const raw = candidates.find(Array.isArray) || [];
    const map = new Map();

    for (const item of raw) {
      if (!item || typeof item !== "object") continue;

      const array = Array.isArray(item);

      let time = array
        ? item[0]
        : item.time ??
          item.timestamp ??
          item.openTime ??
          item.t;

      if (
        typeof time === "string" &&
        !/^\d+$/.test(time)
      ) {
        time = Date.parse(time);
      }

      time = Number(time);

      if (time > 1e12) {
        time = Math.floor(time / 1000);
      }

      const open = Number(
        array ? item[1] : item.open ?? item.o
      );

      const high = Number(
        array ? item[2] : item.high ?? item.h
      );

      const low = Number(
        array ? item[3] : item.low ?? item.l
      );

      const close = Number(
        array ? item[4] : item.close ?? item.c
      );

      const volume = Number(
        array
          ? item[5]
          : item.volume ?? item.vol ?? item.v ?? 0
      );

      if (
        ![time, open, high, low, close, volume]
          .every(Number.isFinite)
      ) continue;

      if (
        time <= 0 ||
        low <= 0 ||
        high < Math.max(open, close) ||
        low > Math.min(open, close) ||
        volume < 0
      ) continue;

      map.set(time, {
        time,
        open,
        high,
        low,
        close,
        volume
      });
    }

    return [...map.values()].sort(
      (a, b) => a.time - b.time
    );
  }

  async function getJSON(url, signal) {
    const response = await fetch(url, {
      signal,
      cache: "no-store"
    });

    if (!response.ok) {
      throw new Error("HTTP " + response.status);
    }

    const payload = await response.json();

    if (
      payload?.code !== undefined &&
      ![0, "0"].includes(payload.code)
    ) {
      throw new Error(
        payload.msg || "Respuesta de API no válida"
      );
    }

    return payload;
  }

  function ema(values, length) {
    if (values.length < length) return NaN;

    let result = values
      .slice(0, length)
      .reduce((a, b) => a + b, 0) / length;

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

    return values
      .slice(-length)
      .reduce((a, b) => a + b, 0) / length;
  }

  function rsi(values, length = 14) {
    if (values.length <= length) return NaN;

    let gain = 0;
    let loss = 0;

    for (let i = 1; i <= length; i++) {
      const change = values[i] - values[i - 1];

      gain += Math.max(change, 0);
      loss += Math.max(-change, 0);
    }

    gain /= length;
    loss /= length;

    for (let i = length + 1; i < values.length; i++) {
      const change = values[i] - values[i - 1];

      gain =
        (gain * (length - 1) +
          Math.max(change, 0)) / length;

      loss =
        (loss * (length - 1) +
          Math.max(-change, 0)) / length;
    }

    if (loss === 0) {
      return gain === 0 ? 50 : 100;
    }

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

    const closes = rows.map(row => row.close);
    const last = rows[rows.length - 1];

    const e21 = ema(closes, 21);
    const m55 = sma(closes, 55);
    const strengthRSI = rsi(closes);
    const volatility = atr(rows);

    const recent = rows.slice(-12);
    const previous = rows.slice(-24, -12);

    const recentHigh = Math.max(
      ...recent.map(row => row.high)
    );

    const recentLow = Math.min(
      ...recent.map(row => row.low)
    );

    const previousHigh = Math.max(
      ...previous.map(row => row.high)
    );

    const previousLow = Math.min(
      ...previous.map(row => row.low)
    );

    let score = 50;

    score += last.close > e21 ? 12 : -12;
    score += e21 > m55 ? 14 : -14;
    score += last.close > m55 ? 9 : -9;

    score += Math.max(
      -10,
      Math.min(10, (strengthRSI - 50) * 0.5)
    );

    score += recentHigh > previousHigh ? 8 : -8;
    score += recentLow > previousLow ? 7 : -7;

    score = Math.max(
      0,
      Math.min(100, Math.round(score))
    );

    let label = "LATERAL / MIXTO";

    if (score >= 75) {
      label = "ALCISTA FUERTE";
    } else if (score >= 60) {
      label = "ALCISTA";
    } else if (score <= 25) {
      label = "BAJISTA FUERTE";
    } else if (score <= 40) {
      label = "BAJISTA";
    }

    const baseline = sma(
      rows.slice(-21, -1).map(row => row.volume),
      20
    );

    return {
      score,
      label,
      price: last.close,
      ema21: e21,
      ma55: m55,
      rsi: strengthRSI,
      atr: volatility,
      support: Math.min(
        ...rows.slice(-50).map(row => row.low)
      ),
      resistance: Math.max(
        ...rows.slice(-50).map(row => row.high)
      ),
      volumeRatio:
        baseline > 0
          ? last.volume / baseline
          : NaN,
      candleTime: last.time
    };
  }

  /*
   Volume Profile aproximado.

   Reparte el volumen de cada vela entre los
   niveles de precio recorridos por esa vela.

   No representa volumen real tick por tick.
  */
  function volumeProfile(rows, bins = 48) {
    if (!rows.length) return null;

    const minimum = Math.min(
      ...rows.map(row => row.low)
    );

    const maximum = Math.max(
      ...rows.map(row => row.high)
    );

    if (maximum <= minimum) return null;

    const step = (maximum - minimum) / bins;

    const levels = Array.from(
      { length: bins },
      (_, index) => ({
        index,
        price: minimum + (index + 0.5) * step,
        volume: 0,
        buy: 0,
        sell: 0
      })
    );

    for (const candle of rows) {
      const first = Math.max(
        0,
        Math.min(
          bins - 1,
          Math.floor((candle.low - minimum) / step)
        )
      );

      const last = Math.max(
        first,
        Math.min(
          bins - 1,
          Math.floor((candle.high - minimum) / step)
        )
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

    const total = levels.reduce(
      (sum, level) => sum + level.volume,
      0
    );

    if (total <= 0) return null;

    let pocIndex = 0;

    for (let i = 1; i < levels.length; i++) {
      if (
        levels[i].volume >
        levels[pocIndex].volume
      ) {
        pocIndex = i;
      }
    }

    /*
     Área de valor contigua alrededor del POC.
     Objetivo: aproximadamente 70% del volumen.
    */
    let left = pocIndex;
    let right = pocIndex;
    let accumulated = levels[pocIndex].volume;

    while (
      accumulated < total * 0.70 &&
      (left > 0 || right < bins - 1)
    ) {
      const leftVolume =
        left > 0
          ? levels[left - 1].volume
          : -1;

      const rightVolume =
        right < bins - 1
          ? levels[right + 1].volume
          : -1;

      if (rightVolume > leftVolume) {
        right++;
        accumulated += levels[right].volume;
      } else {
        left--;
        accumulated += levels[left].volume;
      }
    }

    return {
      levels,
      poc: levels[pocIndex].price,
      pocIndex,
      vah: levels[right].price,
      val: levels[left].price,
      maximum: Math.max(
        ...levels.map(level => level.volume)
      ),
      total,
      step,
      valueAreaPercent: accumulated / total * 100
    };
  }

  function normalizeDepth(payload) {
    const data =
      payload?.data?.data ??
      payload?.data ??
      payload;

    const parse = items => {
      if (!Array.isArray(items)) return [];

      return items.map(item => {
        const array = Array.isArray(item);

        return {
          price: Number(
            array
              ? item[0]
              : item.price ?? item.p
          ),
          size: Number(
            array
              ? item[1]
              : item.quantity ??
                item.qty ??
                item.size ??
                item.q
          )
        };
      }).filter(item =>
        Number.isFinite(item.price) &&
        Number.isFinite(item.size) &&
        item.price > 0 &&
        item.size > 0
      );
    };

    return {
      bids: parse(data?.bids ?? data?.b),
      asks: parse(data?.asks ?? data?.a)
    };
  }

  function injectCSS() {
    if ($("clMarketProCSS")) return;

    const style = el("style");
    style.id = "clMarketProCSS";

    style.textContent = `
      .clmp-panel {
        background:#10172d;
        border:1px solid #35416e;
        border-radius:15px;
        padding:14px;
        margin:15px 0;
        color:#e8eeff;
        min-width:0;
      }

      .clmp-panel h2 {
        font-size:18px;
        margin:0 0 12px;
      }

      .clmp-muted {
        color:#aebcdd;
        font-size:12px;
        line-height:1.6;
      }

      .clmp-heading {
        display:flex;
        justify-content:space-between;
        align-items:center;
        flex-wrap:wrap;
        gap:8px;
        margin-bottom:12px;
      }

      .clmp-heading h2 {
        margin:0;
      }

      .clmp-refresh {
        border:1px solid #7252ac;
        background:#2a2050;
        color:#fff;
        border-radius:9px;
        padding:8px 12px;
        cursor:pointer;
      }

      .clmp-gauge {
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

      .clmp-needle {
        position:absolute;
        top:-8px;
        width:4px;
        height:34px;
        background:#fff;
        border-radius:3px;
        transform:translateX(-50%);
        box-shadow:0 0 8px #fff;
      }

      .clmp-trend-label {
        text-align:center;
        font-size:22px;
        font-weight:800;
        margin:10px 0;
      }

      .clmp-score {
        text-align:center;
        color:#aebcdd;
        font-size:13px;
      }

      .clmp-metrics {
        display:grid;
        grid-template-columns:repeat(2,minmax(0,1fr));
        gap:9px;
        margin-top:15px;
      }

      .clmp-metric {
        background:#151d39;
        border:1px solid #35416e;
        border-radius:11px;
        padding:12px;
        min-width:0;
      }

      .clmp-metric span {
        display:block;
        font-size:11px;
        color:#aebcdd;
        margin-bottom:7px;
      }

      .clmp-metric strong {
        display:block;
        font-size:15px;
        overflow-wrap:anywhere;
      }

      .clmp-profile {
        margin-top:15px;
        max-height:520px;
        overflow-y:auto;
        padding-right:3px;
      }

      .clmp-profile-row {
        display:grid;
        grid-template-columns:88px minmax(0,1fr);
        align-items:center;
        gap:8px;
        margin:3px 0;
        font-size:11px;
      }

      .clmp-profile-track {
        display:flex;
        width:100%;
        height:11px;
        background:#080e20;
        border-radius:3px;
        overflow:hidden;
      }

      .clmp-profile-buy {
        height:100%;
        background:#00a879;
      }

      .clmp-profile-sell {
        height:100%;
        background:#ff476c;
      }

      .clmp-profile-row.poc {
        color:#ffe15a;
        font-weight:800;
      }

      .clmp-profile-row.poc
      .clmp-profile-track {
        outline:1px solid #ffe15a;
      }

      .clmp-profile-row.value-area {
        background:rgba(187,82,255,.07);
      }

      .clmp-depth-grid {
        display:grid;
        grid-template-columns:repeat(2,minmax(0,1fr));
        gap:10px;
        margin-top:15px;
      }

      .clmp-depth-card {
        background:#151d39;
        border:1px solid #35416e;
        border-radius:11px;
        padding:10px;
        min-width:0;
      }

      .clmp-depth-card h3 {
        font-size:14px;
        margin:0 0 10px;
      }

      .clmp-depth-line {
        display:flex;
        justify-content:space-between;
        gap:5px;
        font-size:11px;
        margin:7px 0;
      }

      .clmp-depth-bar {
        height:7px;
        background:#27334c;
        border-radius:5px;
        overflow:hidden;
        margin-bottom:9px;
      }

      .clmp-depth-bar div {
        height:100%;
      }

      .clmp-heatmap {
        display:block;
        width:100%;
        height:auto;
        margin-top:15px;
        background:#080e20;
        border:1px solid #35416e;
        border-radius:9px;
      }

      .clmp-status {
        margin-top:10px;
        font-size:11px;
        color:#aebcdd;
        overflow-wrap:anywhere;
      }

      @media(max-width:370px) {
        .clmp-metrics {
          gap:6px;
        }

        .clmp-metric {
          padding:8px;
        }

        .clmp-depth-grid {
          grid-template-columns:1fr;
        }
      }
    `;

    document.head.appendChild(style);
  }

  function metric(label, value) {
    const box = el("div", "clmp-metric");

    box.append(
      el("span", "", label),
      el("strong", "", value)
    );

    return box;
  }

  function createPanel(id, title, parent) {
    let panel = $(id);

    if (panel) return panel;

    panel = el("section", "clmp-panel");
    panel.id = id;

    const heading = el("div", "clmp-heading");
    heading.appendChild(el("h2", "", title));

    const refresh = el(
      "button",
      "clmp-refresh",
      "↻ Actualizar"
    );

    refresh.type = "button";
    refresh.addEventListener("click", update);

    heading.appendChild(refresh);
    panel.appendChild(heading);

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
      "🌡️ PROFUNDIDAD DE MERCADO",
      charts
    );

    for (const [panel, id] of [
      [trend, "clMarketTrendBody"],
      [profile, "clMarketProfileBody"],
      [depth, "clMarketDepthBody"]
    ]) {
      if (!$(id)) {
        const body = el("div");
        body.id = id;
        panel.appendChild(body);
      }
    }

    const chartSection = $("chartSection");

    if (chartSection) {
      chartSection.insertAdjacentElement(
        "afterend",
        trend
      );

      trend.insertAdjacentElement(
        "afterend",
        profile
      );
    }

    const liquiditySection = $("liquiditySection");

    if (liquiditySection) {
      liquiditySection.insertAdjacentElement(
        "afterend",
        depth
      );
    } else {
      profile.insertAdjacentElement(
        "afterend",
        depth
      );
    }
  }

  function renderTrend(result) {
    const host = $("clMarketTrendBody");

    if (!host) return;

    host.replaceChildren();

    if (!result) {
      host.appendChild(el(
        "p",
        "clmp-muted",
        "Esperando suficientes velas cerradas."
      ));
      return;
    }

    const gauge = el("div", "clmp-gauge");
    const needle = el("div", "clmp-needle");

    needle.style.left = result.score + "%";
    gauge.appendChild(needle);

    let color = COLORS.yellow;

    if (result.score >= 60) {
      color = COLORS.green;
    } else if (result.score <= 40) {
      color = COLORS.red;
    }

    const label = el(
      "div",
      "clmp-trend-label",
      result.label
    );

    label.style.color = color;

    host.append(
      gauge,
      label,
      el(
        "div",
        "clmp-score",
        "Puntuación de dirección alcista: " +
        result.score + "/100"
      )
    );

    const metrics = el("div", "clmp-metrics");

    metrics.append(
      metric("Precio de cierre", fmt(result.price)),
      metric("EMA 21", fmt(result.ema21)),
      metric("MA 55", fmt(result.ma55)),
      metric("RSI 14", fmt(result.rsi, 1)),
      metric("Soporte 50 velas", fmt(result.support)),
      metric("Resistencia 50 velas", fmt(result.resistance)),
      metric("ATR 14", fmt(result.atr)),
      metric(
        "Volumen / media",
        fmt(result.volumeRatio, 2) + "x"
      )
    );

    host.appendChild(metrics);

    host.appendChild(el(
      "p",
      "clmp-muted",
      "La puntuación combina medias, RSI y estructura. " +
      "No es una probabilidad de acierto ni una señal automática."
    ));
  }

  function renderProfile(profile) {
    const host = $("clMarketProfileBody");

    if (!host) return;

    host.replaceChildren();

    if (!profile) {
      host.appendChild(el(
        "p",
        "clmp-muted",
        "No hay suficiente volumen para calcular el perfil."
      ));
      return;
    }

    const metrics = el("div", "clmp-metrics");

    metrics.append(
      metric("POC", fmt(profile.poc)),
      metric("VAH", fmt(profile.vah)),
      metric("VAL", fmt(profile.val)),
      metric(
        "Área de valor",
        fmt(profile.valueAreaPercent, 1) + "%"
      )
    );

    host.appendChild(metrics);

    const wrapper = el("div", "clmp-profile");

    for (
      let i = profile.levels.length - 1;
      i >= 0;
      i--
    ) {
      const level = profile.levels[i];

      const row = el(
        "div",
        "clmp-profile-row"
      );

      if (i === profile.pocIndex) {
        row.classList.add("poc");
      }

      if (
        level.price >= profile.val &&
        level.price <= profile.vah
      ) {
        row.classList.add("value-area");
      }

      const price = el(
        "span",
        "",
        fmt(level.price)
      );

      const track = el(
        "div",
        "clmp-profile-track"
      );

      const buy = el(
        "div",
        "clmp-profile-buy"
      );

      const sell = el(
        "div",
        "clmp-profile-sell"
      );

      buy.style.width =
        100 * level.buy /
        Math.max(profile.maximum, 1e-12) + "%";

      sell.style.width =
        100 * level.sell /
        Math.max(profile.maximum, 1e-12) + "%";

      track.append(buy, sell);
      row.append(price, track);
      wrapper.appendChild(row);
    }

    host.appendChild(wrapper);

    host.appendChild(el(
      "p",
      "clmp-muted",
      "POC: nivel con mayor volumen estimado. " +
      "VAH y VAL: límites del área de valor aproximada. " +
      "Verde y rojo clasifican velas alcistas y bajistas, " +
      "no compras y ventas ejecutadas reales. " +
      "El cálculo distribuye el volumen de las velas " +
      "entre los precios recorridos."
    ));
  }

  function renderDepthUnavailable(message) {
    const host = $("clMarketDepthBody");

    if (!host) return;

    host.replaceChildren(el(
      "p",
      "clmp-muted",
      message
    ));
  }

  function renderDepth(depth, currentPrice) {
    const host = $("clMarketDepthBody");

    if (!host) return;

    host.replaceChildren();

    if (
      !depth ||
      !depth.bids.length ||
      !depth.asks.length
    ) {
      renderDepthUnavailable(
        "No hay datos verificables del libro de órdenes. " +
        "No se mostrarán concentraciones inventadas."
      );
      return;
    }

    const bids = [...depth.bids]
      .sort((a, b) => b.price - a.price);

    const asks = [...depth.asks]
      .sort((a, b) => a.price - b.price);

    const totalBid = bids.reduce(
      (sum, item) => sum + item.size,
      0
    );

    const totalAsk = asks.reduce(
      (sum, item) => sum + item.size,
      0
    );

    const total = totalBid + totalAsk;

    const metrics = el("div", "clmp-metrics");

    metrics.append(
      metric(
        "Órdenes de compra",
        fmt(totalBid, 4)
      ),
      metric(
        "Órdenes de venta",
        fmt(totalAsk, 4)
      ),
      metric(
        "Compras visibles",
        fmt(totalBid / total * 100, 1) + "%"
      ),
      metric(
        "Ventas visibles",
        fmt(totalAsk / total * 100, 1) + "%"
      )
    );

    host.appendChild(metrics);

    const grid = el("div", "clmp-depth-grid");

    const maximum = Math.max(
      1e-12,
      ...bids.map(item => item.size),
      ...asks.map(item => item.size)
    );

    function depthCard(title, levels, color) {
      const card = el("div", "clmp-depth-card");

      const heading = el("h3", "", title);
      heading.style.color = color;

      card.appendChild(heading);

      for (const level of levels.slice(0, 10)) {
        const line = el(
          "div",
          "clmp-depth-line"
        );

        line.append(
          el("span", "", fmt(level.price)),
          el("span", "", fmt(level.size, 4))
        );

        const bar = el(
          "div",
          "clmp-depth-bar"
        );

        const fill = el("div");

        fill.style.width =
          100 * level.size / maximum + "%";

        fill.style.background = color;

        bar.appendChild(fill);
        card.append(line, bar);
      }

      return card;
    }

    grid.append(
      depthCard(
        "▲ COMPRAS · 10 NIVELES",
        bids,
        COLORS.green
      ),
      depthCard(
        "▼ VENTAS · 10 NIVELES",
        asks,
        COLORS.red
      )
    );

    host.appendChild(grid);

    const canvas = el(
      "canvas",
      "clmp-heatmap"
    );

    canvas.width = 800;
    canvas.height = 420;

    host.appendChild(canvas);

    const ctx = canvas.getContext("2d");

    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;

    ctx.fillStyle = "#080e20";
    ctx.fillRect(0, 0, width, height);

    const all = [...bids, ...asks];

    const low = Math.min(
      ...all.map(item => item.price)
    );

    const high = Math.max(
      ...all.map(item => item.price)
    );

    if (high <= low) return;

    const top = 22;
    const bottom = height - 22;

    const priceToY = price =>
      bottom -
      (price - low) /
      (high - low) *
      (bottom - top);

    ctx.font = "12px sans-serif";
    ctx.textBaseline = "middle";

    for (let i = 0; i <= 6; i++) {
      const fraction = i / 6;
      const y = top + fraction * (bottom - top);
      const price = high - fraction * (high - low);

      ctx.strokeStyle = "#26334e";
      ctx.lineWidth = 1;

      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();

      ctx.fillStyle = "#aebcdd";
      ctx.fillText(fmt(price), 8, y - 9);
    }

    const maximumSize = Math.max(
      ...all.map(item => item.size)
    );

    for (const level of all) {
      const y = priceToY(level.price);
      const intensity =
        level.size / Math.max(maximumSize, 1e-12);

      const barWidth =
        90 + intensity * (width - 110);

      let color;

      if (intensity >= 0.75) {
        color = COLORS.red;
      } else if (intensity >= 0.5) {
        color = COLORS.orange;
      } else if (intensity >= 0.25) {
        color = COLORS.yellow;
      } else {
        color = COLORS.green;
      }

      ctx.globalAlpha =
        0.25 + intensity * 0.75;

      ctx.fillStyle = color;

      ctx.fillRect(
        width - barWidth,
        y - 3,
        barWidth,
        6
      );
    }

    ctx.globalAlpha = 1;

    if (
      Number.isFinite(currentPrice) &&
      currentPrice >= low &&
      currentPrice <= high
    ) {
      const y = priceToY(currentPrice);

      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2;
      ctx.setLineDash([7, 5]);

      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();

      ctx.setLineDash([]);

      ctx.fillStyle = "#ffffff";
      ctx.fillText(
        "PRECIO " + fmt(currentPrice),
        10,
        Math.max(12, y - 13)
      );
    }

    host.appendChild(el(
      "p",
      "clmp-muted",
      "Mapa de profundidad instantánea: las barras representan " +
      "órdenes limitadas visibles. Los colores indican concentración " +
      "relativa, no dirección de liquidaciones. " +
      "No es un mapa histórico de liquidaciones ni un heatmap " +
      "acumulado en el tiempo."
    ));
  }

  async function loadDepth(selection, signal) {
    const {
      exchange,
      market,
      symbol
    } = selection;

    const base =
      `/api/exchange/${encodeURIComponent(exchange)}`;

    const encoded = encodeURIComponent(symbol);

    const suffix =
      `?market=${encodeURIComponent(market)}&limit=100`;

    const endpoints = [
      `${base}/depth/${encoded}${suffix}`,
      `${base}/orderbook/${encoded}${suffix}`
    ];

    let lastError = null;

    for (const endpoint of endpoints) {
      if (signal.aborted) {
        throw new DOMException(
          "Solicitud cancelada",
          "AbortError"
        );
      }

      try {
        const payload = await getJSON(
          endpoint,
          signal
        );

        const depth = normalizeDepth(payload);

        if (
          depth.bids.length &&
          depth.asks.length
        ) {
          return depth;
        }
      } catch (error) {
        if (signal.aborted) throw error;
        lastError = error;
      }
    }

    return {
      bids: [],
      asks: [],
      error: lastError?.message ||
        "Sin profundidad disponible"
    };
  }

  function setStatus(text) {
    for (const id of [
      "clMarketTrend",
      "clMarketVolumeProfile",
      "clMarketDepth"
    ]) {
      const panel = $(id);

      if (!panel) continue;

      let status = panel.querySelector(
        ".clmp-status"
      );

      if (!status) {
        status = el("div", "clmp-status");
        panel.appendChild(status);
      }

      status.textContent = text;
    }
  }

  function showError(message) {
    for (const id of [
      "clMarketTrendBody",
      "clMarketProfileBody",
      "clMarketDepthBody"
    ]) {
      const host = $(id);

      if (!host) continue;

      host.replaceChildren(
        el("p", "clmp-muted", message)
      );
    }

    setStatus(message);
  }

  async function update() {
    if (document.hidden) return;

    build();

    const selection = selected();
    const key = selectionKey(selection);

    const generation = ++state.generation;

    if (state.controller) {
      state.controller.abort();
    }

    const controller = new AbortController();
    state.controller = controller;
    state.busy = true;

    const timeout = setTimeout(() => {
      controller.abort();
    }, 18000);

    setStatus(
      "Actualizando " +
      selection.symbol +
      " · " +
      selection.interval +
      "..."
    );

    try {
      const url =
        `/api/exchange/${encodeURIComponent(selection.exchange)}` +
        `/klines/${encodeURIComponent(selection.symbol)}` +
        `?market=${encodeURIComponent(selection.market)}` +
        `&interval=${encodeURIComponent(selection.interval)}` +
        `&limit=300`;

      const payload = await getJSON(
        url,
        controller.signal
      );

      const rows = normalize(payload);

      const seconds =
        TF_SECONDS[selection.interval] || 900;

      const now = Math.floor(
        Date.now() / 1000
      );

      const closed = rows.filter(
        row =>
          row.time + seconds <= now - 2
      );

      if (closed.length < 60) {
        throw new Error(
          "No hay suficientes velas cerradas."
        );
      }

      if (
        controller.signal.aborted ||
        generation !== state.generation ||
        selectionKey(selected()) !== key
      ) return;

      const trend = scoreTrend(closed);

      const profile = volumeProfile(
        closed.slice(-180),
        48
      );

      state.rows = closed;
      state.trend = trend;
      state.profile = profile;

      renderTrend(trend);
      renderProfile(profile);

      /*
       Se consulta profundidad del exchange
       seleccionado. Si el proxy no ofrece
       ese endpoint, se informa claramente.
      */
      const depth = await loadDepth(
        selection,
        controller.signal
      );

      if (
        controller.signal.aborted ||
        generation !== state.generation ||
        selectionKey(selected()) !== key
      ) return;

      state.depth = depth;

      if (
        depth.bids.length &&
        depth.asks.length
      ) {
        renderDepth(
          depth,
          closed[closed.length - 1].close
        );
      } else {
        renderDepthUnavailable(
          "El servidor no proporciona profundidad " +
          "verificable para este mercado. " +
          (depth.error || "")
        );
      }

      state.updated = Date.now();

      setStatus(
        "Actualizado: " +
        new Date(state.updated)
          .toLocaleTimeString("es-MX") +
        " · " +
        selection.symbol +
        " · " +
        selection.interval +
        " · Última vela cerrada"
      );

    } catch (error) {
      if (
        generation !== state.generation
      ) return;

      if (
        controller.signal.aborted &&
        selectionKey(selected()) !== key
      ) return;

      const message =
        controller.signal.aborted
          ? "Tiempo de espera agotado."
          : String(
              error.message || error
            );

      showError(
        "No se pudieron actualizar los datos: " +
        message
      );

    } finally {
      clearTimeout(timeout);

      if (generation === state.generation) {
        state.busy = false;
        state.controller = null;
      }
    }
  }

  function init() {
    build();

    for (const id of [
      "symbol",
      "interval",
      "exchange",
      "market"
    ]) {
      $(id)?.addEventListener(
        "change",
        update
      );
    }

    $("refresh")?.addEventListener(
      "click",
      update
    );

    document.addEventListener(
      "visibilitychange",
      () => {
        if (!document.hidden) {
          update();
        }
      }
    );

    window.addEventListener(
      "cryptolexuz:screen-change",
      event => {
        if (
          event.detail?.screen === "charts"
        ) {
          update();
        }
      }
    );

    update();

    state.timer = setInterval(() => {
      if (!document.hidden && !state.busy) {
        update();
      }
    }, 60000);
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
