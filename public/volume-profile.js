
/*
 CRYPTOLEXUZ PRO — VOLUME PROFILE V2
 Compatible con app.js V15 y Lightweight Charts 4.2.2.
 Perfil estimado con velas OHLCV de BingX.
 No es un perfil tick-by-tick.
*/
"use strict";

(() => {
  const KEY = "cryptolexuz.volumeProfile.v2";

  const DEFAULTS = {
    enabled: true,
    side: "right",
    width: 116,
    bins: 110,
    poc: true
  };

  const settings = { ...DEFAULTS };

  try {
    Object.assign(
      settings,
      JSON.parse(localStorage.getItem(KEY) || "{}")
    );
  } catch (_) {}

  settings.width = Math.max(
    70,
    Math.min(220, Number(settings.width) || 116)
  );

  settings.bins = Math.max(
    40,
    Math.min(200, Number(settings.bins) || 110)
  );

  settings.side =
    settings.side === "left" ? "left" : "right";

  let chart = null;
  let candle = null;
  let data = [];
  let host = null;
  let canvas = null;
  let controls = null;
  let raf = 0;
  let lastChartWidth = 0;
  let patchedSeries = null;
  let initialized = false;

  const $ = id => document.getElementById(id);

  function save() {
    try {
      localStorage.setItem(
        KEY,
        JSON.stringify(settings)
      );

      window.CryptolexuzPreferences
        ?.saveTool?.(
          "volumeProfile",
          { ...settings }
        );
    } catch (_) {}
  }

  function normalize(items) {
    if (!Array.isArray(items)) return [];

    return items
      .map(x => ({
        time: x.time,
        open: Number(x.open),
        high: Number(x.high),
        low: Number(x.low),
        close: Number(x.close),
        volume: Number(x.volume ?? 0)
      }))
      .filter(x =>
        x.time != null &&
        [
          x.open,
          x.high,
          x.low,
          x.close,
          x.volume
        ].every(Number.isFinite) &&
        x.high >= x.low &&
        x.volume >= 0
      );
  }

  function emit() {
    window.dispatchEvent(
      new CustomEvent(
        "cryptolexuz:volume-profile-update",
        {
          detail: {
            settings: { ...settings },
            count: data.length
          }
        }
      )
    );
  }

  function ensureUI() {
    const area = $("priceChartArea");

    if (!area) return false;

    if (!controls) {
      controls = document.createElement("details");

      controls.id = "clVpControls";
      controls.className = "cl-tool-panel";

      controls.innerHTML = `
        <summary>
          📊 Volume Profile · BingX
        </summary>

        <div
          class="cl-tool-content"
          style="
            display:flex;
            flex-wrap:wrap;
            gap:10px;
            align-items:end;
            padding:12px;
          "
        >
          <label style="display:flex;gap:6px;align-items:center">
            <input id="clVpEnabled" type="checkbox">
            Mostrar perfil
          </label>

          <label style="display:grid;gap:5px">
            Posición
            <select id="clVpSide">
              <option value="right">Derecha</option>
              <option value="left">Izquierda</option>
            </select>
          </label>

          <label style="display:grid;gap:5px">
            Anchura
            <select id="clVpWidth">
              <option value="85">Estrecho</option>
              <option value="116">Normal</option>
              <option value="160">Ancho</option>
              <option value="200">Muy ancho</option>
            </select>
          </label>

          <label style="display:grid;gap:5px">
            Detalle
            <select id="clVpBins">
              <option value="60">60 niveles</option>
              <option value="90">90 niveles</option>
              <option value="110">110 niveles</option>
              <option value="150">150 niveles</option>
              <option value="200">200 niveles</option>
            </select>
          </label>

          <label style="display:flex;gap:6px;align-items:center">
            <input id="clVpPoc" type="checkbox">
            Mostrar POC
          </label>

          <small
            id="clVpStatus"
            style="width:100%;color:#a5b0cf"
          >
            Perfil aproximado de volumen
            de velas OHLCV de BingX.
          </small>
        </div>
      `;

      area.parentNode.insertBefore(
        controls,
        area
      );

      const width = $("clVpWidth");

      if (
        ![...width.options].some(
          x => Number(x.value) === settings.width
        )
      ) {
        const option =
          document.createElement("option");

        option.value = String(settings.width);
        option.textContent =
          settings.width + " px";

        width.add(option);
      }

      const bins = $("clVpBins");

      if (
        ![...bins.options].some(
          x => Number(x.value) === settings.bins
        )
      ) {
        const option =
          document.createElement("option");

        option.value = String(settings.bins);
        option.textContent =
          settings.bins + " niveles";

        bins.add(option);
      }

      $("clVpEnabled").checked =
        !!settings.enabled;

      $("clVpSide").value = settings.side;

      width.value = String(settings.width);
      bins.value = String(settings.bins);

      $("clVpPoc").checked =
        !!settings.poc;

      const fields = [
        [
          "clVpEnabled",
          "enabled",
          x => x.checked
        ],
        [
          "clVpSide",
          "side",
          x => x.value
        ],
        [
          "clVpWidth",
          "width",
          x => Number(x.value)
        ],
        [
          "clVpBins",
          "bins",
          x => Number(x.value)
        ],
        [
          "clVpPoc",
          "poc",
          x => x.checked
        ]
      ];

      for (const [id, key, transform] of fields) {
        $(id).addEventListener(
          "change",
          event => {
            settings[key] =
              transform(event.target);

            save();
            layout();
            emit();
          }
        );
      }
    }

    if (!host) {
      host = document.createElement("div");

      host.id = "clVpHost";

      host.style.cssText = [
        "position:absolute",
        "top:0",
        "bottom:0",
        "z-index:3",
        "pointer-events:none",
        "background:#0b1429",
        "overflow:hidden"
      ].join(";");

      canvas = document.createElement("canvas");

      canvas.style.cssText = [
        "display:block",
        "width:100%",
        "height:100%"
      ].join(";");

      host.appendChild(canvas);
      area.appendChild(host);
    }

    if (!initialized) {
      initialized = true;

      window.addEventListener(
        "resize",
        schedule
      );

      window.addEventListener(
        "cryptolexuz:screen-change",
        () => {
          setTimeout(() => {
            layout();
            schedule();
          }, 120);
        }
      );

      if (window.ResizeObserver) {
        new ResizeObserver(
          schedule
        ).observe(area);
      }
    }

    return true;
  }

  function layout() {
    if (!ensureUI()) return;

    const area = $("priceChartArea");

    const w = settings.enabled
      ? settings.width
      : 0;

    area.style.boxSizing = "border-box";

    area.style.paddingLeft =
      settings.enabled &&
      settings.side === "left"
        ? w + "px"
        : "0px";

    area.style.paddingRight =
      settings.enabled &&
      settings.side === "right"
        ? w + "px"
        : "0px";

    host.style.display =
      settings.enabled ? "block" : "none";

    host.style.width = w + "px";

    host.style.left =
      settings.side === "left"
        ? "0"
        : "auto";

    host.style.right =
      settings.side === "right"
        ? "0"
        : "auto";

    const el = $("chart");

    if (
      chart &&
      el &&
      el.clientWidth > 0 &&
      el.clientHeight > 0
    ) {
      const newWidth = el.clientWidth;

      if (newWidth !== lastChartWidth) {
        lastChartWidth = newWidth;

        chart.resize(
          newWidth,
          el.clientHeight
        );
      }
    }

    schedule();
  }

  function attach(c, s) {
    if (!c || !s) return;

    chart = c;
    candle = s;

    if (patchedSeries !== s) {
      patchedSeries = s;

      const originalSet =
        s.setData.bind(s);

      const originalUpdate =
        s.update.bind(s);

      s.setData = function(items) {
        const result = originalSet(items);

        data = normalize(items);
        schedule();

        return result;
      };

      s.update = function(item) {
        const result = originalUpdate(item);

        const x = normalize([item])[0];

        if (x) {
          const last = data.at(-1);

          if (
            last &&
            last.time === x.time
          ) {
            data[data.length - 1] = x;
          } else if (
            !last ||
            x.time > last.time
          ) {
            data.push(x);
          }

          if (data.length > 1000) {
            data = data.slice(-1000);
          }
        }

        schedule();

        return result;
      };
    }

    ensureUI();

    try {
      chart.timeScale()
        .subscribeVisibleLogicalRangeChange(
          schedule
        );
    } catch (error) {
      console.warn(
        "Volume Profile: rango",
        error
      );
    }

    layout();
  }

  function schedule() {
    if (raf) return;

    raf = requestAnimationFrame(() => {
      raf = 0;
      draw();
    });
  }

  function draw() {
    if (
      !settings.enabled ||
      !host ||
      !canvas ||
      !chart ||
      !candle
    ) return;

    const width = host.clientWidth;
    const height = host.clientHeight;

    if (width < 10 || height < 10) return;

    const dpr = Math.min(
      devicePixelRatio || 1,
      2
    );

    const pxw = Math.round(width * dpr);
    const pxh = Math.round(height * dpr);

    if (canvas.width !== pxw) {
      canvas.width = pxw;
    }

    if (canvas.height !== pxh) {
      canvas.height = pxh;
    }

    const ctx = canvas.getContext("2d");

    if (!ctx) return;

    ctx.setTransform(
      dpr, 0, 0, dpr, 0, 0
    );

    ctx.clearRect(
      0, 0, width, height
    );

    const range = chart.timeScale()
      .getVisibleLogicalRange();

    if (!range || !data.length) {
      status(
        "Esperando velas de BingX con volumen..."
      );
      return;
    }

    const start = Math.max(
      0,
      Math.floor(range.from)
    );

    const end = Math.min(
      data.length - 1,
      Math.ceil(range.to)
    );

    const visible = data
      .slice(start, end + 1)
      .filter(x => x.volume > 0);

    if (!visible.length) {
      status(
        "Sin volumen en el rango visible. Esperando datos REST..."
      );
      return;
    }

    const lo = Math.min(
      ...visible.map(x => x.low)
    );

    const hi = Math.max(
      ...visible.map(x => x.high)
    );

    const spread = hi - lo;

    if (!(spread > 0)) return;

    const bins = settings.bins;
    const step = spread / bins;

    const totals =
      new Float64Array(bins);

    for (const x of visible) {
      /*
       Estimación:
       distribuye uniformemente el volumen
       de cada vela entre sus niveles
       mínimo y máximo.
      */

      const bottom = Math.max(
        0,
        Math.min(
          bins - 1,
          Math.floor((x.low - lo) / step)
        )
      );

      const top = Math.max(
        0,
        Math.min(
          bins - 1,
          Math.floor((x.high - lo) / step)
        )
      );

      const count = top - bottom + 1;
      const portion = x.volume / count;

      for (let i = bottom; i <= top; i++) {
        totals[i] += portion;
      }
    }

    let max = 0;
    let pocIndex = 0;

    for (let i = 0; i < bins; i++) {
      if (totals[i] > max) {
        max = totals[i];
        pocIndex = i;
      }
    }

    if (!max) return;

    ctx.fillStyle = "#0b1429";

    ctx.fillRect(
      0, 0, width, height
    );

    const margin = 7;

    const barWidth =
      width - margin * 2;

    const left =
      settings.side === "left";

    for (let i = 0; i < bins; i++) {
      if (!totals[i]) continue;

      const p0 = lo + i * step;
      const p1 = p0 + step;

      const y0 =
        candle.priceToCoordinate(p0);

      const y1 =
        candle.priceToCoordinate(p1);

      if (
        !Number.isFinite(y0) ||
        !Number.isFinite(y1)
      ) continue;

      const y = Math.min(y0, y1);

      const h = Math.max(
        1,
        Math.abs(y1 - y0) - 0.4
      );

      if (
        y > height ||
        y + h < 0
      ) continue;

      const length = Math.max(
        1,
        (totals[i] / max) * barWidth
      );

      const x = left
        ? width - margin - length
        : margin;

      ctx.fillStyle =
        i === pocIndex
          ? "rgba(73,206,255,.98)"
          : "rgba(49,133,255,.78)";

      ctx.fillRect(
        x,
        y,
        length,
        h
      );
    }

    if (settings.poc) {
      const price =
        lo + (pocIndex + 0.5) * step;

      const y =
        candle.priceToCoordinate(price);

      if (
        Number.isFinite(y) &&
        y >= 0 &&
        y <= height
      ) {
        ctx.strokeStyle = "#ff5375";
        ctx.lineWidth = 1.5;

        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();

        ctx.fillStyle = "#ff8ba3";
        ctx.font = "bold 10px system-ui";

        ctx.textAlign = left
          ? "right"
          : "left";

        ctx.fillText(
          "POC",
          left ? width - 5 : 5,
          Math.max(11, y - 4)
        );
      }
    }

    status(
      visible.length +
      " velas visibles · " +
      bins +
      " niveles · POC estimado"
    );
  }

  function status(text) {
    const el = $("clVpStatus");

    if (
      el &&
      el.textContent !== text
    ) {
      el.textContent = text;
    }
  }

  window.CryptolexuzVolumeProfile = {
    attach,
    redraw: schedule,
    layout,

    getSettings: () => ({
      ...settings
    }),

    getData: () =>
      data.slice(),

    setData: items => {
      data = normalize(items);
      schedule();
    }
  };

  window.addEventListener(
    "cryptolexuz:chart-ready",
    event => {
      attach(
        event.detail?.chart,
        event.detail?.candle
      );
    }
  );

  if (
    document.readyState === "loading"
  ) {
    document.addEventListener(
      "DOMContentLoaded",
      ensureUI
    );
  } else {
    ensureUI();
  }
})();
