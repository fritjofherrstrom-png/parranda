(function () {
  "use strict";

  var cityInput = document.getElementById("lpCity");
  var plannerCta = document.getElementById("lpPlannerCta");
  var plannerCtaLabel = document.getElementById("lpPlannerCtaLabel");
  var plannerForm = document.getElementById("lpPlannerForm");
  var REGISTRY = window.__PARRANDA_CITIES__ || {};
  var COPY = window.__PARRANDA_LANDING_COPY__ || {};

  function escapeForDOM(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function currentLang() {
    return window.__PARRANDA_LANGUAGE__ || "sv";
  }

  function resolveEntry(raw) {
    return REGISTRY[String(raw || "").trim().toLowerCase()] || null;
  }

  function resolveCity(raw) {
    var entry = resolveEntry(raw);
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

  (function setupLanguageToggle() {
    var lang = currentLang();
    var svBtn = document.getElementById("lpLangSv");
    var enBtn = document.getElementById("lpLangEn");
    if (!svBtn || !enBtn) return;
    function markActive() {
      svBtn.classList.toggle("lp-lang-toggle__btn--active", lang === "sv");
      enBtn.classList.toggle("lp-lang-toggle__btn--active", lang === "en");
      svBtn.setAttribute("aria-pressed", lang === "sv" ? "true" : "false");
      enBtn.setAttribute("aria-pressed", lang === "en" ? "true" : "false");
    }
    function switchLang(nextLang) {
      var params = new URLSearchParams(window.location.search);
      if (nextLang === "sv") params.delete("lang");
      else params.set("lang", nextLang);
      var qs = params.toString();
      window.location.href = window.location.pathname + (qs ? "?" + qs : "");
    }
    markActive();
    svBtn.addEventListener("click", function () { switchLang("sv"); });
    enBtn.addEventListener("click", function () { switchLang("en"); });
  }());

  if (cityInput) {
    cityInput.addEventListener("input", function () {
      cityInput.setCustomValidity("");
      updateCtaState();
    });
  }

  if (plannerForm) {
    plannerForm.addEventListener("submit", function (e) {
      e.preventDefault();
      var val = cityInput ? cityInput.value : "";
      var cityPath = resolveCity(val);
      if (cityPath) {
        var langParam = currentLang() === "en" ? "?lang=en" : "";
        window.location.href = cityPath + "/plan" + langParam;
        return;
      }
      if (val.trim()) {
        cityInput.setCustomValidity(COPY.unsupported || "Vi är live i Barcelona och Rom just nu. Prova en av dem!");
        cityInput.reportValidity();
        setTimeout(function () { cityInput.setCustomValidity(""); }, 3000);
      }
    });
  }

  document.querySelectorAll('a[href="#planner"]').forEach(function (link) {
    link.addEventListener("click", function (e) {
      e.preventDefault();
      var planner = document.getElementById("planner");
      if (planner) planner.scrollIntoView({ behavior: "smooth", block: "start" });
      if (cityInput) setTimeout(function () { cityInput.focus(); }, 400);
    });
  });

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

  var sectionUseBtn = document.getElementById("lpBlitzSectionUse");
  if (sectionUseBtn) {
    sectionUseBtn.addEventListener("click", function () {
      var planner = document.getElementById("planner");
      if (planner) planner.scrollIntoView({ behavior: "smooth", block: "start" });
      if (cityInput) setTimeout(function () { cityInput.focus(); }, 400);
    });
  }

  var blitzSheet = document.getElementById("lpBlitzSheet");
  var blitzBody = document.getElementById("lpBlitzBody");
  var blitzClose = document.getElementById("lpBlitzClose");
  var blitzBackdrop = document.getElementById("lpBlitzBackdrop");
  var blitzUseBtn = document.getElementById("lpBlitzUse");
  var blitzReblitzBtn = document.getElementById("lpBlitzReblitz");
  var blitzPlanBtn = document.getElementById("lpBlitzPlan");
  var blitzCtaBtn = document.getElementById("lpBlitzCta");
  var landingBlitzState = null;
  var landingBlitzMemory = null;
  var landingBlitzCity = null;

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
    var best = null, bestDist = Infinity, seen = {};
    Object.values(REGISTRY).forEach(function (entry) {
      if (!entry.center || seen[entry.key]) return;
      seen[entry.key] = true;
      var d = haversineKm({ lat: lat, lng: lng }, entry.center);
      if (d < bestDist) { bestDist = d; best = entry; }
    });
    return bestDist <= 100 ? best : null;
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
    if (blitzUseBtn) blitzUseBtn.disabled = !enabled;
    if (blitzReblitzBtn) blitzReblitzBtn.disabled = !enabled;
    if (blitzPlanBtn) blitzPlanBtn.disabled = !enabled;
  }

  function setBlitzLoading() {
    if (blitzBody) {
      blitzBody.innerHTML = "<p class='lp-blitz-result__loading'>" +
        escapeForDOM(COPY.blitzLoading || "Letar…") + "</p>";
    }
    setBlitzFooterEnabled(false);
  }

  function getBlitzPrimaryStop(state) {
    var move = state && state.best_move;
    if (!move) return null;
    return move.stop || (move.route && move.route.stops && move.route.stops[0]) || null;
  }

  var STOP_TYPE_LABELS = {
    sv: {
      bar: "Bar",
      beer_bar: "Ölbar",
      wine_bar: "Vinbar",
      restaurant: "Restaurang",
      trattoria: "Restaurang",
      cafe: "Kafé",
      coffee: "Kafé",
      bakery: "Bageri",
      market: "Marknad",
      bookstore: "Bokhandel",
      shop: "Butik",
      store: "Butik",
      second_hand: "Second hand",
      vintage: "Second hand",
      museum: "Museum",
      gallery: "Galleri",
      cinema: "Bio",
      church: "Kyrka",
      landmark: "Landmärke",
      viewpoint: "Utsikt",
      square: "Torg",
      district: "Kvarter",
      cemetery: "Kyrkogård",
      park: "Park"
    },
    en: {
      bar: "Bar",
      beer_bar: "Beer bar",
      wine_bar: "Wine bar",
      restaurant: "Restaurant",
      trattoria: "Restaurant",
      cafe: "Café",
      coffee: "Café",
      bakery: "Bakery",
      market: "Market",
      bookstore: "Bookstore",
      shop: "Shop",
      store: "Shop",
      second_hand: "Second hand",
      vintage: "Second hand",
      museum: "Museum",
      gallery: "Gallery",
      cinema: "Cinema",
      church: "Church",
      landmark: "Landmark",
      viewpoint: "Viewpoint",
      square: "Square",
      district: "District",
      cemetery: "Cemetery",
      park: "Park"
    }
  };

  function formatStopType(type, lang) {
    var raw = String(type || "").toLowerCase().replace(/-/g, "_");
    if (!raw) return "";
    var map = STOP_TYPE_LABELS[lang] || STOP_TYPE_LABELS.sv;
    return map[raw] || raw.replace(/_/g, " ").replace(/^./, function (c) { return c.toUpperCase(); });
  }

  function buildPlaceInfoUrl(stop) {
    if (!stop) return "";
    var label = stop.label || stop.name || "";
    var query = [label, stop.area, landingBlitzCity].filter(Boolean).join(" ");
    if (!query && stop.lat && stop.lng) query = String(stop.lat) + "," + String(stop.lng);
    return query ? "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(query) : "";
  }

  function buildDirectionsUrl(stop) {
    if (!stop) return "";
    var destination = stop.lat && stop.lng
      ? String(stop.lat) + "," + String(stop.lng)
      : (stop.label || stop.name || "");
    return destination
      ? "https://www.google.com/maps/dir/?api=1&destination=" + encodeURIComponent(destination) + "&travelmode=walking"
      : "";
  }

  function renderBlitzResult(state) {
    if (!blitzBody) return;
    var move = state && state.best_move;
    if (!move) { blitzBody.textContent = ""; return; }
    var lang = currentLang();
    var title = move.title || "";
    var why = move.why_now || "";
    var stop = getBlitzPrimaryStop(state);
    var area = stop ? (stop.area || "") : "";
    var typeLabel = stop ? formatStopType(stop.type, lang) : "";
    var walkMins = move.walking_minutes ? move.walking_minutes + " min" : "";
    var meta = [typeLabel, area, walkMins].filter(Boolean).join(" · ");
    var infoUrl = buildPlaceInfoUrl(stop);
    var infoHtml = infoUrl
      ? "<a class='lp-blitz-result__info' href='" + escapeForDOM(infoUrl) + "' target='_blank' rel='noopener'>" +
          escapeForDOM(COPY.blitzInfo || "Info") + "</a>"
      : "";
    var signalLabel = move.pulse_context && move.pulse_context.signal_label;
    var chipHtml = signalLabel
      ? "<span class='lp-blitz-result__signal-chip'>" + escapeForDOM(signalLabel) + "</span>"
      : "";

    blitzBody.innerHTML =
      "<p class='lp-blitz-result__title'>" + escapeForDOM(title) + chipHtml + "</p>" +
      (why ? "<p class='lp-blitz-result__why'>" + escapeForDOM(why) + "</p>" : "") +
      (meta ? "<p class='lp-blitz-result__meta'>" + escapeForDOM(meta) + "</p>" : "") +
      infoHtml;
    setBlitzFooterEnabled(true);
  }

  function runBlitzForCity(cityKey) {
    if (landingBlitzCity && landingBlitzCity !== cityKey) landingBlitzMemory = null;
    landingBlitzCity = cityKey;
    setBlitzLoading();
    openBlitzSheet();
    var payload = { city: cityKey, lang: currentLang() };
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
        landingBlitzState = data;
        landingBlitzMemory = data.memory || null;
        renderBlitzResult(data);
      })
      .catch(function () {
        landingBlitzState = null;
        landingBlitzMemory = null;
        setBlitzFooterEnabled(false);
        if (blitzBody) {
          blitzBody.innerHTML = "<p class='lp-blitz-result__error'>" +
            escapeForDOM(COPY.blitzError || "Något gick fel. Försök igen.") + "</p>";
        }
      });
  }

  function handleBlitzTap() {
    var val = cityInput ? cityInput.value.trim() : "";
    var entry = val ? resolveEntry(val) : null;
    if (entry) { runBlitzForCity(entry.key); return; }
    if (val) {
      if (cityInput) {
        cityInput.setCustomValidity(COPY.unsupported || "Vi är live i Barcelona och Rom just nu. Prova en av dem!");
        cityInput.reportValidity();
        setTimeout(function () { cityInput.setCustomValidity(""); }, 3000);
      }
      return;
    }
    if (!navigator.geolocation) {
      if (cityInput) {
        cityInput.setCustomValidity(COPY.blitzGeoFallback || "Skriv en stad eller välj Barcelona/Rom.");
        cityInput.reportValidity();
        setTimeout(function () { cityInput.setCustomValidity(""); }, 4000);
      }
      return;
    }
    navigator.geolocation.getCurrentPosition(function (pos) {
      var nearest = nearestSupportedCity(pos.coords.latitude, pos.coords.longitude);
      if (nearest) { runBlitzForCity(nearest.key); return; }
      openBlitzSheet();
      if (blitzBody) {
        blitzBody.innerHTML = "<p class='lp-blitz-result__no-city'>" +
          escapeForDOM(COPY.blitzNoCity || "Ingen stad nära dig just nu. Prova Barcelona eller Rom.") + "</p>";
      }
      setBlitzFooterEnabled(false);
    }, function () {
      if (cityInput) {
        cityInput.setCustomValidity(COPY.blitzGeoFallback || "Skriv en stad eller välj Barcelona/Rom.");
        cityInput.reportValidity();
        setTimeout(function () { cityInput.setCustomValidity(""); }, 4000);
      }
    }, { timeout: 8000 });
  }

  if (blitzCtaBtn) blitzCtaBtn.addEventListener("click", handleBlitzTap);
  if (blitzClose) blitzClose.addEventListener("click", closeBlitzSheet);
  if (blitzBackdrop) blitzBackdrop.addEventListener("click", closeBlitzSheet);
  if (blitzReblitzBtn) {
    blitzReblitzBtn.addEventListener("click", function () {
      var city = landingBlitzState && landingBlitzState.city;
      if (city) runBlitzForCity(city);
    });
  }
  if (blitzUseBtn) {
    blitzUseBtn.addEventListener("click", function () {
      var url = buildDirectionsUrl(getBlitzPrimaryStop(landingBlitzState));
      if (url) window.open(url, "_blank", "noopener");
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
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && blitzSheet && !blitzSheet.hasAttribute("hidden")) closeBlitzSheet();
  });
})();
