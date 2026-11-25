
/*
 CRYPTOLEXUZ PRO
 CONTROLS-FIX V2
 Compatible con INDEX V30 y APP.JS V23.

 - Temporalidades funcionales
 - Indicadores sincronizados
 - Patrones en su propia fila
 - Desplazamiento horizontal
 - Fondo negro
 - Volume Profile
 - Conserva el motor de análisis
*/

"use strict";

(() => {
  if (window.__CL_CONTROLS_FIX_V2__) return;
  window.__CL_CONTROLS_FIX_V2__ = true;

  const $ = id => document.getElementById(id);

  const SETTINGS_KEY =
    "cryptolexuz-chart-settings-v1";

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

  let ready = false;
  let syncing = false;

  function settings() {
    try {
      return JSON.parse(
        localStorage.getItem(SETTINGS_KEY) || "{}"
      ) || {};
    } catch {
      return {};
    }
  }

  function saveSettings(data) {
    try {
      localStorage.setItem(
        SETTINGS_KEY,
        JSON.stringify(data)
      );
    } catch (error) {
      console.warn("Ajustes:", error);
    }
  }

  function notifySettings() {
    window.dispatchEvent(
      new CustomEvent(
        "cryptolexuz:indicator-settings-change"
      )
    );
  }

  function styles() {
    if ($("clControlsFixStyles")) return;

    const style = document.createElement("style");
    style.id = "clControlsFixStyles";

    style.textContent = `
      #priceChartArea,
      #chart,
      #volumeChart,
      #rsiChart,
      #adxChart,
      #aoChart {
        background: #000 !important;
      }

      .cl-fixed-control-stack {
        display: flex;
        flex-direction: column;
        gap: 7px;
        width: 100%;
        min-width: 0;
        margin: 10px 0;
      }

      .cl-fixed-control-row {
        display: flex;
        align-items: center;
        gap: 7px;
        overflow-x: auto;
        overflow-y: hidden;
        white-space: nowrap;
        width: 100%;
        min-width: 0;
        padding: 5px 2px 9px;
        scrollbar-width: thin;
        scrollbar-color: #7041b8 transparent;
        -webkit-overflow-scrolling: touch;
        touch-action: pan-x;
      }

      .cl-fixed-control-row button {
        flex: 0 0 auto;
        min-height: 36px;
        padding: 7px 12px;
        border: 1px solid #394057;
        border-radius: 9px;
        background: #171b2a;
        color: #e7eaff;
        font-size: 12px;
        font-weight: 700;
        cursor: pointer;
        touch-action: manipulation;
      }

      .cl-fixed-control-row button.active {
        color: #fff;
        border-color: #a84cff;
        background: #63309c;
        box-shadow: 0 0 8px #a84cff55;
      }

      .cl-fixed-control-row button:disabled {
        opacity: .48;
        cursor: not-allowed;
      }

      .cl-fixed-control-label {
        color: #aab5d5;
        font-size: 11px;
        font-weight: 800;
        letter-spacing: .6px;
        margin: 3px 0 0;
      }

      #clFixedControls [hidden] {
        display: none !important;
      }

      #priceChartArea {
        position: relative;
        isolation: isolate;
      }
    `;

    document.head.appendChild(style);
  }

  function createRow(title, id) {
    const wrapper = document.createElement("div");

    const label = document.createElement("div");
    label.className = "cl-fixed-control-label";
    label.textContent = title;

    const row = document.createElement("div");
    row.id = id;
    row.className = "cl-fixed-control-row";

    wrapper.append(label, row);

    return { wrapper, row };
  }

  function makeButton(text, attributes) {
    const button = document.createElement("button");

    button.type = "button";
    button.textContent = text;

    for (const [name, value] of
      Object.entries(attributes)) {
      button.setAttribute(name, value);
    }

    return button;
  }

  function ensureTimeframeOption(tf) {
    const select = $("interval");

    if (!select) return false;

    if (
      !Array.from(select.options)
        .some(option => option.value === tf)
    ) {
      const option = document.createElement("option");
      option.value = tf;
      option.textContent = tf;
      select.appendChild(option);
    }

    return true;
  }

  function changeTimeframe(tf) {
    if (!TIMEFRAMES.includes(tf)) return;

    const select = $("interval");

    if (!select || !ensureTimeframeOption(tf)) {
      return;
    }

    if (select.value !== tf) {
      select.value = tf;

      select.dispatchEvent(
        new Event("change", { bubbles: true })
      );
    }

    syncTimeframes();
  }

  function syncTimeframes() {
    const active = $("interval")?.value;

    document.querySelectorAll(
      "#clFixedTimeframes [data-tf]"
    ).forEach(button => {
      const selected =
        button.dataset.tf === active;

      button.classList.toggle("active", selected);
      button.setAttribute(
        "aria-pressed",
        String(selected)
      );
    });
  }

  function indicatorState(name) {
    const config = settings();
    const flags = config.indicators || {};

    const named = {
      ema21: ["EMA", "emaLines", 21],
      ma55: ["MA", "maLines", 55],
      ma100: ["MA", "maLines", 100],
      ma200: ["MA", "maLines", 200]
    };

    if (named[name]) {
      const [group, field, period] = named[name];

      const fallback = {
        ema21: true,
        ma55: true,
        ma100: false,
        ma200: false
      };

      const lines = config[field];

      if (!Array.isArray(lines)) {
        return flags[group] !== false &&
          fallback[name];
      }

      return flags[group] !== false &&
        lines.some(line =>
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

  function syncIndicators() {
    document.querySelectorAll(
      "#clFixedIndicators [data-cl-indicator]"
    ).forEach(button => {
      const active = indicatorState(
        button.dataset.clIndicator
      );

      button.classList.toggle("active", active);
      button.setAttribute(
        "aria-pressed",
        String(active)
      );
    });
  }

  function toggleIndicator(name) {
    if (syncing) return;

    const api = window.CryptolexuzIndicators;

    if (!api?.setIndicator) {
      console.warn(
        "El motor de indicadores todavía no está disponible."
      );
      return;
    }

    syncing = true;

    try {
      api.setIndicator(
        name,
        !indicatorState(name)
      );
    } finally {
      syncing = false;
    }

    syncIndicators();
  }

  function makeControls() {
    if ($("clFixedControls")) return;

    const area = $("priceChartArea");
    const chart = $("chart");

    const anchor = area || chart;

    if (!anchor?.parentElement) return;

    const stack = document.createElement("div");
    stack.id = "clFixedControls";
    stack.className = "cl-fixed-control-stack";

    const tf = createRow(
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

    for (const value of TIMEFRAMES) {
      const button = makeButton(value, {
        "data-cl-tf": value,
        "aria-pressed": "false"
      });

      button.addEventListener("click", () => {
        changeTimeframe(value);
      });

      tf.row.appendChild(button);
    }

    for (const [name, label] of INDICATORS) {
      const button = makeButton(label, {
        "data-cl-indicator": name,
        "aria-pressed": "false"
      });

      button.addEventListener("click", () => {
        toggleIndicator(name);
      });

      indicators.row.appendChild(button);
    }

    for (const [name, label] of PATTERNS) {
      const button = makeButton(label, {
        "data-cl-pattern": name,
        title:
          "Detección pendiente de integración"
      });

      button.disabled = true;

      patterns.row.appendChild(button);
    }

    stack.append(
      tf.wrapper,
      indicators.wrapper,
      patterns.wrapper
    );

    anchor.parentElement.insertBefore(
      stack,
      anchor
    );

    syncTimeframes();
    syncIndicators();
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
          vertLines: { color: "#101010" },
          horzLines: { color: "#101010" }
        }
      });
    } catch (error) {
      console.warn("Fondo:", error);
    }
  }

  function syncVolumeProfile() {
    const module =
      window.CryptolexuzVolumeProfile ||
      window.CRYPTOLEXUZ_VOLUME_PROFILE;

    if (!module) return;

    const buttons = document.querySelectorAll(
      '[data-indicator="vp"],' +
      '[data-indicator="volume-profile"]'
    );

    buttons.forEach(button => {
      if (button.dataset.clVpBound === "1") {
        return;
      }

      button.dataset.clVpBound = "1";

      button.addEventListener("click", () => {
        try {
          if (typeof module.toggle === "function") {
            module.toggle();
          } else {
            console.warn(
              "Volume Profile no expone toggle()."
            );
          }
        } catch (error) {
          console.warn("Volume Profile:", error);
        }
      });
    });
  }

  function init() {
    if (ready) return;
    ready = true;

    styles();
    makeControls();
    blackCharts();
    syncVolumeProfile();

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
        syncVolumeProfile();
      }
    );

    window.addEventListener(
      "cryptolexuz:volume-profile-ready",
      syncVolumeProfile
    );

    window.addEventListener(
      "cryptolexuz:screen-change",
      () => {
        syncTimeframes();
        syncIndicators();
        blackCharts();
      }
    );

    window.CryptolexuzControlsFix = {
      changeTimeframe,
      toggleIndicator,
      syncTimeframes,
      syncIndicators,
      blackCharts
    };
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
