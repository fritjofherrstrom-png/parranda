import { createPortal } from "react-dom";
import { useLayoutEffect, useRef, type ReactNode } from "react";
import { liveStopChoiceId } from "../../lib/live-stop-choice.mjs";
import { stopIdentity as changeStopIdentity } from "../../lib/day-change.mjs";
/**
 * THE ROUTE as a line ("Linje"): every core stop is a station on one route-
 * coloured line, the walk INTO a stop is the segment above it, daypart headings
 * cross the line where that part of the day begins, and a woven live event is a
 * transfer — the Live colour, attached after the line it extends.
 *
 * It renders what the orchestrator already decided; it owns no request, no
 * race guard and no ledger. Every verb it offers (keep, dismiss, add, release)
 * is the orchestrator's own function, handed in by name.
 *
 * Grammar kept from the September tidy-up (docs/APP_ARCHITECTURE_AND_HIERARCHY.md):
 *   - the route's evidence (what the line is, what the numbers are, how the day
 *     was assembled) is stated once, in this section's About line;
 *   - daypart headings come from stop.daypart only, never by reordering;
 *   - detours are collapsed, dashed, and explicitly not the route.
 */
import { lineProgress } from "../../lib/line-progress.mjs";
import { eventSourceLink } from "../../lib/pulse-view.mjs";
import LiveEventTiming from "./LiveEventTiming";
import VenueMentions from "./VenueMentions";
import { normalizeVisitContent } from "../../../../shared/visit-content.mjs";
import { mapsPlaceUrl } from "../../lib/maps-links.mjs";
import { selectedDayHoursLabel } from "../../lib/selected-day-hours.mjs";
import { stopHoursUnknown, stopWebsiteUrl, stopMatchedPreferences, stopPlaceDetails, stopRowKindLabel, stopSourceLabel } from "../../lib/stop-card-facts.mjs";
import { walkingDistanceLabel, type RouteContextSuggestion } from "../../lib/route-context-view.mjs";
import {
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ClockIcon,
  ExternalIcon,
  HalfCircleIcon,
  KeepIcon,
  LocationIcon,
  MinusIcon,
  PlusIcon,
  RouteIcon,
  ShuffleIcon,
  WalkIcon,
} from "../shared/icons";
import {
  busyButton,
  buttonClass,
  choiceOn,
  controlPill44,
  dataLine,
  Eyebrow,
  ExternalLinkText,
  inlineLinkTarget,
  labelChip,
  pressable,
} from "../shared/ui";
import { DAYPART_LABELS, label, partialPreferenceLabels, pickLabel, type Lang, type Translate } from "./copy";
import { canCommitTo, type Commitments } from "./commitments";
import StopCategory, { stopCategoryLabel } from "./StopCategory";
import type { PositionSession } from "./useFollowPosition";
import WalkingContinuation from "./WalkingContinuation";
import { dayHasPhotos, normalizeStopAbout, normalizeStopMedia, normalizeStopSubtitle } from "../../lib/place-media.mjs";
import { StopPhotoFigure, StopPhotoTile } from "./StopPhoto";
import StopAbout from "./StopAbout";
import DayCredits from "./DayCredits";

type Leg = { km: number | null; minutes: number | null };

const NO_NEW_STOPS: ReadonlySet<string> = new Set();

/**
 * A status beside a stop's name or kind (Kept, Closed today, New, You're
 * here): `labelChip`'s shape in a tone of its own. A status, never a control.
 */
const statusChip = (tone: string) =>
  `inline-flex items-center gap-1 rounded-parranda-tag bg-parranda-fill px-2 py-0.5 text-13 font-semibold leading-snug ${tone}`;

/**
 * The open stop's edits (Keep, Replace, Remove): the quiet tone's words with
 * their signs, written out so all three fit one row at phone width (a 6px gap
 * to the sign, no gap between words; each word's own fill keeps them apart
 * under the pointer). Remove, the one edit that only takes away, sits in a
 * quieter ink that comes up to full ink under the pointer (never clay text on
 * the hover fill: that falls under 4.5:1 in day mode).
 */
const editAction =
  `inline-flex min-h-11 items-center gap-1.5 rounded-parranda-btn px-2 text-13 font-bold ${pressable} aria-disabled:opacity-60 aria-busy:cursor-progress hover:bg-parranda-fill active:bg-parranda-fill-strong`;
const editQuiet = `${editAction} text-parranda-ink`;
const editRemove = `${editAction} text-parranda-ink-muted hover:text-parranda-ink`;

/**
 * Where an open stop's backdrop starts in its list item: below the walk into
 * it and its daypart heading, so the tint begins at the stop's own row. Both
 * have fixed heights (the walk `h-8`; the heading `mt-6 h-6 mb-2`).
 */
function backdropTop(hasLeg: boolean, hasHeading: boolean): string {
  if (hasLeg && hasHeading) return "before:top-22";
  if (hasHeading) return "before:top-14";
  if (hasLeg) return "before:top-8";
  return "before:top-0";
}

/**
 * How the day was assembled, as one line opened on request, beside the map it
 * qualifies. Every fact is still on the page (and read by assistive tech when
 * opened). How Maps walks the route is said beside the Maps action.
 */
function AboutDayAndMap({ t, lang, stops, assemblyNotes = [], routeLineIsSketch, dayContextNote }: {
  t: Translate;
  lang: Lang;
  /** The day's stops: their photo and excerpt credits close the list. */
  stops: readonly object[];
  assemblyNotes?: string[];
  routeLineIsSketch: boolean;
  dayContextNote: string | null | undefined;
}) {
  // The page's colophon: a full-width row under one hairline, closed by
  // default. Opened, it reads as two labelled parts: how the day was made,
  // then the images and text it shows.
  return (
    <details className="group border-t-line border-parranda-line-faint pb-12 pt-2">
      <summary className="flex min-h-12 w-full cursor-pointer list-none items-center justify-between gap-3 text-13 font-semibold text-parranda-ink-muted transition-colors hover:text-parranda-ink [&::-webkit-details-marker]:hidden">
        {t("Om dagen och kartan", "About this day and map")}
        <ChevronDownIcon className="h-4 w-4 shrink-0 transition-transform duration-200 ease-out group-open:rotate-180" />
      </summary>
      <div className="flex flex-col gap-3 pb-2 pt-1 text-13 leading-relaxed text-parranda-ink-meta">
        <div className="flex flex-col gap-1.5">
          <Eyebrow>{t("Så gjordes dagen", "How this day was made")}</Eyebrow>
          <ul className="flex flex-col gap-1.5">
            {assemblyNotes.map((note) => <li key={note}>{note}</li>)}
            {routeLineIsSketch && <li>{t("Nålarna visar stoppen. Ingen gångväg har bekräftats på kartan.", "The pins show the stops. A walking path has not been confirmed on the map.")}</li>}
            <li>{t("Avstånd och gångtider är uppskattningar.", "Distances and walking times are estimates.")}</li>
            {dayContextNote && <li>{dayContextNote}</li>}
          </ul>
        </div>
        <DayCredits stops={stops} t={t} lang={lang} />
      </div>
    </details>
  );
}

export default function StopLine({
  t,
  lang,
  stale,
  newStopIdentities = NO_NEW_STOPS,
  routeLineIsSketch,
  dayContextNote,
  assemblyNotes = [],
  split,
  routeStops,
  legForStop,
  startLeg,
  finishLeg,
  anchorIsPosition,
  walkingDestination = null,
  continuationAllowed = false,
  mapsPlaceContext,
  expandedStopKey,
  setExpandedStopKey,
  expandedCandidateKey,
  setExpandedCandidateKey,
  commitments,
  confirmedLiveKeepIds = [],
  selected,
  releaseCommitment,
  keepStop,
  dismissStop,
  removeStop,
  editPending = false,
  commit,
  eveningEvent,
  selectedDate,
  dayOffset,
  follow,
  following,
  canFollowToday,
  onToggleFollow,
  routeContextSuggestions,
  detoursOpen,
  actions = null,
  continuesFromMap = false,
  detoursHost = null,
  aboutHost = null,
  setDetoursOpen,
}: {
  t: Translate;
  lang: Lang;
  stale: boolean;
  /** Stops the last adjustment added, using the change summary's place/occurrence identity. */
  newStopIdentities?: ReadonlySet<string>;
  routeLineIsSketch: boolean;
  dayContextNote: string | null | undefined;
  /** Where the places came from and how the day sits on the clock. */
  assemblyNotes?: string[];
  split: { core: any[]; woven: any[] };
  routeStops: any[];
  legForStop: (stop: any) => Leg | null;
  startLeg?: (Leg & { label: string }) | null;
  finishLeg?: (Leg & { label: string }) | null;
  anchorIsPosition?: boolean;
  walkingDestination?: { lat?: number; lng?: number; label?: string | null } | null;
  continuationAllowed?: boolean;
  mapsPlaceContext: string | null | undefined;
  expandedStopKey: string | null;
  setExpandedStopKey: (key: string | null) => void;
  expandedCandidateKey: string | null;
  setExpandedCandidateKey: (key: string | null) => void;
  commitments: Commitments;
  confirmedLiveKeepIds?: string[];
  selected: string[];
  releaseCommitment: (identity: string) => void;
  keepStop: (identity: string, stopLabel: string) => void;
  dismissStop: (identity: string, stopLabel: string) => void;
  removeStop: (identity: string, stopLabel: string) => void;
  editPending?: boolean;
  commit: (identity: string, kind: "exclude" | "pin", commitLabel: string, liveAction?: "remove" | "replace") => void;
  eveningEvent: any;
  selectedDate: string | null | undefined;
  dayOffset: 0 | 1;
  follow: PositionSession;
  following: boolean;
  canFollowToday: boolean;
  onToggleFollow: () => void;
  routeContextSuggestions: RouteContextSuggestion[];
  detoursOpen: boolean;
  /** The walk's Maps card, Save and Share: where the line ends. */
  actions?: ReactNode;
  /** A phone: the map stands right above, so the line starts at its edge. */
  continuesFromMap?: boolean;
  /** Where the detours and About render below Live and Blitz (Linje 2). */
  detoursHost?: HTMLElement | null;
  aboutHost?: HTMLElement | null;
  setDetoursOpen: (update: (cur: boolean) => boolean) => void;
}) {
  // Read as each station reads its heading below: the first one always opens its daypart.
  const firstDaypart = String((split.core[0] as any)?.daypart || "");
  const opensWithDaypart = Boolean(firstDaypart && label(DAYPART_LABELS, firstDaypart, lang));
  const legLabel = (leg: Leg) =>
    `${leg.minutes != null ? `${leg.minutes} min` : ""}${leg.minutes != null && leg.km != null ? " · " : ""}${leg.km != null ? walkingDistanceLabel(leg.km, lang) : ""}`;
  // Place media (docs/PLACE_MEDIA.md): rows carry a tile only on a day with at
  // least one photo; a day without photos renders exactly as before.
  const withPhotos = dayHasPhotos(split.core);

  // SCROLL STABILITY. Opening a stop closes the one that was open; when that
  // one sat above, its panel (photo, words, actions: easily 650px) left the
  // page and the tapped row jumped up and off the screen. The tap records
  // where its row stood; after React has laid out the new state, before
  // paint, the page scrolls by however far the row moved, so it stays under
  // the finger. Then the opened stop is brought into view only as far as it
  // must ("nearest"), smoothly unless the reader asked for less motion.
  // At the top of the page there is nothing to scroll back into: closing a
  // stop above can still move the tapped row up. Then every item the page
  // could not hold starts where it stood and glides to its new place (FLIP),
  // so nothing jumps; the opened stop is brought into view after the glide.
  // Under reduced motion the items settle at once, without the glide.
  const rowRefs = useRef(new Map<string, HTMLButtonElement>());
  const rowAnchor = useRef<{ key: string; top: number; opening: boolean; items: Map<Element, number> } | null>(null);
  useLayoutEffect(() => {
    const anchor = rowAnchor.current;
    rowAnchor.current = null;
    if (!anchor) return;
    const row = rowRefs.current.get(anchor.key);
    if (!row || !row.isConnected) return;
    const moved = row.getBoundingClientRect().top - anchor.top;
    if (Math.abs(moved) >= 1) window.scrollBy({ top: moved, left: 0, behavior: "instant" });
    const reduce = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const glides: Animation[] = [];
    if (!reduce) {
      for (const [item, before] of anchor.items) {
        if (!item.isConnected || typeof (item as HTMLElement).animate !== "function") continue;
        const dy = before - item.getBoundingClientRect().top;
        if (Math.abs(dy) < 1) continue;
        glides.push((item as HTMLElement).animate(
          [{ transform: `translateY(${dy}px)` }, { transform: "translateY(0)" }],
          // A long way gets a little longer and an even curve, so no single
          // frame carries the item far (a steep ease-out moved ~200px in one).
          { duration: Math.min(440, 240 + Math.abs(dy) * 0.25), easing: "cubic-bezier(0.45, 0, 0.2, 1)" },
        ));
      }
    }
    if (!anchor.opening) return;
    const item = row.closest("li");
    if (!item || typeof item.scrollIntoView !== "function") return;
    const reveal = () => { if (item.isConnected) item.scrollIntoView({ block: "nearest", behavior: reduce ? "auto" : "smooth" }); };
    if (glides.length) Promise.allSettled(glides.map((glide) => glide.finished)).then(reveal);
    else reveal();
  }, [expandedStopKey]);

  /** Where each item of the line stood when a row was tapped. */
  const lineItemTops = (from: Element) => {
    const list = from.closest("ol");
    const tops = new Map<Element, number>();
    if (list) for (const child of Array.from(list.children)) tops.set(child, child.getBoundingClientRect().top);
    return tops;
  };

  // The orchestrator owns one opt-in location session. This line only reads
  // it for today's stations; the map can also orient a future-day reader.
  const canFollow = follow.supported && canFollowToday;
  const progress = following && follow.state.status === "tracking" && follow.state.position.accuracy <= 120
    ? lineProgress(split.core, follow.state.position)
    : null;
  const currentIndex = progress?.state === "at" ? progress.index : progress?.state === "toward" ? progress.next : null;
  const coreName = (index: number) => String(split.core[index]?.label || split.core[index]?.name || "").trim();
  const followStatus = !following
    ? null
    : follow.state.status === "locating"
      ? t("Hämtar din position …", "Finding your position …")
      : follow.state.status === "denied"
        ? t("Positionen blockerades. Tillåt platsdelning för att följa dagen.", "Location was blocked. Allow location sharing to follow the day.")
        : follow.state.status === "paused"
          ? t("Positionsvisningen är pausad medan sidan är i bakgrunden.", "Location is paused while the page is in the background.")
        : follow.state.status === "unavailable"
          ? t("Din position kunde inte hämtas just nu.", "Your position couldn't be found right now.")
          : follow.state.status === "tracking" && follow.state.position.accuracy > 120
            ? t("Positionen är ungefärlig — kan inte avgöra vilket stopp du är vid.", "Your position is approximate — can't tell which stop you're at.")
          : progress?.state === "at"
            ? t(`Du är vid ${coreName(progress.index)}`, `You're at ${coreName(progress.index)}`)
            : progress?.state === "toward"
              ? t(
                  `Nästa: ${coreName(progress.next)} · ${walkingDistanceLabel(progress.toNextKm, "sv")} bort`,
                  `Next: ${coreName(progress.next)} · ${walkingDistanceLabel(progress.toNextKm, "en")} away`,
                )
              : progress?.state === "off"
                ? t("Du är inte nära rutten just nu.", "You're not near the route right now.")
                : null;

  // HOW THE DAY WAS ASSEMBLED — one line, opened on request, said once where
  // the line ends: it qualifies the stops, their walks and the map above
  // them. On a phone the map's still overview stands in the day's header,
  // between the title and the facts; wide screens keep the map beside the day.
  const about = (
    <AboutDayAndMap t={t} lang={lang} stops={split.core} assemblyNotes={assemblyNotes} routeLineIsSketch={routeLineIsSketch} dayContextNote={dayContextNote} />
  );

  const detours = (routeContextSuggestions.length > 0 && (
      // One aside row, the same anatomy as Blitz beside it: a sign, a name, a
      // chevron, and its caption as one Meta line right under the row. Dashed,
      // because these ideas are explicitly not in the day.
      <div className="flex flex-col gap-2">
        <div className="flex flex-col gap-1">
          <button
            type="button"
            aria-expanded={detoursOpen}
            onClick={() => setDetoursOpen((cur) => !cur)}
            className={buttonClass("dashed", "min-h-13 w-full justify-between px-4 py-3 text-left")}
          >
            <RouteIcon className="mr-1 h-5 w-5 shrink-0 text-parranda-ink-meta" />
            <span className="min-w-0 flex-1 text-17 font-bold leading-tight text-parranda-ink">
              {routeContextSuggestions.length}{" "}
              {routeContextSuggestions.length === 1
                ? t("idé nära din rutt", "detour idea near your route")
                : t("idéer nära din rutt", "detour ideas near your route")}
            </span>
            <ChevronDownIcon className={"h-4 w-4 shrink-0 text-parranda-ink-meta transition-transform duration-200 ease-out " + (detoursOpen ? "rotate-180" : "")} />
          </button>
          <p className={`${dataLine} px-4 text-pretty`}>
            {t(
              "Fler idéer som inte ingår i dagens rutt.",
              "More ideas outside today's route.",
            )}
          </p>
        </div>
        {detoursOpen && (
          <ul className="grid gap-2 motion-safe:animate-panel-in sm:grid-cols-2">
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
              const committable = canCommitTo(stop);
              const kindLabel = stopCategoryLabel(stop, lang);
              const candidatePanelId = `candidate-panel-detour-${index}`;
              const expanded = expandedCandidateKey === candidateKey;
              return (
                <li key={stop.id || stop.candidate_id || stop.place_id || name} className="rounded-parranda border-line border-dashed border-parranda-line-firm px-3.5 py-1.5">
                  <button
                    type="button"
                    aria-expanded={expanded}
                    aria-controls={candidatePanelId}
                    onClick={() => setExpandedCandidateKey(expanded ? null : candidateKey)}
                    className="flex min-h-11 w-full items-center justify-between gap-3 text-left text-15 font-bold leading-tight text-parranda-ink transition-colors hover:text-parranda-clay"
                  >
                    <span>{name}</span>
                    {expanded ? <MinusIcon className="h-4 w-4 shrink-0 text-parranda-ink" /> : <PlusIcon className="h-4 w-4 shrink-0 text-parranda-ink-meta" />}
                  </button>
                  {kindLabel && <div className="pb-1.5"><StopCategory type={stop.type} label={kindLabel} /></div>}
                  <p className={`${dataLine} pb-1.5`}>
                    {walkingDistanceLabel(stop.distance_km, lang)} {t("från", "from")} {stop.route_stop_name}
                  </p>
                  {expanded && (
                    <div id={candidatePanelId} className="mb-1.5 mt-1 border-t-line border-parranda-line-faint pt-3">
                      {/* Secondary: the page has one filled action, the walk in Maps. */}
                      {url && (
                        <a
                          href={url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={buttonClass("secondary", "min-h-11 w-full px-4 text-13")}
                        >
                          {t("Öppna platsen i Maps", "Open place in Maps")}
                          <ExternalIcon />
                        </a>
                      )}
                      {/* Add is the same commitment as Keep, reached from
                          a candidate the day did not choose. The server
                          still has to resolve it against its own loaded
                          pool — an unhonoured pin is reported, not faked. */}
                      {candidateId && (commitments[candidateId]?.kind === "pin" || committable) && (
                        <button
                          type="button"
                          onClick={() =>
                            commitments[candidateId]?.kind === "pin"
                              ? releaseCommitment(candidateId)
                              : commit(candidateId, "pin", name)
                          }
                          // In the day: the system's one chosen fill (ink).
                          // Not yet: a quiet word that fills under the pointer.
                          className={`mt-2 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-parranda-btn px-4 text-13 ${
                            commitments[candidateId]?.kind === "pin"
                              ? `${choiceOn} hover:brightness-110`
                              : `font-bold text-parranda-ink hover:bg-parranda-fill active:bg-parranda-fill-strong ${pressable}`
                          }`}
                        >
                          <KeepIcon className="h-4 w-4" />
                          {commitments[candidateId]?.kind === "pin"
                            ? t("Med i dagen — släpp", "In my day — release")
                            : t("Lägg till i min dag", "Add to my day")}
                        </button>
                      )}
                      {(!candidateId || (commitments[candidateId]?.kind !== "pin" && !committable)) && (
                        <p className="mt-2 text-13 leading-relaxed text-parranda-ink-meta">
                          {t("Tips att utforska — platsen kan inte läggas till i den här rutten just nu.",
                            "A nearby tip — this place can't be added to this route right now.")}
                        </p>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    ));

  return (
    <section
      aria-label={t("Rutten", "The route")}
      // The stops continue the day header directly above them, so they sit
      // closer than the page's section rhythm.
      // While an adjustment rebuilds the day, the day on screen stays — never
      // a silent swap — but reads as the one being replaced: its names fade,
      // the ember line goes quiet and one soft wash slides down it again.
      data-rebuilding={stale || undefined}
      className="-mt-8 flex flex-col"
    >
      {/* Linje 2 board: no heading row of its own. On a phone the line comes
          out of the map above and runs through this row; the first daypart
          ("Evening") sits on the line beside Follow the day. */}
      <div className={"stop-line-heading-row relative mb-1 flex min-h-11 flex-wrap items-center justify-between gap-x-3 pl-14 " +
        (continuesFromMap || opensWithDaypart ? "before:pointer-events-none before:absolute before:-bottom-2 before:left-[19px] before:w-1.5 before:content-[''] " +
          // Only the phone's map band is full-bleed (below sm), so only there
          // does the line come out of it; from sm the map is a rounded card
          // and the line starts at the first daypart, as on desktop.
          (continuesFromMap ? "max-sm:before:-top-4 sm:before:top-1/2 " : "before:top-1/2 ") +
          (stale ? "before:bg-parranda-line-faint " : "before:bg-parranda-ember ") : "")}>
        <h2 className="sr-only">{t("Stoppen i ordning", "The stops, in order")}</h2>
        {/* The daypart crosses the line as a notch cut into it (paper), not
            an ink bar laid over it. Only the part over the line shows. */}
        {opensWithDaypart && <h3 className="type-eyebrow relative min-h-9 text-parranda-glow">
          <span aria-hidden="true" className="stop-line-daypart-crossing absolute top-1/2 h-1 w-3 translate-x-0.5 -translate-y-1/2 bg-parranda-paper" />
          {label(DAYPART_LABELS, split.core[0].daypart, lang)}
        </h3>}
        {canFollow && (
          <button
            type="button"
            aria-pressed={following}
            onClick={onToggleFollow}
            // The day's control pill, like Change place and Adjust. Its sign
            // is a position, not an ember ring: circles on the line are its
            // stations. Following, it takes the one "chosen" fill, ink.
            className={following
              ? `inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-parranda-btn px-3 text-13 ${choiceOn} hover:brightness-110`
              : controlPill44}
          >
            <LocationIcon className="h-4 w-4" />
            {following ? t("Sluta följa", "Stop following") : t("Följ dagen", "Follow the day")}
          </button>
        )}
      </div>
      {followStatus && (
        <p className="mb-1 pl-14 text-13 font-semibold text-parranda-ink" aria-live="polite">{followStatus}</p>
      )}
      <WalkingContinuation t={t} stops={routeStops} follow={follow}
        enabled={continuationAllowed && canFollowToday && following && !stale} destination={walkingDestination} />
      {/* Core stops only, grouped under daypart headings taken from
          stop.daypart — only groups that exist render, and the engine's
          order is never changed to force a grouping. The walk INTO a stop
          comes before its daypart heading, so a heading always opens the
          part of the day it names. A woven live event is NOT an ordinary
          POI — it renders once below, as an attached route extension.
          The line itself is the list's ::before: one continuous segment
          from the first station to the last. */}
      {startLeg && (
        <p className={`${dataLine} flex min-h-8 flex-wrap items-center gap-x-1.5 pl-14`}>
          <WalkIcon className="h-3.5 w-3.5" />
          <span>{t(`Från ${startLeg.label}`, `From ${startLeg.label}`)}</span>
          <span aria-hidden="true">·</span>
          <span>{legLabel(startLeg)}</span>
        </p>
      )}
      <ol
        className={"relative flex flex-col before:pointer-events-none before:absolute before:bottom-7 before:left-[19px] before:w-1.5 before:transition-colors before:content-[''] " +
          // A list that opens with a daypart starts its line at that
          // heading's crossing mark, so the mark caps the line: the heading
          // row's stub runs on into this one (overlapping it, square-ended),
          // so the two read as one unbroken line with no seam under the row.
          (continuesFromMap || opensWithDaypart ? "before:top-0 before:rounded-b-full " : "before:top-7 before:rounded-full ") +
          (stale ? "route-redraw before:bg-parranda-line-faint" : "before:bg-parranda-ember")}
        aria-label={t("Stoppen i ordning", "The stops, in order")}
      >
        {split.core.map((stop: any, i: number) => {
          const name = String(stop?.label || stop?.name || "").trim();
          if (!name) return null;
          const routeNumber = routeStops.indexOf(stop) + 1;
          const leg = routeNumber === 1 ? null : legForStop(stop);
          const prevName = routeNumber > 1 ? String((split.core[i - 1] as any)?.label || (split.core[i - 1] as any)?.name || "").trim() : "";
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
          const hoursLabel = selectedDayHoursLabel(stop?.selected_day_hours, lang);
          const hoursClosed = stop?.selected_day_hours?.status === "closed";
          const website = stopWebsiteUrl(stop);
          const placeDetails = stopPlaceDetails(stop, lang);
          const visitContent = normalizeVisitContent(stop?.visit_content);
          const media = normalizeStopMedia(stop);
          const subtitle = normalizeStopSubtitle(stop);
          // A curated visit note wins over the excerpt (the normalizer agrees).
          const about = visitContent ? null : normalizeStopAbout(stop);
          const partialLabels = partialPreferenceLabels(stop, selected, lang);
          const matchedLabels = stopMatchedPreferences(stop, selected).map((key) => pickLabel(key, lang));
          const stopKindLabel = stopRowKindLabel(stop, stopCategoryLabel(stop, lang), lang);
          const hoursUnknown = stopHoursUnknown(stop);
          const sourceLabel = stopSourceLabel(stop, lang);
          // The row badge already names the kind; the open stop repeats it only
          // when the row kept something else (a specific second-hand category).
          const panelKindLabel = placeDetails.kindLabel && placeDetails.kindLabel !== stopKindLabel ? placeDetails.kindLabel : null;
          const behind = currentIndex != null && i < currentIndex;
          const isCurrent = currentIndex === i;
          // The station: a 32px disc with a 3px edge inside a 44px target, as
          // the map draws its markers, so list and map read as one line. Ink
          // edge on paper by default; terracotta when its stop is open (the
          // map's selected marker); ember edge with a still halo for where
          // you are; a check on a quiet edge once behind you. The last stop is
          // a station like the others: ink fill means "chosen" on this page.
          const disc = stale
            ? "border-parranda-line bg-parranda-paper text-parranda-ink-meta"
            : expanded
            ? "border-parranda-ink bg-parranda-terracotta text-parranda-on-terracotta"
            : isCurrent
              ? "border-parranda-ember bg-parranda-paper text-parranda-ink shadow-[0_0_0_4px_rgb(var(--p-color-paper)),0_0_0_6px_rgb(var(--p-color-ember))]"
              : behind
                ? "border-parranda-line-firm bg-parranda-paper text-parranda-ink-meta"
                : "border-parranda-ink bg-parranda-paper text-parranda-ink";
          // The ring plays once when progress reaches this station. It stays
          // on the current station in every state (open, closed, rebuilding),
          // so opening and closing the stop never takes it off and replays it.
          const ring = isCurrent ? " motion-safe:animate-ring-once" : "";
          const legShown = Boolean(leg && (leg.minutes != null || leg.km != null));
          const laterDaypart = Boolean(daypartHeading && i > 0);
          return (
            <li
              key={stopKey}
              // An open stop sits on a faint backdrop that starts right of the
              // line: the line and its station stay on paper, the stop's own
              // column reads as one opened thing. On the item, not the panel:
              // the panel itself stays card-free.
              className={"relative flex scroll-mt-4 flex-col" + (expanded
                ? ` before:pointer-events-none before:absolute before:-right-2 before:bottom-0 before:left-12 before:rounded-parranda before:bg-parranda-fill-faint before:content-[''] ${backdropTop(legShown, laterDaypart)}`
                : "")}
            >
              {legShown && leg && (
                // Linje 2 board: the walk between stations as one quiet fact,
                // "9 min · 700 m". Under a kilometre in metres, to the nearest
                // hundred the estimate already has. The sign is hidden from
                // screen readers, so they hear what the numbers are: a walk,
                // and where it starts.
                <span className={`${dataLine} flex h-8 items-center gap-1.5 pl-14 transition-opacity${stale ? " opacity-45" : ""}`}>
                  <WalkIcon className="h-3.5 w-3.5" />
                  <span className="sr-only">
                    {prevName ? t(`Promenad från ${prevName}: `, `Walk from ${prevName}: `) : t("Till fots: ", "On foot: ")}
                  </span>
                  {leg.minutes != null && <span>{leg.minutes} min</span>}
                  {leg.minutes != null && leg.km != null ? <><span className="sr-only"> · </span><span aria-hidden="true">·</span></> : null}
                  {leg.km != null ? <span>{leg.km < 1 && leg.km > 0 ? `${Math.max(100, Math.round(leg.km * 10) * 100)} m` : walkingDistanceLabel(leg.km, lang)}</span> : null}
                </span>
              )}
              {/* A later daypart crosses the line with room above it; the
                  first sits right under the stops' heading. */}
              {laterDaypart && (
                <h3 className="type-eyebrow relative mb-2 mt-6 flex h-6 items-center pl-14 text-parranda-glow">
                  <span aria-hidden="true" className="absolute left-4 top-1/2 h-1 w-3 -translate-y-1/2 bg-parranda-paper" />
                  {daypartHeading}
                </h3>
              )}
              {/* The stop row is a DISCLOSURE, not an external link: tapping
                  it opens an inline panel instead of ejecting to Google Maps.
                  The Maps jump becomes a deliberate action inside the panel.
                  Its hover and press fill start right of the station (the
                  ::before), so the line and the disc stay on paper; nothing
                  in a full-width row scales. */}
              <button
                type="button"
                aria-expanded={expanded}
                aria-controls={panelId}
                ref={(el) => {
                  if (el) rowRefs.current.set(stopKey, el);
                  else rowRefs.current.delete(stopKey);
                }}
                onClick={(event) => {
                  rowAnchor.current = { key: stopKey, top: event.currentTarget.getBoundingClientRect().top, opening: !expanded, items: lineItemTops(event.currentTarget) };
                  setExpandedStopKey(expanded ? null : stopKey);
                }}
                className={"group relative flex min-h-16 w-full items-center gap-3 py-2 pr-1 text-left before:pointer-events-none before:absolute before:inset-y-0 before:-right-2 before:left-12 before:rounded-parranda-btn before:transition-[background-color] before:duration-150 before:ease-out before:content-['']" +
                  (expanded ? "" : " hover:before:bg-parranda-fill-faint active:before:bg-parranda-fill")}
              >
                <span className="type-data relative z-(--p-z-raised) flex h-11 w-11 shrink-0 items-center justify-center rounded-full">
                  <span
                    className={`flex h-8 w-8 items-center justify-center rounded-full border-3 text-13 font-bold transition-[background-color,border-color,color,scale] duration-150 ease-out motion-safe:group-active:scale-95 ${disc}${ring}`}
                  >
                    {behind ? <CheckIcon className="h-3.5 w-3.5" /> : routeNumber}
                    {behind && <span className="sr-only">{routeNumber}</span>}
                  </span>
                </span>
                <span className={"relative flex min-w-0 flex-1 flex-col gap-1 transition-opacity" + (stale ? " opacity-45" : "")}>
                  <span className={"flex flex-wrap items-center gap-x-2 gap-y-1 wrap-anywhere text-17 font-bold leading-tight " + (behind ? "text-parranda-ink-meta" : "text-parranda-ink")}>
                    {name}
                    {/* Named by the change line above ("4 stops swapped"):
                        which ones are new, for as long as that line stands. */}
                    {!stale && newStopIdentities.has(changeStopIdentity(stop) ?? "") && (
                      <span className={statusChip("text-parranda-ink-soft")}>{t("Ny", "New")}</span>
                    )}
                    {isCurrent && (
                      <span className={statusChip("text-parranda-ink")}>
                        {progress?.state === "at" ? t("Du är här", "You're here") : t("Nästa", "Next")}
                      </span>
                    )}
                  </span>
                  {/* What kind of place, at a glance: one meta line under the
                      name (sign + the stop's own kind). It is information, not
                      a control; the whole row stays the one disclosure. Kept
                      and source-closed facts stay visible as statuses; other
                      hours wait inside the place. */}
                  {(stopKindLabel || kept) && (
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      {stopKindLabel && <StopCategory type={stop?.type} label={stopKindLabel} glyph={!withPhotos} />}
                      {kept && (
                        // Clay only on the sign: clay text on the chip's fill
                        // falls under 4.5:1 in day mode; an icon needs 3:1.
                        <span className={statusChip("text-parranda-ink")}>
                          <KeepIcon className="h-3.5 w-3.5 text-parranda-clay" />
                          {t("Behålls", "Kept")}
                        </span>
                      )}
                    </span>
                  )}
                  {/* The source's "closed" is a sentence, too long for a chip:
                      its own meta line, signed by the clock. */}
                  {hoursClosed && hoursLabel && (
                    <span className="type-data flex items-start gap-1.5 text-13 leading-snug text-parranda-ink-soft">
                      <ClockIcon className="mt-px h-3.5 w-3.5" />
                      {hoursLabel}
                    </span>
                  )}
                </span>
                {/* The photo sits between the name and the chevron; the
                    station and the chevron stay where they are. While the
                    stop is open its figure shows the photo, so the tile steps
                    out of sight and keeps its width. */}
                {withPhotos && (
                  <span className={"relative shrink-0 transition-opacity" + (stale ? " opacity-45" : "") + (expanded && media ? " invisible" : "")}>
                    <StopPhotoTile key={media?.media_id ?? "glyph"} media={media} type={stop?.type} muted={behind} />
                  </span>
                )}
                <ChevronRightIcon
                  className={"relative h-3.5 w-3.5 shrink-0 transition-[rotate,color] duration-200 ease-out " + (expanded ? "rotate-90 text-parranda-ink" : "text-parranda-ink-meta group-hover:text-parranda-ink")}
                />
              </button>
              {expanded && (
                // The open stop continues the stop's own column, like its
                // name: the photo, what it is, what it does for the picks, its
                // facts, then two kinds of action. Going there leads, in soft
                // fills; changing the day follows, as quiet words under a
                // hairline. No card of its own: the item's backdrop holds it.
                <div id={panelId} className="relative mb-4 ml-14 mt-2 flex flex-col gap-4 motion-safe:animate-panel-in">
                  {/* What the place looks like and is, in sourced words, before
                      the facts: the photo, the kicker, then the excerpt. */}
                  {media && <StopPhotoFigure key={media.media_id} media={media} name={name} type={stop?.type} t={t} lang={lang} />}
                  {(subtitle || about) && <StopAbout subtitle={subtitle} about={about} t={t} lang={lang} />}
                  {/* Facts only, each beside its sign, at one size: first what
                      it does for the picks, as a Meta line marked with the
                      header's own 12px check, then the address and hours. The
                      schedule row is a bounded source fact for the selected
                      local day, never an "open now" claim. The walk into the
                      stop is already on the line above the row, read out with
                      where it starts. */}
                  {(panelKindLabel || matchedLabels.length > 0 || partialLabels.length > 0 || placeDetails.address || hoursLabel || hoursUnknown) && (
                    <div className="grid grid-cols-[1rem_minmax(0,1fr)] items-start gap-x-2 gap-y-1.5 text-13 leading-snug text-parranda-ink-soft">
                      {(panelKindLabel || matchedLabels.length > 0 || partialLabels.length > 0) && (
                        <>
                          <span aria-hidden="true" className="flex h-4 w-4 items-center justify-center">
                            {matchedLabels.length > 0 && <CheckIcon className="h-3 w-3 shrink-0 text-parranda-ink-soft" />}
                            {matchedLabels.length === 0 && partialLabels.length > 0 && <HalfCircleIcon className="h-3 w-3 shrink-0 text-parranda-glow" />}
                          </span>
                          <span className="type-data min-w-0 text-13 leading-snug text-parranda-ink-soft">
                            {[
                              panelKindLabel ? `${panelKindLabel}.` : "",
                              matchedLabels.length > 0 ? `${t("Matchar dina val:", "Matches your picks:")} ${matchedLabels.join(", ")}.` : "",
                              partialLabels.length > 0 ? `${t("Lösare träff för:", "A looser match for:")} ${partialLabels.join(", ")}.` : "",
                            ].filter(Boolean).join(" ")}
                          </span>
                        </>
                      )}
                      {placeDetails.address && <LocationIcon className="mt-px h-4 w-4 text-parranda-ink-meta" />}
                      {placeDetails.address && <span>{placeDetails.address}</span>}
                      {hoursLabel && <ClockIcon className="mt-px h-4 w-4 text-parranda-ink-meta" />}
                      {hoursLabel && <span>{hoursLabel}</span>}
                      {hoursUnknown && !hoursLabel && <ClockIcon className="mt-px h-4 w-4 text-parranda-ink-meta" />}
                      {hoursUnknown && !hoursLabel && (
                        <span>{t("Öppettider saknas för den valda dagen", "Opening hours unavailable for the selected day")}</span>
                      )}
                    </div>
                  )}
                  {(pin || website) && (
                    <div role="group" aria-label={t("Gå dit", "Go there")} className="flex flex-wrap gap-2">
                      {pin && (
                        <a href={pin} target="_blank" rel="noopener noreferrer" className={buttonClass("secondary", "min-h-11 px-4 text-13")}>
                          {t("Öppna i Maps", "Open in Maps")}<ExternalIcon className="h-3.5 w-3.5" />
                        </a>
                      )}
                      {website && (
                        <a href={website} target="_blank" rel="noopener noreferrer" className={buttonClass("secondary", "min-h-11 px-4 text-13")}>
                          {t("Webbplats", "Website")}<ExternalIcon className="h-3.5 w-3.5" />
                        </a>
                      )}
                    </div>
                  )}
                  {/* Changing the day: quiet words with their signs, one row
                      under a hairline, the first word's text on the pills'
                      edge above. A kept stop offers release, drawn as the
                      chosen state (ink); Replace and Remove keep their own
                      orchestration and busy contracts. */}
                  <div role="group" aria-label={t("Ändra stopp", "Edit stop")} className="border-t-line border-parranda-line-faint pt-2">
                    {/* The row sits 8px left, so every line of words (also a
                        wrapped one) starts on the pills' edge above. */}
                    <div className="-ml-2 flex flex-wrap items-center">
                    {hasRealId && (commitments[stopIdentity]?.kind === "pin" ? (
                      <button
                        type="button"
                        onClick={() => releaseCommitment(stopIdentity)}
                        className={`ml-2 inline-flex min-h-11 items-center gap-1.5 rounded-parranda-btn px-3 text-13 ${choiceOn} hover:brightness-110`}
                      >
                        <KeepIcon className="h-4 w-4" />
                        {t("Behålls — släpp", "Kept — release")}
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => keepStop(stopIdentity, name)}
                        className={editQuiet}
                      >
                        <KeepIcon className="h-4 w-4" />
                        {t("Behåll den här", "Keep this one")}
                      </button>
                    ))}
                    {hasRealId && commitments[stopIdentity]?.kind !== "pin" && (
                      <>
                        {/* Busy, not disabled, while the edit runs: the pressed
                            button keeps keyboard focus (ui.tsx busyButton). */}
                        <button
                          type="button"
                          {...busyButton(editPending, () => dismissStop(stopIdentity, name))}
                          title={t("Byt till ett liknande stopp", "Replace with a similar stop")}
                          className={editQuiet}
                        >
                          <ShuffleIcon className="h-4 w-4" />
                          {t("Byt", "Replace")}
                        </button>
                        <button
                          type="button"
                          {...busyButton(editPending, () => removeStop(stopIdentity, name))}
                          title={t("Ta bort stoppet utan ersättning", "Remove this stop without replacement")}
                          className={editRemove}
                        >
                          <MinusIcon className="h-4 w-4" />
                          {t("Ta bort", "Remove")}
                        </button>
                      </>
                    )}
                    </div>
                  </div>
                  {(visitContent || sourceLabel || stop?.candidate_status === "partial") && (
                    <details className="group/about">
                      <summary className="flex min-h-11 w-full cursor-pointer list-none items-center justify-between gap-3 text-13 font-semibold text-parranda-ink-meta transition-colors hover:text-parranda-ink [&::-webkit-details-marker]:hidden">
                        {visitContent ? t("Mer om platsen", "More about this place") : t("Om platsinformationen", "About this place information")}
                        <ChevronDownIcon className="h-4 w-4 shrink-0 transition-transform duration-200 ease-out group-open/about:rotate-180" />
                      </summary>
                      <div className="flex flex-col gap-2 pb-2">
                        {visitContent && (
                          <>
                            <p className="text-15 leading-relaxed text-parranda-ink-soft">{visitContent.text[lang]}</p>
                            <p className="text-13 leading-relaxed text-parranda-ink-meta">
                              {t("Platsnotis av Parranda", "Place note by Parranda")}{" · "}
                              <a href={visitContent.source_url} target="_blank" rel="noopener noreferrer"
                                className={`${inlineLinkTarget} underline decoration-parranda-line-strong underline-offset-4 hover:text-parranda-ink`}>
                                {t("Läs källan", "Read the source")}
                              </a>
                              <span className="block">
                                {t("Text kontrollerad", "Text checked")}{" "}
                                <time dateTime={visitContent.checked_on}>
                                  {new Intl.DateTimeFormat(lang === "sv" ? "sv-SE" : "en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(visitContent.checked_on))}
                                </time>
                              </span>
                            </p>
                          </>
                        )}
                        {(sourceLabel || stop?.candidate_status === "partial") && (
                          <p className="text-13 leading-relaxed text-parranda-ink-meta">
                            {stop?.candidate_status === "partial"
                              ? sourceLabel
                                ? t(`Källa: ${sourceLabel} · platsuppgifterna är inte bekräftade ännu`, `Source: ${sourceLabel} · place details are not yet confirmed`)
                                : t("Platsuppgifterna är inte bekräftade ännu", "Place details are not yet confirmed")
                              : t(`Källa: ${sourceLabel}`, `Source: ${sourceLabel}`)}
                          </p>
                        )}
                      </div>
                    </details>
                  )}
                  <VenueMentions stop={stop} t={t} lang={lang} />
                </div>
              )}
            </li>
          );
        })}
      </ol>

      {/* Route extension: the walking-validated evening event. One full
          presentation — a transfer station attached to the line it genuinely
          extends (it stays in the Google Maps route via the untouched full
          stop order). */}
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
          // The woven event belongs to the day being replaced as much as the
          // stops above it, so it fades with them while the rebuild runs.
          <div key={stop?.id} className={"flex flex-col transition-opacity" + (stale ? " opacity-45" : "")}>
            {legShown && leg && (
              <span className={`${dataLine} relative flex h-8 items-center gap-1.5 pl-14`}>
                <span
                  aria-hidden="true"
                  className="absolute bottom-0 left-[19px] top-0 w-1.5 rounded-full bg-[repeating-linear-gradient(to_bottom,rgb(var(--p-color-live))_0_6px,transparent_6px_11px)]"
                />
                <WalkIcon className="h-3.5 w-3.5" />
                {legLabel(leg)}
              </span>
            )}
            <div className={`${legShown ? "" : "mt-3 "}flex items-start gap-3`}>
              {/* A transfer station: the same 32px disc as the line's, in the
                  Live colour with its halo, inside the same 44px slot. */}
              <span className="type-data flex h-11 w-11 shrink-0 items-center justify-center rounded-full">
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-parranda-live text-13 font-bold text-parranda-on-live shadow-[0_0_0_3px_rgb(var(--p-color-paper)),0_0_0_5px_rgb(var(--p-color-live))]">
                  {routeNumber}
                </span>
              </span>
              <div className="min-w-0 flex-1 rounded-parranda border-line border-parranda-live/45 bg-parranda-live/8 p-4">
                <Eyebrow as="h3" tone="live" dot>{t("Live i din rutt", "Live in your route")}</Eyebrow>
                <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-parranda-ink">
                  {pin ? (
                    <a href={pin} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 min-w-11 items-center gap-1.5 text-17 font-bold leading-tight transition-colors hover:text-parranda-live">
                      {name}
                      <ExternalIcon className="h-3.5 w-3.5 text-parranda-ink-meta" />
                    </a>
                  ) : (
                    <span className="text-17 font-bold leading-tight">{name}</span>
                  )}
                </p>
                <LiveEventTiming event={stop} lang={lang} selectedDate={selectedDate} />
                {venue && venue !== name && <p className="mt-0.5 text-13 text-parranda-ink-muted">{venue}</p>}
                <p className="mt-1 text-13 text-parranda-ink-muted">
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
                {liveStopChoiceId(stop) && <div className="mt-3 flex flex-wrap gap-2">
                  {commitments[stop.live_occurrence_id]?.kind === "pin" ? (
                    <button type="button" className={buttonClass("secondary", "min-h-11 px-4 text-13")} onClick={() => releaseCommitment(stop.live_occurrence_id)}>{confirmedLiveKeepIds.includes(stop.live_occurrence_id)
                      ? t("Behålls — släpp", "Kept — release")
                      : t("Valt — släpp", "Selected — release")}</button>
                  ) : stop.live_choice_eligible === true && (
                    <button type="button" className={buttonClass("secondary", "min-h-11 px-4 text-13")} onClick={() => keepStop(stop.live_occurrence_id, name)}>{t("Behåll eventet", "Keep this event")}</button>
                  )}
                  <button type="button" className={buttonClass("secondary", "min-h-11 px-4 text-13")} onClick={() => commit(stop.live_occurrence_id, "exclude", name, "replace")}>{t("Byt event", "Try another event")}</button>
                  <button type="button" className={buttonClass("secondary", "min-h-11 px-4 text-13")} onClick={() => commit(stop.live_occurrence_id, "exclude", name, "remove")}>{t("Ta bort ur dagen", "Remove from day")}</button>
                </div>}
                {(sourceLabel || sourceLink) && (
                  <p className="mt-1 text-11 leading-snug text-parranda-ink-meta">
                    {sourceLabel && <>{t("Källa", "Source")}: {sourceLabel}</>}
                    {sourceLabel && sourceLink && " · "}
                    {sourceLink && (
                      <a href={sourceLink.href} target="_blank" rel="noopener noreferrer" className={`${inlineLinkTarget} underline decoration-parranda-line-firm underline-offset-2 hover:text-parranda-live`}>
                        <ExternalLinkText text={sourceLink.text} />
                      </a>
                    )}
                  </p>
                )}
              </div>
            </div>
          </div>
        );
      })}

      {finishLeg && (
        <p className={`${dataLine} flex min-h-8 flex-wrap items-center gap-x-1.5 pl-14`}>
          <WalkIcon className="h-3.5 w-3.5" />
          <span>{anchorIsPosition ? t(`Tillbaka till ${finishLeg.label}`, `Return to ${finishLeg.label}`) : t(`Till ${finishLeg.label}`, `To ${finishLeg.label}`)}</span>
          <span aria-hidden="true">·</span>
          <span>{legLabel(finishLeg)}</span>
        </p>
      )}
      {/* Linje 2: the line runs on into the walk's Maps action, so the
          route and the way to walk it read as one thing. */}
      {actions && (
        <div data-line-end="" className="relative mt-1 pt-4 before:pointer-events-none before:absolute before:left-[19px] before:-top-3 before:h-7 before:w-1.5 before:bg-parranda-ember before:content-['']">
          {actions}
        </div>
      )}
      {/* Linje 2 board: below the line come Live, then the detours, Blitz
          and "About this day and map" last. With hosts given (a route on
          screen), the detours and About render there; without, here. */}
      {aboutHost ? createPortal(about, aboutHost) : about}
      {/* Detours — collapsed by default (design handoff §3): optional ideas
          must never read as part of the route, and the caption stays visible
          even while collapsed. Their dots join the map only while open. */}
      {/* Close under the route's About line: they are one block, and a
          section-sized gap after the light About line read as missing content. */}
      {detoursHost ? (detours ? createPortal(detours, detoursHost) : null) : detours}
    </section>
  );
}
