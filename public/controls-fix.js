
/*
 CRYPTOLEXUZ PRO
 CONTROLS-FIX V1

 Integración visual de:
 - Temporalidades
 - Indicadores
 - Patrones
 - Fondo negro
 - Desplazamiento horizontal

 Compatible con INDEX V29.
 No reemplaza los cálculos de app.js.
*/

"use strict";

(() => {
  if (window.__CL_CONTROLS_FIX_V1__) return;
  window.__CL_CONTROLS_FIX_V1__ = true;

  const $ = id => document.getElementById(id);

  const qs = selector =>
    Array.from(document.querySelectorAll(selector));

  const SETTINGS_KEY =
    "cryptolexuz-chart-settings-v1";

  const style = document.createElement("style");

  style.textContent = `
    #priceChartArea,
    #chart,
    #chart canvas {
      background-color: #000000 !important;
    }

    #clTradingControlRows {
      display: flex;
      flex-direction: column;
      gap: 8px;
      width: 100%;
      min-width: 0;
      margin: 12px 0;
    }

    #clTradingControlRows .cl-control-row {
      width: 100%;
      min-width: 0;
    }

    #clTradingControlRows .cl-control-label {
      display: block;
      margin: 0 0 5px;
      color: #aebcdd;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: .5px;
      text-transform: uppercase;
    }

    #clTradingControlRows .cl-timeframes,
    #clTradingControlRows .indicator-buttons {
      display: flex !important;
      flex-direction: row !important;
      flex-wrap: nowrap !important;
      align-items: center;
      gap: 6px;
      width: 100%;
      min-width: 0;
      padding: 4px 0 9px;
      overflow-x: auto;
      overflow-y: hidden;
      overscroll-behavior-x: contain;
      -webkit-overflow-scrolling: touch;
      scrollbar-width: thin;
      scrollbar-color: #7043a7 #11121a;
      touch-action: pan-x;
    }

    #clTradingControlRows button {
      flex: 0 0 auto !important;
      min-height: 34px;
      padding: 7px 11px;
      border: 1px solid #34364c;
      border-radius: 8px;
      background: #171a25;
      color: #e6e9ff;
      font-size: 12px;
      font-weight: 600;
      white-space: nowrap;
      cursor: pointer;
    }

    #clTradingControlRows button.active,
    #clTradingControlRows button[aria-pressed="true"] {
      background: #48216c !important;
      color: #ffffff !important;
      border-color: #c477ff !important;
      box-shadow: inset 0 0 0 1px
        rgba(196,119,255,.15);
    }

    #clTradingControlRows button:disabled {
      opacity: .45;
      cursor: not-allowed;
    }

    #clTradingControlRows button:focus-visible {
      outline: 2px solid #d59aff;
      outline-offset: 2px;
    }

    #clTradingControlRows
    .cl-pattern-priority {
      border-color: #a46bff;
    }

    #clTradingControlRows
    .cl-control-row + .cl-control-row {
      border-top: 1px solid #25283a;
      padding-top: 7px;
    }

    #clTradingControlRows .cl-control-note {
      color: #8993af;
      font-size: 10px;
      padding-bottom: 3px;
    }

    @media (max-width: 600px) {
      #clTradingControlRows button {
        min-height: 36px;
        font-size: 11px;
        padding: 8px 10px;
      }
    }
  `;

  document.head.appendChild(style);

  function readPrefs() {
    try {
      return JSON.parse(
        localStorage.getItem(SETTINGS_KEY) || "{}"
      ) || {};
    } catch {
      return {};
    }
  }

  function makeRow(label, className) {
    const row = document.createElement("div");
    row.className = "cl-control-row " + className;

    const heading = document.createElement("span");
    heading.className = "cl-control-label";
    heading.textContent = label;

    row.appendChild(heading);
    return row;
  }

  function syncTimeframes() {
    const interval = $("interval");
    if (!interval) return;

    qs("[data-tf]").forEach(button => {
      const active =
        button.dataset.tf === interval.value;

      button.classList.toggle("active", active);
      button.setAttribute(
        "aria-pressed",
        String(active)
      );
    });
  }

  function syncIndicators() {
    const prefs = readPrefs();
    const indicators = prefs.indicators || {};

    const maLines = Array.isArray(prefs.maLines)
      ? prefs.maLines
      : [
          { period: 55, enabled: true },
          { period: 100, enabled: false },
          { period: 200, enabled: false }
        ];

    const emaLines = Array.isArray(prefs.emaLines)
      ? prefs.emaLines
      : [
          { period: 21, enabled: true }
        ];

    const names = {
      rsi: "RSI",
      adx: "ADX",
      ao: "AO",
      fvg: "FVG",
      ifvg: "IFVG",
      liquidity: "liquidity",
      sweeps: "sweeps",
      support: "support",
      resistance: "resistance"
    };

    qs("[data-indicator]").forEach(button => {
      const id = button.dataset.indicator;
      let active;

      if (id.startsWith("ma")) {
        const period = Number(id.slice(2));

        active = maLines.some(line =>
          Number(line.period) === period &&
          line.enabled !== false
        );
      } else if (id.startsWith("ema")) {
        const period = Number(id.slice(3));

        active = emaLines.some(line =>
          Number(line.period) === period &&
          line.enabled !== false
        );
      } else {
        const name = names[id];

        if (
          name &&
          typeof indicators[name] === "boolean"
        ) {
          active = indicators[name];
        } else {
          return;
        }
      }

      button.classList.toggle("active", active);
      button.setAttribute(
        "aria-pressed",
        String(active)
      );
    });
  }

  function applyBlackBackground() {
    const area = $("priceChartArea");
    const chart = $("chart");

    if (area) {
      area.style.backgroundColor = "#000000";
    }

    if (chart) {
      chart.style.backgroundColor = "#000000";
    }

    // Lightweight Charts requiere además que
    // app.js configure el fondo de su instancia
    // con chart.applyOptions().
    const api = window.CryptolexuzChart;

    try {
      if (
        api?.chart &&
        typeof api.chart.applyOptions === "function"
      ) {
        api.chart.applyOptions({
          layout: {
            background: {
              type: "solid",
              color: "#000000"
            }
          }
        });
      }
    } catch (error) {
      console.warn(
        "No se pudo actualizar el fondo:",
        error
      );
    }
  }

  function organizeControls() {
    const graph = $("clGraphContent");
    const chartArea = $("priceChartArea");

    const timeframes =
      document.querySelector(".cl-timeframes");

    const indicators = $("indicatorButtons");
    const patterns = $("patternButtons");

    if (!graph || !chartArea) return;
    if (!timeframes || !indicators || !patterns) {
      return;
    }

    let host = $("clTradingControlRows");

    if (!host) {
      host = document.createElement("div");
      host.id = "clTradingControlRows";
      host.setAttribute(
        "aria-label",
        "Controles de análisis técnico"
      );

      const firstRow = makeRow(
        "Temporalidades",
        "cl-timeframe-row"
      );

      const secondRow = makeRow(
        "Indicadores",
        "cl-indicators-row"
      );

      const thirdRow = makeRow(
        "Patrones",
        "cl-patterns-row"
      );

      firstRow.appendChild(timeframes);
      secondRow.appendChild(indicators);
      thirdRow.appendChild(patterns);

      host.append(
        firstRow,
        secondRow,
        thirdRow
      );

      const controls =
        graph.querySelector(".chart-controls");

      graph.insertBefore(
        host,
        controls || chartArea
      );
    }

    const wedge = patterns.querySelector(
      '[data-pattern="fallingwedge"]'
    );

    if (wedge) {
      wedge.classList.add(
        "cl-pattern-priority"
      );

      wedge.title =
        "Cuña descendente: pendiente de activación verificable";
    }

    const sidebar = $("sidebar");

    if (sidebar) {
      qs("#sidebar h3").forEach(heading => {
        const text =
          heading.textContent.trim().toLowerCase();

        if (
          text === "indicadores" ||
          text === "patrones automáticos"
        ) {
          heading.hidden = true;
        }
      });
    }

    // La franja antigua debajo del volumen
    // se oculta para evitar controles repetidos.
    // Los ajustes siguen disponibles en ⚙.
    const oldStrip =
      document.querySelector(".cl-indicator-strip");

    if (oldStrip) {
      oldStrip.hidden = true;
      oldStrip.style.display = "none";
    }

    syncTimeframes();
    syncIndicators();
    applyBlackBackground();
  }

  function init() {
    organizeControls();

    $("interval")?.addEventListener(
      "change",
      syncTimeframes
    );

    window.addEventListener(
      "cryptolexuz:indicator-settings-change",
      syncIndicators
    );

    window.addEventListener(
      "cryptolexuz:chart-ready",
      applyBlackBackground
    );

    window.addEventListener(
      "cryptolexuz:screen-change",
      () => {
        requestAnimationFrame(() => {
          syncTimeframes();
          syncIndicators();
          applyBlackBackground();
        });
      }
    );

    // Los botones existentes conservan
    // sus manejadores de app.js.
    // No añadimos segundos manejadores
    // de click para evitar dobles solicitudes.

    console.info(
      "CRYPTOLEXUZ PRO: controles V1 instalados"
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
