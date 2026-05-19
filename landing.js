(function () {
  "use strict";

  var cityInput = document.getElementById("lpCity");
  var plannerCta = document.getElementById("lpPlannerCta");
  var plannerCtaLabel = document.getElementById("lpPlannerCtaLabel");
  var plannerForm = document.getElementById("lpPlannerForm");

  var REGISTRY = window.__PARRANDA_CITIES__ || {};
  var COPY = window.__PARRANDA_LANDING_COPY__ || {};

  function resolveCity(raw) {
    var entry = REGISTRY[String(raw || "").trim().toLowerCase()];
    return entry ? "/" + entry.key : null;
  }

  function updateCtaState() {
    var val = cityInput ? cityInput.value.trim() : "";
    var enabled = val.length > 0;
    if (plannerCta) {
      plannerCta.disabled = !enabled;
      plannerCta.setAttribute("aria-disabled", enabled ? "false" : "true");
    }
    if (plannerCtaLabel) {
      plannerCtaLabel.textContent = enabled
        ? (COPY.submit || "Bygg min dag")
        : (COPY.submitDisabled || "Välj stad först");
    }
  }

  if (cityInput) {
    cityInput.addEventListener("input", updateCtaState);
  }

  if (plannerForm) {
    plannerForm.addEventListener("submit", function (e) {
      e.preventDefault();
      var val = cityInput ? cityInput.value : "";
      var cityPath = resolveCity(val);
      if (cityPath) {
        window.location.href = cityPath;
      } else if (val.trim()) {
        var msg = COPY.unsupported || "Vi är live i Barcelona och Rom just nu. Prova en av dem!";
        cityInput.setCustomValidity(msg);
        cityInput.reportValidity();
        setTimeout(function () { cityInput.setCustomValidity(""); }, 3000);
      }
    });
  }

  /* ── Hash-länkar (skip-link, nav-CTA) → scrolla till hero-sök + fokus ── */
  var ctaLinks = document.querySelectorAll('a[href="#planner"]');
  ctaLinks.forEach(function (link) {
    link.addEventListener("click", function (e) {
      e.preventDefault();
      var planner = document.getElementById("planner");
      if (planner) planner.scrollIntoView({ behavior: "smooth", block: "start" });
      if (cityInput) setTimeout(function () { cityInput.focus(); }, 400);
    });
  });

  /* ── Blitz shuffle (visual only — re-orders the three cards randomly) ── */
  function shuffleBlitz() {
    var grid = document.getElementById("lpBlitzGrid");
    if (!grid) return;
    var cards = Array.from(grid.children);
    for (var i = cards.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      grid.appendChild(cards[j]);
      cards.splice(j, 1);
    }
  }

  var shuffleBtn = document.getElementById("lpBlitzShuffle");
  var shuffleAllBtn = document.getElementById("lpBlitzShuffleAll");
  if (shuffleBtn) shuffleBtn.addEventListener("click", shuffleBlitz);
  if (shuffleAllBtn) shuffleAllBtn.addEventListener("click", shuffleBlitz);

  /* ── "Använd en av dem" → scroll till hero-sök + fokus ── */
  var useBtn = document.getElementById("lpBlitzUse");
  if (useBtn) {
    useBtn.addEventListener("click", function () {
      var planner = document.getElementById("planner");
      if (planner) planner.scrollIntoView({ behavior: "smooth", block: "start" });
      if (cityInput) setTimeout(function () { cityInput.focus(); }, 400);
    });
  }
})();
