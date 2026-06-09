/**
 * Dogfood page (#264) — browser-only DOM glue.
 *
 * Reads the form, POSTs to /api/route-recommendations with the experiment flag
 * and `include_external_candidates=1` (hardcoded — see the on-page disclosure),
 * runs the response through the shared `DogfoodRender` module (the same module
 * tests cover), and walks the resulting "view" structure to assemble DOM.
 *
 * Map renderer is local to this file: it consumes ONLY
 *   `primary_route.map_path_points` + `primary_route.main_stops`
 * and draws a Leaflet polyline + circle markers. No baseline `script.js` refactor.
 */

(function () {
  "use strict";

  var Render = window.DogfoodRender;
  if (!Render) {
    console.error("DogfoodRender missing — /dogfood-render.js failed to load");
    return;
  }

  // The bootstrap payload (see buildClientI18nPayload in server/ui-i18n.js)
  // looks like { fallbackLanguage, supportedLanguages, translations:{sv:{...},en:{...}} }.
  // DogfoodRender takes a flat-strings object — flatten to the active language
  // here, with the fallback language as a safety net.
  var rawI18n = window.__PARRANDA_I18N__ || {};
  var activeLang = window.__PARRANDA_LANGUAGE__ || rawI18n.fallbackLanguage || "en";
  var translations = (rawI18n.translations || {});
  var i18n = {
    lang: activeLang,
    strings: Object.assign(
      {},
      translations[rawI18n.fallbackLanguage || "en"] || {},
      translations[activeLang] || {},
    ),
  };

  function t(key, fallback) {
    return Render.translate(i18n, key, fallback);
  }

  function $(id) {
    return document.getElementById(id);
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = String(text);
    return node;
  }

  function readFormPayload() {
    var place = ($("dogfoodPlace").value || "").trim();
    var latRaw = ($("dogfoodLat").value || "").trim();
    var lngRaw = ($("dogfoodLng").value || "").trim();
    var date = ($("dogfoodDate").value || "").trim();
    var prefsRaw = ($("dogfoodPrefs").value || "").trim();
    var preferences = prefsRaw
      ? prefsRaw.split(",").map(function (p) { return p.trim(); }).filter(Boolean)
      : ["food", "coffee", "scenic"];
    var body = {
      // Recognized citypacks bypass the experiment; supplying an unknown key
      // forces the agnostic gate.
      city: "agnostic-dogfood",
      dates: date ? [date] : [],
      preferences: preferences,
      // Hardcoded per #264 scope — the dogfood is explicitly for exercising
      // the experiment, which requires trusted source-backed candidates.
      include_external_candidates: 1,
    };
    if (place) body.place = place;
    if (latRaw !== "" && lngRaw !== "") {
      var lat = Number(latRaw);
      var lng = Number(lngRaw);
      if (isFinite(lat) && isFinite(lng)) {
        body.lat = lat;
        body.lng = lng;
      }
    }
    return body;
  }

  // ----- map renderer (tiny, local, polyline + markers only) ---------------

  var leafletMap = null;
  var leafletLayer = null;

  function ensureMap() {
    if (!window.L) return null;
    var container = $("dogfoodMap");
    if (!container) return null;
    if (!leafletMap) {
      container.setAttribute("aria-hidden", "false");
      leafletMap = window.L.map(container, { zoomControl: true, attributionControl: true })
        .setView([41.9, 12.49], 13);
      window.L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      }).addTo(leafletMap);
      leafletLayer = window.L.layerGroup().addTo(leafletMap);
    }
    return leafletMap;
  }

  function drawDogfoodMap(route) {
    var map = ensureMap();
    if (!map || !leafletLayer) return;
    leafletLayer.clearLayers();
    if (!route) return;
    var path = Array.isArray(route.mapPathPoints) ? route.mapPathPoints : [];
    var stops = Array.isArray(route.mapStops) ? route.mapStops : [];
    var coords = path
      .filter(function (p) { return p && isFinite(p.lat) && isFinite(p.lng); })
      .map(function (p) { return [p.lat, p.lng]; });
    if (coords.length >= 2) {
      window.L.polyline(coords, { color: "#af4d24", weight: 5, opacity: 0.88 }).addTo(leafletLayer);
    }
    stops.forEach(function (stop, index) {
      var marker = window.L.circleMarker([stop.lat, stop.lng], {
        radius: 6,
        color: "#7f2d1a",
        weight: 2,
        fillColor: index === 0 ? "#d7a04d" : index === stops.length - 1 ? "#61715a" : "#af4d24",
        fillOpacity: 0.9,
      });
      var label = stop.label || stop.id || "";
      if (label) marker.bindTooltip(label, { direction: "top" });
      marker.addTo(leafletLayer);
    });
    if (coords.length >= 2) {
      try { map.fitBounds(coords, { padding: [40, 40] }); } catch (_e) { /* ignore */ }
    } else if (stops.length) {
      map.setView([stops[0].lat, stops[0].lng], 14);
    }
  }

  // ----- DOM assembly from the shared view structure ------------------------

  function renderBlockers(view) {
    var node = $("dogfoodBlockers");
    clear(node);
    if (!view.blockers || !view.blockers.length) {
      node.hidden = true;
      return;
    }
    node.hidden = false;
    var heading = el("h3", "dogfood-section-subheading", t("dogfood.blockers.heading", "Honest blockers"));
    node.appendChild(heading);
    var list = el("ul", "dogfood-blocker-list");
    view.blockers.forEach(function (tile) {
      var item = el("li", "dogfood-blocker-tile");
      item.setAttribute("data-token", tile.token);
      item.appendChild(el("span", "dogfood-blocker-token", tile.token));
      item.appendChild(el("span", "dogfood-blocker-caption", tile.caption));
      list.appendChild(item);
    });
    node.appendChild(list);
  }

  function renderRoute(view) {
    var node = $("dogfoodRoute");
    clear(node);
    var mapDiv = $("dogfoodMap");
    if (!view.route) {
      node.hidden = true;
      mapDiv.hidden = true;
      drawDogfoodMap(null);
      return;
    }
    node.hidden = false;
    mapDiv.hidden = false;
    var route = view.route;
    if (route.title) node.appendChild(el("h3", "dogfood-route-title", route.title));
    if (route.summary) node.appendChild(el("p", "dogfood-route-summary", route.summary));

    var meta = el("ul", "dogfood-route-meta");
    if (route.orderConfidence) {
      meta.appendChild(el("li", "dogfood-route-meta-item",
        t("dogfood.route.orderConfidence", "Order confidence") + ": " + route.orderConfidence));
    }
    if (route.orderSource) {
      meta.appendChild(el("li", "dogfood-route-meta-item",
        t("dogfood.route.orderSource", "Order source") + ": " + route.orderSource));
    }
    if (route.routingSource) {
      meta.appendChild(el("li", "dogfood-route-meta-item",
        t("dogfood.route.routingSource", "Routing source") + ": " + route.routingSource));
    }
    if (route.estimatedKm != null) {
      meta.appendChild(el("li", "dogfood-route-meta-item",
        t("dogfood.route.estimatedKm", "Estimated walking distance") + ": " + route.estimatedKm + " km"));
    }
    if (route.estimatedWalkMinutes != null) {
      meta.appendChild(el("li", "dogfood-route-meta-item",
        t("dogfood.route.estimatedWalkMinutes", "Estimated walking minutes") + ": " + route.estimatedWalkMinutes));
    }
    node.appendChild(meta);

    if (route.stops && route.stops.length) {
      node.appendChild(el("h4", "dogfood-section-subheading", t("dogfood.route.stops", "Stops")));
      var stopList = el("ol", "dogfood-stop-list");
      route.stops.forEach(function (stop) {
        var li = el("li", "dogfood-stop-row");
        if (stop.label) li.appendChild(el("span", "dogfood-stop-label", stop.label));
        if (stop.role) li.appendChild(el("span", "dogfood-stop-role", stop.role));
        if (stop.origin) li.appendChild(el("span", "dogfood-stop-origin", stop.origin));
        if (stop.confidence) li.appendChild(el("span", "dogfood-stop-confidence", stop.confidence));
        stopList.appendChild(li);
      });
      node.appendChild(stopList);
    }

    if (route.caveats && route.caveats.length) {
      var caveatList = el("ul", "dogfood-caveat-list");
      route.caveats.forEach(function (tile) {
        var item = el("li", "dogfood-caveat-tile");
        item.setAttribute("data-token", tile.token);
        item.appendChild(el("span", "dogfood-caveat-caption", tile.caption));
        caveatList.appendChild(item);
      });
      node.appendChild(caveatList);
    }

    drawDogfoodMap(route);
  }

  function renderIntake(view) {
    var node = $("dogfoodIntake");
    clear(node);
    if (!view.intake) { node.hidden = true; return; }
    node.hidden = false;
    var intake = view.intake;
    node.appendChild(el("h3", "dogfood-section-subheading", t("dogfood.intake.heading", "Intake")));
    var dl = el("dl", "dogfood-kv");
    dl.appendChild(el("dt", "dogfood-kv-key", t("dogfood.intake.modeLabel", "Mode")));
    dl.appendChild(el("dd", "dogfood-kv-value", intake.modeLabel));
    dl.appendChild(el("dt", "dogfood-kv-key", t("dogfood.intake.statusLabel", "Status")));
    dl.appendChild(el("dd", "dogfood-kv-value", intake.statusLabel));
    if (intake.query) {
      dl.appendChild(el("dt", "dogfood-kv-key", t("dogfood.intake.query", "Query")));
      dl.appendChild(el("dd", "dogfood-kv-value", intake.query));
    }
    if (intake.resolved) {
      if (intake.resolved.label) {
        dl.appendChild(el("dt", "dogfood-kv-key", t("dogfood.intake.resolvedLabel", "Resolved label")));
        dl.appendChild(el("dd", "dogfood-kv-value", intake.resolved.label));
      }
      if (intake.resolved.confidence) {
        dl.appendChild(el("dt", "dogfood-kv-key", t("dogfood.intake.confidence", "Confidence")));
        dl.appendChild(el("dd", "dogfood-kv-value", intake.resolved.confidence));
      }
      if (intake.resolved.provenance) {
        dl.appendChild(el("dt", "dogfood-kv-key", t("dogfood.intake.provenance", "Provenance")));
        dl.appendChild(el("dd", "dogfood-kv-value", intake.resolved.provenance));
      }
      if (intake.resolved.attribution) {
        dl.appendChild(el("dt", "dogfood-kv-key", t("dogfood.intake.attribution", "Attribution")));
        dl.appendChild(el("dd", "dogfood-kv-value", intake.resolved.attribution));
      }
      if (intake.resolved.license) {
        dl.appendChild(el("dt", "dogfood-kv-key", t("dogfood.intake.license", "License")));
        dl.appendChild(el("dd", "dogfood-kv-value", intake.resolved.license));
      }
    }
    node.appendChild(dl);
    if (intake.ambiguousCandidates && intake.ambiguousCandidates.length) {
      node.appendChild(el("h4", "dogfood-section-subheading", t("dogfood.intake.ambiguousHeading", "Ambiguous candidates")));
      var amb = el("ul", "dogfood-intake-candidates");
      intake.ambiguousCandidates.forEach(function (c) {
        var li = el("li", "dogfood-intake-candidate");
        if (c.label) li.appendChild(el("span", "dogfood-stop-label", c.label));
        if (c.confidence) li.appendChild(el("span", "dogfood-stop-confidence", c.confidence));
        if (c.provenance) li.appendChild(el("span", "dogfood-stop-origin", c.provenance));
        amb.appendChild(li);
      });
      node.appendChild(amb);
    }
  }

  function renderContext(view) {
    var node = $("dogfoodContext");
    clear(node);
    if (!view.context) { node.hidden = true; return; }
    node.hidden = false;
    var ctx = view.context;
    node.appendChild(el("h3", "dogfood-section-subheading", t("dogfood.context.heading", "Trusted weather/time context")));
    var dl = el("dl", "dogfood-kv");
    dl.appendChild(el("dt", "dogfood-kv-key", t("dogfood.context.statusLabel", "Status")));
    dl.appendChild(el("dd", "dogfood-kv-value", ctx.statusLabel + " (" + ctx.status + ")"));
    dl.appendChild(el("dt", "dogfood-kv-key", t("dogfood.context.weatherStatus", "Weather")));
    dl.appendChild(el("dd", "dogfood-kv-value", ctx.weather.status));
    if (ctx.weather.read && ctx.weather.read.headline) {
      dl.appendChild(el("dt", "dogfood-kv-key", t("dogfood.context.weatherRead", "Weather read")));
      dl.appendChild(el("dd", "dogfood-kv-value", ctx.weather.read.headline));
    }
    if (ctx.weather.read && ctx.weather.read.reason) {
      dl.appendChild(el("dt", "dogfood-kv-key", t("dogfood.context.weatherReason", "Reason")));
      dl.appendChild(el("dd", "dogfood-kv-value", ctx.weather.read.reason));
    }
    dl.appendChild(el("dt", "dogfood-kv-key", t("dogfood.context.timeStatus", "Time")));
    dl.appendChild(el("dd", "dogfood-kv-value", ctx.time.status || "—"));
    if (ctx.time.timezone) {
      dl.appendChild(el("dt", "dogfood-kv-key", t("dogfood.context.timezone", "Timezone")));
      dl.appendChild(el("dd", "dogfood-kv-value", ctx.time.timezone));
    }
    if (ctx.time.timeBand) {
      dl.appendChild(el("dt", "dogfood-kv-key", t("dogfood.context.timeBand", "Time band")));
      dl.appendChild(el("dd", "dogfood-kv-value", ctx.time.timeBand));
    }
    node.appendChild(dl);

    if (ctx.influence.weatherReasons.length || ctx.influence.timeReasons.length) {
      node.appendChild(el("h4", "dogfood-section-subheading", t("dogfood.context.influenceHeading", "Influence on composition")));
      var ul = el("ul", "dogfood-influence");
      ctx.influence.weatherReasons.forEach(function (r) { ul.appendChild(el("li", "dogfood-influence-weather", r)); });
      ctx.influence.timeReasons.forEach(function (r) { ul.appendChild(el("li", "dogfood-influence-time", r)); });
      node.appendChild(ul);
    }
    if (ctx.computedSignals && ctx.computedSignals.length) {
      node.appendChild(el("h4", "dogfood-section-subheading", t("dogfood.context.computedHeading", "Computed signals")));
      var cs = el("ul", "dogfood-computed-signals");
      ctx.computedSignals.forEach(function (s) {
        var li = el("li");
        li.appendChild(el("span", "dogfood-computed-type", s.type || "—"));
        if (s.headline) li.appendChild(el("span", "dogfood-computed-headline", s.headline));
        cs.appendChild(li);
      });
      node.appendChild(cs);
    }
  }

  function renderWalking(view) {
    var node = $("dogfoodWalking");
    clear(node);
    if (!view.walking) { node.hidden = true; return; }
    node.hidden = false;
    var w = view.walking;
    node.appendChild(el("h3", "dogfood-section-subheading", w.label));
    var dl = el("dl", "dogfood-kv");
    function add(key, label) {
      if (w[key] == null) return;
      dl.appendChild(el("dt", "dogfood-kv-key", t("dogfood.walking." + key, label)));
      dl.appendChild(el("dd", "dogfood-kv-value", String(w[key])));
    }
    add("valid", "Valid");
    add("stopCount", "Stop count");
    add("legCount", "Leg count");
    add("totalWalkKm", "Total walking km");
    add("maxLegKm", "Max leg km");
    add("totalEstimatedWalkMinutes", "Total walking minutes (estimate)");
    add("totalBudgetKm", "Total budget km");
    add("maxLegBudgetKm", "Max leg budget km");
    add("walkingSource", "Walking source");
    add("fallbackUsed", "Fallback used");
    node.appendChild(dl);
  }

  function renderSummary(view) {
    var node = $("dogfoodResultSummary");
    clear(node);
    if (!view.hasExperiment) {
      node.appendChild(el("p", "dogfood-summary-line", t("dogfood.summary.noExperiment", "No experiment block in response.")));
      return;
    }
    var variantLine = el("p", "dogfood-summary-line");
    variantLine.appendChild(el("strong", null, t("dogfood.summary.variant", "Variant") + ": "));
    variantLine.appendChild(document.createTextNode(view.selectedVariant || "—"));
    node.appendChild(variantLine);
    if (view.baselineDiff) {
      node.appendChild(el("p", "dogfood-summary-line", view.baselineDiff.caption));
    }
  }

  function applyResponseToDom(response) {
    var view = Render.buildExperimentView(response, i18n);
    var result = $("dogfoodResult");
    result.hidden = false;
    renderSummary(view);
    renderRoute(view);
    renderBlockers(view);
    renderIntake(view);
    renderContext(view);
    renderWalking(view);
    if (view.bannedWordsFound && view.bannedWordsFound.length) {
      console.warn("Dogfood: backend response contained banned vocabulary", view.bannedWordsFound);
    }
  }

  function setStatus(message, isError) {
    var node = $("dogfoodStatus");
    node.textContent = message || "";
    node.classList.toggle("dogfood-status--error", Boolean(isError));
  }

  async function submitForm(event) {
    event.preventDefault();
    setStatus(t("dogfood.status.requesting", "Requesting…"), false);
    var body = readFormPayload();
    var url = "/api/route-recommendations?lang=" + encodeURIComponent(i18n.lang) +
      "&experimental_agnostic_route_output=1";
    try {
      var response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        setStatus(t("dogfood.status.httpError", "Server returned an error: ") + response.status, true);
        return;
      }
      var json = await response.json();
      applyResponseToDom(json);
      setStatus(t("dogfood.status.done", "Done."), false);
    } catch (error) {
      setStatus(t("dogfood.status.networkError", "Network error."), true);
      console.error("Dogfood request failed", error);
    }
  }

  function init() {
    var form = $("dogfoodForm");
    if (form) form.addEventListener("submit", submitForm);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
