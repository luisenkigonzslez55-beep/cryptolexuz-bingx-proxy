
/*
 CRYPTOLEXUZ PRO
 SCALPING RÁPIDO V2 COMPLETO

 BTC: LONG / SHORT 100x
 ORO: LONG / SHORT 100x
 PETRÓLEO WTI: LONG / SHORT 50x

 Temporalidades: 1m y 5m
 EMA 21, MA 55, ATR, volumen,
 ruptura y retesteo.

 Objetivos teóricos:
 ROI bruto +50%, +100%, +200%.

 No ejecuta órdenes.
 No garantiza resultados.
*/

"use strict";

(() => {

  if (window.__clScalpingRapidoV2) return;
  window.__clScalpingRapidoV2 = true;

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

  const state = new Map();

  let busy = false;
  let lastRun = 0;
  let timer = null;

  function fmt(n, digits = 2) {
    if (
      n === null ||
      n === undefined ||
      n === "" ||
      !Number.isFinite(Number(n))
    ) return "—";

    return Number(n).toLocaleString("en-US", {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits
    });
  }

  function el(tag, className = "", value) {
    const element = document.createElement(tag);

    if (className) element.className = className;

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

    const raw = candidates.find(Array.isArray) || [];
    const result = [];

    for (const v of raw) {

      if (!v || typeof v !== "object") continue;

      const a = Array.isArray(v);

      const num = x =>
        x === null || x === undefined || x === ""
          ? NaN
          : Number(x);

      let time = a
        ? v[0]
        : (v.time ?? v.timestamp ?? v.openTime ?? v.t);

      time =
        typeof time === "string" &&
        !/^\d+$/.test(time)
          ? Date.parse(time)
          : Number(time);

      if (time > 1e12) {
        time = Math.floor(time / 1000);
      }

      const open = num(
        a ? v[1] : (v.open ?? v.o)
      );

      const high = num(
        a ? v[2] : (v.high ?? v.h)
      );

      const low = num(
        a ? v[3] : (v.low ?? v.l)
      );

      const close = num(
        a ? v[4] : (v.close ?? v.c)
      );

      const volume = num(
        a ? v[5] : (v.volume ?? v.vol ?? v.v ?? 0)
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
      ) continue;

      if (
        time <= 0 ||
        low <= 0 ||
        volume < 0 ||
        high < Math.max(open, close, low) ||
        low > Math.min(open, close)
      ) continue;

      result.push({
        time,
        open,
        high,
        low,
        close,
        volume
      });
    }

    result.sort((a, b) => a.time - b.time);

    return [
      ...new Map(
        result.map(c => [c.time, c])
      ).values()
    ];
  }

  async function getCandles(asset, tf) {

    const interval = tf === "1m" ? 60 : 300;

    const url =
      "/api/exchange/bingx/klines/" +
      encodeURIComponent(asset.symbol) +
      "?market=perpetual" +
      "&interval=" + encodeURIComponent(tf) +
      "&limit=180";

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
          "Error HTTP " + response.status
        );
      }

      const payload = await response.json();

      if (
        payload?.code !== undefined &&
        ![0, "0"].includes(payload.code)
      ) {
        throw new Error(
          payload.msg || "Error de BingX"
        );
      }

      const data = normalize(payload);

      const currentTime = Math.floor(
        Date.now() / 1000
      );

      const closed = data.filter(c =>
        c.time + interval <= currentTime - 2
      );

      if (closed.length < 65) {
        throw new Error(
          "Historial insuficiente en " + tf
        );
      }

      if (
        currentTime - closed.at(-1).time >
        (tf === "1m" ? 240 : 900)
      ) {
        throw new Error(
          "Velas desactualizadas en " + tf
        );
      }

      return closed;

    } finally {
      clearTimeout(timeout);
    }
  }

  function ema(values, length) {

    if (values.length < length) return NaN;

    let result =
      values.slice(0, length)
        .reduce((a, b) => a + b, 0) / length;

    for (
      let i = length;
      i < values.length;
      i++
    ) {

      result =
        values[i] * 2 / (length + 1) +
        result * (length - 1) / (length + 1);
    }

    return result;
  }

  function sma(values, length) {

    if (values.length < length) return NaN;

    return values.slice(-length)
      .reduce((a, b) => a + b, 0) / length;
  }

  function atr(rows, length = 14) {

    const ranges = [];

    for (let i = 1; i < rows.length; i++) {

      ranges.push(Math.max(
        rows[i].high - rows[i].low,
        Math.abs(
          rows[i].high - rows[i - 1].close
        ),
        Math.abs(
          rows[i].low - rows[i - 1].close
        )
      ));
    }

    return sma(ranges, length);
  }

  function analyze(asset, one, five, side) {

    const isLong = side === "LONG";

    const last = one.at(-1);

    const closesOne = one.map(c => c.close);
    const closesFive = five.map(c => c.close);

    const emaOne = ema(closesOne, 21);
    const maOne = sma(closesOne, 55);

    const emaFive = ema(closesFive, 21);
    const maFive = sma(closesFive, 55);

    const aligned = isLong
      ? (
          last.close > emaOne &&
          emaOne > maOne &&
          five.at(-1).close > emaFive &&
          emaFive > maFive
        )
      : (
          last.close < emaOne &&
          emaOne < maOne &&
          five.at(-1).close < emaFive &&
          emaFive < maFive
        );

    if (!aligned) {
      return {
        status: "ESPERANDO CONFIRMACIÓN",
        reason:
          "Las medias de uno y cinco minutos " +
          "no están alineadas."
      };
    }

    const volatility = atr(one);

    if (
      !Number.isFinite(volatility) ||
      volatility <= 0
    ) {
      return {
        status: "ESPERANDO CONFIRMACIÓN",
        reason: "Volatilidad no verificable."
      };
    }

    const prior = one.slice(-13, -3);

    const level = isLong
      ? Math.max(...prior.map(c => c.high))
      : Math.min(...prior.map(c => c.low));

    const recent = one.slice(-3);

    const broke = recent.some(c =>
      isLong
        ? c.close > level + 0.04 * volatility
        : c.close < level - 0.04 * volatility
    );

    const retest = isLong
      ? (
          last.low <= level + 0.25 * volatility &&
          last.close > level
        )
      : (
          last.high >= level - 0.25 * volatility &&
          last.close < level
        );

    const baseline = sma(
      one.slice(-24, -4).map(c => c.volume),
      20
    );

    const recentVolume = Math.max(
      ...recent.map(c => c.volume)
    );

    const volumeOK =
      baseline > 0 &&
      recentVolume >= baseline * 1.3;

    if (
      !broke ||
      !retest ||
      !volumeOK
    ) {

      return {
        status: "ESPERANDO CONFIRMACIÓN",
        reason:
          "Ruptura: " + (broke ? "Sí" : "No") +
          " · Retesteo: " + (retest ? "Sí" : "No") +
          " · Volumen: " + (volumeOK ? "Sí" : "No")
      };
    }

    const entry = isLong
      ? last.high
      : last.low;

    const stop = isLong
      ? (
          Math.min(
            ...one.slice(-6).map(c => c.low)
          ) - 0.2 * volatility
        )
      : (
          Math.max(
            ...one.slice(-6).map(c => c.high)
          ) + 0.2 * volatility
        );

    const risk = Math.abs(entry - stop);

    const riskPct = 100 * risk / entry;

    if (
      risk <= 0 ||
      riskPct < 0.02 ||
      riskPct > 0.6
    ) {

      return {
        status: "ESPERANDO CONFIRMACIÓN",
        reason:
          "Stop estructural fuera del rango " +
          "permitido por la estrategia."
      };
    }

    const direction = isLong ? 1 : -1;

    const targets = [50, 100, 200].map(roi => {

      const price =
        entry * (
          1 +
          direction *
          roi / (100 * asset.leverage)
        );

      return {
        roi,
        price,
        rr: Math.abs(price - entry) / risk
      };
    });

    if (
      targets.some(t =>
        !Number.isFinite(t.price) ||
        t.price <= 0
      )
    ) {

      return {
        status: "ESPERANDO CONFIRMACIÓN",
        reason: "Objetivos no válidos."
      };
    }

    return {
      status: "CONFIGURACIÓN DETECTADA",
      reason:
        "Ruptura, retesteo, volumen " +
        "y tendencia alineados.",
      side,
      entry,
      stop,
      riskPct,
      targets,
      at: last.time,
      precision: asset.precision
    };
  }

  function addStyles() {

    if ($("clQuickScalpCSS")) return;

    const style = el("style");
    style.id = "clQuickScalpCSS";

    style.textContent = `
      .cl-quick-scalp {
        margin: 16px 0;
        padding: 15px;
        background: #0e1730;
        color: #e7eeff;
        border: 1px solid #344269;
        border-radius: 15px;
      }

      .clqs-top {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        flex-wrap: wrap;
      }

      .clqs-top h2 {
        font-size: 18px;
        color: #ffe15a;
        margin: 0;
      }

      .clqs-refresh {
        background: #29214c;
        color: white;
        border: 1px solid #7657ac;
        border-radius: 9px;
        padding: 9px 13px;
        cursor: pointer;
      }

      .clqs-note {
        font-size: 12px;
        color: #acbad6;
        line-height: 1.6;
        margin: 12px 0;
      }

      .clqs-grid {
        display: grid;
        grid-template-columns:
          repeat(
            auto-fit,
            minmax(min(100%, 280px), 1fr)
          );
        gap: 12px;
      }

      .clqs-asset {
        background: #111d36;
        border: 1px solid #35496b;
        border-radius: 12px;
        padding: 12px;
        min-width: 0;
      }

      .clqs-title {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        margin-bottom: 12px;
        font-weight: 700;
        font-size: 15px;
      }

      .clqs-lev {
        color: #ffe15a;
        font-size: 15px;
      }

      .clqs-sides {
        display: grid;
        grid-template-columns:
          repeat(2, minmax(0, 1fr));
        gap: 8px;
      }

      .clqs-side {
        padding: 10px 8px;
        border-radius: 10px;
        min-width: 0;
        background: #0b1429;
        border: 1px solid #2a3a56;
      }

      .clqs-side.long {
        border-top: 3px solid #00f5a0;
      }

      .clqs-side.short {
        border-top: 3px solid #ff476c;
      }

      .clqs-side h4 {
        font-size: 14px;
        margin: 0 0 10px;
      }

      .clqs-side.long h4 {
        color: #00f5a0;
      }

      .clqs-side.short h4 {
        color: #ff476c;
      }

      .clqs-status {
        font-size: 11px;
        color: #ffe15a;
        line-height: 1.5;
        margin-bottom: 8px;
        overflow-wrap: anywhere;
      }

      .clqs-line {
        font-size: 11px;
        line-height: 1.6;
        margin: 5px 0;
        overflow-wrap: anywhere;
      }

      .clqs-target {
        color: #00f5a0;
      }

      .clqs-reason {
        font-size: 11px;
        color: #aebbd4;
        line-height: 1.5;
        margin-top: 10px;
        overflow-wrap: anywhere;
      }

      @media (max-width: 370px) {
        .clqs-sides {
          grid-template-columns: 1fr;
        }
      }
    `;

    document.head.appendChild(style);
  }

  function build() {

    const host =
      $("clQuickScalpHost") ||
      $("clScreenScanner") ||
      $("clScanner") ||
      document.querySelector("main");

    if (!host) return false;

    let section = $("clQuickScalp");

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

    section.id = "clQuickScalp";

    const top = el("div", "clqs-top");

    top.append(
      el("h2", "", "⚡ SCALPING RÁPIDO")
    );

    const refresh = el(
      "button",
      "clqs-refresh",
      "Actualizar"
    );

    refresh.type = "button";

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
        "BTC y oro 100x · Petróleo WTI 50x. " +
        "Análisis informativo de uno y cinco minutos. " +
        "Solo futuros perpetuos BingX."
      )
    );

    const grid = el("div", "clqs-grid");
    grid.id = "clQuickScalpGrid";

    section.append(grid);

    for (const asset of ASSETS) {

      const card = el(
        "article",
        "clqs-asset"
      );

      const title = el(
        "div",
        "clqs-title"
      );

      title.append(
        el(
          "span",
          "",
          asset.icon + " " + asset.name
        ),
        el(
          "span",
          "clqs-lev",
          asset.leverage + "x"
        )
      );

      card.append(title);

      const sides = el(
        "div",
        "clqs-sides"
      );

      for (
        const side of ["LONG", "SHORT"]
      ) {

        const pane = el(
          "div",
          "clqs-side " + side.toLowerCase()
        );

        pane.id =
          "clqs-" +
          asset.symbol.replace(
            /[^a-z0-9]/gi,
            "_"
          ) +
          "-" + side;

        sides.append(pane);
      }

      card.append(sides);
      grid.append(card);
    }

    const status = el(
      "p",
      "clqs-note",
      "Preparando análisis..."
    );

    status.id = "clQuickScalpStatus";

    section.append(status);

    host.appendChild(section);

    render();

    return true;
  }

  function renderPane(asset, side, data) {

    const id =
      "clqs-" +
      asset.symbol.replace(
        /[^a-z0-9]/gi,
        "_"
      ) +
      "-" + side;

    const pane = $(id);

    if (!pane) return;

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
          "Entrada: " +
          fmt(data.entry, data.precision)
        )
      );

      pane.append(
        el(
          "div",
          "clqs-line",
          "Stop: " +
          fmt(data.stop, data.precision)
        )
      );

      pane.append(
        el(
          "div",
          "clqs-line",
          "Riesgo precio: " +
          fmt(data.riskPct, 3) + "%"
        )
      );

      pane.append(
        el(
          "div",
          "clqs-line",
          "Riesgo teórico sobre margen: " +
          fmt(
            data.riskPct * asset.leverage,
            1
          ) + "%"
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
            "% margen: " +
            fmt(
              target.price,
              data.precision
            ) +
            " · R/B " +
            fmt(target.rr, 2)
          )
        );
      }

      pane.append(
        el(
          "div",
          "clqs-line",
          "Evaluado: " +
          new Date(
            data.at * 1000
          ).toLocaleTimeString("es-MX")
        )
      );

    } else {

      pane.append(
        el(
          "div",
          "clqs-line",
          "Entrada: —"
        )
      );

      pane.append(
        el(
          "div",
          "clqs-line",
          "Stop: —"
        )
      );

      pane.append(
        el(
          "div",
          "clqs-line",
          "TP 50%: —"
        )
      );

      pane.append(
        el(
          "div",
          "clqs-line",
          "TP 100%: —"
        )
      );

      pane.append(
        el(
          "div",
          "clqs-line",
          "TP 200%: —"
        )
      );
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
        const side of ["LONG", "SHORT"]
      ) {

        renderPane(
          asset,
          side,
          state.get(
            asset.symbol + "|" + side
          )
        );
      }
    }
  }

  async function run(force = false) {

    if (!build()) return;

    if (busy || document.hidden) return;

    if (
      !force &&
      Date.now() - lastRun < 45000
    ) return;

    busy = true;
    lastRun = Date.now();

    const status = $("clQuickScalpStatus");

    if (status) {
      status.textContent =
        "Analizando velas cerradas...";
    }

    try {

      for (const asset of ASSETS) {

        try {

          const [one, five] =
            await Promise.all([
              getCandles(asset, "1m"),
              getCandles(asset, "5m")
            ]);

          for (
            const side of ["LONG", "SHORT"]
          ) {

            state.set(
              asset.symbol + "|" + side,
              analyze(
                asset,
                one,
                five,
                side
              )
            );
          }

        } catch (error) {

          for (
            const side of ["LONG", "SHORT"]
          ) {

            state.set(
              asset.symbol + "|" + side,
              {
                status:
                  "DATOS NO DISPONIBLES",
                reason:
                  String(
                    error.message || error
                  )
              }
            );
          }
        }

        render();
      }

      if (status) {

        status.textContent =
          "Última revisión: " +
          new Date().toLocaleTimeString(
            "es-MX"
          ) +
          " · Datos públicos BingX. " +
          "No son órdenes ejecutadas. " +
          "Los cálculos no incluyen " +
          "comisiones, financiación " +
          "ni deslizamiento.";
      }

    } finally {

      busy = false;
    }
  }

  function init() {

    if (!build()) {
      console.warn(
        "CRYPTOLEXUZ: no se encontró " +
        "el contenedor de scalping."
      );
      return;
    }

    run(true);

    if (!timer) {

      timer = setInterval(
        () => run(),
        60000
      );
    }

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
