
/*
 CRYPTOLEXUZ PRO — PATTERNS-BRIDGE.JS V2 COMPLETO

 Compatible con:
 - APP.JS V24
 - PATTERNS.JS V3
 - Lightweight Charts 4.2.2

 Correcciones:
 - Reconexión al recrear la gráfica.
 - Sin modificar candle.setData ni candle.update.
 - Sin duplicar suscripciones.
 - Sin intervalos innecesarios.
 - Actualización al recibir nuevas velas.
 - Limpieza al cambiar de mercado.
 - Normalización de precios y volumen.
 - Conserva el análisis con velas cerradas.
 - No ejecuta operaciones.
*/

"use strict";

(() => {
  if (window.__CL_PATTERNS_BRIDGE_V2__) return;
  window.__CL_PATTERNS_BRIDGE_V2__ = true;

  const $ = id => document.getElementById(id);

  let chart = null;
  let candle = null;

  let latestRows = [];
  let lastSignature = "";

  let attached = false;
  let pending = false;
  let scheduled = 0;

  let marketKey = "";

  function selection() {
    const symbol =
      $("symbol")?.value || "BTC-USDT";

    const commodity = /^NCCO/i.test(symbol);

    return {
      symbol,

      tf:
        $("interval")?.value || "15m",

      exchange: commodity
        ? "bingx"
        : $("exchange")?.value || "bingx",

      market: commodity
        ? "perpetual"
        : $("market")?.value || "perpetual"
    };
  }

  function selectionKey() {
    const s = selection();

    return [
      s.exchange,
      s.market,
      s.symbol,
      s.tf
    ].join("|");
  }

  function normalizeTime(value) {
    if (
      typeof value === "number" &&
      Number.isFinite(value)
    ) {
      return value > 1e11
        ? Math.floor(value / 1000)
        : value;
    }

    if (typeof value === "string") {
      const numeric = Number(value);

      if (Number.isFinite(numeric)) {
        return normalizeTime(numeric);
      }

      const parsed = Date.parse(value);

      return Number.isFinite(parsed)
        ? Math.floor(parsed / 1000)
        : null;
    }

    if (
      value &&
      typeof value === "object" &&
      Number.isInteger(value.year) &&
      Number.isInteger(value.month) &&
      Number.isInteger(value.day)
    ) {
      return Math.floor(
        Date.UTC(
          value.year,
          value.month - 1,
          value.day
        ) / 1000
      );
    }

    return null;
  }

  function normalizeRows(data) {
    if (!Array.isArray(data)) return [];

    const result = [];

    for (const bar of data) {
      if (!bar) continue;

      const time = normalizeTime(bar.time);

      const open = Number(bar.open);
      const high = Number(bar.high);
      const low = Number(bar.low);
      const close = Number(bar.close);

      const volume = Number(bar.volume) || 0;

      if (
        time === null ||
        ![open, high, low, close].every(
          value =>
            Number.isFinite(value) &&
            value > 0
        )
      ) {
        continue;
      }

      if (
        high < Math.max(open, close, low) ||
        low > Math.min(open, close, high)
      ) {
        continue;
      }

      result.push({
        time,
        open,
        high,
        low,
        close,
        volume: Math.max(0, volume)
      });
    }

    result.sort(
      (a, b) => a.time - b.time
    );

    const unique = [];

    for (const bar of result) {
      const last = unique.at(-1);

      if (last && last.time === bar.time) {
        unique[unique.length - 1] = bar;
      } else {
        unique.push(bar);
      }
    }

    return unique;
  }

  function getGlobalChart() {
    const api = window.CryptolexuzChart;

    if (!api) return null;

    const nextChart =
      api.chart ||
      api.chartApi;

    const nextCandle =
      api.candle ||
      api.candleSeries;

    if (!nextChart || !nextCandle) {
      return null;
    }

    return {
      chart: nextChart,
      candle: nextCandle,
      api
    };
  }

  function getGlobalRows() {
    const api = window.CryptolexuzChart;

    if (!api) return null;

    try {
      if (typeof api.getRows === "function") {
        return api.getRows();
      }

      if (typeof api.getCandles === "function") {
        return api.getCandles();
      }
    } catch (error) {
      console.warn(
        "Patterns Bridge: lectura de velas",
        error
      );
    }

    return null;
  }

  function signature() {
    const first = latestRows[0];
    const last = latestRows.at(-1);

    return [
      selectionKey(),
      latestRows.length,
      first?.time,
      last?.time,
      last?.open,
      last?.high,
      last?.low,
      last?.close,
      last?.volume
    ].join("|");
  }

  function update(force = false) {
    const patterns =
      window.CryptolexuzPatterns;

    if (
      !attached ||
      !patterns ||
      typeof patterns.analyze !== "function"
    ) {
      return false;
    }

    const nextSignature = signature();

    if (
      !force &&
      nextSignature === lastSignature
    ) {
      return false;
    }

    lastSignature = nextSignature;

    try {
      patterns.analyze();
      patterns.redraw?.();

      return true;
    } catch (error) {
      lastSignature = "";

      console.warn(
        "CRYPTOLEXUZ Patterns:",
        error
      );

      const status = $("patternStatus");

      if (status) {
        status.textContent =
          "Error al analizar patrones: " +
          error.message;
      }

      return false;
    }
  }

  function scheduleUpdate(force = false) {
    pending = pending || force;

    if (scheduled) return;

    scheduled = requestAnimationFrame(() => {
      scheduled = 0;

      const shouldForce = pending;
      pending = false;

      update(shouldForce);
    });
  }

  function attach(
    nextChart,
    nextCandle,
    options = {}
  ) {
    const patterns =
      window.CryptolexuzPatterns;

    if (
      !nextChart ||
      !nextCandle ||
      typeof patterns?.attach !== "function"
    ) {
      return false;
    }

    const changed =
      chart !== nextChart ||
      candle !== nextCandle;

    chart = nextChart;
    candle = nextCandle;

    if (
      typeof options.getRows === "function"
    ) {
      try {
        latestRows = normalizeRows(
          options.getRows()
        );
      } catch (_) {}
    } else {
      const globalRows = getGlobalRows();

      if (Array.isArray(globalRows)) {
        latestRows = normalizeRows(
          globalRows
        );
      }
    }

    const sourceRows = () => latestRows;

    try {
      patterns.attach(
        chart,
        candle,
        {
          getRows: sourceRows,
          getSelection: selection
        }
      );

      attached = true;
      marketKey = selectionKey();

      if (changed) {
        lastSignature = "";
      }

      scheduleUpdate(true);

      console.info(
        "CRYPTOLEXUZ PRO — " +
        "Patterns Bridge V2 conectado"
      );

      return true;
    } catch (error) {
      attached = false;

      console.error(
        "Patterns Bridge: conexión",
        error
      );

      return false;
    }
  }

  function attachFromGlobal() {
    const global = getGlobalChart();

    if (!global) return false;

    return attach(
      global.chart,
      global.candle,
      {
        getRows:
          typeof global.api.getRows === "function"
            ? global.api.getRows
            : global.api.getCandles
      }
    );
  }

  function resetMarket() {
    marketKey = selectionKey();

    latestRows = [];
    lastSignature = "";

    scheduleUpdate(true);
  }

  function receiveCandles(event) {
    const detail = event?.detail || {};

    const currentKey = selectionKey();

    if (marketKey !== currentKey) {
      resetMarket();
    }

    if (Array.isArray(detail.rows)) {
      latestRows = normalizeRows(
        detail.rows
      );
    } else if (Array.isArray(detail.candles)) {
      latestRows = normalizeRows(
        detail.candles
      );
    } else {
      const globalRows = getGlobalRows();

      if (Array.isArray(globalRows)) {
        latestRows = normalizeRows(
          globalRows
        );
      }
    }

    if (!attached) {
      attachFromGlobal();
    }

    scheduleUpdate();
  }

  function onChartReady(event) {
    const detail = event?.detail || {};

    const nextChart =
      detail.chart ||
      detail.chartApi;

    const nextCandle =
      detail.candle ||
      detail.candleSeries;

    if (nextChart && nextCandle) {
      attach(
        nextChart,
        nextCandle,
        {
          getRows: detail.getRows
        }
      );
    } else {
      attachFromGlobal();
    }
  }

  function bindControls() {
    for (const id of [
      "symbol",
      "interval",
      "exchange",
      "market"
    ]) {
      $(id)?.addEventListener(
        "change",
        resetMarket
      );
    }
  }

  function init() {
    bindControls();

    window.addEventListener(
      "cryptolexuz:chart-ready",
      onChartReady
    );

    window.addEventListener(
      "cryptolexuz:candles-updated",
      receiveCandles
    );

    window.addEventListener(
      "cryptolexuz:screen-change",
      () => {
        scheduleUpdate(true);
      }
    );

    document.addEventListener(
      "visibilitychange",
      () => {
        if (!document.hidden) {
          const globalRows = getGlobalRows();

          if (Array.isArray(globalRows)) {
            latestRows = normalizeRows(
              globalRows
            );
          }

          scheduleUpdate(true);
        }
      }
    );

    attachFromGlobal();
  }

  window.CryptolexuzPatternsBridge = {
    version: "2",
    attach,
    update,
    resetMarket,
    getRows: () => latestRows.map(
      row => ({ ...row })
    ),
    getSelection: selection
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

  console.info(
    "CRYPTOLEXUZ PRO — " +
    "Patterns Bridge V2 cargado"
  );
})();
