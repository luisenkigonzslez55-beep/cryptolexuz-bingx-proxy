

/*
 CRYPTOLEXUZ PRO — NIVELES V13
 Entrada, stop, TP1 y TP2.
 Respeta las señales del escáner V12.
 No coloca órdenes.
*/
"use strict";

(() => {
  const $ = id => document.getElementById(id);

  const GOLD = "NCCOGOLD2USD-USDT";
  const plans = new Map();
  const rules = new Map();
  const alerts = new Set();

  let running = false;
  let queued = false;
  let observer = null;
  let bingxContracts = null;

  const now = () => Date.now();

  const normSymbol = label =>
    label.includes("GOLD")
      ? GOLD
      : label.replace("/", "-");

  const keyOf = s =>
    [s.exchange, s.market, s.symbol].join("|");

  function fmt(n, rule) {
    if (!Number.isFinite(n)) return "—";

    return n.toLocaleString("en-US", {
      minimumFractionDigits: rule.decimals,
      maximumFractionDigits: rule.decimals
    });
  }

  function correctNumber(n) {
    const value = Number(n);

    return Number.isFinite(value) && value > 0
      ? value
      : NaN;
  }

  function toSeconds(t) {
    const n = Number(t);

    return Number.isFinite(n)
      ? Math.floor(n > 1e12 ? n / 1000 : n)
      : NaN;
  }

  function normalize(raw) {
    let list =
      raw?.data?.data ??
      raw?.data?.list ??
      raw?.data?.candles ??
      raw?.data ??
      raw;

    if (!Array.isArray(list)) return [];

    const result = [];

    for (const c of list) {
      const a = Array.isArray(c);

      const time = toSeconds(
        a ? c[0] :
        c.time ?? c.timestamp ??
        c.openTime ?? c.t
      );

      const open = correctNumber(
        a ? c[1] : c.open ?? c.o
      );

      const high = correctNumber(
        a ? c[2] : c.high ?? c.h
      );

      const low = correctNumber(
        a ? c[3] : c.low ?? c.l
      );

      const close = correctNumber(
        a ? c[4] : c.close ?? c.c
      );

      if (
        ![time, open, high, low, close]
          .every(Number.isFinite) ||
        high < Math.max(open, close, low) ||
        low > Math.min(open, close, high)
      ) continue;

      result.push({
        time, open, high, low, close
      });
    }

    result.sort((a, b) => a.time - b.time);

    return [...new Map(
      result.map(c => [c.time, c])
    ).values()];
  }

  async function json(url, ms = 9000) {
    const controller = new AbortController();

    const timer = setTimeout(
      () => controller.abort(),
      ms
    );

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        cache: "no-store"
      });

      if (!response.ok) {
        throw Error("HTTP " + response.status);
      }

      return await response.json();

    } finally {
      clearTimeout(timer);
    }
  }

  function url(s, tf) {
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

  function decimalCount(n) {
    const text = Number(n)
      .toFixed(10)
      .replace(/0+$/, "");

    return (text.split(".")[1] || "").length;
  }

  function estimatedRule(data) {
    let decimals = 1;

    for (const c of data.slice(-30)) {
      for (const n of [
        c.open, c.high, c.low, c.close
      ]) {
        const str = Number(n)
          .toFixed(8)
          .replace(/0+$/, "");

        decimals = Math.max(
          decimals,
          (str.split(".")[1] || "").length
        );
      }
    }

    decimals = Math.min(8, decimals);

    return {
      tick: 10 ** (-decimals),
      decimals,
      verified: false,
      source: "Estimación basada en velas"
    };
  }

  async function ruleFor(s, candles) {
    const key = keyOf(s);
    const cached = rules.get(key);

    if (
      cached &&
      now() - cached.at < 15 * 60 * 1000
    ) {
      return cached.rule;
    }

    let tick = NaN;
    let source = "";

    try {
      if (
        s.exchange === "bingx" &&
        s.market === "perpetual"
      ) {
        if (!bingxContracts) {
          bingxContracts = json(
            "https://open-api.bingx.com/openApi/swap/v2/quote/contracts",
            9000
          ).catch(error => {
            bingxContracts = null;
            throw error;
          });
        }

        const raw = await bingxContracts;

        if (
          raw.code !== 0 &&
          raw.code !== "0"
        ) {
          throw Error(
            raw.msg || "Sin metadatos"
          );
        }

        const list = Array.isArray(raw.data)
          ? raw.data
          : [raw.data];

        const item = list.find(
          c => c?.symbol === s.symbol
        );

        if (item) {
          tick = correctNumber(
            item.tickSize ?? item.priceStep
          );

          if (!Number.isFinite(tick)) {
            const p = Number(
              item.pricePrecision
            );

            if (
              Number.isInteger(p) &&
              p >= 0 &&
              p <= 10
            ) {
              tick = 10 ** (-p);
            }
          }

          source = "BingX";
        }

      } else if (s.exchange === "binance") {
        const host = s.market === "spot"
          ? "https://api.binance.com/api/v3/exchangeInfo"
          : "https://fapi.binance.com/fapi/v1/exchangeInfo";

        const raw = await json(
          host + "?symbol=" +
          s.symbol.replace("-", "")
        );

        tick = correctNumber(
          raw.symbols?.[0]?.filters?.find(
            x => x.filterType === "PRICE_FILTER"
          )?.tickSize
        );

        source = "Binance";

      } else if (s.exchange === "bybit") {
        const raw = await json(
          "https://api.bybit.com/v5/market/instruments-info?category=" +
          (
            s.market === "spot"
              ? "spot"
              : "linear"
          ) +
          "&symbol=" +
          s.symbol.replace("-", "")
        );

        tick = correctNumber(
          raw.result?.list?.[0]
            ?.priceFilter?.tickSize
        );

        source = "Bybit";

      } else if (s.exchange === "okx") {
        const instId =
          s.symbol +
          (s.market === "spot" ? "" : "-SWAP");

        const raw = await json(
          "https://www.okx.com/api/v5/public/instruments?instType=" +
          (
            s.market === "spot"
              ? "SPOT"
              : "SWAP"
          ) +
          "&instId=" + instId
        );

        tick = correctNumber(
          raw.data?.[0]?.tickSz
        );

        source = "OKX";
      }

    } catch (error) {
      console.info(
        "Precisión sin verificar:",
        s.symbol,
        error.message
      );
    }

    const rule = Number.isFinite(tick)
      ? {
          tick,
          decimals: decimalCount(tick),
          verified: true,
          source
        }
      : estimatedRule(candles);

    rules.set(key, {
      rule,
      at: now()
    });

    return rule;
  }

  function round(v, rule, mode) {
    const q = v / rule.tick;

    const units = mode === "up"
      ? Math.ceil(q - 1e-8)
      : mode === "down"
        ? Math.floor(q + 1e-8)
        : Math.round(q);

    return Number(
      (units * rule.tick).toFixed(
        Math.min(rule.decimals, 10)
      )
    );
  }

  function atr(data, p = 14) {
    const a = data.slice(0, -1);

    if (a.length < p + 2) return NaN;

    const ranges = [];

    for (let i = 1; i < a.length; i++) {
      ranges.push(Math.max(
        a[i].high - a[i].low,
        Math.abs(
          a[i].high - a[i - 1].close
        ),
        Math.abs(
          a[i].low - a[i - 1].close
        )
      ));
    }

    let v = ranges.slice(0, p).reduce(
      (s, n) => s + n,
      0
    ) / p;

    for (let i = p; i < ranges.length; i++) {
      v = (
        v * (p - 1) + ranges[i]
      ) / p;
    }

    return v;
  }

  function createPlan(
    s,
    side,
    one,
    five,
    rule
  ) {
    const a = one.slice(0, -1);
    const b = five.slice(0, -1);

    if (
      a.length < 30 ||
      b.length < 20
    ) return null;

    const latest = a.at(-1);

    if (
      Math.floor(now() / 1000) -
      latest.time > 240
    ) return null;

    const tick = rule.tick;
    const volatility = atr(five);

    if (
      !Number.isFinite(volatility) ||
      volatility <= tick
    ) return null;

    const recent = a.slice(-6);
    const oneSwing = a.slice(-12);
    const fiveSwing = b.slice(-4);

    const high = Math.max(
      ...recent.map(x => x.high)
    );

    const low = Math.min(
      ...recent.map(x => x.low)
    );

    const entry = side === "LONG"
      ? round(
          high + tick,
          rule,
          "up"
        )
      : round(
          low - tick,
          rule,
          "down"
        );

    const swingLow = Math.min(
      ...oneSwing.map(x => x.low),
      ...fiveSwing.map(x => x.low)
    );

    const swingHigh = Math.max(
      ...oneSwing.map(x => x.high),
      ...fiveSwing.map(x => x.high)
    );

    const stop = side === "LONG"
      ? round(
          Math.min(
            swingLow,
            entry - 0.85 * volatility
          ) - tick,
          rule,
          "down"
        )
      : round(
          Math.max(
            swingHigh,
            entry + 0.85 * volatility
          ) + tick,
          rule,
          "up"
        );

    const risk = Math.abs(entry - stop);
    const percent = 100 * risk / entry;

    if (
      risk < 3 * tick ||
      percent < 0.015 ||
      percent > 2.5
    ) return null;

    const tp1 = round(
      entry +
      (side === "LONG" ? 1 : -1) *
      risk * 1.5,
      rule,
      side === "LONG" ? "up" : "down"
    );

    const tp2 = round(
      entry +
      (side === "LONG" ? 1 : -1) *
      risk * 2.5,
      rule,
      side === "LONG" ? "up" : "down"
    );

    if (
      [entry, stop, tp1, tp2].some(
        x => !Number.isFinite(x) || x <= 0
      )
    ) return null;

    return {
      s,
      side,
      entry,
      stop,
      tp1,
      tp2,
      rule,
      percent,
      risk,
      status: "ESPERAR ENTRADA",
      started: latest.time,
      checked: latest.time,
      createdAt: now()
    };
  }

  function updatePlan(plan, one) {
    const terminal = [
      "EXPIRADA",
      "STOP TOCADO",
      "TP2 TOCADO",
      "SECUENCIA INCIERTA",
      "INVALIDADA"
    ];

    if (terminal.includes(plan.status)) {
      return;
    }

    const last = one.at(-1)?.time ?? 0;
    const long = plan.side === "LONG";

    for (
      const candle of one.filter(
        x => x.time > plan.checked
      )
    ) {
      const trigger = long
        ? candle.high >= plan.entry
        : candle.low <= plan.entry;

      const stop = long
        ? candle.low <= plan.stop
        : candle.high >= plan.stop;

      const target1 = long
        ? candle.high >= plan.tp1
        : candle.low <= plan.tp1;

      const target2 = long
        ? candle.high >= plan.tp2
        : candle.low <= plan.tp2;

      if (plan.status === "ESPERAR ENTRADA") {
        if (trigger && stop) {
          plan.status = "SECUENCIA INCIERTA";
          break;
        }

        if (stop && !trigger) {
          plan.status = "INVALIDADA";
          break;
        }

        if (trigger) {
          plan.status = "NIVEL TOCADO";
        } else if (
          candle.time - plan.started >= 180
        ) {
          plan.status = "EXPIRADA";
          break;
        }
      }

      if (
        plan.status === "NIVEL TOCADO" ||
        plan.status === "TP1 TOCADO"
      ) {
        if (stop && target2) {
          plan.status = "SECUENCIA INCIERTA";
          break;
        }

        if (stop) {
          plan.status = "STOP TOCADO";
          break;
        }

        if (target2) {
          plan.status = "TP2 TOCADO";
          break;
        }

        if (target1) {
          plan.status = "TP1 TOCADO";
        }
      }

      if (candle.time < last) {
        plan.checked = candle.time;
      }
    }
  }

  function readSignals() {
    const body = $("clScanBody");

    if (!body) return [];

    const exchange = (
      $("exchange")?.value || "bingx"
    ).toLowerCase();

    const market = (
      $("market")?.value || "perpetual"
    );

    const result = [];

    for (
      const row of body.querySelectorAll(
        ":scope > tr"
      )
    ) {
      if (row.dataset.tradeplanRow) {
        continue;
      }

      const cols = [...row.children];

      if (
        cols.length < 6 ||
        !/^\d+$/.test(
          cols[0].textContent.trim()
        )
      ) continue;

      const label =
        cols[1].textContent.trim();

      const gold = label.includes("GOLD");

      result.push({
        label,
        side: cols[2].textContent.trim(),
        state: cols[4].textContent.trim(),
        score: Number(
          cols[3].textContent.split("/")[0]
        ),
        s: {
          symbol: normSymbol(label),
          exchange: gold
            ? "bingx"
            : exchange,
          market: gold
            ? "perpetual"
            : market
        },
        row
      });
    }

    return result;
  }

  function addDetails(signals) {
    const body = $("clScanBody");

    if (!body) return;

    observer?.disconnect();

    body.querySelectorAll(
      "[data-tradeplan-row]"
    ).forEach(el => el.remove());

    for (const signal of signals) {
      const plan = plans.get(
        keyOf(signal.s)
      );

      const tr =
        document.createElement("tr");

      tr.dataset.tradeplanRow = "true";

      const cell =
        document.createElement("td");

      cell.colSpan = 6;

      cell.style.cssText =
        "padding:6px 9px 15px;" +
        "border-bottom:1px solid #243756;" +
        "background:#101a30;";

      const info =
        document.createElement("div");

      info.style.cssText =
        "color:#bfcde9;" +
        "font-size:12px;" +
        "line-height:1.75;" +
        "white-space:normal;";

      if (plan) {
        const price = x => fmt(
          x,
          plan.rule
        );

        const precision = plan.rule.verified
          ? "✓ Tick verificado: " +
            price(plan.rule.tick)
          : "⚠ Precisión estimada: " +
            "verificar tick en el exchange";

        info.textContent =
          "🎯 " + plan.status +
          " · Entrada " + price(plan.entry) +
          " · STOP " + price(plan.stop) +
          " · TP1 " + price(plan.tp1) +
          " · TP2 " + price(plan.tp2) +
          " · Riesgo " +
          plan.percent.toFixed(2) + "%" +
          " · TP1 = 1.5R" +
          " · TP2 = 2.5R" +
          " · " + precision;

      } else {
        info.textContent =
          signal.state === "CONFIRMADA"
            ? "Sin nivel operativo válido: " +
              "estructura, volatilidad o " +
              "datos insuficientes."
            : "Esperando confirmación para " +
              "calcular entrada, stop y objetivos.";
      }

      cell.appendChild(info);
      tr.appendChild(cell);
      signal.row.after(tr);
    }

    observer?.observe(body, {
      childList: true
    });
  }

  function notifyTouched(plan) {
    if (
      !plan.rule.verified ||
      plan.status !== "NIVEL TOCADO" ||
      !("Notification" in window) ||
      Notification.permission !== "granted"
    ) return;

    const key =
      keyOf(plan.s) + "|" +
      plan.side + "|" +
      plan.started + "|toque";

    if (alerts.has(key)) return;

    alerts.add(key);

    try {
      new Notification(
        "CRYPTOLEXUZ · Nivel " +
        plan.side + " tocado",
        {
          body:
            plan.s.symbol +
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

    } catch (error) {
      console.warn(
        "Aviso no disponible:",
        error.message
      );
    }
  }

  async function run() {
    if (document.hidden) return;

    if (running) {
      queued = true;
      return;
    }

    const signals = readSignals();

    if (!signals.length) return;

    running = true;
    queued = false;

    try {
      for (const signal of signals) {
        const active = plans.get(
          keyOf(signal.s)
        );

        if (
          active &&
          signal.state !== "CONFIRMADA" &&
          active.status === "ESPERAR ENTRADA"
        ) {
          active.status = "INVALIDADA";
        }
      }

      const candidates = signals.filter(
        x =>
          x.state === "CONFIRMADA" &&
          x.score >= 65 &&
          ["LONG", "SHORT"].includes(x.side)
      );

      let i = 0;

      async function worker() {
        while (i < candidates.length) {
          const item = candidates[i++];
          const key = keyOf(item.s);

          try {
            const [oneRaw, fiveRaw] =
              await Promise.all([
                json(url(item.s, "1m")),
                json(url(item.s, "5m"))
              ]);

            const one = normalize(oneRaw);
            const five = normalize(fiveRaw);

            if (
              one.length < 35 ||
              five.length < 25
            ) continue;

            const existing = plans.get(key);

            if (
              existing &&
              existing.side === item.side
            ) {
              updatePlan(existing, one);

              const terminal = [
                "EXPIRADA",
                "INVALIDADA",
                "STOP TOCADO",
                "TP2 TOCADO",
                "SECUENCIA INCIERTA"
              ];

              if (
                !terminal.includes(existing.status)
              ) {
                notifyTouched(existing);
                continue;
              }

              if (
                now() - existing.createdAt <
                180000
              ) continue;
            }

            const rule = await ruleFor(
              item.s,
              one
            );

            const plan = createPlan(
              item.s,
              item.side,
              one,
              five,
              rule
            );

            if (plan) {
              plans.set(key, plan);
              updatePlan(plan, one);
              notifyTouched(plan);
            }

          } catch (error) {
            console.warn(
              "Niveles " + item.label,
              error.message
            );
          }
        }
      }

      await Promise.all([
        worker(),
        worker()
      ]);

      addDetails(readSignals());

    } finally {
      running = false;

      if (queued) {
        setTimeout(run, 200);
      }
    }
  }

  function init() {
    const body = $("clScanBody");

    if (!body) {
      setTimeout(init, 500);
      return;
    }

    observer = new MutationObserver(
      records => {
        const changed = records.some(
          record =>
            [...record.addedNodes].some(
              node =>
                node.nodeType === 1 &&
                !node.dataset?.tradeplanRow
            )
        );

        if (changed) {
          run();
        }
      }
    );

    observer.observe(body, {
      childList: true
    });

    run();
  }

  if (document.readyState === "loading") {
    document.addEventListener(
      "DOMContentLoaded",
      init
    );
  } else {
    init();
  }
})();
