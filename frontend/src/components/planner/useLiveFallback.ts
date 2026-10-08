import { useEffect, useRef, useState } from "react";
import { acceptedLiveEventQuery, buildLiveEventQueryPayload, liveSelectedDate } from "../../lib/live-event-query.mjs";
import type { LiveEvents, PulseEvent } from "./types";

export type LiveFallback = { status: "checking" | "unconfirmed" | "ready"; kind: "wider" | "following"; events: PulseEvent[]; selectedDate: string; partial?: boolean; widerStatus?: "checking" | "unconfirmed" };

// Unlike the legacy display state, automatic requests require positive evidence
// of a finished healthy collection. Unknown, partial and pending never mean empty.
export function healthyCollection(events: LiveEvents | null) {
  const h = events?.acquisition?.source_health;
  return events?.coverage === "covered" && !events.pending && h?.status === "healthy" &&
    (h.result === "empty" || h.result === "events_found") &&
    (h.selected_source_count ?? 0) > 0 && h.responding_source_count === h.selected_source_count &&
    !h.failed_source_count && !h.unavailable_source_count;
}

export function selectedDayEmpty(events: LiveEvents | null) {
  return healthyCollection(events) && !events?.tonight?.length &&
    !events?.browse?.tonight?.more?.length && !events?.browse?.tonight?.hidden_count;
}

export function nextSourceDate(ev: PulseEvent, selectedDate: string): string | null {
  const win = ev.time_window;
  let dates: string[] = [];
  if (win?.kind === "occurrences" && Array.isArray(win.dates)) dates = win.dates;
  else if (win?.kind === "all_day" && win.starts_on && (!win.ends_on || win.ends_on === win.starts_on)) dates = [win.starts_on];
  else if (win?.kind === "continuous" || (!win && ev.starts_at)) {
    const instant = win?.starts_at || ev.starts_at;
    const zone = ev.timezone || win?.timezone;
    if (instant && zone && /(?:Z|[+-]\d{2}:\d{2})$/.test(instant)) {
      try {
        const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: zone,
          year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(instant)).map(p => [p.type, p.value]));
        dates = [`${parts.year}-${parts.month}-${parts.day}`];
      } catch { return null; }
    }
  }
  return dates.filter(date => {
    const valid = liveSelectedDate({ live_events: { selected_date: date } });
    const days = (Date.parse(`${date}T00:00:00Z`) - Date.parse(`${selectedDate}T00:00:00Z`)) / 86400000;
    return Boolean(valid) && days > 0 && days <= 7;
  }).sort()[0] || null;
}

export function useLiveFallback({ enabled, response, localEvents, preferences, lang }: {
  enabled: boolean; response: unknown; localEvents: LiveEvents | null; preferences: string[]; lang: string;
}): LiveFallback | null {
  const payload = buildLiveEventQueryPayload({ scope: "in_place", time: "tonight", response, preferences });
  const selectedDate = liveSelectedDate(response);
  const key = payload && selectedDate ? JSON.stringify({ payload, lang }) : null;
  const eligible = enabled && selectedDayEmpty(localEvents) && localEvents?.selected_date === selectedDate && Boolean(key);
  const attempts = useRef(new Map<string, LiveFallback>());
  const [result, setResult] = useState<{ key: string; value: LiveFallback } | null>(null);
  useEffect(() => {
    if (!eligible || !key || !selectedDate) return;
    const previous = attempts.current.get(key);
    if (previous) { setResult({ key, value: previous }); return; }
    // One bounded collection per anchor/date/preferences/language cell.
    // Completion reads follow pending only; failures stay unconfirmed.
    const controller = new AbortController();
    let waitTimer: ReturnType<typeof setTimeout> | undefined;
    let cancelWait: (() => void) | undefined;
    const wait = () => new Promise<void>(resolve => {
      cancelWait = resolve;
      waitTimer = setTimeout(resolve, 4000);
    });
    const checking: LiveFallback = { status: "checking", kind: "wider", events: [], selectedDate };
    const unconfirmed: LiveFallback = { ...checking, status: "unconfirmed" };
    attempts.current.set(key, unconfirmed);
    if (attempts.current.size > 8) attempts.current.delete(attempts.current.keys().next().value!);
    setResult({ key, value: checking });
    (async () => {
      try {
        let body: any = null;
        let events: LiveEvents | null = null;
        // Follow one existing background-warmed collection with at most six
        // completion reads. Never retry a failure or launch parallel queries.
        for (let read = 0; read < 7; read++) {
          if (controller.signal.aborted) return;
          const http = await fetch(`/api/live-events?lang=${lang}`, { method: "POST",
            headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload), signal: controller.signal });
          body = await http.json();
          events = http.ok ? acceptedLiveEventQuery(body) as LiveEvents | null : null;
          if (controller.signal.aborted) return;
          if (!events?.pending || read === 6) break;
          await wait();
        }
        if (controller.signal.aborted) return;
        let value = unconfirmed;
        if (events?.selected_date === selectedDate && events.coverage === "covered" && !events.pending &&
            ["healthy", "partial"].includes(events.acquisition?.source_health?.status || "") &&
            body.query?.scope === "in_place" && body.query?.discovery_scope === "resolved_area" &&
            body.query?.selected_date === selectedDate && Number.isFinite(body.query?.radius_m) &&
            body.query.radius_m > 0 && body.query.radius_m <= 40000) {
          const rows = [...(events.tonight ?? []), ...(events.browse?.tonight?.more ?? [])];
          const seen = new Set<string>();
          const bounded = rows.filter(ev => {
            if (!Number.isFinite(ev.lat) || !Number.isFinite(ev.lng) ||
                !Number.isFinite(ev.anchor_distance_km) || ev.anchor_distance_km! < 0 ||
                ev.anchor_distance_km! > body.query.radius_m / 1000 + 0.01) return false;
            const id = String(ev.id);
            if (seen.has(id)) return false;
            seen.add(id); return true;
          }).slice(0, 24);
          value = bounded.length > 0 ? { ...checking, status: "ready", events: bounded, partial: events.acquisition?.source_health?.status === "partial" }
            : selectedDayEmpty(events) ? { ...checking, status: "ready", kind: "following", events: [] }
            : unconfirmed;
        }
        attempts.current.set(key, value);
        setResult({ key, value });
      } catch {
        if (!controller.signal.aborted) { attempts.current.set(key, unconfirmed); setResult({ key, value: unconfirmed }); }
      }
    })();
    return () => { controller.abort(); clearTimeout(waitTimer); cancelWait?.(); };
    // The serialized payload fixes ownership; incidental object re-renders
    // must not restart an automatic request.
  }, [eligible, key]);
  if (!eligible || result?.key !== key) return null;
  if (result.value.kind !== "following" && result.value.status === "ready") return result.value;
  // Reuse the local collection, not the wider area's future bucket. Exact
  // source-listed occurrence dates only in this first slice; a period span or
  // a daily schedule alone cannot establish a particular future session.
  const future = [...(localEvents?.this_week ?? []), ...(localEvents?.browse?.this_week?.more ?? [])]
    .filter(ev => ev.live_proximity !== "nearby" && ev.live_proximity !== "in_place" &&
      (ev.anchor_distance_km == null || ev.anchor_distance_km <= 3) &&
      Boolean(nextSourceDate(ev, selectedDate)));
  const seen = new Set<string>();
  const futureEvents = future.filter(ev => {
    const id = String(ev.id);
    if (seen.has(id)) return false;
    seen.add(id); return true;
  }).slice(0, 24);
  return futureEvents.length ? { ...result.value, status: "ready", kind: "following", events: futureEvents,
    widerStatus: result.value.status === "ready" ? undefined : result.value.status } : result.value;
}
