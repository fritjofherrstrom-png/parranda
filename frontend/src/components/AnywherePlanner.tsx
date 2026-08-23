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
import { anywhereBlitzView, type AnywhereBlitzView } from "../lib/blitz-view.mjs";
import { limitationNote } from "../lib/day-limitations.mjs";
import {
  anchorKey,
  planRecomposeRetention,
  scopeCommitmentsToAnchor,
  staleDayNotice,
  unhonouredPins,
} from "../lib/recompose-retention.mjs";
import {
  acceptedLiveEventQuery,
  boundedRoutePoints,
  buildLiveEventQueryPayload,
  type LiveEventScope,
} from "../lib/live-event-query.mjs";
import { mapsPlaceUrl, mapsWalkingRouteUrl, primaryRouteStops } from "../lib/maps-links.mjs";
import { routeMarkerPresentation } from "../lib/route-map-presentation.mjs";
import { selectedDayHoursLabel } from "../lib/selected-day-hours.mjs";
import {
  buildRouteContextSuggestions,
  routePreferenceCoverage,
  routeTimeAnchoring,
  walkingDistanceLabel,
} from "../lib/route-context-view.mjs";
import {
  splitRouteStops,
  wovenEventIds,
  pulseEventBuckets,
  pulseBrowseBuckets,
  clothingAdvice,
  pulseSourceLine,
  eventTiming,
  pulseHealthState,
  type PulseTimeWindow,
} from "../lib/pulse-view.mjs";
import { planComposeFollowup } from "../lib/compose-followup.mjs";
import { composeServiceRefusal, type ComposeServiceRefusal } from "../lib/compose-service-refusal.mjs";
import { buildShareUrl, decodeShareParams } from "../lib/anywhere-share.mjs";
import { consumeAnchorCoords } from "../lib/location-anchor.mjs";
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

interface LiveSourceHealth {
  status?: string;
  result?: string;
  reasons?: string[];
  selected_source_count?: number;
  responding_source_count?: number;
  event_bearing_source_count?: number;
  empty_source_count?: number;
  failed_source_count?: number;
  unavailable_source_count?: number;
  raw_event_count?: number;
  normalized_event_count?: number;
  accepted_event_count?: number;
  surfaced_event_count?: number;
  rejected_event_count?: number;
}

interface LiveEvents {
  coverage?: string;
  pending?: boolean;
  feed?: { label?: string; license?: string } | null;
  feeds?: Array<{ label?: string; license?: string | null }>;
  acquisition?: { source_health?: LiveSourceHealth | null } | null;
  tonight?: PulseEvent[];
  this_week?: PulseEvent[];
  browse?: {
    contract?: string;
    max_rows_per_bucket?: number;
    tonight?: { ranked_event_count?: number; highlight_count?: number; more_count?: number; hidden_count?: number; more?: PulseEvent[] };
    this_week?: { ranked_event_count?: number; highlight_count?: number; more_count?: number; hidden_count?: number; more?: PulseEvent[] };
  };
}

const LIVE_QUERY_REFRESH_DELAYS_MS = [1500, 3000, 5000] as const;

function waitForLiveQueryRetry(delayMs: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error("live_event_query_aborted"));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error("live_event_query_aborted"));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs);
    signal.addEventListener("abort", onAbort, { once: true });
  });
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
  // The candidate spine's preference axes (#369 covered_preferences) use the
  // loader's category vocabulary — aliases so raw engine tokens never render.
  scenic: { sv: "Utsikt", en: "Views" },
  museums: { sv: "Kultur", en: "Culture" },
  coffee: { sv: "Fika", en: "Coffee" },
  bars: { sv: "Bar", en: "Bars" },
  swimming: { sv: "Bad", en: "Swimming" },
  vintage: { sv: "Second hand", en: "Vintage" },
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

const PLANNER_INTENT_ALIASES: Record<string, string> = {
  scenic: "views",
  museums: "culture",
  coffee: "fika",
  bars: "nightlife",
  vintage: "second_hand",
};

const HOURS_RELEVANT_TYPES = new Set([
  "museum",
  "gallery",
  "restaurant",
  "cafe",
  "bar",
  "market",
  "vintage-shop",
  "street-food",
  "castle",
]);

function partialPreferenceLabels(stop: any, selected: string[], lang: Lang): string[] {
  const requested = new Set(selected.map((value) => PLANNER_INTENT_ALIASES[value] || value));
  const labels: string[] =
    (Array.isArray(stop?.partial_preferences) ? stop.partial_preferences : [])
      .map((value: string) => PLANNER_INTENT_ALIASES[value] || value)
      .filter((value: string) => requested.has(value))
      .map((value: string) => label(INTENT_LABELS, value, lang));
  return [...new Set<string>(labels)];
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
  // The day on screen was composed for an earlier request and a newer one is in
  // flight. It stays visible, labelled, until the next verdict replaces it.
  const [dayIsStale, setDayIsStale] = useState(false);
  // "Not this" — the day's commitment ledger, v1. One verb: the user can remove
  // a place from consideration. Held here and sent with the next compose.
  // ONE ledger: candidate id -> the single commitment that applies to it. A
  // candidate cannot be both kept and dismissed, because that state cannot be
  // represented — the newest explicit action replaces the previous one.
  const [commitments, setCommitments] = useState<Record<string, { kind: "exclude" | "pin"; label: string }>>({});
  // A dismissal belongs to the day it was made on. Stamped with that day's
  // anchor so it cannot follow the user to another place.
  const commitmentAnchorKeyRef = useRef<string | null>(null);
  // The commitments the day ON SCREEN actually answered — set only when an
  // authoritative compose comes back, never when the user clicks. The editable
  // ledger above runs ahead of the day by design (a click, then 400ms of
  // debounce, then a request), so judging the rendered stops against it accuses
  // a day that was never asked the question. A refusal or a failed request
  // leaves this untouched for the same reason.
  const [appliedPinnedIds, setAppliedPinnedIds] = useState<string[]>([]);
  // Which anchor the visible day belongs to. A day for another place is never
  // held over, not even for a second.
  const displayedAnchorKeyRef = useRef<string | null>(null);
  const [serviceRefusal, setServiceRefusal] = useState<ComposeServiceRefusal | null>(null);
  // Memory-only copy of the trusted coordinate anchor used for this response.
  // It frames the consumer Maps route but is never persisted or put in a URL.
  const [routeAnchorCoords, setRouteAnchorCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [blitzPhase, setBlitzPhase] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [blitzResult, setBlitzResult] = useState<AnywhereBlitzView | null>(null);
  const [mapDrawn, setMapDrawn] = useState(false);
  const [upgradePending, setUpgradePending] = useState(false); // cold-start: structure upgrade in flight
  const [liveRefreshExhausted, setLiveRefreshExhausted] = useState(false);
  const [savedDays, setSavedDays] = useState<SavedEntry[]>([]);
  const [restoredAt, setRestoredAt] = useState<string | null>(null); // set when showing a SNAPSHOT
  const [shareCopied, setShareCopied] = useState(false);
  // Adjustments are collapsed into a one-line summary by default (design
  // handoff §2): past the landing there is no second form and no submit — the
  // day re-composes on its own when an adjustment settles.
  const [adjustOpen, setAdjustOpen] = useState(false);
  const recomposeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestSequenceRef = useRef(0);
  const activeRequestRef = useRef<AbortController | null>(null);
  const blitzRequestRef = useRef<AbortController | null>(null);
  const blitzRequestSequenceRef = useRef(0);
  const skipFirstAdjustRef = useRef(true);
  // Result-screen chrome (design handoff §3): the map can expand in place, and
  // detours are collapsed by default — optional ideas must never read as part
  // of the route.
  const [mapExpanded, setMapExpanded] = useState(false);
  const [detoursOpen, setDetoursOpen] = useState(false);
  // A tapped stop expands an inline panel (why it's here, the walk, hours when
  // known, an explicit Maps action) instead of ejecting straight to Google Maps.
  // Single-open accordion: opening one closes the others.
  const [expandedStopKey, setExpandedStopKey] = useState<string | null>(null);
  // Candidate ideas use the same disclosure-first interaction without sharing
  // route-stop state. They remain unsequenced evidence, never route stops.
  const [expandedCandidateKey, setExpandedCandidateKey] = useState<string | null>(null);
  // The Live sheet (design handoff §3B): an explorable events surface. TIME is
  // a real axis over the two server buckets. SCOPE uses the separate
  // live_event_query_v1 contract: route geometry and the trusted day anchor are
  // read-only inputs, while a fresh near-me consent supplies coordinates for
  // Live only. Nothing here re-composes or changes the day anchor.
  const [liveSheetOpen, setLiveSheetOpen] = useState(false);
  const [liveSheetTime, setLiveSheetTime] = useState<"tonight" | "week">("tonight");
  const [liveSheetScope, setLiveSheetScope] = useState<LiveEventScope>("around_place");
  const [liveQueryEvents, setLiveQueryEvents] = useState<LiveEvents | null>(null);
  const [liveQueryPending, setLiveQueryPending] = useState(false);
  const [liveQueryError, setLiveQueryError] = useState<string | null>(null);
  const [liveQueryGeoHint, setLiveQueryGeoHint] = useState<string | null>(null);
  const mapRef = useRef<HTMLDivElement | null>(null);
  const leafletRef = useRef<{ map: any; layer: any } | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const liveSheetTriggerRef = useRef<HTMLButtonElement | null>(null);
  const liveSheetDialogRef = useRef<HTMLDivElement | null>(null);
  const liveSheetCloseRef = useRef<HTMLButtonElement | null>(null);
  const liveQueryAbortRef = useRef<AbortController | null>(null);
  const lastEntryRef = useRef<SavedEntry | null>(null); // the latest composed day, for "save"

  const t = (sv: string, en: string) => (lang === "en" ? en : sv);
  const typedPlaceLabel = place.trim();

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
      excludedOverride,
      pinnedOverride,
      pollAttempt = 0,
    }: {
      silent?: boolean;
      langOverride?: Lang;
      preferencesOverride?: string[];
      dayOffsetOverride?: 0 | 1;
      walkKeyOverride?: string;
      excludedOverride?: string[];
      pinnedOverride?: string[];
      pollAttempt?: number;
    } = {},
  ) {
    if (!silent && pollTimerRef.current) {
      clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    activeRequestRef.current?.abort();
    const controller = new AbortController();
    const requestId = ++requestSequenceRef.current;
    activeRequestRef.current = controller;
    // A valid day for the SAME anchor is held on screen while the next one
    // composes, instead of being destroyed for the 5-20 s the compose takes.
    const nextAnchorKey = anchorKey(anchor);
    // Genuinely new geography drops the ledger; the same anchor keeps it.
    const scopedLedger = scopeCommitmentsToAnchor({
      entries: commitments,
      ledgerAnchorKey: commitmentAnchorKeyRef.current,
      nextAnchorKey,
    });
    if (!scopedLedger.applies) {
      commitmentAnchorKeyRef.current = null;
      if (Object.keys(commitments).length) setCommitments({});
    }
    const retention = planRecomposeRetention({
      silent,
      previousStatus: classification?.status ?? null,
      previousAnchorKey: displayedAnchorKeyRef.current,
      nextAnchorKey,
    });
    if (!silent) {
      blitzRequestRef.current?.abort();
      blitzRequestRef.current = null;
      setBlitzPhase("idle");
      setBlitzResult(null);
      liveQueryAbortRef.current?.abort();
      liveQueryAbortRef.current = null;
      setLiveRefreshExhausted(false);
      setUpgradePending(false);
      setPhase("loading");
      setDayIsStale(retention.keepPrevious);
      if (!retention.keepPrevious) {
        setClassification(null);
        setSafeResponse(null);
        displayedAnchorKeyRef.current = null;
      }
      setServiceRefusal(null);
      setMapDrawn(false);
      setExpandedStopKey(null);
      setExpandedCandidateKey(null);
      setLiveSheetScope("around_place");
      setLiveQueryEvents(null);
      setLiveQueryPending(false);
      setLiveQueryError(null);
      setLiveQueryGeoHint(null);
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
        excludedCandidateIds: excludedOverride ?? scopedLedger.excludedIds,
        pinnedCandidateIds: pinnedOverride ?? scopedLedger.pinnedIds,
      });
      const response = await fetch(`/api/route-recommendations?lang=${langOverride ?? lang}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      const body = await response.json();
      if (controller.signal.aborted || requestId !== requestSequenceRef.current) return;
      const refusal = composeServiceRefusal(response.status, body);
      if (refusal) {
        setServiceRefusal(refusal);
        setClassification(null);
        setSafeResponse(null);
        displayedAnchorKeyRef.current = null;
        // A transport or capacity refusal composed no day at all, so there is
        // no evidence that any commitment could not be met. Reporting one here
        // would invent a verdict out of a network failure.
        setAppliedPinnedIds([]);
        setDayIsStale(false);
        setUpgradePending(false);
        setPhase("done");
        return;
      }
      if (!response.ok) throw new Error(`compose_http_${response.status}`);
      const decision = anywhereDecision();
      // With a coords anchor there is no typed text — the label falls back to a
      // neutral "your position" (the engine's resolved label wins when present).
      const fallbackLabel = anchor.place ?? t("din position", "your position");
      const cls = decision.classifyAnywhereResult(body, { place: fallbackLabel });
      const safe = decision.safeResponseFor(body, cls);
      // Atomic replacement. If the new verdict is structure_only/unavailable,
      // the held day disappears here — it no longer answers the request.
      setClassification(cls);
      setSafeResponse(safe);
      displayedAnchorKeyRef.current = anchorKey(anchor);
      // This day answered exactly the pins this request carried. Recording them
      // here — beside the classification, not beside the click — is what ties
      // the unhonoured verdict to a day that was actually asked.
      setAppliedPinnedIds(pinnedOverride ?? scopedLedger.pinnedIds);
      setDayIsStale(false);
      setServiceRefusal(null);
      setRouteAnchorCoords(anchor.coords ?? null);
      setPhase("done");
      if (silent) setUpgradePending(false);
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
      // Bounded silent re-asks cover cold-start honesty gaps. The POLICY —
      // which composes re-ask, with what delay, and when the live ladder is
      // exhausted — is the pure, unit-tested planComposeFollowup; this block
      // only owns the timer and state.
      const followup = planComposeFollowup({
        composed: cls.status === "composed",
        structureOnly: cls.status === "structure_only",
        hasStructure: Boolean(safe?.place_structure),
        transientSourceRetry: decision.shouldRetryTransientSource(body, cls),
        livePending: safe?.live_events?.pending === true,
        silent,
        pollAttempt,
      });
      setLiveRefreshExhausted(followup.liveRefreshExhausted);
      if (followup.schedule) {
        if (followup.upgradePending) setUpgradePending(true);
        if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
        const effectivePreferences = preferencesOverride ?? selected;
        const effectiveExcluded = excludedOverride ?? scopedLedger.excludedIds;
        const effectivePinned = pinnedOverride ?? scopedLedger.pinnedIds;
        pollTimerRef.current = setTimeout(() => {
          execute(anchor, {
            silent: true,
            langOverride: langOverride ?? lang,
            preferencesOverride: effectivePreferences,
            dayOffsetOverride: effectiveDayOffset,
            walkKeyOverride: effectiveWalkKey,
            excludedOverride: effectiveExcluded,
            pinnedOverride: effectivePinned,
            pollAttempt: followup.nextPollAttempt,
          }).catch(() => {});
        }, followup.delayMs ?? 0);
      }
    } catch {
      if (controller.signal.aborted || requestId !== requestSequenceRef.current) return;
      if (silent) {
        setUpgradePending(false);
        setLiveRefreshExhausted(true);
      } else {
        setPhase("error");
      }
    } finally {
      if (activeRequestRef.current === controller) activeRequestRef.current = null;
    }
  }

  useEffect(() => () => {
    if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    activeRequestRef.current?.abort();
    blitzRequestRef.current?.abort();
    liveQueryAbortRef.current?.abort();
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
    // Saved days do not carry the commitments they were composed under, so a
    // restored snapshot cannot answer for any of them — not even when the
    // anchor happens to match and the ledger survives scoping below.
    setAppliedPinnedIds([]);
    // A restored snapshot owns the screen outright; it is labelled by
    // restoredAt, never by the recompose "updating" state.
    const restoredAnchorKey = anchorKey({
      place: typeof i?.place === "string" ? i.place : undefined,
    });
    displayedAnchorKeyRef.current = restoredAnchorKey;
    // Restoring is the one in-session path that puts a day on screen without a
    // compose, so the ledger is dropped outright rather than scoped.
    //
    // Scoping by anchor was not enough: saved days do not persist the
    // commitments they were composed under, so a snapshot of the same place
    // cannot be assumed to have answered the ones held right now. Keeping them
    // left the restored day carrying a ledger it never saw — armed, and
    // claiming choices the stops on screen may not reflect. Matching geography
    // is not evidence of a matching day.
    commitmentAnchorKeyRef.current = null;
    if (Object.keys(commitments).length) setCommitments({});
    setDayIsStale(false);
    setRouteAnchorCoords(null);
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
    // The landing chose a LOCATION anchor: coordinates were handed off via
    // sessionStorage (never the URL). The permission was already granted there,
    // so compose directly around the coords — never re-prompt on arrival.
    if (new URLSearchParams(window.location.search).get("anchor") === "near") {
      const coords = consumeAnchorCoords();
      if (coords) {
        setMode("near_me");
        execute({ coords }, {}).catch(() => {});
        return;
      }
      // Stored coords missing/expired (e.g. a reload consumed them): stay honest,
      // show the near-me start context so the user can re-share position.
      setMode("near_me");
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
    // Saving the live result must not turn it into a restored snapshot. Only
    // restoreEntry() sets restoredAt; otherwise the still-visible adjustment
    // controls would change while auto-recompose remained silently paused.
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

  // Blitz is one trusted next move beside the day. It reads the current anchor
  // and preferences but never mutates them, re-composes the route, or changes
  // stop order. Near-me coordinates remain memory-only.
  async function blitz() {
    const typedAnchor = place.trim();
    const nearMeAnchor = mode === "near_me" ? routeAnchorCoords : null;
    if (!nearMeAnchor && !typedAnchor) {
      setBlitzPhase("error");
      setBlitzResult(null);
      return;
    }
    blitzRequestRef.current?.abort();
    const controller = new AbortController();
    const requestId = ++blitzRequestSequenceRef.current;
    blitzRequestRef.current = controller;
    setBlitzPhase("loading");
    setBlitzResult(null);
    try {
      const anchor = nearMeAnchor
        ? { lat: nearMeAnchor.lat, lng: nearMeAnchor.lng }
        : { place: typedAnchor };
      const response = await fetch(`/api/blitz?anywhere_blitz=1&lang=${lang}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...anchor, preferences: selected }),
        signal: controller.signal,
      });
      const body = await response.json();
      if (controller.signal.aborted || requestId !== blitzRequestSequenceRef.current) return;
      if (!response.ok) throw new Error(`blitz_http_${response.status}`);
      const view = anywhereBlitzView(body);
      if (view.state === "invalid") throw new Error("blitz_invalid_contract");
      setBlitzResult(view);
      setBlitzPhase("done");
    } catch {
      if (controller.signal.aborted || requestId !== blitzRequestSequenceRef.current) return;
      setBlitzResult(null);
      setBlitzPhase("error");
    } finally {
      if (blitzRequestRef.current === controller) blitzRequestRef.current = null;
    }
  }

  // An ANCHOR exists once the landing handed one over (typed place or the
  // position it captured). Everything after that is adjustment.
  const hasAnchor = mode === "near_me" || Boolean(place.trim());

  // AUTO-RECOMPOSE: adjustments never need a submit. A settled change (400 ms)
  // starts a latest-request-wins compose. Skipped before the first
  // compose and while showing a restored snapshot, so nothing fires unasked.
  useEffect(() => {
    if (skipFirstAdjustRef.current) {
      skipFirstAdjustRef.current = false;
      return;
    }
    if (!hasAnchor || phase === "idle" || restoredAt) return;
    if (recomposeTimerRef.current) clearTimeout(recomposeTimerRef.current);
    recomposeTimerRef.current = setTimeout(() => {
      resolveAndRun().catch(() => {});
    }, 400);
    return () => {
      if (recomposeTimerRef.current) clearTimeout(recomposeTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, dayOffset, walkKey, commitments]);

  // Leaflet does not observe container resizes — after the expand/collapse
  // transition settles, tell it the viewport changed.
  useEffect(() => {
    const timer = setTimeout(() => leafletRef.current?.map.invalidateSize(), 250);
    return () => clearTimeout(timer);
  }, [mapExpanded]);

  // The Live sheet behaves like a modal: focus enters it, stays inside while it
  // is open, returns to the trigger on close, and the page behind does not scroll.
  useEffect(() => {
    if (!liveSheetOpen) return;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setLiveSheetOpen(false);
        return;
      }
      if (e.key !== "Tab" || !liveSheetDialogRef.current) return;
      const focusable = Array.from(
        liveSheetDialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
        ),
      );
      if (!focusable.length) {
        e.preventDefault();
        liveSheetDialogRef.current.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusFrame = requestAnimationFrame(() => (liveSheetCloseRef.current ?? liveSheetDialogRef.current)?.focus());
    return () => {
      cancelAnimationFrame(focusFrame);
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
      (liveSheetTriggerRef.current ?? previouslyFocused)?.focus();
    };
  }, [liveSheetOpen]);

  // The anchor's display label — never a faked place name: a coords anchor
  // reads "Near you" until the engine attests a real one. A resolver label is a
  // full display chain ("Lyon, Métropole de Lyon, Rhône, …, France"); the pill
  // shows the primary locality only, the same rule the engine applies to route
  // prose (server-side safeAgnosticPlaceLabel).
  const primaryLocality = (value?: string | null) => String(value || "").split(",")[0].trim();
  const anchorLabel =
    mode === "near_me"
      ? primaryLocality(classification?.placeLabel) || t("Nära dig", "Near you")
      : primaryLocality(classification?.placeLabel) || typedPlaceLabel;
  const walkLabel = (() => {
    const preset = WALK_PRESETS.find((p: { key: string }) => p.key === walkKey);
    return preset ? (lang === "en" ? preset.en : preset.sv) : "";
  })();
  const moodLabel = ANYWHERE_PREFERENCES.filter((p: { key: string }) => selected.includes(p.key))
    .map((p: { sv: string; en: string }) => (lang === "en" ? p.en : p.sv))
    .join(" · ");

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
  const pulseState = useMemo(
    () => (liveRefreshExhausted && liveEvents?.pending ? "unavailable" : pulseHealthState(liveEvents, pulseBuckets)),
    [liveEvents, pulseBuckets, liveRefreshExhausted],
  );
  const clothing = useMemo(
    () => clothingAdvice(dayflow?.weather?.provenance?.observed, lang),
    [dayflow, lang],
  );
  const pulseSources = useMemo(() => pulseSourceLine(liveEvents), [liveEvents]);
  const sheetLiveEvents = liveQueryEvents ?? liveEvents;
  const sheetBuckets = useMemo(
    () => pulseEventBuckets(sheetLiveEvents, wovenEventIds(routeStops)),
    [sheetLiveEvents, routeStops],
  );
  const sheetBrowseBuckets = useMemo(
    () => pulseBrowseBuckets(sheetLiveEvents, wovenEventIds(routeStops)),
    [sheetLiveEvents, routeStops],
  );
  const sheetPulseState = useMemo(
    () => pulseHealthState(sheetLiveEvents, sheetBuckets),
    [sheetLiveEvents, sheetBuckets],
  );
  const sheetSources = useMemo(() => pulseSourceLine(sheetLiveEvents), [sheetLiveEvents]);
  const sheetSourceHealth = sheetLiveEvents?.acquisition?.source_health ?? null;
  const routeScopeAvailable = boundedRoutePoints(routeStops).length >= 2;
  const aroundPlaceScopeAvailable = Boolean(
    buildLiveEventQueryPayload({ scope: "around_place", response: safeResponse }),
  );

  async function requestLiveSheetScope(nextScope: LiveEventScope) {
    setLiveQueryGeoHint(null);
    let nearMeCoords: { lat: number; lng: number } | null = null;
    if (nextScope === "near_me") {
      try {
        nearMeCoords = await currentPosition();
      } catch {
        setLiveQueryGeoHint(
          t(
            "Platsdelning nekades — dagens plats och rutt är oförändrade.",
            "Location sharing was denied — the day's place and route are unchanged.",
          ),
        );
        return;
      }
    }

    const payload = buildLiveEventQueryPayload({
      scope: nextScope,
      time: liveSheetTime === "week" ? "this_week" : "tonight",
      preferences: selected,
      response: safeResponse,
      routeStops,
      nearMeCoords,
    });
    if (!payload) {
      setLiveQueryError(
        nextScope === "near_route"
          ? t("En färdig rutt behövs för att söka längs rutten.", "A composed route is needed to search near the route.")
          : t("Platsens betrodda ankare saknas.", "The trusted place anchor is unavailable."),
      );
      return;
    }

    liveQueryAbortRef.current?.abort();
    const controller = new AbortController();
    liveQueryAbortRef.current = controller;
    setLiveSheetScope(nextScope);
    setLiveQueryPending(true);
    setLiveQueryError(null);
    try {
      for (let attempt = 0; attempt <= LIVE_QUERY_REFRESH_DELAYS_MS.length; attempt += 1) {
        if (attempt > 0) {
          await waitForLiveQueryRetry(LIVE_QUERY_REFRESH_DELAYS_MS[attempt - 1], controller.signal);
        }
        const response = await fetch(`/api/live-events?lang=${lang}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });
        const body = await response.json();
        const accepted = response.ok ? acceptedLiveEventQuery(body) : null;
        if (!accepted) throw new Error("live_event_query_contract_rejected");
        setLiveQueryEvents(accepted as LiveEvents);
        if (!(accepted as LiveEvents).pending) break;
      }
    } catch {
      if (controller.signal.aborted) return;
      setLiveQueryError(
        t(
          "Live-vyn kunde inte uppdateras — dagens plats och rutt är oförändrade.",
          "The Live view couldn't update — the day's place and route are unchanged.",
        ),
      );
    } finally {
      if (liveQueryAbortRef.current === controller) {
        liveQueryAbortRef.current = null;
        setLiveQueryPending(false);
      }
    }
  }
  const eveningEvent: any = day?.evening_event ?? null;
  // A single "open the whole day in Google Maps" walking route across every
  // coord-bearing primary-route stop, in the exact order the API returned.
  // Near-me plans preserve the engine's loop from/to the user's trusted anchor;
  // typed-place plans retain the existing first-stop -> last-stop contract.
  const routeUrl = useMemo(
    () => mapsWalkingRouteUrl(
      routeStops,
      routeAnchorCoords ? { origin: routeAnchorCoords, destination: routeAnchorCoords } : undefined,
    ),
    [routeStops, routeAnchorCoords],
  );
  // District composition deliberately sees a broader candidate universe than
  // the route. Keep only a tiny, proximity-bounded, deduped slice as optional
  // discovery context; these candidates never enter routeStops or routeUrl.
  const routeContextSuggestions = useMemo(
    () => buildRouteContextSuggestions(routeStops, day?.areas, { limit: 3, maxDistanceKm: 1.5 }),
    [routeStops, day?.areas],
  );
  const routeCoverage = useMemo(
    () => routePreferenceCoverage(routeStops, selected),
    [routeStops, selected],
  );
  // Local-time anchoring truth from the engine's caveat vocabulary (#429):
  // "this is a full-day arc, not now" vs "anchored to now, earlier dayparts
  // trimmed". Unknown/absent → no line, never a guess.
  const timeAnchoring = useMemo(() => routeTimeAnchoring(primaryRoute), [primaryRoute]);

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

        const markerPresentation = routeMarkerPresentation(routeStops);
        routeStops.forEach((stop: any, index: number) => {
          if (!Number.isFinite(stop?.lat) || !Number.isFinite(stop?.lng)) return;
          bounds.push([stop.lat, stop.lng]);
          const presentation = markerPresentation[index];
          const eventClass = stop.is_live_event === true ? " route-map-marker--event" : "";
          const clusteredClass = presentation?.clustered ? " route-map-marker-shell--clustered" : "";
          const shiftX = Number(presentation?.shift_x_px) || 0;
          const shiftY = Number(presentation?.shift_y_px) || 0;
          const icon = L.divIcon({
            className: `route-map-marker-shell${clusteredClass}`,
            html: `<span class="route-map-marker${eventClass}" style="--route-marker-x:${shiftX}px;--route-marker-y:${shiftY}px">${index + 1}</span>`,
            iconSize: [72, 72],
            iconAnchor: [36, 36],
          });
          const marker = L.marker([stop.lat, stop.lng], { icon, zIndexOffset: 1200 + index });
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
        // No route exists: these are CANDIDATES, not an itinerary. No connecting
        // arc, no sequence numbers — plain dots only, so nothing on the map can
        // be mistaken for a walking order Parranda never claimed.
        areas.forEach((area) => {
          bounds.push([area.center!.lat, area.center!.lng]);
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

  // A limited day is a real day. It renders its actual stops; only the honest
  // caveat line differs.
  const showDay =
    classification?.status === "composed" || classification?.status === "composed_limited";
  const showStructure = showDay || classification?.status === "structure_only";
  const dayLimitations = classification?.limitations ?? [];
  // "updating" while the next verdict computes, "update_failed" if it never
  // arrived. Either way the day on screen is explicitly not current.
  const staleNotice = staleDayNotice({ isStale: dayIsStale, phase });
  // Dismissing is only offered where we have a real id to dismiss BY — never on
  // an index fallback, which would remove whatever happens to sit there next.
  // One primitive behind every verb. Keep (an existing stop) and Add (a
  // candidate the day did not choose) are the same commitment — "this must be
  // in the day" — reached from two places. Writing the map by key is what makes
  // exclude and pin unable to contradict each other: the newest action wins.
  const commit = (identity: string, kind: "exclude" | "pin", commitLabel: string) => {
    if (!identity || commitments[identity]?.kind === kind) return;
    setExpandedStopKey(null);
    setExpandedCandidateKey(null);
    // The anchor of the day on screen — the geography this commitment is about.
    commitmentAnchorKeyRef.current = displayedAnchorKeyRef.current;
    // The label travels with the commitment so a day that could not keep a
    // place can name it, without a second map to fall out of sync.
    setCommitments({ ...commitments, [identity]: { kind, label: commitLabel } });
  };
  const dismissStop = (identity: string, stopLabel: string) => commit(identity, "exclude", stopLabel);
  const keepStop = (identity: string, stopLabel: string) => commit(identity, "pin", stopLabel);
  const releaseCommitment = (identity: string) => {
    if (!identity || !commitments[identity]) return;
    const next = { ...commitments };
    delete next[identity];
    setCommitments(next);
  };
  const excludedCount = Object.values(commitments).filter((entry) => entry.kind === "exclude").length;
  const pinnedCount = Object.values(commitments).filter((entry) => entry.kind === "pin").length;
  // A pin the composed day does not contain. The server resolves pins against
  // the candidates it loaded itself and will not invent a place to satisfy
  // one — so this is reported, never swallowed.
  const unkept = unhonouredPins({
    entries: commitments,
    pinnedIds: appliedPinnedIds,
    stopIds: split.core.map((stop: any) => String(stop?.id ?? stop?.place_id ?? stop?.candidate_id ?? "")),
    isStale: dayIsStale,
  });
  // Some caps have no sentence of their own because a more specific surface
  // already states them (see day-limitations.mjs). Guard on the rendered note,
  // never on the cap count, or those days render an empty bullet.
  const dayLimitationNote = limitationNote(dayLimitations, split.core.length, t);

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
      {/* ANCHOR — chosen once on the landing. "Change" goes back there to pick
          a new one; it is never a second form here. */}
      {hasAnchor && (
        <div className="flex min-h-12 items-center gap-2.5 rounded-full border border-parranda-ink/14 bg-parranda-ink/5 py-1 pl-4 pr-1.5">
          <span aria-hidden="true" className="text-parranda-ember">◉</span>
          <span className="min-w-0 flex-1 truncate text-[15px] font-bold text-parranda-ink">
            {anchorLabel}
            <span className="font-medium text-parranda-ink/65">
              {" · "}
              {dayOffset === 0 ? t("idag", "today") : t("imorgon", "tomorrow")}
            </span>
          </span>
          <a
            href={`/?lang=${lang}`}
            aria-label={t("Byt plats", "Change place")}
            className="inline-flex min-h-11 shrink-0 items-center rounded-full bg-parranda-ink/10 px-3.5 text-xs font-bold text-parranda-ink/80 transition hover:bg-parranda-ink/15"
          >
            {t("Byt", "Change")}
          </a>
        </div>
      )}

      {/* No anchor (someone opened /anywhere directly): offer the one input that
          sets it, then never again. */}
      {!hasAnchor && (
        <form onSubmit={plan} className="flex flex-col gap-2 sm:flex-row">
          <input
            value={place}
            onChange={(e) => setPlace(e.target.value)}
            placeholder={t("Var som helst — Lyon, Tbilisi, Kyoto …", "Anywhere — Lyon, Tbilisi, Kyoto …")}
            aria-label={t("Plats", "Place")}
            className="min-h-14 w-full flex-1 rounded-parranda border border-parranda-ink/16 bg-parranda-ink/6 px-5 text-parranda-ink outline-none focus:border-parranda-ember"
          />
          <button
            type="submit"
            className="min-h-14 whitespace-nowrap rounded-parranda bg-parranda-terracotta px-6 font-bold text-white shadow-sm transition hover:brightness-110"
          >
            {t("Bygg min dag", "Build my day")}
          </button>
        </form>
      )}

      {/* ADJUSTMENTS — collapsed to one line by default; expanding reveals the
          grouped panel. Every change re-composes on its own (no submit). */}
      {hasAnchor && !adjustOpen && (
        <div className="flex min-h-12 items-center gap-2.5 rounded-parranda border border-parranda-ink/12 bg-parranda-ink/4 py-1.5 pl-4 pr-1.5">
          <span className="min-w-0 flex-1 text-[13px] leading-snug text-parranda-ink/65">
            <strong className="font-bold text-parranda-ink">{moodLabel || t("Inga val", "No moods")}</strong>
            {` · ${dayOffset === 0 ? t("Idag", "Today") : t("Imorgon", "Tomorrow")} · ${t("Gångmål", "Walking target")}: ${walkLabel}`}
          </span>
          <button
            type="button"
            aria-expanded={false}
            onClick={() => setAdjustOpen(true)}
            className="inline-flex min-h-11 shrink-0 items-center rounded-full border border-parranda-ink/16 px-3.5 text-xs font-bold text-parranda-ink/80 transition hover:border-parranda-ember"
          >
            {t("Justera", "Adjust")} ▾
          </button>
        </div>
      )}

      {hasAnchor && adjustOpen && (
        <div className="flex flex-col gap-3 rounded-parranda border border-parranda-ink/12 bg-parranda-ink/4 p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-extrabold uppercase tracking-[0.16em] text-parranda-ink/65">
              {t("Justera dagen", "Adjust the day")}
            </span>
            <button
              type="button"
              aria-expanded={true}
              onClick={() => setAdjustOpen(false)}
              className="inline-flex min-h-11 items-center rounded-full border border-parranda-ink/16 px-3.5 text-xs font-bold text-parranda-ink/80 transition hover:border-parranda-ember"
            >
              {t("Klar", "Done")} ▴
            </button>
          </div>

          <div className="flex flex-col gap-2">
            <p className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-parranda-glow">{t("Känsla", "Mood")}</p>
            <div className="flex flex-wrap gap-2">
              {ANYWHERE_PREFERENCES.map((pref: { key: string; sv: string; en: string }) => {
                const active = selected.includes(pref.key);
                return (
                  <button
                    type="button"
                    key={pref.key}
                    aria-pressed={active}
                    onClick={() => setSelected((cur) => (active ? cur.filter((k) => k !== pref.key) : [...cur, pref.key]))}
                    className={
                      "inline-flex min-h-11 items-center rounded-full border px-4 text-[13px] transition " +
                      (active
                        ? "border-parranda-ember/55 bg-parranda-ember/12 font-bold text-parranda-ink"
                        : "border-parranda-ink/14 text-parranda-ink/65 hover:border-parranda-ink/30")
                    }
                  >
                    {active ? "✓ " : ""}
                    {lang === "en" ? pref.en : pref.sv}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex flex-col gap-2 border-t border-parranda-ink/10 pt-3">
            <p className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-parranda-glow">{t("När", "When")}</p>
            <div className="inline-flex self-start overflow-hidden rounded-full border border-parranda-ink/14" role="group" aria-label={t("Vilken dag", "Which day")}>
              {([0, 1] as const).map((offset) => (
                <button
                  type="button"
                  key={offset}
                  aria-pressed={dayOffset === offset}
                  onClick={() => setDayOffset(offset)}
                  className={
                    "inline-flex min-h-11 items-center px-[18px] text-[13px] transition " +
                    (dayOffset === offset ? "bg-parranda-ember/16 font-bold text-parranda-ink" : "text-parranda-ink/65")
                  }
                >
                  {offset === 0 ? t("Idag", "Today") : t("Imorgon", "Tomorrow")}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-2 border-t border-parranda-ink/10 pt-3">
            <p className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-parranda-glow">{t("Gånglängd", "Walking")}</p>
            <div className="inline-flex self-start overflow-hidden rounded-full border border-parranda-ink/14" role="group" aria-label={t("Gånglängd", "Walking length")}>
              {WALK_PRESETS.map((preset: { key: string; km: number; sv: string; en: string }) => (
                <button
                  type="button"
                  key={preset.key}
                  aria-pressed={walkKey === preset.key}
                  onClick={() => setWalkKey(preset.key)}
                  className={
                    "inline-flex min-h-11 items-center px-4 text-[13px] transition " +
                    (walkKey === preset.key ? "bg-parranda-ember/16 font-bold text-parranda-ink" : "text-parranda-ink/65")
                  }
                >
                  {lang === "en" ? preset.en : preset.sv}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[11px] text-parranda-ink/50">
              {t("Ändringar gäller av sig själva — dagen komponeras om medan du justerar.", "Changes apply on their own — the day recomposes as you adjust.")}
            </p>
            <button
              type="button"
              onClick={blitz}
              disabled={blitzPhase === "loading"}
              className="inline-flex min-h-11 items-center text-[11px] font-bold text-parranda-clay underline underline-offset-2 transition hover:text-parranda-ember"
            >
              {blitzPhase === "loading" ? t("⚡ Läser läget …", "⚡ Reading the moment …") : t("⚡ Blitz just nu", "⚡ Blitz right now")}
            </button>
          </div>
        </div>
      )}

      {blitzPhase !== "idle" && (
        <section className="rounded-parranda border border-parranda-ember/35 bg-gradient-to-br from-parranda-terracotta/12 to-parranda-glow/5 p-4" aria-live="polite">
          <div className="flex items-center gap-2">
            <span aria-hidden="true" className="h-2 w-2 rounded-full bg-parranda-glow" />
            <p className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-parranda-glow">
              {t("Blitz just nu", "Blitz right now")}
            </p>
          </div>
          {blitzPhase === "loading" && (
            <p className="mt-2 text-sm text-parranda-ink/70">
              {t("Läser tiden, platsen och vad som händer nära dig …", "Reading the time, place and what is happening nearby …")}
            </p>
          )}
          {blitzPhase === "error" && (
            <p className="mt-2 text-sm text-parranda-ink/75">
              {t("Blitz kunde inte läsa läget just nu. Din plan är oförändrad.", "Blitz could not read the moment right now. Your day is unchanged.")}
            </p>
          )}
          {blitzPhase === "done" && blitzResult?.state === "blocked" && (
            <p className="mt-2 text-sm text-parranda-ink/75">
              {t("Inget tillräckligt pålitligt nästa drag hittades nära dig just nu. Din plan är oförändrad.", "No sufficiently reliable next move was found nearby right now. Your day is unchanged.")}
            </p>
          )}
          {blitzPhase === "done" && blitzResult?.state === "available" && blitzResult.best && (() => {
            const move = blitzResult.best;
            const timing = move.kind === "live_event" ? eventTiming(move, lang) : "";
            const mapsUrl = mapsPlaceUrl(
              { name: move.title, lat: move.lat ?? undefined, lng: move.lng ?? undefined },
              typedPlaceLabel || undefined,
            );
            const secondary = blitzResult.live_option || blitzResult.backup;
            return (
              <div className="mt-2 flex flex-col gap-3">
                <div>
                  <p className="font-display text-2xl leading-tight text-parranda-ink">{move.title}</p>
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-parranda-ink/65">
                    {move.kind === "live_event" && <span>{t("Live-händelse", "Live event")}</span>}
                    {timing && <span>{timing}</span>}
                    {Number.isFinite(move.walking_minutes) && <span>{move.walking_minutes} {t("min till fots", "min walk")}</span>}
                    {move.source.label && <span>{move.source.label}</span>}
                  </div>
                </div>
                <p className="text-xs text-parranda-ink/55">
                  {t("Ett källstött nästa drag utifrån platsen, tiden och dina val. Det ändrar inte dagens rutt.", "A source-backed next move from your place, time and picks. It does not change today's route.")}
                </p>
                <div className="flex flex-wrap gap-2">
                  {mapsUrl && (
                    <a href={mapsUrl} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center rounded-parranda-btn bg-parranda-terracotta px-4 text-sm font-bold text-white transition hover:brightness-110">
                      {t("Öppna i Maps ↗", "Open in Maps ↗")}
                    </a>
                  )}
                  {move.source.url && (
                    <a href={move.source.url} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center rounded-parranda-btn border border-parranda-ink/16 px-4 text-sm font-bold text-parranda-ink/75">
                      {t("Källa ↗", "Source ↗")}
                    </a>
                  )}
                </div>
                {secondary && (
                  <p className="border-t border-parranda-ink/10 pt-2 text-xs text-parranda-ink/60">
                    {secondary.kind === "live_event" ? t("Senare nära dig: ", "Later nearby: ") : t("Annars nära dig: ", "Otherwise nearby: ")}
                    <span className="font-semibold text-parranda-ink/80">{secondary.title}</span>
                  </p>
                )}
              </div>
            );
          })()}
        </section>
      )}

      {geoHint && <p className="text-sm text-parranda-ink/70">{geoHint}</p>}

      {/* The ledger is stated where the user can always see it — including when
          dismissing left no day at all, which is exactly when a way back
          matters most. Hiding it behind a collapsed panel made the dismissal
          effectively irreversible. */}
      {(excludedCount > 0 || pinnedCount > 0) && (
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-parranda-ink/60" role="status">
          {pinnedCount > 0 && (
            <span className="inline-flex items-center gap-1.5">
              <span aria-hidden="true" className="text-parranda-ember">✦</span>
              {pinnedCount === 1
                ? t("1 plats behålls", "1 place kept")
                : t(`${pinnedCount} platser behålls`, `${pinnedCount} places kept`)}
            </span>
          )}
          {excludedCount > 0 && (
            <span className="inline-flex items-center gap-1.5">
              <span aria-hidden="true">−</span>
              {excludedCount === 1
                ? t("1 plats bortvald", "1 place dismissed")
                : t(`${excludedCount} platser bortvalda`, `${excludedCount} places dismissed`)}
            </span>
          )}
          <button
            type="button"
            onClick={() => setCommitments({})}
            className="inline-flex min-h-11 items-center underline underline-offset-2 hover:text-parranda-accent"
          >
            {t("Börja om utan mina val", "Start over without my choices")}
          </button>
        </p>
      )}

      {/* A pin is a request, not a promise. When the day that came back does
          not contain a kept place, say so plainly and name it — the day on
          screen is the evidence. Silently dropping it would let the ledger
          claim something the day does not show. */}
      {unkept.count > 0 && (
        <p className="text-[13px] text-parranda-ink/70" role="status">
          <span aria-hidden="true" className="mr-1.5">!</span>
          {unkept.labels.length === unkept.count && unkept.labels.length > 0
            ? t(
                `Kunde inte få plats i dagen: ${unkept.labels.join(", ")}. Parranda hittar ingen väg dit med det underlag som finns här.`,
                `Could not fit in this day: ${unkept.labels.join(", ")}. Parranda has no way to place it with the evidence it has here.`,
              )
            : unkept.count === 1
              ? t(
                  "En plats du valde kunde inte få plats i dagen.",
                  "One place you kept could not fit in this day.",
                )
              : t(
                  `${unkept.count} platser du valde kunde inte få plats i dagen.`,
                  `${unkept.count} places you kept could not fit in this day.`,
                )}
        </p>
      )}

      {phase === "loading" && !staleNotice && (
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

      {savedDays.length > 0 && (
        <section className="rounded-parranda border border-parranda-ink/10 bg-parranda-ink/5 p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-parranda-ink/60">{t("Sparade dagar", "Saved days")}</p>
          <ul className="mt-2 flex flex-col gap-1.5">
            {savedDays.map((entry) => (
              <li key={entry.id} className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => restoreEntry(entry)}
                  className="inline-flex min-h-11 flex-1 items-center text-left text-sm text-parranda-ink hover:text-parranda-accent"
                >
                  <span className="font-semibold">{entry.label}</span>
                  {entry.dateIso && <span className="text-parranda-ink/60"> · {entry.dateIso}</span>}
                </button>
                <button
                  type="button"
                  onClick={() => removeSavedDay(entry.id)}
                  aria-label={t("Ta bort", "Remove")}
                  className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-full text-parranda-ink/40 hover:text-parranda-accent"
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {phase === "error" && staleNotice !== "update_failed" && (
        <p className="rounded-parranda border border-parranda-ink/10 bg-parranda-ink/5 p-4 text-sm text-parranda-ink/80">
          {t("Motorn svarar inte just nu. Försök igen om en stund.", "The engine isn't answering right now. Try again shortly.")}
        </p>
      )}

      {phase === "done" && serviceRefusal && (
        <p className="rounded-parranda border border-parranda-ink/10 bg-parranda-ink/5 p-4 text-sm text-parranda-ink/80" role="status">
          {serviceRefusal.kind === "busy"
            ? t(
                "Parranda bygger så många dagar som är säkert just nu. Försök igen om en liten stund.",
                "Parranda is composing as many days as it safely can right now. Try again shortly.",
              )
            : t(
                `Parranda behöver pausa nya anrop en stund${serviceRefusal.retry_after_seconds ? ` — försök igen om cirka ${serviceRefusal.retry_after_seconds} sekunder` : ""}.`,
                `Parranda needs to pause new requests briefly${serviceRefusal.retry_after_seconds ? ` — try again in about ${serviceRefusal.retry_after_seconds} seconds` : ""}.`,
              )}
        </p>
      )}

      {phase === "done" && classification?.status === "unavailable" && (
        !upgradePending &&
        <p className="rounded-parranda border border-parranda-ink/10 bg-parranda-ink/5 p-4 text-sm text-parranda-ink/80">
          {/* Two honestly different absences: a place Parranda couldn't
              understand, and a resolved place whose trusted sources hold real
              places — just too few for a reliable day. The count comes from
              the classifier's trusted-loader evidence, never from copy. The
              label follows the pill rule: primary locality, not the resolver's
              full admin chain. */}
          {classification.unavailableReason === "sparse_supply" && classification.realPlaceCount ? (
            t(
              `Parranda hittade ${classification.realPlaceCount === 1 ? "1 riktig plats" : `${classification.realPlaceCount} riktiga platser`} nära ${primaryLocality(classification.placeLabel) || place}, men inte tillräckligt för en pålitlig dag ännu — inget hittas på.`,
              `Parranda found ${classification.realPlaceCount === 1 ? "1 real place" : `${classification.realPlaceCount} real places`} near ${primaryLocality(classification.placeLabel) || place}, but not enough for a reliable day yet — nothing is invented in its place.`,
            )
          ) : (
            t(
              `Parranda kunde inte komponera en dag för ${primaryLocality(classification.placeLabel) || place} ännu — inget hittas på, inget fejkas.`,
              `Parranda couldn't compose a day for ${primaryLocality(classification.placeLabel) || place} yet — nothing is invented in its place.`,
            )
          )}
        </p>
      )}

      {/* THE DAY HEADER (design handoff §3): title, honest counts, provenance,
          and the day-level actions in one row. The timeline below binds to
          primary_route only. */}
      {showDay && routeStops.length > 0 && (
        <header className="flex flex-col gap-2" aria-busy={staleNotice === "updating"}>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <p className="text-[11px] font-extrabold uppercase tracking-[0.16em] text-parranda-glow">{t("Din dag", "Your day")}</p>
            {/* The day on screen is deliberately still here, and deliberately
                marked as not current. Never a silent swap. */}
            {staleNotice === "updating" && (
              <span
                aria-live="polite"
                className="inline-flex items-center gap-1.5 rounded-full bg-parranda-ink/10 px-2.5 py-0.5 text-[11px] font-semibold text-parranda-ink/70"
              >
                <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-parranda-glow motion-safe:animate-pulse" />
                {t("Uppdaterar dagen …", "Updating your day …")}
              </span>
            )}
            {staleNotice === "update_failed" && (
              <span
                aria-live="polite"
                className="inline-flex items-center gap-1.5 rounded-full bg-parranda-ember/12 px-2.5 py-0.5 text-[11px] font-semibold text-parranda-clay"
              >
                {t("Kunde inte uppdatera — visar din förra dag", "Couldn't update — showing your previous day")}
              </span>
            )}
          </div>
          <h2 className="font-display text-4xl font-semibold leading-none text-parranda-ink sm:text-5xl">
            {mode === "near_me" && !classification?.placeLabel ? (
              <>
                {t("En dag", "A day")} <em className="text-parranda-ember">{t("nära dig", "near you")}</em>
              </>
            ) : (
              <>
                {t("En dag i", "A day in")} <em className="text-parranda-ember">{anchorLabel}</em>
              </>
            )}
          </h2>
          <p className="text-[13px] text-parranda-ink/65">
            {dayOffset === 0 ? t("Idag", "Today") : t("Imorgon", "Tomorrow")}
            {Number.isFinite(primaryRoute?.estimated_km)
              ? ` · ≈ ${walkingDistanceLabel(primaryRoute.estimated_km, lang)} ${t("till fots", "on foot")}`
              : ""}
            {Number.isFinite(primaryRoute?.longest_leg_km)
              ? ` · ${t("längsta sträcka", "longest stretch")} ${walkingDistanceLabel(primaryRoute.longest_leg_km, lang)}`
              : ""}
            {` · ${split.core.length} ${split.core.length === 1 ? t("stopp", "stop") : t("stopp", "stops")}`}
            {split.woven.length > 0 ? ` + ${split.woven.length} live${lang === "en" ? " event" : "-event"}` : ""}
          </p>
          {dayLimitationNote && (
            <p className="flex items-start gap-2 text-[13px] leading-relaxed text-parranda-ink/65">
              <span aria-hidden="true" className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-parranda-ink/30" />
              <span>{dayLimitationNote}</span>
            </p>
          )}
          {structure?.provenance === "agnostic_anchor" && (
            <p className="flex items-start gap-2 text-[13px] leading-relaxed text-parranda-ink/65">
              <span aria-hidden="true" className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-parranda-glow" />
              <span>
                {t(
                  "Byggd från källstödda platser — Parranda har inte full kurering här ännu",
                  "Built from source-backed places — Parranda does not have full curation here yet",
                )}
              </span>
            </p>
          )}
          {/* Time-anchoring truth (#429): say when the arc is not anchored to
              the local clock — a today request at 22:00 must not read as a
              doable midday plan. Quietly note the trimmed variant too. */}
          {timeAnchoring === "full_arc_not_now" && (
            <p className="flex items-start gap-2 text-[13px] leading-relaxed text-parranda-ink/65">
              <span aria-hidden="true" className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-parranda-glow" />
              <span>
                {t(
                  "En hel dags båge — inte förankrad till klockan just nu",
                  "A full-day arc — not anchored to right now",
                )}
              </span>
            </p>
          )}
          {timeAnchoring === "anchored_trimmed" && (
            <p className="flex items-start gap-2 text-[13px] leading-relaxed text-parranda-ink/65">
              <span aria-hidden="true" className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-parranda-glow" />
              <span>
                {t(
                  "Förankrad till nu — tidigare dagdelar borttagna",
                  "Anchored to now — earlier dayparts trimmed",
                )}
              </span>
            </p>
          )}
          {restoredAt && (
            <p className="text-xs text-parranda-ink/60">
              {t("Sparad dag", "Saved day")} · {new Date(restoredAt).toLocaleDateString(lang === "en" ? "en-GB" : "sv-SE")} —{" "}
              <button type="button" onClick={() => resolveAndRun()} className="inline-flex min-h-11 items-center underline underline-offset-2 hover:text-parranda-accent">
                {t("bygg om för färska events", "rebuild for fresh events")}
              </button>
            </p>
          )}
          <div className="mt-1 flex gap-2">
            {routeUrl && (
              <a
                href={routeUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-12 flex-1 items-center justify-center rounded-parranda-btn bg-parranda-terracotta px-5 text-sm font-bold text-white shadow-sm transition hover:brightness-110 sm:flex-none sm:px-6"
              >
                {t("Öppna rutten i Maps", "Open route in Maps")}
                <span aria-hidden="true" className="ml-2">↗</span>
              </a>
            )}
            <button
              type="button"
              onClick={saveDay}
              disabled={isSaved}
              aria-label={isSaved ? t("Dagen är sparad", "Day is saved") : t("Spara dagen", "Save this day")}
              className="inline-flex min-h-12 min-w-12 items-center justify-center rounded-parranda-btn border border-parranda-ink/16 text-parranda-ink/80 transition hover:border-parranda-ember disabled:opacity-50"
            >
              {isSaved ? "★" : "☆"}
            </button>
            {canShare && (
              <button
                type="button"
                onClick={shareDay}
                aria-label={t("Dela dagen", "Share this day")}
                className="inline-flex min-h-12 min-w-12 items-center justify-center rounded-parranda-btn border border-parranda-ink/16 text-parranda-ink/80 transition hover:border-parranda-ember"
              >
                {shareCopied ? "✓" : "↗"}
              </button>
            )}
          </div>
        </header>
      )}

      {/* Without a composed day, this card carries provenance only. Save/share
          remain route actions: offering them here would call an unsequenced
          candidate surface a day. */}
      {showStructure && structure && !(showDay && routeStops.length > 0) && (
        <section className="rounded-parranda border border-parranda-ink/10 bg-parranda-ink/5 p-5 shadow-sm">
          <div className="min-w-0 flex-1">
            {structure.provenance === "agnostic_anchor" && (
              <p className="text-sm font-semibold text-parranda-accent">
                {t(
                  "Källstödda platskandidater — inte en komponerad rutt ännu",
                  "Source-backed place candidates — not a composed route yet",
                )}
              </p>
            )}
            {restoredAt && (
              <p className="mt-1 text-xs text-parranda-ink/60">
                {t("Sparad dag", "Saved day")} · {new Date(restoredAt).toLocaleDateString(lang === "en" ? "en-GB" : "sv-SE")} —{" "}
                <button type="button" onClick={() => resolveAndRun()} className="inline-flex min-h-11 items-center underline underline-offset-2 hover:text-parranda-accent">
                  {t("bygg om för färska events", "rebuild for fresh events")}
                </button>
              </p>
            )}
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

      {showDay && routeStops.length > 0 && (
        <section className={`${staleNotice === "updating" ? "opacity-60 motion-safe:transition-opacity" : ""} rounded-parranda border border-parranda-ink/10 bg-parranda-ink/5 p-5 shadow-sm`}>
          {/* Map first (design handoff §3) — it orients the whole timeline and
              can expand in place. */}
          <div className={"relative w-full overflow-hidden rounded-parranda border border-parranda-ink/10 transition-all " + (mapExpanded ? "h-96" : "h-44")}>
            <div ref={mapRef} className="h-full w-full" />
            {!mapDrawn && (
              <div className="absolute inset-0 flex items-center justify-center bg-parranda-ink/10 text-sm text-parranda-ink/60">
                {t("Ritar kartan …", "Drawing the map …")}
              </div>
            )}
            <button
              type="button"
              onClick={() => setMapExpanded((cur) => !cur)}
              aria-expanded={mapExpanded}
              className="absolute right-2.5 top-2.5 z-[1001] inline-flex min-h-11 items-center rounded-full border border-parranda-ink/20 bg-parranda-paper/90 px-3.5 text-xs font-bold text-parranda-ink/85 shadow-sm"
            >
              {mapExpanded ? t("Förminska kartan", "Shrink map") : t("Förstora kartan", "Expand map")} <span aria-hidden="true" className="ml-1.5">⤢</span>
            </button>
          </div>
          {/* Core stops only, grouped under daypart headings taken from
              stop.daypart — only groups that exist render, and the engine's
              order is never changed to force a grouping. A woven live event is
              NOT an ordinary POI — it renders once below, as an attached route
              extension. */}
          <ol className="mt-2 flex flex-col">
            {split.core.map((stop: any, i: number) => {
              const name = String(stop?.label || stop?.name || "").trim();
              if (!name) return null;
              const routeNumber = routeStops.indexOf(stop) + 1;
              const leg = routeNumber === 1 ? null : legForStop(stop);
              const pin = mapsPlaceUrl(stop, mapsPlaceContext);
              const daypart = String(stop?.daypart || "");
              const previousDaypart = i > 0 ? String((split.core[i - 1] as any)?.daypart || "") : "";
              const daypartHeading = daypart && daypart !== previousDaypart ? label(DAYPART_LABELS, stop.daypart, lang) : null;
              const realId = String(stop?.id ?? stop?.place_id ?? stop?.candidate_id ?? "").trim();
              const hasRealId = realId.length > 0;
              const stopIdentity = hasRealId ? realId : String(i);
              const stopKey = `${stopIdentity}:${i}`;
              const panelId = `route-stop-panel-${i}`;
              const expanded = expandedStopKey === stopKey;
              const prevName = routeNumber > 1 ? String((split.core[i - 1] as any)?.label || (split.core[i - 1] as any)?.name || "").trim() : "";
              const hoursLabel = selectedDayHoursLabel(stop?.selected_day_hours, lang);
              const partialLabels = partialPreferenceLabels(stop, selected, lang);
              const hoursRelevant = HOURS_RELEVANT_TYPES.has(String(stop?.type || ""));
              const sourceLabel = String(stop?.source?.label || "").trim();
              return (
                <li key={stopKey} className="flex flex-col">
                  {daypartHeading && (
                    <p className="mb-1.5 mt-3.5 text-[10px] font-extrabold uppercase tracking-[0.2em] text-parranda-glow">{daypartHeading}</p>
                  )}
                  {leg && (leg.minutes != null || leg.km != null) && (
                    <span className="ml-4 border-l border-dashed border-parranda-ink/25 py-1.5 pl-5 text-xs text-parranda-ink/55">
                      ↓ {leg.minutes != null ? `${leg.minutes} min` : ""}
                      {leg.minutes != null && leg.km != null ? " · " : ""}
                      {leg.km != null ? walkingDistanceLabel(leg.km, lang) : ""}
                    </span>
                  )}
                  {/* The stop row is a DISCLOSURE, not an external link: tapping
                      it opens an inline panel instead of ejecting to Google Maps.
                      The Maps jump becomes a deliberate action inside the panel. */}
                  <button
                    type="button"
                    aria-expanded={expanded}
                    aria-controls={panelId}
                    onClick={() => setExpandedStopKey(expanded ? null : stopKey)}
                    className="flex w-full items-start gap-3 py-1 text-left"
                  >
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-parranda-ember/55 bg-parranda-terracotta/20 text-[13px] font-extrabold text-parranda-clay">
                      {routeNumber}
                    </span>
                    <span className="flex flex-1 flex-wrap items-center gap-2 pt-1 text-sm text-parranda-ink">
                      <span className="font-bold">{name}</span>
                      {stop?.type && (
                        <span className="rounded-full border border-parranda-ink/15 bg-parranda-ink/10 px-2 py-0.5 text-xs text-parranda-ink/75">
                          {label(TYPE_LABELS, stop.type, lang)}
                        </span>
                      )}
                    </span>
                    <span
                      aria-hidden="true"
                      className={"shrink-0 pt-1.5 text-lg leading-none transition " + (expanded ? "text-parranda-ember" : "text-parranda-ink/40")}
                    >
                      {expanded ? "▾" : "▸"}
                    </span>
                  </button>
                  {expanded && (
                    <div
                      id={panelId}
                      className="ml-11 mb-1 mt-1 flex flex-col rounded-parranda border border-parranda-ember/35 bg-parranda-ink/[0.03] p-4"
                    >
                      {/* Facts only. The schedule row is a bounded source fact
                          for the selected local day, never an "open now" claim. */}
                      <div className="flex flex-col gap-1.5 text-xs text-parranda-ink/65">
                        {leg && (leg.minutes != null || leg.km != null) && (
                          <span>
                            {leg.minutes != null ? `${leg.minutes} min` : ""}
                            {leg.minutes != null && leg.km != null ? " · " : ""}
                            {leg.km != null ? walkingDistanceLabel(leg.km, lang) : ""}
                            {prevName ? ` ${t("till fots från", "walk from")} ${prevName}` : ` ${t("till fots", "on foot")}`}
                          </span>
                        )}
                        {hoursLabel && <span>{hoursLabel}</span>}
                        {!hoursLabel && hoursRelevant && (
                          <span>{t("Källtider saknas för den valda dagen", "Source hours unavailable for the selected day")}</span>
                        )}
                        {stop?.address && <span>{stop.address}</span>}
                      </div>
                      {partialLabels.length > 0 && (
                        <p className="mt-2 text-xs text-parranda-ink/50">
                          {t("Lösare träff för:", "A looser match for:")} {partialLabels.join(", ")}
                        </p>
                      )}
                      {stop?.candidate_status === "partial" && (
                        <p className="mt-2 text-xs text-parranda-ink/50">
                          {sourceLabel
                            ? t(`Källstöd: ${sourceLabel} · underlaget är fortfarande provisoriskt`, `Source-backed by ${sourceLabel} · evidence is still provisional`)
                            : t("Källunderlaget är fortfarande provisoriskt", "Source evidence is still provisional")}
                        </p>
                      )}
                      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
                        {pin && (
                          <a
                            href={pin}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex min-h-11 w-full items-center justify-center rounded-parranda-btn bg-parranda-terracotta px-4 text-sm font-bold text-white transition hover:brightness-110 sm:w-auto sm:px-5"
                          >
                            {t("Öppna i Maps", "Open in Maps")}
                            <span aria-hidden="true" className="ml-2">↗</span>
                          </a>
                        )}
                        {/* Two verbs, both anchored to a real candidate id.
                            Keep says "whatever else changes, this stays";
                            dismiss removes it from consideration. They are
                            mutually exclusive by construction — the ledger
                            holds one commitment per candidate — so a kept stop
                            offers release rather than the opposite verb. */}
                        {hasRealId && (commitments[stopIdentity]?.kind === "pin" ? (
                          <button
                            type="button"
                            onClick={() => releaseCommitment(stopIdentity)}
                            className="inline-flex min-h-11 w-full items-center justify-center rounded-parranda-btn border border-parranda-ember/45 bg-parranda-ember/10 px-4 text-sm font-semibold text-parranda-ink transition hover:border-parranda-ember sm:w-auto sm:px-5"
                          >
                            <span aria-hidden="true" className="mr-2 text-parranda-ember">✦</span>
                            {t("Behålls — släpp", "Kept — release")}
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => keepStop(stopIdentity, name)}
                            className="inline-flex min-h-11 w-full items-center justify-center rounded-parranda-btn border border-parranda-ink/20 px-4 text-sm font-semibold text-parranda-ink/75 transition hover:border-parranda-ember hover:text-parranda-ink sm:w-auto sm:px-5"
                          >
                            <span aria-hidden="true" className="mr-2">✦</span>
                            {t("Behåll den här", "Keep this one")}
                          </button>
                        ))}
                        {hasRealId && commitments[stopIdentity]?.kind !== "pin" && (
                          <button
                            type="button"
                            onClick={() => dismissStop(stopIdentity, name)}
                            className="inline-flex min-h-11 w-full items-center justify-center rounded-parranda-btn border border-parranda-ink/20 px-4 text-sm font-semibold text-parranda-ink/75 transition hover:border-parranda-ink/40 hover:text-parranda-ink sm:w-auto sm:px-5"
                          >
                            <span aria-hidden="true" className="mr-2">−</span>
                            {t("Inte den här", "Not this one")}
                          </button>
                        )}
                      </div>
                    </div>
                  )}
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
              <div key={stop?.id} className="mt-3 rounded-parranda border border-parranda-ember/50 bg-gradient-to-br from-parranda-terracotta/15 to-parranda-glow/5 p-4">
                <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-parranda-clay">
                  <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-parranda-ember" />
                  {t("Live i din rutt", "Live in your route")}
                </p>
                <p className="mt-1.5 flex flex-wrap items-center gap-2 text-sm font-semibold text-parranda-ink">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-parranda-terracotta text-[13px] font-extrabold text-white">{routeNumber}</span>
                  {pin ? (
                    <a href={pin} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 min-w-11 items-center underline decoration-parranda-accent/50 underline-offset-2 hover:text-parranda-accent">
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
                      <a href={sourceUrl} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 min-w-11 items-center underline underline-offset-2 hover:text-parranda-accent">
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

          {/* Detours — collapsed by default (design handoff §3): optional ideas
              must never read as part of the route, and the caption stays visible
              even while collapsed. */}
          {routeContextSuggestions.length > 0 && (
            <div className="mt-4 border-t border-parranda-ink/10 pt-4">
              <button
                type="button"
                aria-expanded={detoursOpen}
                onClick={() => setDetoursOpen((cur) => !cur)}
                className="flex min-h-12 w-full items-center justify-between rounded-parranda-btn border border-dashed border-parranda-ink/20 px-4 text-[13px] font-bold text-parranda-ink/75 transition hover:border-parranda-ink/35"
              >
                <span>
                  {routeContextSuggestions.length}{" "}
                  {routeContextSuggestions.length === 1
                    ? t("idé nära din rutt", "detour idea near your route")
                    : t("idéer nära din rutt", "detour ideas near your route")}
                </span>
                <span aria-hidden="true">{detoursOpen ? "▾" : "▸"}</span>
              </button>
              <p className="mt-2 text-xs text-parranda-ink/60">
                {t(
                  "Valfria idéer från platsunderlaget — de ingår inte i dagens stopp eller Maps-rutten.",
                  "Optional ideas from the place evidence — they are not part of today's stops or the Maps route.",
                )}
              </p>
              {detoursOpen && (
                <ul className="mt-3 grid gap-2 sm:grid-cols-2">
                  {routeContextSuggestions.map((stop, index) => {
                    const name = String(stop.name || stop.label || "").trim();
                    if (!name) return null;
                    const url = mapsPlaceUrl(
                      { ...stop, lat: stop.lat ?? undefined, lng: stop.lng ?? undefined },
                      mapsPlaceContext,
                    );
                    const candidateKey = `detour:${stop.id || stop.candidate_id || stop.place_id || index}`;
                    // Same id shape the composed stops use, so a pin resolves
                    // against the very candidates the server already loaded.
                    const candidateId = String(stop?.id ?? stop?.place_id ?? stop?.candidate_id ?? "").trim();
                    const candidatePanelId = `candidate-panel-detour-${index}`;
                    const expanded = expandedCandidateKey === candidateKey;
                    return (
                      <li key={stop.id || stop.candidate_id || stop.place_id || name} className="rounded-parranda border border-dashed border-parranda-ink/20 p-3">
                        <button
                          type="button"
                          aria-expanded={expanded}
                          aria-controls={candidatePanelId}
                          onClick={() => setExpandedCandidateKey(expanded ? null : candidateKey)}
                          className="flex min-h-11 w-full items-center justify-between gap-3 text-left text-sm font-semibold text-parranda-ink underline decoration-parranda-accent/50 underline-offset-2 hover:text-parranda-accent"
                        >
                          <span>{name}</span>
                          <span aria-hidden="true">{expanded ? "−" : "+"}</span>
                        </button>
                        <p className="mt-1 text-xs text-parranda-ink/55">
                          {walkingDistanceLabel(stop.distance_km, lang)} {t("från", "from")} {stop.route_stop_name}
                        </p>
                        {expanded && (
                          <div id={candidatePanelId} className="mt-3 border-t border-parranda-ink/10 pt-3">
                            {url && (
                              <a
                                href={url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex min-h-11 w-full items-center justify-center rounded-parranda-btn bg-parranda-terracotta px-4 text-sm font-bold text-white transition hover:brightness-110"
                              >
                                {t("Öppna platsen i Maps", "Open place in Maps")}
                                <span aria-hidden="true" className="ml-2">↗</span>
                              </a>
                            )}
                            {/* Add is the same commitment as Keep, reached from
                                a candidate the day did not choose. The server
                                still has to resolve it against its own loaded
                                pool — an unhonoured pin is reported, not faked. */}
                            {candidateId && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    commitments[candidateId]?.kind === "pin"
                                      ? releaseCommitment(candidateId)
                                      : commit(candidateId, "pin", name)
                                  }
                                  className={`mt-2 inline-flex min-h-11 w-full items-center justify-center rounded-parranda-btn border px-4 text-sm font-semibold transition sm:w-auto ${
                                    commitments[candidateId]?.kind === "pin"
                                      ? "border-parranda-ember/45 bg-parranda-ember/10 text-parranda-ink hover:border-parranda-ember"
                                      : "border-parranda-ink/20 text-parranda-ink/75 hover:border-parranda-ember hover:text-parranda-ink"
                                  }`}
                                >
                                  <span aria-hidden="true" className="mr-2 text-parranda-ember">✦</span>
                                  {commitments[candidateId]?.kind === "pin"
                                    ? t("Med i dagen — släpp", "In my day — release")
                                    : t("Lägg till i min dag", "Add to my day")}
                                </button>
                            )}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}

          {routeCoverage.has_coverage_evidence && routeCoverage.partial_preferences.length > 0 && (
            <p className="mt-4 text-sm italic text-parranda-ink/60">
              {t("Delvis täckt i dagens rutt:", "Partly covered by today's route:")} {routeCoverage.partial_preferences.map((key) => label(INTENT_LABELS, key, lang)).join(", ")}
            </p>
          )}
          {routeCoverage.has_coverage_evidence && routeCoverage.missing_preferences.length > 0 && (
            <p className="mt-4 text-sm italic text-parranda-ink/60">
              {t("Saknas i dagens rutt:", "Not covered by today's route:")} {routeCoverage.missing_preferences.map((key) => label(INTENT_LABELS, key, lang)).join(", ")}
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

          {/* Candidate CLUSTERS, deliberately unnumbered and unsequenced: no rank
              badges, no daypart headings, no inter-cluster walking legs — those
              read as an itinerary, and only primary_route.main_stops is a route. */}
          <ul className="flex flex-col gap-3">
            {(day?.areas ?? []).map((area, index) => (
              <li key={index} className="rounded-parranda border border-parranda-ink/10 bg-parranda-ink/10 p-4">
                <div className="flex flex-wrap items-center gap-1.5">
                  {(area.covers ?? []).map((axis) => (
                    <span key={axis} className="rounded-full border border-parranda-accent/30 bg-parranda-accent/10 px-2.5 py-0.5 text-xs font-semibold text-parranda-ink">
                      {label(INTENT_LABELS, axis, lang)}
                    </span>
                  ))}
                  <span className="ml-auto text-xs text-parranda-ink/60">
                    {(area.stop_ids?.length ?? area.stops?.length ?? 0)} {t("träffar", "places")}
                  </span>
                </div>
                {Array.isArray(area.stops) && area.stops.length > 0 ? (
                  <ul className="mt-2 flex flex-col gap-1 text-sm text-parranda-ink">
                    {area.stops.map((stop, si) => {
                      const url = mapsPlaceUrl(stop, mapsPlaceContext);
                      const name = (stop.name || area.stop_names?.[si] || "").trim();
                      if (!name) return null;
                      const candidateKey = `cluster:${index}:${stop.id || stop.candidate_id || stop.place_id || si}`;
                      const candidateId = String(stop?.id ?? stop?.place_id ?? stop?.candidate_id ?? "").trim();
                      const candidatePanelId = `candidate-panel-cluster-${index}-${si}`;
                      const expanded = expandedCandidateKey === candidateKey;
                      const facts = [...new Set([stop.address, stop.area].map((value) => String(value || "").trim()).filter(Boolean))];
                      return (
                        <li key={stop.id ?? si} className="rounded-parranda-btn border border-parranda-ink/10 px-3 py-1.5">
                          <button
                            type="button"
                            aria-expanded={expanded}
                            aria-controls={candidatePanelId}
                            onClick={() => setExpandedCandidateKey(expanded ? null : candidateKey)}
                            className="flex min-h-11 w-full items-center justify-between gap-3 text-left font-semibold underline decoration-parranda-accent/50 underline-offset-2 hover:text-parranda-accent"
                          >
                            <span>{name}</span>
                            <span aria-hidden="true">{expanded ? "−" : "+"}</span>
                          </button>
                          {expanded && (
                            <div id={candidatePanelId} className="border-t border-parranda-ink/10 pb-2 pt-2">
                              {facts.length > 0 && <p className="text-xs text-parranda-ink/60">{facts.join(" · ")}</p>}
                              {url && (
                                <a
                                  href={url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="mt-2 inline-flex min-h-11 w-full items-center justify-center rounded-parranda-btn bg-parranda-terracotta px-4 text-sm font-bold text-white transition hover:brightness-110 sm:w-auto"
                                >
                                  {t("Öppna platsen i Maps", "Open place in Maps")}
                                  <span aria-hidden="true" className="ml-2">↗</span>
                                </a>
                              )}
                              {candidateId && (
                              <button
                                type="button"
                                onClick={() =>
                                  commitments[candidateId]?.kind === "pin"
                                    ? releaseCommitment(candidateId)
                                    : commit(candidateId, "pin", name)
                                }
                                className={`mt-2 inline-flex min-h-11 w-full items-center justify-center rounded-parranda-btn border px-4 text-sm font-semibold transition sm:w-auto ${
                                  commitments[candidateId]?.kind === "pin"
                                    ? "border-parranda-ember/45 bg-parranda-ember/10 text-parranda-ink hover:border-parranda-ember"
                                    : "border-parranda-ink/20 text-parranda-ink/75 hover:border-parranda-ember hover:text-parranda-ink"
                                }`}
                              >
                                <span aria-hidden="true" className="mr-2 text-parranda-ember">✦</span>
                                {commitments[candidateId]?.kind === "pin"
                                  ? t("Med i dagen — släpp", "In my day — release")
                                  : t("Lägg till i min dag", "Add to my day")}
                              </button>
                            )}
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                ) : (area.stop_names ?? []).length > 0 ? (
                  <p className="mt-2 text-sm text-parranda-ink">{(area.stop_names ?? []).join(" · ")}</p>
                ) : null}
              </li>
            ))}
          </ul>

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

      {phase === "done" &&
        ((liveEvents && (liveEvents.coverage === "covered" || liveEvents.coverage === "uncovered")) ||
          (showDay && dayflow?.weather?.headline) ||
          aroundPlaceScopeAvailable) && (
        <section className="rounded-parranda border border-parranda-ink/10 bg-parranda-ink/5 p-5 shadow-sm">
          {/* PULSE — the city's now-context: weather read, rhythm advice, current
              events. Renders independently of route composition (live_events
              survives a blocked compose), so a failed route never hides trusted
              context; and the trusted weather read shows even when no event
              source exists. Woven events are excluded here — they own the
              route-extension presentation above. */}
          <p className="text-xs font-semibold uppercase tracking-wider text-parranda-ink/60">
            {mode === "near_me"
              ? t("Just nu nära dig", "Now near you")
              : anchorLabel
                ? t(`Just nu i ${anchorLabel}`, `Now in ${anchorLabel}`)
                : t("Just nu här", "Now here")}
          </p>

          {showDay && dayflow?.weather?.headline && (
            <p className="mt-2 text-sm font-semibold text-parranda-ink">
              {dayflow.weather.headline}
              {dayflow.weather.pitch ? <span className="font-medium"> — {dayflow.weather.pitch}</span> : null}
            </p>
          )}
          {clothing && (
            <p className="mt-1 text-sm text-parranda-ink">
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
              {t("Inga listade händelser just nu — lugnt i kalendern.", "Nothing listed right now — a quiet calendar.")}
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
              <p className="text-sm font-semibold text-parranda-ink">{t("Idag", "Today")}</p>
              <ul className="mt-1 flex flex-col gap-1.5">
                {pulseBuckets.tonight.slice(0, 4).map((ev: PulseEvent, i: number) => (
                  <li key={ev.id ?? i} className="text-sm text-parranda-ink/85">
                    <span className="font-medium">{ev.title}</span>
                    {eventTiming(ev, lang) && <span className="text-parranda-ink/60"> · {eventTiming(ev, lang)}</span>}
                    {ev.place && <span className="text-parranda-ink/60"> · {ev.place}</span>}
                    {ev.source_url && (
                      <span className="text-parranda-ink/50">
                        {" · "}
                        <a href={ev.source_url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 min-w-11 items-center underline underline-offset-2 hover:text-parranda-accent">
                          {ev.source_label || t("Källa", "Source")}
                        </a>
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {/* The card keeps a one-line summary for the week — the full list
              lives in the Live sheet. The count comes from the bucket, never
              from copy. */}
          {pulseBuckets.thisWeek.length > 0 && (
            <p className="mt-3 border-t border-parranda-ink/10 pt-3 text-sm text-parranda-ink/70">
              <span className="font-semibold text-parranda-ink">{t("Senare i veckan", "Later this week")}</span>
              {" · "}
              {pulseBuckets.thisWeek.length}{" "}
              {pulseBuckets.thisWeek.length === 1 ? t("händelse listad", "more listed") : t("händelser listade", "more listed")}
            </p>
          )}
          {(pulseBuckets.tonight.length > 0 || pulseBuckets.thisWeek.length > 0 || aroundPlaceScopeAvailable) && (
            <button
              type="button"
              ref={liveSheetTriggerRef}
              onClick={() => {
                setLiveSheetTime(pulseBuckets.tonight.length > 0 ? "tonight" : "week");
                setLiveSheetOpen(true);
                // "Couldn't verify" + an available anchor: opening the sheet IS
                // the "check again" — fire a fresh around-place query (its own
                // bounded retries) instead of showing the same stale emptiness.
                if (pulseState === "unavailable" && aroundPlaceScopeAvailable && !liveQueryPending) {
                  requestLiveSheetScope("around_place").catch(() => {});
                }
              }}
              className="mt-3 inline-flex min-h-11 w-full items-center justify-center rounded-parranda-btn border border-parranda-ember/50 bg-parranda-ember/10 text-[13px] font-bold text-parranda-clay transition hover:bg-parranda-ember/15"
            >
              {pulseBuckets.tonight.length > 0 || pulseBuckets.thisWeek.length > 0
                ? t("Se allt live", "See all live")
                : t("Utforska live", "Explore live")} <span aria-hidden="true" className="ml-1.5">↗</span>
            </button>
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

      {/* THE LIVE SHEET (§3B) — explores the live_events buckets only. It never
          changes the day's anchor or the route: the landing's location consent
          anchors the DAY; a separate near-me consent applies only to this query. */}
      {liveSheetOpen && (() => {
        const sheetEvents: PulseEvent[] = liveSheetTime === "tonight" ? sheetBuckets.tonight : sheetBuckets.thisWeek;
        const sheetMoreEvents: PulseEvent[] = liveSheetTime === "tonight" ? sheetBrowseBuckets.tonight : sheetBrowseBuckets.thisWeek;
        const scopePhrase =
          liveSheetScope === "near_route"
            ? t("nära rutten", "near the route")
            : liveSheetScope === "near_me"
              ? t("nära dig", "near you")
              : t(`runt ${anchorLabel}`, `around ${anchorLabel}`);
        return (
          <div className="fixed inset-0 z-[1100]">
            <div aria-hidden="true" onClick={() => setLiveSheetOpen(false)} className="absolute inset-0 bg-black/55" />
            <div
              ref={liveSheetDialogRef}
              role="dialog"
              aria-modal="true"
              aria-label={t("Live-händelser", "Live events")}
              tabIndex={-1}
              className="absolute inset-x-0 bottom-0 max-h-[85vh] overflow-y-auto rounded-t-3xl border-t border-parranda-ink/14 bg-parranda-paper px-6 pb-8 pt-4 shadow-2xl sm:inset-x-auto sm:left-1/2 sm:w-full sm:max-w-xl sm:-translate-x-1/2"
            >
              <div className="flex justify-center" aria-hidden="true">
                <span className="h-1 w-11 rounded-full bg-parranda-ink/20" />
              </div>
              <div className="mt-3 flex items-center justify-between gap-3">
                <h3 className="font-display text-3xl font-semibold leading-none text-parranda-ink">
                  {liveSheetScope === "near_me" ? (
                    <>
                      Live <em className="text-parranda-ember">{t("nära dig", "near you")}</em>
                    </>
                  ) : (
                    <>
                      {t("Live i", "Live in")} <em className="text-parranda-ember">{anchorLabel}</em>
                    </>
                  )}
                </h3>
                <button
                  ref={liveSheetCloseRef}
                  type="button"
                  aria-label={t("Stäng live", "Close live")}
                  onClick={() => setLiveSheetOpen(false)}
                  className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-full border border-parranda-ink/16 text-parranda-ink/80 transition hover:border-parranda-ember"
                >
                  ✕
                </button>
              </div>

              {/* WHERE — a real axis over live_event_query_v1. It reads trusted
                  route/anchor geometry, while near_me requests fresh permission
                  for this Live query only. */}
              <div className="mt-4 flex flex-col gap-2">
                <p className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-parranda-glow">{t("Var", "Where")}</p>
                <div className="flex flex-wrap gap-2" role="group" aria-label={t("Live-område", "Live area")}>
                  <button
                    type="button"
                    aria-pressed={liveSheetScope === "around_place"}
                    disabled={!aroundPlaceScopeAvailable || liveQueryPending}
                    onClick={() => requestLiveSheetScope("around_place")}
                    className={
                      "inline-flex min-h-11 items-center rounded-full border px-4 text-[13px] transition disabled:cursor-not-allowed disabled:opacity-40 " +
                      (liveSheetScope === "around_place"
                        ? "border-parranda-ember/55 bg-parranda-ember/10 font-bold text-parranda-ink"
                        : "border-parranda-ink/14 text-parranda-ink/65")
                    }
                  >
                    {t(`Runt ${anchorLabel}`, `Around ${anchorLabel}`)}
                  </button>
                  <button
                    type="button"
                    aria-pressed={liveSheetScope === "near_route"}
                    disabled={!routeScopeAvailable || liveQueryPending}
                    onClick={() => requestLiveSheetScope("near_route")}
                    className={
                      "inline-flex min-h-11 items-center rounded-full border px-4 text-[13px] transition disabled:cursor-not-allowed disabled:opacity-40 " +
                      (liveSheetScope === "near_route"
                        ? "border-parranda-ember/55 bg-parranda-ember/10 font-bold text-parranda-ink"
                        : "border-parranda-ink/14 text-parranda-ink/65")
                    }
                  >
                    {t("Nära rutten", "Near the route")}
                  </button>
                  <button
                    type="button"
                    aria-pressed={liveSheetScope === "near_me"}
                    disabled={liveQueryPending}
                    onClick={() => requestLiveSheetScope("near_me")}
                    className={
                      "inline-flex min-h-11 items-center gap-2 rounded-full border px-4 text-[13px] transition disabled:cursor-not-allowed disabled:opacity-40 " +
                      (liveSheetScope === "near_me"
                        ? "border-parranda-ember/55 bg-parranda-ember/10 font-bold text-parranda-ink"
                        : "border-parranda-ink/14 text-parranda-ink/65")
                    }
                  >
                    <span aria-hidden="true" className="text-parranda-ember">◉</span>
                    {t("Nära mig", "Near me")}
                  </button>
                </div>
                {!routeScopeAvailable && (
                  <p className="text-xs text-parranda-ink/50">
                    {t("Nära rutten blir tillgängligt när en rutt finns.", "Near the route becomes available when a route exists.")}
                  </p>
                )}
                {liveQueryGeoHint && <p className="text-xs text-parranda-ink/65">{liveQueryGeoHint}</p>}
              </div>

              {/* WHEN — a real axis over the live_events buckets. */}
              <div className="mt-4 flex flex-col gap-2">
                <p className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-parranda-glow">{t("När", "When")}</p>
                <div className="inline-flex self-start overflow-hidden rounded-full border border-parranda-ink/14" role="group" aria-label={t("Vilken tid", "Which time")}>
                  {(["tonight", "week"] as const).map((key) => (
                    <button
                      type="button"
                      key={key}
                      aria-pressed={liveSheetTime === key}
                      onClick={() => setLiveSheetTime(key)}
                      className={
                        "inline-flex min-h-11 items-center px-[18px] text-[13px] transition " +
                        (liveSheetTime === key ? "bg-parranda-ember/16 font-bold text-parranda-ink" : "text-parranda-ink/65")
                      }
                    >
                      {key === "tonight" ? t("Idag", "Today") : t("Denna vecka", "This week")}
                    </button>
                  ))}
                </div>
              </div>

              {/* The ACTIVE scope×time cell — heading, list or honest emptiness. */}
              <div className="mt-4 flex flex-col gap-2.5 border-t border-parranda-ink/10 pt-4">
                <p className="text-[11px] font-extrabold uppercase tracking-[0.16em] text-parranda-ink/55">
                  {liveSheetTime === "tonight" ? t("Idag", "Today") : t("Senare i veckan", "Later this week")} · {scopePhrase}
                </p>
                {liveSheetScope !== "near_me" && liveSheetTime === "tonight" && split.woven.length > 0 && (
                  <p className="text-xs text-parranda-ink/60">
                    {split.woven
                      .map((s: any) => String(s?.label || s?.name || "").trim())
                      .filter(Boolean)
                      .map((n: string) => `${n} · ${t("Ingår i dagens rutt", "Included in today's route")}`)
                      .join(" · ")}
                  </p>
                )}
                {liveQueryPending ? (
                  <div className="rounded-parranda border border-parranda-ink/10 bg-parranda-ink/5 p-4" aria-live="polite">
                    <p className="text-sm text-parranda-ink/75">
                      {t("Uppdaterar verifierade källor för det här området …", "Refreshing verified sources for this area …")}
                    </p>
                  </div>
                ) : liveQueryError ? (
                  <div className="rounded-parranda border border-parranda-ink/10 bg-parranda-ink/5 p-4">
                    <p className="text-sm leading-relaxed text-parranda-ink/80">{liveQueryError}</p>
                  </div>
                ) : sheetPulseState === "pending" ? (
                  <div className="rounded-parranda border border-parranda-ink/10 bg-parranda-ink/5 p-4">
                    <p className="text-sm leading-relaxed text-parranda-ink/75">
                      {t(
                        "Kalendrarna uppdateras fortfarande — prova området igen om en stund.",
                        "The calendars are still updating — try this area again shortly.",
                      )}
                    </p>
                  </div>
                ) : sheetEvents.length > 0 || sheetMoreEvents.length > 0 ? (
                  <div className="flex flex-col gap-3">
                    {sheetEvents.length > 0 && (
                      <>
                        <p className="text-xs font-bold text-parranda-ink/65">
                          {selected.length > 0 ? t("Höjdpunkter för dina val", "Highlights for your picks") : t("Höjdpunkter", "Highlights")}
                        </p>
                        <ul className="flex flex-col gap-2.5">
                          {sheetEvents.map((ev: PulseEvent, i: number) => (
                            <li key={ev.id ?? i} className="flex items-baseline gap-3">
                              <span className="min-w-[44px] shrink-0 text-xs font-extrabold text-parranda-clay">{eventTiming(ev, lang)}</span>
                              <span className="text-sm text-parranda-ink/90">
                                <span className="font-bold">{ev.title}</span>
                                {ev.place && <span className="text-parranda-ink/60"> · {ev.place}</span>}
                                {ev.source_url && (
                                  <span className="text-parranda-ink/50">
                                    {" · "}
                                    <a href={ev.source_url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 min-w-11 items-center underline underline-offset-2 hover:text-parranda-accent">
                                      {ev.source_label || t("Källa", "Source")}
                                    </a>
                                  </span>
                                )}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </>
                    )}
                    {sheetMoreEvents.length > 0 && (
                      <details className="rounded-parranda border border-parranda-ink/10 bg-parranda-ink/5 px-4 py-2">
                        <summary className="flex min-h-11 cursor-pointer items-center text-sm font-bold text-parranda-ink">
                          {t(`Visa ${sheetMoreEvents.length} fler händelser`, `Show ${sheetMoreEvents.length} more events`)}
                        </summary>
                        <ul className="flex flex-col gap-2.5 border-t border-parranda-ink/10 pb-2 pt-3">
                          {sheetMoreEvents.map((ev: PulseEvent, i: number) => (
                            <li key={ev.id ?? i} className="flex items-baseline gap-3">
                              <span className="min-w-[44px] shrink-0 text-xs font-extrabold text-parranda-clay">{eventTiming(ev, lang)}</span>
                              <span className="text-sm text-parranda-ink/90">
                                <span className="font-semibold">{ev.title}</span>
                                {ev.place && <span className="text-parranda-ink/60"> · {ev.place}</span>}
                                {ev.source_url && (
                                  <span className="text-parranda-ink/50">
                                    {" · "}
                                    <a href={ev.source_url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 min-w-11 items-center underline underline-offset-2 hover:text-parranda-accent">
                                      {ev.source_label || t("Källa", "Source")}
                                    </a>
                                  </span>
                                )}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </div>
                ) : (
                  <div className="rounded-parranda border border-parranda-ink/10 bg-parranda-ink/5 p-4">
                    <p className="text-sm leading-relaxed text-parranda-ink/80">
                      {liveSheetTime === "tonight"
                        ? t(`Inget verifierat idag ${scopePhrase}.`, `Nothing verified today ${scopePhrase}.`)
                        : t(`Inget listat senare i veckan ${scopePhrase}.`, `Nothing listed later this week ${scopePhrase}.`)}
                      {liveSheetTime === "tonight" && sheetBuckets.thisWeek.length > 0 && (
                        <strong className="text-parranda-ink">
                          {" "}
                          {sheetBuckets.thisWeek.length === 1
                            ? t("1 händelse är listad senare i veckan.", "One event is listed later this week.")
                            : t(
                                `${sheetBuckets.thisWeek.length} händelser är listade senare i veckan.`,
                                `${sheetBuckets.thisWeek.length} events are listed later this week.`,
                              )}
                        </strong>
                      )}
                    </p>
                    {liveSheetTime === "tonight" && sheetBuckets.thisWeek.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setLiveSheetTime("week")}
                        className="mt-3 inline-flex min-h-11 items-center rounded-parranda-btn border border-parranda-ember/50 bg-parranda-ember/10 px-4 text-[13px] font-bold text-parranda-clay"
                      >
                        {t("Visa veckan", "Show this week")}
                      </button>
                    )}
                    {liveSheetTime === "week" && sheetBuckets.tonight.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setLiveSheetTime("tonight")}
                        className="mt-3 inline-flex min-h-11 items-center rounded-parranda-btn border border-parranda-ember/50 bg-parranda-ember/10 px-4 text-[13px] font-bold text-parranda-clay"
                      >
                        {t("Visa idag", "Show today")}
                      </button>
                    )}
                  </div>
                )}
                {sheetPulseState === "partial" && (
                  <p className="text-xs text-parranda-ink/55">
                    {t("Alla källor kunde inte nås just nu — listan kan vara ofullständig.", "Some sources couldn't be reached right now — the list may be incomplete.")}
                  </p>
                )}
                {sheetSourceHealth && Number.isInteger(sheetSourceHealth.selected_source_count) && (
                  <p className="text-xs text-parranda-ink/50">
                    {t("Källstatus", "Source health")}: {sheetSourceHealth.responding_source_count ?? 0}/{sheetSourceHealth.selected_source_count ?? 0} {t("svarade", "responded")} · {sheetSourceHealth.event_bearing_source_count ?? 0} {t("med träffar", "with events")}
                  </p>
                )}
                {sheetSources && (
                  <p className="text-xs text-parranda-ink/50">
                    {t("Källa", "Source")}: {sheetSources}
                  </p>
                )}
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
