
/*
 CRYPTOLEXUZ PRO — CONTROLS-FIX V3 COMPLETO

 Compatible con:
 - APP.JS V24
 - STYLES.CSS V25
 - INDEX.HTML V32

 Correcciones:
 - No duplica filas existentes.
 - Temporalidades sincronizadas.
 - Indicadores conectados al motor principal.
 - No duplica eventos de APP.JS.
 - Patrones pendientes, sin señales falsas.
 - Fondo negro.
 - Desplazamiento táctil.
 - Integración segura con Volume Profile.

 Este módulo no ejecuta órdenes.
*/

"use strict";

(() => {
  if (window.__CL_CONTROLS_FIX_V3__) return;
  window.__CL_CONTROLS_FIX_V3__ = true;

  const $ = id => document.getElementById(id);

  const TIMEFRAMES = [
    "1m", "3m", "5m", "15m",
    "30m", "1h", "2h", "4h",
    "6h", "8h", "12h", "1d",
    "3d", "1w", "1M"
  ];

  const INDICATORS = [
    ["ema21", "EMA 21"],
    ["ma55", "MA 55"],
    ["ma100", "MA 100"],
    ["ma200", "MA 200"],
    ["rsi", "RSI"],
    ["adx", "ADX"],
    ["ao", "AO"],
    ["volume", "VOL"],
    ["fvg", "FVG"],
    ["ifvg", "IFVG"],
    ["liquidity", "Liquidez"],
    ["sweeps", "Barridos"],
    ["support", "Soportes"],
    ["resistance", "Resistencias"]
  ];

  const PATTERNS = [
    ["falling-wedge", "Cuña descendente"],
    ["rising-wedge", "Cuña ascendente"],
    ["double-top", "Doble techo"],
    ["double-bottom", "Doble suelo"],
    ["head-shoulders", "HCH"],
    ["inverse-head-shoulders", "HCH invertido"],
    ["rsi-divergence", "Divergencia RSI"],
    ["zigzag", "Zig-Zag"],
    ["abc", "ABC"],
    ["abcde", "ABCDE"]
  ];

  const SETTINGS_KEY =
    "cryptolexuz-chart-settings-v1";

  let initialized = false;
  let syncing = false;

  function readSettings() {
    try {
      const value = JSON.parse(
        localStorage.getItem(SETTINGS_KEY) || "{}"
      );

      return value &&
        typeof value === "object" &&
        !Array.isArray(value)
          ? value
          : {};
    } catch {
      return {};
    }
  }

  function indicatorState(name) {
    const api = window.CryptolexuzIndicators;

    if (typeof api?.isEnabled === "function") {
      try {
        return Boolean(api.isEnabled(name));
      } catch (error) {
        console.warn("Estado indicador:", error);
      }
    }

    const config = readSettings();
    const flags = config.indicators || {};

    const named = {
      ema21: ["EMA", "emaLines", 21, true],
      ma55: ["MA", "maLines", 55, true],
      ma100: ["MA", "maLines", 100, false],
      ma200: ["MA", "maLines", 200, false]
    };

    if (named[name]) {
      const [group, field, period, fallback] =
        named[name];

      if (flags[group] === false) return false;

      const lines = config[field];

      if (!Array.isArray(lines)) return fallback;

      return lines.some(line =>
        Number(line.period) === period &&
        line.enabled !== false
      );
    }

    const keys = {
      rsi: "RSI",
      adx: "ADX",
      ao: "AO",
      volume: "VOL",
      fvg: "FVG",
      ifvg: "IFVG",
      liquidity: "liquidity",
      sweeps: "sweeps",
      support: "support",
      resistance: "resistance"
    };

    const defaults = {
      RSI: true,
      ADX: false,
      AO: false,
      VOL: true,
      FVG: true,
      IFVG: false,
      liquidity: false,
      sweeps: false,
      support: false,
      resistance: false
    };

    const key = keys[name];

    if (!key) return false;

    return flags[key] === undefined
      ? defaults[key]
      : Boolean(flags[key]);
  }

  function ensureTimeframeOption(tf) {
    const select = $("interval");

    if (!select || !TIMEFRAMES.includes(tf)) {
      return false;
    }

    const exists = Array.from(select.options)
      .some(option => option.value === tf);

    if (!exists) {
      const option = document.createElement("option");
      option.value = tf;
      option.textContent = tf;
      select.appendChild(option);
    }

    return true;
  }

  function changeTimeframe(tf) {
    if (!TIMEFRAMES.includes(tf)) return false;

    const select = $("interval");

    if (!select || !ensureTimeframeOption(tf)) {
      console.warn(
        "No se encontró el selector de temporalidad."
      );
      return false;
    }

    if (select.value !== tf) {
      select.value = tf;

      select.dispatchEvent(
        new Event("change", { bubbles: true })
      );
    }

    syncTimeframes();
    return true;
  }

  function syncTimeframes() {
    const active = $("interval")?.value;

    document.querySelectorAll(
      "[data-tf], [data-cl-tf]"
    ).forEach(button => {
      const tf =
        button.dataset.tf ||
        button.dataset.clTf;

      const selected = tf === active;

      button.classList.toggle(
        "active",
        selected
      );

      button.setAttribute(
        "aria-pressed",
        String(selected)
      );
    });
  }

  function syncIndicators() {
    document.querySelectorAll(
      "[data-indicator], [data-cl-indicator]"
    ).forEach(button => {
      const name =
        button.dataset.indicator ||
        button.dataset.clIndicator;

      if (!name) return;

      if (
        name === "vp" ||
        name === "volume-profile"
      ) {
        return;
      }

      const active = indicatorState(name);

      button.classList.toggle(
        "active",
        active
      );

      button.setAttribute(
        "aria-pressed",
        String(active)
      );
    });
  }

  function toggleIndicator(name) {
    if (syncing) return false;

    const api = window.CryptolexuzIndicators;

    if (
      typeof api?.toggleIndicator !== "function" &&
      typeof api?.setIndicator !== "function"
    ) {
      console.warn(
        "El motor de indicadores no está disponible."
      );
      return false;
    }

    syncing = true;

    try {
      if (
        typeof api.toggleIndicator === "function"
      ) {
        api.toggleIndicator(name);
      } else {
        api.setIndicator(
          name,
          !indicatorState(name)
        );
      }

      syncIndicators();
      return true;
    } catch (error) {
      console.error(
        "No se pudo cambiar el indicador:",
        error
      );
      return false;
    } finally {
      syncing = false;
    }
  }

  function createRow(labelText, id) {
    const wrapper = document.createElement("div");

    const label = document.createElement("div");
    label.className = "cl-fixed-control-label";
    label.textContent = labelText;

    const row = document.createElement("div");
    row.id = id;
    row.className = "cl-fixed-control-row";

    wrapper.append(label, row);

    return { wrapper, row };
  }

  function makeButton(label, attributes) {
    const button = document.createElement("button");

    button.type = "button";
    button.textContent = label;

    for (const [key, value] of
      Object.entries(attributes)) {
      button.setAttribute(key, value);
    }

    return button;
  }

  function existingControls() {
    return Boolean(
      document.querySelector(".cl-timeframes [data-tf]") ||
      document.querySelector(
        ".cl-indicator-strip [data-indicator]"
      ) ||
      $("clFixedControls")
    );
  }

  function createControls() {
    /*
     INDEX V32 ya contiene filas de controles.
     No se crean filas adicionales si existen.
    */

    if (existingControls()) return;

    const anchor =
      $("priceChartArea") ||
      $("chart");

    if (!anchor?.parentElement) return;

    const stack = document.createElement("div");
    stack.id = "clFixedControls";
    stack.className = "cl-fixed-control-stack";

    const timeframes = createRow(
      "TEMPORALIDADES",
      "clFixedTimeframes"
    );

    const indicators = createRow(
      "INDICADORES",
      "clFixedIndicators"
    );

    const patterns = createRow(
      "PATRONES",
      "clFixedPatterns"
    );

    for (const tf of TIMEFRAMES) {
      const button = makeButton(tf, {
        "data-cl-tf": tf,
        "aria-pressed": "false"
      });

      timeframes.row.appendChild(button);
    }

    for (const [name, label] of INDICATORS) {
      const button = makeButton(label, {
        "data-cl-indicator": name,
        "aria-pressed": "false"
      });

      indicators.row.appendChild(button);
    }

    for (const [name, label] of PATTERNS) {
      const button = makeButton(label, {
        "data-cl-pattern": name,
        "aria-pressed": "false",
        "title": "Detección pendiente de integración"
      });

      button.disabled = true;

      patterns.row.appendChild(button);
    }

    stack.append(
      timeframes.wrapper,
      indicators.wrapper,
      patterns.wrapper
    );

    anchor.parentElement.insertBefore(
      stack,
      anchor
    );
  }

  function bindControls() {
    /*
     Los botones data-tf y data-indicator
     ya pertenecen a APP.JS V24.

     Este módulo sólo maneja:
     data-cl-tf y data-cl-indicator.
    */

    document.addEventListener("click", event => {
      const target = event.target;

      if (!(target instanceof Element)) return;

      const tfButton = target.closest(
        "[data-cl-tf]"
      );

      if (tfButton) {
        if (!tfButton.disabled) {
          changeTimeframe(
            tfButton.dataset.clTf
          );
        }
        return;
      }

      const indicatorButton = target.closest(
        "[data-cl-indicator]"
      );

      if (indicatorButton) {
        if (!indicatorButton.disabled) {
          toggleIndicator(
            indicatorButton.dataset.clIndicator
          );
        }
      }
    });
  }

  function blackCharts() {
    const api = window.CryptolexuzChart;

    try {
      api?.chart?.applyOptions({
        layout: {
          background: {
            type: "solid",
            color: "#000000"
          }
        },
        grid: {
          vertLines: {
            color: "#141414"
          },
          horzLines: {
            color: "#141414"
          }
        }
      });
    } catch (error) {
      console.warn(
        "No se pudo actualizar el fondo:",
        error
      );
    }
  }

  function enableVerticalScroll() {
    /*
     Permite desplazar la página
     verticalmente sobre la gráfica.

     No modifica las capas de edición
     de Fibonacci ni de cajas.
    */

    const chart = $("chart");

    if (!chart) return;

    chart.style.setProperty(
      "touch-action",
      "pan-y",
      "important"
    );
  }

  function volumeProfile() {
    return (
      window.CryptolexuzVolumeProfile ||
      window.CRYPTOLEXUZ_VOLUME_PROFILE ||
      null
    );
  }

  function syncVolumeProfile() {
    /*
     No se agregan listeners a los botones
     de Volume Profile para evitar
     dobles activaciones.

     Su módulo debe administrar el toggle.
    */

    const module = volumeProfile();

    if (!module) return;

    document.querySelectorAll(
      '[data-indicator="vp"],' +
      '[data-indicator="volume-profile"]'
    ).forEach(button => {
      const active =
        typeof module.isEnabled === "function"
          ? Boolean(module.isEnabled())
          : false;

      button.classList.toggle(
        "active",
        active
      );

      button.setAttribute(
        "aria-pressed",
        String(active)
      );
    });
  }

  function synchronize() {
    syncTimeframes();
    syncIndicators();
    syncVolumeProfile();
    enableVerticalScroll();
  }

  function init() {
    if (initialized) return;
    initialized = true;

    createControls();
    bindControls();

    $("interval")?.addEventListener(
      "change",
      syncTimeframes
    );

    window.addEventListener(
      "cryptolexuz:indicator-state-updated",
      syncIndicators
    );

    window.addEventListener(
      "cryptolexuz:indicator-settings-change",
      () => {
        queueMicrotask(syncIndicators);
      }
    );

    window.addEventListener(
      "cryptolexuz:chart-ready",
      () => {
        blackCharts();
        enableVerticalScroll();
        syncVolumeProfile();
      }
    );

    window.addEventListener(
      "cryptolexuz:volume-profile-ready",
      syncVolumeProfile
    );

    window.addEventListener(
      "cryptolexuz:screen-change",
      synchronize
    );

    window.CryptolexuzControlsFix = {
      changeTimeframe,
      toggleIndicator,
      syncTimeframes,
      syncIndicators,
      blackCharts,
      synchronize
    };

    synchronize();
    blackCharts();
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

/* FIN — CONTROLS-FIX V3 */
