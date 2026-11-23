
/*
 CRYPTOLEXUZ PRO — CAJAS DE RANGOS V1
 Compatible con Lightweight Charts 4.2.x

 Incluye:
 - Caja verde de rango de velas
 - Caja morada de lateralización
 - Caja de penúltima vela
 - Línea amarilla del 50%
 - Niveles 4H, diario y semanal

 No ejecuta órdenes reales.
*/
"use strict";

(() => {
  if (window.__clRangeBoxesV1) return;
  window.__clRangeBoxesV1 = true;

  const $ = id => document.getElementById(id);

  const TF = {
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
    "1w": 604800
  };

  const config = {
    range: true,
    sideways: true,
    previous: true,
    higher: true,
    lookback: 24
  };

  let chart = null;
  let candle = null;
  let rows = [];
  let currentKey = "";
  let generation = 0;
  let higher = [];

  const cached = new Map();

  const canvas = document.createElement("canvas");
  canvas.id = "clRangeOverlay";

  canvas.style.cssText = `
    position:absolute;
    inset:0;
    width:100%;
    height:100%;
    pointer-events:none;
    z-index:7;
  `;

  const panel = document.createElement("div");
  panel.id = "clRangeControls";

  panel.style.cssText = `
    display:flex;
    flex-wrap:wrap;
    align-items:center;
    gap:8px;
    padding:10px;
    margin:10px 0;
    background:#141d35;
    border:1px solid #35436a;
    border-radius:12px;
    color:#dce6ff;
    font:12px system-ui;
  `;

  const note = document.createElement("span");

  note.style.cssText = `
    width:100%;
    color:#9caeca;
    font-size:11px;
  `;

  note.textContent =
    "Cajas calculadas sobre velas cerradas.";

  function addToggle(text, key) {
    const label = document.createElement("label");

    label.style.cssText = `
      display:inline-flex;
      align-items:center;
      gap:4px;
    `;

    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = config[key];

    input.addEventListener("change", () => {
      config[key] = input.checked;
      draw();
    });

    label.append(
      input,
      document.createTextNode(text)
    );

    panel.append(label);
  }

  addToggle("Rango verde", "range");
  addToggle("Lateralización", "sideways");
  addToggle("Penúltima vela", "previous");
  addToggle("4H / Día / Semana", "higher");

  const selector = document.createElement("select");

  selector.style.cssText = `
    background:#0b1429;
    color:#e8e9ff;
    border:1px solid #485579;
    border-radius:6px;
    padding:5px;
  `;

  [12, 24, 36, 48, 72].forEach(n => {
    const option = document.createElement("option");

    option.value = n;
    option.textContent = n + " velas";

    if (n === 24) {
      option.selected = true;
    }

    selector.append(option);
  });

  selector.addEventListener("change", () => {
    config.lookback = Number(selector.value);
    draw();
  });

  panel.append(selector, note);

  function selection() {
    return {
      exchange: $("exchange")?.value || "bingx",
      market: $("market")?.value || "perpetual",
      symbol: $("symbol")?.value || "BTC-USDT",
      tf: $("interval")?.value || "5m"
    };
  }

  function normalize(payload) {
    const raw = [
      payload?.data?.data,
      payload?.data?.list,
      payload?.data?.candles,
      payload?.data,
      payload?.list,
      payload
    ].find(Array.isArray) || [];

    const list = [];

    for (const z of raw) {
      if (!z || typeof z !== "object") continue;

      const a = Array.isArray(z);

      let t = a
        ? z[0]
        : z.time ??
          z.timestamp ??
          z.openTime ??
          z.t;

      t = typeof t === "string" &&
          !/^\d+$/.test(t)
        ? Date.parse(t)
        : Number(t);

      if (t > 1e12) {
        t = Math.floor(t / 1000);
      }

      const open = Number(
        a ? z[1] : z.open ?? z.o
      );

      const high = Number(
        a ? z[2] : z.high ?? z.h
      );

      const low = Number(
        a ? z[3] : z.low ?? z.l
      );

      const close = Number(
        a ? z[4] : z.close ?? z.c
      );

      if (
        [t, open, high, low, close]
          .every(Number.isFinite) &&
        t > 0 &&
        low > 0 &&
        high >= Math.max(open, close) &&
        low <= Math.min(open, close)
      ) {
        list.push({
          time: t,
          open,
          high,
          low,
          close
        });
      }
    }

    list.sort((a, b) => a.time - b.time);

    return [
      ...new Map(
        list.map(z => [z.time, z])
      ).values()
    ];
  }

  function closed(data, tf) {
    const sec = TF[tf] || 60;
    const now = Date.now() / 1000;

    return data.filter(
      c => c.time + sec <= now - 2
    );
  }

  function rect(ctx, box, color, alpha, label) {
    if (
      !box ||
      !Number.isFinite(box.high) ||
      !Number.isFinite(box.low)
    ) {
      return;
    }

    const w = canvas.clientWidth;

    const x1 = Math.max(
      0,
      Math.min(w, box.x1)
    );

    const x2 = Math.max(
      0,
      Math.min(w, box.x2)
    );

    const y1 = candle.priceToCoordinate(box.high);
    const y2 = candle.priceToCoordinate(box.low);

    if (
      !Number.isFinite(y1) ||
      !Number.isFinite(y2) ||
      x2 <= x1
    ) {
      return;
    }

    ctx.fillStyle = color;
    ctx.globalAlpha = alpha;

    ctx.fillRect(
      x1,
      y1,
      x2 - x1,
      y2 - y1
    );

    ctx.globalAlpha = 1;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;

    ctx.strokeRect(
      x1,
      y1,
      x2 - x1,
      y2 - y1
    );

    const mid = (box.high + box.low) / 2;
    const ym = candle.priceToCoordinate(mid);

    if (Number.isFinite(ym)) {
      ctx.strokeStyle = "#ffe15a";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 4]);

      ctx.beginPath();
      ctx.moveTo(x1, ym);
      ctx.lineTo(x2, ym);
      ctx.stroke();

      ctx.setLineDash([]);
    }

    ctx.font = "11px system-ui";
    ctx.fillStyle = color;

    ctx.fillText(
      label,
      Math.max(4, x1 + 4),
      Math.max(13, y1 - 5)
    );
  }

  function horizontal(ctx, p, label, color, offset) {
    const y = candle.priceToCoordinate(p);

    if (!Number.isFinite(y)) return;

    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.setLineDash([5, 4]);

    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(canvas.clientWidth, y);
    ctx.stroke();

    ctx.setLineDash([]);

    ctx.fillStyle = color;
    ctx.font = "10px system-ui";

    ctx.fillText(
      label,
      6,
      Math.max(
        10,
        Math.min(
          canvas.clientHeight - 3,
          y - 3 + offset
        )
      )
    );
  }

  function draw() {
    if (
      !chart ||
      !candle ||
      !canvas.isConnected
    ) {
      return;
    }

    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    const dpr = window.devicePixelRatio || 1;

    if (!w || !h) return;

    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);

    const ctx = canvas.getContext("2d");

    ctx.setTransform(
      dpr, 0, 0, dpr, 0, 0
    );

    ctx.clearRect(0, 0, w, h);

    const s = selection();
    const c = closed(rows, s.tf);

    if (c.length < 4) return;

    const scale = chart.timeScale();

    const x = t =>
      scale.timeToCoordinate(t);

    const left = c[
      Math.max(
        0,
        c.length - config.lookback
      )
    ].time;

    const right = c.at(-1).time;

    const xx = x(left);
    const xr = x(right);

    if (
      xx === null ||
      xr === null
    ) {
      return;
    }

    const barSpacing = Math.max(
      5,
      Math.abs(xr - xx) /
      Math.max(
        1,
        Math.min(
          config.lookback,
          c.length
        ) - 1
      )
    );

    const xEnd = Math.min(
      w,
      xr + barSpacing * 5
    );

    // CAJA VERDE: RANGO DE VELAS

    if (config.range) {
      const r = c.slice(-config.lookback);

      rect(
        ctx,
        {
          x1: xx,
          x2: xEnd,
          high: Math.max(
            ...r.map(z => z.high)
          ),
          low: Math.min(
            ...r.map(z => z.low)
          )
        },
        "#00d99a",
        0.11,
        "Rango de velas"
      );
    }

    // CAJA MORADA: LATERALIZACIÓN

    if (config.sideways) {
      const r = c.slice(
        -Math.min(
          18,
          config.lookback
        )
      );

      const hi = Math.max(
        ...r.map(z => z.high)
      );

      const lo = Math.min(
        ...r.map(z => z.low)
      );

      const avg = r.reduce(
        (a, z) =>
          a + (z.high - z.low),
        0
      ) / r.length;

      const compression =
        (hi - lo) /
        Math.max(avg, 1e-12);

      if (compression <= 5) {
        const sx = x(r[0].time);

        if (sx !== null) {
          rect(
            ctx,
            {
              x1: sx,
              x2: xEnd,
              high: hi,
              low: lo
            },
            "#bb52ff",
            0.13,
            "Lateralización"
          );
        }
      }
    }

    // CAJA DE PENÚLTIMA VELA

    if (config.previous) {
      const p = c.at(-2);

      if (p) {
        const px = x(p.time);

        if (px !== null) {
          rect(
            ctx,
            {
              x1: px - barSpacing / 2,
              x2: w,
              high: p.high,
              low: p.low
            },
            "#a78bfa",
            0.07,
            "Penúltima vela"
          );
        }
      }
    }

    // NIVELES DE TEMPORALIDADES SUPERIORES

    if (config.higher) {
      for (const r of higher) {
        horizontal(
          ctx,
          r.high,
          r.tf + " Máx",
          "#b38aff",
          -10
        );

        horizontal(
          ctx,
          (r.high + r.low) / 2,
          r.tf + " 50%",
          "#ffe15a",
          0
        );

        horizontal(
          ctx,
          r.low,
          r.tf + " Mín",
          "#b38aff",
          10
        );
      }
    }
  }

  function bindOverlay() {
    const host =
      $("priceChartArea") ||
      $("chart")?.parentElement;

    if (!host) return;

    if (
      getComputedStyle(host).position ===
      "static"
    ) {
      host.style.position = "relative";
    }

    if (canvas.parentElement !== host) {
      host.append(canvas);
    }

    const anchor =
      $("chartSection") || host;

    if (!panel.isConnected) {
      anchor.parentElement?.insertBefore(
        panel,
        anchor
      );
    }
  }

  async function getHigher(tf, s) {
    const key = [
      s.exchange,
      s.market,
      s.symbol,
      tf
    ].join("|");

    const old = cached.get(key);

    if (
      old &&
      Date.now() - old.at < 60000
    ) {
      return old.data;
    }

    const url =
      "/api/exchange/" +
      encodeURIComponent(s.exchange) +
      "/klines/" +
      encodeURIComponent(s.symbol) +
      "?market=" +
      encodeURIComponent(s.market) +
      "&interval=" +
      tf +
      "&limit=12";

    const controller = new AbortController();

    const timer = setTimeout(
      () => controller.abort(),
      9000
    );

    try {
      const res = await fetch(url, {
        signal: controller.signal,
        cache: "no-store"
      });

      if (!res.ok) {
        throw Error(
          "HTTP " + res.status
        );
      }

      const data = await res.json();

      if (
        data?.code !== undefined &&
        ![0, "0"].includes(data.code)
      ) {
        throw Error("API error");
      }

      const a = closed(
        normalize(data),
        tf
      );

      if (a.length < 2) {
        throw Error(
          "Sin velas cerradas"
        );
      }

      const p = a.at(-2);

      const result = {
        tf,
        high: p.high,
        low: p.low
      };

      cached.set(key, {
        at: Date.now(),
        data: result
      });

      return result;

    } finally {
      clearTimeout(timer);
    }
  }

  async function refreshHigher() {
    const gen = ++generation;
    const s = selection();

    higher = [];

    const results = await Promise.allSettled(
      ["4h", "1d", "1w"].map(
        tf => getHigher(tf, s)
      )
    );

    if (gen !== generation) return;

    higher = results
      .filter(
        r => r.status === "fulfilled"
      )
      .map(r => r.value);

    draw();

    note.textContent =
      "Cajas sobre velas cerradas. " +
      "Niveles superiores disponibles: " +
      (
        higher.map(r => r.tf).join(", ") ||
        "ninguno (revisar API)"
      ) +
      ". No ejecuta órdenes.";
  }

  function redrawSoon() {
    requestAnimationFrame(draw);
  }

  function attach(detail) {
    if (
      detail?.chart &&
      detail?.candle
    ) {
      chart = detail.chart;
      candle = detail.candle;

      bindOverlay();
      redrawSoon();

      try {
        chart.timeScale()
          .subscribeVisibleLogicalRangeChange(
            redrawSoon
          );
      } catch (_) {
        // La gráfica puede no estar lista.
      }
    }
  }

  window.addEventListener(
    "cryptolexuz:chart-ready",
    e => attach(e.detail)
  );

  function poll() {
    bindOverlay();

    const s = selection();

    const key = [
      s.exchange,
      s.market,
      s.symbol,
      s.tf
    ].join("|");

    if (key !== currentKey) {
      currentKey = key;
      rows = [];
      higher = [];
      refreshHigher();
    }

    const url =
      "/api/exchange/" +
      encodeURIComponent(s.exchange) +
      "/klines/" +
      encodeURIComponent(s.symbol) +
      "?market=" +
      encodeURIComponent(s.market) +
      "&interval=" +
      s.tf +
      "&limit=160";

    const controller = new AbortController();

    const timer = setTimeout(
      () => controller.abort(),
      9000
    );

    fetch(url, {
      signal: controller.signal,
      cache: "no-store"
    })
      .then(r => {
        if (!r.ok) {
          throw Error(
            "HTTP " + r.status
          );
        }

        return r.json();
      })
      .then(payload => {
        if (key !== currentKey) return;

        rows = normalize(payload);
        draw();
      })
      .catch(() => {
        note.textContent =
          "No se pudieron actualizar " +
          "las cajas. Revisar conexión.";
      })
      .finally(() => {
        clearTimeout(timer);
      });
  }

  function init() {
    bindOverlay();

    [
      "symbol",
      "interval",
      "market",
      "exchange"
    ].forEach(id => {
      $(id)?.addEventListener(
        "change",
        () => {
          currentKey = "";

          setTimeout(
            poll,
            400
          );
        }
      );
    });

    window.addEventListener(
      "resize",
      redrawSoon
    );

    poll();

    setInterval(
      () => {
        if (!document.hidden) {
          poll();
          refreshHigher();
        }
      },
      30000
    );

    document.addEventListener(
      "visibilitychange",
      () => {
        if (!document.hidden) {
          poll();
          refreshHigher();
        }
      }
    );
  }

  if (
    document.readyState === "loading"
  ) {
    document.addEventListener(
      "DOMContentLoaded",
      init
    );
  } else {
    init();
  }
})();
