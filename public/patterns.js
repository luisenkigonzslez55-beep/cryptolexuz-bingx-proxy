
/*
 CRYPTOLEXUZ PRO — PATTERNS.JS V3 COMPLETO

 Compatible con Lightweight Charts 4.2.2.

 - Análisis con velas cerradas.
 - MAX y MIN con precios exactos.
 - Cuñas descendentes y ascendentes.
 - Doble techo y doble suelo.
 - Triple techo y triple suelo.
 - HCH y HCH invertido.
 - Divergencias RSI.
 - Ondas 1-2-3, ABC, Zig-Zag y Flat.
 - Triángulos ABCDE.
 - Squeeze y posibles Order Blocks.
 - Panel separado de resultados.
 - Sin duplicación de listeners.
 - Sin señales inventadas.
 - No ejecuta operaciones.
*/

"use strict";

(() => {
  if (window.CryptolexuzPatterns?.version === "3") {
    return;
  }

  const $ = id => document.getElementById(id);

  const STORE = "cryptolexuz_patterns_v1";

  const COLORS = {
    bull: "#00f5a0",
    bear: "#ff476c",
    neutral: "#ffe15a"
  };

  const NAMES = {
    divergences: "Divergencias RSI",
    squeeze: "Squeeze Momentum",
    orderblocks: "Order Blocks",
    fallingwedge: "Cuña descendente",
    impulses: "Ondas 1 · 2 · 3",
    abc: "Corrección ABC",
    abcde: "Triángulo ABCDE",
    zigzag: "Zig-Zag",
    flat: "Plana / Flat",
    diagonal: "Diagonal",
    doubletop: "Doble techo",
    doublebottom: "Doble suelo",
    headshoulders: "HCH",
    inversehs: "HCH invertido",
    risingwedge: "Cuña ascendente",
    triple: "Triple techo / suelo"
  };

  const enabled = new Set();

  let chart = null;
  let candle = null;
  let getRows = () => [];
  let getSelection = () => ({});
  let canvas = null;
  let findings = [];
  let frame = 0;
  let initialized = false;
  let subscribedChart = null;
  let resizeObserver = null;

  function load() {
    try {
      const saved = JSON.parse(
        localStorage.getItem(STORE) || "[]"
      );

      if (Array.isArray(saved)) {
        saved.forEach(key => {
          if (NAMES[key]) enabled.add(key);
        });
      }
    } catch (error) {
      console.warn("Patrones: memoria", error);
    }
  }

  function save() {
    try {
      localStorage.setItem(
        STORE,
        JSON.stringify([...enabled])
      );
    } catch (error) {
      console.warn("Patrones: guardado", error);
    }
  }

  function rows() {
    try {
      const data = getRows();

      return Array.isArray(data)
        ? data.filter(bar =>
            Number.isFinite(Number(bar.open)) &&
            Number.isFinite(Number(bar.high)) &&
            Number.isFinite(Number(bar.low)) &&
            Number.isFinite(Number(bar.close))
          )
        : [];
    } catch {
      return [];
    }
  }

  function seconds(tf) {
    const match = /^(\d+)(m|h|d|w|M)$/.exec(
      String(tf || "15m")
    );

    if (!match) return 900;

    const n = Number(match[1]);

    const unit = {
      m: 60,
      h: 3600,
      d: 86400,
      w: 604800,
      M: 2592000
    }[match[2]];

    return n * unit;
  }

  function unixTime(time) {
    if (typeof time === "number") {
      return time > 1e11
        ? time / 1000
        : time;
    }

    if (typeof time === "string") {
      const numeric = Number(time);

      if (Number.isFinite(numeric)) {
        return unixTime(numeric);
      }

      const parsed = Date.parse(time);

      return Number.isFinite(parsed)
        ? parsed / 1000
        : null;
    }

    if (
      time &&
      typeof time === "object" &&
      Number.isInteger(time.year)
    ) {
      return Date.UTC(
        time.year,
        time.month - 1,
        time.day
      ) / 1000;
    }

    return null;
  }

  function selection() {
    try {
      return getSelection() || {};
    } catch {
      return {};
    }
  }

  function closedRows() {
    const data = rows();

    if (!data.length) return [];

    const selected = selection();

    const tf =
      selected.tf ||
      selected.interval ||
      $("interval")?.value ||
      "15m";

    const last = data[data.length - 1];
    const time = unixTime(last.time);

    if (time === null) {
      return data.slice(0, -1);
    }

    const duration = seconds(tf);

    if (time + duration > Date.now() / 1000) {
      return data.slice(0, -1);
    }

    return data;
  }

  function sma(values, period) {
    const result = Array(values.length).fill(null);

    let sum = 0;

    for (let i = 0; i < values.length; i++) {
      sum += Number(values[i]);

      if (i >= period) {
        sum -= Number(values[i - period]);
      }

      if (i >= period - 1) {
        result[i] = sum / period;
      }
    }

    return result;
  }

  function rsi(values, period = 14) {
    const result = Array(values.length).fill(null);

    if (values.length <= period) return result;

    let gain = 0;
    let loss = 0;

    for (let i = 1; i <= period; i++) {
      const change = values[i] - values[i - 1];

      gain += Math.max(0, change);
      loss += Math.max(0, -change);
    }

    gain /= period;
    loss /= period;

    function value() {
      if (loss === 0) {
        return gain === 0 ? 50 : 100;
      }

      return 100 - 100 / (1 + gain / loss);
    }

    result[period] = value();

    for (let i = period + 1; i < values.length; i++) {
      const change = values[i] - values[i - 1];

      gain = (
        gain * (period - 1) +
        Math.max(0, change)
      ) / period;

      loss = (
        loss * (period - 1) +
        Math.max(0, -change)
      ) / period;

      result[i] = value();
    }

    return result;
  }

  function pivots(data, span = 3) {
    const result = [];

    for (let i = span; i < data.length - span; i++) {
      let high = true;
      let low = true;

      for (let j = i - span; j <= i + span; j++) {
        if (i === j) continue;

        if (data[j].high >= data[i].high) high = false;
        if (data[j].low <= data[i].low) low = false;
      }

      if (high) {
        result.push({
          index: i,
          time: data[i].time,
          price: Number(data[i].high),
          type: "H"
        });
      }

      if (low) {
        result.push({
          index: i,
          time: data[i].time,
          price: Number(data[i].low),
          type: "L"
        });
      }
    }

    return result.sort((a, b) => a.index - b.index);
  }

  function alternate(points) {
    const result = [];

    for (const point of points) {
      const last = result[result.length - 1];

      if (!last || last.type !== point.type) {
        result.push(point);
        continue;
      }

      const moreExtreme =
        point.type === "H"
          ? point.price > last.price
          : point.price < last.price;

      if (moreExtreme) {
        result[result.length - 1] = point;
      }
    }

    return result;
  }

  function add(
    key,
    label,
    points,
    direction,
    confirmed = false
  ) {
    if (!enabled.has(key) || !points.length) return;

    const id = [
      key,
      label,
      ...points.map(p => String(p.time))
    ].join("|");

    if (findings.some(item => item.id === id)) return;

    findings.push({
      id,
      key,
      label,
      points,
      direction,
      confirmed: Boolean(confirmed)
    });
  }

  function detectDouble(points, data) {
    for (const type of ["H", "L"]) {
      const list = points.filter(p => p.type === type).slice(-10);

      for (let i = 1; i < list.length; i++) {
        const a = list[i - 1];
        const b = list[i];

        const distance = b.index - a.index;

        if (distance < 5 || distance > 75) continue;

        const difference =
          Math.abs(a.price - b.price) /
          Math.max((a.price + b.price) / 2, 1e-12);

        if (difference > 0.008) continue;

        const between = data.slice(a.index + 1, b.index);

        if (!between.length) continue;

        const bearish = type === "H";

        const neckline = bearish
          ? Math.min(...between.map(x => x.low))
          : Math.max(...between.map(x => x.high));

        const depth =
          Math.abs(a.price - neckline) /
          Math.max(a.price, 1e-12);

        if (depth < 0.003) continue;

        // Confirmación solamente si existe ruptura
        // posterior al segundo extremo.
        const after = data.slice(b.index + 1);

        const confirmed = after.some(bar =>
          bearish
            ? bar.close < neckline
            : bar.close > neckline
        );

        add(
          bearish ? "doubletop" : "doublebottom",
          bearish ? "Doble techo" : "Doble suelo",
          [a, b],
          bearish ? "bear" : "bull",
          confirmed
        );
      }
    }
  }

  function detectWedges(points, data) {
    const highs = points.filter(p => p.type === "H");
    const lows = points.filter(p => p.type === "L");

    if (highs.length < 3 || lows.length < 3) return;

    const h = highs.slice(-3);
    const l = lows.slice(-3);

    const slopeH =
      (h[2].price - h[0].price) /
      Math.max(1, h[2].index - h[0].index);

    const slopeL =
      (l[2].price - l[0].price) /
      Math.max(1, l[2].index - l[0].index);

    const startIndex = Math.max(h[0].index, l[0].index);
    const endIndex = Math.max(h[2].index, l[2].index);
    const lastIndex = data.length - 1;

    function upperAt(index) {
      return h[2].price + slopeH * (index - h[2].index);
    }

    function lowerAt(index) {
      return l[2].price + slopeL * (index - l[2].index);
    }

    const firstWidth =
      upperAt(startIndex) - lowerAt(startIndex);

    const lastWidth =
      upperAt(endIndex) - lowerAt(endIndex);

    if (
      firstWidth <= 0 ||
      lastWidth <= 0 ||
      lastWidth >= firstWidth
    ) {
      return;
    }

    const descending =
      h[0].price > h[1].price &&
      h[1].price > h[2].price &&
      l[0].price > l[1].price &&
      l[1].price > l[2].price &&
      slopeH < slopeL &&
      slopeL < 0;

    const ascending =
      h[0].price < h[1].price &&
      h[1].price < h[2].price &&
      l[0].price < l[1].price &&
      l[1].price < l[2].price &&
      slopeH > 0 &&
      slopeL > slopeH;

    const used = [...h, ...l].sort(
      (a, b) => a.index - b.index
    );

    const after = data.slice(endIndex + 1);

    if (descending) {
      const confirmed = after.some((bar, offset) =>
        bar.close > upperAt(endIndex + 1 + offset)
      );

      add(
        "fallingwedge",
        "Cuña descendente",
        used,
        "bull",
        confirmed
      );
    }

    if (ascending) {
      const confirmed = after.some((bar, offset) =>
        bar.close < lowerAt(endIndex + 1 + offset)
      );

      add(
        "risingwedge",
        "Cuña ascendente",
        used,
        "bear",
        confirmed
      );
    }
  }

  function detectWaves(points) {
    const p = alternate(points).slice(-14);

    for (let i = 0; i <= p.length - 4; i++) {
      const q = p.slice(i, i + 4);

      const swings = [
        q[1].price - q[0].price,
        q[2].price - q[1].price,
        q[3].price - q[2].price
      ];

      const up =
        q[0].type === "L" &&
        q[1].type === "H" &&
        q[2].type === "L" &&
        q[3].type === "H" &&
        q[2].price > q[0].price &&
        q[3].price > q[1].price;

      const down =
        q[0].type === "H" &&
        q[1].type === "L" &&
        q[2].type === "H" &&
        q[3].type === "L" &&
        q[2].price < q[0].price &&
        q[3].price < q[1].price;

      if (up || down) {
        add(
          "impulses",
          "Posibles ondas 1 · 2 · 3",
          q,
          up ? "bull" : "bear",
          false
        );
      }

      const valid =
        Math.sign(swings[0]) === Math.sign(swings[2]) &&
        Math.sign(swings[0]) !== Math.sign(swings[1]) &&
        Math.abs(swings[1]) >= Math.abs(swings[0]) * 0.25;

      if (!valid || swings[0] === 0) continue;

      const direction = swings[2] > 0 ? "bull" : "bear";

      add(
        "abc",
        "Posible corrección ABC",
        q,
        direction,
        false
      );

      add(
        "zigzag",
        "Posible Zig-Zag",
        q,
        direction,
        false
      );

      const ratio = Math.abs(swings[1] / swings[0]);

      if (ratio >= 0.8 && ratio <= 1.2) {
        add(
          "flat",
          "Posible plana / Flat",
          q,
          direction,
          false
        );
      }
    }
  }

  function detectTriangles(points) {
    const p = alternate(points).slice(-12);

    for (let i = 0; i <= p.length - 6; i++) {
      const q = p.slice(i, i + 6);

      const h = q.filter(x => x.type === "H");
      const l = q.filter(x => x.type === "L");

      if (h.length !== 3 || l.length !== 3) continue;

      const upperDescending =
        h[0].price > h[1].price &&
        h[1].price > h[2].price;

      const lowerAscending =
        l[0].price < l[1].price &&
        l[1].price < l[2].price;

      if (!upperDescending || !lowerAscending) continue;

      const firstWidth = h[0].price - l[0].price;
      const lastWidth = h[2].price - l[2].price;

      if (
        firstWidth <= 0 ||
        lastWidth <= 0 ||
        lastWidth >= firstWidth
      ) {
        continue;
      }

      add(
        "abcde",
        "Posible triángulo ABCDE",
        q.slice(1),
        "neutral",
        false
      );
    }
  }

  function detectDivergences(points, data) {
    const values = rsi(data.map(x => Number(x.close)));

    for (const type of ["H", "L"]) {
      const list = points.filter(p => p.type === type).slice(-12);

      for (let i = 1; i < list.length; i++) {
        const a = list[i - 1];
        const b = list[i];

        const ra = values[a.index];
        const rb = values[b.index];

        if (!Number.isFinite(ra) || !Number.isFinite(rb)) {
          continue;
        }

        const bearish =
          type === "H" &&
          b.price > a.price &&
          rb < ra - 2;

        const bullish =
          type === "L" &&
          b.price < a.price &&
          rb > ra + 2;

        if (!bearish && !bullish) continue;

        add(
          "divergences",
          bullish
            ? "Divergencia alcista RSI"
            : "Divergencia bajista RSI",
          [a, b],
          bullish ? "bull" : "bear",
          false
        );
      }
    }
  }

  function detectHeadShoulders(points) {
    const p = alternate(points).slice(-16);

    for (let i = 0; i <= p.length - 5; i++) {
      const q = p.slice(i, i + 5);

      for (const inverse of [false, true]) {
        const outer = inverse ? "L" : "H";
        const inner = inverse ? "H" : "L";

        if (
          q[0].type !== outer ||
          q[1].type !== inner ||
          q[2].type !== outer ||
          q[3].type !== inner ||
          q[4].type !== outer
        ) {
          continue;
        }

        const head = inverse
          ? q[2].price < Math.min(q[0].price, q[4].price)
          : q[2].price > Math.max(q[0].price, q[4].price);

        const shoulders =
          Math.abs(q[0].price - q[4].price) /
          Math.max(Math.abs(q[2].price), 1e-12) < 0.025;

        if (!head || !shoulders) continue;

        add(
          inverse ? "inversehs" : "headshoulders",
          inverse ? "Posible HCH invertido" : "Posible HCH",
          q,
          inverse ? "bull" : "bear",
          false
        );
      }
    }
  }

  function detectTriple(points) {
    for (const type of ["H", "L"]) {
      const p = points.filter(x => x.type === type).slice(-12);

      for (let i = 2; i < p.length; i++) {
        const q = p.slice(i - 2, i + 1);

        const max = Math.max(...q.map(x => x.price));
        const min = Math.min(...q.map(x => x.price));

        if ((max - min) / Math.max(max, 1e-12) > 0.008) {
          continue;
        }

        add(
          "triple",
          type === "H"
            ? "Posible triple techo"
            : "Posible triple suelo",
          q,
          type === "H" ? "bear" : "bull",
          false
        );
      }
    }
  }

  function detectSqueeze(data) {
    if (data.length < 45) return;

    const closes = data.map(x => Number(x.close));
    const basis = sma(closes, 20);

    const i = data.length - 1;
    const mean = basis[i];

    if (!Number.isFinite(mean)) return;

    const sample = closes.slice(i - 19, i + 1);

    const variance = sample.reduce(
      (sum, value) => sum + (value - mean) ** 2,
      0
    ) / 20;

    const deviation = Math.sqrt(variance);

    const trueRanges = data.map((bar, j) => {
      if (j === 0) return bar.high - bar.low;

      return Math.max(
        bar.high - bar.low,
        Math.abs(bar.high - data[j - 1].close),
        Math.abs(bar.low - data[j - 1].close)
      );
    });

    const atr = sma(trueRanges, 20)[i];

    if (!Number.isFinite(atr) || atr <= 0) return;

    // Aproximación simplificada; no equivale
    // al Squeeze Momentum completo de TradingView.
    if (4 * deviation >= 3 * atr) return;

    add(
      "squeeze",
      "Compresión Squeeze · sin ruptura",
      [{
        index: i,
        time: data[i].time,
        price: data[i].close
      }],
      "neutral",
      false
    );
  }

  function detectOrderBlocks(data) {
    if (data.length < 25) return;

    for (
      let i = Math.max(20, data.length - 45);
      i < data.length - 1;
      i++
    ) {
      const previous = data.slice(i - 15, i);
      const bar = data[i];
      const next = data[i + 1];

      const average = previous.reduce(
        (sum, x) => sum + (Number(x.volume) || 0),
        0
      ) / previous.length;

      if (
        average <= 0 ||
        (Number(next.volume) || 0) < average * 1.5
      ) {
        continue;
      }

      const bullish =
        bar.close < bar.open &&
        next.close > next.open &&
        next.close > bar.high;

      const bearish =
        bar.close > bar.open &&
        next.close < next.open &&
        next.close < bar.low;

      if (!bullish && !bearish) continue;

      add(
        "orderblocks",
        bullish
          ? "Posible bloque comprador"
          : "Posible bloque vendedor",
        [{
          index: i,
          time: bar.time,
          price: (bar.high + bar.low) / 2
        }],
        bullish ? "bull" : "bear",
        false
      );
    }
  }

  function updateStatus(message) {
    const element = $("patternStatus");

    if (element) element.textContent = message;
  }

  function analyze() {
    findings = [];

    const data = closedRows();

    if (data.length < 65) {
      updateStatus(
        "Esperando al menos sesenta y cinco velas cerradas."
      );

      renderPanel();
      redraw();
      publish();
      return [];
    }

    const points = pivots(data);

    detectDouble(points, data);
    detectWedges(points, data);
    detectWaves(points);
    detectTriangles(points);
    detectDivergences(points, data);
    detectHeadShoulders(points);
    detectTriple(points);
    detectSqueeze(data);
    detectOrderBlocks(data);

    findings.sort((a, b) => {
      const aIndex = a.points.at(-1)?.index ?? -1;
      const bIndex = b.points.at(-1)?.index ?? -1;

      return bIndex - aIndex;
    });

    findings = findings.slice(0, 35);

    const confirmed = findings.filter(
      finding => finding.confirmed
    ).length;

    updateStatus(
      findings.length
        ? `${findings.length} estructuras detectadas · ${confirmed} con confirmación básica.`
        : "Sin estructuras detectadas con los filtros actuales."
    );

    renderPanel();
    redraw();
    publish();

    return getFindings();
  }

  function getFindings() {
    return findings.map(finding => ({
      key: finding.key,
      label: finding.label,
      direction: finding.direction,
      confirmed: finding.confirmed,
      points: finding.points.map(point => ({ ...point }))
    }));
  }

  function publish() {
    window.dispatchEvent(
      new CustomEvent(
        "cryptolexuz:patterns-updated",
        {
          detail: {
            findings: getFindings()
          }
        }
      )
    );
  }

  function formatPrice(value) {
    const number = Number(value);
    const absolute = Math.abs(number);

    const digits =
      absolute >= 100 ? 2 :
      absolute >= 1 ? 4 : 6;

    return number.toLocaleString("en-US", {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits
    });
  }

  function redraw() {
    if (frame) return;

    frame = requestAnimationFrame(() => {
      frame = 0;
      paint();
    });
  }

  function coordinate(point, indexByTime) {
    if (!chart || !candle) return null;

    const index = indexByTime.get(
      String(unixTime(point.time))
    );

    if (index === undefined) return null;

    let x = null;
    let y = null;

    try {
      x = chart.timeScale().logicalToCoordinate(index);
      y = candle.priceToCoordinate(point.price);
    } catch {
      return null;
    }

    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return null;
    }

    return { x, y };
  }

  function line(ctx, a, b, color, dashed = false, width = 1.5) {
    if (!a || !b) return;

    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.setLineDash(dashed ? [5, 4] : []);

    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.restore();
  }

  function label(ctx, text, point, color, above = true) {
    if (!point) return;

    ctx.save();
    ctx.font = "bold 11px system-ui";

    const textWidth = ctx.measureText(text).width;

    const x = Math.max(
      4,
      Math.min(
        ctx.canvas.clientWidth - textWidth - 8,
        point.x - textWidth / 2
      )
    );

    const y = above ? point.y - 12 : point.y + 18;

    ctx.fillStyle = "rgba(0,0,0,.9)";
    ctx.fillRect(x - 3, y - 12, textWidth + 6, 16);

    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
    ctx.restore();
  }

  function drawWedge(ctx, finding, indexByTime) {
    const highs = finding.points.filter(p => p.type === "H");
    const lows = finding.points.filter(p => p.type === "L");

    if (highs.length < 2 || lows.length < 2) return;

    const color = COLORS[finding.direction] || COLORS.neutral;

    line(
      ctx,
      coordinate(highs[0], indexByTime),
      coordinate(highs.at(-1), indexByTime),
      color,
      !finding.confirmed,
      2
    );

    line(
      ctx,
      coordinate(lows[0], indexByTime),
      coordinate(lows.at(-1), indexByTime),
      color,
      !finding.confirmed,
      2
    );
  }

  function drawFinding(ctx, finding, indexByTime) {
    const color = COLORS[finding.direction] || COLORS.neutral;

    if (
      finding.key === "fallingwedge" ||
      finding.key === "risingwedge"
    ) {
      drawWedge(ctx, finding, indexByTime);
      return;
    }

    if (
      finding.key === "squeeze" ||
      finding.key === "orderblocks"
    ) {
      return;
    }

    const points = finding.points.map(
      point => coordinate(point, indexByTime)
    );

    if (points.some(point => !point)) return;

    const wave = [
      "impulses",
      "abc",
      "zigzag",
      "flat",
      "abcde"
    ].includes(finding.key);

    for (let i = 1; i < points.length; i++) {
      line(
        ctx,
        points[i - 1],
        points[i],
        color,
        !finding.confirmed,
        wave ? 1.6 : 1.3
      );
    }

    if (!wave) return;

    const labels =
      finding.key === "impulses"
        ? ["", "1", "2", "3"]
        : finding.key === "abcde"
          ? ["A", "B", "C", "D", "E"]
          : ["", "A", "B", "C"];

    points.forEach((point, i) => {
      if (!labels[i]) return;

      label(
        ctx,
        labels[i],
        point,
        color,
        finding.points[i].type === "H"
      );
    });
  }

  function drawExtremes(ctx, data, indexByTime, width, height) {
    const closed = closedRows();

    if (!closed.length) return;

    let start = 0;
    let end = closed.length - 1;

    try {
      const range = chart.timeScale().getVisibleLogicalRange();

      if (range) {
        start = Math.max(0, Math.floor(range.from));
        end = Math.min(end, Math.ceil(range.to));
      }
    } catch (_) {}

    if (end < start) return;

    const section = closed.slice(start, end + 1);

    if (!section.length) return;

    let max = section[0];
    let min = section[0];

    for (const bar of section) {
      if (bar.high > max.high) max = bar;
      if (bar.low < min.low) min = bar;
    }

    const extremes = [
      {
        point: {
          time: max.time,
          price: max.high
        },
        text: "MAX " + formatPrice(max.high),
        color: COLORS.bull,
        above: true
      },
      {
        point: {
          time: min.time,
          price: min.low
        },
        text: "MIN " + formatPrice(min.low),
        color: COLORS.bear,
        above: false
      }
    ];

    for (const item of extremes) {
      const point = coordinate(item.point, indexByTime);

      if (!point) continue;

      ctx.save();
      ctx.font = "bold 11px system-ui";

      const textWidth = ctx.measureText(item.text).width;

      const x = Math.max(
        5,
        Math.min(width - textWidth - 13, point.x - textWidth / 2)
      );

      const y = Math.max(
        3,
        Math.min(
          height - 22,
          item.above ? point.y - 28 : point.y + 13
        )
      );

      ctx.fillStyle = "rgba(0,0,0,.94)";
      ctx.strokeStyle = item.color;
      ctx.lineWidth = 1;

      ctx.fillRect(x - 4, y, textWidth + 8, 20);
      ctx.strokeRect(x - 4, y, textWidth + 8, 20);

      ctx.fillStyle = item.color;
      ctx.fillText(item.text, x, y + 14);
      ctx.restore();
    }
  }

  function paint() {
    if (!canvas || !chart || !candle) return;

    const rect = canvas.getBoundingClientRect();

    if (!rect.width || !rect.height) return;

    const ratio = Math.min(window.devicePixelRatio || 1, 2);

    const width = Math.round(rect.width * ratio);
    const height = Math.round(rect.height * ratio);

    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;

    const ctx = canvas.getContext("2d");

    if (!ctx) return;

    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, rect.width, rect.height);

    const data = rows();

    if (!data.length) return;

    const indexByTime = new Map(
      data.map((bar, index) => [
        String(unixTime(bar.time)),
        index
      ])
    );

    const displayed = [];
    const used = new Set();

    for (const finding of findings) {
      const group = ["abc", "zigzag", "flat"].includes(
        finding.key
      )
        ? "correction"
        : finding.key;

      if (used.has(group)) continue;

      used.add(group);
      displayed.push(finding);

      if (displayed.length >= 4) break;
    }

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, rect.width, rect.height);
    ctx.clip();

    displayed.reverse().forEach(finding => {
      drawFinding(ctx, finding, indexByTime);
    });

    drawExtremes(
      ctx,
      data,
      indexByTime,
      rect.width,
      rect.height
    );

    ctx.restore();
  }

  function renderPanel() {
    const area = $("chartSection");

    if (!area) return;

    let panel = $("clPatternResults");

    if (!panel) {
      panel = document.createElement("section");
      panel.id = "clPatternResults";

      panel.style.cssText = [
        "margin:14px 0",
        "padding:13px",
        "background:#101a32",
        "border:1px solid #35416e",
        "border-radius:12px",
        "color:#dce6ff"
      ].join(";");

      const title = document.createElement("h3");
      title.textContent = "Patrones detectados";
      title.style.cssText = "font-size:15px;margin:0 0 9px";

      const body = document.createElement("div");
      body.id = "clPatternResultsBody";

      panel.append(title, body);
      area.appendChild(panel);
    }

    const body = $("clPatternResultsBody");

    if (!body) return;

    body.replaceChildren();

    if (!findings.length) {
      const note = document.createElement("p");

      note.textContent =
        "Sin patrones activos detectados. Activa los filtros desde el menú.";

      note.style.cssText = "font-size:12px;color:#aebcdd";

      body.appendChild(note);
      return;
    }

    for (const finding of findings.slice(0, 8)) {
      const item = document.createElement("div");

      item.style.cssText = [
        "padding:9px 0",
        "border-bottom:1px solid #293754",
        "font-size:12px",
        "line-height:1.5"
      ].join(";");

      const direction =
        finding.direction === "bull"
          ? "Alcista"
          : finding.direction === "bear"
            ? "Bajista"
            : "Neutral";

      item.textContent = [
        finding.label,
        direction,
        finding.confirmed
          ? "Confirmación básica"
          : "En observación"
      ].join(" · ");

      body.appendChild(item);
    }
  }

  function setupButtons() {
    document.querySelectorAll("[data-pattern]").forEach(
      button => {
        const key = button.dataset.pattern;

        if (!NAMES[key]) return;

        const available = key !== "diagonal";

        button.disabled = !available;

        button.classList.toggle("active", enabled.has(key));

        button.setAttribute(
          "aria-pressed",
          String(enabled.has(key))
        );
      }
    );
  }

  function buildUI() {
    if (initialized) return;

    const area = $("priceChartArea");

    if (!area) return;

    initialized = true;
    area.style.position = "relative";

    canvas =
      $("patternsCanvas") ||
      document.createElement("canvas");

    canvas.id = "patternsCanvas";

    canvas.style.cssText = [
      "position:absolute",
      "inset:0",
      "width:100%",
      "height:100%",
      "z-index:7",
      "pointer-events:none"
    ].join(";");

    if (canvas.parentElement !== area) {
      area.appendChild(canvas);
    }

    if (window.ResizeObserver) {
      resizeObserver = new ResizeObserver(redraw);
      resizeObserver.observe(area);
    }

    window.addEventListener("resize", redraw);

    document.addEventListener("click", event => {
      const button = event.target.closest?.("[data-pattern]");

      if (!button || button.disabled) return;

      const key = button.dataset.pattern;

      if (!NAMES[key] || key === "diagonal") return;

      if (enabled.has(key)) {
        enabled.delete(key);
      } else {
        enabled.add(key);
      }

      save();
      setupButtons();
      analyze();
    });

    for (const id of [
      "symbol",
      "interval",
      "exchange",
      "market"
    ]) {
      $(id)?.addEventListener("change", () => {
        findings = [];
        redraw();
        renderPanel();

        updateStatus(
          "Cambiando mercado. Esperando velas cerradas."
        );
      });
    }

    setupButtons();

    updateStatus(
      "Motor preparado. Esperando conexión con las velas."
    );
  }

  function attach(newChart, newCandle, options = {}) {
    if (!newChart || !newCandle) return;

    if (
      subscribedChart &&
      subscribedChart !== newChart
    ) {
      try {
        subscribedChart.timeScale()
          .unsubscribeVisibleLogicalRangeChange(redraw);
      } catch (_) {}

      subscribedChart = null;
    }

    chart = newChart;
    candle = newCandle;

    if (typeof options.getRows === "function") {
      getRows = options.getRows;
    }

    if (typeof options.getSelection === "function") {
      getSelection = options.getSelection;
    }

    buildUI();

    if (subscribedChart !== newChart) {
      try {
        chart.timeScale()
          .subscribeVisibleLogicalRangeChange(redraw);

        subscribedChart = newChart;
      } catch (error) {
        console.warn("Patrones: suscripción", error);
      }
    }

    analyze();
  }

  function attachFromGlobal() {
    const api = window.CryptolexuzChart;

    if (!api) return false;

    const newChart = api.chart || api.chartApi;
    const newCandle = api.candle || api.candleSeries;

    if (!newChart || !newCandle) return false;

    attach(newChart, newCandle, {
      getRows:
        typeof api.getRows === "function"
          ? api.getRows
          : api.getCandles,

      getSelection: api.getSelection
    });

    return true;
  }

  load();

  window.CryptolexuzPatterns = {
    version: "3",
    attach,
    analyze,
    redraw,
    getFindings,
    getEnabled: () => [...enabled],

    setEnabled(key, value) {
      if (!NAMES[key] || key === "diagonal") {
        return false;
      }

      if (value) enabled.add(key);
      else enabled.delete(key);

      save();
      setupButtons();
      analyze();

      return true;
    }
  };

  window.addEventListener(
    "cryptolexuz:chart-ready",
    event => {
      const detail = event.detail || {};

      const newChart = detail.chart || detail.chartApi;
      const newCandle = detail.candle || detail.candleSeries;

      if (newChart && newCandle) {
        attach(newChart, newCandle, {
          getRows: detail.getRows,
          getSelection: detail.getSelection
        });
      } else {
        attachFromGlobal();
      }
    }
  );

  window.addEventListener(
    "cryptolexuz:candles-updated",
    event => {
      if (Array.isArray(event.detail?.rows)) {
        const data = event.detail.rows;
        getRows = () => data;
      }

      analyze();
    }
  );

  window.addEventListener(
    "cryptolexuz:screen-change",
    redraw
  );

  if (document.readyState === "loading") {
    document.addEventListener(
      "DOMContentLoaded",
      () => {
        buildUI();
        attachFromGlobal();
      },
      { once: true }
    );
  } else {
    buildUI();
    attachFromGlobal();
  }

  console.info(
    "CRYPTOLEXUZ PRO — Patterns V3 cargado"
  );
})();
