
/*
 CRYPTOLEXUZ PRO
 VOLUME PROFILE AUTOMATICO V1

 Perfil aproximado por precio.
 Se calcula usando velas OHLCV.
 No representa volumen tick por tick.
*/
(() => {
  "use strict";

  const KEY = "cl-volume-profile-v1";

  const defaults = {
    enabled: true,
    side: "left",
    width: 66,
    poc: true
  };

  let settings = { ...defaults };
  let chart = null;
  let candleSeries = null;
  let allCandles = [];
  let canvas = null;
  let host = null;
  let status = null;
  let scheduled = false;

  try {
    const saved = JSON.parse(
      localStorage.getItem(KEY) || "{}"
    );

    settings = {
      ...defaults,
      ...saved
    };
  } catch (_) {}

  function save() {
    try {
      localStorage.setItem(
        KEY,
        JSON.stringify(settings)
      );
    } catch (_) {}

    if (window.CryptolexuzPreferences) {
      window.CryptolexuzPreferences.saveTool(
        "volumeProfile",
        settings
      );
    }
  }

  function createUI() {
    if (document.getElementById("clVpControls")) {
      return;
    }

    const chartSection =
      document.getElementById("chartSection");

    const chartArea =
      document.getElementById("priceChartArea");

    if (!chartSection || !chartArea) return;

    const panel = document.createElement("details");
    panel.id = "clVpControls";
    panel.open = false;

    panel.style.cssText = [
      "margin:10px 0",
      "border:1px solid #39466d",
      "border-radius:10px",
      "background:#10182f",
      "padding:10px"
    ].join(";");

    panel.innerHTML = `
      <summary style="
        color:#d7c5ff;
        font-weight:700;
        cursor:pointer;
      ">
        📊 Volume Profile automático
      </summary>

      <div style="
        display:grid;
        gap:12px;
        padding-top:14px;
        font-size:13px;
      ">

        <label style="
          display:flex;
          justify-content:space-between;
          align-items:center;
        ">
          <span>Mostrar perfil</span>
          <input
            id="clVpEnabled"
            type="checkbox"
          >
        </label>

        <label>
          Posición
          <select id="clVpSide" style="
            display:block;
            width:100%;
            margin-top:6px;
            padding:10px;
            color:#fff;
            background:#182341;
            border:1px solid #52618b;
            border-radius:8px;
          ">
            <option value="left">
              Izquierda →
            </option>
            <option value="right">
              ← Derecha
            </option>
          </select>
        </label>

        <label>
          Ancho del perfil
          <input
            id="clVpWidth"
            type="range"
            min="38"
            max="110"
            step="2"
            style="display:block;width:100%"
          >
        </label>

        <label style="
          display:flex;
          justify-content:space-between;
          align-items:center;
        ">
          <span>Mostrar POC</span>
          <input
            id="clVpPoc"
            type="checkbox"
          >
        </label>

        <small id="clVpStatus" style="
          color:#aebcdd;
          line-height:1.5;
        ">
          Esperando datos del gráfico...
        </small>

      </div>
    `;

    chartArea.parentNode.insertBefore(
      panel,
      chartArea
    );

    status = document.getElementById(
      "clVpStatus"
    );

    const enabled = document.getElementById(
      "clVpEnabled"
    );

    const side = document.getElementById(
      "clVpSide"
    );

    const width = document.getElementById(
      "clVpWidth"
    );

    const poc = document.getElementById(
      "clVpPoc"
    );

    enabled.checked = settings.enabled;
    side.value = settings.side;
    width.value = settings.width;
    poc.checked = settings.poc;

    enabled.addEventListener("change", () => {
      settings.enabled = enabled.checked;
      save();
      applyLayout();
    });

    side.addEventListener("change", () => {
      settings.side = side.value;
      save();
      applyLayout();
    });

    width.addEventListener("input", () => {
      settings.width = Number(width.value);
      save();
      applyLayout();
    });

    poc.addEventListener("change", () => {
      settings.poc = poc.checked;
      save();
      scheduleDraw();
    });

    host = document.createElement("div");
    host.id = "clVpHost";

    host.style.cssText = [
      "position:absolute",
      "top:0",
      "bottom:0",
      "width:66px",
      "pointer-events:none",
      "z-index:4",
      "background:rgba(13,22,42,.96)",
      "overflow:hidden"
    ].join(";");

    canvas = document.createElement("canvas");
    canvas.id = "clVpCanvas";

    canvas.style.cssText = [
      "display:block",
      "width:100%",
      "height:100%"
    ].join(";");

    host.appendChild(canvas);
    chartArea.appendChild(host);

    applyLayout();
  }

  function applyLayout() {
    const area = document.getElementById(
      "priceChartArea"
    );

    const chartElement =
      document.getElementById("chart");

    if (!area || !chartElement || !host) {
      return;
    }

    const gap = settings.enabled
      ? settings.width + 5
      : 0;

    area.style.position = "relative";

    area.style.paddingLeft =
      settings.side === "left"
        ? gap + "px"
        : "0px";

    area.style.paddingRight =
      settings.side === "right"
        ? gap + "px"
        : "0px";

    chartElement.style.width = "100%";

    host.style.display =
      settings.enabled ? "block" : "none";

    host.style.width =
      settings.width + "px";

    host.style.left =
      settings.side === "left"
        ? "0"
        : "auto";

    host.style.right =
      settings.side === "right"
        ? "0"
        : "auto";

    requestAnimationFrame(() => {
      resizeChart();
      scheduleDraw();
    });
  }

  function resizeChart() {
    if (!chart) return;

    const element = document.getElementById(
      "chart"
    );

    if (!element) return;

    const width = element.clientWidth;
    const height = element.clientHeight;

    if (width < 30 || height < 30) return;

    try {
      chart.resize(width, height);
    } catch (_) {}

    window.dispatchEvent(
      new Event("resize")
    );
  }

  function normalizeCandles(data) {
    if (!Array.isArray(data)) return [];

    return data.filter(item =>
      item &&
      Number.isFinite(Number(item.high)) &&
      Number.isFinite(Number(item.low)) &&
      Number.isFinite(Number(item.volume))
    ).map(item => ({
      time: item.time,
      open: Number(item.open),
      high: Number(item.high),
      low: Number(item.low),
      close: Number(item.close),
      volume: Math.max(0, Number(item.volume))
    }));
  }

  function captureSeries(series) {
    if (!series || series.__clVpWrapped) {
      return;
    }

    series.__clVpWrapped = true;

    const originalSetData =
      series.setData.bind(series);

    const originalUpdate =
      series.update.bind(series);

    series.setData = function(data) {
      const result = originalSetData(data);

      allCandles = normalizeCandles(data);
      scheduleDraw();

      return result;
    };

    series.update = function(bar) {
      const result = originalUpdate(bar);

      const item = normalizeCandles([bar])[0];

      if (item) {
        const last = allCandles.length - 1;

        if (
          last >= 0 &&
          allCandles[last].time === item.time
        ) {
          allCandles[last] = item;
        } else {
          allCandles.push(item);
        }

        scheduleDraw();
      }

      return result;
    };

    try {
      if (typeof series.data === "function") {
        allCandles = normalizeCandles(
          series.data()
        );
      }
    } catch (_) {}

    scheduleDraw();
  }

  function getVisibleCandles() {
    if (!chart || !allCandles.length) {
      return [];
    }

    try {
      const range = chart
        .timeScale()
        .getVisibleLogicalRange();

      if (range) {
        const start = Math.max(
          0,
          Math.floor(range.from)
        );

        const end = Math.min(
          allCandles.length,
          Math.ceil(range.to) + 1
        );

        if (end > start) {
          return allCandles.slice(start, end);
        }
      }
    } catch (_) {}

    return allCandles.slice(-100);
  }

  function calculateProfile(candles, count = 90) {
    if (!candles.length) return null;

    const min = Math.min(
      ...candles.map(c => c.low)
    );

    const max = Math.max(
      ...candles.map(c => c.high)
    );

    const span = max - min;

    if (!(span > 0)) return null;

    const bins = new Float64Array(count);
    const step = span / count;

    /*
      Aproximacion:
      se distribuye el volumen de cada vela
      uniformemente entre su minimo y maximo.
    */

    for (const candle of candles) {
      if (!(candle.volume > 0)) continue;

      const first = Math.max(
        0,
        Math.floor((candle.low - min) / step)
      );

      const last = Math.min(
        count - 1,
        Math.floor(
          (candle.high - min) / step
        )
      );

      const slots = Math.max(
        1,
        last - first + 1
      );

      const contribution =
        candle.volume / slots;

      for (let i = first; i <= last; i++) {
        bins[i] += contribution;
      }
    }

    let pocIndex = 0;

    for (let i = 1; i < count; i++) {
      if (bins[i] > bins[pocIndex]) {
        pocIndex = i;
      }
    }

    return {
      min,
      max,
      bins,
      step,
      pocPrice:
        min + (pocIndex + 0.5) * step,
      maxVolume: Math.max(...bins)
    };
  }

  function scheduleDraw() {
    if (scheduled) return;

    scheduled = true;

    requestAnimationFrame(() => {
      scheduled = false;
      draw();
    });
  }

  function draw() {
    if (
      !canvas ||
      !host ||
      !settings.enabled
    ) return;

    const width = host.clientWidth;
    const height = host.clientHeight;

    if (width < 5 || height < 5) return;

    const dpr = Math.min(
      window.devicePixelRatio || 1,
      3
    );

    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);

    const ctx = canvas.getContext("2d");

    if (!ctx) return;

    ctx.setTransform(
      dpr, 0, 0, dpr, 0, 0
    );

    ctx.clearRect(0, 0, width, height);

    const visible = getVisibleCandles();

    const profile = calculateProfile(
      visible
    );

    if (!profile) {
      if (status) {
        status.textContent =
          "Esperando velas con volumen...";
      }
      return;
    }

    const {
      min,
      max,
      bins,
      step,
      pocPrice,
      maxVolume
    } = profile;

    if (!(maxVolume > 0)) return;

    const priceToY = price => {
      if (
        candleSeries &&
        typeof candleSeries.priceToCoordinate
          === "function"
      ) {
        try {
          const y =
            candleSeries.priceToCoordinate(price);

          if (Number.isFinite(y)) {
            return y;
          }
        } catch (_) {}
      }

      return (
        height -
        ((price - min) / (max - min)) * height
      );
    };

    const right = settings.side === "right";

    const usableWidth = Math.max(
      5,
      width - 4
    );

    for (let i = 0; i < bins.length; i++) {
      const price = min + (i + 0.5) * step;

      const y = priceToY(price);
      const yNext = priceToY(price + step);

      if (!Number.isFinite(y)) continue;

      const barHeight = Math.max(
        1,
        Math.min(
          3,
          Math.abs(yNext - y) * 0.8
        )
      );

      const barWidth = Math.max(
        0.5,
        bins[i] / maxVolume * usableWidth
      );

      const x = right
        ? width - barWidth - 2
        : 2;

      ctx.fillStyle = "#4c9bd4";
      ctx.globalAlpha = 0.87;

      ctx.fillRect(
        x,
        y - barHeight / 2,
        barWidth,
        barHeight
      );
    }

    ctx.globalAlpha = 1;

    if (settings.poc) {
      const pocY = priceToY(pocPrice);

      if (Number.isFinite(pocY)) {
        ctx.strokeStyle = "#ff687a";
        ctx.lineWidth = 1.4;

        ctx.beginPath();
        ctx.moveTo(0, pocY);
        ctx.lineTo(width, pocY);
        ctx.stroke();
      }
    }

    if (status) {
      status.textContent =
        "Perfil aproximado de " +
        visible.length +
        " velas visibles · POC: " +
        pocPrice.toFixed(
          pocPrice < 10 ? 4 : 2
        );
    }
  }

  function connect(event) {
    const detail = event?.detail || {};

    const nextChart = detail.chart;
    const nextSeries = detail.candle;

    if (!nextChart || !nextSeries) return;

    chart = nextChart;
    candleSeries = nextSeries;

    createUI();
    captureSeries(nextSeries);

    try {
      chart.timeScale()
        .subscribeVisibleLogicalRangeChange(
          scheduleDraw
        );
    } catch (error) {
      console.warn(
        "Volume Profile: rango visible",
        error
      );
    }

    setTimeout(() => {
      applyLayout();
      scheduleDraw();
    }, 500);
  }

  window.addEventListener(
    "cryptolexuz:chart-ready",
    connect
  );

  window.addEventListener(
    "cryptolexuz:screen-change",
    event => {
      if (event.detail?.screen === "charts") {
        setTimeout(() => {
          applyLayout();
          scheduleDraw();
        }, 150);
      }
    }
  );

  window.addEventListener(
    "resize",
    scheduleDraw
  );

  window.CryptolexuzVolumeProfile = {
    redraw: scheduleDraw,
    getSettings: () => ({ ...settings }),
    getProfile: () =>
      calculateProfile(getVisibleCandles())
  };

  if (document.readyState === "loading") {
    document.addEventListener(
      "DOMContentLoaded",
      createUI
    );
  } else {
    createUI();
  }
})();
