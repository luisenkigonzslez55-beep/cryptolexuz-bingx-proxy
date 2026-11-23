
/*
 CRYPTOLEXUZ PRO — VOLUME PROFILE V3
 Compatible con Lightweight Charts 4.2.2.
 Perfil estimado a partir de velas OHLCV.
 No utiliza transacciones tick-by-tick.

 Cambios:
 - No crea columnas ni padding junto a la gráfica.
 - Dibuja el perfil sobre el área de velas.
 - Mantiene libre la escala derecha de precios.
 - Corrige el tamaño al abrir Gráficas.
 - Conserva controles, POC y preferencias.
 - Reordena el menú inferior cuando lo encuentra.
 - No elimina el mapa de liquidez ni otros módulos.
*/
"use strict";

(() => {
  if (window.CryptolexuzVolumeProfile?.version === 3) {
    return;
  }

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

  settings.enabled = settings.enabled !== false;
  settings.poc = settings.poc !== false;
  settings.side =
    settings.side === "left" ? "left" : "right";

  settings.width = Math.max(
    70,
    Math.min(220, Number(settings.width) || 116)
  );

  settings.bins = Math.max(
    40,
    Math.min(200, Number(settings.bins) || 110)
  );

  const $ = id => document.getElementById(id);

  let chart = null;
  let candle = null;
  let data = [];

  let area = null;
  let chartElement = null;
  let canvas = null;
  let controls = null;

  let patchedSeries = null;
  let subscribedChart = null;
  let resizeObserver = null;

  let raf = 0;
  let initialized = false;
  let resizing = false;

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

    return items.map(item => ({
      time: item.time,
      open: Number(item.open),
      high: Number(item.high),
      low: Number(item.low),
      close: Number(item.close),
      volume: Number(item.volume ?? 0)
    })).filter(item =>
      item.time != null &&
      [
        item.open,
        item.high,
        item.low,
        item.close,
        item.volume
      ].every(Number.isFinite) &&
      item.high >= item.low &&
      item.volume >= 0
    );
  }

  function status(message) {
    const el = $("clVpStatus");

    if (el && el.textContent !== message) {
      el.textContent = message;
    }
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
    area = $("priceChartArea");
    chartElement = $("chart");

    if (!area || !chartElement) {
      return false;
    }

    /*
      Quitar el espacio reservado por V2.
      El perfil ya no modifica el ancho
      disponible para las velas.
    */
    area.style.paddingLeft = "0px";
    area.style.paddingRight = "0px";
    area.style.boxSizing = "border-box";
    area.style.position = "relative";

    /*
      Recuperar un contenedor anterior
      si existe, para no duplicarlo.
    */
    const oldHost = $("clVpHost");

    if (oldHost) {
      oldHost.remove();
    }

    if (!controls) {
      controls = $("clVpControls");
    }

    if (!controls) {
      controls = document.createElement("details");

      controls.id = "clVpControls";
      controls.className = "cl-tool-panel";

      controls.innerHTML = `
        <summary>📊 Volume Profile · BingX</summary>

        <div class="cl-tool-content"
          style="
            display:flex;
            flex-wrap:wrap;
            gap:10px;
            align-items:end;
            padding:12px;
          "
        >
          <label style="
            display:flex;
            gap:6px;
            align-items:center;
          ">
            <input id="clVpEnabled"
              type="checkbox">
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
              <option value="85">
                Estrecho
              </option>
              <option value="116">
                Normal
              </option>
              <option value="160">
                Ancho
              </option>
              <option value="200">
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
              <option value="60">
                60 niveles
              </option>
              <option value="90">
                90 niveles
              </option>
              <option value="110">
                110 niveles
              </option>
              <option value="150">
                150 niveles
              </option>
              <option value="200">
                200 niveles
              </option>
            </select>
          </label>

          <label style="
            display:flex;
            gap:6px;
            align-items:center;
          ">
            <input id="clVpPoc"
              type="checkbox">
            Mostrar POC
          </label>

          <small id="clVpStatus"
            style="
              width:100%;
              color:#a5b0cf;
            "
          >
            Esperando datos de volumen...
          </small>
        </div>
      `;

      area.parentNode.insertBefore(
        controls,
        area
      );
    }

    if (!canvas) {
      canvas = document.createElement("canvas");

      canvas.id = "clVpCanvas";

      canvas.style.cssText = [
        "position:absolute",
        "top:0",
        "left:0",
        "width:100%",
        "height:100%",
        "pointer-events:none",
        "z-index:3",
        "background:transparent",
        "display:block"
      ].join(";");

      area.appendChild(canvas);
    }

    const widthField = $("clVpWidth");
    const binsField = $("clVpBins");

    function addOptionIfMissing(select, value, label) {
      if (!select) return;

      if (
        !Array.from(select.options).some(
          option => Number(option.value) === value
        )
      ) {
        const option = document.createElement("option");

        option.value = String(value);
        option.textContent = label;
        select.add(option);
      }
    }

    addOptionIfMissing(
      widthField,
      settings.width,
      settings.width + " px"
    );

    addOptionIfMissing(
      binsField,
      settings.bins,
      settings.bins + " niveles"
    );

    if ($("clVpEnabled")) {
      $("clVpEnabled").checked = settings.enabled;
    }

    if ($("clVpSide")) {
      $("clVpSide").value = settings.side;
    }

    if (widthField) {
      widthField.value = String(settings.width);
    }

    if (binsField) {
      binsField.value = String(settings.bins);
    }

    if ($("clVpPoc")) {
      $("clVpPoc").checked = settings.poc;
    }

    if (!initialized) {
      initialized = true;

      const fields = [
        ["clVpEnabled", "enabled", x => x.checked],
        ["clVpSide", "side", x => x.value],
        ["clVpWidth", "width", x => Number(x.value)],
        ["clVpBins", "bins", x => Number(x.value)],
        ["clVpPoc", "poc", x => x.checked]
      ];

      for (const [id, key, transform] of fields) {
        const field = $(id);

        if (!field) continue;

        field.addEventListener("change", event => {
          settings[key] = transform(event.target);
          save();
          schedule();
          emit();
        });
      }

      window.addEventListener(
        "resize",
        () => {
          resizeChart();
          schedule();
        }
      );

      window.addEventListener(
        "cryptolexuz:screen-change",
        () => {
          requestAnimationFrame(() => {
            resizeChart();
            schedule();

            setTimeout(() => {
              resizeChart();
              schedule();
            }, 250);
          });
        }
      );

      if (window.ResizeObserver) {
        resizeObserver = new ResizeObserver(() => {
          resizeChart();
          schedule();
        });

        resizeObserver.observe(area);
        resizeObserver.observe(chartElement);
      }
    }

    return true;
  }

  function resizeChart() {
    if (
      !chart ||
      !chartElement ||
      resizing
    ) return;

    const width = chartElement.clientWidth;
    const height = chartElement.clientHeight;

    if (width <= 0 || height <= 0) {
      return;
    }

    try {
      resizing = true;

      /*
        La gráfica ocupa su contenedor completo.
        No se resta la anchura del perfil.
      */
      chart.resize(width, height);
    } catch (error) {
      console.warn(
        "Volume Profile: resize",
        error
      );
    } finally {
      resizing = false;
    }
  }

  function attach(nextChart, nextCandle) {
    if (!nextChart || !nextCandle) {
      return;
    }

    chart = nextChart;
    candle = nextCandle;

    ensureUI();

    if (patchedSeries !== nextCandle) {
      patchedSeries = nextCandle;

      const originalSetData =
        nextCandle.setData.bind(nextCandle);

      const originalUpdate =
        nextCandle.update.bind(nextCandle);

      nextCandle.setData = function(items) {
        const result = originalSetData(items);

        data = normalize(items);
        schedule();

        return result;
      };

      nextCandle.update = function(item) {
        const result = originalUpdate(item);
        const next = normalize([item])[0];

        if (next) {
          const last = data[data.length - 1];

          if (last && last.time === next.time) {
            data[data.length - 1] = next;
          } else if (
            !last ||
            next.time > last.time
          ) {
            data.push(next);
          }

          if (data.length > 1500) {
            data = data.slice(-1500);
          }
        }

        schedule();
        return result;
      };
    }

    if (subscribedChart !== nextChart) {
      subscribedChart = nextChart;

      try {
        nextChart.timeScale()
          .subscribeVisibleLogicalRangeChange(
            schedule
          );
      } catch (error) {
        console.warn(
          "Volume Profile: visible range",
          error
        );
      }
    }

    resizeChart();
    schedule();
  }

  function schedule() {
    if (raf) return;

    raf = requestAnimationFrame(() => {
      raf = 0;
      draw();
    });
  }

  function draw() {
    if (!ensureUI() || !canvas) {
      return;
    }

    const width = area.clientWidth;
    const height = area.clientHeight;

    if (width < 10 || height < 10) {
      return;
    }

    const dpr = Math.min(
      window.devicePixelRatio || 1,
      2
    );

    const pixelWidth = Math.round(width * dpr);
    const pixelHeight = Math.round(height * dpr);

    if (canvas.width !== pixelWidth) {
      canvas.width = pixelWidth;
    }

    if (canvas.height !== pixelHeight) {
      canvas.height = pixelHeight;
    }

    const ctx = canvas.getContext("2d");

    if (!ctx) return;

    ctx.setTransform(
      dpr, 0, 0, dpr, 0, 0
    );

    ctx.clearRect(0, 0, width, height);

    if (!settings.enabled) {
      status("Perfil desactivado");
      return;
    }

    if (!chart || !candle) {
      status("Esperando conexión con la gráfica...");
      return;
    }

    if (!data.length) {
      status(
        "Esperando velas OHLCV de BingX..."
      );
      return;
    }

    let range;

    try {
      range = chart.timeScale()
        .getVisibleLogicalRange();
    } catch (_) {
      return;
    }

    if (!range) {
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

    if (end < start) {
      return;
    }

    const visible = data
      .slice(start, end + 1)
      .filter(item => item.volume > 0);

    if (!visible.length) {
      status(
        "No hay volumen disponible en las velas visibles."
      );
      return;
    }

    const low = Math.min(
      ...visible.map(item => item.low)
    );

    const high = Math.max(
      ...visible.map(item => item.high)
    );

    const spread = high - low;

    if (!(spread > 0)) {
      return;
    }

    const bins = settings.bins;
    const step = spread / bins;

    const totals = new Float64Array(bins);

    for (const item of visible) {
      const first = Math.max(
        0,
        Math.min(
          bins - 1,
          Math.floor((item.low - low) / step)
        )
      );

      const last = Math.max(
        0,
        Math.min(
          bins - 1,
          Math.floor((item.high - low) / step)
        )
      );

      const portion =
        item.volume / (last - first + 1);

      for (let i = first; i <= last; i++) {
        totals[i] += portion;
      }
    }

    let maxVolume = 0;
    let pocIndex = 0;

    for (let i = 0; i < bins; i++) {
      if (totals[i] > maxVolume) {
        maxVolume = totals[i];
        pocIndex = i;
      }
    }

    if (maxVolume <= 0) {
      return;
    }

    /*
      Ancho real del área de velas.
      timeScale().width() excluye la escala
      de precios derecha.
    */
    let plotWidth = width;

    try {
      const timeWidth = chart.timeScale().width();

      if (
        Number.isFinite(timeWidth) &&
        timeWidth > 0
      ) {
        plotWidth = Math.min(
          width,
          timeWidth
        );
      }
    } catch (_) {}

    /*
      Convertir coordenadas de la gráfica
      a coordenadas del canvas superpuesto.
    */
    const chartRect =
      chartElement.getBoundingClientRect();

    const areaRect =
      area.getBoundingClientRect();

    const offsetX =
      chartRect.left - areaRect.left;

    const offsetY =
      chartRect.top - areaRect.top;

    const plotLeft = Math.max(0, offsetX);
    const plotRight = Math.min(
      width,
      offsetX + plotWidth
    );

    const usableWidth =
      plotRight - plotLeft;

    if (usableWidth <= 20) {
      return;
    }

    const barMaxWidth = Math.min(
      settings.width,
      usableWidth * 0.38
    );

    const rightSide =
      settings.side === "right";

    ctx.save();

    /*
      Recorte: nada puede dibujarse
      encima de los números de precios.
    */
    ctx.beginPath();

    ctx.rect(
      plotLeft,
      Math.max(0, offsetY),
      usableWidth,
      Math.min(
        height,
        chartElement.clientHeight
      )
    );

    ctx.clip();

    for (let i = 0; i < bins; i++) {
      if (totals[i] <= 0) continue;

      const price0 = low + i * step;
      const price1 = price0 + step;

      const coord0 =
        candle.priceToCoordinate(price0);

      const coord1 =
        candle.priceToCoordinate(price1);

      if (
        !Number.isFinite(coord0) ||
        !Number.isFinite(coord1)
      ) {
        continue;
      }

      const y =
        Math.min(coord0, coord1) + offsetY;

      const barHeight = Math.max(
        1,
        Math.abs(coord1 - coord0) - 0.3
      );

      const length = Math.max(
        1,
        (totals[i] / maxVolume) *
        barMaxWidth
      );

      const x = rightSide
        ? plotRight - length
        : plotLeft;

      ctx.fillStyle =
        i === pocIndex
          ? "rgba(79,205,255,0.70)"
          : "rgba(49,133,255,0.34)";

      ctx.fillRect(
        x,
        y,
        length,
        barHeight
      );
    }

    if (settings.poc) {
      const pocPrice =
        low + (pocIndex + 0.5) * step;

      const pocCoord =
        candle.priceToCoordinate(pocPrice);

      if (Number.isFinite(pocCoord)) {
        const y = pocCoord + offsetY;

        ctx.strokeStyle = "#ff5375";
        ctx.lineWidth = 1.5;

        ctx.beginPath();
        ctx.moveTo(plotLeft, y);
        ctx.lineTo(plotRight, y);
        ctx.stroke();

        ctx.fillStyle = "#ff8ba3";
        ctx.font = "bold 10px system-ui";
        ctx.textAlign =
          rightSide ? "right" : "left";

        ctx.fillText(
          "POC",
          rightSide
            ? plotRight - 5
            : plotLeft + 5,
          y - 5
        );
      }
    }

    ctx.restore();

    status(
      visible.length +
      " velas visibles · " +
      bins +
      " niveles · POC estimado"
    );
  }

  /*
    Reordenar los botones existentes.
    No se crean botones nuevos ni se
    modifican sus eventos originales.
  */
  function reorderBottomNavigation() {
    const buttons = Array.from(
      document.querySelectorAll(
        "button, a, [role='tab']"
      )
    );

    const findButton = word =>
      buttons.find(element => {
        const label = (
          element.textContent || ""
        ).trim().toLowerCase();

        return label === word ||
          label.startsWith(word + " ");
      });

    const graphs = findButton("gráficas");
    const scanner = findButton("escáner");
    const results = findButton("resultados");

    if (
      !graphs ||
      !scanner ||
      !results
    ) return;

    const parent = graphs.parentElement;

    if (
      parent &&
      scanner.parentElement === parent &&
      results.parentElement === parent
    ) {
      parent.appendChild(graphs);
      parent.appendChild(scanner);
      parent.appendChild(results);
    }
  }

  window.CryptolexuzVolumeProfile = {
    version: 3,
    attach,
    redraw: schedule,

    layout() {
      ensureUI();
      resizeChart();
      schedule();
    },

    getSettings() {
      return { ...settings };
    },

    getData() {
      return data.slice();
    },

    setData(items) {
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

  function boot() {
    ensureUI();
    reorderBottomNavigation();
    schedule();
  }

  if (document.readyState === "loading") {
    document.addEventListener(
      "DOMContentLoaded",
      boot
    );
  } else {
    boot();
  }
})();
