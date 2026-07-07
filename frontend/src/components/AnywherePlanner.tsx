/**
 * Planner surface for freeform places — the first React-island surface of the new frontend.
 *
 * Talks to the EXISTING Express API (same payload as the production anywhere
 * mode) and renders through the SHARED honesty module, so this surface can never
 * dress a fallback city's day up as the typed place:
 *   composed       → day stops + district panel + events + map
 *   structure_only → district panel only, honest "not a finished route" note
 *   unavailable    → honest empty state (never a crash)
 */
import { useEffect, useMemo, useRef, useState } from "react";
import "leaflet/dist/leaflet.css";
import {
  buildAnywherePayload,
  ANYWHERE_PREFERENCES,
  WALK_PRESETS,
  isoDateFromOffset,
} from "../lib/anywhere-payload.mjs";
import { mapsPlaceUrl, mapsWalkingRouteUrl, primaryRouteStops } from "../lib/maps-links.mjs";
import { buildShareUrl, decodeShareParams } from "../lib/anywhere-share.mjs";
import {
  buildSavedEntry,
  upsertSaved,
  removeSaved,
  LAST_KEY,
  SAVED_KEY,
  type SavedEntry,
} from "../lib/anywhere-storage.mjs";
import { anywhereDecision, type AnywhereClassification } from "../lib/anywhere-decision";

function readLS<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeLS(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* private mode / quota — retention is best-effort, never fatal */
  }
}

type Lang = "sv" | "en";

interface DistrictArea {
  center?: { lat: number; lng: number } | null;
  daypart_hint?: string | null;
  covers?: string[];
  stop_names?: string[];
  stops?: Array<{ id?: string | null; name?: string | null; lat: number; lng: number }>;
  stop_ids?: string[];
}

interface PlaceStructure {
  provenance?: string;
  area_count?: number;
  district_day?: {
    areas?: DistrictArea[];
    legs?: Array<{ distance_km?: number | null }>;
    covered_intents?: string[];
    missing_intents?: string[];
    evening_event?: {
      title?: string | null;
      starts_at?: string | null;
      place?: string | null;
      source_url?: string | null;
    } | null;
  };
}

interface LiveEvents {
  coverage?: string;
  pending?: boolean;
  feed?: { label?: string; license?: string } | null;
  tonight?: Array<{ id?: string; title?: string; starts_at?: string; place?: string; source_url?: string; timezone?: string }>;
  this_week?: Array<{ id?: string; title?: string; starts_at?: string; place?: string; source_url?: string; timezone?: string }>;
}

const DAYPART_LABELS: Record<string, { sv: string; en: string }> = {
  morning: { sv: "Morgon", en: "Morning" },
  midday: { sv: "Mitt på dagen", en: "Midday" },
  afternoon: { sv: "Eftermiddag", en: "Afternoon" },
  evening: { sv: "Kväll", en: "Evening" },
};

const INTENT_LABELS: Record<string, { sv: string; en: string }> = {
  food: { sv: "Mat", en: "Food" },
  culture: { sv: "Kultur", en: "Culture" },
  views: { sv: "Utsikt", en: "Views" },
  fika: { sv: "Fika", en: "Coffee" },
  nightlife: { sv: "Kvällsliv", en: "Nightlife" },
  green: { sv: "Grönt", en: "Green" },
  second_hand: { sv: "Second hand", en: "Second hand" },
  market: { sv: "Marknad", en: "Market" },
};

function label(map: Record<string, { sv: string; en: string }>, key: string | null | undefined, lang: Lang): string {
  if (!key) return "";
  return map[key]?.[lang] ?? key;
}

function eventWhen(ev: { starts_at?: string; timezone?: string }, lang: Lang): string {
  if (!ev.starts_at) return "";
  const date = new Date(ev.starts_at);
  if (Number.isNaN(date.getTime())) return "";
  try {
    const opts: Intl.DateTimeFormatOptions = { weekday: "short", hour: "2-digit", minute: "2-digit" };
    if (ev.timezone) opts.timeZone = ev.timezone; // venue-local time, never the viewer's
    return date.toLocaleString(lang === "en" ? "en-GB" : "sv-SE", opts);
  } catch {
    return "";
  }
}

export default function AnywherePlanner({ lang: initialLang = "en" }: { lang?: Lang }) {
  // Static output can't read query params at request time, so honor the
  // production language contract (?lang=sv) client-side: EN default, SV explicit.
  const [lang, setLang] = useState<Lang>(initialLang);
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("lang");
    if (q === "sv" || q === "en") setLang(q);
  }, []);
  // The page shell is static — keep the document title on the language contract.
  useEffect(() => {
    document.title = lang === "sv" ? "Parranda — planera plats" : "Parranda — plan this place";
  }, [lang]);
  const [place, setPlace] = useState("");
  const [mode, setMode] = useState<"typed" | "near_me">("typed"); // start context
  const [geoHint, setGeoHint] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>(["food", "culture", "views"]);
  const [dayOffset, setDayOffset] = useState<0 | 1>(0); // today / tomorrow
  const [walkKey, setWalkKey] = useState("balanced");
  const [phase, setPhase] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [loadingStage, setLoadingStage] = useState(0);
  const [classification, setClassification] = useState<AnywhereClassification | null>(null);
  const [safeResponse, setSafeResponse] = useState<any>(null);
  const [mapDrawn, setMapDrawn] = useState(false);
  const [savedDays, setSavedDays] = useState<SavedEntry[]>([]);
  const [restoredAt, setRestoredAt] = useState<string | null>(null); // set when showing a SNAPSHOT
  const [shareCopied, setShareCopied] = useState(false);
  const mapRef = useRef<HTMLDivElement | null>(null);
  const leafletRef = useRef<{ map: any; layer: any } | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastEntryRef = useRef<SavedEntry | null>(null); // the latest composed day, for "save"

  const t = (sv: string, en: string) => (lang === "en" ? en : sv);

  // Honest staged feedback while a cold place composes (5–20 s): describe what
  // the engine is actually doing, never a fake progress number.
  useEffect(() => {
    if (phase !== "loading") {
      setLoadingStage(0);
      return;
    }
    const timers = [setTimeout(() => setLoadingStage(1), 4000), setTimeout(() => setLoadingStage(2), 10000)];
    return () => timers.forEach(clearTimeout);
  }, [phase]);

  type Anchor = { place?: string; coords?: { lat: number; lng: number } };

  async function execute(
    anchor: Anchor,
    {
      silent = false,
      langOverride,
      preferencesOverride,
      dayOffsetOverride,
      walkKeyOverride,
    }: { silent?: boolean; langOverride?: Lang; preferencesOverride?: string[]; dayOffsetOverride?: 0 | 1; walkKeyOverride?: string } = {},
  ) {
    if (!silent) {
      setPhase("loading");
      setClassification(null);
      setSafeResponse(null);
      setMapDrawn(false);
    }
    try {
      const effectiveWalkKey = walkKeyOverride ?? walkKey;
      const effectiveDayOffset = dayOffsetOverride ?? dayOffset;
      const preset = WALK_PRESETS.find((p: { key: string }) => p.key === effectiveWalkKey) ?? WALK_PRESETS[1];
      const payload = buildAnywherePayload({
        place: anchor.place,
        coords: anchor.coords ?? null,
        dates: [isoDateFromOffset(effectiveDayOffset)],
        preferences: preferencesOverride ?? selected,
        walkingKmTarget: preset.km,
      });
      const response = await fetch(`/api/route-recommendations?lang=${langOverride ?? lang}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await response.json();
      const decision = anywhereDecision();
      // With a coords anchor there is no typed text — the label falls back to a
      // neutral "your position" (the engine's resolved label wins when present).
      const fallbackLabel = anchor.place ?? t("din position", "your position");
      const cls = decision.classifyAnywhereResult(body, { place: fallbackLabel });
      const safe = decision.safeResponseFor(body, cls);
      setClassification(cls);
      setSafeResponse(safe);
      setPhase("done");
      // Retention: remember this composed day so a reload doesn't lose it, and
      // so the user can save it. A fresh compose is LIVE, so clear the snapshot flag.
      if (!silent) {
        const prefs = preferencesOverride ?? selected;
        const entry = buildSavedEntry({
          place: anchor.place,
          label: anchor.place || t("Min position", "My position"),
          dateIso: isoDateFromOffset(effectiveDayOffset),
          savedAt: new Date().toISOString(),
          safeResponse: safe,
          classification: cls,
          inputs: { place: anchor.place ?? null, mode, dayOffset: effectiveDayOffset, walkKey: effectiveWalkKey, selected: prefs },
        });
        lastEntryRef.current = entry;
        writeLS(LAST_KEY, entry);
        setRestoredAt(null);
      }
      // The live-events feed is background-warmed server-side: a cold anchor
      // returns an honest `pending`. Re-ask ONCE after the warm window instead of
      // telling the user to reload — everything else comes from cache, so the
      // retry is cheap. Never loops: a second pending stays pending.
      if (!silent && safe?.live_events?.pending) {
        if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
        pollTimerRef.current = setTimeout(() => {
          execute(anchor, { silent: true }).catch(() => {});
        }, 9000);
      }
    } catch {
      if (!silent) setPhase("error");
    }
  }

  useEffect(() => () => {
    if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
  }, []);

  // Show a stored day WITHOUT re-fetching. A restored day is a snapshot (events /
  // "today" may be stale), so restoredAt is set and the UI labels it + offers rebuild.
  function restoreEntry(entry: SavedEntry) {
    const i = entry.inputs;
    if (i) {
      if (typeof i.place === "string") setPlace(i.place);
      if (i.mode === "typed" || i.mode === "near_me") setMode(i.mode);
      if (i.dayOffset === 0 || i.dayOffset === 1) setDayOffset(i.dayOffset);
      if (typeof i.walkKey === "string") setWalkKey(i.walkKey);
      if (Array.isArray(i.selected)) setSelected(i.selected);
    }
    lastEntryRef.current = entry;
    setClassification(entry.classification);
    setSafeResponse(entry.safeResponse);
    setMapDrawn(false);
    setPhase("done");
    setRestoredAt(entry.savedAt);
  }

  // Arriving with ?place= (e.g. from the landing search) composes the day
  // IMMEDIATELY — the user typed a city and expects a day, not a second form.
  // Otherwise, restore the last day so a reload doesn't lose it.
  const autoPlannedRef = useRef(false);
  useEffect(() => {
    if (autoPlannedRef.current) return;
    autoPlannedRef.current = true;
    setSavedDays(readLS<SavedEntry[]>(SAVED_KEY, []));
    // A shared link carries the WHOLE day's inputs (place + prefs + day + length),
    // so it auto-plans exactly what the sharer saw — composed fresh for the opener.
    const allowedPrefs = ANYWHERE_PREFERENCES.map((p: { key: string }) => p.key);
    const shared = decodeShareParams(window.location.search, allowedPrefs);
    if (shared.place) {
      setPlace(shared.place);
      if (shared.preferences.length) setSelected(shared.preferences);
      setDayOffset(shared.dayOffset);
      setWalkKey(shared.walkKey);
      execute(
        { place: shared.place },
        {
          langOverride: shared.lang ?? undefined,
          preferencesOverride: shared.preferences.length ? shared.preferences : undefined,
          dayOffsetOverride: shared.dayOffset,
          walkKeyOverride: shared.walkKey,
        },
      ).catch(() => {});
      return;
    }
    const last = readLS<SavedEntry | null>(LAST_KEY, null);
    if (last && last.safeResponse && last.classification) restoreEntry(last);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function saveDay() {
    const entry = lastEntryRef.current;
    if (!entry) return;
    const stamped = { ...entry, savedAt: new Date().toISOString() };
    const next = upsertSaved(savedDays, stamped);
    setSavedDays(next);
    writeLS(SAVED_KEY, next);
    setRestoredAt(stamped.savedAt);
  }

  function removeSavedDay(id: string) {
    const next = removeSaved(savedDays, id);
    setSavedDays(next);
    writeLS(SAVED_KEY, next);
  }

  // Share the day: a link that carries the day's INPUTS (place + prefs + day +
  // length + language) so it auto-plans the same day for whoever opens it —
  // composed fresh, so their events / "today" are honest to when they open it.
  async function shareDay() {
    const entry = lastEntryRef.current;
    const i = entry?.inputs;
    if (!i || !i.place) return; // coords-anchored days have no shareable place text
    const url = buildShareUrl(window.location.origin, {
      place: i.place,
      preferences: Array.isArray(i.selected) ? i.selected : [],
      dayOffset: i.dayOffset ?? 0,
      walkKey: i.walkKey ?? "balanced",
      lang,
    });
    try {
      await navigator.clipboard.writeText(url);
      setShareCopied(true);
      window.setTimeout(() => setShareCopied(false), 2500);
    } catch {
      // Clipboard blocked (permissions/insecure context) — fall back to a prompt.
      window.prompt(t("Kopiera länken:", "Copy the link:"), url);
    }
  }
  // A coords-anchored day has no shareable place text.
  const canShare = Boolean(lastEntryRef.current?.inputs?.place);

  const isSaved = Boolean(lastEntryRef.current && savedDays.some((e) => e.id === lastEntryRef.current!.id));

  // "Near me now": the user's real position becomes the trusted anchor (explicit
  // coords win in the agnostic intake). Honest failure — a denied/failed
  // geolocation shows a hint and never fakes a position.
  function currentPosition(): Promise<{ lat: number; lng: number }> {
    return new Promise((resolve, reject) => {
      if (!("geolocation" in navigator)) {
        reject(new Error("unsupported"));
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        () => reject(new Error("denied")),
        { timeout: 10000 },
      );
    });
  }

  // Resolve the anchor (typed place or the user's real position) and compose.
  // Shared by "Build my day" and "Blitz" (which only overrides the preferences).
  async function resolveAndRun(opts: { preferencesOverride?: string[] } = {}) {
    setGeoHint(null);
    if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    if (mode === "near_me") {
      try {
        const coords = await currentPosition();
        await execute({ coords }, opts);
      } catch {
        setGeoHint(
          t(
            "Platsdelning nekades eller misslyckades — skriv en stad i stället.",
            "Location sharing was denied or failed — type a city instead.",
          ),
        );
        setMode("typed");
      }
      return;
    }
    const trimmed = place.trim();
    if (!trimmed) return;
    await execute({ place: trimmed }, opts);
  }

  async function plan(event?: { preventDefault?: () => void }) {
    event?.preventDefault?.();
    await resolveAndRun();
  }

  // Blitz — a quick, unplanned start: pick 2–4 preference axes at random and
  // compose immediately (still an honest, source-backed day; only the choosing
  // is done for you). Works from a typed city or the current position.
  function blitz() {
    const keys = ANYWHERE_PREFERENCES.map((p: { key: string }) => p.key);
    const shuffled = keys.slice().sort(() => Math.random() - 0.5);
    const picked = shuffled.slice(0, 2 + Math.floor(Math.random() * 3));
    setSelected(picked);
    resolveAndRun({ preferencesOverride: picked });
  }

  const structure: PlaceStructure | null = safeResponse?.place_structure ?? null;
  const day = structure?.district_day;
  const liveEvents: LiveEvents | null = safeResponse?.live_events ?? null;
  const routeStops = useMemo(() => primaryRouteStops(safeResponse), [safeResponse]);
  const hasPrimaryRoute = routeStops.length > 0;
  const composedStops: string[] = useMemo(() => {
    return routeStops.map((s: any) => String(s?.name || s?.label || "").trim()).filter(Boolean);
  }, [routeStops]);
  // A single "open the whole day in Google Maps" walking route across every
  // coord-bearing primary-route stop, in the exact order the API returned.
  const routeUrl = useMemo(() => mapsWalkingRouteUrl(routeStops), [routeStops]);

  // Draw the day on the map (numbered districts + dashed arc + stop dots) —
  // the same spatial story as the production Map tab.
  useEffect(() => {
    let cancelled = false;
    async function draw() {
      const areas = (day?.areas ?? []).filter(
        (a) => a?.center && Number.isFinite(a.center!.lat) && Number.isFinite(a.center!.lng),
      );
      if (!mapRef.current || !areas.length) {
        setMapDrawn(true); // nothing to draw — clear the placeholder
        return;
      }
      const L = (await import("leaflet")).default;
      if (cancelled || !mapRef.current) return;

      // The map div unmounts/remounts between composes (classification resets to
      // null while loading), so a reused Leaflet instance can be bound to a
      // now-detached node. If the live map isn't attached to the CURRENT div,
      // tear it down and recreate — otherwise a second search shows a blank map.
      if (leafletRef.current && leafletRef.current.map.getContainer() !== mapRef.current) {
        leafletRef.current.map.remove();
        leafletRef.current = null;
      }
      if (!leafletRef.current) {
        const map = L.map(mapRef.current, { zoomControl: true, scrollWheelZoom: false }).setView([30, 10], 2);
        L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
          maxZoom: 19,
        }).addTo(map);
        leafletRef.current = { map, layer: L.layerGroup().addTo(map) };
      }
      const { map, layer } = leafletRef.current;
      layer.clearLayers();

      const bounds: Array<[number, number]> = [];
      const arc = areas.map((a) => [a.center!.lat, a.center!.lng] as [number, number]);
      if (arc.length > 1) layer.addLayer(L.polyline(arc, { color: "#b6582f", weight: 3, dashArray: "6 8", opacity: 0.85 }));
      areas.forEach((area, index) => {
        bounds.push([area.center!.lat, area.center!.lng]);
        const icon = L.divIcon({ className: "district-map-marker", html: String(index + 1), iconSize: [28, 28], iconAnchor: [14, 14] });
        layer.addLayer(L.marker([area.center!.lat, area.center!.lng], { icon, zIndexOffset: 1000 }));
        (area.stops ?? []).forEach((stop) => {
          if (!Number.isFinite(stop?.lat) || !Number.isFinite(stop?.lng)) return;
          bounds.push([stop.lat, stop.lng]);
          const dot = L.circleMarker([stop.lat, stop.lng], { radius: 5, color: "#b6582f", weight: 2, fillColor: "#fffaf3", fillOpacity: 0.95 });
          if (stop.name) {
            const safe = document.createElement("div");
            safe.textContent = stop.name;
            dot.bindTooltip(safe.innerHTML);
          }
          layer.addLayer(dot);
        });
      });
      map.invalidateSize();
      if (bounds.length) map.fitBounds(bounds, { padding: [36, 36], maxZoom: 15 });
      setMapDrawn(true);
    }
    draw();
    return () => {
      cancelled = true;
    };
  }, [day]);

  const showDay = classification?.status === "composed";
  const showStructure = classification?.status === "composed" || classification?.status === "structure_only";

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
      <header className="flex flex-col gap-2">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-parranda-glow">
          {t("Planerare", "Planner")}
        </p>
        <h1 className="font-display text-4xl font-bold text-parranda-ink">{t("Bygg din dag", "Build your day")}</h1>
        <p className="max-w-prose text-parranda-ink/75">
          {t(
            "Skriv en plats. Parranda försöker bygga en dag med rätt rytm, rätt kvarter och ärlig källtäckning.",
            "Type a place. Parranda tries to build a day with the right rhythm, neighborhoods and honest source coverage.",
          )}
        </p>
      </header>
      <form onSubmit={plan} className="flex flex-col gap-3">
        <label className="text-xs font-semibold uppercase tracking-wider text-parranda-ink/60">
          {t("Skriv plats", "Type a place")}
        </label>
        <div className="flex gap-1.5" role="group" aria-label={t("Startpunkt", "Starting point")}>
          {(["typed", "near_me"] as const).map((m) => (
            <button
              type="button"
              key={m}
              onClick={() => {
                setMode(m);
                setGeoHint(null);
              }}
              className={
                "rounded-full border px-3 py-1 text-sm transition " +
                (mode === m
                  ? "border-parranda-accent bg-parranda-accent/15 font-semibold text-parranda-ink"
                  : "border-parranda-ink/15 bg-parranda-ink/10 text-parranda-ink/70")
              }
            >
              {m === "typed" ? t("Skriv stad", "Type a city") : t("Nära mig nu", "Near me now")}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          {mode === "typed" ? (
            <input
              value={place}
              onChange={(e) => setPlace(e.target.value)}
              placeholder={t("t.ex. Lyon, Tbilisi, Kyoto …", "e.g. Lyon, Tbilisi, Kyoto …")}
              className="flex-1 rounded-parranda border border-parranda-ink/15 bg-parranda-ink/10 px-4 py-3 text-parranda-ink shadow-sm outline-none focus:border-parranda-accent"
            />
          ) : (
            <p className="flex-1 self-center text-sm text-parranda-ink/70">
              {t("Din position blir dagens startpunkt.", "Your position becomes the day's starting point.")}
            </p>
          )}
          <button
            type="submit"
            disabled={phase === "loading" || (mode === "typed" && !place.trim())}
            className="rounded-parranda bg-parranda-accent px-5 py-3 font-semibold text-white shadow-sm disabled:opacity-40"
          >
            {phase === "loading" ? t("Komponerar…", "Composing…") : t("Bygg min dag", "Build my day")}
          </button>
          <button
            type="button"
            onClick={blitz}
            disabled={phase === "loading" || (mode === "typed" && !place.trim())}
            title={t("Överraska mig — slumpade preferenser", "Surprise me — random preferences")}
            className="rounded-parranda border border-parranda-accent/40 px-4 py-3 font-semibold text-parranda-accent shadow-sm disabled:opacity-40"
          >
            {t("⚡ Blitz", "⚡ Blitz")}
          </button>
        </div>
        {geoHint && <p className="text-sm text-parranda-ink/70">{geoHint}</p>}
        <div className="flex flex-wrap gap-2">
          {ANYWHERE_PREFERENCES.map((pref: { key: string; sv: string; en: string }) => {
            const active = selected.includes(pref.key);
            return (
              <button
                type="button"
                key={pref.key}
                onClick={() => setSelected((cur) => (active ? cur.filter((k) => k !== pref.key) : [...cur, pref.key]))}
                className={
                  "rounded-full border px-3 py-1 text-sm transition " +
                  (active
                    ? "border-parranda-accent bg-parranda-accent/15 font-semibold text-parranda-ink"
                    : "border-parranda-ink/15 bg-parranda-ink/10 text-parranda-ink/70")
                }
              >
                {lang === "en" ? pref.en : pref.sv}
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-4">
          <div className="flex gap-1.5" role="group" aria-label={t("Vilken dag", "Which day")}>
            {([0, 1] as const).map((offset) => (
              <button
                type="button"
                key={offset}
                onClick={() => setDayOffset(offset)}
                className={
                  "rounded-full border px-3 py-1 text-sm transition " +
                  (dayOffset === offset
                    ? "border-parranda-accent bg-parranda-accent/15 font-semibold text-parranda-ink"
                    : "border-parranda-ink/15 bg-parranda-ink/10 text-parranda-ink/70")
                }
              >
                {offset === 0 ? t("Idag", "Today") : t("Imorgon", "Tomorrow")}
              </button>
            ))}
          </div>
          <div className="flex gap-1.5" role="group" aria-label={t("Gånglängd", "Walking length")}>
            {WALK_PRESETS.map((preset: { key: string; km: number; sv: string; en: string }) => (
              <button
                type="button"
                key={preset.key}
                onClick={() => setWalkKey(preset.key)}
                className={
                  "rounded-full border px-3 py-1 text-sm transition " +
                  (walkKey === preset.key
                    ? "border-parranda-accent bg-parranda-accent/15 font-semibold text-parranda-ink"
                    : "border-parranda-ink/15 bg-parranda-ink/10 text-parranda-ink/70")
                }
              >
                {lang === "en" ? preset.en : preset.sv}
              </button>
            ))}
          </div>
        </div>

        {phase === "loading" && (
          <p className="text-sm text-parranda-ink/70" aria-live="polite">
            {loadingStage === 0 && t("Hittar platsen …", "Finding the place …")}
            {loadingStage === 1 && t("Läser kartan — riktiga platser, ingen katalog …", "Reading the map — real places, no catalog …")}
            {loadingStage === 2 &&
              t(
                "Komponerar dagen genom distrikten — det kan ta lite längre utan citypack …",
                "Composing the day across the districts — places without a citypack can take a little longer …",
              )}
          </p>
        )}
      </form>

      {savedDays.length > 0 && (
        <section className="rounded-parranda border border-parranda-ink/10 bg-parranda-ink/5 p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-parranda-ink/60">{t("Sparade dagar", "Saved days")}</p>
          <ul className="mt-2 flex flex-col gap-1.5">
            {savedDays.map((entry) => (
              <li key={entry.id} className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => restoreEntry(entry)}
                  className="flex-1 text-left text-sm text-parranda-ink hover:text-parranda-accent"
                >
                  <span className="font-semibold">{entry.label}</span>
                  {entry.dateIso && <span className="text-parranda-ink/60"> · {entry.dateIso}</span>}
                </button>
                <button
                  type="button"
                  onClick={() => removeSavedDay(entry.id)}
                  aria-label={t("Ta bort", "Remove")}
                  className="shrink-0 rounded-full px-2 text-parranda-ink/40 hover:text-parranda-accent"
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {phase === "error" && (
        <p className="rounded-parranda border border-parranda-ink/10 bg-parranda-ink/5 p-4 text-sm text-parranda-ink/80">
          {t("Motorn svarar inte just nu. Försök igen om en stund.", "The engine isn't answering right now. Try again shortly.")}
        </p>
      )}

      {phase === "done" && classification?.status === "unavailable" && (
        <p className="rounded-parranda border border-parranda-ink/10 bg-parranda-ink/5 p-4 text-sm text-parranda-ink/80">
          {t(
            `Parranda kunde inte komponera en dag för ${classification.placeLabel || place} ännu — inget hittas på, inget fejkas.`,
            `Parranda couldn't compose a day for ${classification.placeLabel || place} yet — nothing is invented in its place.`,
          )}
        </p>
      )}

      {showStructure && structure && (
        <section className="flex flex-col gap-4 rounded-parranda border border-parranda-ink/10 bg-parranda-ink/5 p-5 shadow-sm">
          <div className="flex items-start gap-3">
            <div className="flex-1">
              <p className="text-xs font-semibold uppercase tracking-wider text-parranda-ink/60">
                {hasPrimaryRoute ? t("Din rutt genom staden", "Your route across the city") : t("Kandidater nära platsen", "Candidates near this place")}
                {hasPrimaryRoute ? ` — ${routeStops.length} ${t("stopp", "stops")}` : ""}
              </p>
              {structure.provenance === "agnostic_anchor" && (
                <p className="mt-1 text-sm font-semibold text-parranda-accent">
                  {t(
                    `Byggd från källstödd data${typeof structure.area_count === "number" ? ` över ${structure.area_count} distrikt` : ""} — tunnare än ett fullt citypack`,
                    `Built from source-backed data${typeof structure.area_count === "number" ? ` across ${structure.area_count} districts` : ""} — thinner than a full citypack`,
                  )}
                </p>
              )}
              {classification?.status === "structure_only" && (
                <p className="mt-1 text-sm text-parranda-ink/70">
                  {t(
                    "Parranda hittade platskandidater, men inte en tillräckligt stark rutt ännu.",
                    "Parranda found place candidates, but not a reliable route yet.",
                  )}
                </p>
              )}
              {restoredAt && (
                <p className="mt-1 text-xs text-parranda-ink/60">
                  {t("Sparad dag", "Saved day")} · {new Date(restoredAt).toLocaleDateString(lang === "en" ? "en-GB" : "sv-SE")} —{" "}
                  <button type="button" onClick={() => resolveAndRun()} className="underline underline-offset-2 hover:text-parranda-accent">
                    {t("bygg om för färska events", "rebuild for fresh events")}
                  </button>
                </p>
              )}
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1.5">
              <div className="flex gap-1.5">
                {canShare && (
                  <button
                    type="button"
                    onClick={shareDay}
                    className="rounded-full border border-parranda-accent/40 px-3 py-1 text-sm font-semibold text-parranda-accent"
                  >
                    {shareCopied ? t("✓ Kopierad", "✓ Copied") : t("↗ Dela dagen", "↗ Share day")}
                  </button>
                )}
                <button
                  type="button"
                  onClick={saveDay}
                  disabled={isSaved}
                  className="rounded-full border border-parranda-accent/40 px-3 py-1 text-sm font-semibold text-parranda-accent disabled:opacity-50"
                >
                  {isSaved ? t("★ Sparad", "★ Saved") : t("☆ Spara dagen", "☆ Save day")}
                </button>
              </div>
            </div>
          </div>

          <ol className="flex flex-col gap-3">
            {(day?.areas ?? []).map((area, index) => (
              <li key={index} className="rounded-parranda border border-parranda-ink/10 bg-parranda-ink/10 p-4">
                <div className="flex items-center gap-2">
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-parranda-accent text-sm font-bold text-white">
                    {index + 1}
                  </span>
                  {area.daypart_hint && (
                    <span className="text-sm font-semibold text-parranda-ink">{label(DAYPART_LABELS, area.daypart_hint, lang)}</span>
                  )}
                  <span className="ml-auto text-xs text-parranda-ink/60">
                    {(area.stop_ids?.length ?? area.stops?.length ?? 0)} {t("träffar", "places")}
                  </span>
                </div>
                {(area.covers ?? []).length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {(area.covers ?? []).map((axis) => (
                      <span key={axis} className="rounded-full border border-parranda-accent/30 bg-parranda-accent/10 px-2.5 py-0.5 text-xs font-semibold text-parranda-ink">
                        {label(INTENT_LABELS, axis, lang)}
                      </span>
                    ))}
                  </div>
                )}
                {Array.isArray(area.stops) && area.stops.length > 0 ? (
                  <p className="mt-2 text-sm text-parranda-ink">
                    {area.stops.map((stop, si) => {
                      const url = mapsPlaceUrl(stop);
                      const name = (stop.name || area.stop_names?.[si] || "").trim();
                      if (!name) return null;
                      return (
                        <span key={stop.id ?? si}>
                          {si > 0 && " · "}
                          {url ? (
                            <a
                              href={url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="underline decoration-parranda-accent/50 underline-offset-2 hover:text-parranda-accent"
                            >
                              {name}
                            </a>
                          ) : (
                            name
                          )}
                        </span>
                      );
                    })}
                  </p>
                ) : (area.stop_names ?? []).length > 0 ? (
                  <p className="mt-2 text-sm text-parranda-ink">{(area.stop_names ?? []).join(" · ")}</p>
                ) : null}
                {index < (day?.areas?.length ?? 0) - 1 && Number.isFinite(day?.legs?.[index]?.distance_km as number) && (
                  <p className="mt-2 text-xs text-parranda-ink/60">≈ {day!.legs![index]!.distance_km} km {t("till nästa distrikt", "to the next district")}</p>
                )}
              </li>
            ))}
          </ol>

          {day?.evening_event?.title && (
            <div className="rounded-parranda border border-parranda-accent/25 bg-parranda-accent/10 p-4">
              <p className="text-xs font-bold uppercase tracking-wider text-parranda-accent">{t("Och ikväll", "And tonight")}</p>
              <p className="mt-1 text-sm font-semibold text-parranda-ink">{day.evening_event.title}</p>
              {day.evening_event.place && <p className="text-xs text-parranda-ink/70">{day.evening_event.place}</p>}
            </div>
          )}

          {(day?.missing_intents ?? []).length > 0 && (
            <p className="text-sm italic text-parranda-ink/60">
              {t("Inget distrikt täckte:", "No district covered:")} {(day?.missing_intents ?? []).map((k) => label(INTENT_LABELS, k, lang)).join(", ")}
            </p>
          )}

          {routeUrl && (
            <a
              href={routeUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 self-start rounded-parranda border border-parranda-accent/40 px-4 py-2 text-sm font-semibold text-parranda-accent hover:bg-parranda-accent/10"
            >
              {t("Öppna rutten i Google Maps", "Open the route in Google Maps")}
              <span aria-hidden="true">↗</span>
            </a>
          )}

          <div className="relative h-80 w-full overflow-hidden rounded-parranda border border-parranda-ink/10">
            <div ref={mapRef} className="h-full w-full" />
            {!mapDrawn && (
              <div className="absolute inset-0 flex items-center justify-center bg-parranda-ink/10 text-sm text-parranda-ink/60">
                {t("Ritar kartan …", "Drawing the map …")}
              </div>
            )}
          </div>
        </section>
      )}

      {showDay && composedStops.length > 0 && (
        <section className="rounded-parranda border border-parranda-ink/10 bg-parranda-ink/5 p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wider text-parranda-ink/60">{t("Dagens stopp", "Today's stops")}</p>
          <ol className="mt-2 flex flex-col gap-1.5">
            {composedStops.map((name, i) => (
              <li key={i} className="text-sm text-parranda-ink">
                <span className="font-semibold text-parranda-accent">{i + 1}.</span> {name}
              </li>
            ))}
          </ol>
        </section>
      )}

      {phase === "done" && liveEvents && (liveEvents.coverage === "covered" || liveEvents.coverage === "uncovered") && (
        <section className="rounded-parranda border border-parranda-ink/10 bg-parranda-ink/5 p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wider text-parranda-ink/60">{t("Händer i närheten", "Happening near here")}</p>
          {liveEvents.coverage === "uncovered" && (
            <p className="mt-2 text-sm text-parranda-ink/70">
              {t("Ingen live-eventkälla täcker den här platsen än — Parranda hittar inte på en.", "No live-events feed reaches this place yet — Parranda won't invent one.")}
            </p>
          )}
          {liveEvents.coverage === "covered" && liveEvents.pending && (
            <p className="mt-2 text-sm text-parranda-ink/70">{t("Kollar vad som händer — uppdateras automatiskt strax.", "Checking what's on — updates automatically in a moment.")}</p>
          )}
          {(["tonight", "this_week"] as const).map((bucket) => {
            const events = liveEvents[bucket] ?? [];
            if (!events.length) return null;
            return (
              <div key={bucket} className="mt-3">
                <p className="text-sm font-semibold text-parranda-ink">{bucket === "tonight" ? t("Ikväll", "Tonight") : t("Den här veckan", "This week")}</p>
                <ul className="mt-1 flex flex-col gap-1">
                  {events.slice(0, 4).map((ev, i) => (
                    <li key={ev.id ?? i} className="text-sm text-parranda-ink/85">
                      <span className="font-medium">{ev.title}</span>
                      {eventWhen(ev, lang) && <span className="text-parranda-ink/60"> · {eventWhen(ev, lang)}</span>}
                      {ev.place && <span className="text-parranda-ink/60"> · {ev.place}</span>}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
          {liveEvents.feed?.label && (
            <p className="mt-3 text-xs text-parranda-ink/50">
              {t("Källa", "Source")}: {liveEvents.feed.label}
              {liveEvents.feed.license ? ` · ${liveEvents.feed.license}` : ""}
            </p>
          )}
        </section>
      )}
    </div>
  );
}
