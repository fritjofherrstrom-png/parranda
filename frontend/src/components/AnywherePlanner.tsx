/**
 * Planner surface for freeform places — the first React-island surface of the new frontend.
 *
 * Talks to the EXISTING Express API (same payload as the production anywhere
 * mode) and renders through the SHARED honesty module, so this surface can never
 * dress a fallback city's day up as the typed place:
 *   composed       → one authoritative route + optional nearby context + Pulse
 *   structure_only → candidate areas only, honest "not a finished route" note
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
import { buildRouteContextSuggestions, walkingDistanceLabel } from "../lib/route-context-view.mjs";
import {
  splitRouteStops,
  wovenEventIds,
  pulseEventBuckets,
  clothingAdvice,
  pulseSourceLine,
  eventTiming,
  pulseHealthState,
  type PulseTimeWindow,
} from "../lib/pulse-view.mjs";
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
  stops?: Array<{
    id?: string | null;
    place_id?: string | null;
    candidate_id?: string | null;
    name?: string | null;
    lat: number;
    lng: number;
    address?: string | null;
    area?: string | null;
  }>;
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
      woven_into_route?: boolean;
      route_leg_km?: number | null;
    } | null;
  };
}

interface PulseEvent {
  id?: string;
  title?: string;
  starts_at?: string;
  ends_at?: string;
  starts_on?: string;
  ends_on?: string;
  time_window?: PulseTimeWindow | null;
  place?: string;
  source_label?: string;
  source_url?: string;
  timezone?: string;
}

interface LiveEvents {
  coverage?: string;
  pending?: boolean;
  feed?: { label?: string; license?: string } | null;
  feeds?: Array<{ label?: string; license?: string | null }>;
  acquisition?: { source_health?: { status?: string; result?: string; reasons?: string[] } | null } | null;
  tonight?: PulseEvent[];
  this_week?: PulseEvent[];
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

// Per-stop TYPE chips ("what is this place") — the engine's vocabulary, localized.
const TYPE_LABELS: Record<string, { sv: string; en: string }> = {
  museum: { sv: "Museum", en: "Museum" },
  gallery: { sv: "Galleri", en: "Gallery" },
  park: { sv: "Park", en: "Park" },
  garden: { sv: "Trädgård", en: "Garden" },
  restaurant: { sv: "Restaurang", en: "Restaurant" },
  cafe: { sv: "Café", en: "Café" },
  bar: { sv: "Bar", en: "Bar" },
  viewpoint: { sv: "Utsikt", en: "Viewpoint" },
  market: { sv: "Marknad", en: "Market" },
  "vintage-shop": { sv: "Second hand", en: "Vintage" },
  "street-food": { sv: "Street food", en: "Street food" },
  beach: { sv: "Strand", en: "Beach" },
  promenade: { sv: "Promenad", en: "Promenade" },
  castle: { sv: "Slott", en: "Castle" },
};

function label(map: Record<string, { sv: string; en: string }>, key: string | null | undefined, lang: Lang): string {
  if (!key) return "";
  return map[key]?.[lang] ?? key;
}

// Event timing renders through the pure `eventTiming` formatter (pulse-view.mjs),
// which honors the FULL temporal contract: continuous instants in the venue
// timezone, daily local windows, all-day local dates (never UTC-midnight
// shifted), and omits copy entirely when timing is unresolved.

export default function AnywherePlanner({ lang: initialLang = "en" }: { lang?: Lang }) {
  // Static output can't read query params at request time, so honor the
  // production language contract (?lang=sv) client-side: EN default, SV explicit.
  const [lang, setLang] = useState<Lang>(initialLang);
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("lang");
    if (q === "sv" || q === "en") setLang(q);
  }, []);
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
  const [upgradePending, setUpgradePending] = useState(false); // cold-start: structure upgrade in flight
  const [savedDays, setSavedDays] = useState<SavedEntry[]>([]);
  const [restoredAt, setRestoredAt] = useState<string | null>(null); // set when showing a SNAPSHOT
  const [shareCopied, setShareCopied] = useState(false);
  const mapRef = useRef<HTMLDivElement | null>(null);
  const leafletRef = useRef<{ map: any; layer: any } | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastEntryRef = useRef<SavedEntry | null>(null); // the latest composed day, for "save"

  const t = (sv: string, en: string) => (lang === "en" ? en : sv);
  const typedPlaceLabel = place.trim();
  const plannerTitle =
    mode === "near_me"
      ? t("Planerar nära dig", "Planning near you")
      : typedPlaceLabel
        ? t(`Planerar ${typedPlaceLabel}`, `Planning ${typedPlaceLabel}`)
        : t("Bygg din dag", "Build your day");
  const plannerIntro =
    mode === "near_me"
      ? t(
          "Parranda använder din position som startpunkt och bygger en dag med ärlig källtäckning.",
          "Parranda uses your position as the starting point and builds a day with honest source coverage.",
        )
      : typedPlaceLabel
        ? t(
            "Justera känsla, dag och gånglängd — Parranda bygger från platsen du skrev.",
            "Adjust mood, day and walking length — Parranda uses the place you typed.",
          )
        : t(
            "Skriv en plats. Parranda försöker bygga en dag med rätt rytm, rätt kvarter och ärlig källtäckning.",
            "Type a place. Parranda tries to build a day with the right rhythm, neighborhoods and honest source coverage.",
          );

  // The page shell is static — keep the browser title aligned with the active planner subject.
  useEffect(() => {
    document.title = typedPlaceLabel ? `${typedPlaceLabel} · Parranda` : lang === "sv" ? "Parranda — planera plats" : "Parranda — plan this place";
  }, [lang, typedPlaceLabel]);

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
      setUpgradePending(false);
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
      if (silent) setUpgradePending(false); // the one silent re-ask has landed (better or not)
      // Retention: remember this composed day so a reload doesn't lose it, and
      // so the user can save it. A fresh compose is LIVE, so clear the snapshot
      // flag. A SILENT upgrade also refreshes the stored entry (so save/share use
      // the upgraded day) but never touches the snapshot flag.
      if (!silent || safe?.place_structure) {
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
        if (!silent) setRestoredAt(null);
      }
      // ONE silent re-ask after the warm window covers the bounded cold-start
      // honesty gaps: (a) live events returned an honest `pending`, (b) a route
      // composed before its district structure was warm, or (c) a RESOLVED
      // place hit an explicit transient trusted-source failure. A proven empty
      // source, ambiguity, or unresolved place never retries. Never loops:
      // scheduling only happens on non-silent runs.
      const needsStructureUpgrade = cls.status === "composed" && !safe?.place_structure;
      const needsTransientSourceRetry = decision.shouldRetryTransientSource(body, cls);
      if (!silent && (safe?.live_events?.pending || needsStructureUpgrade || needsTransientSourceRetry)) {
        if (needsStructureUpgrade || needsTransientSourceRetry) setUpgradePending(true);
        if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
        pollTimerRef.current = setTimeout(() => {
          execute(anchor, { silent: true }).catch(() => {});
        }, 9000);
      }
    } catch {
      if (silent) setUpgradePending(false);
      else setPhase("error");
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
  const mapsPlaceContext = mode === "typed" ? classification?.placeLabel || typedPlaceLabel : null;
  const composedStops: string[] = useMemo(() => {
    return routeStops.map((s: any) => String(s?.name || s?.label || "").trim()).filter(Boolean);
  }, [routeStops]);
  // The engine computes far more than names — surface the TRUSTWORTHY parts:
  // the real walking numbers + per-leg distances, and the day's weather read
  // (dayflow_context comes from the trusted server-side weather provider, already
  // localized). The day-signal/title/summary fields are NOT rendered on this
  // surface: they can carry baseline-city phrasing and placeholder labels.
  const primaryRoute: any = safeResponse?.days?.[0]?.primary_route ?? null;
  const dayflow: any = safeResponse?.days?.[0]?.dayflow_context ?? null;
  const legForStop = (stop: any): { km: number | null; minutes: number | null } | null => {
    if (!Array.isArray(primaryRoute?.legs)) return null;
    const stopLabel = String(stop?.label ?? stop?.name ?? "").trim();
    if (!stopLabel) return null;
    const leg = primaryRoute.legs.find((l: any) => String(l?.to_label ?? "").trim() === stopLabel);
    if (!leg) return null;
    return {
      km: Number.isFinite(leg.distance_km) ? leg.distance_km : null,
      minutes: Number.isFinite(leg.estimated_walk_minutes) ? leg.estimated_walk_minutes : null,
    };
  };
  // PULSE VIEW-MODEL: partition route reality from Pulse context. Core stops are
  // numbered POIs; a WOVEN live event renders once, as a route extension; woven
  // event ids are excluded from the general Pulse list. The Maps URL keeps the
  // FULL stop order — the woven event is genuinely part of the walking route.
  const split = useMemo(() => splitRouteStops(routeStops), [routeStops]);
  const pulseBuckets = useMemo(
    () => pulseEventBuckets(liveEvents, wovenEventIds(routeStops)),
    [liveEvents, routeStops],
  );
  const pulseState = useMemo(() => pulseHealthState(liveEvents, pulseBuckets), [liveEvents, pulseBuckets]);
  const clothing = useMemo(
    () => clothingAdvice(dayflow?.weather?.provenance?.observed, lang),
    [dayflow, lang],
  );
  const pulseSources = useMemo(() => pulseSourceLine(liveEvents), [liveEvents]);
  const eveningEvent: any = day?.evening_event ?? null;
  // A single "open the whole day in Google Maps" walking route across every
  // coord-bearing primary-route stop, in the exact order the API returned.
  const routeUrl = useMemo(() => mapsWalkingRouteUrl(routeStops), [routeStops]);
  // District composition deliberately sees a broader candidate universe than
  // the route. Keep only a tiny, proximity-bounded, deduped slice as optional
  // discovery context; these candidates never enter routeStops or routeUrl.
  const routeContextSuggestions = useMemo(
    () => buildRouteContextSuggestions(routeStops, day?.areas, { limit: 3, maxDistanceKm: 1.5 }),
    [routeStops, day?.areas],
  );

  // The map follows the same authority hierarchy as the copy. A composed day
  // gets numbered primary-route markers and a solid route. Optional context is
  // muted. Structure-only keeps district markers because no route exists yet.
  useEffect(() => {
    let cancelled = false;
    async function draw() {
      const areas = (day?.areas ?? []).filter(
        (a) => a?.center && Number.isFinite(a.center!.lat) && Number.isFinite(a.center!.lng),
      );
      const drawableRouteStops = routeStops.filter(
        (stop: any) => stop && Number.isFinite(stop.lat) && Number.isFinite(stop.lng),
      );
      if (!mapRef.current || (hasPrimaryRoute ? !drawableRouteStops.length : !areas.length)) {
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
      if (hasPrimaryRoute) {
        const enginePath: Array<[number, number]> = (Array.isArray(primaryRoute?.map_path_points) ? primaryRoute.map_path_points : [])
          .filter((point: any) => point && Number.isFinite(point.lat) && Number.isFinite(point.lng))
          .map((point: any) => [point.lat, point.lng] as [number, number]);
        const routePath = enginePath.length > 1
          ? enginePath
          : drawableRouteStops.map((stop: any) => [stop.lat, stop.lng] as [number, number]);
        if (routePath.length > 1) {
          layer.addLayer(L.polyline(routePath, { color: "#b6582f", weight: 4, opacity: 0.92 }));
          routePath.forEach((point: [number, number]) => bounds.push(point));
        }

        routeStops.forEach((stop: any, index: number) => {
          if (!Number.isFinite(stop?.lat) || !Number.isFinite(stop?.lng)) return;
          bounds.push([stop.lat, stop.lng]);
          const icon = L.divIcon({
            className: `route-map-marker${stop.is_live_event === true ? " route-map-marker--event" : ""}`,
            html: String(index + 1),
            iconSize: [30, 30],
            iconAnchor: [15, 15],
          });
          const marker = L.marker([stop.lat, stop.lng], { icon, zIndexOffset: 1200 });
          const markerName = String(stop.label || stop.name || "").trim();
          if (markerName) {
            const safe = document.createElement("div");
            safe.textContent = markerName;
            marker.bindTooltip(safe.innerHTML);
          }
          layer.addLayer(marker);
        });

        routeContextSuggestions.forEach((stop) => {
          if (!Number.isFinite(stop.lat) || !Number.isFinite(stop.lng)) return;
          bounds.push([stop.lat!, stop.lng!]);
          const dot = L.circleMarker([stop.lat!, stop.lng!], {
            radius: 5,
            color: "#b6582f",
            weight: 1.5,
            fillColor: "#fffaf3",
            fillOpacity: 0.25,
            opacity: 0.7,
          });
          if (stop.name) {
            const safe = document.createElement("div");
            safe.textContent = stop.name;
            dot.bindTooltip(safe.innerHTML);
          }
          layer.addLayer(dot);
        });
      } else {
        const arc = areas.map((area) => [area.center!.lat, area.center!.lng] as [number, number]);
        if (arc.length > 1) layer.addLayer(L.polyline(arc, { color: "#b6582f", weight: 3, dashArray: "6 8", opacity: 0.55 }));
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
      }
      map.invalidateSize();
      if (bounds.length) map.fitBounds(bounds, { padding: [36, 36], maxZoom: 15 });
      setMapDrawn(true);
    }
    draw();
    return () => {
      cancelled = true;
    };
  }, [day, primaryRoute, hasPrimaryRoute, routeStops, routeContextSuggestions]);

  const showDay = classification?.status === "composed";
  const showStructure = classification?.status === "composed" || classification?.status === "structure_only";

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
      <header className="flex flex-col gap-2">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-parranda-glow">
          {t("Planerare", "Planner")}
        </p>
        <h1 className="font-display text-4xl font-bold text-parranda-ink">{plannerTitle}</h1>
        <p className="max-w-prose text-parranda-ink/75">{plannerIntro}</p>
      </header>
      <form onSubmit={plan} className="flex flex-col gap-3">
        <label className="text-xs font-semibold uppercase tracking-wider text-parranda-ink/60">
          {t("Plats", "Place")}
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
                "inline-flex min-h-11 items-center rounded-full border px-3.5 py-1 text-sm transition " +
                (mode === m
                  ? "border-parranda-accent bg-parranda-accent/15 font-semibold text-parranda-ink"
                  : "border-parranda-ink/15 bg-parranda-ink/10 text-parranda-ink/70")
              }
            >
              {m === "typed" ? t("Skriv stad", "Type a city") : t("Nära mig nu", "Near me now")}
            </button>
          ))}
        </div>
        {/* Below ~sm the input takes a full row and the two actions share the
            next row (primary grows) — so "Build my day" never wraps to three
            lines and Blitz never clips at the viewport edge. */}
        <div className="flex flex-col gap-2 sm:flex-row">
          {mode === "typed" ? (
            <input
              value={place}
              onChange={(e) => setPlace(e.target.value)}
              placeholder={t("t.ex. Lyon, Tbilisi, Kyoto …", "e.g. Lyon, Tbilisi, Kyoto …")}
              className="w-full flex-1 rounded-parranda border border-parranda-ink/15 bg-parranda-ink/10 px-4 py-3 text-parranda-ink shadow-sm outline-none focus:border-parranda-accent"
            />
          ) : (
            <p className="flex-1 self-center text-sm text-parranda-ink/70">
              {t("Din position blir dagens startpunkt.", "Your position becomes the day's starting point.")}
            </p>
          )}
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={phase === "loading" || (mode === "typed" && !place.trim())}
              className="min-h-11 flex-1 whitespace-nowrap rounded-parranda bg-parranda-accent px-5 py-3 font-semibold text-white shadow-sm disabled:opacity-40 sm:flex-none"
            >
              {phase === "loading" ? t("Komponerar…", "Composing…") : t("Bygg min dag", "Build my day")}
            </button>
            <button
              type="button"
              onClick={blitz}
              disabled={phase === "loading" || (mode === "typed" && !place.trim())}
              title={t("Överraska mig — slumpade preferenser", "Surprise me — random preferences")}
              className="min-h-11 shrink-0 whitespace-nowrap rounded-parranda border border-parranda-accent/40 px-4 py-3 font-semibold text-parranda-accent shadow-sm disabled:opacity-40"
            >
              {t("⚡ Blitz", "⚡ Blitz")}
            </button>
          </div>
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
                  "inline-flex min-h-11 items-center rounded-full border px-3.5 py-1 text-sm transition " +
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
                  "inline-flex min-h-11 items-center rounded-full border px-3.5 py-1 text-sm transition " +
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
                  "inline-flex min-h-11 items-center rounded-full border px-3.5 py-1 text-sm transition " +
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
            {loadingStage === 1 && t("Läser kartan och letar efter riktiga platser …", "Reading the map and looking for real places …")}
            {loadingStage === 2 &&
              t(
                "Komponerar dagen genom områdena — platser utan full kurering kan ta lite längre …",
                "Composing the day across the areas — places without full curation can take a little longer …",
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
        !upgradePending &&
        <p className="rounded-parranda border border-parranda-ink/10 bg-parranda-ink/5 p-4 text-sm text-parranda-ink/80">
          {t(
            `Parranda kunde inte komponera en dag för ${classification.placeLabel || place} ännu — inget hittas på, inget fejkas.`,
            `Parranda couldn't compose a day for ${classification.placeLabel || place} yet — nothing is invented in its place.`,
          )}
        </p>
      )}

      {/* Day header: honest provenance + day-level actions. The primary route is
          the only itinerary below; broader place structure is either secondary
          discovery context or, without a route, an honest candidate surface. */}
      {showStructure && structure && (
        <section className="flex flex-col items-start gap-3 rounded-parranda border border-parranda-ink/10 bg-parranda-ink/5 p-5 shadow-sm sm:flex-row sm:justify-between">
          <div className="min-w-0 flex-1">
            {structure.provenance === "agnostic_anchor" && (
              <p className="text-sm font-semibold text-parranda-accent">
                {t(
                  `Byggd från källstödda platser${typeof structure.area_count === "number" ? ` över ${structure.area_count} områden` : ""} — Parranda har inte full kurering här ännu`,
                  `Built from source-backed places${typeof structure.area_count === "number" ? ` across ${structure.area_count} areas` : ""} — Parranda does not have full curation here yet`,
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
          <div className="flex shrink-0 gap-1.5">
            {canShare && (
              <button
                type="button"
                onClick={shareDay}
                className="inline-flex min-h-11 items-center rounded-full border border-parranda-accent/40 px-3.5 py-1 text-sm font-semibold text-parranda-accent"
              >
                {shareCopied ? t("✓ Kopierad", "✓ Copied") : t("↗ Dela dagen", "↗ Share day")}
              </button>
            )}
            <button
              type="button"
              onClick={saveDay}
              disabled={isSaved}
              className="inline-flex min-h-11 items-center rounded-full border border-parranda-accent/40 px-3.5 py-1 text-sm font-semibold text-parranda-accent disabled:opacity-50"
            >
              {isSaved ? t("★ Sparad", "★ Saved") : t("☆ Spara dagen", "☆ Save day")}
            </button>
          </div>
        </section>
      )}

      {phase === "done" && upgradePending && !structure && (
        <p className="rounded-parranda border border-parranda-ink/10 bg-parranda-ink/5 p-4 text-sm text-parranda-ink/70" aria-live="polite">
          {t(
            "Läser in mer från källorna — uppdateras automatiskt strax.",
            "Reading more from the sources — updates automatically in a moment.",
          )}
        </p>
      )}

      {showDay && dayflow?.weather?.headline && (
        <section className="rounded-parranda border border-parranda-accent/25 bg-parranda-accent/10 p-4 shadow-sm">
          <p className="text-xs font-bold uppercase tracking-wider text-parranda-accent">{t("Dagens läsning", "Today's reading")}</p>
          <p className="mt-1 text-sm font-semibold text-parranda-ink">
            {dayflow.weather.headline}
            {dayflow.weather.pitch ? <span className="font-medium"> — {dayflow.weather.pitch}</span> : null}
          </p>
          {dayflow.weather.reason && <p className="mt-0.5 text-xs text-parranda-ink/70">{dayflow.weather.reason}</p>}
        </section>
      )}

      {showDay && routeStops.length > 0 && (
        <section className="rounded-parranda border border-parranda-ink/10 bg-parranda-ink/5 p-5 shadow-sm">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-parranda-ink/60">{t("Dagens rutt", "Today's route")}</p>
              {Number.isFinite(primaryRoute?.estimated_km) && (
                <p className="mt-1 text-xs text-parranda-ink/60">
                  ≈ {walkingDistanceLabel(primaryRoute.estimated_km, lang)}
                  {Number.isFinite(primaryRoute?.longest_leg_km)
                    ? ` · ${t("längsta ben", "longest leg")} ${walkingDistanceLabel(primaryRoute.longest_leg_km, lang)}`
                    : ""}
                </p>
              )}
            </div>
            {routeUrl && (
              <a
                href={routeUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-11 items-center gap-2 self-start rounded-parranda border border-parranda-accent/40 px-4 py-2 text-sm font-semibold text-parranda-accent hover:bg-parranda-accent/10"
              >
                {t("Öppna den planerade rutten", "Open the planned route")}
                <span aria-hidden="true">↗</span>
              </a>
            )}
          </div>
          {/* Core stops only: stable places, numbered. A woven live event is NOT an
              ordinary POI — it renders once below, as an attached route extension. */}
          <ol className="mt-2 flex flex-col">
            {split.core.map((stop: any, i: number) => {
              const name = String(stop?.label || stop?.name || "").trim();
              if (!name) return null;
              const routeNumber = routeStops.indexOf(stop) + 1;
              const leg = routeNumber === 1 ? null : legForStop(stop);
              const pin = mapsPlaceUrl(stop, mapsPlaceContext);
              return (
                <li key={stop?.id ?? i} className="flex flex-col">
                  {leg && (leg.minutes != null || leg.km != null) && (
                    <span className="ml-3 border-l border-dashed border-parranda-ink/25 py-1 pl-4 text-xs text-parranda-ink/55">
                      ↓ {leg.minutes != null ? `${leg.minutes} min` : ""}
                      {leg.minutes != null && leg.km != null ? " · " : ""}
                      {leg.km != null ? walkingDistanceLabel(leg.km, lang) : ""}
                    </span>
                  )}
                  <span className="flex flex-wrap items-center gap-2 py-0.5 text-sm text-parranda-ink">
                    <span className="font-semibold text-parranda-accent">{routeNumber}.</span>
                    {pin ? (
                      <a href={pin} target="_blank" rel="noopener noreferrer" className="underline decoration-parranda-accent/50 underline-offset-2 hover:text-parranda-accent">
                        {name}
                      </a>
                    ) : (
                      name
                    )}
                    {stop?.type && (
                      <span className="rounded-full border border-parranda-ink/15 bg-parranda-ink/10 px-2 py-0.5 text-xs text-parranda-ink/75">
                        {label(TYPE_LABELS, stop.type, lang)}
                      </span>
                    )}
                    {stop?.daypart && (
                      <span className="rounded-full border border-parranda-accent/30 bg-parranda-accent/10 px-2 py-0.5 text-xs font-semibold text-parranda-ink">
                        {label(DAYPART_LABELS, stop.daypart, lang)}
                      </span>
                    )}
                  </span>
                </li>
              );
            })}
          </ol>
          {/* Route extension: the walking-validated evening event. One full
              presentation — attached to the route it genuinely extends (it stays
              in the Google Maps route via the untouched full stop order). */}
          {split.woven.map((stop: any) => {
            const name = String(stop?.label || stop?.name || "").trim();
            if (!name) return null;
            const leg = legForStop(stop);
            const legKm = Number.isFinite(eveningEvent?.route_leg_km) ? eveningEvent.route_leg_km : leg?.km;
            const pin = mapsPlaceUrl(stop, mapsPlaceContext);
            const venue = String(eveningEvent?.place || "").trim();
            const sourceLabel = String(stop?.source?.label || eveningEvent?.source_label || "").trim();
            const sourceUrl = stop?.source?.url || eveningEvent?.source_url || null;
            const routeNumber = routeStops.indexOf(stop) + 1;
            return (
              <div key={stop?.id} className="mt-3 rounded-parranda border border-parranda-accent/40 bg-parranda-accent/10 p-4">
                <p className="text-xs font-bold uppercase tracking-wider text-parranda-accent">{t("Ikväll i din rutt", "Tonight in your route")}</p>
                <p className="mt-1 flex flex-wrap items-center gap-2 text-sm font-semibold text-parranda-ink">
                  <span className="font-semibold text-parranda-accent">{routeNumber}.</span>
                  {pin ? (
                    <a href={pin} target="_blank" rel="noopener noreferrer" className="underline decoration-parranda-accent/50 underline-offset-2 hover:text-parranda-accent">
                      {name}
                    </a>
                  ) : (
                    name
                  )}
                  {stop?.starts_at && (
                    <span className="rounded-full border border-parranda-accent bg-parranda-accent/15 px-2 py-0.5 text-xs font-bold text-parranda-accent">
                      {eventTiming(stop, lang)}
                    </span>
                  )}
                </p>
                {venue && venue !== name && <p className="mt-0.5 text-xs text-parranda-ink/70">{venue}</p>}
                {Number.isFinite(legKm) && (
                  <p className="mt-1 text-xs text-parranda-ink/70">
                    {t(
                      `Tillagt till dagens rutt · ${walkingDistanceLabel(legKm, "sv")} från föregående stopp`,
                      `Added to today's route · ${walkingDistanceLabel(legKm, "en")} from the previous stop`,
                    )}
                  </p>
                )}
                {sourceLabel && (
                  <p className="mt-1 text-xs text-parranda-ink/55">
                    {t("Källa", "Source")}:{" "}
                    {sourceUrl ? (
                      <a href={sourceUrl} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-parranda-accent">
                        {sourceLabel}
                      </a>
                    ) : (
                      sourceLabel
                    )}
                  </p>
                )}
              </div>
            );
          })}

          <div className="relative mt-4 h-80 w-full overflow-hidden rounded-parranda border border-parranda-ink/10">
            <div ref={mapRef} className="h-full w-full" />
            {!mapDrawn && (
              <div className="absolute inset-0 flex items-center justify-center bg-parranda-ink/10 text-sm text-parranda-ink/60">
                {t("Ritar kartan …", "Drawing the map …")}
              </div>
            )}
          </div>

          {routeContextSuggestions.length > 0 && (
            <div className="mt-4 border-t border-parranda-ink/10 pt-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-parranda-ink/60">
                {t("Fler nära rutten", "More near the route")}
              </p>
              <p className="mt-1 text-xs text-parranda-ink/60">
                {t(
                  "Valfria idéer från platsunderlaget — de ingår inte i dagens stopp eller Maps-rutten.",
                  "Optional ideas from the place evidence — they are not part of today's stops or the Maps route.",
                )}
              </p>
              <ul className="mt-3 grid gap-2 sm:grid-cols-2">
                {routeContextSuggestions.map((stop) => {
                  const name = String(stop.name || stop.label || "").trim();
                  if (!name) return null;
                  const url = mapsPlaceUrl(
                    { ...stop, lat: stop.lat ?? undefined, lng: stop.lng ?? undefined },
                    mapsPlaceContext,
                  );
                  return (
                    <li key={stop.id || stop.candidate_id || stop.place_id || name} className="rounded-parranda border border-parranda-ink/10 bg-parranda-ink/5 p-3">
                      <p className="text-sm font-semibold text-parranda-ink">
                        {url ? (
                          <a href={url} target="_blank" rel="noopener noreferrer" className="underline decoration-parranda-accent/50 underline-offset-2 hover:text-parranda-accent">
                            {name}
                          </a>
                        ) : name}
                      </p>
                      <p className="mt-1 text-xs text-parranda-ink/55">
                        {walkingDistanceLabel(stop.distance_km, lang)} {t("från", "from")} {stop.route_stop_name}
                      </p>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {(day?.missing_intents ?? []).length > 0 && (
            <p className="mt-4 text-sm italic text-parranda-ink/60">
              {t("Saknas i dagens underlag:", "Not covered by today's evidence:")} {(day?.missing_intents ?? []).map((key) => label(INTENT_LABELS, key, lang)).join(", ")}
            </p>
          )}
        </section>
      )}

      {/* Without a primary route, the broader place structure remains useful —
          but it is explicitly candidates, never a second itinerary. */}
      {showStructure && structure && !hasPrimaryRoute && (
        <section className="flex flex-col gap-4 rounded-parranda border border-parranda-ink/10 bg-parranda-ink/5 p-5 shadow-sm">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-parranda-ink/60">
              {t("Kandidater nära platsen", "Candidates near this place")}
            </p>
            {classification?.status === "structure_only" && (
              <p className="mt-1 text-sm text-parranda-ink/70">
                {t(
                  "Parranda hittade platskandidater, men inte en tillräckligt stark rutt ännu.",
                  "Parranda found place candidates, but not a reliable route yet.",
                )}
              </p>
            )}
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
                      const url = mapsPlaceUrl(stop, mapsPlaceContext);
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

          {/* The evening event is NOT presented here: a woven event renders once,
              as the route extension in "Dagens rutt"; a non-woven anchor event
              surfaces in the Pulse section's tonight bucket. */}

          {(day?.missing_intents ?? []).length > 0 && (
            <p className="text-sm italic text-parranda-ink/60">
              {t("Inget distrikt täckte:", "No district covered:")} {(day?.missing_intents ?? []).map((k) => label(INTENT_LABELS, k, lang)).join(", ")}
            </p>
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

      {phase === "done" && liveEvents && (liveEvents.coverage === "covered" || liveEvents.coverage === "uncovered") && (
        <section className="rounded-parranda border border-parranda-ink/10 bg-parranda-ink/5 p-5 shadow-sm">
          {/* PULSE — the city's now-context. Renders independently of route
              composition (live_events survives a blocked compose), so a failed
              route never hides trusted events. Woven events are excluded here —
              they own the route-extension presentation above. */}
          <p className="text-xs font-semibold uppercase tracking-wider text-parranda-ink/60">
            {mode === "near_me"
              ? t("Just nu nära dig", "Now near you")
              : typedPlaceLabel
                ? t(`Just nu i ${typedPlaceLabel}`, `Now in ${typedPlaceLabel}`)
                : t("Just nu här", "Now here")}
          </p>

          {clothing && (
            <p className="mt-2 text-sm text-parranda-ink">
              <span className="font-semibold">{clothing.headline}</span>
              <span className="text-parranda-ink/70"> — {clothing.advice}</span>
            </p>
          )}

          {split.woven.length > 0 && (
            <p className="mt-2 text-xs text-parranda-ink/60">
              {split.woven
                .map((s: any) => String(s?.label || s?.name || "").trim())
                .filter(Boolean)
                .map((n: string) => `${n} · ${t("Ingår i dagens rutt", "Included in today's route")}`)
                .join(" · ")}
            </p>
          )}

          {/* Honest source-health states — coverage only says sources exist HERE;
              pulseHealthState says whether collection actually succeeded. Raw
              backend reason tokens never reach product copy. */}
          {pulseState === "uncovered" && (
            <p className="mt-2 text-sm text-parranda-ink/70">
              {t("Ingen live-eventkälla täcker den här platsen än — Parranda hittar inte på en.", "No live-events feed reaches this place yet — Parranda won't invent one.")}
            </p>
          )}
          {pulseState === "pending" && (
            <p className="mt-2 text-sm text-parranda-ink/70">{t("Kollar kalendrarna — uppdateras automatiskt strax.", "Checking the calendars — updates automatically in a moment.")}</p>
          )}
          {pulseState === "soft_empty" && (
            <p className="mt-2 text-sm text-parranda-ink/70">
              {t("Inga listade händelser just nu — lugn kväll i kalendern.", "Nothing listed right now — a quiet night on the calendar.")}
            </p>
          )}
          {pulseState === "rejected_empty" && (
            <p className="mt-2 text-sm text-parranda-ink/70">
              {t(
                "Det fanns listningar, men inga var pålitliga eller aktuella nog att visa.",
                "Listings existed, but none were reliable or current enough to show.",
              )}
            </p>
          )}
          {pulseState === "unavailable" && (
            <p className="mt-2 text-sm text-parranda-ink/70">
              {t("Parranda kunde inte verifiera händelser just nu — försök igen om en stund.", "Parranda couldn't verify events right now — try again shortly.")}
            </p>
          )}

          {pulseBuckets.tonight.length > 0 && (
            <div className="mt-3">
              <p className="text-sm font-semibold text-parranda-ink">{t("Ikväll", "Tonight")}</p>
              <ul className="mt-1 flex flex-col gap-1.5">
                {pulseBuckets.tonight.slice(0, 4).map((ev: PulseEvent, i: number) => (
                  <li key={ev.id ?? i} className="text-sm text-parranda-ink/85">
                    <span className="font-medium">{ev.title}</span>
                    {eventTiming(ev, lang) && <span className="text-parranda-ink/60"> · {eventTiming(ev, lang)}</span>}
                    {ev.place && <span className="text-parranda-ink/60"> · {ev.place}</span>}
                    {ev.source_url && (
                      <span className="text-parranda-ink/50">
                        {" · "}
                        <a href={ev.source_url} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-parranda-accent">
                          {ev.source_label || t("Källa", "Source")}
                        </a>
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {pulseBuckets.thisWeek.length > 0 && (
            <div className="mt-3">
              <p className="text-sm font-semibold text-parranda-ink">{t("Senare i veckan", "Later this week")}</p>
              <ul className="mt-1 flex flex-col gap-1">
                {pulseBuckets.thisWeek.slice(0, 4).map((ev: PulseEvent, i: number) => (
                  <li key={ev.id ?? i} className="text-sm text-parranda-ink/85">
                    <span className="font-medium">{ev.title}</span>
                    {eventTiming(ev, lang) && <span className="text-parranda-ink/60"> · {eventTiming(ev, lang)}</span>}
                    {ev.place && <span className="text-parranda-ink/60"> · {ev.place}</span>}
                    {ev.source_url && (
                      <span className="text-parranda-ink/50">
                        {" · "}
                        <a href={ev.source_url} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-parranda-accent">
                          {ev.source_label || t("Källa", "Source")}
                        </a>
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {pulseState === "partial" && (
            <p className="mt-2 text-xs text-parranda-ink/55">
              {t("Alla källor kunde inte nås just nu — listan kan vara ofullständig.", "Some sources couldn't be reached right now — the list may be incomplete.")}
            </p>
          )}

          {pulseSources && (
            <p className="mt-3 text-xs text-parranda-ink/50">
              {t("Källa", "Source")}: {pulseSources}
            </p>
          )}
        </section>
      )}
    </div>
  );
}
