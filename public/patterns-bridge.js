
/*
 CRYPTOLEXUZ PRO — PATTERNS BRIDGE V1
 Compatible con:
 - app.js V15
 - patterns.js V1
 - Lightweight Charts 4.2.2

 Conecta el motor de patrones con las velas.
 Actualiza los análisis automáticamente.
 No ejecuta operaciones.
*/

"use strict";

(() => {

  const $ = id => document.getElementById(id);

  let attached = false;
  let chart = null;
  let candle = null;

  let latestRows = [];
  let lastSignature = "";
  let timer = null;

  /* MERCADO ACTUAL */

  function selection() {

    const symbol =
      $("symbol")?.value || "BTC-USDT";

    const commodity = /NCCO/.test(symbol);

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

  /* NORMALIZAR VELAS */

  function normalizeRows(data) {

    if(!Array.isArray(data)) {
      return [];
    }

    return data
      .filter(x => {

        if(!x) return false;

        return (
          Number.isFinite(Number(x.time)) &&
          [
            x.open,
            x.high,
            x.low,
            x.close
          ].every(v =>
            Number.isFinite(Number(v)) &&
            Number(v) > 0
          )
        );

      })
      .map(x => ({

        time: Number(x.time),

        open: Number(x.open),

        high: Number(x.high),

        low: Number(x.low),

        close: Number(x.close),

        volume: Number(x.volume) || 0

      }));
  }

  /* ACTUALIZAR ANÁLISIS */

  function update(force = false) {

    const patterns =
      window.CryptolexuzPatterns;

    if(!attached || !patterns) {
      return;
    }

    const s = selection();

    const last = latestRows.at(-1);

    const signature = [
      s.exchange,
      s.market,
      s.symbol,
      s.tf,
      latestRows.length,
      last?.time,
      last?.open,
      last?.high,
      last?.low,
      last?.close
    ].join("|");

    if(
      !force &&
      signature === lastSignature
    ) {
      return;
    }

    lastSignature = signature;

    try {

      patterns.analyze();

      patterns.redraw();

    } catch(error) {

      console.warn(
        "CRYPTOLEXUZ Patterns:",
        error
      );

      const status = $("patternStatus");

      if(status) {

        status.textContent =
          "Error al analizar patrones: " +
          error.message;

      }
    }
  }

  /* CONECTAR MOTOR */

  function attach(event) {

    if(attached) {
      return;
    }

    const patterns =
      window.CryptolexuzPatterns;

    const detail = event.detail || {};

    chart = detail.chart;

    candle = detail.candle;

    if(
      !chart ||
      !candle ||
      typeof patterns?.attach !== "function"
    ) {
      return;
    }

    try {

      const originalSetData =
        candle.setData.bind(candle);

      const originalUpdate =
        candle.update.bind(candle);

      /* INTERCEPTAR CARGA DE VELAS */

      candle.setData = function(data) {

        const result =
          originalSetData(data);

        latestRows =
          normalizeRows(data);

        update(true);

        return result;
      };

      /* INTERCEPTAR VELAS EN VIVO */

      candle.update = function(bar) {

        const result =
          originalUpdate(bar);

        const item =
          normalizeRows([bar])[0];

        if(item) {

          const last =
            latestRows.at(-1);

          if(
            last &&
            last.time === item.time
          ) {

            latestRows[
              latestRows.length - 1
            ] = item;

          } else if(
            !last ||
            item.time > last.time
          ) {

            latestRows.push(item);

          }
        }

        update();

        return result;
      };

      /* CONECTAR PATTERNS.JS */

      patterns.attach(
        chart,
        candle,
        {
          getRows: () => latestRows,
          getSelection: selection
        }
      );

      attached = true;

      update(true);

      /* REVISIÓN PERIÓDICA */

      timer = setInterval(() => {

        if(!document.hidden) {
          update();
        }

      }, 2000);

      console.info(
        "CRYPTOLEXUZ PRO — " +
        "Patterns Bridge conectado"
      );

    } catch(error) {

      console.error(
        "Error al conectar patrones:",
        error
      );

    }
  }

  /* ESCUCHAR GRÁFICA LISTA */

  window.addEventListener(
    "cryptolexuz:chart-ready",
    attach
  );

  /* CAMBIOS DE MERCADO */

  function resetMarket() {

    latestRows = [];

    lastSignature = "";

    try {

      window.CryptolexuzPatterns
        ?.analyze?.();

      window.CryptolexuzPatterns
        ?.redraw?.();

    } catch(error) {

      console.warn(
        "Patterns: cambio de mercado",
        error
      );
    }
  }

  for(const id of [
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

  /* REGRESAR A LA APLICACIÓN */

  document.addEventListener(
    "visibilitychange",
    () => {

      if(!document.hidden) {
        update(true);
      }

    }
  );

  /* LIMPIEZA */

  window.addEventListener(
    "beforeunload",
    () => {

      if(timer) {
        clearInterval(timer);
      }

    }
  );

  console.info(
    "CRYPTOLEXUZ PRO — " +
    "Patterns Bridge V1 cargado"
  );

})();
