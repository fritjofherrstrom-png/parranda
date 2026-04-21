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
  const plannerKmReadout = document.querySelector(".planner-km-readout");

  if (!plannerModalShell || !routePlannerForm || !routeResults) {
    return;
  }

  const intensityMeta = {
    light: {
      label: "Lugn",
      summary: "Färre tydliga stopp och mjukare rytm.",
    },
    normal: {
      label: "Normal",
      summary: "Balanserad dag med jämn rytm.",
    },
    dense: {
      label: "Tät",
      summary: "Fler stopp och högre innehållstäthet.",
    },
  };

  let activeDayIntensity = window.__parrandaDayIntensity || "normal";
  let pendingResultFocus = false;
  let resultFocusTimer = null;
  let intensityShell = null;

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

    .planner-intensity-shell {
      display: grid;
      gap: 10px;
      padding: 14px 16px;
      border-radius: 18px;
      background: rgba(255, 251, 246, 0.72);
      border: 1px solid rgba(108, 74, 46, 0.08);
      min-width: 0;
      overflow: hidden;
    }

    .planner-intensity-head {
      display: flex;
      flex-direction: column;
      gap: 4px;
      min-width: 0;
    }

    .planner-intensity-head strong {
      font-size: 0.95rem;
    }

    .planner-intensity-head p {
      margin: 0;
      font-size: 0.9rem;
      color: rgba(59, 36, 20, 0.72);
      line-height: 1.45;
    }

    .planner-intensity-buttons {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(118px, 1fr));
      gap: 8px;
      align-items: stretch;
      min-width: 0;
    }

    .planner-intensity-button {
      appearance: none;
      border: 1px solid rgba(108, 74, 46, 0.12);
      background: rgba(255, 255, 255, 0.84);
      color: #3b2414;
      border-radius: 14px;
      padding: 12px 10px;
      display: grid;
      align-content: start;
      gap: 6px;
      text-align: left;
      cursor: pointer;
      transition: transform 120ms ease, border-color 120ms ease, background 120ms ease;
      min-width: 0;
      min-height: 116px;
      overflow: hidden;
    }

    .planner-intensity-button strong {
      display: block;
      min-width: 0;
      font-size: 0.95rem;
      line-height: 1.05;
      overflow-wrap: anywhere;
    }

    .planner-intensity-button span {
      display: block;
      min-width: 0;
      font-size: 0.8rem;
      line-height: 1.35;
      color: rgba(59, 36, 20, 0.7);
      overflow-wrap: anywhere;
      hyphens: auto;
    }

    .planner-intensity-button.is-active {
      border-color: rgba(175, 77, 36, 0.38);
      background: rgba(215, 160, 77, 0.14);
      box-shadow: 0 10px 18px rgba(69, 35, 13, 0.08);
      transform: translateY(-1px);
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

      .planner-intensity-buttons {
        grid-template-columns: 1fr;
      }

      .planner-intensity-button {
        min-height: 0;
      }
    }
  `;
  document.head.appendChild(style);

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

  function routeIntensityMetrics(route) {
    const stopCount = Array.isArray(route?.main_stops) ? route.main_stops.length : 0;
    const estimatedKm = Number(route?.estimated_km || 0);
    const longestLegKm = Number(route?.longest_leg_km || 0);
    const averageLegMinutes = Number(route?.average_leg_minutes || 0);
    const specialCount = Array.isArray(route?.venue_specials) ? route.venue_specials.length : 0;
    const stopDensity = estimatedKm > 0 ? stopCount / estimatedKm : 0;

    return {
      stopCount,
      estimatedKm,
      longestLegKm,
      averageLegMinutes,
      specialCount,
      stopDensity,
      isLoop: route?.route_shape === "loop",
    };
  }

  function scoreRouteForIntensity(route, intensity) {
    const metrics = routeIntensityMetrics(route);

    if (intensity === "light") {
      return Number(
        (
          22 -
          metrics.stopCount * 3.35 -
          metrics.estimatedKm * 0.45 -
          metrics.longestLegKm * 1.5 -
          metrics.averageLegMinutes * 0.03 -
          metrics.specialCount * 0.3 +
          (metrics.isLoop ? 1.2 : 0) +
          (metrics.estimatedKm <= 8 ? 1.4 : 0) +
          (metrics.stopCount <= 4 ? 1.6 : 0)
        ).toFixed(1),
      );
    }

    if (intensity === "dense") {
      return Number(
        (
          metrics.stopCount * 3.2 +
          metrics.stopDensity * 7.2 +
          metrics.specialCount * 0.45 -
          metrics.longestLegKm * 1.05 -
          Math.max(0, 5 - metrics.stopCount) * 1.9 +
          (metrics.estimatedKm >= 5.5 && metrics.estimatedKm <= 10.5 ? 1.4 : 0)
        ).toFixed(1),
      );
    }

    return Number(
      (
        16 -
        Math.abs(metrics.stopDensity - 0.56) * 6 -
        Math.abs(metrics.stopCount - 4.8) * 1.4 -
        metrics.longestLegKm * 0.95
      ).toFixed(1),
    );
  }

  function relabelLiveEvents(liveEvents = [], orderedRoutes = []) {
    const labelById = new Map();

    if (orderedRoutes[0]) {
      labelById.set(orderedRoutes[0].id, {
        label: "Huvudrutten",
        title: orderedRoutes[0].title,
      });
    }

    orderedRoutes.slice(1).forEach((route, index) => {
      labelById.set(route.id, {
        label: `Alternativ ${index + 1}`,
        title: route.title,
      });
    });

    return liveEvents.map((event) => {
      const replacement = labelById.get(event.best_route_id);
      if (!replacement) {
        return event;
      }
      return {
        ...event,
        best_route_label: replacement.label,
        best_route_title: replacement.title,
      };
    });
  }

  function buildIntensityNote(intensity, route) {
    const metrics = routeIntensityMetrics(route);

    if (intensity === "light") {
      return `Intensitet: lugn. Den här versionen håller dagen mjukare med ${metrics.stopCount} tydliga stopp och mindre packat tempo.`;
    }

    if (intensity === "dense") {
      return `Intensitet: tät. Den här versionen pressar upp innehållet till ${metrics.stopCount} stopp utan att låta benen dra iväg för mycket.`;
    }

    return `Intensitet: normal. Den här versionen håller en mer balanserad rytm mellan stopp, benlängd och kvällsenergi.`;
  }

  function annotatePrimaryRoute(route, intensity) {
    if (!route) {
      return route;
    }

    const note = buildIntensityNote(intensity, route);
    const currentWhy = String(route.why_recommended || "").trim();

    return {
      ...route,
      intensity_mode: intensity,
      intensity_fit_note: note,
      why_recommended: currentWhy ? `${currentWhy} ${note}` : note,
    };
  }

  function applyIntensityToResult(result, intensity) {
    if (!result || !Array.isArray(result.days) || !result.days.length || intensity === "normal") {
      return result;
    }

    return {
      ...result,
      days: result.days.map((day) => {
        if (!day?.primary_route) {
          return day;
        }

        const candidates = [day.primary_route, ...(Array.isArray(day.alternatives) ? day.alternatives : [])];
        const ordered = [...candidates].sort((left, right) => {
          const leftScore = scoreRouteForIntensity(left, intensity);
          const rightScore = scoreRouteForIntensity(right, intensity);
          if (rightScore !== leftScore) {
            return rightScore - leftScore;
          }
          return Number(right.estimated_km || 0) - Number(left.estimated_km || 0);
        });
        const currentPrimaryScore = scoreRouteForIntensity(day.primary_route, intensity);
        const bestScore = scoreRouteForIntensity(ordered[0], intensity);
        const shouldPromote = bestScore >= currentPrimaryScore + 0.75;
        const primaryRoute = shouldPromote ? ordered[0] : day.primary_route;
        const alternatives = shouldPromote
          ? ordered.slice(1)
          : [...candidates.filter((route) => route.id !== day.primary_route.id)].sort((left, right) => {
              const leftScore = scoreRouteForIntensity(left, intensity);
              const rightScore = scoreRouteForIntensity(right, intensity);
              if (rightScore !== leftScore) {
                return rightScore - leftScore;
              }
              return Number(right.estimated_km || 0) - Number(left.estimated_km || 0);
            });
        const orderedRoutes = [primaryRoute, ...alternatives];

        return {
          ...day,
          primary_route: annotatePrimaryRoute(primaryRoute, intensity),
          alternatives,
          live_events: relabelLiveEvents(day.live_events || [], orderedRoutes),
        };
      }),
    };
  }

  function syncIntensityButtons() {
    if (!intensityShell) {
      return;
    }

    intensityShell.querySelectorAll(".planner-intensity-button").forEach((button) => {
      button.classList.toggle("is-active", button.dataset.dayIntensity === activeDayIntensity);
      button.setAttribute("aria-pressed", String(button.dataset.dayIntensity === activeDayIntensity));
    });
  }

  function setDayIntensity(nextIntensity) {
    activeDayIntensity = intensityMeta[nextIntensity] ? nextIntensity : "normal";
    window.__parrandaDayIntensity = activeDayIntensity;
    syncIntensityButtons();

    if (routeMatchSummary) {
      routeMatchSummary.textContent = `Dagstempo: ${intensityMeta[activeDayIntensity].label}. ${intensityMeta[activeDayIntensity].summary}`;
    }
  }

  function ensureIntensityUi() {
    if (!plannerKmReadout || intensityShell) {
      return;
    }

    intensityShell = document.createElement("section");
    intensityShell.className = "planner-intensity-shell";
    intensityShell.innerHTML = `
      <div class="planner-intensity-head">
        <strong>Dagstempo</strong>
        <p>Välj hur packad varje dag ska kännas innan Parranda bygger rutten.</p>
      </div>
      <div class="planner-intensity-buttons" role="group" aria-label="Dagstempo"></div>
    `;

    const buttonRow = intensityShell.querySelector(".planner-intensity-buttons");
    Object.entries(intensityMeta).forEach(([key, meta]) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "planner-intensity-button";
      button.dataset.dayIntensity = key;
      button.innerHTML = `<strong>${meta.label}</strong><span>${meta.summary}</span>`;
      button.addEventListener("click", () => {
        setDayIntensity(key);
      });
      buttonRow.appendChild(button);
    });

    plannerKmReadout.insertAdjacentElement("afterend", intensityShell);
    syncIntensityButtons();
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

  function patchFetchForIntensity() {
    if (window.__parrandaIntensityFetchPatched) {
      return;
    }

    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input?.url || "";
      let nextInit = init;

      if (url.includes("/api/route-recommendations") && init?.body) {
        try {
          const parsedBody = JSON.parse(init.body);
          parsedBody.day_intensity = activeDayIntensity;
          nextInit = {
            ...init,
            body: JSON.stringify(parsedBody),
          };
        } catch (_error) {
          nextInit = init;
        }
      }

      const response = await originalFetch(input, nextInit);

      if (!url.includes("/api/route-recommendations")) {
        return response;
      }

      try {
        const text = await response.text();
        const parsed = JSON.parse(text);
        const modified = applyIntensityToResult(parsed, activeDayIntensity);
        const headers = new Headers(response.headers);
        headers.set("content-type", "application/json");
        return new Response(JSON.stringify(modified), {
          status: response.status,
          statusText: response.statusText,
          headers,
        });
      } catch (_error) {
        return response;
      }
    };

    window.__parrandaIntensityFetchPatched = true;
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
  ensureIntensityUi();
  patchFetchForIntensity();
  syncIntensityButtons();
  window.setTimeout(syncPlannerUxPass, 120);
})();
