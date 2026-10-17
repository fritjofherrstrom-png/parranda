import { isLiveOccurrenceId, scopeLiveChoices, selectableLiveOccurrenceId } from "../lib/live-stop-choice.mjs";
import { urlEntryCommitments } from "../lib/url-entry-commitments.mjs";
import type { Commitments } from "./planner/commitments";
/**
 * Modern planner surface for freeform places, coordinates, and registered cities.
 *
 * Talks to the EXISTING Express API (same payload as the production anywhere
 * mode). All places use the SHARED honesty module, so a fallback city's day
 * can never be dressed up as the requested place:
 *   composed       → one authoritative route + optional nearby context + Pulse
 *   structure_only → candidate areas only, honest "not a finished route" note
 *   unavailable    → honest empty state (never a crash)
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { normalizeDayEdit, normalizePreferencePriority, promotePreference, togglePreferenceSelection, type DayEdit } from "../../../shared/planner-intent.mjs";
import { fetchPlannerLifecycle } from '../lib/planner-lifecycle.mjs';
import {
  buildAnywherePayload,
  ANYWHERE_PREFERENCES,
  DAY_RHYTHMS,
  freezeComposeDateIso,
} from "../lib/anywhere-payload.mjs";
import { anywhereBlitzView, type AnywhereBlitzView } from "../lib/blitz-view.mjs";
import { inertOutside, tabbableWithin } from "../lib/modal-focus.mjs";
import { contextNote, limitationNote, sourcesIncomplete } from "../lib/day-limitations.mjs";
import { dayChangeSegments, describeDayChange, type DayChange } from "../lib/day-change.mjs";
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
import { mapsWalkingRouteParts, primaryRouteStops, type RouteEnd } from "../lib/maps-links.mjs";
import { routePathIsSketch } from "../lib/route-map-presentation.mjs";
import {
  buildRouteContextSuggestions,
  routePreferenceCoverage,
  routeTimeAnchoring,
} from "../lib/route-context-view.mjs";
import {
  splitRouteStops,
  wovenEventIds,
  pulseEventBuckets,
  pulseBrowseBuckets,
  clothingAdvice,
  pulseSourceLine,
  liveSourceFailure,
  pulseHealthState,
} from "../lib/pulse-view.mjs";
import { planComposeFollowup } from "../lib/compose-followup.mjs";
import { LIVE_COMPLETION_QUERY, followLiveCompletion, takeLiveCompletion, type LiveCompletionCapability } from "../lib/live-completion.mjs";
import { composeServiceRefusal, type ComposeServiceRefusal } from "../lib/compose-service-refusal.mjs";
import plannerEntry from "../../../planner-entry.js";
import { buildShareUrl, decodeShareParams, encodeShareParams, shareablePlace, validPlaceRef } from "../lib/anywhere-share.mjs";
import { consumeAnchorCoords, requestPosition, storeAnchorCoords } from "../lib/location-anchor.mjs";
import { consumePlaceChoice, storePlaceChoice } from "../lib/place-choice.mjs";
import { PlaceChoices } from "./planner/PlaceChoices";
import {
  buildSavedEntry,
  upsertSaved,
  removeSaved,
  LAST_KEY,
  SAVED_KEY,
  savedEntryId,
  savedEntryAnchorKey,
  normalizeSavedWalkKey,
  type SavedEntry,
} from "../lib/anywhere-storage.mjs";
import {
  buildCommitmentSnapshot,
  readCommitmentSnapshot,
} from "../lib/commitment-snapshot.mjs";
import { anywhereDecision, type AnywhereClassification } from "../lib/anywhere-decision";
import AppBar from "./shared/AppBar";
import { KeepIcon, LocationIcon, MinusIcon, UndoIcon } from "./shared/icons";
import { busyButton, buttonClass, noticeCard } from "./shared/ui";
import { useMediaQuery } from "./shared/useMediaQuery";
import AnchorCard from "./planner/AnchorCard";
import BlitzCard from "./planner/BlitzCard";
import CandidateAreas from "./planner/CandidateAreas";
import DayHeader, { DayActions, dayAssemblyNotes } from "./planner/DayHeader";
import LiveCard from "./planner/LiveCard";
import RouteMap from "./planner/RouteMap";
import LiveSheet from "./planner/LiveSheet";
import { selectedDayEmpty, useLiveFallback } from "./planner/useLiveFallback";
import SavedDays from "./planner/SavedDays";
import StopLine from "./planner/StopLine";
import { pickLabel, unkeptReasonSentence, type Lang } from "./planner/copy";
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

const LIVE_QUERY_REFRESH_DELAYS_MS = [1500, 3000, 5000, ...Array<number>(22).fill(5000)] as const;

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
// The inputs an adjustment is made of, as one comparable value.
function adjustmentSignature(
  selected: string[],
  dayOffset: 0 | 1,
  walkKey: string,
  commitments: Record<string, { kind: "exclude" | "pin"; label: string; liveAction?: "remove" | "replace" }>,
  priority: string[] = [],
  edit: DayEdit | null = null,
): string {
  const ledger = Object.keys(commitments)
    .sort()
    .map((id) => [id, commitments[id]?.kind ?? null, commitments[id]?.liveAction ?? null]);
  return JSON.stringify([selected, dayOffset, walkKey, ledger, normalizePreferencePriority(priority, selected), normalizeDayEdit(edit)]);
}

// A published day or an explicitly empty choice can be restored by Undo;
// a structure view or a refusal is not an accepted result to put back.
function isUndoableDay(entry: SavedEntry | null): entry is SavedEntry {
  const status = entry?.classification?.status;
  return status === "composed" || status === "composed_limited" || status === "edited_empty";
}

// This only detects an old bounded ledger for an explanatory notice. It does
// not authorize recovery: urlEntryCommitments still checks the actual context.
function hasStoredChoices(entry: SavedEntry | null): boolean {
  const snapshot = entry?.commitments;
  if (!snapshot) return false;
  const stored = readCommitmentSnapshot(snapshot, { anchorKey: snapshot.anchorKey, dayKey: snapshot.dayKey });
  return Object.keys(stored.entries).length > 0;
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
  const [placeSelection, setPlaceSelection] = useState<string | null>(null);
  const [selectionLabel, setSelectionLabel] = useState<string | undefined>();
  // The chosen place's OSM identity. Unlike the receipt it survives reloads,
  // other languages and new sessions; the server re-validates it.
  const [placeRef, setPlaceRef] = useState<string | null>(null);
  const [invalidPlaceLink, setInvalidPlaceLink] = useState(false);
  const [invalidDayEditLink, setInvalidDayEditLink] = useState(false);
  // False in the static HTML and the hydration render: until the arrival
  // effect has read the URL, nothing is known about the link's place.
  const [arrivalRead, setArrivalRead] = useState(false);
  const [conflictingPlaceLink, setConflictingPlaceLink] = useState(false);
  const [narrowingPlace, setNarrowingPlace] = useState(false);
  const [narrowingFailed, setNarrowingFailed] = useState(false);
  const [mode, setMode] = useState<"typed" | "near_me">("typed"); // start context
  const [relocating, setRelocating] = useState(false); // near-me: position asked again
  const [relocateDenied, setRelocateDenied] = useState(false);
  const [positionNeeded, setPositionNeeded] = useState(false); // near-me: no position in memory

  const [selected, setSelected] = useState<string[]>(["food", "culture", "views"]);
  const [preferencePriority, setPreferencePriority] = useState<string[]>([]);
  const [dayEdit, setDayEdit] = useState<DayEdit | null>(null);
  const dayEditScopeRef = useRef<{ anchorKey: string | null; dateIso: string | null } | null>(null);
  const [stopEditPending, setStopEditPending] = useState(false);
  const pendingStopEditRef = useRef<DayEdit | null>(null);
  const [stopEditFeedback, setStopEditFeedback] = useState<"remove" | "replace" | null>(null);
  const [stopEditError, setStopEditError] = useState<"no_safe_replacement" | "not_confirmed" | "unsupported" | "rebuild_required" | "live_not_preserved" | null>(null);
  const livePlanPendingRef = useRef<string | null>(null);
  const [livePlanPending, setLivePlanPending] = useState(false);
  const resultStatusRef = useRef<HTMLParagraphElement | null>(null);
  const focusDayAfterLiveChoiceRef = useRef(false);
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
  const [commitments, setCommitments] = useState<Record<string, { kind: "exclude" | "pin"; label: string; liveAction?: "remove" | "replace" }>>({});
  const [choicesNotCarried, setChoicesNotCarried] = useState(false);
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
  const [blitzPhase, setBlitzPhase] = useState<"idle" | "loading" | "done" | "error" | "position_needed" | "locating">("idle");
  const [blitzPositionFailed, setBlitzPositionFailed] = useState(false);
  const [blitzResult, setBlitzResult] = useState<AnywhereBlitzView | null>(null);
  const [upgradePending, setUpgradePending] = useState(false); // cold-start: structure upgrade in flight
  // Whether the day on screen is still following its own Live completion
  // capability. Pending Live that nothing is following reads as unavailable,
  // never as "still loading".
  const [liveFollowing, setLiveFollowing] = useState(false);
  // The terminal Live result read for the day on screen. Kept beside that day
  // rather than replacing it: the day is still the same published day, so
  // nothing keyed to it (the Live sheet's own queries) starts over.
  const [completedLive, setCompletedLive] = useState<{ day: any; liveEvents: LiveEvents } | null>(null);
  const [savedDays, setSavedDays] = useState<SavedEntry[]>([]);
  const [restoredAt, setRestoredAt] = useState<string | null>(null); // set when showing a SNAPSHOT
  // What the last adjustment changed, beside the day it replaced. An adjustment
  // recomposes on its own, so the replacement is never silent: it says what
  // moved, and the day before it can be put back with one tap until the next
  // change, a new place or a saved day takes over.
  const [dayChange, setDayChange] = useState<{ previous: SavedEntry; summary: DayChange } | null>(null);
  // The day on screen when an adjustment left for the server — the one "Undo"
  // returns to. Taken from the live day, never from a request still in flight,
  // and only while the anchor it belongs to is the one being recomposed.
  const undoBaselineRef = useRef<{ entry: SavedEntry; anchorKey: string | null } | null>(null);
  // Undo installs the previous inputs without composing. This is the input
  // signature it installed, so the auto-recompose effect recognises its own
  // echo instead of composing the day it just put back.
  const undoEchoRef = useRef<string | null>(null);
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
  // Arriving through a share or language link adopts the link's inputs into
  // state. That adoption is not an adjustment: the arrival compose already
  // carries those inputs, so the one re-run it causes is skipped.
  const adoptedInputsRef = useRef(false);
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
  // Live only. Navigation never changes the day; explicit occurrence choice
  // below uses the ordinary commitment/recomposition path.
  const [liveSheetOpen, setLiveSheetOpen] = useState(false);
  const [liveSheetTime, setLiveSheetTime] = useState<"tonight" | "week">("tonight");
  const [liveSheetSort, setLiveSheetSort] = useState<"for_you" | "by_time">("for_you");
  const [liveSheetScope, setLiveSheetScope] = useState<LiveEventScope>("around_place");
  const [liveQueryEvents, setLiveQueryEvents] = useState<LiveEvents | null>(null);
  const [liveQueryPending, setLiveQueryPending] = useState(false);
  const [liveQueryError, setLiveQueryError] = useState<string | null>(null);
  const [liveQueryGeoHint, setLiveQueryGeoHint] = useState<string | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The run following the current day's Live completion capability. The
  // capability itself lives only inside that run.
  const liveCompletionAbortRef = useRef<AbortController | null>(null);
  const liveSheetTriggerRef = useRef<HTMLButtonElement | null>(null);
  const liveSheetDialogRef = useRef<HTMLDivElement | null>(null);
  const liveSheetCloseRef = useRef<HTMLButtonElement | null>(null);
  const liveQueryAbortRef = useRef<AbortController | null>(null);
  const liveSheetOpenedRef = useRef(false);
  const liveSheetPeriodAutomaticRef = useRef(true);
  const liveSheetUpgradeResponseRef = useRef<any>(null);
  const liveNearMeCoordsRef = useRef<{ lat: number; lng: number } | null>(null);
  const liveResponseRef = useRef(safeResponse);
  liveResponseRef.current = safeResponse;
  // A scope request belongs to the published day it was built from. Intent
  // cancellation alone misses queries opened while the previous day is held.
  useEffect(() => {
    const retainCell = Boolean(liveSheetUpgradeResponseRef.current) &&
      liveSheetUpgradeResponseRef.current === safeResponse;
    // Consume on mismatch too: restore/compose can replace a batched upgrade.
    liveSheetUpgradeResponseRef.current = null;
    liveQueryAbortRef.current?.abort();
    liveQueryAbortRef.current = null;
    setLiveQueryEvents(null);
    setLiveQueryPending(false);
    setLiveQueryError(null);
    setLiveQueryGeoHint(null);
    // A Live upgrade answers the same question. Keep the reader's cell, but
    // never reuse its old geometry/result. Reopen refreshes a closed sheet.
    if (retainCell && liveSheetOpenedRef.current) {
      if (liveSheetOpen) requestLiveSheetScope(liveSheetScope, liveSheetTime, true).catch(() => {});
      return;
    }
    liveSheetOpenedRef.current = false;
    liveSheetPeriodAutomaticRef.current = true;
    liveNearMeCoordsRef.current = null;
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

  type Anchor = { place?: string; coords?: { lat: number; lng: number }; placeSelection?: string | null; selectionLabel?: string; placeRef?: string | null; placeBias?: { lat: number; lng: number }; placeContextSelection?: string };
  const lastRequestedAnchorRef = useRef<Anchor | null>(null);
  // The date the latest compose asked about, so a retry asks the same question.
  const lastComposeDateIsoRef = useRef<string | null>(null);
  function resetBlitz() {
    blitzRequestRef.current?.abort();
    blitzRequestRef.current = null;
    blitzRequestSequenceRef.current += 1;
    setBlitzPhase("idle");
    setBlitzResult(null);
    setBlitzPositionFailed(false);
  }

  async function execute(
    anchor: Anchor,
    {
      silent = false,
      langOverride,
      preferencesOverride,
      preferencePriorityOverride,
      dayEditOverride,
      dayOffsetOverride,
      dateIsoOverride,
      walkKeyOverride,
      excludedOverride,
      pinnedOverride,
      commitmentsOverride,
    }: {
      silent?: boolean;
      langOverride?: Lang;
      preferencesOverride?: string[];
      preferencePriorityOverride?: string[];
      dayEditOverride?: DayEdit | null;
      dayOffsetOverride?: 0 | 1;
      dateIsoOverride?: string;
      walkKeyOverride?: string;
      excludedOverride?: string[];
      pinnedOverride?: string[];
      commitmentsOverride?: Commitments;
    } = {},
  ) {
    if (navigationSuspendedRef.current) return;
    lastRequestedAnchorRef.current = anchor;
    // An explicit choice already carries the current preferences. An older
    // debounce must not replace it with its previous place-selection closure.
    if (!silent && recomposeTimerRef.current) {
      clearTimeout(recomposeTimerRef.current);
      recomposeTimerRef.current = null;
    }
    if (!silent && pollTimerRef.current) {
      clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    activeRequestRef.current?.abort();
    // The day on screen keeps its Live state until a new day replaces it.
    abortLiveCompletion();
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
      entries: commitmentsOverride ?? commitments,
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
      resetBlitz();
      setStopEditError(null);
      liveQueryAbortRef.current?.abort();
      liveQueryAbortRef.current = null;
      setUpgradePending(false);
      setPhase("loading");
      setDayIsStale(retention.keepPrevious);
      // The last account described the day this request is replacing; it is
      // not true of whatever comes back.
      setDayChange(null);
      if (!retention.keepPrevious) {
        setClassification(null);
        setSafeResponse(null);
        displayedAnchorKeyRef.current = null;
      }
      setServiceRefusal(null);
      setExpandedStopKey(null);
      setExpandedCandidateKey(null);
      liveNearMeCoordsRef.current = null;
      setLiveSheetScope("around_place");
      setLiveQueryEvents(null);
      setLiveQueryPending(false);
      setLiveQueryError(null);
      setLiveQueryGeoHint(null);
    }
    let requestedLiveKeep: string | null = null;
    const refuseLivePlan = () => {
      setStopEditError("live_not_preserved");
      setStopEditFeedback(null);
      const baseline = undoBaselineRef.current;
      undoBaselineRef.current = null;
      if (retention.keepPrevious && baseline) {
        setDayChange({ previous: baseline.entry, summary: describeDayChange(baseline.entry, baseline.entry) });
        setDayIsStale(true);
      }
      setUpgradePending(false);
      setLiveFollowing(false);
      setPhase("done");
    };
    try {
      const effectiveWalkKey = walkKeyOverride ?? walkKey;
      const effectiveDayOffset = dayOffsetOverride ?? dayOffset;
      const effectiveDateIso = freezeComposeDateIso({
        dayOffset: effectiveDayOffset,
        // The occurrence was chosen for the displayed absolute day. Crossing
        // midnight before debounce cannot silently turn it into another day.
        dateIsoOverride: dateIsoOverride ?? livePlanPendingRef.current?.slice(5, 15),
      });
      lastComposeDateIsoRef.current = effectiveDateIso;
      const effectivePriority = normalizePreferencePriority(preferencePriorityOverride ?? preferencePriority, preferencesOverride ?? selected);
      const editScope = dayEditScopeRef.current;
      const effectiveDayEdit = dayEditOverride !== undefined ? normalizeDayEdit(dayEditOverride)
        : editScope?.anchorKey === nextAnchorKey && editScope.dateIso === effectiveDateIso ? normalizeDayEdit(dayEdit) : null;
      const activeLedger = scopeLiveChoices(scopedLedger.entries, effectiveDateIso);
      requestedLiveKeep = activeLedger.liveEventChoices.find(choice => choice.action === "keep")?.occurrence_id ?? null;
      // An explicit retry still replaces the same on-screen answer. Preserve
      // its exact Undo baseline just as the debounced initial choice does.
      if (requestedLiveKeep && !silent && retention.keepPrevious && !undoBaselineRef.current && isUndoableDay(lastEntryRef.current)) {
        undoBaselineRef.current = { entry: lastEntryRef.current!, anchorKey: displayedAnchorKeyRef.current };
      }
      const rhythm = DAY_RHYTHMS.find((p: { key: string }) => p.key === effectiveWalkKey) ?? DAY_RHYTHMS[1];
      // Frozen here, beside the request that carries them: whatever the ledger
      // does while this is in flight, THIS is what the answer will have
      // answered. Labels travel with the ids so the verdict can name a place
      // the user has since released.
      const sentPinIds = pinnedOverride ?? activeLedger.pinnedIds;
      const sentPins = sentPinIds.map((id: string) => ({
        id,
        kind: "pin" as const,
        label: String(activeLedger.entries[id]?.label ?? commitments[id]?.label ?? ""),
      }));
      const payload = buildAnywherePayload({
        place: anchor.place,
        coords: anchor.coords ?? null,
        placeSelection: anchor.placeSelection,
        placeRef: anchor.placeRef,
        placeBias: anchor.placeBias,
        placeContextSelection: anchor.placeContextSelection,
        dates: [effectiveDateIso],
        preferences: preferencesOverride ?? selected,
        preferencePriority: effectivePriority,
        dayEdit: effectiveDayEdit,
        dayRhythm: rhythm.key,
        excludedCandidateIds: [...new Set([
          ...(excludedOverride ?? activeLedger.excludedIds),
          ...(effectiveDayEdit ? [effectiveDayEdit.candidate_id, ...effectiveDayEdit.removed_candidate_ids] : []),
        ])].filter(id => !id.startsWith("live:")),
        pinnedCandidateIds: sentPinIds.filter(id => !id.startsWith("live:")),
        liveEventChoices: activeLedger.liveEventChoices,
      });
      const { response, body: rawBody } = await fetchPlannerLifecycle(`/api/route-recommendations?lang=${langOverride ?? lang}&${LIVE_COMPLETION_QUERY}`, {
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
      // The Live completion capability is a bearer token: it leaves the
      // response here, before anything can store, share or render it.
      let { body, capability: liveCapability } = takeLiveCompletion(rawBody);
      const refusal = composeServiceRefusal(response.status, body);
      if (refusal) {
        if (requestedLiveKeep) {
          setServiceRefusal(refusal);
          refuseLivePlan();
          return;
        }
        // A refused manual attempt has not replaced the published day. Keep
        // that answer, mark it stale, and retain its Undo baseline for either
        // immediate Undo or a later explicit retry. Ordinary refusals below
        // keep their existing no-day policy.
        if (effectiveDayEdit && retention.keepPrevious) {
          const baseline = undoBaselineRef.current;
          if (baseline) setDayChange({ previous: baseline.entry, summary: describeDayChange(baseline.entry, baseline.entry) });
          setStopEditError("not_confirmed");
          setStopEditFeedback(null);
          setServiceRefusal(refusal);
          setDayIsStale(true);
          setUpgradePending(false);
          setLiveFollowing(false);
          setPhase("error");
          return;
        }
        undoBaselineRef.current = null;
        setDayChange(null);
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
      if (requestedLiveKeep && body?.live_events?.pending === true && liveCapability?.routeUpgrade === "explicit_request") {
        // A cold explicit choice is still the original request. Hold the old
        // answer until its own bounded producer can publish that exact choice;
        // never install a preliminary day or start another acquisition.
        setLiveFollowing(true);
        const completion = await followLiveCompletion({ capability: liveCapability, signal: controller.signal });
        if (controller.signal.aborted || requestId !== requestSequenceRef.current || intentId !== intentSequenceRef.current) return;
        setLiveFollowing(false);
        if (completion.upgrade?.kind !== "applied") {
          refuseLivePlan();
          return;
        }
        body = takeLiveCompletion(completion.upgrade.result).body;
        // This capability was already consumed in the active execution. The
        // installed result must not start a second background completion run.
        liveCapability = null;
      }
      const decision = anywhereDecision();
      // With a coords anchor there is no typed text and no label to fall back
      // on: the engine's resolved label wins when present, and otherwise the
      // page names the position itself, in the language it is showing now
      // ("A day near you"). A label baked in here would keep the language of
      // the render that sent the request.
      const fallbackLabel = anchor.place ?? "";
      const requestLang = langOverride ?? lang;
      const cls = decision.classifyAnywhereResult(body, { place: fallbackLabel });
      const safe = decision.safeResponseFor(body, cls);
      if (requestedLiveKeep && (!decision.isComposedStatus(cls.status) || safe?.days?.[0]?.date !== effectiveDateIso ||
          !primaryRouteStops(safe).some((stop: any) => stop.is_live_event === true &&
            stop.live_choice_eligible === true && stop.live_occurrence_id === requestedLiveKeep))) {
        refuseLivePlan();
        return;
      }
      if (effectiveDayEdit && body?.agnostic_route_output_experiment?.day_edit?.status !== "applied") {
        setStopEditError(body?.agnostic_route_output_experiment?.day_edit?.reason === "no_safe_replacement"
          ? "no_safe_replacement" : "not_confirmed");
        const baseline = undoBaselineRef.current;
        undoBaselineRef.current = null;
        if (retention.keepPrevious && baseline) {
          setDayChange({ previous: baseline.entry, summary: describeDayChange(baseline.entry, baseline.entry) });
          setDayIsStale(true);
        } else {
          setClassification({ status: "unavailable", hasStructure: false, placeLabel: fallbackLabel });
          setSafeResponse({ ...safe, days: [] });
          displayedAnchorKeyRef.current = null;
        }
        setPhase("done");
        return;
      }
      let authoritativePlace = anchor.place;
      const resolution = body?.agnostic_route_output_experiment?.intake?.resolved;
      if (!anchor.coords && typeof resolution?.selection_id === "string") {
        const requestedRef = validPlaceRef(anchor.placeRef);
        const resolvedRef = validPlaceRef(resolution.place_ref);
        anchor = {
          ...anchor,
          place: anchor.place || (typeof resolution.label === "string" ? resolution.label : undefined),
          placeSelection: resolution.selection_id,
          selectionLabel: resolution.label || anchor.selectionLabel,
          placeRef: validPlaceRef(resolution.place_ref) ?? anchor.placeRef,
        };
        authoritativePlace = anchor.place;
        lastRequestedAnchorRef.current = anchor;
        if (anchor.place) setPlace(anchor.place);
        setPlaceSelection(anchor.placeSelection ?? null);
        setSelectionLabel(anchor.selectionLabel);
        setPlaceRef(anchor.placeRef ?? null);
        // This current response attests the query's canonical anchor. Move the
        // ledger with it so later adjustments do not mistake a qualified label
        // for different geography. A conflicting durable identity never moves
        // choices, and stale responses were rejected before this boundary.
        if (scopedLedger.applies && commitmentAnchorKeyRef.current === nextAnchorKey &&
            (!requestedRef || requestedRef === resolvedRef)) {
          commitmentAnchorKeyRef.current = anchorKey(anchor);
        }
      }
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
      const acceptedEditedEmpty = cls.status === "edited_empty";
      // Persist the applied selection, never a one-shot replacement command.
      // Reload asks to retain this result instead of replacing the slot again.
      let persistedDayEdit = effectiveDayEdit;
      if (effectiveDayEdit && (composedNow || acceptedEditedEmpty) && body?.agnostic_route_output_experiment?.day_edit?.status === "applied") {
        const publishedIds = primaryRouteStops(safe)
          .map((stop: any) => String(stop?.id ?? stop?.place_id ?? stop?.candidate_id ?? ""));
        persistedDayEdit = normalizeDayEdit({ ...effectiveDayEdit, action: "remove",
          retained_candidate_ids: publishedIds, target_stop_count: publishedIds.length, replacement_preference: null });
        dayEditScopeRef.current = { anchorKey: anchorKey(anchor), dateIso: effectiveDateIso };
        if (JSON.stringify(persistedDayEdit) !== JSON.stringify(dayEdit)) {
          adoptedInputsRef.current = true;
          setDayEdit(persistedDayEdit);
        }
        if (pendingStopEditRef.current) setStopEditFeedback(pendingStopEditRef.current.action);
      }
      const refusalsNow: Array<{ id: string; reason: string | null }> = composedNow ? [
        ...(Array.isArray(body?.agnostic_route_output_experiment?.pinned_candidates?.unhonored) ? body.agnostic_route_output_experiment.pinned_candidates.unhonored : []),
        ...(Array.isArray(body?.agnostic_route_output_experiment?.live_event_choices?.unhonored) ? body.agnostic_route_output_experiment.live_event_choices.unhonored : []),
      ] : [];
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
          city: null,
          place: authoritativePlace,
          placeLabel: anchor.selectionLabel,
          label: anchor.selectionLabel || authoritativePlace || (requestLang === "en" ? "My position" : "Min position"),
          dateIso: effectiveDateIso,
          savedAt: new Date().toISOString(),
          safeResponse: safe,
          classification: cls,
          // The mode is the anchor's, not this render's: an arrival composes
          // from the first render, before the near-me mode it set has landed.
          inputs: { city: null, place: authoritativePlace ?? null, placeSelection: anchor.placeSelection, placeRef: anchor.placeRef ?? null, placeLabel: anchor.selectionLabel, mode: anchor.coords ? "near_me" : "typed", dayOffset: effectiveDayOffset, walkKey: effectiveWalkKey, selected: prefs, preferencePriority: effectivePriority, dayEdit: persistedDayEdit, liveSheetSort },
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
              city: null,
              place: anchor.place ?? null,
              placeLabel: anchor.selectionLabel,
              dateIso: effectiveDateIso,
              selected: prefs,
              walkKey: effectiveWalkKey,
              preferencePriority: effectivePriority,
              dayEdit: persistedDayEdit,
            }),
            entries: activeLedger.entries,
            appliedPins: decision.isComposedStatus(cls.status) ? sentPins : [],
            refusals: refusalsNow,
          }),
        });
        lastEntryRef.current = entry;
        // Only a day may replace the remembered day: a place that could not be
        // resolved or composed must not take over "Continue" on the landing.
        if (composedNow || acceptedEditedEmpty) writeLS(LAST_KEY, entry);
        if (!silent) setRestoredAt(null);
        if (!silent) {
          // Only an adjustment leaves a baseline behind, and only for the place
          // it was made in: an arrival, a rebuild or a new place has nothing to
          // undo back to.
          const baseline = undoBaselineRef.current;
          undoBaselineRef.current = null;
          setDayChange(
            baseline && baseline.anchorKey !== null && baseline.anchorKey === anchorKey(anchor)
              ? { previous: baseline.entry, summary: describeDayChange(baseline.entry, entry) }
              : null,
          );
        } else {
          // A silent follow-up refines the same inputs' day; the account keeps
          // describing the day actually on screen.
          setDayChange((current) =>
            current ? { previous: current.previous, summary: describeDayChange(current.previous, entry) } : current,
          );
        }
      }
      // Pending Live is read through the original compose's own capability,
      // never by recomposing the route.
      if (liveCapability && safe) startLiveCompletion(liveCapability, requestId, intentId, safe);
      else setLiveFollowing(false);
      // A bounded silent re-ask covers cold-start honesty gaps. The POLICY —
      // which composes re-ask, and with what delay — is the pure, unit-tested
      // planComposeFollowup; this block only owns the timer and state.
      const followup = planComposeFollowup({
        supplyLifecycleComplete: true,
        composed: cls.status === "composed",
        structureOnly: cls.status === "structure_only",
        hasStructure: Boolean(safe?.place_structure),
        transientSourceRetry: decision.shouldRetryTransientSource(body, cls),
        silent,
      });
      if (followup.schedule) {
        if (followup.upgradePending) setUpgradePending(true);
        if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
        const effectivePreferences = preferencesOverride ?? selected;
        const effectiveExcluded = excludedOverride ?? activeLedger.excludedIds;
        const effectivePinned = pinnedOverride ?? activeLedger.pinnedIds;
        const followupIntentId = intentSequenceRef.current;
        pollTimerRef.current = setTimeout(() => {
          pollTimerRef.current = null;
          if (followupIntentId !== intentSequenceRef.current) return;
          execute(anchor, {
            silent: true,
            langOverride: langOverride ?? lang,
            preferencesOverride: effectivePreferences,
            preferencePriorityOverride: effectivePriority,
            dayEditOverride: persistedDayEdit,
            dayOffsetOverride: effectiveDayOffset,
            dateIsoOverride: effectiveDateIso,
            walkKeyOverride: effectiveWalkKey,
            excludedOverride: effectiveExcluded,
            pinnedOverride: effectivePinned,
          }).catch(() => {});
        }, followup.delayMs ?? 0);
      }
    } catch {
      if (
        controller.signal.aborted ||
        requestId !== requestSequenceRef.current ||
        intentId !== intentSequenceRef.current
      ) return;
      setLiveFollowing(false);
      if (requestedLiveKeep) {
        refuseLivePlan();
        return;
      }
      if (silent) {
        setUpgradePending(false);
      } else {
        setPhase("error");
      }
    } finally {
      if (activeRequestRef.current === controller) {
        activeRequestRef.current = null;
        activeLifecycleCancelRef.current = null;
        setSupplyPending(false);
        setStopEditPending(false);
        pendingStopEditRef.current = null;
        livePlanPendingRef.current = null;
        setLivePlanPending(false);
      }
    }
  }

  function abortLiveCompletion() {
    liveCompletionAbortRef.current?.abort();
    liveCompletionAbortRef.current = null;
  }

  // For a day installed without a compose (restore, undo): nothing follows it.
  function stopLiveCompletion() {
    abortLiveCompletion();
    setLiveFollowing(false);
  }

  // Follow the day's own Live completion capability. Its terminal Live result
  // updates only the day it belongs to; an upgraded day, when the server
  // authorized and applied one, replaces that day only while its generation is
  // still the current one and it is still the day on screen. The route is
  // never recomposed here.
  function startLiveCompletion(capability: LiveCompletionCapability, requestId: number, intentId: number, installed: any) {
    abortLiveCompletion();
    const controller = new AbortController();
    liveCompletionAbortRef.current = controller;
    setLiveFollowing(true);
    // The remembered entry for this day, while it is still the remembered one.
    let entry = installed?.days?.length > 0 && lastEntryRef.current?.safeResponse === installed
      ? lastEntryRef.current : null;
    const current = () =>
      !controller.signal.aborted &&
      requestId === requestSequenceRef.current &&
      intentId === intentSequenceRef.current &&
      liveResponseRef.current === installed;
    followLiveCompletion({
      capability,
      signal: controller.signal,
      onLiveEvents: (liveEvents) => {
        if (!current()) return;
        setCompletedLive({ day: installed, liveEvents });
        if (entry && lastEntryRef.current === entry) {
          entry = { ...entry, safeResponse: { ...installed, live_events: liveEvents } };
          lastEntryRef.current = entry;
          writeLS(LAST_KEY, entry);
        }
      },
    })
      .then((outcome) => {
        if (liveCompletionAbortRef.current === controller) liveCompletionAbortRef.current = null;
        if (!current()) return;
        setLiveFollowing(false);
        if (outcome.upgrade?.kind === "applied" && entry && lastEntryRef.current === entry) {
          installLiveUpgrade(outcome.upgrade.result, entry);
        }
      })
      .catch(() => {});
  }

  // Called only while the run's generation is current: every adjustment,
  // commitment, restore, undo and compose bumps the generation first, so a
  // newer question always wins over this answer.
  function installLiveUpgrade(result: any, previous: SavedEntry) {
    const decision = anywhereDecision();
    const cls = decision.classifyAnywhereResult(result, { place: previous.place ?? "" });
    if (!decision.isComposedStatus(cls.status)) return;
    const safe = decision.safeResponseFor(result, cls);
    const ledger = readCommitmentSnapshot(previous.commitments, { anchorKey: displayedAnchorKeyRef.current, dayKey: previous.id });
    const choices = scopeLiveChoices(ledger.applies ? ledger.entries : {}, previous.dateIso ?? "").liveEventChoices;
    if (choices.some(choice => choice.action === "keep" && !primaryRouteStops(safe).some((stop: any) =>
      stop.is_live_event === true && stop.live_choice_eligible === true && stop.live_occurrence_id === choice.occurrence_id))) return;
    // Same question, same identity: only the day that answers it changed.
    const upgraded: SavedEntry = { ...previous, savedAt: new Date().toISOString(), safeResponse: safe, classification: cls };
    lastEntryRef.current = upgraded;
    writeLS(LAST_KEY, upgraded);
    liveResponseRef.current = safe;
    liveSheetUpgradeResponseRef.current = safe;
    setClassification(cls);
    setSafeResponse(safe);
    const unhonored = result?.agnostic_route_output_experiment?.pinned_candidates?.unhonored;
    setAppliedRefusals([...(Array.isArray(unhonored) ? unhonored : []), ...(Array.isArray(result?.agnostic_route_output_experiment?.live_event_choices?.unhonored) ? result.agnostic_route_output_experiment.live_event_choices.unhonored : [])]);
    setExpandedStopKey(null);
    setExpandedCandidateKey(null);
    // Never silent: the change line says Live moved the day, and Undo puts the
    // original day back.
    setDayChange({ previous, summary: describeDayChange(previous, upgraded, { cause: "live" }) });
  }

  const cancelActivePlannerForNavigation = () => {
    livePlanPendingRef.current = null;
    setLivePlanPending(false);
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
    abortLiveCompletion();
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
  function restoreEntry(entry: SavedEntry, restoreViewFromStorage = false) {
    livePlanPendingRef.current = null;
    setLivePlanPending(false);
    resetBlitz();
    setNavigationInterrupted(false);
    pendingStopEditRef.current = null;
    setStopEditPending(false);
    setStopEditFeedback(null);
    setStopEditError(null);
    // A saved day is its own generation: nothing from before it can be undone
    // back onto it.
    undoBaselineRef.current = null;
    setDayChange(null);
    const i = entry.inputs;
    const restoredEdit = normalizeDayEdit(i?.dayEdit);
    setPreferencePriority(normalizePreferencePriority(i?.preferencePriority, i?.selected));
    setDayEdit(restoredEdit);
    // Only the saved request can authorize a snapshot update. In particular,
    // near-me entries do not persist exact coordinates: never replace those
    // with the current GPS position or a reverse-geocoded city label.
    const savedDate = entry.dateIso;
    const dateTime = typeof savedDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(savedDate)
      ? Date.parse(`${savedDate}T00:00:00Z`) : NaN;
    const safeDate = Number.isFinite(dateTime) && new Date(dateTime).toISOString().slice(0, 10) === savedDate;
    const savedRef = validPlaceRef(i?.placeRef);
    const safeTypedAnchor = i?.mode === "typed" && (i.place?.trim() || savedRef)
      && (!i.placeRef || savedRef) && Array.isArray(i.selected) && typeof i.walkKey === "string";
    lastRequestedAnchorRef.current = safeDate && safeTypedAnchor ? {
      place: i?.place ?? undefined,
      placeSelection: i?.placeSelection,
      placeRef: savedRef,
      selectionLabel: i?.placeLabel ?? undefined,
    } : null;
    lastComposeDateIsoRef.current = lastRequestedAnchorRef.current ? savedDate : null;
    if (i) {
      if (typeof i.place === "string") setPlace(i.place);
      setPlaceSelection(i.placeSelection ?? null);
      setPlaceRef(validPlaceRef(i.placeRef));
      setSelectionLabel(i.placeLabel ?? undefined);
      if (i.mode === "typed" || i.mode === "near_me") setMode(i.mode);
      if (i.dayOffset === 0 || i.dayOffset === 1) setDayOffset(i.dayOffset);
      if (typeof i.walkKey === "string") setWalkKey(normalizeSavedWalkKey(i.walkKey));
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
    stopLiveCompletion();
    // Bumping the sequence invalidates any response already past its abort
    // check but not yet applied.
    requestSequenceRef.current += 1;
    intentSequenceRef.current += 1;
    setUpgradePending(false);

    lastEntryRef.current = entry;
    const storedSort = restoreViewFromStorage ? readLS<{ sort?: string }>("parranda:live:sort", {}).sort : entry.inputs?.liveSheetSort;
    setLiveSheetSort(storedSort === "by_time" ? "by_time" : "for_you");
    setClassification(entry.classification);
    setSafeResponse(entry.safeResponse);
    setAppliedPins([]);
    // A restored snapshot owns the screen outright; it is labelled by
    // restoredAt, never by the recompose "updating" state.
    const restoredAnchorKey = savedEntryAnchorKey(entry);
    dayEditScopeRef.current = restoredEdit ? { anchorKey: restoredAnchorKey, dateIso: entry.dateIso } : null;
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
    setChoicesNotCarried(!restoredCommitments.applies && hasStoredChoices(entry));
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
    setPositionNeeded(false);
    setPhase("done");
    setRestoredAt(entry.savedAt);
  }

  // UNDO: put back the day the last adjustment replaced, with the inputs and the
  // commitment ledger it was composed under, WITHOUT composing. Recomposing
  // would ask the question again and could answer it differently (warmer
  // caches, newer Live rows); the user asked for the day they had. That day is
  // the same session's live result from moments ago, not a saved snapshot, so
  // it is not labelled as one and adjusting it keeps recomposing as usual.
  function undoDayChange() {
    const change = dayChange;
    if (!change) return;
    livePlanPendingRef.current = null;
    setLivePlanPending(false);
    resetBlitz();
    const previous = change.previous;
    setDayChange(null);
    undoBaselineRef.current = null;
    setNavigationInterrupted(false);
    // Everything newer stops first, exactly as for a restored day: no
    // debounce, follow-up or response in flight may land on top of it.
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
    stopLiveCompletion();
    requestSequenceRef.current += 1;
    intentSequenceRef.current += 1;
    setUpgradePending(false);
    setSupplyPending(false);

    const inputs = previous.inputs ?? {};
    const nextSelected = Array.isArray(inputs.selected) ? inputs.selected : selected;
    const nextDayOffset: 0 | 1 = inputs.dayOffset === 0 || inputs.dayOffset === 1 ? inputs.dayOffset : dayOffset;
    const nextWalkKey = typeof inputs.walkKey === "string" ? inputs.walkKey : walkKey;
    const nextPriority = normalizePreferencePriority(inputs.preferencePriority, nextSelected);
    const nextEdit = normalizeDayEdit(inputs.dayEdit);
    lastComposeDateIsoRef.current = previous.dateIso;
    // The ledger the previous day answered, from its own frozen record. Undo is
    // only offered for the anchor on screen, so that record belongs here.
    const dayAnchorKey = displayedAnchorKeyRef.current;
    const ledger = readCommitmentSnapshot(previous.commitments, { anchorKey: dayAnchorKey, dayKey: previous.id });
    const nextCommitments = ledger.applies ? { ...ledger.entries } : {};
    undoEchoRef.current = adjustmentSignature(nextSelected, nextDayOffset, nextWalkKey, nextCommitments, nextPriority, nextEdit);
    setSelected(nextSelected);
    setPreferencePriority(nextPriority);
    setDayEdit(nextEdit);
    dayEditScopeRef.current = nextEdit ? { anchorKey: dayAnchorKey, dateIso: previous.dateIso } : null;
    pendingStopEditRef.current = null;
    setStopEditPending(false);
    setStopEditFeedback(null);
    setStopEditError(null);
    setDayOffset(nextDayOffset);
    setWalkKey(nextWalkKey);
    setLiveSheetSort(inputs.liveSheetSort === "by_time" ? "by_time" : "for_you");
    commitmentAnchorKeyRef.current = ledger.applies ? dayAnchorKey : null;
    setCommitments(nextCommitments);
    setAppliedPins(ledger.applies ? ledger.appliedPins : []);
    setAppliedRefusals(ledger.applies ? ledger.refusals : []);

    lastEntryRef.current = previous;
    writeLS(LAST_KEY, previous);
    setClassification(previous.classification);
    setSafeResponse(previous.safeResponse);
    setDayIsStale(false);
    setServiceRefusal(null);
    setExpandedStopKey(null);
    setExpandedCandidateKey(null);
    setPhase("done");
  }

  // Arriving with ?place= (e.g. from the landing search) composes the day
  // IMMEDIATELY — the user typed a city and expects a day, not a second form.
  // Otherwise, restore the last day so a reload doesn't lose it.
  const autoPlannedRef = useRef(false);
  const positionReloadEntryRef = useRef<SavedEntry | null>(null);
  useEffect(() => {
    if (autoPlannedRef.current) return;
    autoPlannedRef.current = true;
    setArrivalRead(true);
    setSavedDays(readLS<SavedEntry[]>(SAVED_KEY, []));
    // A shared link carries the WHOLE day's inputs (place + prefs + day + length),
    // so it auto-plans exactly what the sharer saw — composed fresh for the opener.
    const allowedPrefs = ANYWHERE_PREFERENCES.map((p: { key: string }) => p.key);
    const shared = decodeShareParams(window.location.search, allowedPrefs);
    const entry = plannerEntry.readPlannerEntry(window.location.search);
    // A malformed identity must never turn into a namesake search or a saved day.
    if (shared.invalidPlaceRef) {
      setInvalidPlaceLink(true);
      return;
    }
    if (shared.invalidDayEdit) {
      setInvalidDayEditLink(true);
      return;
    }
    // Field presence is anchor intent even when coordinate parsing fails.
    // Never discard a durable identity in favour of caller-supplied geography.
    const params = new URLSearchParams(window.location.search);
    if (shared.placeRef && (params.has("lat") || params.has("lng") || entry.near)) {
      setConflictingPlaceLink(true);
      return;
    }
    // Only values that differ are set (the same picks in a new array are not a
    // change), and only then is the re-run they cause marked as the arrival's.
    const adoptLinkInputs = () => {
      let changed = false;
      if (shared.preferences.length && shared.preferences.join(",") !== selected.join(",")) {
        setSelected(shared.preferences);
        changed = true;
      }
      const linkedPriority = normalizePreferencePriority(shared.preferencePriority, shared.preferences.length ? shared.preferences : selected);
      if (linkedPriority.join(",") !== preferencePriority.join(",")) {
        setPreferencePriority(linkedPriority);
        changed = true;
      }
      const linkedEdit = normalizeDayEdit(shared.dayEdit);
      if (JSON.stringify(linkedEdit) !== JSON.stringify(dayEdit)) {
        setDayEdit(linkedEdit);
        changed = true;
      }
      if (shared.dayOffset !== dayOffset) {
        setDayOffset(shared.dayOffset);
        changed = true;
      }
      if (shared.walkKey !== walkKey) {
        setWalkKey(shared.walkKey);
        changed = true;
      }
      if (changed) adoptedInputsRef.current = true;
    };
    // URL entry composes fresh. Only an actual reload of the same absolute
    // day/question may recover choices from LAST; it never installs old facts
    // or old pin verdicts as this new response's evidence.
    const urlArrivalInputs = (anchor: Parameters<typeof execute>[0]) => {
      const dateIso = freezeComposeDateIso({ dayOffset: shared.dayOffset });
      const preferences = shared.preferences.length ? shared.preferences : selected;
      const linkedPriority = normalizePreferencePriority(shared.preferencePriority, preferences);
      const linkedEdit = normalizeDayEdit(shared.dayEdit);
      dayEditScopeRef.current = linkedEdit ? { anchorKey: anchorKey(anchor), dateIso } : null;
      const navigation = window.performance?.getEntriesByType?.("navigation")[0] as PerformanceNavigationTiming | undefined;
      const saved = readLS<SavedEntry | null>(LAST_KEY, null);
      const recovered = urlEntryCommitments(saved, {
        navigationType: navigation?.type, anchor, dateIso, selected: preferences, walkKey: shared.walkKey,
        preferencePriority: linkedPriority, dayEdit: linkedEdit,
      });
      setChoicesNotCarried(navigation?.type === "reload" && !recovered.applies && hasStoredChoices(saved));
      if (recovered.applies) {
        commitmentAnchorKeyRef.current = anchorKey(anchor);
        setCommitments(recovered.entries);
        adoptedInputsRef.current = true;
      }
      return {
        langOverride: shared.lang ?? undefined,
        preferencesOverride: preferences,
        preferencePriorityOverride: linkedPriority,
        dayEditOverride: linkedEdit,
        dayOffsetOverride: shared.dayOffset,
        dateIsoOverride: dateIso,
        walkKeyOverride: shared.walkKey,
        ...(recovered.applies ? { commitmentsOverride: recovered.entries } : {}),
      };
    };
    if (entry.coords) {
      setMode("near_me");
      adoptLinkInputs();
      const anchor = { coords: entry.coords };
      execute(anchor, urlArrivalInputs(anchor)).catch(() => {});
      return;
    }
    if (entry.place || shared.placeRef) {
      shared.place = entry.place || "";
      setPlace(shared.place);
      setPlaceRef(shared.placeRef);
      adoptLinkInputs();
      const anchor = { place: shared.place, placeRef: shared.placeRef, ...consumePlaceChoice(shared.place) };
      execute(anchor, urlArrivalInputs(anchor)).catch(() => {});
      return;
    }
    // The landing (or a language switch) chose a LOCATION anchor: coordinates
    // were handed off via sessionStorage (never the URL). The permission was
    // already granted, so compose directly around the coords — never re-prompt
    // on arrival. The rest of the day's inputs, and the language, come from the
    // URL like any other day: this render still speaks the build's default
    // language, so the request must not take it from here.
    if (new URLSearchParams(window.location.search).get("anchor") === "near") {
      setMode("near_me");
      adoptLinkInputs();
      const coords = consumeAnchorCoords();
      if (coords) execute({ coords }, urlArrivalInputs({ coords })).catch(() => {});
      else {
        const navigation = window.performance?.getEntriesByType?.("navigation")[0] as PerformanceNavigationTiming | undefined;
        positionReloadEntryRef.current = navigation?.type === "reload" ? readLS<SavedEntry | null>(LAST_KEY, null) : null;
      }
      // Stored coords missing/expired (e.g. a reload consumed them): stay honest,
      // and offer to share the position again (useLocationAgain).
      return;
    }
    const last = readLS<SavedEntry | null>(LAST_KEY, null);
    if (last && last.safeResponse && last.classification) restoreEntry(last, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function saveDay() {
    const entry = lastEntryRef.current;
    if (!entry) return;
    const stamped = { ...entry, inputs: { ...entry.inputs, liveSheetSort }, savedAt: new Date().toISOString() };
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
    const sharedPlace = shareablePlace(i);
    if (!i || !sharedPlace) return;
    const url = buildShareUrl(window.location.origin, {
      place: sharedPlace,
      placeRef: i.placeRef ?? null,
      city: null,
      preferences: Array.isArray(i.selected) ? i.selected : [],
      preferencePriority: i.preferencePriority,
      dayEdit: i.dayEdit,
      invalidDayEdit: i.invalidDayEdit,
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
  const canShare = Boolean(shareablePlace(lastEntryRef.current?.inputs));

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
    if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    if (mode === "near_me") {
      // The position was chosen once, explicitly — on the landing or with "Use
      // my location" — and adjustments or a rebuild reuse it. The browser is
      // asked again only from that explicit tap (useLocationAgain), never in
      // the background, where it could raise a prompt nobody asked for and a
      // refusal would take the day with it.
      const coords = lastRequestedAnchorRef.current?.coords ?? routeAnchorCoords;
      if (coords) await execute({ coords }, opts);
      else setPositionNeeded(true);
      return;
    }
    const trimmed = place.trim();
    if (!trimmed && !placeRef) return;
    await execute({ place: trimmed, placeSelection, selectionLabel, placeRef }, opts);
  }

  async function plan(event?: { preventDefault?: () => void }) {
    event?.preventDefault?.();
    await resolveAndRun();
  }

  // Blitz is one trusted next move beside the day. It reads the current anchor
  // and preferences but never mutates them, re-composes the route, or changes
  // stop order. Near-me coordinates remain memory-only.
  async function blitz(position?: { lat: number; lng: number }) {
    const typedAnchor = mode === "typed" ? place.trim() : "";
    const nearMeAnchor = mode === "near_me" ? position ?? routeAnchorCoords : null;
    if (!nearMeAnchor && !typedAnchor) {
      setBlitzPhase(mode === "near_me" ? "position_needed" : "error");
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
        : { place: typedAnchor, ...(placeSelection ? { place_selection: placeSelection } : {}), ...(placeRef ? { place_ref: placeRef } : {}) };
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

  async function sharePositionForBlitz() {
    if (blitzPhase === "locating") return;
    const sequence = ++blitzRequestSequenceRef.current;
    const intent = intentSequenceRef.current;
    const current = () => !navigationSuspendedRef.current && sequence === blitzRequestSequenceRef.current && intent === intentSequenceRef.current;
    setBlitzPhase("locating");
    setBlitzPositionFailed(false);
    try {
      const coords = await requestPosition();
      if (current()) await blitz(coords);
    } catch {
      if (current()) {
        setBlitzPhase("position_needed");
        setBlitzPositionFailed(true);
      }
    }
  }

  // An ANCHOR exists once the landing handed one over (typed place or the
  // position it captured). Everything after that is adjustment.
  const hasAnchor = mode === "near_me" || Boolean(place.trim() || placeRef);

  // The language links reopen the day as it is NOW, adjustments included,
  // through the same encoder a shared link uses. A position never enters the
  // URL: a near-me day is handed to the next page in storage instead
  // (leavePlanner), exactly as the landing handed it here. A near-me snapshot
  // with no position in memory keeps the default link, which restores it.
  const nearMeCoords = lastRequestedAnchorRef.current?.coords ?? routeAnchorCoords;
  const languageHref = hasAnchor && (mode !== "near_me" || nearMeCoords)
    ? (option: Lang) => {
        const query = new URLSearchParams(
          encodeShareParams(
            mode === "near_me"
              ? { preferences: selected, preferencePriority, dayEdit, dayOffset, walkKey, lang: option }
              : { place, placeRef, preferences: selected, preferencePriority, dayEdit, dayOffset, walkKey, lang: option },
          ),
        );
        if (mode === "near_me") query.set("anchor", "near");
        return `?${query.toString()}`;
      }
    : (option: Lang) => `?restore=last&lang=${option}`;

  // The address bar follows the day as it is now, through the same encoder, so
  // a reload or a copied address reopens the adjusted day rather than the
  // arrival's. A restored snapshot keeps its restore address: reloading it
  // shows the saved day again instead of composing a fresh one.
  const liveHref = hasAnchor && !restoredAt && (mode !== "near_me" || nearMeCoords) ? languageHref(lang) : null;
  useEffect(() => {
    if (!liveHref || window.location.search === liveHref) return;
    try {
      window.history.replaceState(window.history.state, "", `${window.location.pathname}${liveHref}${window.location.hash}`);
    } catch {
      // A document that may not rewrite its own address keeps the arrival's.
    }
  }, [liveHref]);

  const leavePlanner =(target: "home" | "language") => {
    if (mode === "typed" && placeSelection) storePlaceChoice({ place, selection: placeSelection, label: selectionLabel });
    if (target === "language" && mode === "near_me") {
      const coords = nearMeCoords;
      if (coords) storeAnchorCoords(coords);
    }
    cancelActivePlannerForNavigation();
  };

  async function narrowPlaceSearch() {
    if (placeRef || narrowingPlace) return;
    const generation = requestSequenceRef.current;
    const intent = intentSequenceRef.current;
    const stillCurrent = () => generation === requestSequenceRef.current
      && intent === intentSequenceRef.current && !navigationSuspendedRef.current;
    setNarrowingPlace(true);
    setNarrowingFailed(false);
    try {
      const coords = await requestPosition();
      if (!stillCurrent()) return;
      await execute({ place: place.trim(), placeBias: coords });
    } catch { if (stillCurrent()) setNarrowingFailed(true); }
    finally { setNarrowingPlace(false); }
  }

  // A near-me page without a position (a reload consumed it) asks again only on
  // an explicit tap, the same consent the landing asked for.
  async function useLocationAgain() {
    if (relocating) return;
    setRelocating(true);
    setRelocateDenied(false);
    const intent = intentSequenceRef.current;
    const current = () => !navigationSuspendedRef.current && intent === intentSequenceRef.current;
    let coords: { lat: number; lng: number };
    try {
      coords = await requestPosition();
    } catch {
      setRelocating(false);
      if (current()) setRelocateDenied(true);
      return;
    }
    setRelocating(false);
    if (!current()) return;
    setPositionNeeded(false);
    const entry = positionReloadEntryRef.current;
    positionReloadEntryRef.current = null;
    const dateIso = freezeComposeDateIso({ dayOffset });
    const linkedPriority = normalizePreferencePriority(preferencePriority, selected);
    const linkedEdit = normalizeDayEdit(dayEdit);
    const recovered = urlEntryCommitments(entry, {
      navigationType: "reload", anchor: { coords }, dateIso, selected, walkKey,
      preferencePriority: linkedPriority, dayEdit: linkedEdit,
    });
    const recoveredEdit = recovered.applies ? linkedEdit : null;
    dayEditScopeRef.current = recoveredEdit ? { anchorKey: anchorKey({ coords }), dateIso } : null;
    if (linkedEdit && !recovered.applies) {
      adoptedInputsRef.current = true;
      setDayEdit(null);
    }
    setChoicesNotCarried(!recovered.applies && hasStoredChoices(entry));
    if (recovered.applies) {
      commitmentAnchorKeyRef.current = anchorKey({ coords });
      setCommitments(recovered.entries);
      adoptedInputsRef.current = true;
    }
    execute({ coords }, {
      preferencePriorityOverride: linkedPriority, dayEditOverride: recoveredEdit, dateIsoOverride: dateIso,
      ...(recovered.applies ? { commitmentsOverride: recovered.entries } : {}),
    }).catch(() => {});
  }

  // AUTO-RECOMPOSE: adjustments never need a submit. A settled change (400 ms)
  // starts a latest-request-wins compose. Skipped before the first
  // compose and while showing a restored snapshot, so nothing fires unasked.
  useEffect(() => {
    // Undo put these exact inputs back together with the day that answered
    // them; composing them again is not an adjustment. Read once, whatever
    // happens next, so a stale echo can never swallow a later change.
    const undoEcho = undoEchoRef.current;
    undoEchoRef.current = null;
    if (skipFirstAdjustRef.current) {
      skipFirstAdjustRef.current = false;
      return;
    }
    if (adoptedInputsRef.current) {
      adoptedInputsRef.current = false;
      return;
    }
    if (undoEcho !== null && undoEcho === adjustmentSignature(selected, dayOffset, walkKey, commitments, preferencePriority, dayEdit)) return;
    if (navigationSuspendedRef.current || !hasAnchor || phase === "idle" || restoredAt) return;
    if (recomposeTimerRef.current) clearTimeout(recomposeTimerRef.current);
    recomposeTimerRef.current = setTimeout(() => {
      recomposeTimerRef.current = null;
      // The day this adjustment replaces is the one on screen as it leaves.
      // A request still in flight has not replaced it yet, so a quick second
      // change keeps the same day to return to.
      const onScreen = lastEntryRef.current;
      undoBaselineRef.current = isUndoableDay(onScreen)
        ? { entry: onScreen, anchorKey: displayedAnchorKeyRef.current }
        : null;
      resolveAndRun().catch(() => {});
    }, 400);
    return () => {
      if (recomposeTimerRef.current) clearTimeout(recomposeTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, preferencePriority, dayEdit, dayOffset, walkKey, commitments]);

  // The Live sheet behaves like a modal: focus enters it, stays inside while it
  // is open, returns to the trigger on close, and the page behind does not scroll.
  // The page behind is inert while it is open, so neither Tab nor a screen
  // reader's own navigation can reach what the sheet covers.
  useEffect(() => {
    if (!liveSheetOpen) {
      liveQueryAbortRef.current?.abort();
      return;
    }
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const restoreOutside = inertOutside(liveSheetDialogRef.current?.parentElement);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setLiveSheetOpen(false);
        return;
      }
      const dialog = liveSheetDialogRef.current;
      if (e.key !== "Tab" || !dialog) return;
      const focusable = tabbableWithin(dialog);
      if (!focusable.length) {
        e.preventDefault();
        dialog.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (!active || !dialog.contains(active)) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
      } else if (e.shiftKey && (active === first || active === dialog)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
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
      // The trigger sits in the page behind: make it reachable before focusing it.
      restoreOutside();
      if (focusDayAfterLiveChoiceRef.current) {
        focusDayAfterLiveChoiceRef.current = false;
        resultStatusRef.current?.focus();
      } else (liveSheetTriggerRef.current ?? previouslyFocused)?.focus();
    };
  }, [liveSheetOpen]);

  // A coordinate anchor describes the user's position, not the whole city.
  // A reverse city label does not attest a precise neighborhood. Keep the
  // authoritative label in the response; only project near-me UI as Near you.
  const primaryLocality = (value?: string | null) => String(value || "").split(",")[0].trim();
  const anchorLabel =
    mode === "near_me"
      ? t("Nära dig", "Near you")
      : primaryLocality(classification?.placeLabel) || typedPlaceLabel;
  const anchorIsPosition = mode === "near_me";
  const placeName = primaryLocality(classification?.placeLabel) || typedPlaceLabel || t("den här platsen", "this place");
  // A typed place with no trusted anchor (unresolved, ambiguous, or a resolver
  // that could not be reached): nothing downstream — Blitz included — has a
  // place to read, so the page says so instead of offering it.
  const intakeStatus = safeResponse?.agnostic_route_output_experiment?.intake?.status ?? null;
  const anchorUnresolved =
    mode === "typed" && classification?.status === "unavailable" && intakeStatus !== "resolved";
  const walkLabel = (() => {
    const preset = DAY_RHYTHMS.find((p: { key: string }) => p.key === walkKey);
    return preset ? (lang === "en" ? preset.en : preset.sv) : "";
  })();
  const explicitMoodPriority = normalizePreferencePriority(preferencePriority, selected);
  const moodRanks = new Map<string, number>(explicitMoodPriority.map((key, index) => [key, index]));
  const moodLabel = ANYWHERE_PREFERENCES.filter((p: { key: string }) => selected.includes(p.key))
    .sort((left, right) => (moodRanks.get(left.key) ?? moodRanks.size) - (moodRanks.get(right.key) ?? moodRanks.size))
    .map((p: { sv: string; en: string }, index: number) => {
      const label = lang === "en" ? p.en : p.sv;
      return explicitMoodPriority.length ? `${index + 1}. ${label}` : label;
    })
    .join(" · ");

  const structure: PlaceStructure | null = safeResponse?.place_structure ?? null;
  const day = structure?.district_day;
  const liveEvents: LiveEvents | null =
    (completedLive && completedLive.day === safeResponse ? completedLive.liveEvents : safeResponse?.live_events) ?? null;
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
    () =>
      liveEvents?.pending && !liveFollowing ? "unavailable" : pulseHealthState(liveEvents, pulseBuckets, split.woven),
    [liveEvents, pulseBuckets, split.woven, liveFollowing],
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
    () => pulseHealthState(sheetLiveEvents, sheetBuckets, split.woven),
    [sheetLiveEvents, sheetBuckets, split.woven],
  );
  const sheetFailure = useMemo(() => liveSourceFailure(sheetLiveEvents, sheetBuckets), [sheetLiveEvents, sheetBuckets]);
  const sheetSources = useMemo(() => pulseSourceLine(sheetLiveEvents), [sheetLiveEvents]);
  const sheetSourceHealth = sheetLiveEvents?.acquisition?.source_health ?? null;
  const routeScopeAvailable = boundedRoutePoints(routeStops).length >= 2;
  const aroundPlaceScopeAvailable = Boolean(
    buildLiveEventQueryPayload({ scope: "around_place", response: safeResponse }),
  );
  const inPlaceScopeAvailable = Boolean(buildLiveEventQueryPayload({ scope: "in_place", response: safeResponse }));

  // Prioritize actual listed future rows, without claiming a partial calendar
  // proves the selected day empty. Pending and hidden selected-day rows are
  // not evidence for changing the period. Reader choices retain ownership.
  const preferFollowingWeek = Boolean(
    sheetLiveEvents?.coverage === "covered" && !sheetLiveEvents.pending &&
    sheetLiveEvents.selected_date === liveEvents?.selected_date &&
    ["healthy", "partial"].includes(sheetSourceHealth?.status || "") &&
    !liveQueryPending && !liveQueryError && !dayIsStale && phase !== "loading" && split.woven.length === 0 &&
    sheetBuckets.tonight.length === 0 && sheetBrowseBuckets.tonight.length === 0 &&
    !sheetLiveEvents.browse?.tonight?.hidden_count &&
    (sheetBuckets.thisWeek.length > 0 || sheetBrowseBuckets.thisWeek.length > 0)
  );
  useEffect(() => {
    if (!liveSheetOpen || !liveSheetPeriodAutomaticRef.current ||
        liveSheetScope !== "around_place" || liveSheetTime !== "tonight" || !preferFollowingWeek) return;
    setLiveSheetTime("week");
    if (liveQueryEvents) requestLiveSheetScope("around_place", "week", true).catch(() => {});
  }, [liveSheetOpen, liveSheetScope, liveSheetTime, preferFollowingWeek, liveQueryEvents]);

  const liveFallback = useLiveFallback({
    enabled: liveSheetOpen && liveSheetScope === "around_place" && liveSheetTime === "tonight" &&
      !liveQueryPending && !liveQueryError && !dayIsStale && phase !== "loading" && split.woven.length === 0 &&
      !(liveSheetPeriodAutomaticRef.current && preferFollowingWeek),
    response: safeResponse, localEvents: sheetLiveEvents, preferences: selected, lang,
  });

  function requestLiveSheetTime(nextTime: "tonight" | "week") {
    liveSheetPeriodAutomaticRef.current = false;
    setLiveSheetTime(nextTime);
    requestLiveSheetScope(liveSheetScope, nextTime, true).catch(() => {});
  }

  async function requestLiveSheetScope(
    nextScope: LiveEventScope,
    nextTime = liveSheetTime,
    reuseLocation = false,
  ) {
    const queryIntentId = intentSequenceRef.current;
    liveQueryAbortRef.current?.abort();
    const controller = new AbortController();
    liveQueryAbortRef.current = controller;
    setLiveQueryGeoHint(null);
    setLiveQueryPending(true);
    setLiveQueryError(null);
    try {
      let nearMeCoords: { lat: number; lng: number } | null = null;
      if (nextScope === "near_me") {
        try {
          nearMeCoords = reuseLocation ? liveNearMeCoordsRef.current : null;
          nearMeCoords ??= await currentPosition();
        } catch {
          if (!controller.signal.aborted) setLiveQueryGeoHint(
            t("Din plats kunde inte hämtas. Tillåt platsdelning och försök igen.",
              "Your location couldn't be obtained. Allow location sharing and try again."),
          );
          return;
        }
      }
      if (controller.signal.aborted || queryIntentId !== intentSequenceRef.current || safeResponse !== liveResponseRef.current) return;
      const payload = buildLiveEventQueryPayload({
        scope: nextScope,
        time: nextTime === "week" ? "this_week" : "tonight",
        preferences: selected,
        response: safeResponse,
        routeStops,
        nearMeCoords,
      });
      if (!payload) throw new Error("live_event_anchor_unavailable");
      if (nearMeCoords) liveNearMeCoordsRef.current = nearMeCoords;
      setLiveSheetScope(nextScope);
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
        if (!response.ok && body?.error === "place_scope_unavailable") throw new Error("place_scope_unavailable");
        const accepted = response.ok ? acceptedLiveEventQuery(body) : null;
        if (!accepted) throw new Error("live_event_query_contract_rejected");
        setLiveQueryEvents(accepted as LiveEvents);
        if (!(accepted as LiveEvents).pending) break;
      }
    } catch (error) {
      if (controller.signal.aborted) return;
      setLiveQueryError(error instanceof Error && error.message === "place_scope_unavailable"
        ? t("Hela områdets gränser kunde inte bekräftas. Välj Runt platsen eller Nära mig.", "The full area's boundaries couldn't be confirmed. Choose Around the place or Near me.")
        : t("Live-vyn kunde inte uppdateras. Försök igen.", "The Live view couldn't update. Try again."));
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
  // Only explicit published endpoint legs are shown; no distance is inferred.
  const endpointLeg = (point: any, stop: any, fromStart: boolean) => {
    if (!point || !stop || !Array.isArray(primaryRoute?.legs)) return null;
    const pointLabel = String(point.label ?? "").trim();
    const stopLabel = String(stop.label || stop.name || "").trim();
    const leg = fromStart ? primaryRoute.legs[0] : primaryRoute.legs.at(-1);
    if (!pointLabel || !stopLabel || String(leg?.from_label ?? "").trim() !== (fromStart ? pointLabel : stopLabel) ||
        String(leg?.to_label ?? "").trim() !== (fromStart ? stopLabel : pointLabel)) return null;
    const km = Number.isFinite(leg.distance_km) ? leg.distance_km : null;
    const minutes = Number.isFinite(leg.estimated_walk_minutes) ? leg.estimated_walk_minutes : null;
    if (km === null && minutes === null) return null;
    const label = anchorIsPosition ? t("Din position", "Your position") : pointLabel;
    return { km, minutes, label };
  };
  const startLeg = endpointLeg(publishedStart, routeStops[0], true);
  const finishLeg = endpointLeg(publishedEnd, routeStops.at(-1), false);
  const routeOrigin = routeAnchorCoords ?? publishedStart;
  const routeDestination = routeAnchorCoords ?? publishedEnd;
  const routeParts = useMemo(
    () => mapsWalkingRouteParts(
      routeStops,
      { origin: routeOrigin, destination: routeDestination },
    ),
    [routeStops, routeOrigin, routeDestination],
  );
  const routeUrls = routeParts.map((part) => part.url);
  // A split route is one walk in consecutive stretches, so each part is named
  // by where it starts and ends — never just "part 2", which reads like an
  // alternative to part 1.
  const routeEndLabel = (end: RouteEnd) =>
    end.kind === "stop"
      ? String(end.point.label || end.point.name || "").trim() || t(`Stopp ${end.index + 1}`, `Stop ${end.index + 1}`)
      : mode === "near_me"
        ? t("Din position", "Your position")
        : String(end.point.label || "").trim() || (end.kind === "origin" ? t("Start", "Start") : t("Slut", "Finish"));
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
  // A day is on screen — the only case where "your day stays as it is" is true.
  const dayOnScreen = showDay && routeStops.length > 0;
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
    livePlanPendingRef.current = null;
    setLivePlanPending(false);
    setChoicesNotCarried(false);
    setStopEditFeedback(null);
    setStopEditError(null);
    intentSequenceRef.current += 1;
    // The day's completion read answers the old intent: stop it now, not when
    // the adjustment's debounce sends the next compose.
    abortLiveCompletion();
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
  // `sameDate` re-asks the failed request's own date: a source retry is the
  // same question again, even if the clock has crossed midnight meanwhile.
  const retryPlan = ({ sameDate = false }: { sameDate?: boolean } = {}) => {
    if (retryInFlightRef.current) return;
    const anchor = lastRequestedAnchorRef.current;
    if (!anchor) return;
    const dateIsoOverride = sameDate || dayEdit ? lastComposeDateIsoRef.current ?? undefined : undefined;
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
    execute(anchor, dateIsoOverride ? { dateIsoOverride } : {}).catch(() => {}).finally(() => {
      if (retryGenerationRef.current === retryGeneration) retryInFlightRef.current = false;
    });
  };
  const commit = (identity: string, kind: "exclude" | "pin", commitLabel: string, liveAction?: "remove" | "replace") => {
    if (!identity || (commitments[identity]?.kind === kind && commitments[identity]?.liveAction === liveAction)) return;
    setExpandedStopKey(null);
    setExpandedCandidateKey(null);
    // The anchor of the day on screen — the geography this commitment is about.
    commitmentAnchorKeyRef.current = displayedAnchorKeyRef.current;
    // Anything in flight or already scheduled is now answering a question the
    // user has moved past.
    invalidateCommitmentIntent();
    // A newly added stable pin may reselect within the shorter day. The old
    // transaction's retained IDs must not make this explicit commitment impossible.
    if (kind === "pin" && !isLiveOccurrenceId(identity) && dayEdit &&
        !dayEdit.retained_candidate_ids.includes(identity)) relaxDayEditForAdjustment();
    // The label travels with the commitment so a day that could not keep a
    // place can name it, without a second map to fall out of sync.
    setCommitments({ ...commitments, [identity]: { kind, label: commitLabel, ...(liveAction ? { liveAction } : {}) } });
  };
  function changeLiveSheetSort(next: "for_you" | "by_time") {
    setLiveSheetSort(next);
    writeLS("parranda:live:sort", { sort: next });
  }
  const planWithLiveOccurrence = (event: PulseEvent, label: string) => {
    const date = lastComposeDateIsoRef.current;
    const identity = selectableLiveOccurrenceId(event, date);
    if (!identity || livePlanPendingRef.current || stopEditPending || dayIsStale || phase !== "done" || restoredAt) return;
    invalidateCommitmentIntent();
    livePlanPendingRef.current = identity;
    setLivePlanPending(true);
    commitmentAnchorKeyRef.current = displayedAnchorKeyRef.current;
    // A new explicit occurrence owns the sole evening choice. Stable pins and
    // exclusions remain; a shortened day retains its cap and removed places.
    const next = Object.fromEntries(Object.entries(commitments).filter(([id]) =>
      !isLiveOccurrenceId(id) || id.slice(5, 15) !== date));
    setCommitments({ ...next, [identity]: { kind: "pin", label } });
    relaxDayEditForAdjustment();
    focusDayAfterLiveChoiceRef.current = true;
    setLiveSheetOpen(false);
  };
  const editStop = (identity: string, stopLabel: string, action: "replace" | "remove") => {
    if (!identity || pendingStopEditRef.current || stopEditPending || dayIsStale || phase !== "done") return;
    if (commitments[identity]?.kind === "pin") return;
    if (restoredAt) {
      setStopEditError("rebuild_required");
      return;
    }
    // A woven event already belongs to the published route and its extent.
    // The server must preserve it or refuse atomically, never lose it merely
    // because the UI renders it in a different section from stable places.
    const publishedStops = routeStops;
    const ids = publishedStops.map((stop: any) => String(stop?.id ?? stop?.place_id ?? stop?.candidate_id ?? ""));
    const index = ids.indexOf(identity);
    if (index < 0 || ids.some((id: string) => !id)) return;
    const stop = publishedStops[index];
    const coverage = routePreferenceCoverage([stop], selected);
    const possiblePreferences = [...coverage.covered_preferences, ...coverage.partial_preferences];
    const ordered = normalizePreferencePriority(preferencePriority, selected);
    const replacementPreference = (ordered.length ? ordered : selected).find(key => possiblePreferences.includes(key)) ?? null;
    const edit = normalizeDayEdit({
      version: 1, action, candidate_id: identity,
      retained_candidate_ids: ids.filter((id: string) => id !== identity),
      target_stop_count: action === "remove" ? ids.length - 1 : ids.length,
      slot_index: index, replacement_preference: action === "replace" ? replacementPreference : null,
      removed_candidate_ids: [...new Set([...(dayEdit?.removed_candidate_ids ?? []), ...(action === "remove" ? [identity] : [])])],
    });
    if (!edit) {
      setStopEditError("unsupported");
      return;
    }
    invalidateCommitmentIntent();
    commitmentAnchorKeyRef.current = displayedAnchorKeyRef.current;
    const nextCommitments = { ...commitments };
    delete nextCommitments[identity];
    if (action === "replace") nextCommitments[identity] = { kind: "exclude", label: stopLabel };
    setCommitments(nextCommitments);
    dayEditScopeRef.current = { anchorKey: displayedAnchorKeyRef.current, dateIso: lastEntryRef.current?.dateIso ?? null };
    pendingStopEditRef.current = edit;
    setStopEditPending(true);
    setDayEdit(edit);
    setExpandedStopKey(null);
  };
  const dismissStop = (identity: string, stopLabel: string) => editStop(identity, stopLabel, "replace");
  const removeStop = (identity: string, stopLabel: string) => editStop(identity, stopLabel, "remove");
  const keepStop = (identity: string, stopLabel: string) => commit(identity, "pin", stopLabel);
  const releaseCommitment = (identity: string) => {
    if (!identity || !commitments[identity]) return;
    invalidateCommitmentIntent();
    const next = { ...commitments };
    delete next[identity];
    setCommitments(next);
  };
  const clearCommitments = () => {
    if (!Object.keys(commitments).length && !dayEdit) return;
    invalidateCommitmentIntent();
    setCommitments({});
    setDayEdit(null);
    dayEditScopeRef.current = null;
    setRestoredAt(null);
  };
  const excludedCount = Object.entries(commitments).filter(([id, entry]) => !id.startsWith("live:") && entry.kind === "exclude").length;
  const pinnedCount = Object.entries(commitments).filter(([id, entry]) => !id.startsWith("live:") && entry.kind === "pin").length;
  const liveChoiceCount = Object.keys(commitments).filter(isLiveOccurrenceId).length;
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
    stopIds: routeStops.map((stop: any) => String(stop?.live_occurrence_id ?? stop?.id ?? stop?.place_id ?? stop?.candidate_id ?? "")),
    isStale: dayIsStale,
    serverReasons: appliedRefusals,
  });
  // Some caps have no sentence of their own because a more specific surface
  // already states them (see day-limitations.mjs). Guard on the rendered note,
  // never on the cap count, or those days render an empty bullet.
  // Published source completion is historical evidence, not a live job state.
  // An incomplete answer cannot judge the place thin or promise more supply.
  const sourceCompletion = safeResponse?.agnostic_route_output_experiment?.source_status?.collection?.source_completion;
  // Primary failures live alongside collection metadata; the completion failed
  // count covers background jobs and cannot clear a failed primary source.
  const sourceError = safeResponse?.agnostic_route_output_experiment?.source_status?.error;
  const primarySourceFailed = typeof sourceError === "string" && sourceError.trim() !== "";
  const incompletePlaceSources = phase === "done" && (sourcesIncomplete(sourceCompletion) || primarySourceFailed);
  const sourceEvidenceNote = incompletePlaceSources ? contextNote([], t, { sourceCompletion, sourceFailed: primarySourceFailed }) : "";
  const terminalSourceIssue = incompletePlaceSources && !hasPrimaryRoute && !anchorUnresolved && !upgradePending && !serviceRefusal;
  const canUpdateSaved = !restoredAt || Boolean(lastRequestedAnchorRef.current && lastComposeDateIsoRef.current);
  const dayLimitationNote = limitationNote(dayLimitations, split.core.length, t, { sourcesIncomplete: incompletePlaceSources });

  // The route line joins the stops' own coordinates unless the route carries
  // walking geometry; the map draws that sketch dotted and the caption says so.
  const routeLineIsSketch = routePathIsSketch(primaryRoute?.map_path_points, routeStops.length);
  const sourceBackedDay = structure?.provenance === "agnostic_anchor"
    && primaryRoute?.trust_summary?.human_verified !== true;
  // How the day was assembled, minus what another line already says in full:
  // the trust line names the source-backed places, the map caption the
  // estimates. What is left sits with the map, not under the title.
  const unavailableHasChoices = Boolean(anchorUnresolved && (safeResponse?.agnostic_route_output_experiment?.intake?.candidates?.some((c: any) => c.selection_id) || safeResponse?.agnostic_route_output_experiment?.intake?.blockers?.includes("place_selection_invalid")));
  // Reference failures describe the server's verdict, not a misspelt name.
  // Neither optional URL text nor a previous saved day's label attests this ref.
  const referenceFailures: Record<string, string> = {
    place_ref_not_found: t("Den valda platsreferensen kunde inte hittas. Välj en plats igen — ingen annan plats väljs automatiskt.", "The selected place reference could not be found. Choose a place again — no other place is selected automatically."),
    place_ref_unavailable: t("Platsreferensen kunde inte kontrolleras just nu. Försök igen senare eller välj en annan plats — ingen annan plats väljs automatiskt.", "The place reference could not be checked right now. Try again later or choose another place — no other place is selected automatically."),
    place_ref_unsupported: t("Platsreferensen avser en geografisk identitet som inte stöds för att planera en dag. Välj en annan plats.", "This place reference identifies a geographic type that is not supported for planning a day. Choose another place."),
    place_ref_conflict: t("Platsreferensen och övriga platsval stämmer inte överens. Välj en plats igen för att få ett entydigt platsval.", "The place reference conflicts with the other place choices. Choose a place again to make the selection unambiguous."),
    place_ref_invalid: t("Platsreferensen är ogiltig. Välj en plats igen — ingen annan plats väljs automatiskt.", "The place reference is invalid. Choose a place again — no other place is selected automatically."),
  };
  const referenceBlockers = safeResponse?.agnostic_route_output_experiment?.intake?.blockers;
  const referenceFailure = Array.isArray(referenceBlockers)
    ? referenceBlockers.find((blocker: string) => Object.hasOwn(referenceFailures, blocker)) : null;
  const referenceFailureMessage = referenceFailure ? referenceFailures[referenceFailure]
    : t("Den valda platsreferensen kunde inte bekräftas. Välj en plats igen — ingen annan plats väljs automatiskt.", "The selected place reference could not be confirmed. Choose a place again — no other place is selected automatically.");
  // A resolved place whose place sources failed to answer is not a place
  // without places: the verdict is about the sources, never the reader's
  // picks, and since the page no longer retries on its own it offers the retry.
  const sourceUnavailable = phase === "done" && classification?.status === "unavailable" && !anchorUnresolved
    && anywhereDecision().shouldRetryTransientSource(safeResponse, classification);
  // Some place sources answered and one failed (the loader's own verdict): the
  // day may be missing only for that reason. Named as such — never as a total
  // outage, never as the reader's picks.
  const loadedSourceStatus = safeResponse?.agnostic_route_output_experiment?.source_status;
  const sourcePartlyUnavailable = phase === "done" && classification?.status === "unavailable" && !anchorUnresolved
    && !sourceUnavailable && !terminalSourceIssue && typeof loadedSourceStatus?.error === "string" && loadedSourceStatus.error.trim() !== ""
    && loadedSourceStatus?.collection?.selection_reason === "loader_error";
  // Preserve the classifier's absences; choices announce themselves, and an
  // outstanding upgrade or service refusal is not a final no-day verdict.
  const unavailableMessage = phase === "done" && (classification?.status === "unavailable" || terminalSourceIssue) && !upgradePending && !serviceRefusal && !unavailableHasChoices
    ? anchorUnresolved
      ? placeRef ? referenceFailureMessage : t(
          `Parranda kunde inte hitta ”${typedPlaceLabel}” just nu. Prova en annan stavning eller lägg till land eller region — inget hittas på.`,
          `Parranda couldn't pin down “${typedPlaceLabel}” right now. Try another spelling or add a country or region — nothing is invented in its place.`,
        )
      : terminalSourceIssue
        ? `${t("Planeringen avslutades utan rutt.", "Planning finished without a route.")} ${sourceEvidenceNote}`
      : sourceUnavailable
        ? t(
            `Platskällorna svarade inte just nu, så Parranda kunde inte hämta platser ${anchorIsPosition ? "nära dig" : `för ${placeName}`} — inget hittas på. Försök igen om en stund.`,
            `The place sources didn't answer just now, so Parranda couldn't fetch places ${anchorIsPosition ? "near you" : `for ${placeName}`} — nothing is invented in its place. Try again in a moment.`,
          )
      : classification?.unavailableReason === "sparse_supply" && classification.realPlaceCount
        ? t(
            `Parranda hittade ${classification.realPlaceCount === 1 ? "1 riktig plats" : `${classification.realPlaceCount} riktiga platser`} ${anchorIsPosition ? "nära dig" : `nära ${placeName}`}, men inte tillräckligt för en pålitlig dag ännu — inget hittas på.`,
            `Parranda found ${classification.realPlaceCount === 1 ? "1 real place" : `${classification.realPlaceCount} real places`} ${anchorIsPosition ? "near you" : `near ${placeName}`}, but not enough for a reliable day yet — nothing is invented in its place.`,
          )
        : t(
            `Parranda kunde inte komponera en dag ${anchorIsPosition ? "nära dig" : `för ${placeName}`} ännu — inget hittas på, inget fejkas.`,
            `Parranda couldn't compose a day ${anchorIsPosition ? "near you" : `for ${placeName}`} yet — nothing is invented in its place.`,
          )
    : "";
  const dayContextNote = contextNote(dayLimitations, t, {
    // The header states source limitations; the map keeps its own facts.
    sourceCompletion: incompletePlaceSources ? null : sourceCompletion,
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
  const stopEditErrorMessage = stopEditError === "live_not_preserved"
    ? dayOnScreen
      ? t("Det valda evenemanget kunde inte bekräftas i en gångbar dag. Din tidigare dag är kvar. Försök igen eller ångra valet.", "The chosen event could not be confirmed in a walkable day. Your previous day is retained. Try again or undo the choice.")
      : t("Det valda evenemanget kunde inte bekräftas i en gångbar dag. Försök igen eller välj ett annat evenemang.", "The chosen event could not be confirmed in a walkable day. Try again or choose another event.")
    : stopEditError === "no_safe_replacement"
    ? t("Inget liknande stopp kunde bekräftas.", "No similar stop could be confirmed.")
    : stopEditError === "unsupported"
    ? t("Den här ändringen stöds inte för den här dagen. Dagen är oförändrad.", "This change is not supported for this day. Your day is unchanged.")
    : stopEditError === "rebuild_required"
    ? t("Uppdatera den sparade dagen eller välj en ny startpunkt innan du ändrar stopp.", "Rebuild this saved day or choose a new starting point before editing stops.")
    : stopEditError ? t("Ändringen kunde inte bekräftas.", "The change could not be confirmed.") : "";
  const dayChangeLine = useMemo(
    () =>
      dayChange
        ? dayChangeSegments(dayChange.summary, {
            lang,
            // Name the rhythm input; measured distance describes the resulting day.
            walkLabel: (key) => {
              const preset = DAY_RHYTHMS.find((p: { key: string }) => p.key === key);
              return preset ? String(lang === "en" ? preset.en : preset.sv).split(" · ")[0] : key;
            },
            pickLabel: (key) => pickLabel(key, lang),
            dayLabel: (offset) => (offset === 0 ? t("Idag", "Today") : t("Imorgon", "Tomorrow")),
          })
        : [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dayChange, lang],
  );
  // A woven live event belongs to the day on screen, which may be tomorrow's.
  const includedInRoute = dayOffset === 0
    ? t("Ingår i dagens rutt", "Included in today's route")
    : t("Ingår i morgondagens rutt", "Included in tomorrow's route");
  // AnchorCard's three adjustments. Each one recomposes on its own, so each
  // first invalidates whatever is in flight for the old intent.
  const relaxDayEditForAdjustment = () => {
    const applied = dayEdit?.action === "replace" ? normalizeDayEdit(lastEntryRef.current?.inputs?.dayEdit) : dayEdit;
    setDayEdit(applied ? normalizeDayEdit({ ...applied, preserve_retained: false }) : null);
  };
  const toggleMood = (key: string) => {
    invalidateCommitmentIntent();
    relaxDayEditForAdjustment();
    const next = togglePreferenceSelection({ selected, preferencePriority }, key);
    setSelected(next.selected);
    setPreferencePriority(next.preferencePriority);
  };
  const promoteMood = (key: string) => {
    const next = promotePreference({ selected, preferencePriority }, key);
    if (next.preferencePriority.join(',') === preferencePriority.join(',')) return;
    invalidateCommitmentIntent();
    relaxDayEditForAdjustment();
    setPreferencePriority(next.preferencePriority);
  };
  const clearPriority = () => {
    if (!preferencePriority.length) return;
    invalidateCommitmentIntent();
    relaxDayEditForAdjustment();
    setPreferencePriority([]);
  };
  const chooseDay = (offset: 0 | 1) => {
    if (dayOffset !== offset) {
      invalidateCommitmentIntent();
      dayEditScopeRef.current = null;
      setDayEdit(null);
      setDayOffset(offset);
    }
  };
  const chooseRhythm = (key: string) => {
    if (walkKey !== key) { invalidateCommitmentIntent(); relaxDayEditForAdjustment(); setWalkKey(key); }
  };
  const openLiveSheet = () => {
    // Reopening resumes the cell the reader selected. Reapplying
    // the day's default period would relabel another query's rows
    // and a pending route/GPS query would restart around the place.
    const reopening = liveSheetOpenedRef.current;
    const nextTime = reopening ? liveSheetTime
      : preferFollowingWeek ? "week"
      : pulseBuckets.tonight.length > 0 || split.woven.length > 0 ||
        pulseState === "pending" ||
        (inPlaceScopeAvailable && selectedDayEmpty(liveEvents)) ? "tonight" : "week";
    const nextScope = reopening ? liveSheetScope : "around_place";
    liveSheetOpenedRef.current = true;
    setLiveSheetTime(nextTime);
    setLiveSheetOpen(true);
    // "Couldn't verify" + an available anchor: opening the sheet IS
    // the "check again" — fire a fresh around-place query (its own
    // bounded retries) instead of showing the same stale emptiness.
    if ((reopening || pulseState === "unavailable" || pulseState === "pending") &&
        (nextScope !== "around_place" || aroundPlaceScopeAvailable) && !liveQueryPending) {
      requestLiveSheetScope(nextScope, nextTime, true).catch(() => {});
    }
  };

  // LAYOUT. Phones read one column: the day, its map, its line, then "now".
  // Wide screens keep the day on the left and give the map the rest of the
  // window, sticky beside it — one map instance either way, mounted where it is
  // shown (the static build and the first client render are the phone layout).
  const wideScreen = useMediaQuery("(min-width: 64rem)");
  const dayWithRoute = showDay && routeStops.length > 0;
  const splitLayout = wideScreen && dayWithRoute;
  const routeMap = dayWithRoute ? (
    <RouteMap
      hasPrimaryRoute={hasPrimaryRoute}
      routeStops={routeStops}
      primaryRoute={primaryRoute}
      areas={day?.areas}
      routeContextSuggestions={routeContextSuggestions}
      showContext={detoursOpen}
      sketch={routeLineIsSketch}
      mapExpanded={splitLayout ? undefined : mapExpanded}
      onToggleExpanded={splitLayout ? undefined : () => setMapExpanded((cur) => !cur)}
      heightClass={splitLayout ? "h-full" : mapExpanded ? "h-96 sm:h-112" : "h-48 sm:h-60"}
      regionLabel={splitLayout ? t("Interaktiv karta", "Interactive map") : undefined}
      t={t}
    />
  ) : null;

  return (
    <div
      className={
        splitLayout
          ? "grid w-full grid-cols-[minmax(0,34rem)_minmax(0,1fr)] items-start gap-x-10 gap-y-8 xl:grid-cols-[minmax(0,36rem)_minmax(0,1fr)] xl:gap-x-14"
          : "mx-auto flex w-full max-w-2xl flex-col gap-8"
      }
    >
      <div className={splitLayout ? "col-span-full" : ""}>
        <AppBar
          lang={lang}
          homeLabel={t("Parranda — till startsidan", "Parranda — home")}
          languageLabel={t("Språk", "Language")}
          onNavigate={leavePlanner}
          languageHref={languageHref}
        />
      </div>

      <main className="flex min-w-0 flex-col gap-10 sm:gap-12">
      {hasAnchor && (
        <AnchorCard
          t={t}
          lang={lang}
          anchorLabel={anchorLabel}
          dayOffset={dayOffset}
          moodLabel={moodLabel}
          walkLabel={walkLabel}
          adjustOpen={adjustOpen}
          setAdjustOpen={setAdjustOpen}
          preferences={ANYWHERE_PREFERENCES}
          selected={selected}
          preferencePriority={preferencePriority}
          onToggleMood={toggleMood}
          onPromoteMood={promoteMood}
          onClearPriority={clearPriority}
          onSetDay={chooseDay}
          rhythms={DAY_RHYTHMS}
          walkKey={walkKey}
          onSetRhythm={chooseRhythm}
          onChangePlace={cancelActivePlannerForNavigation}
        />
      )}

      {/* One permanently mounted result region: ready or final unavailable.
          Cleared while composing; PlaceChoices carries its own status. */}
      <p ref={resultStatusRef} tabIndex={-1} role="status" className="sr-only">
        {livePlanPending ? t("Planerar dagen med det valda evenemanget.", "Planning the day with the chosen event.") : phase === "done" && dayWithRoute && staleNotice !== "updating"
          ? t(
              `En dag ${anchorIsPosition ? "nära dig" : `i ${anchorLabel}`} är klar: ${routeStops.length} stopp.`,
              `A day ${anchorIsPosition ? "near you" : `in ${anchorLabel}`} is ready: ${routeStops.length} ${routeStops.length === 1 ? "stop" : "stops"}.`,
            )
          : unavailableMessage}
      </p>
      {hasAnchor && !dayWithRoute && <h1 className="sr-only">{anchorIsPosition
        ? t("Din dag nära dig", "Your day near you")
        : !anchorLabel || (placeRef && intakeStatus !== "resolved")
          ? t("Din dag", "Your day")
          : t(`Din dag i ${anchorLabel}`, `Your day in ${anchorLabel}`)}</h1>}

      {/* Static hydration and unavailable snapshots must not become another
          place-entry step. Root is the only place picker. */}
      {!hasAnchor && (
        // One status region from the static HTML on, so the arrival's verdict
        // is announced as a change. The static page cannot see its own link:
        // telling a reader with a place link to choose a place on the home
        // page sent them away while their day was about to be built. Until
        // the link is read, only "preparing" is true; the app bar links home.
        <div className="flex flex-col items-start gap-3 pt-8" role="status">
          {!arrivalRead ? (
            <p>{t("Förbereder din dag …", "Preparing your day …")}</p>
          ) : (
            <>
              <p>{invalidPlaceLink
                ? t("Länken har en ogiltig platsreferens. Välj en plats på startsidan — ingen annan plats väljs automatiskt.", "This link has an invalid place reference. Choose a place on the home page — no other place is selected automatically.")
                : invalidDayEditLink
                ? t("Länkens stoppändring är ogiltig. Välj en plats på startsidan — ingen oförändrad heldag skapas automatiskt.", "This link has an invalid stop edit. Choose a place on the home page — no unedited day is generated automatically.")
                : conflictingPlaceLink
                ? t("Länken har motstridiga platsankare. Välj en plats på startsidan — ingen annan plats väljs automatiskt.", "This link has conflicting place anchors. Choose a place on the home page — no other place is selected automatically.")
                : t("Förbereder din dag. Om ingen sparad dag finns, välj en plats på startsidan.", "Preparing your day. If no saved day is available, choose a place on the home page.")}</p>
              <a href={`/?lang=${lang}`} onClick={() => leavePlanner("home")} className={buttonClass("secondary", "min-h-11 px-4 text-sm")}>
                {t("Till startsidan", "Go to home")}
              </a>
            </>
          )}
        </div>
      )}

      {/* A near-me page whose position did not survive (reload, an old tab, a
          rebuild of a restored day): say so, and let the same explicit tap
          share it again rather than asking in the background. */}
      {mode === "near_me" && ((phase === "idle" && !classification) || positionNeeded) && (
        <div className={`flex flex-col items-start gap-3 ${noticeCard}`}>
          <p>
            {t(
              "Din position följer inte med när sidan laddas om. Dela den igen så byggs dagen runt den.",
              "Your position isn't kept when the page reloads. Share it again and the day is built around it.",
            )}
          </p>
          <button
            type="button"
            {...busyButton(relocating, useLocationAgain)}
            className={buttonClass("primary", "min-h-11 px-4 text-sm")}
          >
            <LocationIcon className="h-4 w-4" />
            {relocating ? t("Hämtar position …", "Getting location …") : t("Använd min position", "Use my location")}
          </button>
          {relocateDenied && (
            <p className="text-13 text-parranda-ink/72" aria-live="polite">
              {t("Positionen blockerades — byt till en stad eller plats i stället.", "Location was blocked — choose a city or place instead.")}
            </p>
          )}
        </div>
      )}

      {choicesNotCarried && (
        <p className={noticeCard} role="status">
          {t(
            "Dina tidigare fästa och bortvalda stopp kunde inte föras över till den här dagen. De används inte i den här planeringen.",
            "Your previous kept and dismissed stops could not be carried over to this day. They are not used in this plan.",
          )}
        </p>
      )}

      {/* The ledger is stated where the user can always see it — including when
          dismissing left no day at all, which is exactly when a way back
          matters most. Hiding it behind a collapsed panel made the dismissal
          effectively irreversible. */}
      {(excludedCount > 0 || pinnedCount > 0 || liveChoiceCount > 0) && (
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-13 text-parranda-ink/72" role="status">
          {liveChoiceCount > 0 && <span>{t("Live-valet behålls för sitt tillfälle", "Live choice saved for its occurrence")}</span>}
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
            className="inline-flex min-h-11 items-center font-semibold text-parranda-ink underline underline-offset-2 hover:text-parranda-clay"
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
        <div className="flex flex-col gap-1.5 rounded-parranda border-line border-parranda-glow/40 bg-parranda-glow/8 px-4 py-3 text-13 text-parranda-ink/85" role="status">
          {unkept.reasons.map((entry: { id: string; label: string; reason: string | null }) => (
            <p key={entry.id}>{isLiveOccurrenceId(entry.id) ? t(`${entry.label || "Det valda tillfället"} kunde inte bekräftas som stopp i den här dagen. Ditt val finns kvar.`, `${entry.label || "The chosen occurrence"} could not be confirmed as a stop in this day. Your choice is retained.`) : unkeptReasonSentence(entry, t)}</p>
          ))}
        </div>
      )}

      {phase === "loading" && !staleNotice && (
        <div className="flex flex-col gap-5">
          <p className="flex items-center gap-2.5 text-sm text-parranda-ink/75" aria-live="polite">
            <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full bg-parranda-ember motion-safe:animate-pulse" />
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
          {/* The shape of the day that is coming — a line with empty
              stations — so it lands without a jump. Decorative only: it
              carries no place, number or claim. */}
          <div aria-hidden="true" className="flex flex-col gap-3 motion-safe:animate-pulse">
            <span className="h-3 w-20 rounded-full bg-parranda-ink/10" />
            <span className="h-10 w-3/4 rounded-parranda-btn bg-parranda-ink/10" />
            <span className="h-14 w-2/3 rounded-parranda-btn bg-parranda-ink/10" />
            <span className="h-3 w-1/2 rounded-full bg-parranda-ink/10" />
            <span className="mt-2 h-56 rounded-parranda bg-parranda-ink/8" />
            <div className="relative mt-2 flex flex-col gap-5 before:absolute before:bottom-5 before:left-[19px] before:top-5 before:w-1.5 before:rounded-full before:bg-parranda-ink/10 before:content-['']">
              {[0, 1, 2].map((row) => (
                <span key={row} className="flex items-center gap-3">
                  <span className="relative h-11 w-11 rounded-full border-4 border-parranda-ink/12 bg-parranda-paper" />
                  <span className="h-4 flex-1 rounded-full bg-parranda-ink/10" />
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
          <button type="button" onClick={() => retryPlan()} className={buttonClass("primary", "min-h-11 px-4 text-sm")}>
            {navigationInterrupted ? t("Fortsätt planera", "Continue planning") : t("Försök bygga dagen igen", "Try building the day again")}
          </button>
        </div>
      )}

      {(phase === "done" || (phase === "error" && stopEditError)) && serviceRefusal && (
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

      {phase === "done" && (classification?.status === "unavailable" || terminalSourceIssue) && (
        !upgradePending &&
        <div className={`flex flex-col items-start gap-3 ${noticeCard}`}>
          {/* Three honestly different absences: a typed place Parranda could
              not pin down (nothing to compose around — say that, and how to
              fix it), a resolved place whose trusted sources hold real places
              but too few for a reliable day, and a resolved place that did not
              compose. The count comes from the classifier's trusted-loader
              evidence, never from copy. The label follows the pill rule:
              primary locality, not the resolver's full admin chain. */}
          {/* Plain visible copy is announced by the permanent result region;
              PlaceChoices instead owns its interactive status. */}
          <div className="text-15 text-parranda-ink">
            {unavailableHasChoices ? (
              <PlaceChoices intake={safeResponse?.agnostic_route_output_experiment?.intake}
                pending={false} locationPending={narrowingPlace} locationFailed={narrowingFailed} t={t}
                onNarrow={placeRef ? undefined : () => { narrowPlaceSearch().catch(() => {}); }}
                onChoose={(choice) => {
                  const choiceRef = validPlaceRef(choice.place_ref);
                  // Without a durable ref, the offered receipt is bound to
                  // the original query; selectionLabel carries its identity.
                  const nextPlace = placeRef && choiceRef ? choice.label : place.trim();
                  if (placeRef) setPlace(nextPlace);
                  setPlaceSelection(choice.selection_id); setSelectionLabel(choice.label); setPlaceRef(choiceRef);
                  execute({ place: nextPlace, placeSelection: choice.selection_id, selectionLabel: choice.label, placeRef: choiceRef }).catch(() => {});
                }} />
            ) : unavailableMessage}
          </div>
          {sourcePartlyUnavailable && (
            <p>{t(
              "En av platskällorna svarade inte just nu, så underlaget kan vara ofullständigt. Försök igen om en stund.",
              "One of the place sources didn't answer just now, so the evidence may be incomplete. Try again in a moment.",
            )}</p>
          )}
          {canUpdateSaved && (sourceUnavailable || sourcePartlyUnavailable || terminalSourceIssue) && (
            <button type="button" onClick={() => retryPlan({ sameDate: true })} className={buttonClass("primary", "min-h-11 px-4 text-sm")}>
              {t("Försök igen", "Try again")}
            </button>
          )}
          {!anchorUnresolved && !sourceUnavailable && !sourcePartlyUnavailable && !terminalSourceIssue && selected.length > 0 && (
            <p>{t(
              "Vi kunde inte bekräfta en gångbar dag med dina val. Andra intressen läggs inte till automatiskt. Du kan ändra datum, dagens rytm eller själv välja fler intressen.",
              "We could not confirm a walkable day with your choices. Other interests are not added automatically. You can change the date, day rhythm or choose more interests yourself.",
            )}</p>
          )}
          {restoredAt && !canUpdateSaved && (
            <p>{t("Den sparade dagen kan inte uppdateras säkert. ", "We cannot safely update this saved day. ")}
              <a href={`/?lang=${lang}`} className="inline-flex min-h-11 items-center font-semibold underline underline-offset-2">
                {t("Välj startpunkt och datum", "Choose a starting point and date")}
              </a>
            </p>
          )}
          {anchorUnresolved && (
            <a
              href={`/?lang=${lang}`}
              onClick={(event) => {
                if (event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
                  cancelActivePlannerForNavigation();
                }
              }}
              className={buttonClass("secondary", "min-h-11 px-4 text-sm")}
            >
              {t("Välj en annan plats", "Choose another place")}
            </a>
          )}
        </div>
      )}

      {/* WHAT THE LAST ADJUSTMENT CHANGED. An adjustment recomposes on its
          own, so the replacement says what moved — or that nothing did — and
          offers the day before it back. It sits beside the controls it
          answers, and it is gone as soon as it stops being true. */}
      {stopEditError && !dayChange && <p className={noticeCard} role="status">{stopEditErrorMessage}</p>}
      {stopEditError === "live_not_preserved" && <button type="button" onClick={() => retryPlan({ sameDate: true })}
        className={buttonClass("secondary", "min-h-11 px-4 text-sm")}>
        {t("Försök planera med evenemanget igen", "Try planning with this event again")}
      </button>}
      {dayChange && (phase === "done" || (phase === "error" && stopEditError)) && (!dayIsStale || stopEditError) && (dayChangeLine.length > 0 || stopEditFeedback || stopEditError) && (
        <div
          role="status"
          className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-parranda border-line border-parranda-ink/12 bg-parranda-ink/4 px-4 py-2.5"
        >
          <p className="min-w-0 flex-1 text-13 leading-snug text-parranda-ink/75">
            {stopEditError ? stopEditErrorMessage : stopEditFeedback ? t(stopEditFeedback === "remove" ? "Borttaget" : "Bytt", stopEditFeedback === "remove" ? "Removed" : "Replaced") : <>
              <span className="font-bold text-parranda-ink">{t("Ändrat", "Changed")}: </span>
              {dayChangeLine.join(" · ")}
            </>}
          </p>
          <button
            type="button"
            onClick={undoDayChange}
            aria-label={t("Ångra ändringen", "Undo this change")}
            className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border-line border-parranda-ink/20 px-3.5 text-xs font-bold text-parranda-ink transition hover:border-parranda-ink/50"
          >
            <UndoIcon className="h-3.5 w-3.5" />
            {t("Ångra", "Undo")}
          </button>
        </div>
      )}

      {classification?.status === "edited_empty" && phase === "done" && (
        <section className={noticeCard} role="status">
          <h2 className="font-bold text-parranda-ink">{t("Dagen är tom", "Your day is empty")}</h2>
          <p className="mt-1 text-sm text-parranda-ink/72">{t("Du har tagit bort alla stopp.", "You removed every stop.")}</p>
          <button type="button" onClick={clearCommitments} className={buttonClass("secondary", "mt-3 min-h-11 px-4 text-sm")}>
            {t("Börja om", "Start over")}
          </button>
        </section>
      )}

      {dayWithRoute && (
        <DayHeader
          t={t}
          lang={lang}
          staleNotice={staleNotice}
          navigationInterrupted={navigationInterrupted}
          retryPlan={retryPlan}
          mode={mode}
          placeLabel={mode === "near_me" ? null : classification?.placeLabel}
          anchorLabel={anchorLabel}
          primaryRoute={primaryRoute}
          weather={dayflow?.weather ?? null}
          coreCount={split.core.length}
          wovenCount={split.woven.length}
          pickCoverage={pickCoverage}
          dayLimitationNote={dayLimitationNote}
          sourceEvidenceNote={sourceEvidenceNote}
          onUpdateDay={() => retryPlan({ sameDate: true })}
          restoredAt={restoredAt}
          canUpdateSaved={canUpdateSaved}
          resolveAndRun={() => retryPlan({ sameDate: true })}
        />
      )}

      {/* Without a composed day, this card carries provenance only. Save/share
          remain route actions: offering them here would call an unsequenced
          candidate surface a day. */}
      {showStructure && structure && !(showDay && routeStops.length > 0) && (
        <section className="rounded-parranda border-line border-parranda-glow/40 bg-parranda-glow/8 p-4">
          <div className="min-w-0 flex-1">
            {structure.provenance === "agnostic_anchor" && (
              <p className="text-sm font-bold text-parranda-clay">
                {t(
                  "Källstödda platskandidater — inte en komponerad rutt ännu",
                  "Source-backed place candidates — not a composed route yet",
                )}
              </p>
            )}
            {restoredAt && (
              <p className="mt-1 text-xs text-parranda-ink/68">
                {t("Sparad dag", "Saved day")} · {new Date(restoredAt).toLocaleDateString(lang === "en" ? "en-GB" : "sv-SE", { day: "numeric", month: "short", year: "numeric" })} —{" "}
                {canUpdateSaved ? (
                  <button type="button" onClick={() => retryPlan({ sameDate: true })} className="inline-flex min-h-11 items-center font-semibold underline underline-offset-2 hover:text-parranda-clay">
                    {t("bygg om för färska events", "rebuild for fresh events")}
                  </button>
                ) : (
                  <span>{t("Den sparade dagen kan inte uppdateras säkert. ", "We cannot safely update this saved day. ")}
                    <a href={`/?lang=${lang}`} className="inline-flex min-h-11 items-center font-semibold underline underline-offset-2">
                      {t("Välj startpunkt och datum", "Choose a starting point and date")}
                    </a>
                  </span>
                )}
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

      {dayWithRoute && (
        <StopLine
          t={t}
          lang={lang}
          map={splitLayout ? null : routeMap}
          stale={staleNotice === "updating"}
          routeLineIsSketch={routeLineIsSketch}
          dayContextNote={dayContextNote}
          assemblyNotes={dayAssemblyNotes(t, { sourceBackedDay, timeAnchoring })}
          split={split}
          routeStops={routeStops}
          legForStop={legForStop}
          startLeg={startLeg}
          finishLeg={finishLeg}
          anchorIsPosition={anchorIsPosition}
          mapsPlaceContext={mapsPlaceContext}
          expandedStopKey={expandedStopKey}
          setExpandedStopKey={setExpandedStopKey}
          expandedCandidateKey={expandedCandidateKey}
          setExpandedCandidateKey={setExpandedCandidateKey}
          commitments={commitments}
          selected={selected}
          releaseCommitment={releaseCommitment}
          keepStop={keepStop}
          dismissStop={dismissStop}
          removeStop={removeStop}
          editPending={stopEditPending || staleNotice === "updating"}
          commit={commit}
          eveningEvent={eveningEvent}
          selectedDate={liveEvents?.selected_date}
          dayOffset={dayOffset}
          routeContextSuggestions={routeContextSuggestions}
          detoursOpen={detoursOpen}
          setDetoursOpen={setDetoursOpen}
        />
      )}

      {dayWithRoute && (
        <DayActions
          t={t}
          routeParts={routeParts}
          routeUrls={routeUrls}
          routeEndLabel={routeEndLabel}
          saveDay={saveDay}
          isSaved={isSaved}
          canShare={canShare}
          shareDay={shareDay}
          shareCopied={shareCopied}
          routeOrigin={routeOrigin}
          routeDestination={routeDestination}
          anchorIsPosition={anchorIsPosition}
          publishedStart={publishedStart}
          publishedEnd={publishedEnd}
          stale={staleNotice === "updating"}
        />
      )}

      {/* Without a primary route, the broader place structure remains useful —
          but it is explicitly candidates, never a second itinerary. */}
      {showStructure && structure && !hasPrimaryRoute && (
        <CandidateAreas
          t={t}
          lang={lang}
          structureOnly={classification?.status === "structure_only"}
          areas={day?.areas ?? []}
          missingIntents={day?.missing_intents ?? []}
          mapsPlaceContext={mapsPlaceContext}
          expandedCandidateKey={expandedCandidateKey}
          setExpandedCandidateKey={setExpandedCandidateKey}
          commitments={commitments}
          releaseCommitment={releaseCommitment}
          commit={commit}
          map={
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
          }
        />
      )}

      {phase === "done" &&
        ((liveEvents && ["covered", "uncovered", "unavailable"].includes(liveEvents.coverage ?? "")) ||
          (showDay && dayflow?.weather?.headline) ||
          aroundPlaceScopeAvailable) && (
        <LiveCard
          t={t}
          lang={lang}
          mode={mode}
          anchorLabel={anchorLabel}
          liveEvents={liveEvents}
          liveDayLabel={liveDayLabel}
          showDay={showDay}
          dayflow={dayflow}
          clothing={clothing}
          wovenNames={split.woven.map((s: any) => String(s?.label || s?.name || "").trim()).filter(Boolean)}
          includedInRoute={includedInRoute}
          pulseState={pulseState}
          liveFailure={liveFailure}
          liveFailureSentence={liveFailureSentence}
          pulseBuckets={pulseBuckets}
          showExplore={pulseBuckets.tonight.length > 0 || pulseBuckets.thisWeek.length > 0 || aroundPlaceScopeAvailable}
          pulseSources={pulseSources}
          liveSheetTriggerRef={liveSheetTriggerRef}
          openLiveSheet={openLiveSheet}
        />
      )}

      {/* Blitz uses the trusted day anchor for every place. */}
      {phase === "done" && hasAnchor && !serviceRefusal && !anchorUnresolved && (
        <BlitzCard
          t={t}
          lang={lang}
          mode={mode}
          anchorLabel={anchorLabel}
          dayOnScreen={dayOnScreen}
          blitz={() => blitz()}
          sharePositionForBlitz={sharePositionForBlitz}
          blitzPositionFailed={blitzPositionFailed}
          blitzPhase={blitzPhase}
          blitzResult={blitzResult}
          typedPlaceLabel={typedPlaceLabel}
        />
      )}

      {savedDays.length > 0 && (
        <SavedDays t={t} lang={lang} savedDays={savedDays} restoreEntry={restoreEntry} removeSavedDay={removeSavedDay} />
      )}
      </main>

      {/* The wide-screen map column is the "Map of the day" landmark; the
          map's own canvas region inside it is named "Interactive map", so
          the two are not one name twice. */}
      {splitLayout && (
        <aside aria-label={t("Karta över dagen", "Map of the day")} className="sticky top-4 h-[calc(100dvh-2rem)] min-h-[30rem]">
          {routeMap}
        </aside>
      )}

      {/* Live navigation reads source data; explicit occurrence choice reuses
          the day's bounded commitment/recomposition path. */}
      {liveSheetOpen && (
        <LiveSheet
          lang={lang}
          t={t}
          anchorLabel={anchorLabel}
          anchorIsPosition={anchorIsPosition}
          selected={selected}
          liveDayLabel={liveDayLabel}
          liveSheetTime={liveSheetTime}
          liveSheetSort={liveSheetSort}
          setLiveSheetSort={changeLiveSheetSort}
          setLiveSheetTime={requestLiveSheetTime}
          planningDate={lastComposeDateIsoRef.current}
          planningAvailable={phase === "done" && !dayIsStale && !restoredAt && !stopEditPending && !livePlanPending}
          onPlanOccurrence={planWithLiveOccurrence}
          onRetry={() => { liveSheetPeriodAutomaticRef.current = false; requestLiveSheetScope(liveSheetScope, liveSheetTime, true).catch(() => {}); }}
          liveSheetScope={liveSheetScope}
          requestLiveSheetScope={(scope) => { liveSheetPeriodAutomaticRef.current = false; requestLiveSheetScope(scope).catch(() => {}); }}
          aroundPlaceScopeAvailable={aroundPlaceScopeAvailable}
          inPlaceScopeAvailable={inPlaceScopeAvailable}
          routeScopeAvailable={routeScopeAvailable}
          liveQueryPending={liveQueryPending}
          liveQueryGeoHint={liveQueryGeoHint}
          liveQueryError={liveQueryError}
          liveFallback={liveFallback}
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
