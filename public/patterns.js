
/*
 CRYPTOLEXUZ PRO — PATTERNS.JS V2

 Compatible con:
 - app.js V15
 - patterns-bridge.js V1
 - Lightweight Charts 4.2.2

 Mejoras:
 - MAX y MIN con precio exacto
 - Ondas con letras y números cortos
 - Sin textos largos sobre las velas
 - Cuñas con dos directrices
 - Panel separado de patrones
 - Análisis con velas cerradas

 No ejecuta operaciones reales.
 Los patrones son hipótesis técnicas.
*/

"use strict";

(() => {
  const $ = id => document.getElementById(id);

  const STORE = "cryptolexuz_patterns_v1";

  const COLORS = {
    bull: "#00f5a0",
    bear: "#ff476c",
    neutral: "#ffe15a",
    text: "#ffffff",
    background: "#081020"
  };

  const NAMES = {
    divergences: "Divergencias RSI",
    squeeze: "Squeeze Momentum",
    orderblocks: "Order Blocks",
    fallingwedge: "Cuña descendente",
    impulses: "Ondas 1 · 2 · 3",
    abc: "Corrección A · B · C",
    abcde: "Triángulo A · B · C · D · E",
    zigzag: "Zig-Zag",
    flat: "Plana / Flat",
    diagonal: "Diagonal",
    doubletop: "Doble techo",
    doublebottom: "Doble suelo",
    headshoulders: "Hombro-cabeza-hombro",
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
  let priceScaleObserver = null;

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
        ? data
        : [];
    } catch (_) {
      return [];
    }
  }

  function tfSeconds(tf) {
    return {
      "1m": 60,
      "3m": 180,
      "5m": 300,
      "15m": 900,
      "30m": 1800,
      "1h": 3600,
      "2h": 7200,
      "4h": 14400,
      "1d": 86400,
      "1w": 604800
    }[tf] || 900;
  }

  function closedRows() {
    const data = rows();

    if (!data.length) return [];

    const tf = getSelection()?.tf || "15m";
    const seconds = tfSeconds(tf);
    const last = data.at(-1);

    if (
      Number(last.time) + seconds >
      Date.now() / 1000
    ) {
      return data.slice(0, -1);
    }

    return data;
  }

  function sma(data, period) {
    return data.map((_, i) => {
      if (i < period - 1) return null;

      let sum = 0;

      for (
        let j = i - period + 1;
        j <= i;
        j++
      ) {
        sum += data[j];
      }

      return sum / period;
    });
  }

  function rsi(data, period = 14) {
    const result =
      Array(data.length).fill(null);

    if (data.length <= period) {
      return result;
    }

    let gain = 0;
    let loss = 0;

    for (let i = 1; i <= period; i++) {
      const delta = data[i] - data[i - 1];

      gain += Math.max(delta, 0);
      loss += Math.max(-delta, 0);
    }

    gain /= period;
    loss /= period;

    function calculate() {
      if (loss === 0) {
        return gain === 0 ? 50 : 100;
      }

      return 100 - 100 / (1 + gain / loss);
    }

    result[period] = calculate();

    for (
      let i = period + 1;
      i < data.length;
      i++
    ) {
      const delta = data[i] - data[i - 1];

      gain = (
        gain * (period - 1) +
        Math.max(delta, 0)
      ) / period;

      loss = (
        loss * (period - 1) +
        Math.max(-delta, 0)
      ) / period;

      result[i] = calculate();
    }

    return result;
  }

  function pivots(data, span = 3) {
    const result = [];

    for (
      let i = span;
      i < data.length - span;
      i++
    ) {
      let high = true;
      let low = true;

      for (
        let j = i - span;
        j <= i + span;
        j++
      ) {
        if (i === j) continue;

        if (
          data[j].high >= data[i].high
        ) {
          high = false;
        }

        if (
          data[j].low <= data[i].low
        ) {
          low = false;
        }
      }

      if (high) {
        result.push({
          index: i,
          time: data[i].time,
          price: data[i].high,
          type: "H"
        });
      }

      if (low) {
        result.push({
          index: i,
          time: data[i].time,
          price: data[i].low,
          type: "L"
        });
      }
    }

    return result.sort(
      (a, b) => a.index - b.index
    );
  }

  function alternate(points) {
    const result = [];

    for (const point of points) {
      const last = result.at(-1);

      if (
        !last ||
        last.type !== point.type
      ) {
        result.push(point);
      } else {
        const extreme =
          point.type === "H"
            ? point.price > last.price
            : point.price < last.price;

        if (extreme) {
          result[result.length - 1] =
            point;
        }
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
    if (!enabled.has(key)) return;

    const id =
      key + "|" +
      points.map(p => p.time).join("|");

    if (
      findings.some(f => f.id === id)
    ) {
      return;
    }

    findings.push({
      id,
      key,
      label,
      points,
      direction,
      confirmed
    });
  }

  function detectDouble(points, data) {
    const highs =
      points.filter(p => p.type === "H");

    const lows =
      points.filter(p => p.type === "L");

    function inspect(
      list,
      key,
      direction
    ) {
      for (
        let i = 1;
        i < list.length;
        i++
      ) {
        const a = list[i - 1];
        const b = list[i];

        if (
          b.index - a.index < 5 ||
          b.index - a.index > 75
        ) {
          continue;
        }

        const difference =
          Math.abs(a.price - b.price) /
          ((a.price + b.price) / 2);

        if (difference > 0.008) {
          continue;
        }

        const between = data.slice(
          a.index + 1,
          b.index
        );

        if (!between.length) continue;

        const neckline =
          direction === "bear"
            ? Math.min(
                ...between.map(x => x.low)
              )
            : Math.max(
                ...between.map(x => x.high)
              );

        const depth =
          Math.abs(a.price - neckline) /
          a.price;

        if (depth < 0.003) continue;

        const last = data.at(-1);

        const confirmed =
          direction === "bear"
            ? last.close < neckline
            : last.close > neckline;

        add(
          key,
          NAMES[key],
          [a, b],
          direction,
          confirmed
        );
      }
    }

    inspect(
      highs.slice(-8),
      "doubletop",
      "bear"
    );

    inspect(
      lows.slice(-8),
      "doublebottom",
      "bull"
    );
  }

  function detectWedges(points, data) {
    const highs =
      points.filter(p => p.type === "H");

    const lows =
      points.filter(p => p.type === "L");

    if (
      highs.length < 3 ||
      lows.length < 3
    ) {
      return;
    }

    const h = highs.slice(-3);
    const l = lows.slice(-3);

    const descending =
      h[0].price > h[1].price &&
      h[1].price > h[2].price &&
      l[0].price > l[1].price &&
      l[1].price > l[2].price;

    const ascending =
      h[0].price < h[1].price &&
      h[1].price < h[2].price &&
      l[0].price < l[1].price &&
      l[1].price < l[2].price;

    const slopeH =
      (h[2].price - h[0].price) /
      (h[2].index - h[0].index);

    const slopeL =
      (l[2].price - l[0].price) /
      (l[2].index - l[0].index);

    const lastIndex =
      data.length - 1;

    const last = data[lastIndex];

    const upper =
      h[2].price +
      slopeH *
      (lastIndex - h[2].index);

    const lower =
      l[2].price +
      slopeL *
      (lastIndex - l[2].index);

    const firstWidth =
      h[0].price - l[0].price;

    const finalWidth =
      upper - lower;

    if (
      !Number.isFinite(finalWidth) ||
      firstWidth <= 0 ||
      finalWidth <= 0 ||
      finalWidth >= firstWidth
    ) {
      return;
    }

    const pointsUsed = [
      ...h,
      ...l
    ].sort(
      (a, b) => a.index - b.index
    );

    if (
      descending &&
      slopeL > slopeH
    ) {
      add(
        "fallingwedge",
        "Cuña descendente",
        pointsUsed,
        "bull",
        last.close > upper
      );
    }

    if (
      ascending &&
      slopeL > slopeH
    ) {
      add(
        "risingwedge",
        "Cuña ascendente",
        pointsUsed,
        "bear",
        last.close < lower
      );
    }
  }

  function detectWaves(points) {
    const p =
      alternate(points).slice(-12);

    for (
      let i = 0;
      i <= p.length - 4;
      i++
    ) {
      const q = p.slice(i, i + 4);

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
    }

    for (
      let i = 0;
      i <= p.length - 4;
      i++
    ) {
      const q = p.slice(i, i + 4);

      const swings = [
        q[1].price - q[0].price,
        q[2].price - q[1].price,
        q[3].price - q[2].price
      ];

      const valid =
        Math.sign(swings[0]) ===
          Math.sign(swings[2]) &&
        Math.sign(swings[0]) !==
          Math.sign(swings[1]) &&
        Math.abs(swings[1]) >=
          Math.abs(swings[0]) * 0.25;

      if (!valid) continue;

      const direction =
        swings[2] > 0
          ? "bull"
          : "bear";

      add(
        "abc",
        "Posible corrección A · B · C",
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

      const flatRatio =
        Math.abs(
          swings[1] / swings[0]
        );

      if (
        flatRatio >= 0.8 &&
        flatRatio <= 1.2
      ) {
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
    const p =
      alternate(points).slice(-10);

    for (
      let i = 0;
      i <= p.length - 6;
      i++
    ) {
      const q = p.slice(i, i + 6);

      const h =
        q.filter(x => x.type === "H");

      const l =
        q.filter(x => x.type === "L");

      if (
        h.length !== 3 ||
        l.length !== 3
      ) {
        continue;
      }

      const upperDescending =
        h[0].price > h[1].price &&
        h[1].price > h[2].price;

      const lowerAscending =
        l[0].price < l[1].price &&
        l[1].price < l[2].price;

      if (
        !upperDescending ||
        !lowerAscending
      ) {
        continue;
      }

      const firstWidth =
        h[0].price - l[0].price;

      const lastWidth =
        h[2].price - l[2].price;

      if (
        firstWidth <= 0 ||
        lastWidth <= 0 ||
        lastWidth >= firstWidth
      ) {
        continue;
      }

      add(
        "abcde",
        "Posible triángulo A · B · C · D · E",
        q.slice(1),
        "neutral",
        false
      );
    }
  }

  function detectDivergences(
    points,
    data
  ) {
    const values =
      rsi(data.map(x => x.close));

    for (const type of ["H", "L"]) {
      const list =
        points.filter(
          p => p.type === type
        );

      for (
        let i = 1;
        i < list.length;
        i++
      ) {
        const a = list[i - 1];
        const b = list[i];

        const ra = values[a.index];
        const rb = values[b.index];

        if (
          !Number.isFinite(ra) ||
          !Number.isFinite(rb)
        ) {
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

        if (
          bearish ||
          bullish
        ) {
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
  }

  function detectHeadShoulders(points) {
    const p =
      alternate(points).slice(-14);

    for (
      let i = 0;
      i <= p.length - 5;
      i++
    ) {
      const q = p.slice(i, i + 5);

      for (
        const inverse of [false, true]
      ) {
        const outer =
          inverse ? "L" : "H";

        if (
          q[0].type !== outer ||
          q[2].type !== outer ||
          q[4].type !== outer
        ) {
          continue;
        }

        const head =
          inverse
            ? q[2].price < q[0].price &&
              q[2].price < q[4].price
            : q[2].price > q[0].price &&
              q[2].price > q[4].price;

        const shoulders =
          Math.abs(
            q[0].price - q[4].price
          ) / q[2].price < 0.025;

        if (
          head &&
          shoulders
        ) {
          add(
            inverse
              ? "inversehs"
              : "headshoulders",
            inverse
              ? "Posible HCH invertido"
              : "Posible hombro-cabeza-hombro",
            q,
            inverse ? "bull" : "bear",
            false
          );
        }
      }
    }
  }

  function detectTriple(points) {
    for (
      const type of ["H", "L"]
    ) {
      const p =
        points.filter(
          x => x.type === type
        );

      for (
        let i = 2;
        i < p.length;
        i++
      ) {
        const q =
          p.slice(i - 2, i + 1);

        const max =
          Math.max(
            ...q.map(x => x.price)
          );

        const min =
          Math.min(
            ...q.map(x => x.price)
          );

        if (
          (max - min) / max > 0.008
        ) {
          continue;
        }

        add(
          "triple",
          type === "H"
            ? "Posible triple techo"
            : "Posible triple suelo",
          q,
          type === "H"
            ? "bear"
            : "bull",
          false
        );
      }
    }
  }

  function detectSqueeze(data) {
    if (data.length < 45) return;

    const closes =
      data.map(x => x.close);

    const basis =
      sma(closes, 20);

    const i =
      data.length - 1;

    const windowData =
      closes.slice(
        i - 19,
        i + 1
      );

    const mean = basis[i];

    if (
      !Number.isFinite(mean)
    ) {
      return;
    }

    const variance =
      windowData.reduce(
        (sum, x) =>
          sum + (x - mean) ** 2,
        0
      ) / 20;

    const deviation =
      Math.sqrt(variance);

    const tr =
      data.map((x, j) => {
        if (j === 0) {
          return x.high - x.low;
        }

        return Math.max(
          x.high - x.low,
          Math.abs(
            x.high -
            data[j - 1].close
          ),
          Math.abs(
            x.low -
            data[j - 1].close
          )
        );
      });

    const atr =
      sma(tr, 20)[i];

    if (
      !Number.isFinite(atr) ||
      atr <= 0
    ) {
      return;
    }

    const bbWidth =
      4 * deviation;

    const kcWidth =
      3 * atr;

    if (
      bbWidth >= kcWidth
    ) {
      return;
    }

    add(
      "squeeze",
      "Compresión Squeeze · sin ruptura",
      [{
        time: data[i].time,
        price: data[i].close,
        index: i
      }],
      "neutral",
      false
    );
  }

  function detectOrderBlocks(data) {
    if (
      data.length < 25
    ) {
      return;
    }

    for (
      let i = Math.max(
        20,
        data.length - 45
      );
      i < data.length - 2;
      i++
    ) {
      const previous =
        data.slice(i - 15, i);

      const bar = data[i];
      const next = data[i + 1];

      const average =
        previous.reduce(
          (sum, x) =>
            sum + x.volume,
          0
        ) / previous.length;

      if (
        average <= 0 ||
        next.volume <
          average * 1.5
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

      if (
        !bullish &&
        !bearish
      ) {
        continue;
      }

      add(
        "orderblocks",
        bullish
          ? "Posible bloque comprador"
          : "Posible bloque vendedor",
        [{
          time: bar.time,
          price:
            (bar.high + bar.low) / 2,
          index: i
        }],
        bullish ? "bull" : "bear",
        false
      );
    }
  }

  function analyze() {
    findings = [];

    const data =
      closedRows();

    if (
      data.length < 65
    ) {
      updateStatus(
        "Esperando suficientes velas cerradas."
      );

      renderPanel();
      redraw();

      return [];
    }

    const points =
      pivots(data);

    detectDouble(points, data);
    detectWedges(points, data);
    detectWaves(points);
    detectTriangles(points);
    detectDivergences(points, data);
    detectHeadShoulders(points);
    detectTriple(points);
    detectSqueeze(data);
    detectOrderBlocks(data);

    findings = findings
      .sort((a, b) => {
        const ta =
          a.points.at(-1)?.time || 0;

        const tb =
          b.points.at(-1)?.time || 0;

        return tb - ta;
      })
      .slice(0, 35);

    const confirmed =
      findings.filter(
        x => x.confirmed
      ).length;

    updateStatus(
      findings.length
        ? findings.length +
          " estructuras detectadas · " +
          confirmed +
          " con confirmación básica."
        : "Sin estructuras detectadas con los filtros actuales."
    );

    renderPanel();
    redraw();

    window.dispatchEvent(
      new CustomEvent(
        "cryptolexuz:patterns-updated",
        {
          detail: {
            findings:
              findings.map(x => ({
                key: x.key,
                label: x.label,
                direction: x.direction,
                confirmed: x.confirmed
              }))
          }
        }
      )
    );

    return findings;
  }

  function updateStatus(text) {
    const el =
      $("patternStatus");

    if (el) {
      el.textContent = text;
    }
  }

  function priceDigits(value) {
    const n =
      Math.abs(Number(value));

    if (n >= 100) return 2;
    if (n >= 1) return 4;
    return 6;
  }

  function formatPrice(value) {
    return Number(value).toLocaleString(
      "en-US",
      {
        minimumFractionDigits:
          priceDigits(value),
        maximumFractionDigits:
          priceDigits(value)
      }
    );
  }

  function redraw() {
    if (frame) return;

    frame = requestAnimationFrame(
      () => {
        frame = 0;
        paint();
      }
    );
  }

  function coord(point, indexByTime) {
    const index =
      indexByTime.get(
        Number(point.time)
      );

    if (
      index === undefined
    ) {
      return null;
    }

    const x =
      chart.timeScale()
        .logicalToCoordinate(index);

    const y =
      candle.priceToCoordinate(
        point.price
      );

    if (
      !Number.isFinite(x) ||
      !Number.isFinite(y)
    ) {
      return null;
    }

    return { x, y };
  }

  function line(
    ctx,
    a,
    b,
    color,
    dashed = false,
    thickness = 1.5
  ) {
    if (
      !a ||
      !b
    ) {
      return;
    }

    ctx.save();

    ctx.strokeStyle = color;
    ctx.lineWidth = thickness;

    ctx.setLineDash(
      dashed ? [5, 4] : []
    );

    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();

    ctx.restore();
  }

  function dot(
    ctx,
    p,
    color
  ) {
    if (!p) return;

    ctx.beginPath();
    ctx.arc(
      p.x,
      p.y,
      2.5,
      0,
      Math.PI * 2
    );

    ctx.fillStyle = color;
    ctx.fill();
  }

  function shortLabel(
    ctx,
    text,
    point,
    color,
    above = true
  ) {
    if (!point) return;

    ctx.save();

    ctx.font =
      "bold 11px system-ui";

    const width =
      ctx.measureText(text).width;

    const x = Math.max(
      3,
      Math.min(
        ctx.canvas.clientWidth -
          width - 6,
        point.x - width / 2
      )
    );

    const y = above
      ? point.y - 10
      : point.y + 18;

    ctx.fillStyle =
      "rgba(6,10,24,.88)";

    ctx.fillRect(
      x - 3,
      y - 12,
      width + 6,
      16
    );

    ctx.fillStyle = color;
    ctx.fillText(
      text,
      x,
      y
    );

    ctx.restore();
  }

  function drawExtremes(
    ctx,
    data,
    indexByTime,
    width,
    height
  ) {
    if (!data.length) return;

    const visible =
      chart.timeScale()
        .getVisibleLogicalRange();

    let start = 0;
    let end =
      data.length - 1;

    if (visible) {
      start = Math.max(
        0,
        Math.floor(visible.from)
      );

      end = Math.min(
        data.length - 1,
        Math.ceil(visible.to)
      );
    }

    const closed =
      closedRows();

    const lastClosedTime =
      closed.at(-1)?.time;

    if (
      lastClosedTime === undefined
    ) {
      return;
    }

    const closedEnd =
      data.findIndex(
        x =>
          x.time === lastClosedTime
      );

    if (closedEnd < 0) return;

    end = Math.min(
      end,
      closedEnd
    );

    if (end < start) return;

    const section =
      data.slice(
        start,
        end + 1
      );

    if (!section.length) return;

    let max = section[0];
    let min = section[0];

    for (const bar of section) {
      if (
        bar.high > max.high
      ) {
        max = bar;
      }

      if (
        bar.low < min.low
      ) {
        min = bar;
      }
    }

    const maximum = coord(
      {
        time: max.time,
        price: max.high
      },
      indexByTime
    );

    const minimum = coord(
      {
        time: min.time,
        price: min.low
      },
      indexByTime
    );

    function tag(
      point,
      label,
      color,
      above
    ) {
      if (!point) return;

      ctx.save();

      ctx.font =
        "bold 11px system-ui";

      const textWidth =
        ctx.measureText(label).width;

      const x =
        Math.max(
          5,
          Math.min(
            width - textWidth - 13,
            point.x - textWidth / 2
          )
        );

      const desiredY =
        above
          ? point.y - 28
          : point.y + 13;

      const y =
        Math.max(
          3,
          Math.min(
            height - 22,
            desiredY
          )
        );

      ctx.fillStyle =
        "rgba(6,10,24,.94)";

      ctx.strokeStyle = color;
      ctx.lineWidth = 1;

      ctx.fillRect(
        x - 4,
        y,
        textWidth + 8,
        20
      );

      ctx.strokeRect(
        x - 4,
        y,
        textWidth + 8,
        20
      );

      ctx.fillStyle = color;

      ctx.fillText(
        label,
        x,
        y + 14
      );

      ctx.restore();
    }

    tag(
      maximum,
      "MAX " +
        formatPrice(max.high),
      COLORS.bull,
      true
    );

    tag(
      minimum,
      "MIN " +
        formatPrice(min.low),
      COLORS.bear,
      false
    );
  }

  function drawWedge(
    ctx,
    finding,
    indexByTime
  ) {
    const highs =
      finding.points.filter(
        p => p.type === "H"
      );

    const lows =
      finding.points.filter(
        p => p.type === "L"
      );

    if (
      highs.length < 2 ||
      lows.length < 2
    ) {
      return;
    }

    const color =
      COLORS[finding.direction] ||
      COLORS.neutral;

    const h1 = coord(
      highs[0],
      indexByTime
    );

    const h2 = coord(
      highs.at(-1),
      indexByTime
    );

    const l1 = coord(
      lows[0],
      indexByTime
    );

    const l2 = coord(
      lows.at(-1),
      indexByTime
    );

    line(
      ctx,
      h1,
      h2,
      color,
      !finding.confirmed,
      2
    );

    line(
      ctx,
      l1,
      l2,
      color,
      !finding.confirmed,
      2
    );
  }

  function drawFinding(
    ctx,
    finding,
    indexByTime
  ) {
    const color =
      COLORS[finding.direction] ||
      COLORS.neutral;

    if (
      finding.key ===
        "fallingwedge" ||
      finding.key ===
        "risingwedge"
    ) {
      drawWedge(
        ctx,
        finding,
        indexByTime
      );

      return;
    }

    /*
      Squeeze y Order Blocks
      se muestran en el panel,
      sin textos sobre las velas.
    */
    if (
      finding.key === "squeeze" ||
      finding.key === "orderblocks"
    ) {
      return;
    }

    const points =
      finding.points.map(
        p => coord(
          p,
          indexByTime
        )
      );

    if (
      points.some(p => !p)
    ) {
      return;
    }

    const isWave = [
      "impulses",
      "abc",
      "zigzag",
      "flat",
      "abcde"
    ].includes(finding.key);

    for (
      let i = 1;
      i < points.length;
      i++
    ) {
      line(
        ctx,
        points[i - 1],
        points[i],
        color,
        !finding.confirmed,
        isWave ? 1.6 : 1.3
      );
    }

    if (!isWave) {
      return;
    }

    const labels =
      finding.key === "impulses"
        ? ["", "1", "2", "3"]
        : finding.key === "abcde"
          ? ["A", "B", "C", "D", "E"]
          : ["", "A", "B", "C"];

    points.forEach(
      (p, i) => {
        dot(
          ctx,
          p,
          color
        );

        if (!labels[i]) return;

        const original =
          finding.points[i];

        shortLabel(
          ctx,
          labels[i],
          p,
          color,
          original.type === "H"
        );
      }
    );
  }

  function paint() {
    if (
      !canvas ||
      !chart ||
      !candle
    ) {
      return;
    }

    const rect =
      canvas.getBoundingClientRect();

    const width = rect.width;
    const height = rect.height;

    if (
      !width ||
      !height
    ) {
      return;
    }

    const ratio =
      Math.min(
        window.devicePixelRatio || 1,
        2
      );

    canvas.width =
      Math.round(width * ratio);

    canvas.height =
      Math.round(height * ratio);

    const ctx =
      canvas.getContext("2d");

    if (!ctx) return;

    ctx.setTransform(
      ratio,
      0,
      0,
      ratio,
      0,
      0
    );

    ctx.clearRect(
      0,
      0,
      width,
      height
    );

    const data =
      rows();

    if (!data.length) return;

    const indexByTime =
      new Map(
        data.map(
          (x, i) => [
            Number(x.time),
            i
          ]
        )
      );

    /*
      Limitar los dibujos evita
      saturar la gráfica.
    */
    const displayed = [];

    const used = new Set();

    for (const finding of findings) {
      const group = [
        "abc",
        "zigzag",
        "flat"
      ].includes(finding.key)
        ? "correction"
        : finding.key;

      if (used.has(group)) {
        continue;
      }

      displayed.push(finding);
      used.add(group);

      if (
        displayed.length >= 4
      ) {
        break;
      }
    }

    displayed.reverse().forEach(
      finding => {
        drawFinding(
          ctx,
          finding,
          indexByTime
        );
      }
    );

    /*
      MAX y MIN se dibujan
      al final para quedar visibles.
    */
    drawExtremes(
      ctx,
      data,
      indexByTime,
      width,
      height
    );
  }

  function renderPanel() {
    const area =
      $("chartSection");

    if (!area) return;

    let panel =
      $("clPatternResults");

    if (!panel) {
      panel =
        document.createElement(
          "section"
        );

      panel.id =
        "clPatternResults";

      panel.style.cssText = [
        "margin:14px 0",
        "padding:13px",
        "background:#101a32",
        "border:1px solid #35416e",
        "border-radius:12px",
        "color:#dce6ff"
      ].join(";");

      const title =
        document.createElement("h3");

      title.textContent =
        "Patrones detectados";

      title.style.cssText =
        "font-size:15px;margin:0 0 9px";

      panel.appendChild(title);

      const body =
        document.createElement("div");

      body.id =
        "clPatternResultsBody";

      panel.appendChild(body);

      area.appendChild(panel);
    }

    const body =
      $("clPatternResultsBody");

    if (!body) return;

    body.replaceChildren();

    if (!findings.length) {
      const note =
        document.createElement("p");

      note.textContent =
        "Sin patrones activos detectados. " +
        "Activa los filtros desde el menú.";

      note.style.cssText =
        "font-size:12px;color:#aebcdd";

      body.appendChild(note);
      return;
    }

    for (
      const finding of findings.slice(0, 8)
    ) {
      const item =
        document.createElement("div");

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

      const state =
        finding.confirmed
          ? "Confirmación básica"
          : "En observación";

      item.textContent =
        finding.label +
        " · " +
        direction +
        " · " +
        state;

      body.appendChild(item);
    }
  }

  function setupButtons() {
    document.querySelectorAll(
      "[data-pattern]"
    ).forEach(button => {
      const key =
        button.dataset.pattern;

      if (!NAMES[key]) return;

      const available =
        key !== "diagonal";

      button.disabled =
        !available;

      if (!available) return;

      button.classList.toggle(
        "active",
        enabled.has(key)
      );

      button.setAttribute(
        "aria-pressed",
        String(enabled.has(key))
      );

      if (
        button.dataset.patternReady === "1"
      ) {
        return;
      }

      button.dataset.patternReady = "1";

      button.addEventListener(
        "click",
        () => {
          if (enabled.has(key)) {
            enabled.delete(key);
          } else {
            enabled.add(key);
          }

          save();
          setupButtons();
          analyze();
        }
      );
    });
  }

  function buildUI() {
    if (initialized) return;

    const area =
      $("priceChartArea");

    if (!area) return;

    initialized = true;

    area.style.position =
      "relative";

    canvas =
      document.createElement(
        "canvas"
      );

    canvas.id =
      "patternsCanvas";

    canvas.style.cssText = [
      "position:absolute",
      "inset:0",
      "width:100%",
      "height:100%",
      "z-index:7",
      "pointer-events:none"
    ].join(";");

    area.appendChild(canvas);

    setupButtons();

    if (window.ResizeObserver) {
      new ResizeObserver(
        redraw
      ).observe(area);
    }

    window.addEventListener(
      "resize",
      redraw
    );

    for (const id of [
      "symbol",
      "interval",
      "exchange",
      "market"
    ]) {
      $(id)?.addEventListener(
        "change",
        () => {
          findings = [];
          redraw();

          updateStatus(
            "Cambiando mercado. " +
            "Esperando velas..."
          );

          renderPanel();
        }
      );
    }

    updateStatus(
      "Motor preparado. " +
      "Esperando conexión con las velas."
    );
  }

  function attach(
    newChart,
    newCandle,
    options = {}
  ) {
    if (
      !newChart ||
      !newCandle
    ) {
      return;
    }

    chart = newChart;
    candle = newCandle;

    if (
      typeof options.getRows ===
      "function"
    ) {
      getRows =
        options.getRows;
    }

    if (
      typeof options.getSelection ===
      "function"
    ) {
      getSelection =
        options.getSelection;
    }

    buildUI();

    chart.timeScale()
      .subscribeVisibleLogicalRangeChange(
        redraw
      );

    analyze();
  }

  load();

  window.CryptolexuzPatterns = {
    version: "2",
    attach,
    analyze,
    redraw,

    getFindings: () =>
      findings.map(f => ({
        key: f.key,
        label: f.label,
        direction: f.direction,
        confirmed: f.confirmed,
        points:
          f.points.map(p => ({
            ...p
          }))
      })),

    getEnabled: () =>
      [...enabled]
  };

  console.info(
    "CRYPTOLEXUZ PRO — " +
    "Patterns V2 cargado"
  );
})();
