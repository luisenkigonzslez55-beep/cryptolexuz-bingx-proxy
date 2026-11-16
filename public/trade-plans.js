
/*
 CRYPTOLEXUZ PRO — TRADE PLANS V2
 Tarjetas móviles: entrada, stop loss, TP1, TP2.
 Precisión de mercado cuando la API la permite.
 No ejecuta órdenes ni confirma operaciones.
*/
"use strict";

(() => {
  const $ = id => document.getElementById(id);
  const GOLD = "NCCOGOLD2USD-USDT";

  const plans = new Map();
  const precisionCache = new Map();
  const candlesCache = new Map();
  const alerted = new Set();

  let metadataPromise = null;
  let busy = false;
  let pending = false;
  let observer = null;

  const terminal = new Set([
    "EXPIRADA",
    "INVALIDADA",
    "STOP ALCANZADO",
    "TP2 ALCANZADO",
    "SECUENCIA INCIERTA",
    "SEGUIMIENTO FINALIZADO"
  ]);

  function number(v) {
    if (
      v === null ||
      v === undefined ||
      v === ""
    ) return NaN;

    const n = Number(v);

    return Number.isFinite(n) && n > 0
      ? n
      : NaN;
  }

  function seconds(v) {
    const n =
      typeof v === "string" &&
      !/^\d+$/.test(v)
        ? Date.parse(v)
        : Number(v);

    if (!Number.isFinite(n)) return NaN;

    return Math.floor(
      n > 1e12 ? n / 1000 : n
    );
  }

  function normalize(raw) {
    let list = raw;

    if (!Array.isArray(list)) {
      list =
        raw?.data?.data ??
        raw?.data?.list ??
        raw?.data?.candles ??
        raw?.data ??
        raw?.list ??
        [];
    }

    if (!Array.isArray(list)) return [];

    const now = Math.floor(Date.now() / 1000);
    const arr = [];

    for (const c of list) {
      if (!c || typeof c !== "object") continue;

      const isArray = Array.isArray(c);

      const time = seconds(
        isArray
          ? c[0]
          : c.time ??
            c.timestamp ??
            c.openTime ??
            c.t
      );

      const open = number(
        isArray ? c[1] : c.open ?? c.o
      );

      const high = number(
        isArray ? c[2] : c.high ?? c.h
      );

      const low = number(
        isArray ? c[3] : c.low ?? c.l
      );

      const close = number(
        isArray ? c[4] : c.close ?? c.c
      );

      if (
        ![time, open, high, low, close]
          .every(Number.isFinite) ||
        time <= 0 ||
        time > now + 60 ||
        high < Math.max(open, close, low) ||
        low > Math.min(open, close, high)
      ) continue;

      arr.push({
        time,
        open,
        high,
        low,
        close
      });
    }

    arr.sort((a, b) => a.time - b.time);

    return [
      ...new Map(
        arr.map(x => [x.time, x])
      ).values()
    ];
  }

  async function getJSON(url, ms = 10000) {
    const controller = new AbortController();

    const timer = setTimeout(
      () => controller.abort(),
      ms
    );

    try {
      const res = await fetch(url, {
        signal: controller.signal,
        cache: "no-store"
      });

      if (!res.ok) {
        throw Error("HTTP " + res.status);
      }

      const data = await res.json();

      if (
        data?.code !== undefined &&
        ![0, "0"].includes(data.code)
      ) {
        throw Error(
          data.msg || "API rechazó consulta"
        );
      }

      return data;

    } finally {
      clearTimeout(timer);
    }
  }

  function endpoint(s, tf) {
    return (
      "/api/exchange/" +
      encodeURIComponent(s.exchange) +
      "/klines/" +
      encodeURIComponent(s.symbol) +
      "?market=" +
      encodeURIComponent(s.market) +
      "&interval=" + tf +
      "&limit=110"
    );
  }

  async function candles(s, tf) {
    const key = [
      s.exchange,
      s.market,
      s.symbol,
      tf
    ].join("|");

    const cached = candlesCache.get(key);

    const ttl = tf === "1m"
      ? 40000
      : 75000;

    if (
      cached &&
      Date.now() - cached.at < ttl
    ) {
      return cached.data;
    }

    const data = normalize(
      await getJSON(endpoint(s, tf))
    );

    if (data.length < 40) {
      throw Error(
        "Velas insuficientes: " + tf
      );
    }

    candlesCache.set(key, {
      at: Date.now(),
      data
    });

    return data;
  }

  const contractKey = s => [
    s.exchange,
    s.market,
    s.symbol
  ].join("|");

  // PRECISIÓN DEL CONTRATO

  function decimalsOf(n) {
    const txt = String(n).toLowerCase();

    if (txt.includes("e-")) {
      return Number(txt.split("e-")[1]);
    }

    return (
      txt.split(".")[1] || ""
    ).length;
  }

  function estimatedRule(data) {
    let decimals = 1;

    for (const c of data.slice(-30)) {
      for (const val of [
        c.open,
        c.high,
        c.low,
        c.close
      ]) {
        const clean = Number(val)
          .toFixed(8)
          .replace(/0+$/, "");

        decimals = Math.max(
          decimals,
          (
            clean.split(".")[1] || ""
          ).length
        );
      }
    }

    decimals = Math.min(decimals, 8);

    return {
      step: 10 ** (-decimals),
      decimals,
      verified: false,
      tickVerified: false,
      source:
        "Precisión estimada a partir de velas"
    };
  }

  async function bingxMetadata() {
    if (!metadataPromise) {
      metadataPromise = getJSON(
        "https://open-api.bingx.com/openApi/swap/v2/quote/contracts",
        8000
      ).catch(err => {
        metadataPromise = null;
        throw err;
      });
    }

    return metadataPromise;
  }

  async function ruleFor(s, data) {
    const key = contractKey(s);
    const old = precisionCache.get(key);

    if (
      old &&
      Date.now() - old.at < 15 * 60 * 1000
    ) {
      return old.rule;
    }

    let rule = null;

    try {
      let tick = NaN;
      let precision = NaN;
      let name = s.exchange.toUpperCase();

      if (
        s.exchange === "bingx" &&
        s.market === "perpetual"
      ) {
        const res = await bingxMetadata();

        const all = Array.isArray(res.data)
          ? res.data
          : [res.data];

        const item = all.find(
          x => x?.symbol === s.symbol
        );

        if (item) {
          tick = number(
            item.tickSize ??
            item.priceStep
          );

          precision = Number(
            item.pricePrecision
          );

          name = "BingX";
        }

      } else if (s.exchange === "binance") {
        const sym = s.symbol.replace("-", "");

        const url = s.market === "spot"
          ? "https://api.binance.com/api/v3/exchangeInfo?symbol="
          : "https://fapi.binance.com/fapi/v1/exchangeInfo?symbol=";

        const res = await getJSON(
          url + encodeURIComponent(sym),
          8000
        );

        tick = number(
          res.symbols?.[0]?.filters?.find(
            f => f.filterType === "PRICE_FILTER"
          )?.tickSize
        );

      } else if (s.exchange === "bybit") {
        const url =
          "https://api.bybit.com/v5/market/instruments-info?category=" +
          (
            s.market === "spot"
              ? "spot"
              : "linear"
          ) +
          "&symbol=" +
          encodeURIComponent(
            s.symbol.replace("-", "")
          );

        const res = await getJSON(url, 8000);

        tick = number(
          res.result?.list?.[0]
            ?.priceFilter?.tickSize
        );

      } else if (s.exchange === "okx") {
        const instrument =
          s.symbol +
          (
            s.market === "spot"
              ? ""
              : "-SWAP"
          );

        const url =
          "https://www.okx.com/api/v5/public/instruments?instType=" +
          (
            s.market === "spot"
              ? "SPOT"
              : "SWAP"
          ) +
          "&instId=" +
          encodeURIComponent(instrument);

        const res = await getJSON(url, 8000);

        tick = number(
          res.data?.[0]?.tickSz
        );
      }

      if (
        Number.isFinite(tick) &&
        tick > 0
      ) {
        rule = {
          step: tick,
          decimals: Math.min(
            10,
            decimalsOf(tick)
          ),
          verified: true,
          tickVerified: true,
          source:
            name + ": tick publicado"
        };

      } else if (
        Number.isInteger(precision) &&
        precision >= 0 &&
        precision <= 10
      ) {
        rule = {
          step: 10 ** (-precision),
          decimals: precision,
          verified: true,
          tickVerified: false,
          source:
            name +
            ": decimales oficiales (tick sin verificar)"
        };
      }

    } catch (err) {
      console.info(
        "CRYPTOLEXUZ: precisión de",
        s.symbol,
        "no consultable desde el navegador:",
        err.message
      );
    }

    rule ??= estimatedRule(data);

    precisionCache.set(key, {
      rule,
      at: Date.now()
    });

    return rule;
  }

  function quantize(
    price,
    rule,
    direction = "nearest"
  ) {
    const raw = price / rule.step;

    const units = direction === "up"
      ? Math.ceil(raw - 1e-8)
      : direction === "down"
        ? Math.floor(raw + 1e-8)
        : Math.round(raw);

    return Number(
      (units * rule.step).toFixed(
        Math.min(rule.decimals, 10)
      )
    );
  }

  function fmt(n, rule) {
    return Number.isFinite(n)
      ? n.toLocaleString("en-US", {
          minimumFractionDigits:
            rule.decimals,
          maximumFractionDigits:
            rule.decimals
        })
      : "—";
  }

  // VOLATILIDAD Y NIVELES

  function ATR(data, period = 14) {
    const closed = data.slice(0, -1);

    if (
      closed.length < period + 2
    ) return NaN;

    const ranges = [];

    for (
      let i = 1;
      i < closed.length;
      i++
    ) {
      ranges.push(
        Math.max(
          closed[i].high - closed[i].low,
          Math.abs(
            closed[i].high -
            closed[i - 1].close
          ),
          Math.abs(
            closed[i].low -
            closed[i - 1].close
          )
        )
      );
    }

    let result = ranges
      .slice(0, period)
      .reduce((a, b) => a + b, 0)
      / period;

    for (
      let i = period;
      i < ranges.length;
      i++
    ) {
      result = (
        result * (period - 1) +
        ranges[i]
      ) / period;
    }

    return result;
  }

  function createPlan(
    signal,
    one,
    five,
    rule
  ) {
    const closed1 = one.slice(0, -1);
    const closed5 = five.slice(0, -1);

    if (
      closed1.length < 30 ||
      closed5.length < 20
    ) return null;

    const last = closed1.at(-1);

    if (
      Math.floor(Date.now() / 1000) -
      last.time > 210
    ) return null;

    const volatility = ATR(five);

    if (
      !Number.isFinite(volatility) ||
      volatility <= rule.step
    ) return null;

    const long = signal.side === "LONG";

    const recent = closed1.slice(-6);
    const swing1 = closed1.slice(-12);
    const swing5 = closed5.slice(-4);

    const entry = long
      ? quantize(
          Math.max(
            ...recent.map(c => c.high)
          ) + rule.step,
          rule,
          "up"
        )
      : quantize(
          Math.min(
            ...recent.map(c => c.low)
          ) - rule.step,
          rule,
          "down"
        );

    const swingLow = Math.min(
      ...swing1.map(c => c.low),
      ...swing5.map(c => c.low)
    );

    const swingHigh = Math.max(
      ...swing1.map(c => c.high),
      ...swing5.map(c => c.high)
    );

    const stop = long
      ? quantize(
          Math.min(
            swingLow,
            entry - .85 * volatility
          ) - rule.step,
          rule,
          "down"
        )
      : quantize(
          Math.max(
            swingHigh,
            entry + .85 * volatility
          ) + rule.step,
          rule,
          "up"
        );

    const risk = Math.abs(entry - stop);
    const riskPct = 100 * risk / entry;

    if (
      !Number.isFinite(riskPct) ||
      risk < 3 * rule.step ||
      riskPct < .015 ||
      riskPct > 2.5 ||
      entry <= 0 ||
      stop <= 0
    ) return null;

    const tp1 = quantize(
      entry +
      (long ? 1 : -1) *
      risk * 1.5,
      rule,
      long ? "up" : "down"
    );

    const tp2 = quantize(
      entry +
      (long ? 1 : -1) *
      risk * 2.5,
      rule,
      long ? "up" : "down"
    );

    if (
      !(tp1 > 0 && tp2 > 0)
    ) return null;

    return {
      key: contractKey(signal.s),
      s: signal.s,
      side: signal.side,
      entry,
      stop,
      tp1,
      tp2,
      riskPct,
      rule,
      score: signal.score,
      status: "ESPERAR ENTRADA",
      createdAt: Date.now(),
      lastClosed: last.time,
      checkedClosed: last.time
    };
  }

  // SEGUIMIENTO DE LA ENTRADA

  function advancePlan(plan, one) {
    if (
      terminal.has(plan.status)
    ) return;

    const long = plan.side === "LONG";

    const closed = one
      .slice(0, -1)
      .filter(
        c => c.time > plan.checkedClosed
      );

    for (const candle of closed) {
      const entryHit = long
        ? candle.high >= plan.entry
        : candle.low <= plan.entry;

      const stopHit = long
        ? candle.low <= plan.stop
        : candle.high >= plan.stop;

      const t1 = long
        ? candle.high >= plan.tp1
        : candle.low <= plan.tp1;

      const t2 = long
        ? candle.high >= plan.tp2
        : candle.low <= plan.tp2;

      if (
        plan.status === "ESPERAR ENTRADA"
      ) {
        if (
          entryHit &&
          (stopHit || t1 || t2)
        ) {
          plan.status =
            "SECUENCIA INCIERTA";

        } else if (stopHit) {
          plan.status = "INVALIDADA";

        } else if (entryHit) {
          plan.status = "NIVEL ALCANZADO";

        } else if (
          candle.time -
          plan.lastClosed >= 180
        ) {
          plan.status = "EXPIRADA";
        }

      } else if (
        [
          "NIVEL ALCANZADO",
          "TP1 ALCANZADO"
        ].includes(plan.status)
      ) {
        if (
          stopHit &&
          (t1 || t2)
        ) {
          plan.status =
            "SECUENCIA INCIERTA";

        } else if (stopHit) {
          plan.status =
            "STOP ALCANZADO";

        } else if (t2) {
          plan.status =
            "TP2 ALCANZADO";

        } else if (t1) {
          plan.status =
            "TP1 ALCANZADO";
        }
      }

      plan.checkedClosed = candle.time;

      if (
        terminal.has(plan.status)
      ) break;
    }

    if (
      !terminal.has(plan.status) &&
      plan.status !== "ESPERAR ENTRADA" &&
      Date.now() - plan.createdAt >
        30 * 60000
    ) {
      plan.status =
        "SEGUIMIENTO FINALIZADO";
    }
  }

  // LEER EL ESCÁNER V12

  function getSignals() {
    const tbody = $("clScanBody");

    if (!tbody) return [];

    const exchange = (
      $("exchange")?.value || "bingx"
    ).toLowerCase();

    const market = (
      $("market")?.value || "perpetual"
    );

    const result = [];

    for (
      const tr of tbody.querySelectorAll(
        ":scope > tr"
      )
    ) {
      if (tr.dataset.tradeplanRow) {
        continue;
      }

      const cells = [...tr.children];

      if (
        cells.length < 6 ||
        !/^\d+$/.test(
          cells[0].textContent.trim()
        )
      ) continue;

      const label =
        cells[1].textContent.trim();

      const gold =
        label.includes("GOLD");

      const side =
        cells[2].textContent.trim();

      result.push({
        label,
        side,

        score: Number(
          cells[3].textContent.split("/")[0]
        ),

        state:
          cells[4].textContent.trim(),

        s: {
          exchange: gold
            ? "bingx"
            : exchange,

          market: gold
            ? "perpetual"
            : market,

          symbol: gold
            ? GOLD
            : label.replace("/", "-")
        }
      });
    }

    return result;
  }

  function snapshot(signals) {
    return JSON.stringify({
      selection: [
        $("exchange")?.value,
        $("market")?.value
      ],

      signals: signals.map(s => [
        contractKey(s.s),
        s.side,
        s.score,
        s.state
      ])
    });
  }

  // TARJETAS ADAPTADAS AL TELÉFONO

  function ensureCards() {
    let root = $("clTradePlans");

    if (root) return root;

    const scanner = $("clScanner");

    if (!scanner) return null;

    root = document.createElement("div");
    root.id = "clTradePlans";

    root.innerHTML = `
      <h3 class="cltp-title">
        🎯 Planes de entrada
      </h3>

      <p class="cltp-explainer">
        Niveles calculados con velas cerradas
        de uno y cinco minutos. No se envían
        órdenes al exchange.
      </p>

      <div id="clTradeCards"></div>
    `;

    scanner.appendChild(root);

    if (!$("clTradeStyle")) {
      const style =
        document.createElement("style");

      style.id = "clTradeStyle";

      style.textContent = `
        #clTradePlans {
          margin-top: 18px;
          padding-top: 16px;
          border-top: 1px solid #304468;
          min-width: 0;
        }

        .cltp-title {
          margin: 0 0 6px;
          font-size: 16px;
          color: #e6edff;
        }

        .cltp-explainer {
          margin: 0 0 13px;
          font-size: 12px;
          color: #a5b0cf;
          line-height: 1.5;
        }

        #clTradeCards {
          display: grid;
          gap: 12px;
          min-width: 0;
        }

        .cltp-card {
          min-width: 0;
          max-width: 100%;
          overflow: hidden;
          box-sizing: border-box;
          background: #101d36;
          border: 1px solid #304566;
          border-radius: 12px;
          padding: 14px;
        }

        .cltp-head {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
          margin-bottom: 11px;
        }

        .cltp-asset {
          font-size: 15px;
          font-weight: 750;
          color: #f3f6ff;
          overflow-wrap: anywhere;
        }

        .cltp-side {
          font-size: 12px;
          font-weight: 750;
        }

        .cltp-long {
          color: #00f5a0;
        }

        .cltp-short {
          color: #ff6381;
        }

        .cltp-state {
          font-size: 12px;
          color: #ffe15a;
          margin: 0 0 12px;
          overflow-wrap: anywhere;
        }

        .cltp-levels {
          display: grid;
          grid-template-columns:
            repeat(2, minmax(0, 1fr));
          gap: 9px;
        }

        .cltp-level {
          min-width: 0;
          box-sizing: border-box;
          background: #0b1429;
          border: 1px solid #263857;
          border-radius: 8px;
          padding: 9px 10px;
        }

        .cltp-label {
          display: block;
          font-size: 11px;
          color: #a5b0cf;
          margin-bottom: 4px;
        }

        .cltp-price {
          display: block;
          font-size: clamp(
            13px, 3.5vw, 17px
          );
          font-weight: 700;
          color: #f3f6ff;
          overflow-wrap: anywhere;
          word-break: break-word;
          font-variant-numeric: tabular-nums;
        }

        .cltp-entry .cltp-price {
          color: #36c5ff;
        }

        .cltp-stop .cltp-price {
          color: #ff6c86;
        }

        .cltp-target .cltp-price {
          color: #00f5a0;
        }

        .cltp-foot {
          font-size: 11px;
          line-height: 1.6;
          color: #b8c8e3;
          margin-top: 11px;
          overflow-wrap: anywhere;
        }

        .cltp-warning {
          color: #ffe15a;
        }

        .cltp-empty {
          padding: 12px;
          border: 1px dashed #34456c;
          border-radius: 10px;
          color: #b8c8e3;
          font-size: 12px;
          line-height: 1.6;
        }

        @media(max-width:355px) {
          .cltp-levels {
            grid-template-columns: 1fr;
          }

          .cltp-card {
            padding: 11px;
          }
        }
      `;

      document.head.appendChild(style);
    }

    return root;
  }

  function boxText(tag, className, content) {
    const el = document.createElement(tag);

    el.className = className;
    el.textContent = content;

    return el;
  }

  function renderCard(signal, plan) {
    const card =
      document.createElement("article");

    card.className = "cltp-card";

    const head =
      document.createElement("div");

    head.className = "cltp-head";

    head.appendChild(
      boxText(
        "span",
        "cltp-asset",
        signal.label
      )
    );

    head.appendChild(
      boxText(
        "span",
        "cltp-side " +
        (
          signal.side === "LONG"
            ? "cltp-long"
            : "cltp-short"
        ),
        signal.side +
        " · " +
        signal.score + "/100"
      )
    );

    card.appendChild(head);

    if (!plan) {
      card.appendChild(
        boxText(
          "p",
          "cltp-state",
          "Sin plan válido: revisar estructura, volatilidad o datos recientes."
        )
      );

      return card;
    }

    card.appendChild(
      boxText(
        "p",
        "cltp-state",
        "Estado: " + plan.status
      )
    );

    const grid =
      document.createElement("div");

    grid.className = "cltp-levels";

    for (
      const [label, val, cls] of [
        [
          "🎯 Entrada",
          plan.entry,
          "cltp-entry"
        ],
        [
          "🛑 Stop Loss",
          plan.stop,
          "cltp-stop"
        ],
        [
          "✅ Take Profit 1",
          plan.tp1,
          "cltp-target"
        ],
        [
          "✅ Take Profit 2",
          plan.tp2,
          "cltp-target"
        ]
      ]
    ) {
      const level =
        document.createElement("div");

      level.className =
        "cltp-level " + cls;

      level.appendChild(
        boxText(
          "span",
          "cltp-label",
          label
        )
      );

      level.appendChild(
        boxText(
          "strong",
          "cltp-price",
          fmt(val, plan.rule)
        )
      );

      grid.appendChild(level);
    }

    card.appendChild(grid);

    const foot =
      document.createElement("div");

    foot.className = "cltp-foot";

    foot.appendChild(
      boxText(
        "div",
        "",
        "Distancia entrada–stop: " +
        plan.riskPct.toFixed(2) +
        "% · TP1 1.5R · TP2 2.5R"
      )
    );

    const precision = boxText(
      "div",
      plan.rule.verified
        ? ""
        : "cltp-warning",

      (
        plan.rule.verified
          ? "✓ "
          : "⚠ "
      ) +
      plan.rule.source +
      (
        plan.rule.tickVerified
          ? ""
          : " · Verifica el incremento mínimo antes de operar"
      )
    );

    foot.appendChild(precision);

    foot.appendChild(
      boxText(
        "div",
        "",
        "Nivel alcanzado ≠ orden ejecutada. Sin comisiones, deslizamiento ni liquidación."
      )
    );

    card.appendChild(foot);

    return card;
  }

  function render(signals) {
    if (!ensureCards()) return;

    const area = $("clTradeCards");
    area.replaceChildren();

    const candidates = signals.filter(
      s =>
        s.state === "CONFIRMADA" &&
        ["LONG", "SHORT"].includes(s.side)
    );

    if (!candidates.length) {
      area.appendChild(
        boxText(
          "div",
          "cltp-empty",
          "Todavía no hay oportunidades confirmadas con niveles operativos. El escáner seguirá revisando el mercado."
        )
      );

      return;
    }

    for (const signal of candidates) {
      const plan = plans.get(
        contractKey(signal.s)
      );

      area.appendChild(
        renderCard(
          signal,
          plan?.side === signal.side
            ? plan
            : null
        )
      );
    }
  }

  // NOTIFICACIONES

  function notify(plan) {
    if (
      plan.status !== "NIVEL ALCANZADO" ||
      !plan.rule.verified
    ) return;

    if (
      !("Notification" in window) ||
      Notification.permission !== "granted"
    ) return;

    const key = [
      plan.key,
      plan.side,
      plan.createdAt
    ].join("|");

    if (alerted.has(key)) return;

    alerted.add(key);

    try {
      const n = new Notification(
        "CRYPTOLEXUZ · Nivel de entrada alcanzado",
        {
          body:
            plan.s.symbol +
            " · " + plan.side +
            " · Entrada " +
            fmt(plan.entry, plan.rule) +
            " · STOP " +
            fmt(plan.stop, plan.rule) +
            " · TP1 " +
            fmt(plan.tp1, plan.rule) +
            " · TP2 " +
            fmt(plan.tp2, plan.rule) +
            " · No confirma ejecución",

          tag: key
        }
      );

      n.onclick = () => {
        window.focus();
        n.close();
      };

    } catch (err) {
      console.info(
        "Aviso no admitido por navegador:",
        err.message
      );
    }
  }

  // ANÁLISIS AUTOMÁTICO

  async function process() {
    if (document.hidden) return;

    const signals = getSignals();

    if (!signals.length) return;

    const sig = snapshot(signals);

    if (busy) {
      pending = true;
      return;
    }

    busy = true;
    pending = false;

    try {
      const confirmed = signals.filter(
        s =>
          s.state === "CONFIRMADA" &&
          s.score >= 65 &&
          ["LONG", "SHORT"].includes(s.side)
      );

      for (const s of signals) {
        const old = plans.get(
          contractKey(s.s)
        );

        if (
          old &&
          old.status === "ESPERAR ENTRADA" &&
          (
            s.state !== "CONFIRMADA" ||
            s.side !== old.side
          )
        ) {
          old.status = "INVALIDADA";
        }
      }

      let index = 0;

      async function worker() {
        while (index < confirmed.length) {
          const signal = confirmed[index++];

          const key = contractKey(
            signal.s
          );

          try {
            const [one, five] =
              await Promise.all([
                candles(signal.s, "1m"),
                candles(signal.s, "5m")
              ]);

            if (
              snapshot(getSignals()) !== sig
            ) continue;

            let old = plans.get(key);

            if (
              old &&
              old.side === signal.side
            ) {
              advancePlan(old, one);

              if (
                !terminal.has(old.status)
              ) {
                notify(old);
                continue;
              }

              if (
                Date.now() -
                old.createdAt <
                10 * 60000
              ) continue;
            }

            const rule = await ruleFor(
              signal.s,
              one
            );

            if (
              snapshot(getSignals()) !== sig
            ) continue;

            const plan = createPlan(
              signal,
              one,
              five,
              rule
            );

            if (plan) {
              plans.set(key, plan);
            }

          } catch (err) {
            console.warn(
              "Niveles",
              signal.label,
              err.message
            );
          }
        }
      }

      await Promise.all([
        worker(),
        worker()
      ]);

      if (
        snapshot(getSignals()) === sig
      ) {
        render(signals);
      }

    } finally {
      busy = false;

      if (pending) {
        pending = false;
        setTimeout(process, 250);
      }
    }
  }

  // INICIO DEL MÓDULO

  function init() {
    const body = $("clScanBody");

    if (!body) {
      setTimeout(init, 400);
      return;
    }

    ensureCards();

    observer = new MutationObserver(
      () => process()
    );

    observer.observe(body, {
      childList: true
    });

    $("exchange")?.addEventListener(
      "change",
      () => setTimeout(process, 300)
    );

    $("market")?.addEventListener(
      "change",
      () => setTimeout(process, 300)
    );

    document.addEventListener(
      "visibilitychange",
      () => {
        if (!document.hidden) process();
      }
    );

    process();

    setInterval(
      () => {
        if (!document.hidden) {
          process();
        }
      },
      60000
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
