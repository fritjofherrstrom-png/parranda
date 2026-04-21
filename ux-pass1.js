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

  const plannerLaunchStrip = document.querySelector(".planner-launch-strip");
  const plannerLaunchEyebrow = plannerLaunchStrip?.querySelector(".eyebrow");
  const plannerLaunchTitle = plannerLaunchStrip?.querySelector("h2");
  const plannerLaunchSummary = document.getElementById("plannerLaunchSummary");
  const routePlannerOpenButton = document.getElementById("routePlannerOpenButton");

  const heroPanel = document.querySelector(".hero-panel");
  const heroWildcardLabel = document.getElementById("heroWildcardLabel");
  const heroWildcardMeta = document.getElementById("heroWildcardMeta");
  const heroWildcardApplyButton = document.getElementById("heroWildcardApplyButton");
  const heroWildcardShuffleButton = document.getElementById("heroWildcardShuffleButton");

  if (!plannerModalShell || !routePlannerForm || !routeResults) {
    return;
  }

  const style = document.createElement("style");
  style.textContent = `
    body.is-planner-open {
      overflow: hidden;
    }

    .planner-modal-shell,
    .planner-modal-shell *,
    .planner-modal-backdrop,
    .planner-modal-backdrop * {
      box-sizing: border-box;
    }

    .planner-modal-shell {
      overflow-x: hidden;
      overscroll-behavior: contain;
    }

    .planner-modal-shell .route-builder-form,
    .planner-modal-shell .route-builder-grid,
    .planner-modal-shell .planner-panel,
    .planner-modal-shell .planner-inline-grid,
    .planner-modal-shell .planner-home-base-shell,
    .planner-modal-shell .planner-fine-tune-body,
    .planner-modal-shell .planner-anchor-grid,
    .planner-modal-shell .planner-style-layers,
    .planner-modal-shell .planner-style-row,
    .planner-modal-shell .search-box,
    .planner-modal-shell .route-lab-field,
    .planner-modal-shell .planner-km-readout,
    .planner-modal-shell .route-builder-actions-final,
    .planner-modal-shell .planner-status-message {
      min-width: 0;
      max-width: 100%;
    }

    .planner-modal-shell .search-box,
    .planner-modal-shell .route-lab-field {
      overflow: hidden;
    }

    .planner-modal-shell input,
    .planner-modal-shell select,
    .planner-modal-shell textarea,
    .planner-modal-shell button {
      max-width: 100%;
    }

    .planner-modal-shell input[type="date"] {
      display: block;
      width: 100%;
      min-width: 0;
      max-width: 100%;
      appearance: none;
      -webkit-appearance: none;
      overflow: hidden;
    }

    .planner-modal-shell input[type="date"]::-webkit-date-and-time-value {
      text-align: left;
    }

    .planner-modal-shell input[type="date"]::-webkit-calendar-picker-indicator {
      flex-shrink: 0;
    }

    .route-builder-actions-final {
      position: sticky;
      bottom: 0;
      z-index: 12;
      margin-top: 14px;
      padding: 12px 0 calc(12px + env(safe-area-inset-bottom, 0px));
      background: linear-gradient(180deg, rgba(250, 239, 223, 0), rgba(250, 239, 223, 0.96) 34%);
      backdrop-filter: blur(10px);
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

    .hero-panel {
      width: min(320px, 100%);
      padding: 18px;
      border-radius: 24px;
      transform: none;
      background:
        linear-gradient(180deg, rgba(37, 21, 14, 0.72), rgba(37, 21, 14, 0.82)),
        linear-gradient(135deg, #c96a34, #8d3220 62%, #3f3028);
    }

    .hero-panel h2 {
      font-size: clamp(2rem, 3vw, 2.5rem);
      line-height: 0.98;
    }

    .hero-panel-meta {
      font-size: 0.9rem;
      line-height: 1.55;
      color: rgba(255, 247, 239, 0.76);
    }

    .hero-panel-actions {
      gap: 10px;
    }

    .hero-panel .secondary-button,
    .hero-panel .ghost-button {
      padding: 10px 14px;
      min-width: 0;
    }

    .planner-launch-strip {
      padding: 16px 18px;
      border-radius: 22px;
      background: rgba(255, 252, 247, 0.72);
      box-shadow: 0 14px 34px rgba(69, 35, 13, 0.08);
    }

    .planner-launch-copy h2 {
      font-size: clamp(1.6rem, 2.4vw, 2rem);
      line-height: 1;
    }

    .planner-launch-note {
      max-width: 44ch;
    }

    @media (max-width: 860px) {
      .planner-modal-shell {
        padding-left: 16px;
        padding-right: 16px;
      }

      .hero-panel {
        width: 100%;
      }
    }

    @media (max-width: 680px) {
      .planner-modal-shell {
        width: 100vw;
        max-width: 100vw;
        padding-left: 14px;
        padding-right: 14px;
      }

      .planner-modal-shell .planner-inline-grid {
        grid-template-columns: 1fr !important;
      }

      .planner-modal-shell .route-builder-grid {
        gap: 12px;
      }

      .planner-modal-shell .planner-panel,
      .planner-modal-shell .planner-home-base-shell,
      .planner-modal-shell .planner-km-readout {
        padding-left: 14px;
        padding-right: 14px;
      }

      .planner-modal-shell input[type="date"],
      .planner-modal-shell select {
        font-size: 16px;
      }

      .planner-modal-shell .route-builder-actions-final {
        display: flex;
        flex-direction: column;
        align-items: stretch;
        gap: 10px;
        width: 100%;
      }

      .planner-modal-shell .route-builder-actions-final .primary-button,
      .planner-modal-shell .route-builder-actions-final .ghost-button {
        width: 100%;
      }

      .planner-launch-strip {
        align-items: stretch;
      }

      .planner-launch-strip .primary-button {
        width: 100%;
      }

      .hero-panel-actions {
        display: flex;
        flex-direction: column;
        align-items: stretch;
      }

      .hero-panel .secondary-button,
      .hero-panel .ghost-button {
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

  function applyLandingHierarchyPass() {
    if (plannerLaunchEyebrow) {
      plannerLaunchEyebrow.textContent = "NÄSTA STEG";
    }

    if (plannerLaunchTitle) {
      plannerLaunchTitle.textContent = "Öppna planner";
    }

    if (plannerLaunchSummary) {
      plannerLaunchSummary.textContent =
        "När du vill gå från inspiration till en faktisk dag väljer du datum, bas och vibe här. Resultatet ska kännas som ett upplägg, inte som ännu en lista.";
    }

    if (routePlannerOpenButton) {
      routePlannerOpenButton.textContent = "Öppna planner";
    }

    if (heroWildcardLabel) {
      heroWildcardLabel.textContent = "SNABB IDÉ";
    }

    if (heroWildcardMeta) {
      heroWildcardMeta.textContent =
        "Ett snabbspår om du bara vill få en känsla för kvällen. Plannern är fortfarande huvudvägen till en riktig dag.";
    }

    if (heroWildcardApplyButton) {
      heroWildcardApplyButton.textContent = "Lägg i planner";
    }

    if (heroWildcardShuffleButton) {
      heroWildcardShuffleButton.textContent = "Ny idé";
    }
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
  applyLandingHierarchyPass();
  window.setTimeout(syncPlannerUxPass, 120);
})();
