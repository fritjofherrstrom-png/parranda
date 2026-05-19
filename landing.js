(function () {
  "use strict";

  var cityInput = document.getElementById("lpCity");
  var plannerCta = document.getElementById("lpPlannerCta");
  var plannerForm = document.getElementById("lpPlannerForm");

  var CITY_MAP = {
    barcelona: "/barcelona",
    "barcelone": "/barcelona",
    rom: "/rome",
    rome: "/rome",
    roma: "/rome",
  };

  function resolveCity(raw) {
    return CITY_MAP[raw.trim().toLowerCase()] || null;
  }

  function updateCtaState() {
    var val = cityInput ? cityInput.value.trim() : "";
    var enabled = val.length > 0;
    if (plannerCta) {
      plannerCta.disabled = !enabled;
      plannerCta.setAttribute("aria-disabled", enabled ? "false" : "true");
      plannerCta.textContent = "";
      var label = document.createTextNode(enabled ? "Bygg min dag" : "Välj stad först");
      plannerCta.appendChild(label);
      var arrow = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      arrow.setAttribute("width", "16");
      arrow.setAttribute("height", "16");
      arrow.setAttribute("viewBox", "0 0 24 24");
      arrow.setAttribute("fill", "none");
      arrow.setAttribute("stroke", "currentColor");
      arrow.setAttribute("stroke-width", "1.75");
      arrow.setAttribute("stroke-linecap", "round");
      arrow.setAttribute("stroke-linejoin", "round");
      arrow.setAttribute("aria-hidden", "true");
      arrow.innerHTML = '<line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>';
      plannerCta.appendChild(arrow);
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
        cityInput.setCustomValidity("Vi är live i Barcelona och Rom just nu. Prova en av dem!");
        cityInput.reportValidity();
        setTimeout(function () { cityInput.setCustomValidity(""); }, 3000);
      }
    });
  }

  /* ── CTA-länkar → scroll till planerare + fokusera stadsökfältet ── */
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

  /* ── "Använd en av dem" → scroll till planerare + fokus ── */
  var useBtn = document.getElementById("lpBlitzUse");
  if (useBtn) {
    useBtn.addEventListener("click", function () {
      var planner = document.getElementById("planner");
      if (planner) planner.scrollIntoView({ behavior: "smooth", block: "start" });
      if (cityInput) setTimeout(function () { cityInput.focus(); }, 400);
    });
  }
})();
