
/*
 CRYPTOLEXUZ PRO — TRADE PLANS V4
 Filtro de estructura, ruptura, retesteo y volumen.
 Auditoría con velas cerradas de un minuto.
 No ejecuta órdenes reales.
*/
"use strict";

(() => {
  const $ = id => document.getElementById(id);

  const GOLD = "NCCOGOLD2USD-USDT";
  const OIL = "NCCO1OILWTI2USD-USDT";

  const KEY = "cryptolexuz.trade-audit.v4";
  const MAX_LOG = 250;
  const WAIT_SECONDS = 8 * 60;
  const TRACK_SECONDS = 2 * 60 * 60;

  const cache = new Map();
  const precisionCache = new Map();

  let history = [];
  let storageAvailable = true;
  let busy = false;
  let rerun = false;
  let recheckTimer = null;
  let contractsPromise = null;
  let contractsAt = 0;

  const finalStates = new Set([
    "NO ACTIVADA",
    "INVALIDADA",
    "STOP ANTES DE TP1",
    "TP2 ALCANZADO",
    "TP1 Y STOP",
    "SIN VERIFICAR",
    "SECUENCIA AMBIGUA",
    "SEGUIMIENTO FINALIZADO"
  ]);

  function validRecord(x) {
    return (
      x &&
      typeof x.id === "string" &&
      typeof x.symbol === "string" &&
      ["LONG", "SHORT"].includes(x.side) &&
      Number.isFinite(x.createdAt) &&
      [x.entry, x.stop, x.tp1, x.tp2]
        .every(Number.isFinite)
    );
  }

  function load() {
    try {
      const parsed = JSON.parse(
        localStorage.getItem(KEY) || "[]"
      );

      history = Array.isArray(parsed)
        ? parsed.filter(validRecord).slice(0, MAX_LOG)
        : [];

    } catch (_) {
      history = [];
      storageAvailable = false;
    }
  }

  function save() {
    try {
      localStorage.setItem(
        KEY,
        JSON.stringify(history.slice(0, MAX_LOG))
      );

    } catch (_) {
      storageAvailable = false;
    }
  }

  const n = v =>
    v === null || v === undefined || v === ""
      ? NaN
      : Number(v);

  const now = () =>
    Math.floor(Date.now() / 1000);

  function norm(raw) {
    let arr = Array.isArray(raw)
      ? raw
      : raw?.data?.data ??
        raw?.data?.list ??
        raw?.data?.candles ??
        raw?.data ??
        raw?.list ??
        [];

    if (!Array.isArray(arr)) return [];

    const out = [];

    for (const c of arr) {
      if (!c || typeof c !== "object") continue;

      const a = Array.isArray(c);

      let t = a
        ? c[0]
        : c.time ??
          c.timestamp ??
          c.openTime ??
          c.t;

      t = typeof t === "string" &&
        !/^\d+$/.test(t)
        ? Date.parse(t)
        : Number(t);

      t = t > 1e12
        ? Math.floor(t / 1000)
        : Math.floor(t);

      const open = n(
        a ? c[1] : c.open ?? c.o
      );

      const high = n(
        a ? c[2] : c.high ?? c.h
      );

      const low = n(
        a ? c[3] : c.low ?? c.l
      );

      const close = n(
        a ? c[4] : c.close ?? c.c
      );

      const volume = n(
        a ? c[5] :
          c.volume ?? c.vol ?? c.v ?? 0
      );

      if (
        ![
          t, open, high, low, close, volume
        ].every(Number.isFinite) ||
        t <= 0 ||
        t > now() + 60 ||
        Math.min(open, high, low, close) <= 0 ||
        volume < 0 ||
        high < Math.max(open, close) ||
        low > Math.min(open, close)
      ) {
        continue;
      }

      out.push({
        time: t,
        open,
        high,
        low,
        close,
        volume
      });
    }

    out.sort((a, b) => a.time - b.time);

    return [
      ...new Map(
        out.map(c => [c.time, c])
      ).values()
    ];
  }

  async function json(url, timeout = 11000) {
    const controller = new AbortController();

    const timer = setTimeout(
      () => controller.abort(),
      timeout
    );

    try {
      const res = await fetch(url, {
        cache: "no-store",
        signal: controller.signal
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
          String(data.msg || "API no disponible")
        );
      }

      return data;

    } finally {
      clearTimeout(timer);
    }
  }

  const marketId = x => [
    x.exchange,
    x.market,
    x.symbol
  ].join("|");

  async function candles(x, tf) {
    const key = marketId(x) + "|" + tf;

    const ttl = tf === "1m"
      ? 30000
      : 70000;

    const old = cache.get(key);

    if (
      old &&
      Date.now() - old.at < ttl
    ) {
      return old.data;
    }

    const url =
      "/api/exchange/" +
      encodeURIComponent(x.exchange) +
      "/klines/" +
      encodeURIComponent(x.symbol) +
      "?market=" +
      encodeURIComponent(x.market) +
      "&interval=" + tf +
      "&limit=300";

    const arr = norm(
      await json(url)
    );

    if (arr.length < 65) {
      throw Error(
        "faltan velas de " + tf
      );
    }

    cache.set(key, {
      at: Date.now(),
      data: arr
    });

    return arr;
  }

  function scanSignals() {
    const tbody = $("clScanBody");

    if (!tbody) return [];

    const exchange = (
      $("exchange")?.value || "bingx"
    ).toLowerCase();

    const market =
      $("market")?.value || "perpetual";

    const results = [];

    for (
      const row of tbody.querySelectorAll(
        ":scope > tr"
      )
    ) {
      if (row.dataset.tradeplanRow) {
        continue;
      }

      const c = [...row.children];

      if (
        c.length < 6 ||
        !/^\d+$/.test(
          c[0].textContent.trim()
        )
      ) {
        continue;
      }

      const label =
        c[1].textContent.trim();

      const isGold =
        label.includes("GOLD");

      const isOil =
        label.includes("OIL WTI");

      const special =
        isGold || isOil;

      results.push({
        label,

        side:
          c[2].textContent.trim(),

        score: Number(
          c[3].textContent.split("/")[0]
        ),

        state:
          c[4].textContent.trim(),

        exchange: special
          ? "bingx"
          : exchange,

        market: special
          ? "perpetual"
          : market,

        symbol: isGold
          ? GOLD
          : isOil
            ? OIL
            : label.replace("/", "-")
      });
    }

    return results;
  }

  function ema(values, length) {
    if (values.length < length) {
      return NaN;
    }

    let v = values
      .slice(0, length)
      .reduce((a, b) => a + b, 0) /
      length;

    for (
      let i = length;
      i < values.length;
      i++
    ) {
      v =
        values[i] * 2 / (length + 1) +
        v * (length - 1) / (length + 1);
    }

    return v;
  }

  function ma(values, length) {
    if (values.length < length) {
      return NaN;
    }

    return values
      .slice(-length)
      .reduce((a, b) => a + b, 0) /
      length;
  }

  function atr(c, period = 14) {
    if (c.length < period + 2) {
      return NaN;
    }

    const ranges = [];

    for (let i = 1; i < c.length; i++) {
      ranges.push(
        Math.max(
          c[i].high - c[i].low,
          Math.abs(
            c[i].high - c[i - 1].close
          ),
          Math.abs(
            c[i].low - c[i - 1].close
          )
        )
      );
    }

    return ma(ranges, period);
  }

  function tickGuess(c) {
    let dec = 2;

    for (const x of c.slice(-40)) {
      for (const p of [
        x.open,
        x.high,
        x.low,
        x.close
      ]) {
        const str = Number(p)
          .toFixed(8)
          .replace(/0+$/, "");

        dec = Math.max(
          dec,
          (str.split(".")[1] || "").length
        );
      }
    }

    dec = Math.min(dec, 8);

    return {
      tick: 10 ** -dec,
      decimals: dec,
      verified: false
    };
  }

  function bingxContracts() {
    if (
      !contractsPromise ||
      Date.now() - contractsAt >
        15 * 60000
    ) {
      contractsAt = Date.now();

      contractsPromise = json(
        "https://open-api.bingx.com/openApi/swap/v2/quote/contracts",
        7000
      ).catch(() => ({
        data: []
      }));
    }

    return contractsPromise;
  }

  async function rule(x, c) {
    const k = marketId(x);
    const old = precisionCache.get(k);

    if (
      old &&
      Date.now() - old.at <
        15 * 60000
    ) {
      return old.rule;
    }

    let result = tickGuess(c);

    try {
      if (
        x.exchange === "bingx" &&
        x.market === "perpetual"
      ) {
        const data =
          await bingxContracts();

        const list = Array.isArray(
          data.data
        ) ? data.data : [];

        const contract = list.find(
          z => z.symbol === x.symbol
        );

        const tick = Number(
          contract?.tickSize ??
          contract?.priceStep
        );

        const precision = Number(
          contract?.pricePrecision
        );

        if (
          Number.isFinite(tick) &&
          tick > 0
        ) {
          const txt = String(tick);

          const dec = txt.includes("e-")
            ? Number(
                txt.split("e-")[1]
              )
            : (
                txt.split(".")[1] || ""
              ).length;

          result = {
            tick,
            decimals: Math.min(10, dec),
            verified: true
          };

        } else if (
          contract &&
          Number.isInteger(precision) &&
          precision >= 0 &&
          precision <= 10
        ) {
          result = {
            tick: 10 ** -precision,
            decimals: precision,
            verified: false
          };
        }
      }

    } catch (_) {
      // Si no responde, usar
      // precisión estimada.
    }

    precisionCache.set(k, {
      at: Date.now(),
      rule: result
    });

    return result;
  }

  function round(p, r, method = "round") {
    const v = p / r.tick;

    const units = method === "up"
      ? Math.ceil(v - 1e-8)
      : method === "down"
        ? Math.floor(v + 1e-8)
        : Math.round(v);

    return Number(
      (units * r.tick).toFixed(
        r.decimals
      )
    );
  }

  function price(v, digits = 2) {
    return Number(v).toLocaleString(
      "en-US",
      {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits
      }
    );
  }

  function pivots(c) {
    const out = [];

    for (
      let i = 3;
      i < c.length - 3;
      i++
    ) {
      const around = c.slice(
        i - 3,
        i + 4
      );

      if (
        around.every(
          (x, j) =>
            j === 3 ||
            x.high < c[i].high
        )
      ) {
        out.push({
          type: "high",
          p: c[i].high
        });
      }

      if (
        around.every(
          (x, j) =>
            j === 3 ||
            x.low > c[i].low
        )
      ) {
        out.push({
          type: "low",
          p: c[i].low
        });
      }
    }

    return out;
  }

  // FILTRO DE CALIDAD

  function validateSetup(
    x, a1, a5, a15, r
  ) {
    // No utilizar la vela actual.
    const c1 = a1.slice(0, -1);
    const c5 = a5.slice(0, -1);
    const c15 = a15.slice(0, -1);

    if (
      c1.length < 60 ||
      c5.length < 65 ||
      c15.length < 65
    ) {
      return {
        reason: "Historial incompleto"
      };
    }

    const long =
      x.side === "LONG";

    const five =
      c5.map(z => z.close);

    const fifteen =
      c15.map(z => z.close);

    const e5 = ema(five, 21);
    const m5 = ma(five, 55);

    const e15 = ema(fifteen, 21);
    const m15 = ma(fifteen, 55);

    const aligned = long
      ? five.at(-1) > e5 &&
        e5 > m5 &&
        fifteen.at(-1) > e15 &&
        e15 > m15
      : five.at(-1) < e5 &&
        e5 < m5 &&
        fifteen.at(-1) < e15 &&
        e15 < m15;

    if (!aligned) {
      return {
        reason:
          "Tendencia de 5 y 15 minutos sin alinear"
      };
    }

    const volatility = atr(c1);

    if (
      !Number.isFinite(volatility) ||
      volatility < r.tick
    ) {
      return {
        reason: "Volatilidad insuficiente"
      };
    }

    const last = c1.at(-1);
    const age = now() - last.time;

    if (age > 200) {
      return {
        reason:
          "Velas de 1 minuto desactualizadas"
      };
    }

    let setup = null;

    // Ruptura reciente y retesteo
    // en la última vela cerrada.

    for (
      let back = 1;
      back <= 3;
      back++
    ) {
      const idx =
        c1.length - 1 - back;

      if (idx < 25) continue;

      const breakout = c1[idx];

      const previous = c1.slice(
        idx - 10,
        idx
      );

      const level = long
        ? Math.max(
            ...previous.map(z => z.high)
          )
        : Math.min(
            ...previous.map(z => z.low)
          );

      const twenty = c1.slice(
        idx - 20,
        idx
      );

      const avgv = twenty.reduce(
        (sum, z) => sum + z.volume,
        0
      ) / twenty.length;

      const volOk =
        avgv > 0 &&
        breakout.volume >= avgv * 1.3;

      const broke = long
        ? breakout.close >
          level + .04 * volatility
        : breakout.close <
          level - .04 * volatility;

      const held = c1
        .slice(idx + 1, -1)
        .every(z => long
          ? z.close >=
            level - .16 * volatility
          : z.close <=
            level + .16 * volatility
        );

      const retest = long
        ? last.low <=
            level + .20 * volatility &&
          last.low >=
            level - .25 * volatility &&
          last.close > level
        : last.high >=
            level - .20 * volatility &&
          last.high <=
            level + .25 * volatility &&
          last.close < level;

      if (
        volOk &&
        broke &&
        held &&
        retest
      ) {
        setup = {
          level,
          candle: last,
          breakTime: breakout.time
        };

        break;
      }
    }

    if (!setup) {
      return {
        reason:
          "Esperando ruptura, retesteo y volumen confirmado"
      };
    }

    const buffer = Math.max(
      r.tick,
      .2 * volatility
    );

    const entry = long
      ? round(
          last.high + r.tick,
          r,
          "up"
        )
      : round(
          last.low - r.tick,
          r,
          "down"
        );

    const recent = c1.slice(-4);

    const stop = long
      ? round(
          Math.min(
            ...recent.map(z => z.low)
          ) - buffer,
          r,
          "down"
        )
      : round(
          Math.max(
            ...recent.map(z => z.high)
          ) + buffer,
          r,
          "up"
        );

    const risk =
      Math.abs(entry - stop);

    const riskPct =
      100 * risk / entry;

    if (
      !Number.isFinite(riskPct) ||
      risk < 3 * r.tick ||
      riskPct < .035 ||
      riskPct > 1.5 ||
      stop <= 0
    ) {
      return {
        reason:
          "Stop o distancia de riesgo no aceptable"
      };
    }

    const tp1 = round(
      entry +
      (long ? 1 : -1) * risk * 1.5,
      r,
      long ? "up" : "down"
    );

    const tp2 = round(
      entry +
      (long ? 1 : -1) * risk * 2.5,
      r,
      long ? "up" : "down"
    );

    if (
      tp1 <= 0 ||
      tp2 <= 0
    ) {
      return {
        reason: "Objetivos no válidos"
      };
    }

    // Revisar barreras estructurales
    // de cinco minutos.

    const levels = pivots(
      c5.slice(-110)
    );

    const barrier = long
      ? levels
          .filter(
            z =>
              z.type === "high" &&
              z.p > entry
          )
          .sort(
            (a, b) => a.p - b.p
          )[0]
      : levels
          .filter(
            z =>
              z.type === "low" &&
              z.p < entry
          )
          .sort(
            (a, b) => b.p - a.p
          )[0];

    if (
      barrier &&
      (
        long
          ? barrier.p < tp1
          : barrier.p > tp1
      )
    ) {
      return {
        reason:
          "Soporte/resistencia bloquea el primer objetivo"
      };
    }

    return {
      plan: {
        id: [
          marketId(x),
          x.side,
          setup.candle.time
        ].join("|"),

        exchange: x.exchange,
        market: x.market,
        symbol: x.symbol,
        label: x.label,
        side: x.side,
        score: x.score,

        entry,
        stop,
        tp1,
        tp2,
        riskPct,

        decimals: r.decimals,
        verifiedTick: r.verified,

        createdAt: Date.now(),
        createdTime: setup.candle.time,
        lastChecked: setup.candle.time,

        status: "ESPERAR ACTIVACIÓN",
        activatedAt: null,

        tp1Hit: false,
        tp2Hit: false,
        stopBeforeTP1: false
      }
    };
  }

  // SEGUIMIENTO DE ENTRADAS

  function follow(p, arr) {
    if (
      finalStates.has(p.status)
    ) {
      return false;
    }

    const closed =
      arr.slice(0, -1);

    if (!closed.length) {
      return false;
    }

    const oldest =
      closed[0].time;

    if (
      oldest > p.lastChecked + 70
    ) {
      p.status = "SIN VERIFICAR";
      return true;
    }

    const fresh = closed.filter(
      c => c.time > p.lastChecked
    );

    let changed = false;

    for (const c of fresh) {
      if (
        c.time > p.lastChecked + 90
      ) {
        p.status = "SIN VERIFICAR";
        changed = true;
        break;
      }

      const long =
        p.side === "LONG";

      const entry = long
        ? c.high >= p.entry
        : c.low <= p.entry;

      const stop = long
        ? c.low <= p.stop
        : c.high >= p.stop;

      const tp1 = long
        ? c.high >= p.tp1
        : c.low <= p.tp1;

      const tp2 = long
        ? c.high >= p.tp2
        : c.low <= p.tp2;

      if (
        p.status ===
        "ESPERAR ACTIVACIÓN"
      ) {
        if (
          entry &&
          (stop || tp1 || tp2)
        ) {
          p.status =
            "SECUENCIA AMBIGUA";

        } else if (entry) {
          p.status = "ACTIVADA";
          p.activatedAt = c.time;

        } else if (stop) {
          p.status = "INVALIDADA";

        } else if (
          c.time - p.createdTime >=
          WAIT_SECONDS
        ) {
          p.status = "NO ACTIVADA";
        }

      } else if (
        p.status === "ACTIVADA"
      ) {
        if (
          stop &&
          (tp1 || tp2)
        ) {
          p.status =
            "SECUENCIA AMBIGUA";

        } else if (stop) {
          p.status =
            "STOP ANTES DE TP1";

          p.stopBeforeTP1 = true;

        } else if (tp2) {
          p.tp1Hit = true;
          p.tp2Hit = true;

          p.status =
            "TP2 ALCANZADO";

        } else if (tp1) {
          p.tp1Hit = true;

          p.status =
            "TP1 ALCANZADO";
        }

      } else if (
        p.status ===
        "TP1 ALCANZADO"
      ) {
        if (tp2 && stop) {
          p.status =
            "SEGUIMIENTO FINALIZADO";

        } else if (tp2) {
          p.tp2Hit = true;

          p.status =
            "TP2 ALCANZADO";

        } else if (stop) {
          p.status =
            "TP1 Y STOP";
        }
      }

      p.lastChecked = c.time;
      changed = true;

      if (
        finalStates.has(p.status)
      ) {
        break;
      }

      if (
        c.time - p.createdTime >=
        TRACK_SECONDS &&
        p.status !==
        "ESPERAR ACTIVACIÓN"
      ) {
        p.status =
          "SEGUIMIENTO FINALIZADO";

        break;
      }
    }

    return changed;
  }

  function addRecord(p) {
    if (
      history.some(
        z => z.id === p.id
      )
    ) {
      return false;
    }

    if (
      history.some(
        z =>
          marketId(z) === marketId(p) &&
          z.side === p.side &&
          !finalStates.has(z.status)
      )
    ) {
      return false;
    }

    const prev = history.find(
      z =>
        marketId(z) === marketId(p) &&
        z.side === p.side
    );

    if (
      prev &&
      p.createdAt - prev.createdAt <
        12 * 60000
    ) {
      return false;
    }

    history.unshift(p);

    if (history.length > MAX_LOG) {
      history.length = MAX_LOG;
    }

    save();

    return true;
  }

  function metrics() {
    const successes = history.filter(
      x => x.tp1Hit
    ).length;

    const losses = history.filter(
      x => x.stopBeforeTP1
    ).length;

    const decided =
      successes + losses;

    return {
      successes,
      losses,
      decided,

      activated: history.filter(
        x => x.activatedAt !== null
      ).length,

      untriggered: history.filter(
        x => [
          "NO ACTIVADA",
          "INVALIDADA"
        ].includes(x.status)
      ).length,

      uncertain: history.filter(
        x => [
          "SIN VERIFICAR",
          "SECUENCIA AMBIGUA"
        ].includes(x.status)
      ).length,

      tp2: history.filter(
        x => x.tp2Hit
      ).length,

      rate: decided
        ? (
            100 * successes / decided
          ).toFixed(1) + "%"
        : "Sin muestra"
    };
  }

  // INTERFAZ

  function node(
    tag,
    cls,
    content
  ) {
    const el =
      document.createElement(tag);

    if (cls) {
      el.className = cls;
    }

    if (content !== undefined) {
      el.textContent =
        String(content);
    }

    return el;
  }

  function ui() {
    let root = $("clAuditV4");

    if (root) return root;

    const scanner =
      $("clScanner");

    if (!scanner) return null;

    root = node(
      "section",
      "cl-audit"
    );

    root.id = "clAuditV4";

    root.appendChild(
      node(
        "h3",
        "",
        "🎯 Entradas validadas · V4"
      )
    );

    root.appendChild(
      node(
        "p",
        "cl-small",
        "CONFIRMADA en el ranking significa coincidencia de indicadores, no una orden. Aquí exigimos ruptura, retesteo, volumen y espacio hasta soporte o resistencia."
      )
    );

    const cards = node(
      "div",
      "cl-cards"
    );

    cards.id = "clAuditCards";
    root.appendChild(cards);

    root.appendChild(
      node(
        "h3",
        "",
        "📊 Auditoría de señales"
      )
    );

    root.appendChild(
      node(
        "p",
        "cl-small",
        "Se mide TP1 antes del stop o stop antes de TP1. Las entradas no activadas y las velas ambiguas no se cuentan como pérdidas."
      )
    );

    const stats = node(
      "div",
      "cl-stats"
    );

    stats.id = "clAuditStats";
    root.appendChild(stats);

    const status = node(
      "p",
      "cl-small"
    );

    status.id = "clAuditStorage";
    root.appendChild(status);

    const detail = node(
      "div",
      "cl-log"
    );

    detail.id = "clAuditLog";
    root.appendChild(detail);

    scanner.appendChild(root);

    if (!$("clAuditStyle")) {
      const style = node("style");
      style.id = "clAuditStyle";

      style.textContent = `
        .cl-audit {
          border-top:1px solid #334463;
          margin-top:20px;
          padding-top:14px;
          color:#dce6ff;
        }

        .cl-audit h3 {
          font-size:16px;
          margin:8px 0;
        }

        .cl-small {
          color:#a8b5d4;
          font-size:12px;
          line-height:1.55;
          margin:5px 0 13px;
        }

        .cl-cards {
          display:grid;
          gap:12px;
        }

        .cl-card {
          background:#101d36;
          border:1px solid #334463;
          border-radius:13px;
          padding:13px;
          min-width:0;
        }

        .cl-head {
          display:flex;
          justify-content:space-between;
          gap:8px;
          flex-wrap:wrap;
          font-weight:700;
          margin-bottom:9px;
        }

        .cl-note {
          font-size:12px;
          color:#ffc971;
          line-height:1.5;
          margin:5px 0;
        }

        .cl-prices {
          display:grid;
          grid-template-columns:
            repeat(2,minmax(0,1fr));
          gap:8px;
          margin-top:10px;
        }

        .cl-price {
          background:#0b1429;
          border:1px solid #293b58;
          border-radius:9px;
          padding:10px;
          min-width:0;
        }

        .cl-price small {
          display:block;
          color:#9eafcc;
          font-size:11px;
        }

        .cl-price strong {
          display:block;
          color:#e7eeff;
          font-size:clamp(13px,3.4vw,17px);
          overflow-wrap:anywhere;
        }

        .cl-stats {
          display:grid;
          grid-template-columns:
            repeat(2,minmax(0,1fr));
          gap:8px;
        }

        .cl-stat {
          border:1px solid #304467;
          background:#0b1429;
          border-radius:10px;
          padding:12px;
        }

        .cl-stat small {
          display:block;
          font-size:11px;
          color:#a5b4d0;
        }

        .cl-stat strong {
          font-size:19px;
        }

        .cl-log {
          max-height:340px;
          overflow:auto;
          font-size:12px;
        }

        .cl-row {
          padding:9px 3px;
          border-bottom:1px solid #263856;
          line-height:1.6;
        }

        @media(max-width:350px) {
          .cl-prices,
          .cl-stats {
            grid-template-columns:1fr;
          }
        }
      `;

      document.head.appendChild(style);
    }

    return root;
  }

  function render(
    signals,
    reasons = {}
  ) {
    if (!ui()) return;

    const cards =
      $("clAuditCards");

    cards.replaceChildren();

    const candidates = signals.filter(
      s =>
        s.state === "CONFIRMADA" &&
        s.score >= 65 &&
        ["LONG", "SHORT"].includes(
          s.side
        )
    );

    if (!candidates.length) {
      cards.appendChild(
        node(
          "div",
          "cl-card cl-small",
          "Sin configuraciones técnicas candidatas por ahora. Esperando la siguiente revisión."
        )
      );
    }

    for (const s of candidates) {
      const card = node(
        "article",
        "cl-card"
      );

      const header = node(
        "div",
        "cl-head"
      );

      header.appendChild(
        node(
          "span",
          "",
          s.label
        )
      );

      header.appendChild(
        node(
          "span",
          "",
          s.side + " · " +
          s.score + "/100"
        )
      );

      card.appendChild(header);

      const record =
        history.find(
          p =>
            marketId(p) === marketId(s) &&
            p.side === s.side &&
            !finalStates.has(p.status)
        ) ||
        history.find(
          p =>
            marketId(p) === marketId(s) &&
            p.side === s.side &&
            Date.now() - p.createdAt <
              12 * 60000
        );

      if (!record) {
        card.appendChild(
          node(
            "div",
            "cl-note",
            reasons[marketId(s)] ||
            "Evaluando ruptura, retesteo y confirmaciones…"
          )
        );

      } else {
        card.appendChild(
          node(
            "div",
            "cl-note",
            "Estado: " + record.status
          )
        );

        const grid = node(
          "div",
          "cl-prices"
        );

        for (const [label, amount] of [
          ["🎯 Entrada", record.entry],
          ["🛑 Stop Loss", record.stop],
          ["✅ TP1 · 1.5R", record.tp1],
          ["✅ TP2 · 2.5R", record.tp2]
        ]) {
          const box = node(
            "div",
            "cl-price"
          );

          box.appendChild(
            node(
              "small",
              "",
              label
            )
          );

          box.appendChild(
            node(
              "strong",
              "",
              price(
                amount,
                record.decimals
              )
            )
          );

          grid.appendChild(box);
        }

        card.appendChild(grid);

        card.appendChild(
          node(
            "p",
            "cl-small",
            "Distancia al stop: " +
            record.riskPct.toFixed(2) +
            "% · " +
            (
              record.verifiedTick
                ? "Tick API verificado"
                : "⚠ Tick estimado; comprobar en BingX"
            ) +
            " · Sin orden real"
          )
        );
      }

      cards.appendChild(card);
    }

    const s = metrics();

    const stats =
      $("clAuditStats");

    stats.replaceChildren();

    const values = [
      ["Efectividad TP1", s.rate],
      ["Casos evaluables", s.decided],
      ["Llegaron a TP1", s.successes],
      ["Stop antes de TP1", s.losses],
      ["Entradas activadas", s.activated],
      ["No activadas / invalidadas", s.untriggered],
      ["TP2 alcanzado", s.tp2],
      ["No verificables / ambiguas", s.uncertain]
    ];

    for (const [label, val] of values) {
      const item = node(
        "div",
        "cl-stat"
      );

      item.appendChild(
        node(
          "small",
          "",
          label
        )
      );

      item.appendChild(
        node(
          "strong",
          "",
          val
        )
      );

      stats.appendChild(item);
    }

    $("clAuditStorage").textContent =
      storageAvailable
        ? "Guardado en este navegador. El seguimiento requiere la página abierta; al regresar se revisan las velas disponibles. No representa órdenes ejecutadas."
        : "⚠ No se puede guardar en este navegador; el registro se perderá al cerrar.";

    const log =
      $("clAuditLog");

    log.replaceChildren();

    for (
      const p of history.slice(0, 35)
    ) {
      const when = new Date(
        p.createdAt
      ).toLocaleString("es-MX");

      log.appendChild(
        node(
          "div",
          "cl-row",
          when + " · " +
          p.label + " · " +
          p.side + " · " +
          p.status +
          (
            p.tp1Hit
              ? " · TP1 logrado"
              : ""
          )
        )
      );
    }

    if (!history.length) {
      log.appendChild(
        node(
          "div",
          "cl-small",
          "Aún no hay señales validadas registradas."
        )
      );
    }
  }

  // MOTOR DE REVISIÓN

  async function process() {
    if (document.hidden) return;

    const signals =
      scanSignals();

    if (!signals.length) return;

    if (busy) {
      rerun = true;
      return;
    }

    busy = true;
    rerun = false;

    const signature = JSON.stringify(
      signals.map(
        s => [
          marketId(s),
          s.side,
          s.state,
          s.score
        ]
      )
    );

    const reasons = {};
    let modified = false;

    try {
      const candidates = signals.filter(
        s =>
          s.state === "CONFIRMADA" &&
          s.score >= 65 &&
          ["LONG", "SHORT"].includes(
            s.side
          )
      );

      const pending = history.filter(
        p => !finalStates.has(p.status)
      );

      const unique = new Map();

      for (const p of pending) {
        unique.set(
          marketId(p),
          p
        );
      }

      for (const s of candidates) {
        unique.set(
          marketId(s),
          s
        );
      }

      const targets = [
        ...unique.values()
      ];

      let index = 0;

      async function worker() {
        while (index < targets.length) {
          const s = targets[index++];

          try {
            const a1 = await candles(
              s,
              "1m"
            );

            for (
              const p of pending.filter(
                p =>
                  marketId(p) ===
                  marketId(s)
              )
            ) {
              if (follow(p, a1)) {
                modified = true;
              }
            }

            const candidate =
              candidates.some(
                c =>
                  marketId(c) ===
                  marketId(s)
              );

            if (!candidate) continue;

            const current = JSON.stringify(
              scanSignals().map(
                q => [
                  marketId(q),
                  q.side,
                  q.state,
                  q.score
                ]
              )
            );

            if (current !== signature) {
              continue;
            }

            const a5 = await candles(
              s,
              "5m"
            );

            const a15 = await candles(
              s,
              "15m"
            );

            const r = await rule(
              s,
              a1
            );

            const currentAfter = JSON.stringify(
              scanSignals().map(
                q => [
                  marketId(q),
                  q.side,
                  q.state,
                  q.score
                ]
              )
            );

            if (
              currentAfter !== signature
            ) {
              continue;
            }

            const result = validateSetup(
              s,
              a1,
              a5,
              a15,
              r
            );

            reasons[marketId(s)] =
              result.reason ||
              "Entrada condicionada a ruptura del máximo o mínimo del retesteo";

            if (
              result.plan &&
              addRecord(result.plan)
            ) {
              modified = true;
            }

          } catch (err) {
            reasons[marketId(s)] =
              "No disponible: " +
              err.message;
          }
        }
      }

      await Promise.all([
        worker(),
        worker()
      ]);

      if (modified) {
        save();
      }

      render(
        scanSignals(),
        reasons
      );

    } finally {
      busy = false;

      if (rerun) {
        rerun = false;

        setTimeout(
          process,
          400
        );
      }
    }
  }

  function init() {
    const body =
      $("clScanBody");

    if (!body) {
      setTimeout(init, 400);
      return;
    }

    load();
    ui();
    render(scanSignals());

    const observer =
      new MutationObserver(() => {
        clearTimeout(recheckTimer);

        recheckTimer = setTimeout(
          process,
          300
        );
      });

    observer.observe(
      body,
      {
        childList: true
      }
    );

    for (const id of [
      "exchange",
      "market"
    ]) {
      $(id)?.addEventListener(
        "change",
        () => setTimeout(
          process,
          400
        )
      );
    }

    document.addEventListener(
      "visibilitychange",
      () => {
        if (!document.hidden) {
          process();
        }
      }
    );

    $("clScanNow")?.addEventListener(
      "click",
      () => setTimeout(
        process,
        300
      )
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
