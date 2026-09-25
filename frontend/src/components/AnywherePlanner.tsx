/**
 * Modern planner surface for freeform places, coordinates, and registered cities.
 *
 * Talks to the EXISTING Express API (same payload as the production anywhere
 * mode). Freeform output uses the SHARED honesty module; registered-city output
 * uses an exact server-identity gate, so neither mode can dress a fallback
 * city's day up as the requested place:
 *   composed       → one authoritative route + optional nearby context + Pulse
 *   structure_only → candidate areas only, honest "not a finished route" note
 *   unavailable    → honest empty state (never a crash)
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { fetchPlannerLifecycle } from '../lib/planner-lifecycle.mjs';
import {
  buildAnywherePayload,
  ANYWHERE_PREFERENCES,
  WALK_PRESETS,
  freezeComposeDateIso,
} from "../lib/anywhere-payload.mjs";
import { anywhereBlitzView, type AnywhereBlitzView } from "../lib/blitz-view.mjs";
import { contextNote, limitationNote } from "../lib/day-limitations.mjs";
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
  liveDateLabel,
  type LiveEventScope,
} from "../lib/live-event-query.mjs";
import { mapsPlaceUrl, mapsWalkingRouteUrls, primaryRouteStops } from "../lib/maps-links.mjs";
import { routePathIsSketch } from "../lib/route-map-presentation.mjs";
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
  eventSourceLink,
  eventTiming,
  liveSourceFailure,
  pulseHealthState,
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
  savedEntryId,
  type SavedEntry,
} from "../lib/anywhere-storage.mjs";
import {
  buildCommitmentSnapshot,
  readCommitmentSnapshot,
} from "../lib/commitment-snapshot.mjs";
import { anywhereDecision, type AnywhereClassification } from "../lib/anywhere-decision";
import { classifyCuratedCityResult, safeCuratedCityResponse } from "../lib/curated-city-decision.mjs";
import AppBar from "./shared/AppBar";
import {
  BoltIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CloseIcon,
  ExternalIcon,
  HalfCircleIcon,
  KeepIcon,
  LocationIcon,
  MinusIcon,
  PlusIcon,
  ShareIcon,
  StarIcon,
} from "./shared/icons";
import RouteMap from "./planner/RouteMap";
import LiveSheet from "./planner/LiveSheet";
import { liveEventSource } from "./planner/LiveEventSource";
import {
  DAYPART_LABELS,
  HOURS_RELEVANT_TYPES,
  INTENT_LABELS,
  TYPE_LABELS,
  label,
  partialPreferenceLabels,
  pickLabel,
  unkeptReasonSentence,
  type Lang,
} from "./planner/copy";
import type { LiveEvents, PlaceStructure, PulseEvent } from "./planner/types";

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

/**
 * May this exact candidate identity be committed to?
 *
 * Read from the server, never inferred. Coordinates, an id shape, a label, and
 * absence from the route are equally true of a place the routing path can
 * accept and one it cannot — these lists render from place-structure
 * candidates, which the composer documents as never promoting into the route.
 *
 * Only an explicit `true` is permission. A missing field, an older server, or a
 * value of another type all mean the candidate stays visible as an idea and
 * offers no way to commit to it.
 *
 * A commitment ALREADY held keeps its control regardless, so a place that
 * became ineligible after it was added can still be withdrawn from the card it
 * was added on.
 */
function canCommitTo(stop: { commitment_eligible?: unknown } | null | undefined): boolean {
  return stop?.commitment_eligible === true;
}

export default function AnywherePlanner({ lang: initialLang = "en" }: { lang?: Lang }) {
  // Static output can't read query params at request time, so honor the
  // production language contract (?lang=sv) client-side: EN default, SV explicit.
  const [lang, setLang] = useState<Lang>(initialLang);
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("lang");
    if (q === "sv" || q === "en") setLang(q);
  }, []);
  const [place, setPlace] = useState("");
  const [cityKey, setCityKey] = useState<string | null>(null);
  const [mode, setMode] = useState<"typed" | "near_me">("typed"); // start context
  const [geoHint, setGeoHint] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>(["food", "culture", "views"]);
  const [dayOffset, setDayOffset] = useState<0 | 1>(0); // today / tomorrow
  const [walkKey, setWalkKey] = useState("balanced");
  const [phase, setPhase] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [loadingStage, setLoadingStage] = useState(0);
  const [supplyPending, setSupplyPending] = useState(false);
  const [navigationInterrupted, setNavigationInterrupted] = useState(false);
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
  // The commitments the day ON SCREEN actually answered — an immutable snapshot
  // taken when an authoritative compose comes back, never when the user clicks.
  //
  // It carries the LABELS as well as the ids, because reading ids from here and
  // labels from the live ledger lets the two drift: release X mid-request and
  // the day would still name X while the user no longer keeps it. One frozen
  // record per generation is the only way the day and its verdict can be
  // guaranteed to describe the same moment.
  //
  // The editable ledger runs ahead of the day by design (a click, then 400ms of
  // debounce, then a request), so judging the rendered stops against it accuses
  // a day that was never asked the question. A refusal or a failed request
  // leaves this untouched for the same reason.
  const [appliedPins, setAppliedPins] = useState<Array<{ id: string; kind: "pin"; label: string }>>([]);
  // The server's own reason per unmet commitment, from the SAME response that
  // produced the day on screen. Read, never derived.
  const [appliedRefusals, setAppliedRefusals] = useState<Array<{ id: string; reason: string | null }>>([]);
  // Which anchor the visible day belongs to. A day for another place is never
  // held over, not even for a second.
  const displayedAnchorKeyRef = useRef<string | null>(null);
  const [serviceRefusal, setServiceRefusal] = useState<ComposeServiceRefusal | null>(null);
  // Memory-only copy of the trusted coordinate anchor used for this response.
  // It frames the consumer Maps route but is never persisted or put in a URL.
  const [routeAnchorCoords, setRouteAnchorCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [blitzPhase, setBlitzPhase] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [blitzResult, setBlitzResult] = useState<AnywhereBlitzView | null>(null);
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
  const retryGenerationRef = useRef(0);
  const retryInFlightRef = useRef(false);
  // The user's INTENT generation, as distinct from the request generation
  // above. Intent changes the instant they click; a request does not leave for
  // another 400ms, and one already in flight is answering an older intent.
  //
  // The immutable verdict snapshot keeps the day from SAYING anything false in
  // that window, but it does not stop an older answer from installing its
  // route — a day composed without the pin, landing after the pin was made,
  // and looking entirely legitimate. A response has to match both generations
  // to be allowed on screen.
  const intentSequenceRef = useRef(0);
  const activeRequestRef = useRef<AbortController | null>(null);
  const activeLifecycleCancelRef = useRef<(() => void) | null>(null);
  const navigationSuspendedRef = useRef(false);
  const interruptedPlannerRef = useRef(false);
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
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const liveSheetTriggerRef = useRef<HTMLButtonElement | null>(null);
  const liveSheetDialogRef = useRef<HTMLDivElement | null>(null);
  const liveSheetCloseRef = useRef<HTMLButtonElement | null>(null);
  const liveQueryAbortRef = useRef<AbortController | null>(null);
  const liveResponseRef = useRef(safeResponse);
  liveResponseRef.current = safeResponse;
  // A scope request belongs to the published day it was built from. Intent
  // cancellation alone misses queries opened while the previous day is held.
  useEffect(() => {
    liveQueryAbortRef.current?.abort();
    liveQueryAbortRef.current = null;
    setLiveQueryEvents(null);
    setLiveQueryPending(false);
    setLiveQueryError(null);
    setLiveQueryGeoHint(null);
    setLiveSheetScope("around_place");
  }, [safeResponse]);
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

  type Anchor = { city?: string; place?: string; coords?: { lat: number; lng: number } };
  const lastRequestedAnchorRef = useRef<Anchor | null>(null);

  async function execute(
    anchor: Anchor,
    {
      silent = false,
      langOverride,
      preferencesOverride,
      dayOffsetOverride,
      dateIsoOverride,
      walkKeyOverride,
      excludedOverride,
      pinnedOverride,
      pollAttempt = 0,
    }: {
      silent?: boolean;
      langOverride?: Lang;
      preferencesOverride?: string[];
      dayOffsetOverride?: 0 | 1;
      dateIsoOverride?: string;
      walkKeyOverride?: string;
      excludedOverride?: string[];
      pinnedOverride?: string[];
      pollAttempt?: number;
    } = {},
  ) {
    if (navigationSuspendedRef.current) return;
    lastRequestedAnchorRef.current = anchor;
    if (!silent && pollTimerRef.current) {
      clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    activeRequestRef.current?.abort();
    const controller = new AbortController();
    const requestId = ++requestSequenceRef.current;
    // The intent this request is going out to answer. If the user changes a
    // commitment while it is in flight, this no longer matches and the answer
    // is stale however new the request itself was.
    const intentId = intentSequenceRef.current;
    activeRequestRef.current = controller;
    setSupplyPending(false);
    setNavigationInterrupted(false);
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
      const effectiveDateIso = freezeComposeDateIso({
        dayOffset: effectiveDayOffset,
        dateIsoOverride,
      });
      const preset = WALK_PRESETS.find((p: { key: string }) => p.key === effectiveWalkKey) ?? WALK_PRESETS[1];
      // Frozen here, beside the request that carries them: whatever the ledger
      // does while this is in flight, THIS is what the answer will have
      // answered. Labels travel with the ids so the verdict can name a place
      // the user has since released.
      const sentPinIds = pinnedOverride ?? scopedLedger.pinnedIds;
      const sentPins = sentPinIds.map((id: string) => ({
        id,
        kind: "pin" as const,
        label: String(scopedLedger.entries[id]?.label ?? commitments[id]?.label ?? ""),
      }));
      const payload = buildAnywherePayload({
        city: anchor.city,
        place: anchor.place,
        coords: anchor.coords ?? null,
        dates: [effectiveDateIso],
        preferences: preferencesOverride ?? selected,
        walkingKmTarget: preset.km,
        excludedCandidateIds: excludedOverride ?? scopedLedger.excludedIds,
        pinnedCandidateIds: sentPinIds,
      });
      const { response, body } = await fetchPlannerLifecycle(`/api/route-recommendations?lang=${langOverride ?? lang}`, {
        payload,
        signal: controller.signal,
        onCancellationReady: (cancel) => {
          if (
            controller.signal.aborted ||
            requestId !== requestSequenceRef.current ||
            intentId !== intentSequenceRef.current
          ) {
            cancel();
            return;
          }
          activeLifecycleCancelRef.current = cancel;
        },
        onPending: () => {
          if (requestId === requestSequenceRef.current && intentId === intentSequenceRef.current) setSupplyPending(true);
        },
      });
      if (
        controller.signal.aborted ||
        requestId !== requestSequenceRef.current ||
        intentId !== intentSequenceRef.current
      ) return;
      setSupplyPending(false);
      const refusal = composeServiceRefusal(response.status, body);
      if (refusal) {
        setServiceRefusal(refusal);
        setClassification(null);
        setSafeResponse(null);
        displayedAnchorKeyRef.current = null;
        // A transport or capacity refusal composed no day at all, so there is
        // no evidence that any commitment could not be met. Reporting one here
        // would invent a verdict out of a network failure.
        setAppliedPins([]);
        setAppliedRefusals([]);
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
      const cls = anchor.city
        ? classifyCuratedCityResult(body, { city: anchor.city, label: fallbackLabel })
        : decision.classifyAnywhereResult(body, { place: fallbackLabel });
      const safe = anchor.city
        ? safeCuratedCityResponse(body, cls)
        : decision.safeResponseFor(body, cls);
      const authoritativePlace = anchor.city ? cls.placeLabel : anchor.place;
      if (anchor.city && authoritativePlace) setPlace(authoritativePlace);
      // Atomic replacement. If the new verdict is structure_only/unavailable,
      // the held day disappears here — it no longer answers the request.
      setClassification(cls);
      setSafeResponse(safe);
      displayedAnchorKeyRef.current = anchorKey(anchor);
      // This day answered exactly the pins this request carried. Recording them
      // here — beside the classification, not beside the click — is what ties
      // the unhonoured verdict to a day that was actually asked. Only a verdict
      // that CONTAINS a day can leave a commitment unmet by it: structure_only
      // and unavailable composed no day, so there is nothing for a pin to have
      // failed to fit into and the snapshot stays empty.
      const composedNow = decision.isComposedStatus(cls.status);
      const refusalsNow: Array<{ id: string; reason: string | null }> = composedNow
        && Array.isArray(body?.agnostic_route_output_experiment?.pinned_candidates?.unhonored)
        ? body.agnostic_route_output_experiment.pinned_candidates.unhonored
        : [];
      setAppliedPins(composedNow ? sentPins : []);
      setAppliedRefusals(refusalsNow);
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
          city: anchor.city ?? null,
          place: authoritativePlace,
          label: authoritativePlace || t("Min position", "My position"),
          dateIso: effectiveDateIso,
          savedAt: new Date().toISOString(),
          safeResponse: safe,
          classification: cls,
          inputs: { city: anchor.city ?? null, place: authoritativePlace ?? null, mode, dayOffset: effectiveDayOffset, walkKey: effectiveWalkKey, selected: prefs },
          // Frozen from the SAME request that produced this day: the ledger it
          // carried and the verdict that came back. Recorded here rather than
          // at save time, because by then the live ledger may have moved on
          // and would no longer describe what these stops answered.
          commitments: buildCommitmentSnapshot({
            anchorKey: anchorKey(anchor),
            // Bound to the SAME identity the entry is stored under. An anchor
            // alone is not enough: two saved days can share a place and differ
            // in date, preferences, or walking contract, and each answered its
            // own question.
            dayKey: savedEntryId({
              city: anchor.city ?? null,
              place: anchor.place ?? null,
              dateIso: effectiveDateIso,
              selected: prefs,
              walkKey: effectiveWalkKey,
            }),
            entries: scopedLedger.entries,
            appliedPins: decision.isComposedStatus(cls.status) ? sentPins : [],
            refusals: refusalsNow,
          }),
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
        supplyLifecycleComplete: true,
        composed: cls.status === "composed",
        structureOnly: cls.status === "structure_only",
        hasStructure: Boolean(safe?.place_structure),
        transientSourceRetry: anchor.city ? false : decision.shouldRetryTransientSource(body, cls),
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
        const followupIntentId = intentSequenceRef.current;
        pollTimerRef.current = setTimeout(() => {
          pollTimerRef.current = null;
          if (followupIntentId !== intentSequenceRef.current) return;
          execute(anchor, {
            silent: true,
            langOverride: langOverride ?? lang,
            preferencesOverride: effectivePreferences,
            dayOffsetOverride: effectiveDayOffset,
            dateIsoOverride: effectiveDateIso,
            walkKeyOverride: effectiveWalkKey,
            excludedOverride: effectiveExcluded,
            pinnedOverride: effectivePinned,
            pollAttempt: followup.nextPollAttempt,
          }).catch(() => {});
        }, followup.delayMs ?? 0);
      }
    } catch {
      if (
        controller.signal.aborted ||
        requestId !== requestSequenceRef.current ||
        intentId !== intentSequenceRef.current
      ) return;
      if (silent) {
        setUpgradePending(false);
        setLiveRefreshExhausted(true);
      } else {
        setPhase("error");
      }
    } finally {
      if (activeRequestRef.current === controller) {
        activeRequestRef.current = null;
        activeLifecycleCancelRef.current = null;
        setSupplyPending(false);
      }
    }
  }

  const cancelActivePlannerForNavigation = () => {
    navigationSuspendedRef.current = true;
    interruptedPlannerRef.current ||= Boolean(activeRequestRef.current || recomposeTimerRef.current);
    requestSequenceRef.current += 1;
    intentSequenceRef.current += 1;
    retryGenerationRef.current += 1;
    retryInFlightRef.current = false;
    // BFCache freezes timers rather than unmounting React. Neither an old
    // adjustment nor a scheduled Live composition may wake on return.
    if (recomposeTimerRef.current) clearTimeout(recomposeTimerRef.current);
    recomposeTimerRef.current = null;
    if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    pollTimerRef.current = null;
    const cancelLifecycle = activeLifecycleCancelRef.current;
    activeLifecycleCancelRef.current = null;
    // The lifecycle cancellation must be initiated synchronously before the
    // browser tears down this document. The AbortController remains the local
    // stale-result guard; cancelLifecycle owns the server/provider boundary.
    cancelLifecycle?.();
    activeRequestRef.current?.abort();
    activeRequestRef.current = null;
  };

  useEffect(() => {
    // pagehide covers address-bar/direct navigation and browser back/forward,
    // including bfcache transitions. Change place calls the same function at
    // click time so its DELETE starts before the link's default navigation.
    window.addEventListener("pagehide", cancelActivePlannerForNavigation);
    const resumeFromHistory = (event: PageTransitionEvent) => {
      if (!event.persisted || !navigationSuspendedRef.current) return;
      navigationSuspendedRef.current = false;
      setSupplyPending(false);
      setUpgradePending(false);
      if (interruptedPlannerRef.current) {
        interruptedPlannerRef.current = false;
        // The old execution was cancelled, not paused on the server. Keep the
        // day and editable inputs, but require one explicit current-input retry.
        setNavigationInterrupted(true);
        setPhase("error");
      }
    };
    window.addEventListener("pageshow", resumeFromHistory);
    return () => {
      window.removeEventListener("pagehide", cancelActivePlannerForNavigation);
      window.removeEventListener("pageshow", resumeFromHistory);
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
      cancelActivePlannerForNavigation();
      blitzRequestRef.current?.abort();
      liveQueryAbortRef.current?.abort();
    };
  }, []);

  // Show a stored day WITHOUT re-fetching. A restored day is a snapshot (events /
  // "today" may be stale), so restoredAt is set and the UI labels it + offers rebuild.
  function restoreEntry(entry: SavedEntry) {
    setNavigationInterrupted(false);
    const i = entry.inputs;
    if (i) {
      setCityKey(typeof i.city === "string" && i.city.trim() ? i.city.trim() : null);
      if (typeof i.place === "string") setPlace(i.place);
      if (i.mode === "typed" || i.mode === "near_me") setMode(i.mode);
      if (i.dayOffset === 0 || i.dayOffset === 1) setDayOffset(i.dayOffset);
      if (typeof i.walkKey === "string") setWalkKey(i.walkKey);
      if (Array.isArray(i.selected)) setSelected(i.selected);
    }
    // A restored snapshot is a NEW authoritative generation, so everything
    // older has to stop before it is installed. Otherwise a compose that
    // started first — or a debounce that has not fired yet, or a silent
    // follow-up already scheduled — lands afterwards and quietly replaces the
    // snapshot with a different generation's day. With a matching anchor the
    // result looks entirely plausible, which is what makes it dangerous.
    if (recomposeTimerRef.current) {
      clearTimeout(recomposeTimerRef.current);
      recomposeTimerRef.current = null;
    }
    if (pollTimerRef.current) {
      clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    activeRequestRef.current?.abort();
    activeRequestRef.current = null;
    // Bumping the sequence invalidates any response already past its abort
    // check but not yet applied.
    requestSequenceRef.current += 1;
    intentSequenceRef.current += 1;
    setUpgradePending(false);

    lastEntryRef.current = entry;
    setClassification(entry.classification);
    setSafeResponse(entry.safeResponse);
    // Saved days do not carry the commitments they were composed under, so a
    // restored snapshot cannot answer for any of them — not even when the
    // anchor happens to match and the ledger survives scoping below.
    setAppliedPins([]);
    // A restored snapshot owns the screen outright; it is labelled by
    // restoredAt, never by the recompose "updating" state.
    const restoredAnchorKey = anchorKey({
      city: typeof i?.city === "string" ? i.city : undefined,
      place: typeof i?.place === "string" ? i.place : undefined,
    });
    displayedAnchorKeyRef.current = restoredAnchorKey;
    // Restoring puts a day on screen without a compose, so the ledger cannot
    // simply carry over: the live one may describe choices these stops were
    // never asked about, and matching geography is not evidence of a matching
    // day.
    //
    // What the day CAN answer with is its own record — the ledger the request
    // carried and the verdict that came back, frozen when it was composed. When
    // that record is present, intact, of a version this build understands, and
    // belongs to this anchor, the restored day carries exactly it. Otherwise
    // the ledger is dropped, which is the behaviour every day saved before this
    // existed still gets.
    const restoredCommitments = readCommitmentSnapshot(entry.commitments, {
      anchorKey: restoredAnchorKey,
      dayKey: entry.id,
    });
    if (restoredCommitments.applies) {
      commitmentAnchorKeyRef.current = restoredAnchorKey;
      setCommitments(restoredCommitments.entries);
      setAppliedPins(restoredCommitments.appliedPins);
      setAppliedRefusals(restoredCommitments.refusals);
    } else {
      commitmentAnchorKeyRef.current = null;
      if (Object.keys(commitments).length) setCommitments({});
      setAppliedRefusals([]);
    }
    setDayIsStale(false);
    setRouteAnchorCoords(null);
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
      setCityKey(shared.city || null);
      if (shared.preferences.length) setSelected(shared.preferences);
      setDayOffset(shared.dayOffset);
      setWalkKey(shared.walkKey);
      execute(
        { city: shared.city || undefined, place: shared.place },
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
      city: i.city ?? null,
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
    await execute({ city: cityKey || undefined, place: trimmed }, opts);
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
    if (navigationSuspendedRef.current || !hasAnchor || phase === "idle" || restoredAt) return;
    if (recomposeTimerRef.current) clearTimeout(recomposeTimerRef.current);
    recomposeTimerRef.current = setTimeout(() => {
      recomposeTimerRef.current = null;
      resolveAndRun().catch(() => {});
    }, 400);
    return () => {
      if (recomposeTimerRef.current) clearTimeout(recomposeTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, dayOffset, walkKey, commitments]);

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
  const liveDayLabel = liveDateLabel(liveEvents?.selected_date, lang);
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
  const liveFailure = useMemo(() => liveSourceFailure(liveEvents, pulseBuckets), [liveEvents, pulseBuckets]);
  // A failed source is neither "still loading" nor an empty calendar: say
  // which share of the selected sources could not be fetched.
  const liveFailureSentence = (failure: { selected: number; responding: number }) => {
    const notEvidence = t(
      "Det betyder inte att inget händer — försök igen om en stund.",
      "That doesn't mean nothing is on — try again shortly.",
    );
    if (failure.responding > 0) {
      return t(
        `Parranda kunde bara hämta ${failure.responding} av ${failure.selected} evenemangskällor just nu, och inga händelser kunde bekräftas. ${notEvidence}`,
        `Parranda could only fetch ${failure.responding} of ${failure.selected} event sources just now, and no events could be confirmed. ${notEvidence}`,
      );
    }
    if (failure.selected === 1) {
      return t(
        `Parranda kunde inte hämta evenemangskällan just nu, så inga händelser kan visas. ${notEvidence}`,
        `Parranda couldn't fetch the event source just now, so no events can be shown. ${notEvidence}`,
      );
    }
    return t(
      `Parranda kunde inte hämta någon av de ${failure.selected} evenemangskällorna just nu, så inga händelser kan visas. ${notEvidence}`,
      `Parranda couldn't fetch any of the ${failure.selected} event sources just now, so no events can be shown. ${notEvidence}`,
    );
  };
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
  const sheetFailure = useMemo(() => liveSourceFailure(sheetLiveEvents, sheetBuckets), [sheetLiveEvents, sheetBuckets]);
  const sheetSources = useMemo(() => pulseSourceLine(sheetLiveEvents), [sheetLiveEvents]);
  const sheetSourceHealth = sheetLiveEvents?.acquisition?.source_health ?? null;
  const routeScopeAvailable = boundedRoutePoints(routeStops).length >= 2;
  const aroundPlaceScopeAvailable = Boolean(
    buildLiveEventQueryPayload({ scope: "around_place", response: safeResponse }),
  );

  async function requestLiveSheetScope(nextScope: LiveEventScope) {
    const queryIntentId = intentSequenceRef.current;
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

    if (queryIntentId !== intentSequenceRef.current || safeResponse !== liveResponseRef.current) return;
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
        if (controller.signal.aborted || queryIntentId !== intentSequenceRef.current || safeResponse !== liveResponseRef.current) return;
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
  // Portable walking links across every primary-route stop in published order.
  // Long days use consecutive parts so mobile Maps never silently loses stops.
  // Include the published start/end: these legs already contribute to the
  // displayed distance and map. Never substitute a typed discovery anchor.
  // Explicit near-me coordinates retain their original loop ownership.
  const publishedPoints = Array.isArray(primaryRoute?.map_route_points) ? primaryRoute.map_route_points : [];
  const publishedStart = publishedPoints[0]?.role === "start" ? publishedPoints[0] : null;
  const publishedEnd = publishedPoints.at(-1)?.role === "end" ? publishedPoints.at(-1) : null;
  const routeOrigin = routeAnchorCoords ?? publishedStart;
  const routeDestination = routeAnchorCoords ?? publishedEnd;
  const routeUrls = useMemo(
    () => mapsWalkingRouteUrls(
      routeStops,
      { origin: routeOrigin, destination: routeDestination },
    ),
    [routeStops, routeOrigin, routeDestination],
  );
  // District composition deliberately sees a broader candidate universe than
  // the route. Keep only a tiny, proximity-bounded, deduped slice as optional
  // discovery context; these candidates never enter routeStops or routeUrls.
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
  const invalidateCommitmentIntent = () => {
    intentSequenceRef.current += 1;
    liveQueryAbortRef.current?.abort();
    liveQueryAbortRef.current = null;
    setLiveQueryPending(false);
    setLiveQueryEvents(null);
    retryGenerationRef.current += 1;
    retryInFlightRef.current = false;
    if (recomposeTimerRef.current) {
      clearTimeout(recomposeTimerRef.current);
      recomposeTimerRef.current = null;
    }
    if (pollTimerRef.current) {
      clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    activeRequestRef.current?.abort();
    activeRequestRef.current = null;
    setSupplyPending(false);
    setUpgradePending(false);
  };
  const retryPlan = () => {
    if (retryInFlightRef.current) return;
    const anchor = lastRequestedAnchorRef.current;
    if (!anchor) return;
    if (recomposeTimerRef.current) {
      clearTimeout(recomposeTimerRef.current);
      recomposeTimerRef.current = null;
    }
    if (pollTimerRef.current) {
      clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    const retryGeneration = ++retryGenerationRef.current;
    retryInFlightRef.current = true;
    execute(anchor).catch(() => {}).finally(() => {
      if (retryGenerationRef.current === retryGeneration) retryInFlightRef.current = false;
    });
  };
  const commit = (identity: string, kind: "exclude" | "pin", commitLabel: string) => {
    if (!identity || commitments[identity]?.kind === kind) return;
    setExpandedStopKey(null);
    setExpandedCandidateKey(null);
    // The anchor of the day on screen — the geography this commitment is about.
    commitmentAnchorKeyRef.current = displayedAnchorKeyRef.current;
    // Anything in flight or already scheduled is now answering a question the
    // user has moved past.
    invalidateCommitmentIntent();
    // The label travels with the commitment so a day that could not keep a
    // place can name it, without a second map to fall out of sync.
    setCommitments({ ...commitments, [identity]: { kind, label: commitLabel } });
  };
  const dismissStop = (identity: string, stopLabel: string) => commit(identity, "exclude", stopLabel);
  const keepStop = (identity: string, stopLabel: string) => commit(identity, "pin", stopLabel);
  const releaseCommitment = (identity: string) => {
    if (!identity || !commitments[identity]) return;
    invalidateCommitmentIntent();
    const next = { ...commitments };
    delete next[identity];
    setCommitments(next);
  };
  const clearCommitments = () => {
    if (!Object.keys(commitments).length) return;
    invalidateCommitmentIntent();
    setCommitments({});
  };
  const excludedCount = Object.values(commitments).filter((entry) => entry.kind === "exclude").length;
  const pinnedCount = Object.values(commitments).filter((entry) => entry.kind === "pin").length;
  // A pin the composed day does not contain. The server resolves pins against
  // the candidates it loaded itself and will not invent a place to satisfy
  // one — so this is reported, never swallowed.
  // Reported only where the two ledgers AGREE: the day answered for it, and
  // the user still holds it. A commitment withdrawn while its request was in
  // flight is not worth a sentence — the user has already moved on, the ledger
  // no longer lists it, and a fresh compose is on its way. The label still
  // comes from the snapshot, so what is named is what was actually asked.
  const stillHeld = appliedPins.filter((pin) => commitments[pin.id]?.kind === "pin");
  const unkept = unhonouredPins({
    entries: Object.fromEntries(stillHeld.map((pin) => [pin.id, pin])),
    pinnedIds: stillHeld.map((pin) => pin.id),
    stopIds: split.core.map((stop: any) => String(stop?.id ?? stop?.place_id ?? stop?.candidate_id ?? "")),
    isStale: dayIsStale,
    serverReasons: appliedRefusals,
  });
  // Some caps have no sentence of their own because a more specific surface
  // already states them (see day-limitations.mjs). Guard on the rendered note,
  // never on the cap count, or those days render an empty bullet.
  const dayLimitationNote = limitationNote(dayLimitations, split.core.length, t);

  // The route line joins the stops' own coordinates unless the route carries
  // walking geometry; the map draws that sketch dotted and the caption says so.
  const routeLineIsSketch = routePathIsSketch(primaryRoute?.map_path_points, routeStops.length);
  const sourceBackedDay = structure?.provenance === "agnostic_anchor";
  // How the day was assembled, minus what another line already says in full:
  // the trust line names the source-backed places, the map caption the
  // estimates. What is left sits with the map, not under the title.
  const dayContextNote = contextNote(dayLimitations, t, {
    statedElsewhere: sourceBackedDay
      ? ["capped_by_external_only_sources", "capped_by_heuristic_walking"]
      : ["capped_by_heuristic_walking"],
  });
  // The user's own picks, each with what the published route did for it —
  // read from stop-level coverage evidence only. Without that evidence the
  // header claims nothing about the picks at all.
  type PickCoverage = { key: string; state: "covered" | "partial" | "missing" };
  const pickCoverage: PickCoverage[] = routeCoverage.has_coverage_evidence
    ? selected.flatMap((key): PickCoverage[] => {
        if (routeCoverage.covered_preferences.includes(key)) return [{ key, state: "covered" }];
        if (routeCoverage.partial_preferences.includes(key)) return [{ key, state: "partial" }];
        if (routeCoverage.missing_preferences.includes(key)) return [{ key, state: "missing" }];
        return [];
      })
    : [];
  const dayWord = dayOffset === 0 ? t("Idag", "Today") : t("Imorgon", "Tomorrow");
  // A woven live event belongs to the day on screen, which may be tomorrow's.
  const includedInRoute = dayOffset === 0
    ? t("Ingår i dagens rutt", "Included in today's route")
    : t("Ingår i morgondagens rutt", "Included in tomorrow's route");
  const legLabel = (leg: { km: number | null; minutes: number | null }) =>
    `${leg.minutes != null ? `${leg.minutes} min` : ""}${leg.minutes != null && leg.km != null ? " · " : ""}${leg.km != null ? walkingDistanceLabel(leg.km, lang) : ""}`;
  const noticeCard = "rounded-parranda border border-parranda-ink/10 bg-parranda-ink/5 p-4 text-sm leading-relaxed text-parranda-ink/80";

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
      <AppBar
        lang={lang}
        homeLabel={t("Parranda — till startsidan", "Parranda — home")}
        languageLabel={t("Språk", "Language")}
        onNavigate={cancelActivePlannerForNavigation}
      />

      {/* THE DAY'S STARTING POINT — where (chosen once on the landing) and how
          (picks, walking), in one card. "Change" goes back to the landing; it
          is never a second form here. */}
      {hasAnchor && (
        <section
          aria-label={t("Dagens utgångspunkt", "Your day's starting point")}
          className="overflow-hidden rounded-parranda border border-parranda-ink/12 bg-parranda-ink/[0.045]"
        >
          <div className="flex min-h-14 items-center gap-2.5 py-1.5 pl-4 pr-1.5">
            <LocationIcon className="h-4 w-4 text-parranda-ember" />
            <span className="min-w-0 flex-1 truncate text-[15px] font-bold text-parranda-ink">
              {anchorLabel}
              <span className="font-medium text-parranda-ink/65">
                {" · "}
                {dayOffset === 0 ? t("idag", "today") : t("imorgon", "tomorrow")}
              </span>
            </span>
            <a
              href={`/?lang=${lang}`}
              onClick={(event) => {
                if (event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
                  cancelActivePlannerForNavigation();
                }
              }}
              aria-label={t("Byt plats", "Change place")}
              className="inline-flex min-h-11 shrink-0 items-center rounded-full bg-parranda-ink/10 px-4 text-xs font-bold text-parranda-ink/80 transition hover:bg-parranda-ink/15"
            >
              {t("Byt", "Change")}
            </a>
          </div>

          {/* ADJUSTMENTS — collapsed to one line by default; expanding reveals the
              grouped panel. Every change re-composes on its own (no submit). */}
          {!adjustOpen && (
            <div className="flex min-h-12 items-center gap-2.5 border-t border-parranda-ink/10 py-1.5 pl-4 pr-1.5">
              <span className="min-w-0 flex-1 text-[13px] leading-snug text-parranda-ink/65">
                <strong className="font-bold text-parranda-ink">{moodLabel || t("Inga val", "No moods")}</strong>
                {` · ${t("Gångmål", "Walking target")}: ${walkLabel}`}
              </span>
              <button
                type="button"
                aria-expanded={false}
                onClick={() => setAdjustOpen(true)}
                className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border border-parranda-ink/16 px-3.5 text-xs font-bold text-parranda-ink/80 transition hover:border-parranda-ember"
              >
                {t("Justera", "Adjust")}
                <ChevronDownIcon className="h-3.5 w-3.5" />
              </button>
            </div>
          )}

          {adjustOpen && (
            <div className="flex flex-col gap-4 border-t border-parranda-ink/10 p-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-extrabold uppercase tracking-[0.16em] text-parranda-ink/65">
                  {t("Justera dagen", "Adjust the day")}
                </span>
                <button
                  type="button"
                  aria-expanded={true}
                  onClick={() => setAdjustOpen(false)}
                  className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-parranda-ink/16 px-3.5 text-xs font-bold text-parranda-ink/80 transition hover:border-parranda-ember"
                >
                  {t("Klar", "Done")}
                  <ChevronDownIcon className="h-3.5 w-3.5 rotate-180" />
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
                        onClick={() => { invalidateCommitmentIntent(); setSelected((cur) => (active ? cur.filter((k) => k !== pref.key) : [...cur, pref.key])); }}
                        className={
                          "inline-flex min-h-11 items-center gap-1.5 rounded-full border px-4 text-[13px] transition " +
                          (active
                            ? "border-parranda-ember/55 bg-parranda-ember/12 font-bold text-parranda-ink"
                            : "border-parranda-ink/14 text-parranda-ink/65 hover:border-parranda-ink/30")
                        }
                      >
                        {active && <CheckIcon className="h-3.5 w-3.5 text-parranda-ember" />}
                        {lang === "en" ? pref.en : pref.sv}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="flex flex-col gap-2 border-t border-parranda-ink/10 pt-4">
                <p className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-parranda-glow">{t("När", "When")}</p>
                <div className="inline-flex self-start overflow-hidden rounded-full border border-parranda-ink/14" role="group" aria-label={t("Vilken dag", "Which day")}>
                  {([0, 1] as const).map((offset) => (
                    <button
                      type="button"
                      key={offset}
                      aria-pressed={dayOffset === offset}
                      onClick={() => { if (dayOffset !== offset) { invalidateCommitmentIntent(); setDayOffset(offset); } }}
                      className={
                        "inline-flex min-h-11 items-center px-[18px] text-[13px] transition " +
                        (dayOffset === offset ? "bg-parranda-ember/16 font-bold text-parranda-ink" : "text-parranda-ink/65 hover:text-parranda-ink")
                      }
                    >
                      {offset === 0 ? t("Idag", "Today") : t("Imorgon", "Tomorrow")}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex flex-col gap-2 border-t border-parranda-ink/10 pt-4">
                <p className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-parranda-glow">{t("Gånglängd", "Walking")}</p>
                {/* Name over distance, so a narrow screen never breaks "~6 km"
                    across two lines inside a segment. */}
                <div className="grid grid-cols-3 overflow-hidden rounded-parranda-btn border border-parranda-ink/14 sm:max-w-sm" role="group" aria-label={t("Gånglängd", "Walking length")}>
                  {WALK_PRESETS.map((preset: { key: string; km: number; sv: string; en: string }) => {
                    const [presetName, presetDistance] = (lang === "en" ? preset.en : preset.sv).split(" · ");
                    return (
                      <button
                        type="button"
                        key={preset.key}
                        aria-pressed={walkKey === preset.key}
                        onClick={() => { if (walkKey !== preset.key) { invalidateCommitmentIntent(); setWalkKey(preset.key); } }}
                        className={
                          "flex min-h-12 flex-col items-center justify-center px-2 py-1.5 text-[13px] leading-tight transition " +
                          (walkKey === preset.key ? "bg-parranda-ember/16 font-bold text-parranda-ink" : "text-parranda-ink/65 hover:text-parranda-ink")
                        }
                      >
                        <span>{presetName}</span>
                        {presetDistance && <span className="text-[11px] font-medium text-parranda-ink/55">{presetDistance}</span>}
                      </button>
                    );
                  })}
                </div>
              </div>

              <p className="text-[11px] text-parranda-ink/50">
                {t("Ändringar gäller av sig själva — dagen komponeras om medan du justerar.", "Changes apply on their own — the day recomposes as you adjust.")}
              </p>
            </div>
          )}
        </section>
      )}

      {/* No anchor (someone opened /anywhere directly): offer the one input that
          sets it, then never again. */}
      {!hasAnchor && (
        <div className="flex flex-col gap-4 pt-6">
          <h1 className="font-display text-5xl font-semibold leading-[0.95] text-parranda-ink">
            {t("Planera en dag", "Plan a day")} <em className="text-parranda-ember">{t("var som helst", "anywhere")}</em>
          </h1>
          <form onSubmit={plan} className="flex flex-col gap-2 sm:flex-row">
            <input
              value={place}
              onChange={(e) => { invalidateCommitmentIntent(); setPlace(e.target.value); }}
              placeholder={t("Var som helst — Lyon, Tbilisi, Kyoto …", "Anywhere — Lyon, Tbilisi, Kyoto …")}
              aria-label={t("Plats", "Place")}
              className="min-h-14 w-full flex-1 rounded-parranda border border-parranda-ink/16 bg-parranda-ink/6 px-5 text-parranda-ink outline-none transition placeholder:text-parranda-ink/45 focus:border-parranda-ember"
            />
            <button
              type="submit"
              className="min-h-14 whitespace-nowrap rounded-parranda bg-parranda-terracotta px-6 font-bold text-white shadow-sm transition hover:brightness-110"
            >
              {t("Bygg min dag", "Build my day")}
            </button>
          </form>
        </div>
      )}

      {geoHint && <p className="text-sm text-parranda-ink/70">{geoHint}</p>}

      {/* The ledger is stated where the user can always see it — including when
          dismissing left no day at all, which is exactly when a way back
          matters most. Hiding it behind a collapsed panel made the dismissal
          effectively irreversible. */}
      {(excludedCount > 0 || pinnedCount > 0) && (
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-parranda-ink/60" role="status">
          {pinnedCount > 0 && (
            <span className="inline-flex items-center gap-1.5">
              <KeepIcon className="h-3.5 w-3.5 text-parranda-ember" />
              {pinnedCount === 1
                ? t("1 plats behålls", "1 place kept")
                : t(`${pinnedCount} platser behålls`, `${pinnedCount} places kept`)}
            </span>
          )}
          {excludedCount > 0 && (
            <span className="inline-flex items-center gap-1.5">
              <MinusIcon className="h-3.5 w-3.5" />
              {excludedCount === 1
                ? t("1 plats bortvald", "1 place dismissed")
                : t(`${excludedCount} platser bortvalda`, `${excludedCount} places dismissed`)}
            </span>
          )}
          <button
            type="button"
            onClick={clearCommitments}
            className="inline-flex min-h-11 items-center underline underline-offset-2 hover:text-parranda-clay"
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
        <div className="flex flex-col gap-1.5 rounded-parranda border border-parranda-glow/25 bg-parranda-glow/[0.06] px-4 py-3 text-[13px] text-parranda-ink/80" role="status">
          {unkept.reasons.map((entry: { id: string; label: string; reason: string | null }) => (
            <p key={entry.id}>{unkeptReasonSentence(entry, t)}</p>
          ))}
        </div>
      )}

      {phase === "loading" && !staleNotice && (
        <div className="flex flex-col gap-5">
          <p className="flex items-center gap-2.5 text-sm text-parranda-ink/70" aria-live="polite">
            <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full bg-parranda-glow motion-safe:animate-pulse" />
            <span>
              {supplyPending && t("Hämtar källbelagda platser för din dag. Planen fortsätter automatiskt — du behöver inte försöka igen.", "Fetching source-backed places for your day. Your plan will continue automatically — no need to try again.")}
              {!supplyPending && loadingStage === 0 && t("Hittar platsen …", "Finding the place …")}
              {!supplyPending && loadingStage === 1 && t("Läser kartan och letar efter riktiga platser …", "Reading the map and looking for real places …")}
              {!supplyPending && loadingStage === 2 &&
                t(
                  "Komponerar dagen genom områdena — platser utan full kurering kan ta lite längre …",
                  "Composing the day across the areas — places without full curation can take a little longer …",
                )}
            </span>
          </p>
          {/* The shape of the day that is coming, so it lands without a jump.
              Decorative only: it carries no place, number or claim. */}
          <div aria-hidden="true" className="flex flex-col gap-3 motion-safe:animate-pulse">
            <span className="h-3 w-20 rounded-full bg-parranda-ink/10" />
            <span className="h-10 w-3/4 rounded-parranda-btn bg-parranda-ink/10" />
            <span className="h-3 w-1/2 rounded-full bg-parranda-ink/10" />
            <div className="mt-2 flex flex-col gap-3 rounded-parranda border border-parranda-ink/10 bg-parranda-ink/5 p-4">
              <span className="h-44 rounded-parranda bg-parranda-ink/10" />
              {[0, 1, 2].map((row) => (
                <span key={row} className="flex items-center gap-3">
                  <span className="h-8 w-8 rounded-full bg-parranda-ink/10" />
                  <span className="h-3.5 flex-1 rounded-full bg-parranda-ink/10" />
                </span>
              ))}
            </div>
          </div>
        </div>
      )}

      {phase === "error" && staleNotice !== "update_failed" && (
        <div className={`flex flex-col items-start gap-3 ${noticeCard}`} role="alert">
          <p>{navigationInterrupted
            ? t("Planeringen pausades när du lämnade sidan. Dina val finns kvar.", "Planning paused when you left. Your choices are still here.")
            : t("Motorn svarar inte just nu.", "The engine isn't answering right now.")}</p>
          <button
            type="button"
            onClick={retryPlan}
            className="inline-flex min-h-11 items-center rounded-parranda-btn bg-parranda-terracotta px-4 font-bold text-white transition hover:brightness-110"
          >
            {navigationInterrupted ? t("Fortsätt planera", "Continue planning") : t("Försök bygga dagen igen", "Try building the day again")}
          </button>
        </div>
      )}

      {phase === "done" && serviceRefusal && (
        <p className={noticeCard} role="status">
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
        <p className={noticeCard}>
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

      {/* THE DAY HEADER (design handoff §3): title, honest counts, what the day
          did for each pick, provenance, and the day-level actions. The
          timeline below binds to primary_route only. */}
      {showDay && routeStops.length > 0 && (
        <header className="flex flex-col gap-3" aria-busy={staleNotice === "updating"}>
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
              <>
                <span
                  aria-live="polite"
                  className="inline-flex items-center gap-1.5 rounded-full bg-parranda-ember/12 px-2.5 py-0.5 text-[11px] font-semibold text-parranda-clay"
                >
                  {navigationInterrupted
                    ? t("Planeringen pausades när du lämnade sidan — visar din förra dag", "Planning paused when you left — showing your previous day")
                    : t("Kunde inte uppdatera — visar din förra dag", "Couldn't update — showing your previous day")}
                </span>
                <button
                  type="button"
                  onClick={retryPlan}
                  className="inline-flex min-h-11 items-center rounded-full border border-parranda-ember/40 px-3 text-xs font-bold text-parranda-clay transition hover:border-parranda-ember"
                >
                  {navigationInterrupted ? t("Fortsätt planera", "Continue planning") : t("Försök uppdatera igen", "Try updating again")}
                </button>
              </>
            )}
          </div>
          <h2 className="font-display text-[2.75rem] font-semibold leading-[0.95] text-parranda-ink sm:text-6xl">
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
            {dayWord}
            {Number.isFinite(primaryRoute?.estimated_km)
              ? ` · ≈ ${walkingDistanceLabel(primaryRoute.estimated_km, lang)} ${t("till fots", "on foot")}`
              : ""}
            {Number.isFinite(primaryRoute?.longest_leg_km)
              ? ` · ${t("längsta sträcka", "longest stretch")} ${walkingDistanceLabel(primaryRoute.longest_leg_km, lang)}`
              : ""}
            {` · ${split.core.length} ${split.core.length === 1 ? t("stopp", "stop") : t("stopp", "stops")}`}
            {split.woven.length > 0 ? ` + ${split.woven.length} live${lang === "en" ? " event" : "-event"}` : ""}
          </p>
          {/* What the day did for each pick, in the pick's own words. A pick
              the route only partly covers, or does not cover, says so here
              rather than at the foot of the page. */}
          {pickCoverage.length > 0 && (
            <ul className="flex flex-wrap gap-1.5" aria-label={t("Dina val i dagen", "Your picks in this day")}>
              {pickCoverage.map(({ key, state }) => (
                <li
                  key={key}
                  className={
                    "inline-flex min-h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs " +
                    (state === "covered"
                      ? "border-parranda-ember/45 bg-parranda-ember/10 font-semibold text-parranda-ink"
                      : state === "partial"
                        ? "border-parranda-ink/18 text-parranda-ink/75"
                        : "border-dashed border-parranda-ink/18 text-parranda-ink/55")
                  }
                >
                  {state === "covered" && <CheckIcon className="h-3 w-3 text-parranda-ember" />}
                  {state === "partial" && <HalfCircleIcon className="h-3 w-3 text-parranda-glow" />}
                  {state === "missing" && <MinusIcon className="h-3 w-3" />}
                  <span>{pickLabel(key, lang)}</span>
                  {state === "covered" && <span className="sr-only">{t(" — med i dagen", " — in this day")}</span>}
                  {state === "partial" && <span className="text-parranda-ink/55">{t(" · delvis", " · partly")}</span>}
                  {state === "missing" && <span>{t(" · inte med", " · not in this day")}</span>}
                </li>
              ))}
            </ul>
          )}
          {sourceBackedDay && (
            <p className="flex items-start gap-2 text-[13px] leading-relaxed text-parranda-ink/70">
              <span aria-hidden="true" className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-parranda-glow" />
              <span>
                {t(
                  "Byggd från källstödda platser — Parranda har inte full kurering här ännu",
                  "Built from source-backed places — Parranda does not have full curation here yet",
                )}
              </span>
            </p>
          )}
          {dayLimitationNote && (
            <p className="flex items-start gap-2 text-[13px] leading-relaxed text-parranda-ink/70">
              <span aria-hidden="true" className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-parranda-glow" />
              <span>{dayLimitationNote}</span>
            </p>
          )}
          {/* Time-anchoring truth (#429): say when the arc is not anchored to
              the local clock — a today request at 22:00 must not read as a
              doable midday plan. Quietly note the trimmed variant too. */}
          {timeAnchoring === "full_arc_not_now" && (
            <p className="flex items-start gap-2 text-[13px] leading-relaxed text-parranda-ink/70">
              <span aria-hidden="true" className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-parranda-glow" />
              <span>
                {t(
                  "En hel dags båge — inte förankrad till klockan just nu",
                  "A full-day arc — not anchored to right now",
                )}
              </span>
            </p>
          )}
          {timeAnchoring === "anchored_trimmed" && (
            <p className="flex items-start gap-2 text-[13px] leading-relaxed text-parranda-ink/70">
              <span aria-hidden="true" className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-parranda-glow" />
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
              <button type="button" onClick={() => resolveAndRun()} className="inline-flex min-h-11 items-center underline underline-offset-2 hover:text-parranda-clay">
                {t("bygg om för färska events", "rebuild for fresh events")}
              </button>
            </p>
          )}
          <div className="mt-1 flex flex-wrap gap-2">
            {routeUrls.map((routeUrl, part) => (
              <a
                key={routeUrl + part}
                href={routeUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-12 flex-1 basis-full items-center justify-center gap-2 rounded-parranda-btn bg-parranda-terracotta px-5 text-sm font-bold text-white shadow-sm transition hover:brightness-110 sm:basis-auto sm:flex-none sm:px-6"
              >
                {routeUrls.length === 1
                  ? t("Öppna rutten i Maps", "Open route in Maps")
                  : t(`Öppna del ${part + 1} av ${routeUrls.length} i Maps`, `Open part ${part + 1} of ${routeUrls.length} in Maps`)}
                <ExternalIcon />
              </a>
            ))}
            <button
              type="button"
              onClick={saveDay}
              disabled={isSaved}
              aria-label={isSaved ? t("Dagen är sparad", "Day is saved") : t("Spara dagen", "Save this day")}
              className="inline-flex min-h-12 flex-1 items-center justify-center gap-2 rounded-parranda-btn border border-parranda-ink/16 px-4 text-sm font-bold text-parranda-ink/85 transition hover:border-parranda-ember disabled:border-parranda-ember/40 disabled:text-parranda-clay sm:flex-none"
            >
              <StarIcon filled={isSaved} />
              {isSaved ? t("Sparad", "Saved") : t("Spara", "Save")}
            </button>
            {canShare && (
              <button
                type="button"
                onClick={shareDay}
                aria-label={t("Dela dagen", "Share this day")}
                className="inline-flex min-h-12 flex-1 items-center justify-center gap-2 rounded-parranda-btn border border-parranda-ink/16 px-4 text-sm font-bold text-parranda-ink/85 transition hover:border-parranda-ember sm:flex-none"
              >
                {shareCopied ? <CheckIcon className="h-4 w-4 text-parranda-ember" /> : <ShareIcon />}
                {shareCopied ? t("Länk kopierad", "Link copied") : t("Dela", "Share")}
              </button>
            )}
          </div>
          {(routeOrigin || routeDestination) && (
            <p className="text-xs text-parranda-ink/65">
              {routeOrigin && `${t("Start", "Start")}: ${routeAnchorCoords ? t("din valda position", "your chosen location") : String(publishedStart?.label || t("kartans startpunkt", "map start point"))}`}
              {routeOrigin && routeDestination ? " · " : ""}
              {routeDestination && `${t("Slut", "Finish")}: ${routeAnchorCoords ? t("din valda position", "your chosen location") : String(publishedEnd?.label || t("kartans slutpunkt", "map end point"))}`}
            </p>
          )}
          {routeUrls.length > 1 && (
            <p className="text-xs leading-relaxed text-parranda-ink/65">
              {t("Rutten är uppdelad för att alla stopp ska följa med även på mobil. Öppna delarna i ordning; nästa del börjar där den förra slutar.", "The route is split to include every stop on mobile too. Open the parts in order; each starts where the previous part ends.")}
            </p>
          )}
          {routeUrls.length === 0 && (
            <p className="text-xs text-parranda-ink/65">
              {t("Hela rutten kan inte öppnas i Maps. Öppna platserna var för sig där kartlänk finns.", "The whole route cannot be opened in Maps. Open places individually where a map link is available.")}
            </p>
          )}
        </header>
      )}

      {/* Without a composed day, this card carries provenance only. Save/share
          remain route actions: offering them here would call an unsequenced
          candidate surface a day. */}
      {showStructure && structure && !(showDay && routeStops.length > 0) && (
        <section className="rounded-parranda border border-parranda-glow/25 bg-parranda-glow/[0.06] p-4">
          <div className="min-w-0 flex-1">
            {structure.provenance === "agnostic_anchor" && (
              <p className="text-sm font-semibold text-parranda-clay">
                {t(
                  "Källstödda platskandidater — inte en komponerad rutt ännu",
                  "Source-backed place candidates — not a composed route yet",
                )}
              </p>
            )}
            {restoredAt && (
              <p className="mt-1 text-xs text-parranda-ink/60">
                {t("Sparad dag", "Saved day")} · {new Date(restoredAt).toLocaleDateString(lang === "en" ? "en-GB" : "sv-SE")} —{" "}
                <button type="button" onClick={() => resolveAndRun()} className="inline-flex min-h-11 items-center underline underline-offset-2 hover:text-parranda-clay">
                  {t("bygg om för färska events", "rebuild for fresh events")}
                </button>
              </p>
            )}
          </div>
        </section>
      )}

      {phase === "done" && upgradePending && !structure && (
        <p className={noticeCard} aria-live="polite">
          {t(
            "Läser in mer från källorna — uppdateras automatiskt strax.",
            "Reading more from the sources — updates automatically in a moment.",
          )}
        </p>
      )}

      {showDay && routeStops.length > 0 && (
        <section
          aria-label={t("Rutten", "The route")}
          className={`${staleNotice === "updating" ? "opacity-60 motion-safe:transition-opacity" : ""} rounded-parranda border border-parranda-ink/10 bg-parranda-ink/5 p-4 shadow-sm sm:p-5`}
        >
          {/* Map first (design handoff §3) — it orients the whole timeline and
              can expand in place. */}
          <RouteMap
            hasPrimaryRoute={hasPrimaryRoute}
            routeStops={routeStops}
            primaryRoute={primaryRoute}
            areas={day?.areas}
            routeContextSuggestions={routeContextSuggestions}
            showContext={detoursOpen}
            sketch={routeLineIsSketch}
            mapExpanded={mapExpanded}
            onToggleExpanded={() => setMapExpanded((cur) => !cur)}
            heightClass={mapExpanded ? "h-96 sm:h-[28rem]" : "h-48 sm:h-60"}
            t={t}
          />
          {/* The route's evidence, stated beside it: what the line is, what the
              numbers are, and how the day was assembled. */}
          <p className="mt-2.5 text-xs leading-relaxed text-parranda-ink/55">
            {routeLineIsSketch && t("Den prickade linjen visar stoppens ordning, inte gatorna. ", "The dotted line shows the order of the stops, not the streets. ")}
            {t("Avstånd och gångtider är uppskattningar. Google Maps beräknar gångvägen när du öppnar rutten.", "Distances and walking times are estimates. Google Maps calculates the walking path when you open the route.")}
            {dayContextNote && ` ${dayContextNote}`}
          </p>
          {/* Core stops only, grouped under daypart headings taken from
              stop.daypart — only groups that exist render, and the engine's
              order is never changed to force a grouping. The walk INTO a stop
              comes before its daypart heading, so a heading always opens the
              part of the day it names. A woven live event is NOT an ordinary
              POI — it renders once below, as an attached route extension. */}
          <ol className="mt-4 flex flex-col" aria-label={t("Stoppen i ordning", "The stops, in order")}>
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
              const kept = commitments[stopIdentity]?.kind === "pin";
              const prevName = routeNumber > 1 ? String((split.core[i - 1] as any)?.label || (split.core[i - 1] as any)?.name || "").trim() : "";
              const hoursLabel = selectedDayHoursLabel(stop?.selected_day_hours, lang);
              const partialLabels = partialPreferenceLabels(stop, selected, lang);
              const hoursRelevant = HOURS_RELEVANT_TYPES.has(String(stop?.type || ""));
              const sourceLabel = String(stop?.source?.label || "").trim();
              return (
                <li key={stopKey} className="flex flex-col">
                  {leg && (leg.minutes != null || leg.km != null) && (
                    <span className="ml-4 border-l border-dashed border-parranda-ink/25 py-2 pl-6 text-xs text-parranda-ink/55">
                      {leg.minutes != null ? `${leg.minutes} min` : ""}
                      {leg.minutes != null && leg.km != null ? " · " : ""}
                      {leg.km != null ? walkingDistanceLabel(leg.km, lang) : ""}
                    </span>
                  )}
                  {daypartHeading && (
                    <p className="mb-1 mt-2 pl-11 text-[10px] font-extrabold uppercase tracking-[0.2em] text-parranda-glow">{daypartHeading}</p>
                  )}
                  {/* The stop row is a DISCLOSURE, not an external link: tapping
                      it opens an inline panel instead of ejecting to Google Maps.
                      The Maps jump becomes a deliberate action inside the panel. */}
                  <button
                    type="button"
                    aria-expanded={expanded}
                    aria-controls={panelId}
                    onClick={() => setExpandedStopKey(expanded ? null : stopKey)}
                    className="flex min-h-12 w-full items-center gap-3 rounded-parranda-btn py-1.5 pr-1 text-left transition hover:bg-parranda-ink/[0.04]"
                  >
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-parranda-ember/55 bg-parranda-terracotta/20 text-[13px] font-extrabold text-parranda-clay">
                      {routeNumber}
                    </span>
                    <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1 text-sm text-parranda-ink">
                      <span className="font-bold">{name}</span>
                      {stop?.type && (
                        <span className="rounded-full border border-parranda-ink/15 bg-parranda-ink/10 px-2 py-0.5 text-xs text-parranda-ink/75">
                          {label(TYPE_LABELS, stop.type, lang)}
                        </span>
                      )}
                      {kept && (
                        <span className="inline-flex items-center gap-1 text-xs font-semibold text-parranda-clay">
                          <KeepIcon className="h-3 w-3" />
                          {t("Behålls", "Kept")}
                        </span>
                      )}
                    </span>
                    <ChevronRightIcon
                      className={"h-4 w-4 shrink-0 transition " + (expanded ? "rotate-90 text-parranda-ember" : "text-parranda-ink/40")}
                    />
                  </button>
                  {expanded && (
                    <div
                      id={panelId}
                      className="mb-2 ml-11 mt-1 flex flex-col rounded-parranda border border-parranda-ember/35 bg-parranda-ink/[0.03] p-4"
                    >
                      {/* Facts only. The schedule row is a bounded source fact
                          for the selected local day, never an "open now" claim. */}
                      <div className="flex flex-col gap-1.5 text-xs text-parranda-ink/65">
                        {leg && (leg.minutes != null || leg.km != null) && (
                          <span>
                            {legLabel(leg)}
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
                      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
                        {pin && (
                          <a
                            href={pin}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-parranda-btn bg-parranda-terracotta px-4 text-sm font-bold text-white transition hover:brightness-110 sm:w-auto sm:px-5"
                          >
                            {t("Öppna i Maps", "Open in Maps")}
                            <ExternalIcon />
                          </a>
                        )}
                        {/* Two verbs, both anchored to a real candidate id.
                            Keep says "whatever else changes, this stays";
                            dismiss removes it from consideration. They are
                            mutually exclusive by construction — the ledger
                            holds one commitment per candidate — so a kept stop
                            offers release rather than the opposite verb. */}
                        {!cityKey && hasRealId && (commitments[stopIdentity]?.kind === "pin" ? (
                          <button
                            type="button"
                            onClick={() => releaseCommitment(stopIdentity)}
                            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-parranda-btn border border-parranda-ember/45 bg-parranda-ember/10 px-4 text-sm font-semibold text-parranda-ink transition hover:border-parranda-ember sm:px-5"
                          >
                            <KeepIcon className="h-4 w-4 text-parranda-ember" />
                            {t("Behålls — släpp", "Kept — release")}
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => keepStop(stopIdentity, name)}
                            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-parranda-btn border border-parranda-ink/20 px-4 text-sm font-semibold text-parranda-ink/80 transition hover:border-parranda-ember hover:text-parranda-ink sm:px-5"
                          >
                            <KeepIcon className="h-4 w-4" />
                            {t("Behåll den här", "Keep this one")}
                          </button>
                        ))}
                        {!cityKey && hasRealId && commitments[stopIdentity]?.kind !== "pin" && (
                          <button
                            type="button"
                            onClick={() => dismissStop(stopIdentity, name)}
                            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-parranda-btn border border-parranda-ink/20 px-4 text-sm font-semibold text-parranda-ink/80 transition hover:border-parranda-ink/40 hover:text-parranda-ink sm:px-5"
                          >
                            <MinusIcon className="h-4 w-4" />
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
            const legShown = Boolean(leg && (leg.minutes != null || leg.km != null));
            const legKm = Number.isFinite(eveningEvent?.route_leg_km) ? eveningEvent.route_leg_km : leg?.km;
            const pin = mapsPlaceUrl(stop, mapsPlaceContext);
            const venue = String(eveningEvent?.place || "").trim();
            // Attribution (the listing feed) and destination (where the link
            // leads) stay separate facts; the stop's own source wins, as before.
            const sourceLabel = String(stop?.source?.label || eveningEvent?.source_label || "").trim();
            const sourceLink = stop?.source?.url
              ? eventSourceLink(
                  { source_url: stop.source.url, source_link_kind: stop.source.link_kind, source_link_host: stop.source.link_host },
                  lang,
                )
              : eventSourceLink(eveningEvent, lang);
            const routeNumber = routeStops.indexOf(stop) + 1;
            return (
              <div key={stop?.id} className="flex flex-col">
                {legShown && leg && (
                  <span className="ml-4 border-l border-dashed border-parranda-ember/40 py-2 pl-6 text-xs text-parranda-ink/55">
                    {legLabel(leg)}
                  </span>
                )}
                <div className={`${legShown ? "" : "mt-3 "}rounded-parranda border border-parranda-ember/50 bg-gradient-to-br from-parranda-terracotta/15 to-parranda-glow/5 p-4`}>
                  <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-parranda-clay">
                    <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-parranda-ember motion-safe:animate-pulse" />
                    {t("Live i din rutt", "Live in your route")}
                  </p>
                  <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-semibold text-parranda-ink">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-parranda-terracotta text-[13px] font-extrabold text-white">{routeNumber}</span>
                    {pin ? (
                      <a href={pin} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 min-w-11 items-center gap-1.5 text-[15px] font-bold transition hover:text-parranda-clay">
                        {name}
                        <ExternalIcon className="h-3.5 w-3.5 text-parranda-ink/50" />
                      </a>
                    ) : (
                      <span className="text-[15px] font-bold">{name}</span>
                    )}
                    {stop?.starts_at && (
                      <span className="rounded-full border border-parranda-accent bg-parranda-accent/15 px-2 py-0.5 text-xs font-bold text-parranda-clay">
                        {eventTiming(stop, lang, undefined, liveEvents?.selected_date)}
                      </span>
                    )}
                  </p>
                  {venue && venue !== name && <p className="mt-0.5 text-xs text-parranda-ink/70">{venue}</p>}
                  <p className="mt-1 text-xs text-parranda-ink/70">
                    {dayOffset === 0
                      ? t("Tillagt till dagens rutt", "Added to today's route")
                      : t("Tillagt till morgondagens rutt", "Added to tomorrow's route")}
                    {!legShown && Number.isFinite(legKm)
                      ? t(
                          ` · ${walkingDistanceLabel(legKm, "sv")} från föregående stopp`,
                          ` · ${walkingDistanceLabel(legKm, "en")} from the previous stop`,
                        )
                      : ""}
                  </p>
                  {(sourceLabel || sourceLink) && (
                    <p className="mt-1 text-xs text-parranda-ink/55">
                      {sourceLabel && <>{t("Källa", "Source")}: {sourceLabel}</>}
                      {sourceLabel && sourceLink && " · "}
                      {sourceLink && (
                        <a href={sourceLink.href} target="_blank" rel="noopener noreferrer" className="-my-3 inline-flex min-h-11 min-w-11 items-center underline decoration-parranda-ink/30 underline-offset-2 hover:text-parranda-clay">
                          <span>{sourceLink.text}<span aria-hidden="true">&nbsp;↗</span></span>
                        </a>
                      )}
                    </p>
                  )}
                </div>
              </div>
            );
          })}

          {/* Detours — collapsed by default (design handoff §3): optional ideas
              must never read as part of the route, and the caption stays visible
              even while collapsed. Their dots join the map only while open. */}
          {routeContextSuggestions.length > 0 && (
            <div className="mt-5 border-t border-parranda-ink/10 pt-4">
              <button
                type="button"
                aria-expanded={detoursOpen}
                onClick={() => setDetoursOpen((cur) => !cur)}
                className="flex min-h-12 w-full items-center justify-between gap-3 rounded-parranda-btn border border-dashed border-parranda-ink/20 px-4 text-left text-[13px] font-bold text-parranda-ink/80 transition hover:border-parranda-ink/35"
              >
                <span>
                  {routeContextSuggestions.length}{" "}
                  {routeContextSuggestions.length === 1
                    ? t("idé nära din rutt", "detour idea near your route")
                    : t("idéer nära din rutt", "detour ideas near your route")}
                </span>
                <ChevronDownIcon className={"h-4 w-4 shrink-0 transition " + (detoursOpen ? "rotate-180" : "")} />
              </button>
              <p className="mt-2 text-xs text-parranda-ink/60">
                {t(
                  "Valfria idéer från platsunderlaget — de ingår inte i dagens stopp eller Maps-rutten.",
                  "Optional ideas from the place evidence — they are not part of this day's stops or the Maps route.",
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
                      <li key={stop.id || stop.candidate_id || stop.place_id || name} className="rounded-parranda border border-dashed border-parranda-ink/20 px-3.5 py-1.5">
                        <button
                          type="button"
                          aria-expanded={expanded}
                          aria-controls={candidatePanelId}
                          onClick={() => setExpandedCandidateKey(expanded ? null : candidateKey)}
                          className="flex min-h-11 w-full items-center justify-between gap-3 text-left text-sm font-semibold text-parranda-ink transition hover:text-parranda-clay"
                        >
                          <span>{name}</span>
                          {expanded ? <MinusIcon className="h-4 w-4 shrink-0 text-parranda-ember" /> : <PlusIcon className="h-4 w-4 shrink-0 text-parranda-ink/50" />}
                        </button>
                        <p className="pb-1.5 text-xs text-parranda-ink/55">
                          {walkingDistanceLabel(stop.distance_km, lang)} {t("från", "from")} {stop.route_stop_name}
                        </p>
                        {expanded && (
                          <div id={candidatePanelId} className="mb-1.5 mt-1 border-t border-parranda-ink/10 pt-3">
                            {url && (
                              <a
                                href={url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-parranda-btn bg-parranda-terracotta px-4 text-sm font-bold text-white transition hover:brightness-110"
                              >
                                {t("Öppna platsen i Maps", "Open place in Maps")}
                                <ExternalIcon />
                              </a>
                            )}
                            {/* Add is the same commitment as Keep, reached from
                                a candidate the day did not choose. The server
                                still has to resolve it against its own loaded
                                pool — an unhonoured pin is reported, not faked. */}
                            {!cityKey && candidateId && (commitments[candidateId]?.kind === "pin" || canCommitTo(stop)) && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    commitments[candidateId]?.kind === "pin"
                                      ? releaseCommitment(candidateId)
                                      : commit(candidateId, "pin", name)
                                  }
                                  className={`mt-2 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-parranda-btn border px-4 text-sm font-semibold transition ${
                                    commitments[candidateId]?.kind === "pin"
                                      ? "border-parranda-ember/45 bg-parranda-ember/10 text-parranda-ink hover:border-parranda-ember"
                                      : "border-parranda-ink/20 text-parranda-ink/80 hover:border-parranda-ember hover:text-parranda-ink"
                                  }`}
                                >
                                  <KeepIcon className="h-4 w-4 text-parranda-ember" />
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
        </section>
      )}

      {/* Without a primary route, the broader place structure remains useful —
          but it is explicitly candidates, never a second itinerary. */}
      {showStructure && structure && !hasPrimaryRoute && (
        <section className="flex flex-col gap-4 rounded-parranda border border-parranda-ink/10 bg-parranda-ink/5 p-4 shadow-sm sm:p-5">
          <div>
            <p className="text-[11px] font-extrabold uppercase tracking-[0.16em] text-parranda-ink/60">
              {t("Kandidater nära platsen", "Candidates near this place")}
            </p>
            {classification?.status === "structure_only" && (
              <p className="mt-1 text-sm text-parranda-ink/75">
                {t(
                  "Parranda hittade platskandidater, men inte en tillräckligt stark rutt ännu.",
                  "Parranda found place candidates, but not a reliable route yet.",
                )}
              </p>
            )}
          </div>

          <RouteMap
            hasPrimaryRoute={false}
            routeStops={routeStops}
            primaryRoute={primaryRoute}
            areas={day?.areas}
            routeContextSuggestions={routeContextSuggestions}
            showContext={false}
            sketch={false}
            heightClass="h-64 sm:h-72"
            t={t}
          />

          {/* Candidate CLUSTERS, deliberately unnumbered and unsequenced: no rank
              badges, no daypart headings, no inter-cluster walking legs — those
              read as an itinerary, and only primary_route.main_stops is a route. */}
          <ul className="flex flex-col gap-3">
            {(day?.areas ?? []).map((area, index) => (
              <li key={index} className="rounded-parranda border border-parranda-ink/10 bg-parranda-ink/[0.06] p-4">
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
                        <li key={stop.id ?? si} className="rounded-parranda-btn border border-parranda-ink/10 px-3 py-1">
                          <button
                            type="button"
                            aria-expanded={expanded}
                            aria-controls={candidatePanelId}
                            onClick={() => setExpandedCandidateKey(expanded ? null : candidateKey)}
                            className="flex min-h-11 w-full items-center justify-between gap-3 text-left font-semibold transition hover:text-parranda-clay"
                          >
                            <span>{name}</span>
                            {expanded ? <MinusIcon className="h-4 w-4 shrink-0 text-parranda-ember" /> : <PlusIcon className="h-4 w-4 shrink-0 text-parranda-ink/50" />}
                          </button>
                          {expanded && (
                            <div id={candidatePanelId} className="border-t border-parranda-ink/10 pb-2 pt-2">
                              {facts.length > 0 && <p className="text-xs text-parranda-ink/60">{facts.join(" · ")}</p>}
                              {url && (
                                <a
                                  href={url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="mt-2 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-parranda-btn bg-parranda-terracotta px-4 text-sm font-bold text-white transition hover:brightness-110 sm:w-auto"
                                >
                                  {t("Öppna platsen i Maps", "Open place in Maps")}
                                  <ExternalIcon />
                                </a>
                              )}
                              {!cityKey && candidateId && (commitments[candidateId]?.kind === "pin" || canCommitTo(stop)) && (
                              <button
                                type="button"
                                onClick={() =>
                                  commitments[candidateId]?.kind === "pin"
                                    ? releaseCommitment(candidateId)
                                    : commit(candidateId, "pin", name)
                                }
                                className={`mt-2 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-parranda-btn border px-4 text-sm font-semibold transition sm:w-auto ${
                                  commitments[candidateId]?.kind === "pin"
                                    ? "border-parranda-ember/45 bg-parranda-ember/10 text-parranda-ink hover:border-parranda-ember"
                                    : "border-parranda-ink/20 text-parranda-ink/80 hover:border-parranda-ember hover:text-parranda-ink"
                                }`}
                              >
                                <KeepIcon className="h-4 w-4 text-parranda-ember" />
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
            <p className="text-sm text-parranda-ink/65">
              {t("Ingen av kandidaterna täcker:", "None of these candidates cover:")} {(day?.missing_intents ?? []).map((k) => label(INTENT_LABELS, k, lang)).join(", ")}
            </p>
          )}
        </section>
      )}

      {phase === "done" &&
        ((liveEvents && (liveEvents.coverage === "covered" || liveEvents.coverage === "uncovered")) ||
          (showDay && dayflow?.weather?.headline) ||
          aroundPlaceScopeAvailable) && (
        <section className="rounded-parranda border border-parranda-ink/10 bg-parranda-ink/5 p-4 shadow-sm sm:p-5">
          {/* PULSE — the city's now-context: weather read, rhythm advice, current
              events. Renders independently of route composition (live_events
              survives a blocked compose), so a failed route never hides trusted
              context; and the trusted weather read shows even when no event
              source exists. Woven events are excluded here — they own the
              route-extension presentation above. */}
          <p className="text-[11px] font-extrabold uppercase tracking-[0.16em] text-parranda-glow">
            {mode === "near_me"
              ? t("Live nära dig", "Live near you")
              : anchorLabel
                ? t(`Live i ${anchorLabel}`, `Live in ${anchorLabel}`)
                : t("Live här", "Live here")}
            {liveEvents?.selected_date ? ` · ${liveDayLabel}` : ""}
          </p>

          {((showDay && dayflow?.weather?.headline) || clothing) && (
            <div className="mt-3 flex flex-col gap-1 rounded-parranda-btn bg-parranda-ink/[0.05] px-3.5 py-3">
              {showDay && dayflow?.weather?.headline && (
                <p className="text-sm font-semibold text-parranda-ink">
                  {dayflow.weather.headline}
                  {dayflow.weather.pitch ? <span className="font-medium text-parranda-ink/80"> — {dayflow.weather.pitch}</span> : null}
                </p>
              )}
              {clothing && (
                <p className="text-sm text-parranda-ink">
                  <span className="font-semibold">{clothing.headline}</span>
                  <span className="text-parranda-ink/70"> — {clothing.advice}</span>
                </p>
              )}
            </div>
          )}

          {split.woven.length > 0 && (
            <p className="mt-3 text-xs text-parranda-ink/60">
              {split.woven
                .map((s: any) => String(s?.label || s?.name || "").trim())
                .filter(Boolean)
                .map((n: string) => `${n} · ${includedInRoute}`)
                .join(" · ")}
            </p>
          )}

          {/* Honest source-health states — coverage only says sources exist HERE;
              pulseHealthState says whether collection actually succeeded. Raw
              backend reason tokens never reach product copy. */}
          {pulseState === "uncovered" && (
            <p className="mt-3 text-sm text-parranda-ink/70">
              {t("Ingen live-eventkälla täcker den här platsen än — Parranda hittar inte på en.", "No live-events feed reaches this place yet — Parranda won't invent one.")}
            </p>
          )}
          {pulseState === "pending" && (
            <p className="mt-3 text-sm text-parranda-ink/70">{t("Kollar kalendrarna — uppdateras automatiskt strax.", "Checking the calendars — updates automatically in a moment.")}</p>
          )}
          {pulseState === "soft_empty" && (
            <p className="mt-3 text-sm text-parranda-ink/70">
              {t("Källorna svarade men listar inga händelser för perioden.", "The sources responded but list no events for this period.")}
            </p>
          )}
          {pulseState === "rejected_empty" && (
            <p className="mt-3 text-sm text-parranda-ink/70">
              {t(
                "Det fanns listningar, men inga var pålitliga eller aktuella nog att visa.",
                "Listings existed, but none were reliable or current enough to show.",
              )}
            </p>
          )}
          {pulseState === "unavailable" && (
            <p className="mt-3 text-sm text-parranda-ink/70">
              {liveFailure
                ? liveFailureSentence(liveFailure)
                : t("Parranda kunde inte verifiera händelser just nu — försök igen om en stund.", "Parranda couldn't verify events right now — try again shortly.")}
            </p>
          )}

          {pulseBuckets.tonight.length > 0 && (
            <div className="mt-4">
              <p className="text-sm font-semibold text-parranda-ink">{liveDayLabel}</p>
              <ul className="mt-2 flex flex-col gap-3">
                {pulseBuckets.tonight.slice(0, 4).map((ev: PulseEvent, i: number) => (
                  <li key={ev.id ?? i} className="flex items-baseline gap-3 text-sm leading-relaxed text-parranda-ink/85">
                    <span className="min-w-[52px] shrink-0 text-xs font-extrabold tabular-nums text-parranda-clay">
                      {eventTiming(ev, lang, undefined, liveEvents?.selected_date)}
                    </span>
                    <span>
                      <span className="font-semibold text-parranda-ink">{ev.title}</span>
                      {ev.place && <span className="text-parranda-ink/60"> · {ev.place}</span>}
                      {liveEventSource(ev, lang)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {/* The card keeps a one-line summary for the week — the full list
              lives in the Live sheet. The count comes from the bucket, never
              from copy. */}
          {pulseBuckets.thisWeek.length > 0 && (
            <p className="mt-4 border-t border-parranda-ink/10 pt-3 text-sm text-parranda-ink/70">
              <span className="font-semibold text-parranda-ink">{t("Följande 7 dagar", "Following 7 days")}</span>
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
              className="mt-4 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-parranda-btn border border-parranda-ember/50 bg-parranda-ember/10 text-[13px] font-bold text-parranda-clay transition hover:bg-parranda-ember/15"
            >
              {pulseBuckets.tonight.length > 0 || pulseBuckets.thisWeek.length > 0
                ? t("Se allt live", "See all live")
                : t("Utforska live", "Explore live")}
              <ChevronRightIcon className="h-4 w-4" />
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

      {/* BLITZ — one trusted next move beside the day, in the same "now" zone
          as Live. It reads the anchor and picks but never re-composes the day,
          and it stays out of curated mode, whose server-owned city identity
          the Blitz contract cannot carry yet. */}
      {phase === "done" && hasAnchor && !cityKey && (
        <div className="flex flex-col gap-3">
          <button
            type="button"
            onClick={blitz}
            disabled={blitzPhase === "loading"}
            className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-parranda-btn border border-parranda-ink/16 bg-parranda-ink/[0.04] px-4 text-sm font-bold text-parranda-ink/85 transition hover:border-parranda-ember disabled:opacity-60"
          >
            <BoltIcon className="h-4 w-4 text-parranda-glow" />
            {blitzPhase === "loading" ? t("Läser läget …", "Reading the moment …") : t("Blitz just nu", "Blitz right now")}
          </button>
          {blitzPhase === "idle" && (
            <p className="-mt-1 text-center text-xs text-parranda-ink/50">
              {t("Ett nästa drag nära dig, just nu — din dag ändras inte.", "One next move near you, right now — your day stays as it is.")}
            </p>
          )}
          {blitzPhase !== "idle" && (
            <section className="rounded-parranda border border-parranda-ember/35 bg-gradient-to-br from-parranda-terracotta/12 to-parranda-glow/5 p-4" aria-live="polite">
              <div className="flex items-center gap-2">
                <BoltIcon className="h-3.5 w-3.5 text-parranda-glow" />
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
                // A Live move's link names where it leads; the listing feed stays in
                // the meta line. A place move keeps its attribution link unchanged.
                const liveSourceLink = move.kind === "live_event"
                  ? eventSourceLink(
                      { source_url: move.source.url, source_link_kind: move.source.link_kind, source_link_host: move.source.link_host },
                      lang,
                    )
                  : null;
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
                        <a href={mapsUrl} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center gap-2 rounded-parranda-btn bg-parranda-terracotta px-4 text-sm font-bold text-white transition hover:brightness-110">
                          {t("Öppna i Maps", "Open in Maps")}
                          <ExternalIcon />
                        </a>
                      )}
                      {move.kind === "live_event"
                        ? liveSourceLink && (
                            <a href={liveSourceLink.href} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center rounded-parranda-btn border border-parranda-ink/16 px-4 text-sm font-bold text-parranda-ink/75">
                              <span>{liveSourceLink.text}<span aria-hidden="true">&nbsp;↗</span></span>
                            </a>
                          )
                        : move.source.url && (
                            <a href={move.source.url} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center gap-2 rounded-parranda-btn border border-parranda-ink/16 px-4 text-sm font-bold text-parranda-ink/75">
                              {t("Källa", "Source")}
                              <ExternalIcon />
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
        </div>
      )}

      {savedDays.length > 0 && (
        <section className="rounded-parranda border border-parranda-ink/10 bg-parranda-ink/[0.03] px-4 py-3">
          <p className="py-1 text-[11px] font-extrabold uppercase tracking-[0.16em] text-parranda-ink/60">{t("Sparade dagar", "Saved days")}</p>
          <ul className="flex flex-col">
            {savedDays.map((entry) => (
              <li key={entry.id} className="flex items-center gap-2 border-t border-parranda-ink/[0.08] first:border-t-0">
                <button
                  type="button"
                  onClick={() => restoreEntry(entry)}
                  className="inline-flex min-h-11 flex-1 items-center text-left text-sm text-parranda-ink transition hover:text-parranda-clay"
                >
                  <span className="font-semibold">{entry.label}</span>
                  {entry.dateIso && <span className="text-parranda-ink/60"> · {liveDateLabel(entry.dateIso, lang)}</span>}
                </button>
                <button
                  type="button"
                  onClick={() => removeSavedDay(entry.id)}
                  aria-label={t("Ta bort", "Remove")}
                  className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-full text-parranda-ink/40 transition hover:text-parranda-clay"
                >
                  <CloseIcon />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* THE LIVE SHEET (§3B) — explores the live_events buckets only. It never
          changes the day's anchor or the route: it is handed read-only data and
          three callbacks (scope, time, close), none of which composes a day. */}
      {liveSheetOpen && (
        <LiveSheet
          lang={lang}
          t={t}
          anchorLabel={anchorLabel}
          selected={selected}
          liveDayLabel={liveDayLabel}
          liveSheetTime={liveSheetTime}
          setLiveSheetTime={setLiveSheetTime}
          liveSheetScope={liveSheetScope}
          requestLiveSheetScope={(scope) => { requestLiveSheetScope(scope).catch(() => {}); }}
          aroundPlaceScopeAvailable={aroundPlaceScopeAvailable}
          routeScopeAvailable={routeScopeAvailable}
          liveQueryPending={liveQueryPending}
          liveQueryGeoHint={liveQueryGeoHint}
          liveQueryError={liveQueryError}
          sheetLiveEvents={sheetLiveEvents}
          sheetBuckets={sheetBuckets}
          sheetBrowseBuckets={sheetBrowseBuckets}
          sheetPulseState={sheetPulseState}
          sheetFailure={sheetFailure}
          sheetSourceHealth={sheetSourceHealth}
          sheetSources={sheetSources}
          wovenNames={split.woven.map((s: any) => String(s?.label || s?.name || "").trim()).filter(Boolean)}
          includedInRoute={includedInRoute}
          liveFailureSentence={liveFailureSentence}
          dialogRef={liveSheetDialogRef}
          closeRef={liveSheetCloseRef}
          onClose={() => setLiveSheetOpen(false)}
        />
      )}
    </div>
  );
}
