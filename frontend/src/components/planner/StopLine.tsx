import { liveStopChoiceId } from "../../lib/live-stop-choice.mjs";
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
 *     was assembled) is stated beside the map, inside this section;
 *   - daypart headings come from stop.daypart only, never by reordering;
 *   - detours are collapsed, dashed, and explicitly not the route.
 */
import { useEffect, useState, type ReactNode } from "react";
import { lineProgress } from "../../lib/line-progress.mjs";
import { eventSourceLink, eventTiming } from "../../lib/pulse-view.mjs";
import { mapsPlaceUrl } from "../../lib/maps-links.mjs";
import { selectedDayHoursLabel } from "../../lib/selected-day-hours.mjs";
import { stopHoursUnknown, stopTypeLabel, stopWebsiteUrl, stopMatchedPreferences, stopPlaceDetails } from "../../lib/stop-card-facts.mjs";
import { stopCategoryFamily, type StopCategoryFamily } from "../../lib/stop-category.mjs";
import { walkingDistanceLabel, type RouteContextSuggestion } from "../../lib/route-context-view.mjs";
import {
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ClockIcon,
  CultureIcon,
  DrinkIcon,
  ExternalIcon,
  FoodIcon,
  KeepIcon,
  LocationIcon,
  MinusIcon,
  NatureIcon,
  PlusIcon,
  ShopIcon,
  ShuffleIcon,
  SightIcon,
  TrashIcon,
  WalkIcon,
} from "../shared/icons";
import { busyButton, buttonClass, compactPillTarget, dataLine, Eyebrow, ExternalLinkText, inlineLinkTarget } from "../shared/ui";
import { DAYPART_LABELS, label, partialPreferenceLabels, pickLabel, typeLabel, type Lang, type Translate } from "./copy";
import { canCommitTo, type Commitments } from "./commitments";
import { useFollowPosition } from "./useFollowPosition";

type Leg = { km: number | null; minutes: number | null };

const CATEGORY_ICONS: Record<StopCategoryFamily, (props: { className?: string }) => ReactNode> = {
  food: FoodIcon,
  drink: DrinkIcon,
  culture: CultureIcon,
  nature: NatureIcon,
  sight: SightIcon,
  shop: ShopIcon,
};

/** A stop's kind as a compact badge: the family's symbol and the kind's own
 *  words, on a quiet tint. Same shape for every category; an unknown family
 *  shows the words alone. */
function StopCategory({ type, label, muted }: { type: unknown; label: string; muted: boolean }) {
  const family = stopCategoryFamily(type);
  const Symbol = family ? CATEGORY_ICONS[family] : null;
  return (
    <span
      data-stop-category={family || "other"}
      className={
        "inline-flex max-w-full items-center gap-1.5 rounded-full bg-parranda-ink/[0.07] py-1 pl-2 pr-2.5 text-xs font-semibold leading-none " +
        (muted ? "text-parranda-ink/68" : "text-parranda-ink")
      }
    >
      {Symbol && <Symbol className="h-3.5 w-3.5 text-parranda-ink/72" />}
      <span className="truncate">{label}</span>
    </span>
  );
}

const NO_NEW_STOPS: ReadonlySet<string> = new Set();

export default function StopLine({
  t,
  lang,
  map,
  stale,
  newStopNames = NO_NEW_STOPS,
  routeLineIsSketch,
  dayContextNote,
  assemblyNotes = [],
  split,
  routeStops,
  legForStop,
  startLeg,
  finishLeg,
  anchorIsPosition,
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
  routeContextSuggestions,
  detoursOpen,
  setDetoursOpen,
}: {
  t: Translate;
  lang: Lang;
  /** The map, when it is drawn inline (phones). On wide screens it sits beside the day instead. */
  map: ReactNode;
  stale: boolean;
  /** Stops the last adjustment brought into the day, by name (describeDayChange's `added`). */
  newStopNames?: ReadonlySet<string>;
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
  routeContextSuggestions: RouteContextSuggestion[];
  detoursOpen: boolean;
  setDetoursOpen: (update: (cur: boolean) => boolean) => void;
}) {
  const legLabel = (leg: Leg) =>
    `${leg.minutes != null ? `${leg.minutes} min` : ""}${leg.minutes != null && leg.km != null ? " · " : ""}${leg.km != null ? walkingDistanceLabel(leg.km, lang) : ""}`;
  const lastCoreIndex = split.core.length - 1;

  // "YOU ARE HERE". Today only, and only after an explicit tap: the reader's
  // live position is read against the stations in route order. Stations
  // behind the reader are muted, the next one is marked. The position never
  // leaves this component, and nothing about the day changes.
  // Following belongs to today's line. When the chosen day stops being today,
  // the watch ends in the same render (`following` is derived, not just
  // reset by the effect) and the choice is cleared, so returning to today
  // asks for a new tap rather than resuming location on its own.
  const [followRequested, setFollowRequested] = useState(false);
  const following = followRequested && dayOffset === 0;
  useEffect(() => {
    if (dayOffset !== 0) setFollowRequested(false);
  }, [dayOffset]);
  const follow = useFollowPosition(following);
  const canFollow = follow.supported && dayOffset === 0;
  const progress = following && follow.state.status === "tracking"
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
        : follow.state.status === "unavailable"
          ? t("Din position kunde inte hämtas just nu.", "Your position couldn't be found right now.")
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

  // HOW THE DAY WAS ASSEMBLED — one line, opened on request, beside the map
  // it qualifies. Every fact is still on the page (and read by assistive tech
  // when opened). How Maps walks the route is said beside the Maps action.
  const about = (
    <details className="group mt-2">
      <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-1.5 text-13 font-semibold text-parranda-ink/72 transition hover:text-parranda-ink [&::-webkit-details-marker]:hidden">
        {t("Om dagen och kartan", "About this day and map")}
        <ChevronDownIcon className="h-3.5 w-3.5 transition group-open:rotate-180" />
      </summary>
      <ul className="mb-1 flex flex-col gap-1.5 text-xs leading-relaxed text-parranda-ink/72">
        {assemblyNotes.map((note) => <li key={note}>{note}</li>)}
        {routeLineIsSketch && <li>{t("Den prickade linjen visar stoppens ordning, inte gatorna.", "The dotted line shows the order of the stops, not the streets.")}</li>}
        <li>{t("Avstånd och gångtider är uppskattningar.", "Distances and walking times are estimates.")}</li>
        {dayContextNote && <li>{dayContextNote}</li>}
      </ul>
    </details>
  );

  return (
    <section
      aria-label={t("Rutten", "The route")}
      // On a phone the stops continue the day header directly above them,
      // so they sit closer than the page's section rhythm.
      // While an adjustment rebuilds the day, the day on screen stays — never
      // a silent swap — but reads as the one being replaced: its names fade,
      // the ember line goes quiet and the empty stations trace it again.
      data-rebuilding={stale || undefined}
      className={`${map ? "-mt-6" : ""} flex flex-col`}
    >
      {!map && about}

      <div className={(map ? "" : "mt-8 ") + "mb-3 flex min-h-9 flex-wrap items-center justify-between gap-x-3 gap-y-1"}>
        <Eyebrow as="h2">{t("Stoppen i ordning", "The stops, in order")}</Eyebrow>
        {canFollow && (
          <button
            type="button"
            aria-pressed={following}
            onClick={() => setFollowRequested((cur) => !cur)}
            className={
              `${compactPillTarget} gap-1.5 px-3.5 font-bold ` +
              (following
                ? "bg-parranda-ink text-parranda-paper"
                : "border-line border-parranda-ink/20 text-parranda-ink hover:border-parranda-ink/50")
            }
          >
            <LocationIcon className={"h-3.5 w-3.5 " + (following ? "" : "text-parranda-ember")} />
            {following ? t("Sluta följa", "Stop following") : t("Följ dagen", "Follow the day")}
          </button>
        )}
      </div>
      {followStatus && (
        <p className="mb-1 text-13 font-semibold text-parranda-ink" aria-live="polite">{followStatus}</p>
      )}
      {/* Core stops only, grouped under daypart headings taken from
          stop.daypart — only groups that exist render, and the engine's
          order is never changed to force a grouping. The walk INTO a stop
          comes before its daypart heading, so a heading always opens the
          part of the day it names. A woven live event is NOT an ordinary
          POI — it renders once below, as an attached route extension.
          The line itself is the list's ::before: one continuous segment
          from the first station to the last. */}
      {startLeg && (
        <p className={`${dataLine} flex min-h-10 flex-wrap items-center gap-x-2 pl-14`}>
          <WalkIcon className="h-3.5 w-3.5" />
          <span>{t(`Från ${startLeg.label}`, `From ${startLeg.label}`)}</span>
          <span>{legLabel(startLeg)}</span>
        </p>
      )}
      <ol
        className={"relative flex flex-col before:pointer-events-none before:absolute before:bottom-7 before:left-[19px] before:top-7 before:w-1.5 before:rounded-full before:transition-colors before:content-[''] " + (stale ? "before:bg-parranda-ink/12" : "before:bg-parranda-ember")}
        aria-label={t("Stoppen i ordning", "The stops, in order")}
      >
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
          const hoursClosed = stop?.selected_day_hours?.status === "closed";
          const website = stopWebsiteUrl(stop);
          const placeDetails = stopPlaceDetails(stop, lang);
          const partialLabels = partialPreferenceLabels(stop, selected, lang);
          const matchedLabels = stopMatchedPreferences(stop, selected).map((key) => pickLabel(key, lang));
          const stopKindLabel = stop?.type === "vintage-shop"
            ? stopTypeLabel(stop, lang)
            : typeLabel(stop?.type, lang);
          const hoursUnknown = stopHoursUnknown(stop);
          const sourceLabel = String(stop?.source?.label || "").trim();
          const behind = currentIndex != null && i < currentIndex;
          const isCurrent = currentIndex === i;
          const station = stale
            ? "border-parranda-ink/12 bg-parranda-paper text-parranda-ink/68 motion-safe:animate-[parranda-trace_3.2s_ease-in-out_infinite]"
            : expanded
            ? "border-parranda-ink bg-parranda-terracotta text-white"
            : isCurrent
              ? "border-parranda-ember bg-parranda-paper text-parranda-ink"
              : behind
                ? "border-parranda-ink/35 bg-parranda-paper text-parranda-ink/68"
                : i === lastCoreIndex && split.woven.length === 0
                  ? "border-parranda-ink bg-parranda-ink text-parranda-paper"
                  : "border-parranda-ink bg-parranda-paper text-parranda-ink";
          return (
            <li key={stopKey} className="flex flex-col">
              {leg && (leg.minutes != null || leg.km != null) && (
                <span className={`${dataLine} flex min-h-10 items-center gap-2 pl-14 transition-opacity${stale ? " opacity-45" : ""}`}>
                  <WalkIcon className="h-3.5 w-3.5" />
                  {leg.minutes != null ? `${leg.minutes} min` : ""}
                  {leg.minutes != null && leg.km != null ? " · " : ""}
                  {leg.km != null ? walkingDistanceLabel(leg.km, lang) : ""}
                </span>
              )}
              {daypartHeading && (
                <h3 className="type-eyebrow relative mb-1 mt-6 flex min-h-6 items-center pl-14 text-parranda-glow">
                  <span aria-hidden="true" className="absolute left-3.5 top-1/2 h-1 w-4 -translate-y-1/2 rounded-full bg-parranda-ink" />
                  {daypartHeading}
                </h3>
              )}
              {/* The stop row is a DISCLOSURE, not an external link: tapping
                  it opens an inline panel instead of ejecting to Google Maps.
                  The Maps jump becomes a deliberate action inside the panel. */}
              <button
                type="button"
                aria-expanded={expanded}
                aria-controls={panelId}
                onClick={() => setExpandedStopKey(expanded ? null : stopKey)}
                className="group flex min-h-16 w-full items-center gap-3.5 rounded-parranda-btn py-2 pr-1 text-left transition hover:bg-parranda-ink/5"
              >
                <span
                  className={`type-data relative z-[1] flex h-11 w-11 shrink-0 items-center justify-center rounded-full border-4 text-sm font-semibold transition ${station}`}
                  style={stale ? { animationDelay: `${(i % 7) * 0.45}s` } : undefined}
                >
                  {isCurrent && (
                    <span aria-hidden="true" className="absolute -inset-2 rounded-full border-2 border-parranda-ember motion-safe:animate-ping" />
                  )}
                  {behind ? <CheckIcon className="h-4 w-4" /> : routeNumber}
                  {behind && <span className="sr-only">{routeNumber}</span>}
                </span>
                <span className={"flex min-w-0 flex-1 flex-col gap-0.5 transition-opacity" + (stale ? " opacity-45" : "")}>
                  <span className={"flex flex-wrap items-center gap-x-2 text-17 font-extrabold leading-tight " + (behind ? "text-parranda-ink/68" : "text-parranda-ink")}>
                    {name}
                    {/* Named by the change line above ("4 stops swapped"):
                        which ones are new, for as long as that line stands. */}
                    {!stale && newStopNames.has(name) && (
                      <span className="type-eyebrow text-10 text-parranda-glow">{t("ny", "new")}</span>
                    )}
                    {isCurrent && (
                      <span className="type-eyebrow rounded-full bg-parranda-terracotta px-2 py-0.5 text-10 text-white">
                        {progress?.state === "at" ? t("Du är här", "You're here") : t("Nästa", "Next")}
                      </span>
                    )}
                  </span>
                  {/* What kind of place, at a glance: a compact category
                      badge under the name (symbol + the stop's own kind).
                      It is information, not a control — the whole row stays
                      the one disclosure. Kept and source-closed facts stay
                      visible; unknown hours are available inside the place. */}
                  {(stopKindLabel || kept || hoursClosed) && (
                    <span className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
                      {stopKindLabel && <StopCategory type={stop?.type} label={stopKindLabel} muted={behind} />}
                      {kept && (
                        <span className="inline-flex items-center gap-1 text-xs font-semibold text-parranda-clay">
                          <KeepIcon className="h-3 w-3" />
                          {t("Behålls", "Kept")}
                        </span>
                      )}
                      {hoursClosed && hoursLabel && (
                        <span className="inline-flex items-center gap-1 text-xs text-parranda-ink/68">
                          <ClockIcon className="h-3 w-3" />
                          {hoursLabel}
                        </span>
                      )}
                    </span>
                  )}
                </span>
                <ChevronRightIcon
                  className={"h-4 w-4 shrink-0 transition " + (expanded ? "rotate-90 text-parranda-ember" : "text-parranda-ink/68 group-hover:text-parranda-ink")}
                />
              </button>
              {expanded && (
                <div
                  id={panelId}
                  className="mb-2 ml-14 mt-1 flex flex-col rounded-parranda border-line border-parranda-ink/12 bg-parranda-ink/5 p-4"
                >
                  {/* Facts only. The schedule row is a bounded source fact
                      for the selected local day, never an "open now" claim. */}
                  <div className="flex flex-col gap-1.5 text-13 leading-snug text-parranda-ink/72">
                    {placeDetails.kindLabel && <span className="font-semibold text-parranda-ink">{placeDetails.kindLabel}</span>}
                    {placeDetails.address && <span>{placeDetails.address}</span>}
                    {leg && (leg.minutes != null || leg.km != null) && (
                      <span>
                        {legLabel(leg)}
                        {prevName ? ` ${t("till fots från", "walk from")} ${prevName}` : ` ${t("till fots", "on foot")}`}
                      </span>
                    )}
                    {hoursLabel && <span>{hoursLabel}</span>}
                    {hoursUnknown && !hoursLabel && (
                      <span>{t("Öppettider saknas för den valda dagen", "Opening hours unavailable for the selected day")}</span>
                    )}
                  </div>
                  {partialLabels.length > 0 && (
                    <p className="mt-2 text-xs text-parranda-ink/68">
                      {t("Lösare träff för:", "A looser match for:")} {partialLabels.join(", ")}
                    </p>
                  )}
                  {matchedLabels.length > 0 && (
                    <p className="mt-2 text-xs text-parranda-ink/72">
                      {t("Matchar dina val:", "Matches your picks:")} {matchedLabels.join(", ")}
                    </p>
                  )}
                  <div role="group" aria-label={t("Ändra stopp", "Edit stop")} className="mt-3 flex flex-wrap items-center gap-1.5">
                    {/* Existing identity-bound edits stay together. A kept
                        stop offers release; Replace and Remove keep their
                        separate orchestration and busy contracts. */}
                    {hasRealId && (commitments[stopIdentity]?.kind === "pin" ? (
                      <button
                        type="button"
                        onClick={() => releaseCommitment(stopIdentity)}
                        className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-parranda-btn border-line border-parranda-ember/60 bg-parranda-ember/10 px-3 text-13 font-bold text-parranda-ink transition hover:border-parranda-ember"
                      >
                        <KeepIcon className="h-4 w-4 text-parranda-ember" />
                        {t("Behålls — släpp", "Kept — release")}
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => keepStop(stopIdentity, name)}
                        className={buttonClass("secondary", "min-h-11 px-3 text-13")}
                      >
                        <KeepIcon className="h-4 w-4" />
                        {t("Behåll den här", "Keep this one")}
                      </button>
                    ))}
                    {hasRealId && commitments[stopIdentity]?.kind !== "pin" && (
                      <div className="inline-flex items-center gap-1.5">
                      {/* Busy, not disabled, while the edit runs: the pressed
                          button keeps keyboard focus (ui.tsx busyButton). */}
                      <button
                        type="button"
                        {...busyButton(editPending, () => dismissStop(stopIdentity, name))}
                        title={t("Byt till ett liknande stopp", "Replace with a similar stop")}
                        className={buttonClass("secondary", "min-h-11 px-3 text-13")}
                      >
                        <ShuffleIcon className="h-4 w-4" />
                        {t("Byt", "Replace")}
                      </button>
                      <button
                        type="button"
                        {...busyButton(editPending, () => removeStop(stopIdentity, name))}
                        title={t("Ta bort stoppet utan ersättning", "Remove this stop without replacement")}
                        className={buttonClass("secondary", "min-h-11 px-3 text-13")}
                      >
                        <TrashIcon className="h-4 w-4" />
                        {t("Ta bort", "Remove")}
                      </button>
                      </div>
                    )}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-5">
                    {pin && (
                      <a href={pin} target="_blank" rel="noopener noreferrer"
                        className="inline-flex min-h-11 items-center gap-1.5 text-13 font-semibold text-parranda-ink/80 underline decoration-parranda-ink/30 underline-offset-2 hover:text-parranda-ink">
                        {t("Öppna i Maps", "Open in Maps")}<ExternalIcon className="h-3.5 w-3.5" />
                      </a>
                    )}
                    {website && (
                      <a href={website} target="_blank" rel="noopener noreferrer"
                        className="inline-flex min-h-11 items-center gap-1.5 text-13 font-semibold text-parranda-ink/80 underline decoration-parranda-ink/30 underline-offset-2 hover:text-parranda-ink">
                        {t("Webbplats", "Website")}<ExternalIcon className="h-3.5 w-3.5" />
                      </a>
                    )}
                  </div>
                  {(sourceLabel || stop?.candidate_status === "partial") && (
                    <details className="group">
                      <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-1.5 text-xs font-semibold text-parranda-ink/72 hover:text-parranda-ink [&::-webkit-details-marker]:hidden">
                        {t("Om platsinformationen", "About this place information")}
                        <ChevronDownIcon className="h-3.5 w-3.5 transition group-open:rotate-180" />
                      </summary>
                      <p className="text-xs leading-relaxed text-parranda-ink/68">
                        {stop?.candidate_status === "partial"
                          ? sourceLabel
                            ? t(`Källstöd: ${sourceLabel} · underlaget är fortfarande provisoriskt`, `Source-backed by ${sourceLabel} · evidence is still provisional`)
                            : t("Källunderlaget är fortfarande provisoriskt", "Source evidence is still provisional")
                          : t(`Källa: ${sourceLabel}`, `Source: ${sourceLabel}`)}
                      </p>
                    </details>
                  )}
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
              <span className={`${dataLine} relative flex min-h-10 items-center gap-2 pl-14`}>
                <span
                  aria-hidden="true"
                  className="absolute bottom-0 left-[19px] top-0 w-1.5 rounded-full bg-[repeating-linear-gradient(to_bottom,rgb(var(--p-color-live))_0_6px,transparent_6px_11px)]"
                />
                <WalkIcon className="h-3.5 w-3.5" />
                {legLabel(leg)}
              </span>
            )}
            <div className={`${legShown ? "" : "mt-3 "}flex items-start gap-3`}>
              <span
                className="type-data flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-parranda-live text-sm font-semibold text-parranda-on-live shadow-[0_0_0_4px_rgb(var(--p-color-paper)),0_0_0_7px_rgb(var(--p-color-live))]"
              >
                {routeNumber}
              </span>
              <div className="min-w-0 flex-1 rounded-parranda border-line border-parranda-live/45 bg-parranda-live/8 p-4">
                <Eyebrow as="h3" tone="live" dot>{t("Live i din rutt", "Live in your route")}</Eyebrow>
                <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-parranda-ink">
                  {pin ? (
                    <a href={pin} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 min-w-11 items-center gap-1.5 text-17 font-extrabold transition hover:text-parranda-live">
                      {name}
                      <ExternalIcon className="h-3.5 w-3.5 text-parranda-ink/68" />
                    </a>
                  ) : (
                    <span className="text-17 font-extrabold">{name}</span>
                  )}
                  {stop?.starts_at && (
                    <span className="type-data rounded-full bg-parranda-live px-2 py-0.5 text-11 font-semibold text-parranda-on-live">
                      {eventTiming(stop, lang, undefined, selectedDate)}
                    </span>
                  )}
                </p>
                {venue && venue !== name && <p className="mt-0.5 text-13 text-parranda-ink/72">{venue}</p>}
                <p className="mt-1 text-13 text-parranda-ink/72">
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
                    <button type="button" className={buttonClass("secondary", "min-h-11 px-4 text-sm")} onClick={() => releaseCommitment(stop.live_occurrence_id)}>{confirmedLiveKeepIds.includes(stop.live_occurrence_id)
                      ? t("Behålls — släpp", "Kept — release")
                      : t("Valt — släpp", "Selected — release")}</button>
                  ) : stop.live_choice_eligible === true && (
                    <button type="button" className={buttonClass("secondary", "min-h-11 px-4 text-sm")} onClick={() => keepStop(stop.live_occurrence_id, name)}>{t("Behåll eventet", "Keep this event")}</button>
                  )}
                  <button type="button" className={buttonClass("secondary", "min-h-11 px-4 text-sm")} onClick={() => commit(stop.live_occurrence_id, "exclude", name, "replace")}>{t("Byt event", "Try another event")}</button>
                  <button type="button" className={buttonClass("secondary", "min-h-11 px-4 text-sm")} onClick={() => commit(stop.live_occurrence_id, "exclude", name, "remove")}>{t("Ta bort ur dagen", "Remove from day")}</button>
                </div>}
                {(sourceLabel || sourceLink) && (
                  <p className="mt-1 text-xs text-parranda-ink/68">
                    {sourceLabel && <>{t("Källa", "Source")}: {sourceLabel}</>}
                    {sourceLabel && sourceLink && " · "}
                    {sourceLink && (
                      <a href={sourceLink.href} target="_blank" rel="noopener noreferrer" className={`${inlineLinkTarget} underline decoration-parranda-ink/30 underline-offset-2 hover:text-parranda-live`}>
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
        <p className={`${dataLine} flex min-h-10 flex-wrap items-center gap-x-2 pl-14`}>
          <WalkIcon className="h-3.5 w-3.5" />
          <span>{anchorIsPosition ? t(`Tillbaka till ${finishLeg.label}`, `Return to ${finishLeg.label}`) : t(`Till ${finishLeg.label}`, `To ${finishLeg.label}`)}</span>
          <span>{legLabel(finishLeg)}</span>
        </p>
      )}

      {/* ON A PHONE THE DAY COMES FIRST. The stops are the day; the map is its
          overview, so inline (phones) it follows the line, edge to edge in the
          column without a card of its own. A tall map above the stops kept
          them off the first screen and caught the thumb that meant to scroll.
          Wide screens keep the map beside the day (`map` is null here) and
          the disclosure at the top. */}
      {map && (
        <>
          <div role="region" aria-label={t("Karta över dagen", "Map of the day")} className={"mt-8 transition-opacity" + (stale ? " opacity-60" : "")}>
            {map}
          </div>
          {about}
        </>
      )}

      {/* Detours — collapsed by default (design handoff §3): optional ideas
          must never read as part of the route, and the caption stays visible
          even while collapsed. Their dots join the map only while open. */}
      {/* Close under the map and its About line: they are one block, and a
          section-sized gap after the light About line read as missing content. */}
      {routeContextSuggestions.length > 0 && (
        <div className="mt-5 flex flex-col gap-2.5">
          <button
            type="button"
            aria-expanded={detoursOpen}
            onClick={() => setDetoursOpen((cur) => !cur)}
            className={buttonClass("dashed", "min-h-12 w-full justify-between px-4 text-left text-sm")}
          >
            <span>
              {routeContextSuggestions.length}{" "}
              {routeContextSuggestions.length === 1
                ? t("idé nära din rutt", "detour idea near your route")
                : t("idéer nära din rutt", "detour ideas near your route")}
            </span>
            <ChevronDownIcon className={"h-4 w-4 shrink-0 transition " + (detoursOpen ? "rotate-180" : "")} />
          </button>
          <p className="text-xs leading-relaxed text-parranda-ink/68">
            {t(
              "Valfria idéer från platsunderlaget — de ingår inte i dagens stopp eller Maps-rutten.",
              "Optional ideas from the place evidence — they are not part of this day's stops or the Maps route.",
            )}
          </p>
          {detoursOpen && (
            <ul className="mt-1 grid gap-2 sm:grid-cols-2">
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
                  <li key={stop.id || stop.candidate_id || stop.place_id || name} className="rounded-parranda border-line border-dashed border-parranda-ink/25 px-3.5 py-1.5">
                    <button
                      type="button"
                      aria-expanded={expanded}
                      aria-controls={candidatePanelId}
                      onClick={() => setExpandedCandidateKey(expanded ? null : candidateKey)}
                      className="flex min-h-11 w-full items-center justify-between gap-3 text-left text-sm font-bold text-parranda-ink transition hover:text-parranda-clay"
                    >
                      <span>{name}</span>
                      {expanded ? <MinusIcon className="h-4 w-4 shrink-0 text-parranda-ember" /> : <PlusIcon className="h-4 w-4 shrink-0 text-parranda-ink/68" />}
                    </button>
                    <p className={`${dataLine} pb-1.5`}>
                      {walkingDistanceLabel(stop.distance_km, lang)} {t("från", "from")} {stop.route_stop_name}
                    </p>
                    {expanded && (
                      <div id={candidatePanelId} className="mb-1.5 mt-1 border-t border-parranda-ink/12 pt-3">
                        {url && (
                          <a
                            href={url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className={buttonClass("primary", "min-h-11 w-full px-4 text-sm")}
                          >
                            {t("Öppna platsen i Maps", "Open place in Maps")}
                            <ExternalIcon />
                          </a>
                        )}
                        {/* Add is the same commitment as Keep, reached from
                            a candidate the day did not choose. The server
                            still has to resolve it against its own loaded
                            pool — an unhonoured pin is reported, not faked. */}
                        {candidateId && (commitments[candidateId]?.kind === "pin" || canCommitTo(stop)) && (
                          <button
                            type="button"
                            onClick={() =>
                              commitments[candidateId]?.kind === "pin"
                                ? releaseCommitment(candidateId)
                                : commit(candidateId, "pin", name)
                            }
                            className={`mt-2 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-parranda-btn border-line px-4 text-sm font-bold transition ${
                              commitments[candidateId]?.kind === "pin"
                                ? "border-parranda-ember/60 bg-parranda-ember/10 text-parranda-ink hover:border-parranda-ember"
                                : "border-parranda-ink/20 text-parranda-ink hover:border-parranda-ink/50"
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
  );
}
