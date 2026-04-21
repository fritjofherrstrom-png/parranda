(() => {
  const plannerModalShell = document.getElementById("routePlannerStart");
  const plannerModalBackdrop = document.getElementById("plannerModalBackdrop");
  const routePlannerForm = document.getElementById("routePlannerForm");
  const routeResults = document.getElementById("routeResults");

  const plannerModeAutoButton = document.getElementById("plannerModeAutoButton");
  const plannerModeManualButton = document.getElementById("plannerModeManualButton");
  const plannerFineTuneDetails = document.getElementById("plannerFineTuneDetails");

  const homeBaseModeSelect = document.getElementById("homeBaseModeSelect");
  const startModeSelect = document.getElementById("startModeSelect");
  const endModeSelect = document.getElementById("endModeSelect");

  const homeBasePresetField = document.querySelector('[data-mode-field="home-base-preset"]');
  const homeBaseCustomField = document.querySelector('[data-mode-field="home-base-custom"]');
  const startPresetField = document.querySelector('[data-mode-field="start-preset"]');
  const startCustomField = document.querySelector('[data-mode-field="start-custom"]');
  const endPresetField = document.querySelector('[data-mode-field="end-preset"]');
  const endCustomField = document.querySelector('[data-mode-field="end-custom"]');

  const routePlanButton = document.getElementById("routePlanButton");
  const routePlanStickyButton = document.getElementById("routePlanStickyButton");
  const routeMatchSummary = document.getElementById("routeMatchSummary");

  if (!plannerModalShell || !routePlannerForm || !routeResults) {
    return;
  }

  const style = document.createElement("style");
  style.textContent = `
    body.is-planner-open {
      overflow: hidden;
    }

    .route-builder-actions-final {
      position: sticky;
      bottom: 0;
      z-index: 12;
      padding-top: 12px;
      background: linear-gradient(180deg, rgba(250, 239, 223, 0), rgba(250, 239, 223, 0.94) 42%);
    }

    .planner-mobile-actions {
      display: none !important;
    }

    .planner-modal-shell.is-auto-mode #plannerFineTuneDetails {
      display: none;
    }

    .planner-modal-shell.is-auto-mode .planner-panel-priority {
      gap: 14px;
    }

    .planner-modal-shell.is-auto-mode .planner-home-base-shell {
      gap: 10px;
    }

    .planner-modal-shell.is-auto-mode .planner-home-base-shell .planner-panel-copy {
      max-width: 48ch;
    }

    @media (max-width: 680px) {
      .route-builder-actions-final {
        display: flex;
        flex-direction: column;
        align-items: stretch;
      }

      .route-builder-actions-final .primary-button,
      .route-builder-actions-final .ghost-button {
        width: 100%;
      }
    }
  `;
  document.head.appendChild(style);

  let pendingResultFocus = false;
  let resultFocusTimer = null;

  function syncPointInput(modeSelect, presetField, customField) {
    const mode = modeSelect?.value || "auto";

    if (presetField) {
      presetField.hidden = mode !== "preset";
    }

    if (customField) {
      customField.hidden = mode !== "custom";
    }
  }

  function syncPlannerUxPass() {
    const autoMode = plannerModeAutoButton?.classList.contains("is-active");
    const manualMode = plannerModeManualButton?.classList.contains("is-active");

    plannerModalShell.classList.toggle("is-auto-mode", Boolean(autoMode));
    plannerModalShell.classList.toggle("is-manual-mode", Boolean(manualMode));

    if (plannerFineTuneDetails && autoMode) {
      plannerFineTuneDetails.open = false;
    }

    syncPointInput(homeBaseModeSelect, homeBasePresetField, homeBaseCustomField);
    syncPointInput(startModeSelect, startPresetField, startCustomField);
    syncPointInput(endModeSelect, endPresetField, endCustomField);
  }

  function focusResults() {
    if (resultFocusTimer) {
      clearTimeout(resultFocusTimer);
    }

    resultFocusTimer = window.setTimeout(() => {
      routeResults.scrollIntoView({ behavior: "smooth", block: "start" });

      const focusTarget =
        routeResults.querySelector(".planner-day-tab.is-active") ||
        routeResults.querySelector(".planner-day-tab") ||
        routeResults.querySelector(".planner-alt-toggle") ||
        routeResults.querySelector(".route-select-button");

      if (focusTarget && typeof focusTarget.focus === "function") {
        focusTarget.focus({ preventScroll: true });
      }
    }, 260);
  }

  function maybeFocusResults() {
    if (!pendingResultFocus) {
      return;
    }

    if (!plannerModalShell.hidden) {
      return;
    }

    if (!routeResults.children.length) {
      return;
    }

    pendingResultFocus = false;
    focusResults();
  }

  function markPlanningIntent() {
    pendingResultFocus = true;
  }

  plannerModeAutoButton?.addEventListener("click", () => {
    window.setTimeout(syncPlannerUxPass, 0);
  });

  plannerModeManualButton?.addEventListener("click", () => {
    window.setTimeout(syncPlannerUxPass, 0);
  });

  homeBaseModeSelect?.addEventListener("change", syncPlannerUxPass);
  startModeSelect?.addEventListener("change", syncPlannerUxPass);
  endModeSelect?.addEventListener("change", syncPlannerUxPass);

  routePlanButton?.addEventListener("click", markPlanningIntent);
  routePlanStickyButton?.addEventListener("click", markPlanningIntent);
  routePlannerForm.addEventListener("submit", markPlanningIntent);

  if (routeMatchSummary) {
    routeMatchSummary.textContent = "Välj datum och tryck på Planera min resa. Om live-läget inte svarar ligger de kuraterade Rome-wide-rutterna kvar som backup.";
  }

  const modeObserver = new MutationObserver(() => {
    syncPlannerUxPass();
  });

  if (plannerModeAutoButton) {
    modeObserver.observe(plannerModeAutoButton, { attributes: true, attributeFilter: ["class"] });
  }

  if (plannerModeManualButton) {
    modeObserver.observe(plannerModeManualButton, { attributes: true, attributeFilter: ["class"] });
  }

  const resultsObserver = new MutationObserver(() => {
    maybeFocusResults();
  });

  resultsObserver.observe(routeResults, {
    childList: true,
    subtree: true,
  });

  const modalObserver = new MutationObserver(() => {
    maybeFocusResults();
  });

  modalObserver.observe(plannerModalShell, {
    attributes: true,
    attributeFilter: ["hidden", "class"],
  });

  if (plannerModalBackdrop) {
    modalObserver.observe(plannerModalBackdrop, {
      attributes: true,
      attributeFilter: ["hidden", "class"],
    });
  }

  syncPlannerUxPass();
  window.setTimeout(syncPlannerUxPass, 120);
})();
