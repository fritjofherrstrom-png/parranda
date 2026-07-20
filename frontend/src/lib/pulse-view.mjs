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
 *   daily      → "dagligen HH–HH" from local_start/local_end (already local —
 *                never re-converted through a timezone)
 *   all_day    → local date or date range from starts_on/ends_on, formatted in
 *                UTC so a date-only value never shifts across midnight
 *   unresolved → "" (timing copy is omitted, never invented)
 *
 * `now` is injectable so tests never depend on the real clock.
 */
export function eventTiming(ev, lang, now = new Date()) {
  if (!ev || typeof ev !== "object") return "";
  const en = lang === "en";
  const locale = en ? "en-GB" : "sv-SE";
  const win = ev.time_window && typeof ev.time_window === "object" ? ev.time_window : null;
  const kind = win && typeof win.kind === "string" ? win.kind : null;

  if (kind === "daily" && (win.local_start || win.local_end)) {
    const range = win.local_start && win.local_end ? `${win.local_start}–${win.local_end}` : win.local_start || win.local_end;
    return `${en ? "daily" : "dagligen"} ${range}`;
  }

  if (kind === "all_day" || (!kind && !ev.starts_at && (win?.starts_on || ev.starts_on))) {
    const startsOn = (win && win.starts_on) || ev.starts_on || null;
    const endsOn = (win && win.ends_on) || ev.ends_on || startsOn;
    const day = (iso) => {
      const d = new Date(`${iso}T00:00:00Z`);
      if (Number.isNaN(d.getTime())) return null;
      // Date-only values are LOCAL dates — format the parts in UTC so the label
      // can never slide into the neighbouring day for any viewer.
      return d.toLocaleDateString(locale, { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
    };
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
