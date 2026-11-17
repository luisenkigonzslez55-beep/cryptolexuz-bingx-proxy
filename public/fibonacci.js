
/* CRYPTOLEXUZ PRO — FIBONACCI V1
   Herramienta independiente y configurable.
   No ejecuta órdenes ni altera las señales.
*/
(function () {
  "use strict";

  const DEFAULT_LEVELS = [
    0, 0.236, 0.382, 0.5, 0.618,
    0.65, 0.705, 0.786, 0.88, 1,
    1.272, 1.618, 2, 2.618, 3.618, 4.236
  ];

  const STORAGE_KEY = "cryptolexuz_fibonacci_v1";

  const defaults = {
    enabled: false,
    reverse: false,
    showLabels: true,
    showBox: true,
    boxUpper: 0.7362,
    boxLower: 0.6935,
    boxMiddle: 0.7148,
    lineWidth: 1,
    color: "#a855f7",
    boxColor: "#16a34a",
    levels: DEFAULT_LEVELS.map(value => ({
      value,
      visible: true,
      color: [0.618, 0.786, 0.88, 1.618].includes(value)
        ? "#22c55e"
        : "#a855f7"
    }))
  };

  function load() {
    try {
      const saved = JSON.parse(
        localStorage.getItem(STORAGE_KEY)
      );
      if (!saved) return structuredClone(defaults);

      return {
        ...structuredClone(defaults),
        ...saved,
        levels: Array.isArray(saved.levels)
          ? saved.levels
          : structuredClone(defaults.levels)
      };
    } catch {
      return structuredClone(defaults);
    }
  }

  let settings = load();
  const drawings = new Map();

  function save() {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify(settings)
      );
    } catch (error) {
      console.warn("Fibonacci: no se pudo guardar", error);
    }
  }

  function key(symbol, timeframe) {
    return `${symbol || "BTC-USDT"}:${timeframe || "15m"}`;
  }

  function setAnchors(symbol, timeframe, first, second) {
    if (![first, second].every(Number.isFinite)) {
      throw new Error("Los extremos deben ser precios válidos");
    }

    if (first === second) {
      throw new Error("Los extremos deben ser diferentes");
    }

    const id = key(symbol, timeframe);
    const drawing = {
      first,
      second,
      updatedAt: Date.now()
    };

    drawings.set(id, drawing);

    try {
      localStorage.setItem(
        "cryptolexuz_fib_" + id,
        JSON.stringify(drawing)
      );
    } catch {}

    return drawing;
  }

  function getAnchors(symbol, timeframe) {
    const id = key(symbol, timeframe);

    if (drawings.has(id)) {
      return drawings.get(id);
    }

    try {
      const saved = JSON.parse(
        localStorage.getItem("cryptolexuz_fib_" + id)
      );

      if (
        saved &&
        Number.isFinite(saved.first) &&
        Number.isFinite(saved.second)
      ) {
        drawings.set(id, saved);
        return saved;
      }
    } catch {}

    return null;
  }

  function priceAt(first, second, ratio) {
    return first + (second - first) * ratio;
  }

  function calculate(symbol, timeframe) {
    const anchors = getAnchors(symbol, timeframe);
    if (!anchors) return null;

    const first = settings.reverse
      ? anchors.second
      : anchors.first;

    const second = settings.reverse
      ? anchors.first
      : anchors.second;

    return {
      anchors,
      levels: settings.levels
        .filter(level => level.visible)
        .map(level => ({
          ...level,
          price: priceAt(first, second, level.value)
        })),
      box: settings.showBox
        ? {
            upper: settings.boxUpper,
            middle: settings.boxMiddle,
            lower: settings.boxLower
          }
        : null
    };
  }

  function updateSettings(changes) {
    settings = { ...settings, ...changes };
    save();
    return getSettings();
  }

  function getSettings() {
    return structuredClone(settings);
  }

  function setLevel(value, changes) {
    value = Number(value);

    if (!Number.isFinite(value)) {
      throw new Error("Nivel inválido");
    }

    const index = settings.levels.findIndex(
      level => level.value === value
    );

    if (index >= 0) {
      settings.levels[index] = {
        ...settings.levels[index],
        ...changes
      };
    } else {
      settings.levels.push({
        value,
        visible: true,
        color: settings.color,
        ...changes
      });
    }

    settings.levels.sort((a, b) => a.value - b.value);
    save();
    return getSettings();
  }

  function removeLevel(value) {
    settings.levels = settings.levels.filter(
      level => level.value !== Number(value)
    );
    save();
  }

  function reset() {
    settings = structuredClone(defaults);
    save();
    return getSettings();
  }

  window.CryptolexuzFibonacci = {
    getSettings,
    updateSettings,
    setAnchors,
    getAnchors,
    calculate,
    setLevel,
    removeLevel,
    reset,
    priceAt
  };

  console.info("CRYPTOLEXUZ Fibonacci V1 preparado");
})();

