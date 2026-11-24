
/*
 CRYPTOLEXUZ PRO — VOLUME PROFILE V5

 - Compatible con Lightweight Charts 4.2.2
 - Controles debajo de la gráfica de velas
 - Perfil superpuesto a izquierda o derecha
 - POC, VAH y VAL
 - Perfil estimado con velas OHLCV
 - Opacidad ajustable
 - Compatible con APP.JS V19
 - Sin ejecución de operaciones
*/
"use strict";

(() => {
  if (window.__clVolumeProfileV5) return;
  window.__clVolumeProfileV5 = true;

  const $ = id => document.getElementById(id);

  const KEY = "cryptolexuz.volumeProfile.v5";
  const OLD_KEYS = [
    "cryptolexuz.volumeProfile.v4",
    "cryptolexuz.volumeProfile.v2"
  ];

  const defaults = {
    enabled: true,
    side: "right",
    width: 90,
    bins: 60,
    poc: true,
    valueArea: true,
    opacity: 0.32
  };

  const settings = { ...defaults };

  try {
    let saved = null;

    for (const key of [KEY, ...OLD_KEYS]) {
      const raw = localStorage.getItem(key);
      if (raw) {
        saved = JSON.parse(raw);
        break;
      }
    }

    if (saved && typeof saved === "object") {
      Object.assign(settings, saved);
    }
  } catch (error) {
    console.warn("Volume Profile ajustes:", error);
  }

  settings.side =
    settings.side === "left" ? "left" : "right";

  settings.width = Math.max(
    60,
    Math.min(180, Number(settings.width) || 90)
  );

  settings.bins = Math.max(
    30,
    Math.min(150, Number(settings.bins) || 60)
  );

  settings.opacity = Math.max(
    0.1,
    Math.min(0.85, Number(settings.opacity) || 0.32)
  );

  let chart = null;
  let candle = null;
  let data = [];
  let canvas = null;
  let controls = null;
  let raf = 0;
  let attachedSeries = null;
  let initialized = false;
  let resizeObserver = null;
  let subscribedChart = null;

  const colors = {
    green: "#00f5a0",
    red: "#ff476c",
    poc: "#ffe15a",
    vah: "#bb52ff",
    val: "#36c5ff"
  };

  function save() {
    try {
      localStorage.setItem(
        KEY,
        JSON.stringify(settings)
      );
    } catch (error) {
      console.warn("Guardar Volume Profile:", error);
    }

    window.dispatchEvent(
      new CustomEvent(
        "cryptolexuz:volume-profile-update",
        {
          detail: {
            settings: { ...settings }
          }
        }
      )
    );
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

  function status(message) {
    const element = $("clVpStatus");

    if (
      element &&
      element.textContent !== message
    ) {
      element.textContent = message;
    }
  }

  function ensureUI() {
    const area = $("priceChartArea");
    if (!area || !area.parentNode) return false;

    if (!controls) {
      controls = document.createElement("details");
      controls.id = "clVpControls";
      controls.className = "cl-tool-panel";

      controls.innerHTML = `
        <summary>
          📊 Volume Profile · Configuración
        </summary>

        <div class="cl-tool-content"
          style="
            display:flex;
            flex-wrap:wrap;
            gap:12px;
            padding:12px;
            align-items:end;
          ">

          <label style="
            display:flex;
            gap:7px;
            align-items:center;
          ">
            <input
              id="clVpEnabled"
              type="checkbox"
            >
            Mostrar perfil
          </label>

          <label style="
            display:grid;
            gap:5px;
          ">
            Posición
            <select id="clVpSide">
              <option value="right">
                Derecha
              </option>
              <option value="left">
                Izquierda
              </option>
            </select>
          </label>

          <label style="
            display:grid;
            gap:5px;
          ">
            Anchura
            <select id="clVpWidth">
              <option value="70">
                Estrecho
              </option>
              <option value="90">
                Compacto
              </option>
              <option value="110">
                Normal
              </option>
              <option value="145">
                Ancho
              </option>
              <option value="180">
                Muy ancho
              </option>
            </select>
          </label>

          <label style="
            display:grid;
            gap:5px;
          ">
            Detalle
            <select id="clVpBins">
              <option value="40">
                40 niveles
              </option>
              <option value="60">
                60 niveles
              </option>
              <option value="90">
                90 niveles
              </option>
              <option value="120">
                120 niveles
              </option>
            </select>
          </label>

          <label style="
            display:flex;
            gap:7px;
            align-items:center;
          ">
            <input
              id="clVpPoc"
              type="checkbox"
            >
            Línea POC
          </label>

          <label style="
            display:flex;
            gap:7px;
            align-items:center;
          ">
            <input
              id="clVpValueArea"
              type="checkbox"
            >
            Líneas VAH / VAL
          </label>

          <label style="
            display:grid;
            gap:5px;
            width:100%;
          ">
            Transparencia del perfil
            <input
              id="clVpOpacity"
              type="range"
              min="10"
              max="85"
              step="5"
            >
          </label>

          <small
            id="clVpStatus"
            style="
              width:100%;
              color:#aebcdd;
            "
          >
            Esperando velas...
          </small>

          <small style="
            width:100%;
            color:#8493b2;
            line-height:1.5;
          ">
            Perfil estimado mediante OHLCV.
            No representa volumen real
            de compras y ventas por precio.
          </small>
        </div>
      `;

      /*
       CORRECCIÓN PRINCIPAL V5:
       Los controles quedan DESPUÉS
       de la gráfica, no encima.
      */
      area.insertAdjacentElement(
        "afterend",
        controls
      );

      for (const [id, value] of [
        ["clVpWidth", settings.width],
        ["clVpBins", settings.bins]
      ]) {
        const select = $(id);

        if (
          select &&
          !Array.from(select.options).some(
            option =>
              Number(option.value) === value
          )
        ) {
          const option =
            document.createElement("option");

          option.value = String(value);
          option.textContent = String(value);

          select.add(option);
        }
      }

      $("clVpEnabled").checked =
        Boolean(settings.enabled);

      $("clVpSide").value =
        settings.side;

      $("clVpWidth").value =
        String(settings.width);

      $("clVpBins").value =
        String(settings.bins);

      $("clVpPoc").checked =
        Boolean(settings.poc);

      $("clVpValueArea").checked =
        Boolean(settings.valueArea);

      $("clVpOpacity").value =
        String(Math.round(settings.opacity * 100));

      const bindings = [
        [
          "clVpEnabled",
          "enabled",
          event => event.target.checked
        ],
        [
          "clVpSide",
          "side",
          event => event.target.value
        ],
        [
          "clVpWidth",
          "width",
          event => Number(event.target.value)
        ],
        [
          "clVpBins",
          "bins",
          event => Number(event.target.value)
        ],
        [
          "clVpPoc",
          "poc",
          event => event.target.checked
        ],
        [
          "clVpValueArea",
          "valueArea",
          event => event.target.checked
        ],
        [
          "clVpOpacity",
          "opacity",
          event =>
            Number(event.target.value) / 100
        ]
      ];

      bindings.forEach(
        ([id, key, transform]) => {
          const input = $(id);

          input?.addEventListener(
            key === "opacity"
              ? "input"
              : "change",
            event => {
              settings[key] = transform(event);
              save();
              schedule();
            }
          );
        }
      );
    }

    if (!canvas) {
      canvas = document.createElement("canvas");
      canvas.id = "clVpCanvas";

      canvas.style.cssText = `
        position:absolute;
        inset:0;
        width:100%;
        height:100%;
        z-index:3;
        pointer-events:none;
      `;

      area.appendChild(canvas);
    }

    if (!initialized) {
      initialized = true;

      window.addEventListener(
        "resize",
        schedule
      );

      window.addEventListener(
        "cryptolexuz:screen-change",
        () => setTimeout(schedule, 180)
      );

      if (window.ResizeObserver) {
        resizeObserver =
          new ResizeObserver(schedule);

        resizeObserver.observe(area);
      }
    }

    return true;
  }

  function attach(c, s) {
    if (!c || !s) return;

    chart = c;
    candle = s;

    if (attachedSeries !== s) {
      attachedSeries = s;

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

        const next = normalize([item])[0];

        if (next) {
          const last = data[data.length - 1];

          if (
            last &&
            last.time === next.time
          ) {
            data[data.length - 1] = next;
          } else if (
            !last ||
            next.time > last.time
          ) {
            data.push(next);
          }

          if (data.length > 1200) {
            data = data.slice(-1200);
          }
        }

        schedule();
        return result;
      };
    }

    ensureUI();

    if (subscribedChart !== c) {
      subscribedChart = c;

      try {
        chart.timeScale()
          .subscribeVisibleLogicalRangeChange(
            schedule
          );
      } catch (error) {
        console.warn(
          "Volume Profile rango:",
          error
        );
      }
    }

    schedule();
  }

  function schedule() {
    if (raf) return;

    raf = requestAnimationFrame(() => {
      raf = 0;
      draw();
    });
  }

  function calculateProfile(rows) {
    if (rows.length < 2) return null;

    const lo = Math.min(
      ...rows.map(x => x.low)
    );

    const hi = Math.max(
      ...rows.map(x => x.high)
    );

    if (!(hi > lo)) return null;

    const count = settings.bins;
    const step = (hi - lo) / count;

    const buy = new Float64Array(count);
    const sell = new Float64Array(count);
    const totals = new Float64Array(count);

    for (const row of rows) {
      const start = Math.max(
        0,
        Math.floor(
          (row.low - lo) / step
        )
      );

      const end = Math.min(
        count - 1,
        Math.floor(
          (row.high - lo) / step
        )
      );

      const touched = Math.max(
        1,
        end - start + 1
      );

      const portion =
        row.volume / touched;

      const span = Math.max(
        row.high - row.low,
        1e-12
      );

      /*
       Distribución ESTIMADA.
       No es delta real.
      */
      const buyRatio = Math.max(
        0.1,
        Math.min(
          0.9,
          0.5 +
          (row.close - row.open) /
          (2 * span)
        )
      );

      for (
        let i = start;
        i <= end;
        i++
      ) {
        buy[i] +=
          portion * buyRatio;

        sell[i] +=
          portion * (1 - buyRatio);

        totals[i] += portion;
      }
    }

    let pocIndex = 0;

    for (
      let i = 1;
      i < count;
      i++
    ) {
      if (
        totals[i] >
        totals[pocIndex]
      ) {
        pocIndex = i;
      }
    }

    const totalVolume =
      totals.reduce(
        (sum, value) =>
          sum + value,
        0
      );

    if (totalVolume <= 0) {
      return null;
    }

    const target =
      totalVolume * 0.70;

    let lower = pocIndex;
    let upper = pocIndex;
    let accumulated =
      totals[pocIndex];

    while (
      accumulated < target &&
      (
        lower > 0 ||
        upper < count - 1
      )
    ) {
      const below =
        lower > 0
          ? totals[lower - 1]
          : -1;

      const above =
        upper < count - 1
          ? totals[upper + 1]
          : -1;

      if (
        above >= below &&
        upper < count - 1
      ) {
        upper++;
        accumulated += totals[upper];
      } else if (lower > 0) {
        lower--;
        accumulated += totals[lower];
      } else {
        break;
      }
    }

    return {
      lo,
      hi,
      step,
      buy,
      sell,
      totals,
      poc:
        lo +
        (pocIndex + 0.5) *
        step,
      vah:
        lo +
        (upper + 1) *
        step,
      val:
        lo +
        lower * step,
      pocIndex,
      lower,
      upper,
      max: Math.max(...totals)
    };
  }

  function drawLine(
    ctx,
    y,
    label,
    color,
    width
  ) {
    if (!Number.isFinite(y)) {
      return;
    }

    const area =
      $("priceChartArea");

    if (!area) return;

    const height =
      area.clientHeight;

    if (y < 0 || y > height) {
      return;
    }

    ctx.save();

    ctx.strokeStyle = color;

    ctx.lineWidth =
      label === "POC"
        ? 1.8
        : 1;

    ctx.setLineDash(
      label === "POC"
        ? []
        : [5, 4]
    );

    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();

    ctx.setLineDash([]);
    ctx.fillStyle = color;
    ctx.font =
      "bold 10px system-ui";

    const right =
      settings.side === "right";

    ctx.textAlign =
      right ? "left" : "right";

    const x =
      right ? 6 : width - 6;

    ctx.fillText(
      label,
      x,
      Math.max(12, y - 5)
    );

    ctx.restore();
  }

  function draw() {
    if (
      !ensureUI() ||
      !canvas
    ) return;

    const area =
      $("priceChartArea");

    const width =
      area.clientWidth;

    const height =
      area.clientHeight;

    if (
      width < 30 ||
      height < 30
    ) return;

    const dpr = Math.min(
      window.devicePixelRatio || 1,
      2
    );

    const pixelWidth =
      Math.round(width * dpr);

    const pixelHeight =
      Math.round(height * dpr);

    if (
      canvas.width !== pixelWidth
    ) {
      canvas.width = pixelWidth;
    }

    if (
      canvas.height !== pixelHeight
    ) {
      canvas.height = pixelHeight;
    }

    const ctx =
      canvas.getContext("2d");

    if (!ctx) return;

    ctx.setTransform(
      dpr, 0, 0, dpr, 0, 0
    );

    ctx.clearRect(
      0, 0,
      width, height
    );

    if (!settings.enabled) {
      status(
        "Volume Profile oculto"
      );
      return;
    }

    if (
      !chart ||
      !candle ||
      data.length < 2
    ) {
      status(
        "Esperando datos del gráfico..."
      );
      return;
    }

    let visible = data;

    try {
      const range =
        chart.timeScale()
          .getVisibleLogicalRange();

      if (range) {
        const from = Math.max(
          0,
          Math.floor(range.from)
        );

        const to = Math.min(
          data.length - 1,
          Math.ceil(range.to)
        );

        if (to >= from) {
          visible =
            data.slice(from, to + 1);
        }
      }
    } catch (error) {
      console.warn(
        "Volume Profile visible:",
        error
      );
    }

    if (visible.length < 2) {
      status(
        "Se necesitan más velas visibles"
      );
      return;
    }

    const profile =
      calculateProfile(visible);

    if (!profile) {
      status(
        "Volumen insuficiente"
      );
      return;
    }

    const priceScaleWidth =
      chart.priceScale("right")
        ?.width?.() || 0;

    const plotWidth = Math.max(
      0,
      width - priceScaleWidth
    );

    const effectiveWidth =
      Math.max(
        30,
        Math.min(
          width,
          plotWidth
        )
      );

    const barWidth = Math.min(
      settings.width,
      Math.max(
        45,
        effectiveWidth * 0.32
      )
    );

    const right =
      settings.side === "right";

    const edge = right
      ? effectiveWidth - 3
      : 3;

    const maxLength =
      Math.max(
        10,
        barWidth - 8
      );

    const chartTop =
      $("chart")
        ?.getBoundingClientRect()
        .top || 0;

    const areaTop =
      area.getBoundingClientRect()
        .top;

    const offsetY =
      chartTop - areaTop;

    for (
      let i = 0;
      i < settings.bins;
      i++
    ) {
      if (
        profile.totals[i] <= 0
      ) continue;

      const p0 =
        profile.lo +
        i * profile.step;

      const p1 =
        p0 + profile.step;

      const c0 =
        candle.priceToCoordinate(p0);

      const c1 =
        candle.priceToCoordinate(p1);

      if (
        !Number.isFinite(c0) ||
        !Number.isFinite(c1)
      ) continue;

      const y =
        Math.min(c0, c1) +
        offsetY;

      const h = Math.max(
        1,
        Math.abs(c1 - c0) - 0.5
      );

      if (
        y > height ||
        y + h < 0
      ) continue;

      const ratio =
        profile.totals[i] /
        profile.max;

      const length = Math.max(
        1,
        ratio * maxLength
      );

      const x = right
        ? edge - length
        : edge;

      const buyRatio =
        profile.buy[i] /
        profile.totals[i];

      const greenWidth =
        length * buyRatio;

      const redWidth =
        length - greenWidth;

      const insideValueArea =
        i >= profile.lower &&
        i <= profile.upper;

      ctx.save();

      ctx.globalAlpha =
        insideValueArea
          ? settings.opacity
          : settings.opacity * 0.55;

      if (right) {
        ctx.fillStyle =
          colors.green;

        ctx.fillRect(
          x, y,
          greenWidth, h
        );

        ctx.fillStyle =
          colors.red;

        ctx.fillRect(
          x + greenWidth,
          y,
          redWidth,
          h
        );
      } else {
        ctx.fillStyle =
          colors.red;

        ctx.fillRect(
          x, y,
          redWidth, h
        );

        ctx.fillStyle =
          colors.green;

        ctx.fillRect(
          x + redWidth,
          y,
          greenWidth,
          h
        );
      }

      ctx.restore();

      if (
        i === profile.pocIndex
      ) {
        ctx.save();

        ctx.strokeStyle =
          colors.poc;

        ctx.lineWidth = 1.5;

        ctx.strokeRect(
          x, y,
          length, h
        );

        ctx.restore();
      }
    }

    const priceY = price =>
      candle.priceToCoordinate(price) +
      offsetY;

    if (settings.valueArea) {
      drawLine(
        ctx,
        priceY(profile.vah),
        "VAH",
        colors.vah,
        effectiveWidth
      );

      drawLine(
        ctx,
        priceY(profile.val),
        "VAL",
        colors.val,
        effectiveWidth
      );
    }

    if (settings.poc) {
      drawLine(
        ctx,
        priceY(profile.poc),
        "POC",
        colors.poc,
        effectiveWidth
      );
    }

    const fmt = value =>
      value.toLocaleString(
        "es-MX",
        {
          maximumFractionDigits: 4
        }
      );

    status(
      visible.length +
      " velas · POC " +
      fmt(profile.poc) +
      " · VAH " +
      fmt(profile.vah) +
      " · VAL " +
      fmt(profile.val)
    );
  }

  function setData(items) {
    data = normalize(items);
    schedule();
  }

  window.CryptolexuzVolumeProfile = {
    attach,
    setData,
    redraw: schedule,
    layout: schedule,
    getData: () => data.slice(),
    getSettings: () => ({
      ...settings
    })
  };

  window.addEventListener(
    "cryptolexuz:chart-ready",
    event => {
      const detail =
        event.detail || {};

      attach(
        detail.chart,
        detail.candle
      );
    }
  );

  if (
    document.readyState ===
    "loading"
  ) {
    document.addEventListener(
      "DOMContentLoaded",
      ensureUI,
      { once: true }
    );
  } else {
    ensureUI();
  }
})();
