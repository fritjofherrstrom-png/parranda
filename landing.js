(function () {
  "use strict";

  var cityInput = document.getElementById("lpCity");
  var plannerCta = document.getElementById("lpPlannerCta");
  var plannerCtaLabel = document.getElementById("lpPlannerCtaLabel");
  var plannerForm = document.getElementById("lpPlannerForm");

  var REGISTRY = window.__PARRANDA_CITIES__ || {};
  var COPY = window.__PARRANDA_LANDING_COPY__ || {};

  /* ── Language toggle ── */
  (function () {
    var currentLang = window.__PARRANDA_LANGUAGE__ || "sv";
    var svBtn = document.getElementById("lpLangSv");
    var enBtn = document.getElementById("lpLangEn");
    if (!svBtn || !enBtn) return;

    function markActive() {
      svBtn.classList.toggle("lp-lang-toggle__btn--active", currentLang === "sv");
      enBtn.classList.toggle("lp-lang-toggle__btn--active", currentLang === "en");
      svBtn.setAttribute("aria-pressed", currentLang === "sv" ? "true" : "false");
      enBtn.setAttribute("aria-pressed", currentLang === "en" ? "true" : "false");
    }

    function switchLang(lang) {
      var params = new URLSearchParams(window.location.search);
      if (lang === "sv") {
        params.delete("lang");
      } else {
        params.set("lang", lang);
      }
      var qs = params.toString();
      window.location.href = window.location.pathname + (qs ? "?" + qs : "");
    }

    markActive();
    svBtn.addEventListener("click", function () { switchLang("sv"); });
    enBtn.addEventListener("click", function () { switchLang("en"); });
  }());

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
        var params = new URLSearchParams();
        params.set("planner", "open");
        if ((window.__PARRANDA_LANGUAGE__ || "sv") === "en") {
          params.set("lang", "en");
        }
        window.location.href = cityPath + "?" + params.toString();
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

  /* ── "Använd en av dem" (section) → scroll till hero-sök + fokus ── */
  var sectionUseBtn = document.getElementById("lpBlitzSectionUse");
  if (sectionUseBtn) {
    sectionUseBtn.addEventListener("click", function () {
      var planner = document.getElementById("planner");
      if (planner) planner.scrollIntoView({ behavior: "smooth", block: "start" });
      if (cityInput) setTimeout(function () { cityInput.focus(); }, 400);
    });
  }

  /* ══════════════════════════════════════════════════════════════════════════
     BLITZ SHEET
     ══════════════════════════════════════════════════════════════════════════ */

  var blitzSheet    = document.getElementById("lpBlitzSheet");
  var blitzBody     = document.getElementById("lpBlitzBody");
  var blitzClose    = document.getElementById("lpBlitzClose");
  var blitzBackdrop = document.getElementById("lpBlitzBackdrop");
  var blitzUseBtn   = document.getElementById("lpBlitzUse");
  var blitzReblitzBtn = document.getElementById("lpBlitzReblitz");
  var blitzPlanBtn  = document.getElementById("lpBlitzPlan");
  var blitzCtaBtn   = document.getElementById("lpBlitzCta");

  var landingBlitzState  = null;
  var landingBlitzMemory = null;
  var landingBlitzCity   = null;

  function haversineKm(a, b) {
    var R = 6371;
    var dLat = (b.lat - a.lat) * Math.PI / 180;
    var dLng = (b.lng - a.lng) * Math.PI / 180;
    var lat1 = a.lat * Math.PI / 180;
    var lat2 = b.lat * Math.PI / 180;
    var x = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
  }

  function nearestSupportedCity(lat, lng) {
    var best = null, bestDist = Infinity;
    var seen = {};
    Object.values(REGISTRY).forEach(function (entry) {
      if (!entry.center || seen[entry.key]) return;
      seen[entry.key] = true;
      var d = haversineKm({ lat: lat, lng: lng }, entry.center);
      if (d < bestDist) { bestDist = d; best = entry; }
    });
    return bestDist <= 100 ? best : null;
  }

  function escapeForDOM(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;");
  }

  function openBlitzSheet() {
    if (!blitzSheet) return;
    blitzSheet.removeAttribute("hidden");
    document.body.style.overflow = "hidden";
    if (blitzClose) blitzClose.focus();
  }

  function closeBlitzSheet() {
    if (!blitzSheet) return;
    blitzSheet.setAttribute("hidden", "");
    document.body.style.overflow = "";
    if (blitzCtaBtn) blitzCtaBtn.focus();
  }

  function setBlitzFooterEnabled(enabled) {
    if (blitzUseBtn)    blitzUseBtn.disabled    = !enabled;
    if (blitzReblitzBtn) blitzReblitzBtn.disabled = !enabled;
    if (blitzPlanBtn)   blitzPlanBtn.disabled   = !enabled;
  }

  function setBlitzLoading() {
    if (blitzBody) blitzBody.innerHTML =
      "<p class='lp-blitz-result__loading'>" +
      escapeForDOM(COPY.blitzLoading || "Letar…") + "</p>";
    setBlitzFooterEnabled(false);
  }

  function getBlitzPrimaryStop(state) {
    var move = state && state.best_move;
    if (!move) return null;
    return move.stop ||
           (move.route && move.route.stops && move.route.stops[0]) ||
           null;
  }

  function renderBlitzResult(state) {
    if (!blitzBody) return;
    var move = state && state.best_move;
    if (!move) { blitzBody.textContent = ""; return; }
    var title    = move.title || "";
    var why      = move.why_now || "";
    var stop     = getBlitzPrimaryStop(state);
    var area     = stop ? (stop.area || "") : "";
    var walkMins = move.walking_minutes
      ? move.walking_minutes + " min" : "";
    var meta = [area, walkMins].filter(Boolean).join(" · ");

    var streetViewHtml = "";
    if (stop && stop.lat && stop.lng) {
      var mapsUrl = "https://www.google.com/maps?q=" +
        encodeURIComponent(stop.lat) + "," + encodeURIComponent(stop.lng) + "&layer=c";
      streetViewHtml =
        "<a class='lp-blitz-result__street-view' href='" + escapeForDOM(mapsUrl) +
        "' target='_blank' rel='noopener'>" +
        escapeForDOM(COPY.blitzStreetView || "Se gatan") + "</a>";
    }

    blitzBody.innerHTML =
      "<p class='lp-blitz-result__title'>" + escapeForDOM(title) + "</p>" +
      (why  ? "<p class='lp-blitz-result__why'>"  + escapeForDOM(why)  + "</p>" : "") +
      (meta ? "<p class='lp-blitz-result__meta'>" + escapeForDOM(meta) + "</p>" : "") +
      streetViewHtml;
    setBlitzFooterEnabled(true);
  }

  function runBlitzForCity(cityKey) {
    if (landingBlitzCity && landingBlitzCity !== cityKey) {
      landingBlitzMemory = null;
    }
    landingBlitzCity = cityKey;
    setBlitzLoading();
    openBlitzSheet();
    var lang = window.__PARRANDA_LANGUAGE__ || "sv";
    var payload = { city: cityKey, lang: lang };
    if (landingBlitzMemory) payload.memory = landingBlitzMemory;
    fetch("/api/blitz", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    })
      .then(function (r) {
        if (!r.ok) throw new Error("Blitz failed");
        return r.json();
      })
      .then(function (data) {
        if (!data || !data.best_move) throw new Error("No Blitz result");
        landingBlitzState  = data;
        landingBlitzMemory = data.memory || null;
        renderBlitzResult(data);
      })
      .catch(function () {
        landingBlitzState  = null;
        landingBlitzMemory = null;
        setBlitzFooterEnabled(false);
        if (blitzBody) blitzBody.innerHTML =
          "<p class='lp-blitz-result__error'>" +
          escapeForDOM(COPY.blitzError || "Något gick fel. Försök igen.") + "</p>";
      });
  }

  function handleBlitzTap() {
    var val = cityInput ? cityInput.value.trim() : "";
    var entry = val ? REGISTRY[val.toLowerCase()] : null;

    if (entry) {
      runBlitzForCity(entry.key);
      return;
    }

    if (val) {
      var msg = COPY.unsupported || "Vi är live i Barcelona och Rom just nu. Prova en av dem!";
      if (cityInput) {
        cityInput.setCustomValidity(msg);
        cityInput.reportValidity();
        setTimeout(function () { cityInput.setCustomValidity(""); }, 3000);
      }
      return;
    }

    /* Empty input — request geolocation */
    if (!navigator.geolocation) {
      if (cityInput) {
        cityInput.setCustomValidity(COPY.blitzGeoFallback || "Skriv en stad eller välj Barcelona/Rom.");
        cityInput.reportValidity();
        setTimeout(function () { cityInput.setCustomValidity(""); }, 4000);
      }
      return;
    }

    navigator.geolocation.getCurrentPosition(
      function (pos) {
        var nearest = nearestSupportedCity(pos.coords.latitude, pos.coords.longitude);
        if (nearest) {
          runBlitzForCity(nearest.key);
        } else {
          openBlitzSheet();
          if (blitzBody) blitzBody.innerHTML =
            "<p class='lp-blitz-result__no-city'>" +
            escapeForDOM(COPY.blitzNoCity ||
              "Ingen stad nära dig just nu. Prova Barcelona eller Rom.") + "</p>";
          setBlitzFooterEnabled(false);
        }
      },
      function () {
        if (cityInput) {
          cityInput.setCustomValidity(COPY.blitzGeoFallback || "Skriv en stad eller välj Barcelona/Rom.");
          cityInput.reportValidity();
          setTimeout(function () { cityInput.setCustomValidity(""); }, 4000);
        }
      },
      { timeout: 8000 }
    );
  }

  if (blitzCtaBtn)   blitzCtaBtn.addEventListener("click", handleBlitzTap);
  if (blitzClose)    blitzClose.addEventListener("click", closeBlitzSheet);
  if (blitzBackdrop) blitzBackdrop.addEventListener("click", closeBlitzSheet);

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && blitzSheet && !blitzSheet.hasAttribute("hidden")) {
      closeBlitzSheet();
    }
  });

  if (blitzReblitzBtn) {
    blitzReblitzBtn.addEventListener("click", function () {
      var city = landingBlitzState && landingBlitzState.city;
      if (city) runBlitzForCity(city);
    });
  }

  if (blitzUseBtn) {
    blitzUseBtn.addEventListener("click", function () {
      var city = landingBlitzState && landingBlitzState.city;
      if (!city) return;
      var lang = new URLSearchParams(window.location.search).get("lang");
      window.location.href = "/" + city + (lang ? "?lang=" + encodeURIComponent(lang) : "");
    });
  }

  if (blitzPlanBtn) {
    blitzPlanBtn.addEventListener("click", function () {
      var city = landingBlitzState && landingBlitzState.city;
      if (!city) return;
      var stop = getBlitzPrimaryStop(landingBlitzState);
      var label = stop && (stop.name || stop.label);
      var params = new URLSearchParams(window.location.search);
      params.set("planner", "open");
      params.delete("seed_label");
      params.delete("seed");
      if (label) params.set("seed_label", label);
      window.location.href = "/" + city + "?" + params.toString();
    });
  }

})();
