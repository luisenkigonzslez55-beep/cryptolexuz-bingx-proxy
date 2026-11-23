
/*
  CRYPTOLEXUZ PRO
  Guardado automatico de preferencias
  Version 1
*/
(function () {
  "use strict";

  const KEY = "cryptolexuz-pro-preferencias-v1";

  const IDS = [
    "symbol",
    "interval",
    "market",
    "exchange"
  ];

  const BUTTON_GROUPS = [
    "#indicatorButtons [data-indicator]",
    "#patternButtons [data-pattern]"
  ];

  function read() {
    try {
      return JSON.parse(localStorage.getItem(KEY)) || {};
    } catch (error) {
      console.warn("No se pudo leer la configuracion:", error);
      return {};
    }
  }

  function write(data) {
    try {
      localStorage.setItem(KEY, JSON.stringify(data));
    } catch (error) {
      console.warn("No se pudo guardar la configuracion:", error);
    }
  }

  function update(partial) {
    const current = read();
    write({ ...current, ...partial });
  }

  function getButtonKey(button) {
    return (
      button.dataset.indicator ||
      button.dataset.pattern ||
      button.dataset.clTab ||
      button.id ||
      ""
    );
  }

  function buttonIsActive(button) {
    return (
      button.classList.contains("active") ||
      button.classList.contains("is-active") ||
      button.getAttribute("aria-pressed") === "true"
    );
  }

  function saveControls() {
    const controls = {};

    IDS.forEach(id => {
      const el = document.getElementById(id);
      if (el) controls[id] = el.value;
    });

    update({ controls });
  }

  function restoreControls() {
    const saved = read().controls || {};

    IDS.forEach(id => {
      const el = document.getElementById(id);
      const value = saved[id];

      if (!el || value == null) return;

      const exists = Array.from(el.options || [])
        .some(option => option.value === value);

      if (exists) {
        el.value = value;
        el.dispatchEvent(
          new Event("change", { bubbles: true })
        );
      }
    });
  }

  function saveButtons() {
    const buttons = {};

    BUTTON_GROUPS.forEach(selector => {
      document.querySelectorAll(selector).forEach(button => {
        const key = getButtonKey(button);
        if (key) buttons[key] = buttonIsActive(button);
      });
    });

    update({ buttons });
  }

  function restoreButtons() {
    const saved = read().buttons || {};

    BUTTON_GROUPS.forEach(selector => {
      document.querySelectorAll(selector).forEach(button => {
        const key = getButtonKey(button);

        if (!key || typeof saved[key] !== "boolean") {
          return;
        }

        if (buttonIsActive(button) !== saved[key]) {
          button.click();
        }
      });
    });
  }

  function saveTab(tab) {
    if (!tab) return;
    update({ tab });
  }

  function restoreTab() {
    const tab = read().tab;
    if (!tab) return;

    const button = document.querySelector(
      '[data-cl-tab="' + tab + '"]'
    );

    if (button) button.click();
  }

  function saveTool(name, settings) {
    if (!name) return;

    const current = read();
    const tools = current.tools || {};

    tools[name] = settings;
    update({ tools });
  }

  function getTool(name, fallback = null) {
    const tools = read().tools || {};

    return Object.prototype.hasOwnProperty.call(
      tools,
      name
    ) ? tools[name] : fallback;
  }

  function saveDrawing(name, drawing) {
    if (!name) return;

    const current = read();
    const drawings = current.drawings || {};

    drawings[name] = drawing;
    update({ drawings });
  }

  function getDrawing(name, fallback = null) {
    const drawings = read().drawings || {};
    return drawings[name] ?? fallback;
  }

  function reset() {
    if (!confirm(
      "¿Restablecer la configuracion de CRYPTOLEXUZ PRO?"
    )) {
      return;
    }

    localStorage.removeItem(KEY);
    location.reload();
  }

  function addResetButton() {
    if (document.getElementById("clResetPreferences")) {
      return;
    }

    const settings = document.getElementById(
      "settingsSection"
    );

    if (!settings) return;

    const button = document.createElement("button");
    button.id = "clResetPreferences";
    button.type = "button";
    button.textContent = "Restablecer configuración";

    button.style.cssText = [
      "display:block",
      "margin:18px 0",
      "padding:12px 16px",
      "border:1px solid #7565a5",
      "border-radius:10px",
      "background:#201735",
      "color:#ffffff",
      "font-weight:600",
      "cursor:pointer"
    ].join(";");

    button.addEventListener("click", reset);
    settings.appendChild(button);
  }

  function attachEvents() {
    document.addEventListener("change", event => {
      if (IDS.includes(event.target.id)) {
        saveControls();
      }
    });

    document.addEventListener("click", event => {
      const tab = event.target.closest("[data-cl-tab]");

      if (tab) {
        saveTab(tab.dataset.clTab);
      }

      const indicator = event.target.closest(
        "[data-indicator], [data-pattern]"
      );

      if (indicator) {
        // Espera a que el modulo original cambie el estado.
        requestAnimationFrame(saveButtons);
      }
    });
  }

  function restore() {
    restoreControls();

    // Esperamos a que los modulos inicialicen sus botones.
    setTimeout(() => {
      restoreButtons();
      restoreTab();
    }, 1200);
  }

  function init() {
    attachEvents();
    addResetButton();
    restore();

    // Respaldo de los estados al salir de la pagina.
    window.addEventListener("pagehide", () => {
      saveControls();
      saveButtons();
    });

    console.log(
      "CRYPTOLEXUZ PRO: guardado automatico activado"
    );
  }

  window.CryptolexuzPreferences = {
    read,
    update,
    saveTool,
    getTool,
    saveDrawing,
    getDrawing,
    reset
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
