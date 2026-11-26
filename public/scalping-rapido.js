JavaScript

/*
 CRYPTOLEXUZ PRO
 SCALPING RÁPIDO V3 COMPLETO

 BTC: LONG / SHORT 100x
 ORO: LONG / SHORT 100x
 PETRÓLEO WTI: LONG / SHORT 50x

 Temporalidades: 1m y 5m.
 Confirmación adicional: 15m.

 EMA 21, MA 55, ATR, volumen,
 ruptura, retesteo y estructura.

 Objetivos teóricos de ROI bruto:
 +50%, +100%, +200%.

 Solo información.
 No ejecuta órdenes reales.
 No garantiza resultados.
*/

"use strict";

(() => {
  if (window.__clScalpingRapidoV3) return;
  window.__clScalpingRapidoV3 = true;

  const $ = id => document.getElementById(id);

  const ASSETS = [
    {
      name: "BITCOIN",
      symbol: "BTC-USDT",
      leverage: 100,
      icon: "₿",
      precision: 2
    },
    {
      name: "ORO",
      symbol: "NCCOGOLD2USD-USDT",
      leverage: 100,
      icon: "◈",
      precision: 3
    },
    {
      name: "PETRÓLEO WTI",
      symbol: "NCCO1OILWTI2USD-USDT",
      leverage: 50,
      icon: "◉",
      precision: 3
    }
  ];

  const INTERVALS = {
    "1m": 60,
    "5m": 300,
    "15m": 900
  };

  const state = new Map();
  const cache = new Map();

  let busy = false;
  let rerun = false;
  let lastRun = 0;
  let timer = null;
  let initialized = false;

  const now = () =>
    Math.floor(Date.now() / 1000);

  function fmt(value, digits = 2) {
    if (
      value === null ||
      value === undefined ||
      value === "" ||
      !Number.isFinite(Number(value))
    ) {
      return "—";
    }

    return Number(value).toLocaleString(
      "en-US",
      {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits
      }
    );
  }

  function el(tag, className = "", value) {
    const element = document.createElement(tag);

    if (className) {
      element.className = className;
    }

    if (value !== undefined) {
      element.textContent = String(value);
    }

    return element;
  }

  function normalize(payload) {
    const candidates = [
      payload?.data?.data,
      payload?.data?.list,
      payload?.data?.candles,
      payload?.data,
      payload?.list,
      payload?.candles,
      payload
    ];

    const raw =
      candidates.find(Array.isArray) || [];

    const result = [];

    const num = value =>
      value === null ||
      value === undefined ||
      value === ""
        ? NaN
        : Number(value);

    for (const v of raw) {
      if (!v || typeof v !== "object") {
        continue;
      }

      const array = Array.isArray(v);

      let time = array
        ? v[0]
        : v.time ??
          v.timestamp ??
          v.openTime ??
          v.t;

      time =
        typeof time === "string" &&
        !/^\d+$/.test(time)
          ? Date.parse(time)
          : Number(time);

      if (time > 1e12) {
        time = Math.floor(time / 1000);
      }

      const open = num(
        array ? v[1] : v.open ?? v.o
      );

      const high = num(
        array ? v[2] : v.high ?? v.h
      );

      const low = num(
        array ? v[3] : v.low ?? v.l
      );

      const close = num(
        array ? v[4] : v.close ?? v.c
      );

      const volume = num(
        array
          ? v[5]
          : v.volume ?? v.vol ?? v.v ?? 0
      );

      if (
        ![
          time,
          open,
          high,
          low,
          close,
          volume
        ].every(Number.isFinite)
      ) {
        continue;
      }

      if (
        time <= 0 ||
        time > now() + 60 ||
        Math.min(
          open,
          high,
          low,
          close
        ) <= 0 ||
        volume < 0 ||
        high < Math.max(open, close) ||
        low > Math.min(open, close)
      ) {
        continue;
      }

      result.push({
        time,
        open,
        high,
        low,
        close,
        volume
      });
    }

    result.sort(
      (a, b) => a.time - b.time
    );

    return [
      ...new Map(
        result.map(c => [c.time, c])
      ).values()
    ];
  }

  async function requestJSON(url) {
    const controller = new AbortController();

    const timeout = setTimeout(
      () => controller.abort(),
      12000
    );

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        cache: "no-store"
      });

      if (!response.ok) {
        throw new Error(
          "HTTP " + response.status
        );
      }

      const payload = await response.json();

      if (
        payload?.code !== undefined &&
        ![
          0,
          "0",
          "00000"
        ].includes(payload.code)
      ) {
        throw new Error(
          String(
            payload.msg ||
            payload.message ||
            "Error de API"
          )
        );
      }

      return payload;

    } finally {
      clearTimeout(timeout);
    }
  }

  async function getCandles(asset, tf) {
    const seconds = INTERVALS[tf];

    if (!seconds) {
      throw new Error(
        "Temporalidad no compatible"
      );
    }

    const key =
      asset.symbol + "|" + tf;

    const cached = cache.get(key);

    const ttl = tf === "1m"
      ? 20000
      : tf === "5m"
        ? 45000
        : 60000;

    if (
      cached &&
      Date.now() - cached.at < ttl
    ) {
      return cached.data;
    }

    const url =
      "/api/exchange/bingx/klines/" +
      encodeURIComponent(asset.symbol) +
      "?market=perpetual" +
      "&interval=" +
      encodeURIComponent(tf) +
      "&limit=200";

    const payload = await requestJSON(url);

    const rows = normalize(payload);

    const current = now();

    const closed = rows.filter(
      c =>
        c.time + seconds <=
        current - 2
    );

    if (closed.length < 65) {
      throw new Error(
        "Historial insuficiente en " + tf
      );
    }

    const last = closed.at(-1);

    const age =
      current - (last.time + seconds);

    const maxAge = tf === "1m"
      ? 150
      : tf === "5m"
        ? 420
        : 1050;

    if (age > maxAge) {
      throw new Error(
        "Velas desactualizadas en " + tf
      );
    }

    cache.set(key, {
      at: Date.now(),
      data: closed
    });

    return closed;
  }

  function ema(values, length) {
    if (values.length < length) {
      return NaN;
    }

    let result =
      values.slice(0, length)
        .reduce((a, b) => a + b, 0) /
      length;

    const multiplier =
      2 / (length + 1);

    for (
      let i = length;
      i < values.length;
      i++
    ) {
      result +=
        (values[i] - result) *
        multiplier;
    }

    return result;
  }

  function sma(values, length) {
    if (values.length < length) {
      return NaN;
    }

    return values.slice(-length)
      .reduce((a, b) => a + b, 0) /
      length;
  }

  function atr(rows, length = 14) {
    if (rows.length < length + 2) {
      return NaN;
    }

    const ranges = [];

    for (
      let i = 1;
      i < rows.length;
      i++
    ) {
      ranges.push(
        Math.max(
          rows[i].high - rows[i].low,
          Math.abs(
            rows[i].high -
            rows[i - 1].close
          ),
          Math.abs(
            rows[i].low -
            rows[i - 1].close
          )
        )
      );
    }

    return sma(ranges, length);
  }

  function trend(rows, side) {
    const closes =
      rows.map(c => c.close);

    const last =
      closes.at(-1);

    const e21 =
      ema(closes, 21);

    const m55 =
      sma(closes, 55);

    if (
      ![
        last,
        e21,
        m55
      ].every(Number.isFinite)
    ) {
      return false;
    }

    return side === "LONG"
      ? last > e21 && e21 > m55
      : last < e21 && e21 < m55;
  }

  function waiting(reason) {
    return {
      status: "ESPERANDO CONFIRMACIÓN",
      reason
    };
  }

  function analyze(
    asset,
    one,
    five,
    fifteen,
    side
  ) {
    const isLong =
      side === "LONG";

    const last =
      one.at(-1);

    if (
      !trend(one, side) ||
      !trend(five, side) ||
      !trend(fifteen, side)
    ) {
      return waiting(
        "EMA 21 y MA 55 sin alineación " +
        "en uno, cinco y quince minutos."
      );
    }

    const volatility =
      atr(one);

    if (
      !Number.isFinite(volatility) ||
      volatility <= 0
    ) {
      return waiting(
        "Volatilidad ATR insuficiente."
      );
    }

    let setup = null;

    for (
      let back = 1;
      back <= 3;
      back++
    ) {
      const index =
        one.length - 1 - back;

      if (index < 25) {
        continue;
      }

      const breakout =
        one[index];

      const previous =
        one.slice(
          index - 10,
          index
        );

      const level = isLong
        ? Math.max(
            ...previous.map(
              c => c.high
            )
          )
        : Math.min(
            ...previous.map(
              c => c.low
            )
          );

      const volumeHistory =
        one.slice(
          index - 20,
          index
        );

      const averageVolume =
        volumeHistory.reduce(
          (sum, c) =>
            sum + c.volume,
          0
        ) / volumeHistory.length;

      const volumeOK =
        averageVolume > 0 &&
        breakout.volume >=
          averageVolume * 1.3;

      const broke = isLong
        ? breakout.close >
          level +
          0.04 * volatility
        : breakout.close <
          level -
          0.04 * volatility;

      const intermediate =
        one.slice(
          index + 1,
          -1
        );

      const held =
        intermediate.every(
          c => isLong
            ? c.close >=
              level -
              0.16 * volatility
            : c.close <=
              level +
              0.16 * volatility
        );

      const retest = isLong
        ? (
            last.low <=
              level +
              0.20 * volatility &&
            last.low >=
              level -
              0.25 * volatility &&
            last.close > level
          )
        : (
            last.high >=
              level -
              0.20 * volatility &&
            last.high <=
              level +
              0.25 * volatility &&
            last.close < level
          );

      if (
        broke &&
        held &&
        retest &&
        volumeOK
      ) {
        setup = {
          level,
          breakout,
          retest: last,
          averageVolume
        };

        break;
      }
    }

    if (!setup) {
      return waiting(
        "Sin ruptura, retesteo y " +
        "volumen confirmados en " +
        "velas cerradas."
      );
    }

    const entry = isLong
      ? last.high
      : last.low;

    const recent =
      one.slice(-6);

    const buffer =
      0.2 * volatility;

    const stop = isLong
      ? Math.min(
          ...recent.map(
            c => c.low
          )
        ) - buffer
      : Math.max(
          ...recent.map(
            c => c.high
          )
        ) + buffer;

    const risk =
      Math.abs(entry - stop);

    const riskPct =
      100 * risk / entry;

    if (
      !Number.isFinite(entry) ||
      !Number.isFinite(stop) ||
      entry <= 0 ||
      stop <= 0 ||
      risk <= 0 ||
      riskPct < 0.02 ||
      riskPct > 0.6 ||
      (
        isLong
          ? stop >= entry
          : stop <= entry
      )
    ) {
      return waiting(
        "Stop estructural fuera " +
        "del rango permitido."
      );
    }

    const direction =
      isLong ? 1 : -1;

    const targets =
      [50, 100, 200].map(
        roi => {
          const price =
            entry * (
              1 +
              direction *
              roi /
              (
                100 *
                asset.leverage
              )
            );

          return {
            roi,
            price,
            rr:
              Math.abs(
                price - entry
              ) / risk
          };
        }
      );

    if (
      targets.some(
        t =>
          !Number.isFinite(t.price) ||
          t.price <= 0
      )
    ) {
      return waiting(
        "Objetivos teóricos inválidos."
      );
    }

    return {
      status: "CONFIGURACIÓN DETECTADA",
      reason:
        "Tendencia alineada en 1m, " +
        "5m y 15m. Ruptura, " +
        "retesteo y volumen " +
        "confirmados.",
      side,
      entry,
      stop,
      riskPct,
      targets,
      at: last.time,
      precision: asset.precision,
      breakoutTime:
        setup.breakout.time,
      level: setup.level
    };
  }

  function addStyles() {
    if ($("clQuickScalpCSS")) {
      return;
    }

    const style = el("style");
    style.id = "clQuickScalpCSS";

    style.textContent = `
      .cl-quick-scalp {
        margin:16px 0;
        padding:15px;
        background:#0e1730;
        color:#e7eeff;
        border:1px solid #344269;
        border-radius:15px;
      }

      .clqs-top {
        display:flex;
        align-items:center;
        justify-content:space-between;
        gap:10px;
        flex-wrap:wrap;
      }

      .clqs-top h2 {
        font-size:18px;
        color:#ffe15a;
        margin:0;
      }

      .clqs-refresh {
        background:#29214c;
        color:#fff;
        border:1px solid #7657ac;
        border-radius:9px;
        padding:9px 13px;
        cursor:pointer;
      }

      .clqs-refresh:disabled {
        opacity:.55;
        cursor:wait;
      }

      .clqs-note {
        font-size:12px;
        color:#acbad6;
        line-height:1.6;
        margin:12px 0;
      }

      .clqs-grid {
        display:grid;
        grid-template-columns:
          repeat(
            auto-fit,
            minmax(min(100%,280px),1fr)
          );
        gap:12px;
      }

      .clqs-asset {
        background:#111d36;
        border:1px solid #35496b;
        border-radius:12px;
        padding:12px;
        min-width:0;
      }

      .clqs-title {
        display:flex;
        align-items:center;
        justify-content:space-between;
        gap:8px;
        margin-bottom:12px;
        font-weight:700;
        font-size:15px;
      }

      .clqs-lev {
        color:#ffe15a;
        font-size:15px;
      }

      .clqs-sides {
        display:grid;
        grid-template-columns:
          repeat(2,minmax(0,1fr));
        gap:8px;
      }

      .clqs-side {
        padding:10px 8px;
        border-radius:10px;
        min-width:0;
        background:#0b1429;
        border:1px solid #2a3a56;
      }

      .clqs-side.long {
        border-top:3px solid #00f5a0;
      }

      .clqs-side.short {
        border-top:3px solid #ff476c;
      }

      .clqs-side h4 {
        font-size:14px;
        margin:0 0 10px;
      }

      .clqs-side.long h4 {
        color:#00f5a0;
      }

      .clqs-side.short h4 {
        color:#ff476c;
      }

      .clqs-status {
        font-size:11px;
        color:#ffe15a;
        line-height:1.5;
        margin-bottom:8px;
        overflow-wrap:anywhere;
      }

      .clqs-line {
        font-size:11px;
        line-height:1.6;
        margin:5px 0;
        overflow-wrap:anywhere;
      }

      .clqs-target {
        color:#00f5a0;
      }

      .clqs-reason {
        font-size:11px;
        color:#aebbd4;
        line-height:1.5;
        margin-top:10px;
        overflow-wrap:anywhere;
      }

      @media(max-width:370px) {
        .clqs-sides {
          grid-template-columns:1fr;
        }
      }
    `;

    document.head.appendChild(style);
  }

  function paneId(asset, side) {
    return (
      "clqs-" +
      asset.symbol.replace(
        /[^a-z0-9]/gi,
        "_"
      ) +
      "-" +
      side
    );
  }

  function build() {
    const host =
      $("clQuickScalpHost") ||
      $("clScreenScanner") ||
      $("clScanner") ||
      document.querySelector("main");

    if (!host) {
      return false;
    }

    let section =
      $("clQuickScalp");

    if (section) {
      if (
        section.parentElement !== host &&
        $("clQuickScalpHost")
      ) {
        host.appendChild(section);
      }

      return true;
    }

    addStyles();

    section = el(
      "section",
      "cl-quick-scalp"
    );

    section.id =
      "clQuickScalp";

    const top =
      el("div", "clqs-top");

    top.append(
      el(
        "h2",
        "",
        "⚡ SCALPING RÁPIDO"
      )
    );

    const refresh = el(
      "button",
      "clqs-refresh",
      "Actualizar"
    );

    refresh.type = "button";
    refresh.id = "clqsRefresh";

    refresh.addEventListener(
      "click",
      () => run(true)
    );

    top.append(refresh);
    section.append(top);

    section.append(
      el(
        "p",
        "clqs-note",
        "BTC y oro 100x · " +
        "Petróleo WTI 50x. " +
        "Análisis informativo con " +
        "velas cerradas de 1m, " +
        "5m y 15m. " +
        "Futuros perpetuos BingX."
      )
    );

    const grid =
      el("div", "clqs-grid");

    grid.id =
      "clQuickScalpGrid";

    section.append(grid);

    for (const asset of ASSETS) {
      const card =
        el(
          "article",
          "clqs-asset"
        );

      const title =
        el(
          "div",
          "clqs-title"
        );

      title.append(
        el(
          "span",
          "",
          asset.icon +
          " " +
          asset.name
        ),
        el(
          "span",
          "clqs-lev",
          asset.leverage + "x"
        )
      );

      card.append(title);

      const sides =
        el(
          "div",
          "clqs-sides"
        );

      for (
        const side of [
          "LONG",
          "SHORT"
        ]
      ) {
        const pane =
          el(
            "div",
            "clqs-side " +
            side.toLowerCase()
          );

        pane.id =
          paneId(asset, side);

        sides.append(pane);
      }

      card.append(sides);
      grid.append(card);
    }

    const status =
      el(
        "p",
        "clqs-note",
        "Preparando análisis..."
      );

    status.id =
      "clQuickScalpStatus";

    section.append(status);

    host.appendChild(section);

    render();

    return true;
  }

  function renderPane(
    asset,
    side,
    data
  ) {
    const pane = $(
      paneId(asset, side)
    );

    if (!pane) {
      return;
    }

    pane.replaceChildren();

    pane.append(
      el(
        "h4",
        "",
        side === "LONG"
          ? "▲ LONG"
          : "▼ SHORT"
      )
    );

    pane.append(
      el(
        "div",
        "clqs-status",
        data?.status ||
        "ESPERANDO CONFIRMACIÓN"
      )
    );

    if (
      data &&
      Number.isFinite(data.entry)
    ) {
      pane.append(
        el(
          "div",
          "clqs-line",
          "Entrada teórica: " +
          fmt(
            data.entry,
            data.precision
          )
        )
      );

      pane.append(
        el(
          "div",
          "clqs-line",
          "Stop: " +
          fmt(
            data.stop,
            data.precision
          )
        )
      );

      pane.append(
        el(
          "div",
          "clqs-line",
          "Distancia al stop: " +
          fmt(
            data.riskPct,
            3
          ) +
          "%"
        )
      );

      pane.append(
        el(
          "div",
          "clqs-line",
          "Pérdida bruta teórica " +
          "sobre margen: " +
          fmt(
            data.riskPct *
            asset.leverage,
            1
          ) +
          "%"
        )
      );

      for (
        const target of data.targets
      ) {
        pane.append(
          el(
            "div",
            "clqs-line clqs-target",
            "TP +" +
            target.roi +
            "% ROI bruto: " +
            fmt(
              target.price,
              data.precision
            ) +
            " · R/B " +
            fmt(
              target.rr,
              2
            )
          )
        );
      }

      pane.append(
        el(
          "div",
          "clqs-line",
          "Vela de confirmación: " +
          new Date(
            data.at * 1000
          ).toLocaleTimeString(
            "es-MX"
          )
        )
      );

    } else {
      for (
        const label of [
          "Entrada",
          "Stop",
          "TP 50%",
          "TP 100%",
          "TP 200%"
        ]
      ) {
        pane.append(
          el(
            "div",
            "clqs-line",
            label + ": —"
          )
        );
      }
    }

    pane.append(
      el(
        "div",
        "clqs-reason",
        data?.reason ||
        "Esperando velas cerradas."
      )
    );
  }

  function render() {
    for (const asset of ASSETS) {
      for (
        const side of [
          "LONG",
          "SHORT"
        ]
      ) {
        renderPane(
          asset,
          side,
          state.get(
            asset.symbol +
            "|" +
            side
          )
        );
      }
    }
  }

  async function run(force = false) {
    if (!build()) {
      return;
    }

    if (document.hidden) {
      return;
    }

    if (busy) {
      if (force) {
        rerun = true;
      }

      return;
    }

    if (
      !force &&
      Date.now() - lastRun <
      45000
    ) {
      return;
    }

    busy = true;
    lastRun = Date.now();

    const status =
      $("clQuickScalpStatus");

    const button =
      $("clqsRefresh");

    if (button) {
      button.disabled = true;
      button.textContent =
        "Analizando...";
    }

    if (status) {
      status.textContent =
        "Analizando velas cerradas " +
        "de uno, cinco y quince minutos...";
    }

    try {
      const results =
        await Promise.all(
          ASSETS.map(
            async asset => {
              try {
                const [
                  one,
                  five,
                  fifteen
                ] = await Promise.all([
                  getCandles(
                    asset,
                    "1m"
                  ),
                  getCandles(
                    asset,
                    "5m"
                  ),
                  getCandles(
                    asset,
                    "15m"
                  )
                ]);

                return {
                  asset,
                  long: analyze(
                    asset,
                    one,
                    five,
                    fifteen,
                    "LONG"
                  ),
                  short: analyze(
                    asset,
                    one,
                    five,
                    fifteen,
                    "SHORT"
                  )
                };

              } catch (error) {
                const unavailable = {
                  status:
                    "DATOS NO DISPONIBLES",
                  reason: String(
                    error?.message ||
                    error
                  )
                };

                return {
                  asset,
                  long: unavailable,
                  short: unavailable
                };
              }
            }
          )
        );

      for (const result of results) {
        state.set(
          result.asset.symbol +
          "|LONG",
          result.long
        );

        state.set(
          result.asset.symbol +
          "|SHORT",
          result.short
        );
      }

      render();

      if (status) {
        status.textContent =
          "Última revisión: " +
          new Date().toLocaleTimeString(
            "es-MX"
          ) +
          " · Datos públicos BingX. " +
          "ROI teórico bruto, sin " +
          "comisiones, financiación " +
          "ni deslizamiento. " +
          "No ejecuta órdenes.";
      }

    } catch (error) {
      if (status) {
        status.textContent =
          "Error del análisis: " +
          String(
            error?.message ||
            error
          );
      }

    } finally {
      busy = false;

      if (button) {
        button.disabled = false;
        button.textContent =
          "Actualizar";
      }

      if (rerun) {
        rerun = false;

        setTimeout(
          () => run(true),
          300
        );
      }
    }
  }

  function init() {
    if (initialized) {
      return;
    }

    if (!build()) {
      setTimeout(init, 500);
      return;
    }

    initialized = true;

    run(true);

    timer = setInterval(
      () => run(),
      60000
    );

    document.addEventListener(
      "visibilitychange",
      () => {
        if (!document.hidden) {
          build();
          run(true);
        }
      }
    );

    window.addEventListener(
      "cryptolexuz:screen-change",
      () => {
        build();
      }
    );

    window.addEventListener(
      "beforeunload",
      () => {
        if (timer) {
          clearInterval(timer);
          timer = null;
        }
      }
    );

    console.info(
      "CRYPTOLEXUZ PRO — " +
      "Scalping Rápido V3 cargado"
    );
  }

  window.CryptolexuzScalpingRapido = {
    version: "3",
    refresh: () => run(true),
    getState: () =>
      Object.fromEntries(state),
    getAssets: () =>
      ASSETS.map(a => ({ ...a }))
  };

  if (
    document.readyState === "loading"
  ) {
    document.addEventListener(
      "DOMContentLoaded",
      init,
      { once: true }
    );
  } else {
    init();
  }
})();
