/**
 * Pulse view-model — the ONE place that decides what is route and what is context.
 *
 * Product hierarchy contract:
 *   - A WOVEN live event is a real route extension (it exists in
 *     primary_route.main_stops and affects walking geometry). It gets exactly one
 *     full presentation: the route-extension block. It is excluded from the
 *     general Pulse event list (a quiet reference is allowed, never a full card).
 *   - NON-woven events are Pulse context only — never route stops.
 *   - Ambient weather/clothing signals are derived context — never stops. Every
 *     helper here PARTITIONS or DERIVES from server data; nothing fabricates a
 *     stop-shaped object.
 *
 * Pure + deterministic; no DOM, no fetch — unit-tested directly.
 */

/**
 * Partition route stops into core POIs and woven live-event extensions.
 * Order is preserved; output is a partition of the input (never adds/renames).
 */
export function splitRouteStops(stops) {
  const list = Array.isArray(stops) ? stops : [];
  const core = [];
  const woven = [];
  for (const stop of list) {
    if (stop && stop.is_live_event === true) woven.push(stop);
    else core.push(stop);
  }
  return { core, woven };
}

/** Event ids of woven route stops — the exclusion set for the Pulse list. */
export function wovenEventIds(stops) {
  const ids = new Set();
  for (const stop of Array.isArray(stops) ? stops : []) {
    if (stop && stop.is_live_event === true && stop.event_id != null) ids.add(String(stop.event_id));
  }
  return ids;
}

/**
 * Pulse event buckets: pass trusted event views through, excluding events that
 * are already woven into the route (they own the route-extension presentation).
 */
export function pulseEventBuckets(liveEvents, wovenIds) {
  const exclude = wovenIds instanceof Set ? wovenIds : new Set();
  const keep = (list) =>
    (Array.isArray(list) ? list : []).filter((ev) => ev && !(ev.id != null && exclude.has(String(ev.id))));
  return {
    tonight: keep(liveEvents && liveEvents.tonight),
    thisWeek: keep(liveEvents && liveEvents.this_week),
  };
}

/** Remaining accepted events after the six highlighted rows in each bucket. */
export function pulseBrowseBuckets(liveEvents, wovenIds) {
  const exclude = wovenIds instanceof Set ? wovenIds : new Set();
  const keep = (list) =>
    (Array.isArray(list) ? list : []).filter((ev) => ev && !(ev.id != null && exclude.has(String(ev.id))));
  return {
    tonight: keep(liveEvents?.browse?.tonight?.more),
    thisWeek: keep(liveEvents?.browse?.this_week?.more),
  };
}

// Server intents in the Planner's chip vocabulary (the same aliases route
// coverage uses in route-context-view.mjs).
const PLANNER_INTENT_ALIASES = Object.freeze({
  scenic: "views",
  museums: "culture",
  coffee: "fika",
  bars: "nightlife",
  vintage: "second_hand",
});

function plannerPreferenceKeys(values) {
  const keys = [];
  for (const value of Array.isArray(values) ? values : []) {
    if (typeof value !== "string" || !value.trim()) continue;
    const key = PLANNER_INTENT_ALIASES[value.trim()] || value.trim();
    if (!keys.includes(key)) keys.push(key);
  }
  return keys;
}

/**
 * Why a Live row is shown, limited to what the SERVER established for the
 * user's current picks. Titles are never re-read here.
 *   match           → the server matched the row to these current picks
 *   looser_match    → only an adjacent (partial) server match to these picks
 *   local_discovery → the one highlight slot the server reserved for a strong
 *                     local happening outside the picks it ranked for; claimed
 *                     only while every current pick was part of that ranking
 *   null            → no claim: no picks, no server fit, or none still current
 * Preferences come back in the user's pick order and chip vocabulary.
 */
export function liveEventRelevance(ev, selectedPreferences) {
  if (!ev || typeof ev !== "object") return null;
  const selected = plannerPreferenceKeys(selectedPreferences);
  if (!selected.length) return null;
  const current = (values) => {
    const keys = plannerPreferenceKeys(values);
    return selected.filter((key) => keys.includes(key));
  };
  const level = ev.preference_match;
  const matched = level === "strong" ? current(ev.matched_preferences) : [];
  if (matched.length) return { kind: "match", preferences: matched };
  const looser = level === "strong" || level === "partial" ? current(ev.partial_preferences) : [];
  if (looser.length) return { kind: "looser_match", preferences: looser };
  const rankedFor = plannerPreferenceKeys(ev.requested_preferences);
  if (
    ev.highlight_reason === "local_serendipity" &&
    level === "none" &&
    selected.every((key) => rankedFor.includes(key))
  ) {
    return { kind: "local_discovery", preferences: [] };
  }
  return null;
}

/**
 * Split Live highlights into the rows the server matched to the current picks
 * and every other row, keeping the server's rank order inside each group. Only
 * a full match earns the picks group; looser matches and the discovery slot
 * stay with the other highlights and carry their own per-row reason.
 */
export function liveHighlightGroups(events, selectedPreferences) {
  const picks = [];
  const other = [];
  for (const ev of Array.isArray(events) ? events : []) {
    if (!ev || typeof ev !== "object") continue;
    if (liveEventRelevance(ev, selectedPreferences)?.kind === "match") picks.push(ev);
    else other.push(ev);
  }
  return { picks, other };
}

/**
 * Clothing guidance derived from the TRUSTED weather observation the day already
 * carries (dayflow_context.weather.provenance.observed). Same product rules as
 * the original Pulse (script.js) adapted to the fields available on the
 * agnostic path — `min_temp` is not observed here, so the old ≥24°∧min≥17°
 * advice band is deliberately dropped rather than guessed. Null when there is
 * no trusted observation → the cell is hidden, never invented.
 */
export function clothingAdvice(observed, lang) {
  // Guard the raw field, not its coercion — Number(null) is 0, which would
  // fabricate "jacket recommended" out of a missing observation.
  if (!observed || typeof observed.max_temp !== "number" || !Number.isFinite(observed.max_temp)) return null;
  const max = observed.max_temp;
  const en = lang === "en";
  const rainy =
    (observed && observed.condition === "rain") ||
    Number(observed && observed.precipitation_probability_max) >= 60;

  let headline;
  if (max >= 28) headline = en ? "Cool and light" : "Svalt och lätt";
  else if (max >= 22) headline = en ? "T-shirt + a light layer" : "T-shirt + lätt lager";
  else if (max >= 17) headline = en ? "Shirt + a thin jacket" : "Skjorta + tunn jacka";
  else headline = en ? "Jacket recommended" : "Jacka rekommenderas";

  let advice;
  if (max >= 30) advice = en ? "as light as possible in the middle of the day" : "så lätt som möjligt mitt på dagen";
  else if (max >= 20) advice = en ? "a light layer works daytime, a thin jacket helps the evening" : "lätt lager funkar dagtid, tunn jacka gör kvällen bättre";
  else if (max >= 15) advice = en ? "a thin jacket or knit feels smart" : "tunn jacka eller stickat känns smart";
  else advice = en ? "a jacket is recommended even daytime" : "jacka rekommenderas även dagtid";
  if (rainy) advice += en ? " · umbrella helps" : " · gärna paraply";

  return { headline, advice };
}

/**
 * Venue-local event timing across the FULL temporal contract:
 *   continuous → weekday + clock from starts_at in the event timezone; once the
 *                window is UNDERWAY the start weekday is no longer the truth
 *                (a run that began Thursday reads as a Thursday event in a
 *                "tonight" list), so an ongoing window says so instead
 *   occurrences→ the stated source date this row is about (the selected day, or
 *                the next listed date whose session has not ended) + its local
 *                clock — a listed series is never described as daily
 *   period     → the source's own date range and local clock plus "days per
 *                source": the source has not said which days carry a session
 *   daily      → "dagligen HH–HH" from local_start/local_end (already local —
 *                never re-converted through a timezone); only sources that
 *                state every-day sessions produce this kind
 *   all_day    → local date or date range from starts_on/ends_on, formatted in
 *                UTC so a date-only value never shifts across midnight
 *   unresolved → "" (timing copy is omitted, never invented)
 *
 * `now` is injectable so tests never depend on the real clock.
 */
export function eventTiming(ev, lang, now = new Date(), selectedDate = null) {
  if (!ev || typeof ev !== "object") return "";
  const en = lang === "en";
  const locale = en ? "en-GB" : "sv-SE";
  const win = ev.time_window && typeof ev.time_window === "object" ? ev.time_window : null;
  const kind = win && typeof win.kind === "string" ? win.kind : null;
  const day = (iso) => {
    const d = new Date(`${iso}T00:00:00Z`);
    if (Number.isNaN(d.getTime())) return null;
    // Date-only values are LOCAL dates — format the parts in UTC so the label
    // can never slide into the neighbouring day for any viewer.
    return d.toLocaleDateString(locale, { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
  };
  const clockRange = win && win.local_start && win.local_end ? `${win.local_start}–${win.local_end}` : (win && (win.local_start || win.local_end)) || "";

  if (kind === "occurrences") {
    const nowDate = now instanceof Date ? now : new Date(now);
    const venueNow = venueLocalNow(nowDate, ev.timezone || win.timezone || null);
    const reference = selectedDate || venueNow?.date || null;
    // A session already over today is no longer the row's occurrence.
    const endedToday = (date) =>
      Boolean(venueNow && date === venueNow.date && win.local_start && win.local_end &&
        win.local_end > win.local_start && venueNow.clock >= win.local_end);
    const dates = listedDates(win.dates);
    const next = dates.find((date) => (!reference || date >= reference) && !endedToday(date));
    const label = next ? day(next) : null;
    if (!label) return "";
    return clockRange ? `${label} ${clockRange}` : label;
  }

  if (kind === "period") {
    const startsOn = win.starts_on || ev.starts_on || null;
    const endsOn = win.ends_on || ev.ends_on || startsOn;
    const start = startsOn ? day(startsOn) : null;
    if (!start) return "";
    const end = endsOn && endsOn !== startsOn ? day(endsOn) : null;
    return [end ? `${start} – ${end}` : start, clockRange, en ? "days per source" : "dagar enligt källan"]
      .filter(Boolean)
      .join(" · ");
  }

  if (kind === "daily" && (win.local_start || win.local_end)) {
    return `${en ? "daily" : "dagligen"} ${clockRange}`;
  }

  if (kind === "all_day" || (!kind && !ev.starts_at && (win?.starts_on || ev.starts_on))) {
    const startsOn = (win && win.starts_on) || ev.starts_on || null;
    const endsOn = (win && win.ends_on) || ev.ends_on || startsOn;
    const start = startsOn ? day(startsOn) : null;
    if (!start) return "";
    if (!endsOn || endsOn === startsOn) return start;
    const end = day(endsOn);
    return end ? `${start} – ${end}` : start;
  }

  const startsAt = (win && win.starts_at) || ev.starts_at || null;
  if (!startsAt) return "";
  const date = new Date(startsAt);
  if (Number.isNaN(date.getTime())) return "";
  const timezone = ev.timezone || win?.timezone || null;

  // ONGOING: a run that started earlier and has not ended yet. Its start
  // weekday is history — printing it under "tonight" claims the wrong day. Say
  // it is on now, and add the end clock only when the run actually ends on the
  // viewer-relevant venue-local day (otherwise "until 22:00" would imply a
  // same-day close that isn't real).
  const endsAtRaw = (win && win.ends_at) || ev.ends_at || null;
  const endsAt = endsAtRaw ? new Date(endsAtRaw) : null;
  const nowDate = now instanceof Date ? now : new Date(now);
  const nowValid = !Number.isNaN(nowDate.getTime());
  const endValid = endsAt && !Number.isNaN(endsAt.getTime());
  if (selectedDate && timezone && nowValid) {
    try {
      const today = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(nowDate);
      if (selectedDate !== today) {
        const opts = { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: timezone };
        const startLabel = date.toLocaleString(locale, opts);
        return endValid ? `${startLabel} – ${endsAt.toLocaleString(locale, opts)}` : startLabel;
      }
    } catch {
      return ""; // no viewer-timezone substitution for an unresolvable venue date
    }
  }
  if (nowValid && endValid && date.getTime() <= nowDate.getTime() && endsAt.getTime() > nowDate.getTime()) {
    const onNow = en ? "on now" : "pågår nu";
    try {
      const dayOpts = timezone ? { timeZone: timezone } : {};
      const sameDay =
        endsAt.toLocaleDateString(locale, dayOpts) === nowDate.toLocaleDateString(locale, dayOpts);
      if (!sameDay) return onNow;
      const clockOpts = { hour: "2-digit", minute: "2-digit", ...(timezone ? { timeZone: timezone } : {}) };
      return `${onNow} · ${en ? "until" : "till"} ${endsAt.toLocaleTimeString(locale, clockOpts)}`;
    } catch {
      return onNow;
    }
  }

  try {
    const opts = { weekday: "short", hour: "2-digit", minute: "2-digit" };
    if (timezone) opts.timeZone = timezone; // venue-local, never the viewer's
    return date.toLocaleString(locale, opts);
  } catch {
    return "";
  }
}

function listedDates(values) {
  if (!Array.isArray(values)) return [];
  const valid = values.filter((value) => {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  });
  return [...new Set(valid)].sort();
}

// Venue-local calendar date and clock for `now`; null without a usable venue
// timezone (never the viewer's timezone).
function venueLocalNow(nowDate, timezone) {
  if (!timezone || Number.isNaN(nowDate.getTime())) return null;
  try {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat("en-CA", {
        timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit", hourCycle: "h23",
      }).formatToParts(nowDate).map((part) => [part.type, part.value]),
    );
    return { date: `${parts.year}-${parts.month}-${parts.day}`, clock: `${parts.hour}:${parts.minute}` };
  } catch {
    return null;
  }
}

/**
 * Honest Pulse state from acquisition source health. `coverage:"covered"` only
 * means sources geographically cover the anchor — it does not prove collection
 * succeeded. Raw backend reason tokens never leak: this maps them to a small
 * state enum the UI turns into product copy.
 */
export function pulseHealthState(liveEvents, buckets) {
  if (!liveEvents) return "hidden";
  if (liveEvents.coverage === "uncovered") return "uncovered";
  if (liveEvents.coverage !== "covered") return "hidden";
  if (liveEvents.pending) return "pending";

  const health = liveEvents.acquisition && liveEvents.acquisition.source_health;
  const status = health && typeof health.status === "string" ? health.status : null;
  const result = health && typeof health.result === "string" ? health.result : null;
  const reasons = Array.isArray(health && health.reasons) ? health.reasons : [];
  const empty = !buckets || (buckets.tonight.length === 0 && buckets.thisWeek.length === 0);

  if (status === "unavailable") return "unavailable";
  if (status === "partial") return empty ? "unavailable" : "partial";
  if (!empty) return "ok";
  // Empty with healthy (or unknown legacy) collection: distinguish a genuinely
  // quiet calendar from "listings existed but none were reliable enough".
  if (result === "empty" && reasons.includes("all_event_evidence_rejected")) return "rejected_empty";
  if (status === "healthy" || result === "empty" || !health) return "soft_empty";
  return "unavailable";
}

/**
 * A FINISHED collection that shows nothing because selected sources failed.
 * Nothing shown is then no evidence that nothing is on, so the UI must say a
 * source failed — not that the calendar is quiet, and not that it is still
 * loading. Null while pending, when every source responded, or when accepted
 * events are shown (the partial note covers that). Counts are the server's.
 */
export function liveSourceFailure(liveEvents, buckets) {
  if (!liveEvents || liveEvents.coverage !== "covered" || liveEvents.pending) return null;
  const health = liveEvents.acquisition && liveEvents.acquisition.source_health;
  if (!health || (health.status !== "unavailable" && health.status !== "partial")) return null;
  if (buckets && (buckets.tonight.length > 0 || buckets.thisWeek.length > 0)) return null;
  const selected = Number.isInteger(health.selected_source_count) ? health.selected_source_count : 0;
  const responding = Number.isInteger(health.responding_source_count) ? health.responding_source_count : 0;
  if (selected <= 0 || responding < 0 || responding >= selected) return null;
  return { selected, responding };
}

/**
 * Source attribution for the Pulse section. Prefers the plural `feeds[]`
 * (multi-source acquisition) over the backward-compatible singular `feed`, so
 * no event silently inherits a wrong single-feed label. Returns null when no
 * source identity is known (the line is hidden, never invented).
 */
export function pulseSourceLine(liveEvents) {
  const feeds = Array.isArray(liveEvents && liveEvents.feeds) && liveEvents.feeds.length
    ? liveEvents.feeds
    : liveEvents && liveEvents.feed
      ? [liveEvents.feed]
      : [];
  const parts = [];
  const seen = new Set();
  for (const feed of feeds) {
    const label = feed && typeof feed.label === "string" ? feed.label.trim() : "";
    if (!label || seen.has(label)) continue;
    seen.add(label);
    parts.push(feed.license ? `${label} · ${feed.license}` : label);
  }
  return parts.length ? parts.join(" · ") : null;
}

/**
 * Where a Live event's source link leads, in words. The feed label says who
 * LISTED the event (attribution); it is never the link text, because the URL is
 * source-owned and may open another site — an organizer's, and possibly only
 * its start page. The link names its destination host, and a site root says it
 * is a homepage rather than the event's page.
 *
 * Reads only the server's conservative classification
 * (server/pulse-sources/event-source-link.js); nothing is classified or rewritten
 * here. No classification — an unusable URL, or a day saved before the field
 * existed — means no link rather than a guess.
 */
export function eventSourceLink(ev, lang) {
  const href = typeof ev?.source_url === "string" ? ev.source_url : "";
  const host = typeof ev?.source_link_host === "string" ? ev.source_link_host.trim() : "";
  const kind = ev?.source_link_kind;
  if (!/^https?:\/\//i.test(href.trim()) || !host || (kind !== "page" && kind !== "site_home")) return null;
  const en = lang === "en";
  return {
    href,
    host,
    kind,
    text: kind === "site_home"
      ? en ? `Homepage: ${host} (not the event page)` : `Startsida: ${host} (inte evenemangssidan)`
      : host,
  };
}
