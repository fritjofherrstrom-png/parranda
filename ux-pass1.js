(() => {
  const plannerModalShell = document.getElementById("routePlannerStart");
  const plannerModalBackdrop = document.getElementById("plannerModalBackdrop");
  const routePlannerForm = document.getElementById("routePlannerForm");
  const routeResults = document.getElementById("routeResults");
  const plannerLaunchStrip = document.querySelector(".planner-launch-strip");
  const routePlannerOpenButton = document.getElementById("routePlannerOpenButton");
  const heroCopy = document.querySelector(".hero-copy");
  const heroActions = document.querySelector(".hero-actions");
  const heroPlannerButton = document.getElementById("heroPlannerButton");
  const heroWildcardLabel = document.getElementById("heroWildcardLabel");
  const heroWildcardMeta = document.getElementById("heroWildcardMeta");
  const heroWildcardApplyButton = document.getElementById("heroWildcardApplyButton");
  const heroWildcardShuffleButton = document.getElementById("heroWildcardShuffleButton");
  const plannerModeAutoButton = document.getElementById("plannerModeAutoButton");
  const plannerModeManualButton = document.getElementById("plannerModeManualButton");
  const plannerFineTuneDetails = document.getElementById("plannerFineTuneDetails");
  const plannerAdvancedSummary = document.getElementById("plannerAdvancedSummary");
  const plannerHomeBaseShell = document.getElementById("plannerHomeBaseShell");
  const homeBaseModeSelect = document.getElementById("homeBaseModeSelect");
  const homeBasePresetSelect = document.getElementById("homeBasePresetSelect");
  const homeBaseCustomInput = document.getElementById("homeBaseCustomInput");
  const homeBasePresetField = document.querySelector('[data-mode-field="home-base-preset"]');
  const homeBaseCustomField = document.querySelector('[data-mode-field="home-base-custom"]');
  const startModeSelect = document.getElementById("startModeSelect");
  const startPresetField = document.querySelector('[data-mode-field="start-preset"]');
  const startCustomField = document.querySelector('[data-mode-field="start-custom"]');
  const endModeSelect = document.getElementById("endModeSelect");
  const endPresetField = document.querySelector('[data-mode-field="end-preset"]');
  const endCustomField = document.querySelector('[data-mode-field="end-custom"]');
  const homeBaseDistrictButtons = document.getElementById("homeBaseDistrictButtons");
  const routePlanButton = document.getElementById("routePlanButton");
  const routePlanStickyButton = document.getElementById("routePlanStickyButton");
  const routeMatchSummary = document.getElementById("routeMatchSummary");
  const plannerKmReadout = document.querySelector(".planner-km-readout");
  const routeDateFrom = document.getElementById("routeDateFrom");
  const routeDateTo = document.getElementById("routeDateTo");
  const tabNav = document.querySelector(".tab-nav");

  if (!plannerModalShell || !routePlannerForm || !routeResults || !heroCopy || !heroActions) {
    return;
  }

  const intensityMeta = {
    light: { label: "Lugn", summary: "Färre stopp och mjukare rytm." },
    normal: { label: "Normal", summary: "Balanserad dag med jämn rytm." },
    dense: { label: "Tät", summary: "Fler stopp och högre innehållstäthet." },
  };

  const quickBaseMeta = {
    current: { label: "📍 Min plats", plannerMode: "current_location", plannerLabel: null },
    auto: { label: "Låt Parranda välja", plannerMode: "auto", plannerLabel: null },
    trastevere: { label: "Trastevere", plannerMode: "preset", plannerLabel: "Trastevere" },
    centro: { label: "Centro Storico", plannerMode: "preset", plannerLabel: "Centro Storico" },
    monti: { label: "Monti", plannerMode: "preset", plannerLabel: "Monti" },
    south: { label: "Ostiense/Garbatella", plannerMode: "preset", plannerLabel: "Ostiense/Garbatella" },
    east: { label: "Pigneto/San Lorenzo", plannerMode: "preset", plannerLabel: "Pigneto/San Lorenzo" },
  };

  const quickVibeMeta = {
    blend: { label: "Blanda", preferences: ["vin", "mat", "kultur", "hidden gems", "nattliv"] },
    culture: { label: "Kultur", preferences: ["kultur", "kyrkor", "hidden gems"] },
    food: { label: "Mat", preferences: ["mat", "vin", "hidden gems"] },
    wine: { label: "Vin", preferences: ["vin", "mat", "low-key", "hidden gems"] },
    night: { label: "Nattliv", preferences: ["nattliv", "vin", "cocktail", "kväll"] },
    lowkey: { label: "Low-key", preferences: ["low-key", "vin", "kultur", "hidden gems"] },
  };

  let activeDayIntensity = window.__parrandaDayIntensity || "normal";
  let activeQuickBase = window.__parrandaQuickBase || "auto";
  let activeQuickVibe = window.__parrandaQuickVibe || "blend";
  let pendingResultFocus = false;
  let resultFocusTimer = null;
  let intensityShell = null;
  let heroQuickPlannerShell = null;
  let resultRecapStrip = null;
  let dateRangeShell = null;
  let homeBaseCompactShell = null;
  let dateFromField = null;
  let dateToField = null;
  let homeBaseExpanded = false;
  let showRangeEndField = false;
  let heroBaseStatus = "Tryck på Min plats om du vill att Parranda ska be om platsåtkomst direkt.";
  let heroBaseStatusTone = "info";
  let isResolvingHeroLocation = false;

  const style = document.createElement("style");
  style.textContent = `
    body.is-planner-open { overflow: hidden; }
    body.route-focus .tab-nav {
      display: inline-flex;
      width: auto;
      padding: 6px;
      margin-top: 8px;
      margin-bottom: 16px;
      border-radius: 18px;
      background: rgba(255,252,247,0.48);
      box-shadow: 0 8px 18px rgba(69,35,13,0.04);
      opacity: 0.86;
    }
    body.has-live-results .planner-launch-strip,
    body.has-live-results .route-match-summary,
    body.has-live-results .tab-panel[data-tab-panel="routes"] > .section-heading.compact-heading,
    body.has-live-results #cityPulseTeaser { display: none !important; }
    .planner-modal-shell, .planner-modal-shell * { box-sizing: border-box; }
    .planner-modal-shell { overflow-x: hidden; overscroll-behavior: contain; }
    .planner-modal-shell input, .planner-modal-shell select, .planner-modal-shell textarea, .planner-modal-shell button { max-width: 100%; }
    .planner-modal-shell .search-box, .planner-modal-shell .route-lab-field { overflow: hidden; }
    .planner-modal-shell input[type="date"] { display:block; width:100%; min-width:0; max-width:100%; appearance:none; -webkit-appearance:none; overflow:hidden; }
    .planner-modal-shell input[type="date"]::-webkit-date-and-time-value { text-align:left; }
    .planner-modal-shell input[type="date"]::-webkit-calendar-picker-indicator { flex-shrink:0; }
    .planner-modal-shell.is-auto-mode #plannerFineTuneDetails { display:none; }
    .route-builder-actions-final { position:sticky; bottom:0; z-index:12; margin-top:14px; padding:12px 0 calc(12px + env(safe-area-inset-bottom, 0px)); background:linear-gradient(180deg, rgba(250,239,223,0), rgba(250,239,223,0.96) 34%); backdrop-filter:blur(10px); }
    .planner-mobile-actions { display:none !important; }
    .hero-planner-inline { display:grid; gap:14px; margin-top:20px; padding:18px 18px 16px; border-radius:24px; background:rgba(255,252,247,0.84); box-shadow:0 16px 34px rgba(69,35,13,0.08); border:1px solid rgba(108,74,46,0.08); max-width:900px; }
    .hero-planner-inline-head { display:grid; gap:4px; }
    .hero-planner-inline-head strong { font-size:1rem; line-height:1.1; color:#3b2414; }
    .hero-planner-inline-head p { margin:0; color:rgba(59,36,20,0.74); font-size:0.95rem; line-height:1.5; max-width:48ch; }
    .hero-signal-row { display:grid; gap:8px; }
    .hero-signal-label { font-size:0.8rem; text-transform:uppercase; letter-spacing:0.16em; color:rgba(59,36,20,0.54); }
    .hero-signal-buttons { display:flex; flex-wrap:wrap; gap:8px; }
    .hero-signal-chip { appearance:none; border:1px solid rgba(108,74,46,0.12); background:rgba(255,255,255,0.88); color:#3b2414; border-radius:999px; padding:10px 14px; font:inherit; font-size:0.95rem; cursor:pointer; transition:border-color 120ms ease, background 120ms ease, transform 120ms ease; }
    .hero-signal-chip.is-active { border-color:rgba(175,77,36,0.4); background:rgba(215,160,77,0.14); transform:translateY(-1px); box-shadow:0 10px 18px rgba(69,35,13,0.06); }
    .hero-signal-chip[data-quick-base="current"] { font-weight: 700; }
    .hero-signal-chip.is-loading {
      opacity: 0.82;
      pointer-events: none;
      position: relative;
    }
    .hero-signal-chip.is-loading::after {
      content: "";
      width: 12px;
      height: 12px;
      border-radius: 999px;
      border: 2px solid rgba(175,77,36,0.2);
      border-top-color: rgba(175,77,36,0.8);
      display: inline-block;
      margin-left: 8px;
      vertical-align: -2px;
      animation: parranda-spin 0.8s linear infinite;
    }
    @keyframes parranda-spin {
      to { transform: rotate(360deg); }
    }
    .hero-planner-inline-foot { display:flex; align-items:center; justify-content:space-between; gap:12px; padding-top:4px; }
    .hero-planner-inline-summary { margin:0; font-size:0.92rem; line-height:1.45; color:rgba(59,36,20,0.72); max-width:46ch; }
    .hero-planner-inline-summary[data-tone="success"] { color: #35592b; }
    .hero-planner-inline-summary[data-tone="warning"] { color: #8a3f1f; }
    .planner-base-compact {
      grid-column: 1 / -1;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 12px 14px;
      border-radius: 16px;
      border: 1px solid rgba(108,74,46,0.08);
      background: rgba(255,251,246,0.72);
    }
    .planner-base-compact-copy {
      display: grid;
      gap: 3px;
      min-width: 0;
    }
    .planner-base-compact-copy strong {
      font-size: 0.9rem;
      color: #3b2414;
    }
    .planner-base-compact-copy p {
      margin: 0;
      font-size: 0.9rem;
      line-height: 1.45;
      color: rgba(59,36,20,0.72);
      max-width: 44ch;
    }
    .planner-date-range-shell {
      grid-column:1 / -1;
      display:flex;
      align-items:flex-start;
      justify-content:space-between;
      gap:12px;
      padding:12px 14px;
      border-radius:16px;
      border:1px solid rgba(108,74,46,0.08);
      background:rgba(255,251,246,0.8);
    }
    .planner-date-range-shell strong { display:block; font-size:0.9rem; color:#3b2414; }
    .planner-date-range-shell p { margin:2px 0 0; font-size:0.88rem; color:rgba(59,36,20,0.7); }
    .planner-date-range-actions { display:flex; flex-wrap:wrap; justify-content:flex-end; gap:8px; }
    .planner-date-range-button { appearance:none; border:none; background:rgba(175,77,36,0.08); color:#af4d24; border-radius:999px; padding:10px 14px; font:inherit; cursor:pointer; }
    .planner-date-range-clear { white-space: nowrap; }
    .planner-intensity-shell { grid-column:1 / -1; display:grid; gap:10px; padding:14px 16px; border-radius:18px; background:rgba(255,251,246,0.72); border:1px solid rgba(108,74,46,0.08); min-width:0; overflow:hidden; }
    .planner-intensity-head { display:flex; flex-direction:column; gap:4px; min-width:0; }
    .planner-intensity-head strong { font-size:0.95rem; }
    .planner-intensity-head p { margin:0; font-size:0.9rem; color:rgba(59,36,20,0.72); line-height:1.45; max-width:40ch; }
    .planner-intensity-buttons { display:grid; grid-template-columns:repeat(3, minmax(0, 1fr)); gap:10px; align-items:stretch; min-width:0; }
    .planner-intensity-button { appearance:none; border:1px solid rgba(108,74,46,0.12); background:rgba(255,255,255,0.84); color:#3b2414; border-radius:14px; padding:14px 12px; display:grid; align-content:start; gap:8px; text-align:left; cursor:pointer; transition:transform 120ms ease, border-color 120ms ease, background 120ms ease; min-width:0; overflow:hidden; }
    .planner-intensity-button strong { display:block; min-width:0; font-size:0.98rem; line-height:1.05; overflow-wrap:anywhere; }
    .planner-intensity-button span { display:block; min-width:0; font-size:0.84rem; line-height:1.4; color:rgba(59,36,20,0.7); overflow-wrap:anywhere; hyphens:auto; }
    .planner-intensity-button.is-active { border-color:rgba(175,77,36,0.38); background:rgba(215,160,77,0.14); box-shadow:0 10px 18px rgba(69,35,13,0.08); transform:translateY(-1px); }
    .results-recap-strip { display:none; align-items:center; justify-content:space-between; gap:16px; margin:0 0 16px; padding:16px 18px; border-radius:24px; background:rgba(255,252,247,0.84); box-shadow:0 16px 34px rgba(69,35,13,0.08); border:1px solid rgba(108,74,46,0.08); }
    .results-recap-strip.is-visible { display:flex; }
    .results-recap-copy { display:grid; gap:4px; }
    .results-recap-copy span { font-size:0.8rem; text-transform:uppercase; letter-spacing:0.16em; color:rgba(59,36,20,0.54); }
    .results-recap-copy strong { font-size:1.3rem; line-height:1.02; color:#3b2414; }
    .results-recap-copy p { margin:0; color:rgba(59,36,20,0.72); font-size:0.94rem; line-height:1.45; max-width:48ch; }
    @media (max-width: 860px) {
      .planner-intensity-buttons { grid-template-columns:1fr; }
    }
    @media (max-width: 680px) {
      .planner-modal-shell { width:100vw; max-width:100vw; padding-left:14px; padding-right:14px; }
      .planner-modal-shell .planner-inline-grid { grid-template-columns:1fr !important; }
      .planner-modal-shell .route-builder-grid { gap:12px; }
      .planner-modal-shell .planner-panel, .planner-modal-shell .planner-home-base-shell, .planner-modal-shell .planner-km-readout { padding-left:14px; padding-right:14px; }
      .planner-modal-shell input[type="date"], .planner-modal-shell select { font-size:16px; }
      .planner-modal-shell .route-builder-actions-final { display:flex; flex-direction:column; align-items:stretch; gap:10px; width:100%; }
      .planner-modal-shell .route-builder-actions-final .primary-button, .planner-modal-shell .route-builder-actions-final .ghost-button, .hero-planner-inline .primary-button, .results-recap-strip .primary-button { width:100%; }
      .hero-planner-inline-foot, .results-recap-strip, .planner-date-range-shell, .planner-base-compact { flex-direction:column; align-items:stretch; }
      .planner-date-range-actions { justify-content:flex-start; }
    }
  `;
  document.head.appendChild(style);

  function dispatchNativeChange(element) {
    if (!element) return;
    element.dispatchEvent(new Event("change", { bubbles: true }));
    element.dispatchEvent(new Event("input", { bubbles: true }));
  }

  function syncPointInput(modeSelect, presetField, customField) {
    const mode = modeSelect?.value || "auto";
    if (presetField) presetField.hidden = mode !== "preset";
    if (customField) customField.hidden = mode !== "custom";
  }

  function requestDatePicker(input) {
    if (!input) return;
    if (typeof input.showPicker === "function") {
      input.showPicker();
      return;
    }
    input.focus();
  }

  function getPlannerDayCount() {
    const from = routeDateFrom?.value;
    const to = routeDateTo?.value || from;
    if (!from || !to) return 0;
    const start = new Date(`${from}T12:00:00`);
    const end = new Date(`${to}T12:00:00`);
    return Math.max(1, Math.round((end - start) / 86400000) + 1);
  }

  function getHomeBaseSummaryCopy() {
    const mode = homeBaseModeSelect?.value || "auto";
    if (mode === "current_location") {
      return "Min plats används som mjuk boendebas för dagen.";
    }
    if (mode === "preset") {
      return `${homeBasePresetSelect?.value || "Valt kvarter"} används som mjuk boendebas.`;
    }
    if (mode === "custom") {
      return `${homeBaseCustomInput?.value?.trim() || "Egen adress"} används som mjuk boendebas.`;
    }
    return "Parranda väljer en smart boendebas om du inte lägger till en själv.";
  }

  function updateHomeBaseCompact() {
    if (!homeBaseCompactShell) return;
    const autoMode = plannerModeAutoButton?.classList.contains("is-active");
    const summary = homeBaseCompactShell.querySelector(".planner-base-compact-summary");
    const button = homeBaseCompactShell.querySelector(".planner-base-compact-button");
    const collapsed = autoMode && !homeBaseExpanded;

    homeBaseCompactShell.hidden = !autoMode;
    if (plannerHomeBaseShell) {
      plannerHomeBaseShell.hidden = !autoMode || collapsed;
    }

    if (summary) {
      summary.textContent = getHomeBaseSummaryCopy();
    }

    if (button) {
      button.textContent = collapsed
        ? homeBaseModeSelect?.value === "auto"
          ? "Lägg till bas"
          : "Ändra bas"
        : "Klar";
    }
  }

  function ensureHomeBaseCompact() {
    if (!plannerHomeBaseShell || homeBaseCompactShell) return;
    homeBaseCompactShell = document.createElement("section");
    homeBaseCompactShell.className = "planner-base-compact";
    homeBaseCompactShell.innerHTML = `
      <div class="planner-base-compact-copy">
        <strong>Boendebas</strong>
        <p class="planner-base-compact-summary"></p>
      </div>
      <button type="button" class="planner-date-range-button planner-base-compact-button">Lägg till bas</button>
    `;
    homeBaseCompactShell.querySelector(".planner-base-compact-button")?.addEventListener("click", () => {
      homeBaseExpanded = !homeBaseExpanded;
      updateHomeBaseCompact();
      if (homeBaseExpanded) {
        window.setTimeout(() => homeBaseModeSelect?.focus(), 40);
      }
    });
    plannerHomeBaseShell.insertAdjacentElement("beforebegin", homeBaseCompactShell);
    updateHomeBaseCompact();
  }

  function syncDateRangeFields({ focusEnd = false } = {}) {
    if (!routeDateFrom || !routeDateTo) return;
    const from = routeDateFrom.value;

    if (from && (!routeDateTo.value || routeDateTo.value < from)) {
      routeDateTo.value = from;
    }

    const hasRange = Boolean(routeDateTo.value && from && routeDateTo.value !== from);
    if (!showRangeEndField && hasRange) {
      showRangeEndField = true;
    }

    const shouldShowEnd = showRangeEndField || hasRange;

    if (dateToField) {
      dateToField.hidden = !shouldShowEnd;
    }

    if (!shouldShowEnd && from) {
      routeDateTo.value = from;
    }

    updateDateRangeShell();

    if (focusEnd && shouldShowEnd) {
      window.setTimeout(() => requestDatePicker(routeDateTo), 50);
    }
  }

  function syncPlannerUxPass() {
    const autoMode = plannerModeAutoButton?.classList.contains("is-active");
    plannerModalShell.classList.toggle("is-auto-mode", Boolean(autoMode));
    plannerModalShell.classList.toggle("is-manual-mode", !autoMode);
    if (plannerFineTuneDetails && autoMode) plannerFineTuneDetails.open = false;
    syncPointInput(homeBaseModeSelect, homeBasePresetField, homeBaseCustomField);
    syncPointInput(startModeSelect, startPresetField, startCustomField);
    syncPointInput(endModeSelect, endPresetField, endCustomField);
    updateHomeBaseCompact();
    syncDateRangeFields();

    if (plannerAdvancedSummary && autoMode) {
      plannerAdvancedSummary.textContent = "Hoppa över detta om du inte behöver låsa start eller slut.";
    }
  }

  function applyLandingHierarchyPass() {
    if (tabNav) document.body.classList.add("route-focus");
    if (plannerLaunchStrip) plannerLaunchStrip.hidden = false;
  }

  function quickBaseLabel() {
    return quickBaseMeta[activeQuickBase]?.label.replace(/^📍\s*/, "") || quickBaseMeta.current.label.replace(/^📍\s*/, "");
  }

  function quickVibeLabel() {
    return quickVibeMeta[activeQuickVibe]?.label || quickVibeMeta.blend.label;
  }

  function setHeroBaseStatus(message, tone = "info") {
    heroBaseStatus = message;
    heroBaseStatusTone = tone;
    renderQuickPlannerState();
  }

  function setHeroLocationLoading(isLoading) {
    isResolvingHeroLocation = isLoading;
    if (!heroQuickPlannerShell) return;
    const currentButton = heroQuickPlannerShell.querySelector('[data-quick-base="current"]');
    if (!currentButton) return;
    currentButton.classList.toggle("is-loading", isLoading);
    currentButton.disabled = isLoading;
  }

  async function resolveHeroCurrentLocation() {
    if (typeof window.ensureCurrentLocation !== "function") {
      setHeroBaseStatus("Platsåtkomst är inte tillgänglig här just nu. Parranda kan fortfarande välja en smart bas åt dig.", "warning");
      activeQuickBase = "auto";
      window.__parrandaQuickBase = activeQuickBase;
      renderQuickPlannerState();
      return;
    }

    setHeroLocationLoading(true);
    setHeroBaseStatus("Begär platsåtkomst…", "info");

    try {
      await window.ensureCurrentLocation();
      setHeroBaseStatus("Platsåtkomst klar. Parranda använder nu din plats som bas om du fortsätter härifrån.", "success");
      if (homeBaseModeSelect) {
        homeBaseModeSelect.value = "current_location";
        dispatchNativeChange(homeBaseModeSelect);
      }
      if (routeMatchSummary) {
        routeMatchSummary.textContent = "Min plats är nu aktiv som boendebas. Fortsätt i plannern eller bygg direkt härifrån.";
      }
    } catch (_error) {
      activeQuickBase = "auto";
      window.__parrandaQuickBase = activeQuickBase;
      setHeroBaseStatus("Platsåtkomst nekades eller misslyckades. Parranda faller tillbaka till att välja en smart bas själv.", "warning");
      if (homeBaseModeSelect) {
        homeBaseModeSelect.value = "auto";
        dispatchNativeChange(homeBaseModeSelect);
      }
      if (routeMatchSummary) {
        routeMatchSummary.textContent = "Platsåtkomst gick inte igenom. Parranda står kvar i auto-läge och väljer en smart bas själv.";
      }
    } finally {
      setHeroLocationLoading(false);
      renderQuickPlannerState();
    }
  }

  function applyQuickVibeToPreferences(vibeKey) {
    const suggested = new Set((quickVibeMeta[vibeKey] || quickVibeMeta.blend).preferences);
    const checkboxes = routePlannerForm.querySelectorAll('.preference-chip input[type="checkbox"]');
    checkboxes.forEach((checkbox) => {
      checkbox.checked = suggested.has(checkbox.value);
    });
  }

  function selectDistrictButton(container, desiredLabel) {
    if (!container || !desiredLabel) return false;
    const match = [...container.querySelectorAll("button")].find((button) => button.textContent?.trim().toLowerCase().includes(desiredLabel.trim().toLowerCase()));
    if (!match) return false;
    match.click();
    return true;
  }

  function applyQuickSelectionsToPlanner() {
    if (!heroQuickPlannerShell) {
      return;
    }
    if (homeBaseModeSelect) {
      const config = quickBaseMeta[activeQuickBase] || quickBaseMeta.current;
      homeBaseModeSelect.value = config.plannerMode || "current_location";
      dispatchNativeChange(homeBaseModeSelect);
      if (config.plannerMode === "preset") {
        window.setTimeout(() => {
          selectDistrictButton(homeBaseDistrictButtons, config.plannerLabel);
        }, 80);
      }
    }
    applyQuickVibeToPreferences(activeQuickVibe);
    homeBaseExpanded = false;
    updateHomeBaseCompact();
    if (routeMatchSummary) routeMatchSummary.textContent = `Snabbval aktiva: ${quickBaseLabel()} • ${quickVibeLabel()} • ${intensityMeta[activeDayIntensity].label}.`;
  }

  function renderQuickPlannerState() {
    if (!heroQuickPlannerShell) return;
    heroQuickPlannerShell.querySelectorAll("[data-quick-base]").forEach((button) => {
      button.classList.toggle("is-active", button.dataset.quickBase === activeQuickBase);
    });
    heroQuickPlannerShell.querySelectorAll("[data-quick-vibe]").forEach((button) => {
      button.classList.toggle("is-active", button.dataset.quickVibe === activeQuickVibe);
    });
    const summary = heroQuickPlannerShell.querySelector(".hero-planner-inline-summary");
    if (summary) {
      summary.textContent = heroBaseStatus || `Bas: ${quickBaseLabel()} • Fokus: ${quickVibeLabel()} • Tempo: ${intensityMeta[activeDayIntensity].label}.`;
      summary.dataset.tone = heroBaseStatusTone;
    }
    updateResultRecap();
  }

  async function setQuickBase(nextBase) {
    activeQuickBase = quickBaseMeta[nextBase] ? nextBase : "current";
    window.__parrandaQuickBase = activeQuickBase;
    if (activeQuickBase === "current") {
      heroBaseStatus = "Min plats vald. Jag ber om platsåtkomst direkt så att dagen kan utgå från där du faktiskt är.";
      heroBaseStatusTone = "info";
      renderQuickPlannerState();
      await resolveHeroCurrentLocation();
      return;
    }
    if (activeQuickBase === "auto") {
      setHeroBaseStatus("Parranda väljer själv en smart bas för dagen. Du kan alltid byta till Min plats eller ett kvarter senare.", "info");
    } else {
      setHeroBaseStatus(`Bas låst till ${quickBaseLabel()}. Parranda använder nu kvarteret som utgångspunkt för dagen.`, "success");
    }
    renderQuickPlannerState();
  }

  function setQuickVibe(nextVibe) {
    activeQuickVibe = quickVibeMeta[nextVibe] ? nextVibe : "blend";
    window.__parrandaQuickVibe = activeQuickVibe;
    renderQuickPlannerState();
  }

  function openPlannerFromHeroInline() {
    applyQuickSelectionsToPlanner();
    heroPlannerButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  }

  function ensureHeroQuickPlanner() {
    return;
  }

  function routeIntensityMetrics(route) {
    const stopCount = Array.isArray(route?.main_stops) ? route.main_stops.length : 0;
    const estimatedKm = Number(route?.estimated_km || 0);
    const longestLegKm = Number(route?.longest_leg_km || 0);
    const averageLegMinutes = Number(route?.average_leg_minutes || 0);
    const specialCount = Array.isArray(route?.venue_specials) ? route.venue_specials.length : 0;
    const stopDensity = estimatedKm > 0 ? stopCount / estimatedKm : 0;
    return { stopCount, estimatedKm, longestLegKm, averageLegMinutes, specialCount, stopDensity, isLoop: route?.route_shape === "loop" };
  }

  function scoreRouteForIntensity(route, intensity) {
    const metrics = routeIntensityMetrics(route);
    if (intensity === "light") return Number((22 - metrics.stopCount * 3.35 - metrics.estimatedKm * 0.45 - metrics.longestLegKm * 1.5 - metrics.averageLegMinutes * 0.03 - metrics.specialCount * 0.3 + (metrics.isLoop ? 1.2 : 0) + (metrics.estimatedKm <= 8 ? 1.4 : 0) + (metrics.stopCount <= 4 ? 1.6 : 0)).toFixed(1));
    if (intensity === "dense") return Number((metrics.stopCount * 3.2 + metrics.stopDensity * 7.2 + metrics.specialCount * 0.45 - metrics.longestLegKm * 1.05 - Math.max(0, 5 - metrics.stopCount) * 1.9 + (metrics.estimatedKm >= 5.5 && metrics.estimatedKm <= 10.5 ? 1.4 : 0)).toFixed(1));
    return Number((16 - Math.abs(metrics.stopDensity - 0.56) * 6 - Math.abs(metrics.stopCount - 4.8) * 1.4 - metrics.longestLegKm * 0.95).toFixed(1));
  }

  function relabelLiveEvents(liveEvents = [], orderedRoutes = []) {
    const labelById = new Map();
    if (orderedRoutes[0]) labelById.set(orderedRoutes[0].id, { label: "Huvudrutten", title: orderedRoutes[0].title });
    orderedRoutes.slice(1).forEach((route, index) => {
      labelById.set(route.id, { label: `Alternativ ${index + 1}`, title: route.title });
    });
    return liveEvents.map((event) => {
      const replacement = labelById.get(event.best_route_id);
      return replacement ? { ...event, best_route_label: replacement.label, best_route_title: replacement.title } : event;
    });
  }

  function buildIntensityNote(intensity, route) {
    const metrics = routeIntensityMetrics(route);
    if (intensity === "light") return `Intensitet: lugn. Den här versionen håller dagen mjukare med ${metrics.stopCount} tydliga stopp och mindre packat tempo.`;
    if (intensity === "dense") return `Intensitet: tät. Den här versionen pressar upp innehållet till ${metrics.stopCount} stopp utan att låta benen dra iväg för mycket.`;
    return `Intensitet: normal. Den här versionen håller en mer balanserad rytm mellan stopp, benlängd och kvällsenergi.`;
  }

  function annotatePrimaryRoute(route, intensity) {
    if (!route) return route;
    const note = buildIntensityNote(intensity, route);
    const currentWhy = String(route.why_recommended || "").trim();
    return { ...route, intensity_mode: intensity, intensity_fit_note: note, why_recommended: currentWhy ? `${currentWhy} ${note}` : note };
  }

  function applyIntensityToResult(result, intensity) {
    if (!result || !Array.isArray(result.days) || !result.days.length || intensity === "normal") return result;
    return {
      ...result,
      days: result.days.map((day) => {
        if (!day?.primary_route) return day;
        const candidates = [day.primary_route, ...(Array.isArray(day.alternatives) ? day.alternatives : [])];
        const ordered = [...candidates].sort((left, right) => {
          const leftScore = scoreRouteForIntensity(left, intensity);
          const rightScore = scoreRouteForIntensity(right, intensity);
          if (rightScore !== leftScore) return rightScore - leftScore;
          return Number(right.estimated_km || 0) - Number(left.estimated_km || 0);
        });
        const currentPrimaryScore = scoreRouteForIntensity(day.primary_route, intensity);
        const bestScore = scoreRouteForIntensity(ordered[0], intensity);
        const shouldPromote = bestScore >= currentPrimaryScore + 0.75;
        const primaryRoute = shouldPromote ? ordered[0] : day.primary_route;
        const alternatives = shouldPromote ? ordered.slice(1) : [...candidates.filter((route) => route.id !== day.primary_route.id)].sort((left, right) => {
          const leftScore = scoreRouteForIntensity(left, intensity);
          const rightScore = scoreRouteForIntensity(right, intensity);
          if (rightScore !== leftScore) return rightScore - leftScore;
          return Number(right.estimated_km || 0) - Number(left.estimated_km || 0);
        });
        const orderedRoutes = [primaryRoute, ...alternatives];
        return { ...day, primary_route: annotatePrimaryRoute(primaryRoute, intensity), alternatives, live_events: relabelLiveEvents(day.live_events || [], orderedRoutes) };
      }),
    };
  }

  function syncIntensityButtons() {
    if (!intensityShell) return;
    intensityShell.querySelectorAll(".planner-intensity-button").forEach((button) => {
      button.classList.toggle("is-active", button.dataset.dayIntensity === activeDayIntensity);
      button.setAttribute("aria-pressed", String(button.dataset.dayIntensity === activeDayIntensity));
    });
  }

  function setDayIntensity(nextIntensity) {
    activeDayIntensity = intensityMeta[nextIntensity] ? nextIntensity : "normal";
    window.__parrandaDayIntensity = activeDayIntensity;
    syncIntensityButtons();
    if (!heroBaseStatus || heroBaseStatusTone === "info") {
      heroBaseStatus = `Bas: ${quickBaseLabel()} • Fokus: ${quickVibeLabel()} • Tempo: ${intensityMeta[activeDayIntensity].label}.`;
    }
    renderQuickPlannerState();
  }

  function ensureIntensityUi() {
    if (!plannerKmReadout || intensityShell) return;
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
      button.addEventListener("click", () => setDayIntensity(key));
      buttonRow.appendChild(button);
    });
    plannerKmReadout.insertAdjacentElement("afterend", intensityShell);
    syncIntensityButtons();
  }

  function formatCompactSwedishDate(dateString) {
    if (!dateString) return "";
    return new Intl.DateTimeFormat("sv-SE", { day: "numeric", month: "short" }).format(new Date(`${dateString}T12:00:00`));
  }

  function updateDateRangeShell() {
    if (!dateRangeShell) return;
    const label = dateRangeShell.querySelector(".planner-date-range-label");
    const addButton = dateRangeShell.querySelector(".planner-date-range-add");
    const clearButton = dateRangeShell.querySelector(".planner-date-range-clear");
    if (!label || !addButton || !clearButton) return;
    const from = routeDateFrom?.value;
    const to = routeDateTo?.value;
    const dayCount = getPlannerDayCount();

    if (!from && !to) {
      label.textContent = "Välj datum";
      addButton.textContent = "Välj datum";
      clearButton.hidden = true;
      return;
    }

    if (!to || from === to) {
      label.textContent = `${formatCompactSwedishDate(from || to)} • 1 dag`;
      addButton.textContent = "Lägg slutdatum";
      clearButton.hidden = true;
      return;
    }

    label.textContent = `${formatCompactSwedishDate(from)} → ${formatCompactSwedishDate(to)} • ${dayCount} dagar`;
    addButton.textContent = "Ändra slutdatum";
    clearButton.hidden = false;
  }

  function ensureDateRangeShell() {
    if (!routeDateFrom || !routeDateTo || dateRangeShell) return;
    const grid = routeDateFrom.closest(".planner-inline-grid");
    if (!grid) return;
    dateFromField = routeDateFrom.closest("label");
    dateToField = routeDateTo.closest("label");
    const fromSpan = dateFromField?.querySelector("span");
    const toSpan = dateToField?.querySelector("span");
    if (fromSpan) fromSpan.textContent = "Start";
    if (toSpan) toSpan.textContent = "Slut";
    dateRangeShell = document.createElement("section");
    dateRangeShell.className = "planner-date-range-shell";
    dateRangeShell.innerHTML = `
      <div>
        <strong>Resedatum</strong>
        <p class="planner-date-range-label"></p>
      </div>
      <div class="planner-date-range-actions">
        <button type="button" class="planner-date-range-button planner-date-range-add">Välj datum</button>
        <button type="button" class="ghost-button planner-date-range-clear" hidden>1 dag</button>
      </div>
    `;
    const addButton = dateRangeShell.querySelector(".planner-date-range-add");
    const clearButton = dateRangeShell.querySelector(".planner-date-range-clear");
    addButton?.addEventListener("click", () => {
      if (!routeDateFrom.value) {
        requestDatePicker(routeDateFrom);
        return;
      }
      showRangeEndField = true;
      syncDateRangeFields({ focusEnd: true });
    });
    clearButton?.addEventListener("click", () => {
      if (!routeDateFrom.value) return;
      showRangeEndField = false;
      routeDateTo.value = routeDateFrom.value;
      dispatchNativeChange(routeDateTo);
      syncDateRangeFields();
    });
    grid.insertBefore(dateRangeShell, grid.firstChild);
    syncDateRangeFields();
  }

  function ensureResultRecapStrip() {
    if (resultRecapStrip || !routeResults.parentNode) return;
    resultRecapStrip = document.createElement("section");
    resultRecapStrip.className = "results-recap-strip";
    resultRecapStrip.innerHTML = `
      <div class="results-recap-copy">
        <span>DIN DAG I ROM</span>
        <strong></strong>
        <p></p>
      </div>
      <button type="button" class="primary-button">Ändra val</button>
    `;
    resultRecapStrip.querySelector("button")?.addEventListener("click", () => heroPlannerButton?.click());
    routeResults.parentNode.insertBefore(resultRecapStrip, routeResults);
  }

  function updateResultRecap() {
    ensureResultRecapStrip();
    const hasResults = Boolean(routeResults.querySelector(".planner-results-shell"));
    document.body.classList.toggle("has-live-results", hasResults);
    if (!resultRecapStrip) return;
    resultRecapStrip.classList.toggle("is-visible", hasResults);
    if (!hasResults) return;
    const activeDay = routeResults.querySelector(".planner-day-tab.is-active")?.textContent?.trim() || "Dag 1";
    const activeTitle = routeResults.querySelector(".planner-day-title")?.textContent?.trim() || "Din huvudrutt";
    const strong = resultRecapStrip.querySelector("strong");
    const text = resultRecapStrip.querySelector("p");
    if (strong) strong.textContent = activeTitle;
    if (text) text.textContent = `${activeDay} • ${quickBaseLabel()} • ${quickVibeLabel()} • ${intensityMeta[activeDayIntensity].label}. Öppna plannern om du vill justera.`;
  }

  function focusResults() {
    if (resultFocusTimer) clearTimeout(resultFocusTimer);
    resultFocusTimer = window.setTimeout(() => {
      updateResultRecap();
      routeResults.scrollIntoView({ behavior: "smooth", block: "start" });
      const focusTarget = routeResults.querySelector(".planner-day-tab.is-active") || routeResults.querySelector(".planner-day-tab") || routeResults.querySelector(".planner-alt-toggle") || routeResults.querySelector(".route-select-button");
      if (focusTarget && typeof focusTarget.focus === "function") focusTarget.focus({ preventScroll: true });
    }, 260);
  }

  function maybeFocusResults() {
    if (!pendingResultFocus) {
      updateResultRecap();
      return;
    }
    if (!plannerModalShell.hidden) return;
    if (!routeResults.children.length) return;
    pendingResultFocus = false;
    focusResults();
  }

  function markPlanningIntent() {
    pendingResultFocus = true;
  }

  function patchFetchForIntensity() {
    if (window.__parrandaIntensityFetchPatched) return;
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input?.url || "";
      let nextInit = init;
      if (url.includes("/api/route-recommendations") && init?.body) {
        try {
          const parsedBody = JSON.parse(init.body);
          parsedBody.day_intensity = activeDayIntensity;
          nextInit = { ...init, body: JSON.stringify(parsedBody) };
        } catch (_error) {
          nextInit = init;
        }
      }
      const response = await originalFetch(input, nextInit);
      if (!url.includes("/api/route-recommendations")) return response;
      try {
        const text = await response.text();
        const parsed = JSON.parse(text);
        const modified = applyIntensityToResult(parsed, activeDayIntensity);
        const headers = new Headers(response.headers);
        headers.set("content-type", "application/json");
        return new Response(JSON.stringify(modified), { status: response.status, statusText: response.statusText, headers });
      } catch (_error) {
        return response;
      }
    };
    window.__parrandaIntensityFetchPatched = true;
  }

  heroPlannerButton?.addEventListener("click", applyQuickSelectionsToPlanner, true);
  routePlannerOpenButton?.addEventListener("click", applyQuickSelectionsToPlanner, true);
  plannerModeAutoButton?.addEventListener("click", () => window.setTimeout(syncPlannerUxPass, 0));
  plannerModeManualButton?.addEventListener("click", () => window.setTimeout(syncPlannerUxPass, 0));
  homeBaseModeSelect?.addEventListener("change", () => {
    homeBaseExpanded = true;
    syncPlannerUxPass();
  });
  startModeSelect?.addEventListener("change", syncPlannerUxPass);
  endModeSelect?.addEventListener("change", syncPlannerUxPass);
  homeBasePresetSelect?.addEventListener("change", updateHomeBaseCompact);
  homeBaseCustomInput?.addEventListener("input", updateHomeBaseCompact);
  routeDateFrom?.addEventListener("change", () => {
    if (!routeDateFrom.value) return;
    if (!showRangeEndField) {
      routeDateTo.value = routeDateFrom.value;
    }
    syncDateRangeFields({ focusEnd: showRangeEndField && routeDateTo.value === routeDateFrom.value });
  });
  routeDateTo?.addEventListener("change", () => {
    showRangeEndField = Boolean(routeDateTo.value && routeDateFrom.value && routeDateTo.value !== routeDateFrom.value);
    syncDateRangeFields();
  });
  routePlanButton?.addEventListener("click", markPlanningIntent);
  routePlanStickyButton?.addEventListener("click", markPlanningIntent);
  routePlannerForm.addEventListener("submit", markPlanningIntent);

  const modeObserver = new MutationObserver(() => syncPlannerUxPass());
  if (plannerModeAutoButton) modeObserver.observe(plannerModeAutoButton, { attributes: true, attributeFilter: ["class"] });
  if (plannerModeManualButton) modeObserver.observe(plannerModeManualButton, { attributes: true, attributeFilter: ["class"] });

  const resultsObserver = new MutationObserver(() => maybeFocusResults());
  resultsObserver.observe(routeResults, { childList: true, subtree: true });

  const modalObserver = new MutationObserver(() => maybeFocusResults());
  modalObserver.observe(plannerModalShell, { attributes: true, attributeFilter: ["hidden", "class"] });
  if (plannerModalBackdrop) modalObserver.observe(plannerModalBackdrop, { attributes: true, attributeFilter: ["hidden", "class"] });

  applyLandingHierarchyPass();
  ensureHeroQuickPlanner();
  ensureIntensityUi();
  ensureDateRangeShell();
  ensureHomeBaseCompact();
  ensureResultRecapStrip();
  patchFetchForIntensity();
  syncPlannerUxPass();
  syncIntensityButtons();
  renderQuickPlannerState();
  updateDateRangeShell();
  updateResultRecap();
})();
