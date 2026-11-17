import { useLiveClock } from "./useLiveClock";
/**
 * THE LIVE SHEET (design handoff §3B) — explores the live_events buckets only.
 *
 * Scope/time navigation reads the supplied Live data. Explicit planning sends
 * only a server-issued occurrence identity to the planner's commitment path;
 * it cannot supply event facts or change the day's anchor/date.
 *
 * Focus trapping, Escape and scroll locking stay with the planner, which owns
 * the trigger the focus returns to.
 */
import type { RefObject } from "react";
import { nextSourceDate, type LiveFallback } from "./useLiveFallback";
import { liveDateLabel } from "../../lib/live-event-query.mjs";
import { eventTiming, liveEventRelevance, liveTimeGroups, liveTimeRepresentative } from "../../lib/pulse-view.mjs";
import { liveEventTags, liveNavigationGroups, type LiveNavigationRow, type LiveSheetSort } from "../../lib/live-navigation.mjs";
import type { LiveEventScope } from "../../lib/live-event-query.mjs";
import { CloseIcon, LocationIcon } from "../shared/icons";
import { selectableLiveOccurrenceId } from "../../lib/live-stop-choice.mjs";
import { busyButton, buttonClass, labelChip, pillClass, segmentClass, segmentGroup } from "../shared/ui";
import { liveTagLabels } from "../../lib/live-tags.mjs";
import { liveRelevanceSentence, liveTimeGroupLabel, nearbyDistanceLabel, type Lang, type Translate } from "./copy";
import LiveEventSummary from "./LiveEventSummary";
import EventOccurrences from "./EventOccurrences";
import { liveRejectedSentence } from "../../lib/live-empty-copy.mjs";
import type { LiveEvents, LiveFailure, LiveSourceHealth, PulseEvent } from "./types";

type SheetState = "hidden" | "uncovered" | "pending" | "unavailable" | "partial" | "ok" | "rejected_empty" | "soft_empty";

// Where is a set of chips, not a segment: one of four, and some can be off.
// Selected uses the system's one "chosen" fill (ink); Live blue stays for Live content.
// An unavailable scope is disabled; while a query runs the chips are busy
// (busyButton), so the pressed chip keeps keyboard focus.
const scopeChip = (active: boolean) =>
  pillClass(active, "gap-2 disabled:cursor-not-allowed disabled:opacity-40 aria-disabled:opacity-60 aria-busy:cursor-progress");

export default function LiveSheet({
  lang,
  t,
  anchorLabel,
  anchorIsPosition = false,
  selected,
  liveDayLabel,
  liveSheetTime,
  setLiveSheetTime,
  liveSheetSort,
  setLiveSheetSort,
  onRetry,
  planningDate,
  planningAvailable = false,
  onPlanOccurrence,
  liveSheetScope,
  requestLiveSheetScope,
  aroundPlaceScopeAvailable,
  inPlaceScopeAvailable,
  routeScopeAvailable,
  liveQueryPending,
  liveQueryGeoHint,
  liveQueryError,
  liveFallback = null,
  sheetLiveEvents,
  sheetBuckets,
  sheetBrowseBuckets,
  sheetPulseState,
  sheetFailure,
  sheetSourceHealth,
  sheetSources,
  wovenNames,
  includedInRoute,
  liveFailureSentence,
  dialogRef,
  closeRef,
  onClose,
}: {
  lang: Lang;
  t: Translate;
  anchorLabel: string;
  /** A near-me day without an attested place name: phrase it as the reader's position. */
  anchorIsPosition?: boolean;
  selected: string[];
  liveDayLabel: string;
  liveSheetTime: "tonight" | "week";
  setLiveSheetTime: (time: "tonight" | "week") => void;
  liveSheetSort: LiveSheetSort;
  setLiveSheetSort: (sort: LiveSheetSort) => void;
  onRetry: () => void;
  planningDate?: string | null;
  planningAvailable?: boolean;
  onPlanOccurrence?: (event: PulseEvent, label: string) => void;
  liveSheetScope: LiveEventScope;
  requestLiveSheetScope: (scope: LiveEventScope) => void;
  aroundPlaceScopeAvailable: boolean;
  inPlaceScopeAvailable: boolean;
  routeScopeAvailable: boolean;
  liveQueryPending: boolean;
  liveQueryGeoHint: string | null;
  liveQueryError: string | null;
  liveFallback?: LiveFallback | null;
  sheetLiveEvents: LiveEvents | null;
  sheetBuckets: { tonight: PulseEvent[]; thisWeek: PulseEvent[] };
  sheetBrowseBuckets: { tonight: PulseEvent[]; thisWeek: PulseEvent[] };
  sheetPulseState: SheetState;
  sheetFailure: LiveFailure | null;
  sheetSourceHealth: LiveSourceHealth | null;
  sheetSources: string | null;
  /** Woven live stops, by name — they belong to the route, not to this list. */
  wovenNames: string[];
  /** "Included in today's route", worded for the day on screen. */
  includedInRoute: string;
  liveFailureSentence: (failure: LiveFailure) => string;
  dialogRef: RefObject<HTMLDivElement | null>;
  closeRef: RefObject<HTMLButtonElement | null>;
  onClose: () => void;
}) {
  const sheetEvents: PulseEvent[] = liveSheetTime === "tonight" ? sheetBuckets.tonight : sheetBuckets.thisWeek;
  const sheetMoreEvents: PulseEvent[] = liveSheetTime === "tonight" ? sheetBrowseBuckets.tonight : sheetBrowseBuckets.thisWeek;
  const now = useLiveClock([...sheetEvents, ...sheetMoreEvents]);
  // Relevance is claimed only where the server established it for the
  // current picks: matched rows get the picks heading, every other row
  // (the reserved local discovery included) is listed as "other".
  const navigation = liveNavigationGroups(sheetEvents, sheetMoreEvents, { sort: liveSheetSort, selectedPreferences: selected });
  const choice = (event: PulseEvent, label: string, rowDate = planningDate) => planningAvailable && onPlanOccurrence &&
    rowDate === planningDate && selectableLiveOccurrenceId(event, planningDate) ? (
      <button type="button" onClick={() => onPlanOccurrence(event, label)}
        className={buttonClass("secondary", "mt-2 min-h-11 w-full px-4 text-sm sm:w-auto")}>
        {t("Planera med evenemanget", "Plan with this event")}
      </button>
    ) : null;
  // A list for one day names that day once (the cell heading, a date
  // heading); its rows then say only their clocks.
  const selectedDay = liveSheetTime === "tonight" ? sheetLiveEvents?.selected_date ?? null : null;
  // A row's title sits one level below the nearest heading above it: a
  // section heading (h3) by default, a time group under a date (h4) or none.
  const sheetRow = (ev: PulseEvent, i: number, titleClassName: string, timingDate = sheetLiveEvents?.selected_date,
    navigationRow?: LiveNavigationRow<PulseEvent>, omitDate: string | null = null, underOnNow = false,
    heading: "h3" | "h4" | "h5" = "h4") => {
    const displayProgram = ev.display_group_kind === "source_program";
    const relevance = liveRelevanceSentence(liveEventRelevance(navigationRow?.series || ev, selected), lang, t);
    const distance = nearbyDistanceLabel(ev, lang);
    const tags = liveTagLabels(liveEventTags(ev), lang);
    // A programme row's time line is read from the slot that places it.
    const timingDay = navigationRow?.date || timingDate;
    const timing = navigationRow?.kind === "undated" ? ""
      : eventTiming(liveTimeRepresentative(ev, now, timingDay), lang, now, timingDay, { omitDate, underOnNow });
    return (
      <li key={`${ev.id || "event"}:${i}`} className="flex min-w-0 flex-col gap-1 sm:gap-2">
        <LiveEventSummary event={ev} lang={lang} now={now} selectedDate={navigationRow?.date || timingDate}
          timing={timing} distance={distance} heading={heading} titleClassName={titleClassName} />
        <div className="min-w-0 max-w-full break-words text-sm leading-relaxed text-parranda-ink-soft">
          {/* A named list: aria-label on a plain span is not read, a list's is. */}
          {tags.length > 0 && <span role="list" aria-label={t("Taggar", "Tags")} className="mt-1 flex flex-wrap gap-1">
            {/* overflow-wrap:anywhere, not break-words: inside an inline-flex chip
                only "anywhere" lets an unbroken source word wrap at 320px. */}
            {tags.map(tag => <span role="listitem" key={tag} className={`${labelChip} min-w-0 max-w-full [overflow-wrap:anywhere]`}>{tag}</span>)}
          </span>}
          {relevance && <span className="mt-0.5 block text-xs text-parranda-ink-meta">{relevance}</span>}
        </div>
        {!displayProgram && choice(ev, navigationRow?.series?.title || ev.title || "", navigationRow ? navigationRow.date : planningDate)}
        {(!navigationRow || displayProgram) && <EventOccurrences event={ev} lang={lang} now={now} selectedDate={navigationRow?.date || timingDate}
          renderChoice={slot => choice(slot, ev.title || "", navigationRow ? navigationRow.date : planningDate)} />}
      </li>
    );
  };
  // A date section names its date, so its rows give only their clocks. The
  // venue's current day is read further by time state (on now, later, …)
  // when the sources place its rows in time; ranges and undated rows stay
  // exactly as listed. The selected day's section does not print its date
  // again under the list's own "lör 24 okt. · runt Göteborg" line: its time
  // groups are the headings there.
  const dateSection = (label: string, rows: LiveNavigationRow<PulseEvent>[], date: string | null = null) => {
    const states = date ? liveTimeGroups(rows, { now, eventOf: (row) => row.event, dateOf: (row) => row.date || date }) : [];
    const byState = states.some((group) => group.state === "now" || group.state === "later" || group.state === "started" || group.state === "ended");
    const dayNamed = Boolean(date && date === selectedDay);
    const GroupHeading = dayNamed ? "h3" : "h4";
    const rowHeading = byState ? (dayNamed ? "h4" : "h5") : (dayNamed ? "h3" : "h4");
    return (
      <section key={label} aria-label={label} className="flex flex-col gap-3">
        {!dayNamed && <h3 className="text-xs font-bold text-parranda-ink-meta">{label}</h3>}
        {byState ? states.map((group) => (
          <div key={group.state} className="flex flex-col gap-2" data-live-time-group={group.state}>
            <GroupHeading className="text-xs font-semibold text-parranda-live">{liveTimeGroupLabel(group.state, t)}</GroupHeading>
            <ul className="flex flex-col gap-3">{group.events.map((row, i) => sheetRow(row.event, i, "font-semibold", row.date || undefined, row, date, group.state === "now", rowHeading))}</ul>
          </div>
        )) : (
          <ul className="flex flex-col gap-3">{rows.map((row, i) => sheetRow(row.event, i, "font-semibold", row.date || undefined, row, date, false, rowHeading))}</ul>
        )}
      </section>
    );
  };
  const scopePhrase =
    liveSheetScope === "near_route"
      ? t("nära rutten", "near the route")
      : liveSheetScope === "near_me"
        ? t("nära dig", "near you")
        : liveSheetScope === "in_place"
          ? t(`i hela området kring ${anchorLabel}`, `across the area around ${anchorLabel}`)
        : anchorIsPosition
          ? t("runt din position", "around your position")
          : t(`runt ${anchorLabel}`, `around ${anchorLabel}`);

  return (
    <div className="fixed inset-0 z-(--p-z-sheet)">
      <div aria-hidden="true" onClick={onClose} className="absolute inset-0 bg-parranda-scrim backdrop-blur-[2px]" />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={t("Live-händelser", "Live events")}
        tabIndex={-1}
        className="absolute inset-x-0 bottom-0 max-h-[85vh] overflow-y-auto rounded-t-3xl border-t-line border-parranda-line-faint bg-parranda-paper px-5 pb-8 pt-4 shadow-sheet sm:inset-x-auto sm:bottom-6 sm:left-1/2 sm:w-full sm:max-w-xl sm:-translate-x-1/2 sm:rounded-3xl sm:border-line sm:px-7"
      >
        <div className="flex justify-center sm:hidden" aria-hidden="true">
          <span className="h-1 w-11 rounded-full bg-parranda-line" />
        </div>
        <div className="mt-3 flex items-center justify-between gap-3">
          <h2 className="type-title text-3xl text-parranda-ink">
            {liveSheetScope === "near_me" || anchorIsPosition ? (
              <>
                Live <em className="not-italic text-parranda-live">{t("nära dig", "near you")}</em>
              </>
            ) : (
              <>
                {t("Live i", "Live in")} <em className="not-italic text-parranda-live">{anchorLabel}</em>
              </>
            )}
          </h2>
          <button
            ref={closeRef}
            type="button"
            aria-label={t("Stäng live", "Close live")}
            onClick={onClose}
            className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-full border-line border-parranda-line text-parranda-ink-soft transition hover:border-parranda-ember"
          >
            <CloseIcon />
          </button>
        </div>

        {/* WHERE — a real axis over live_event_query_v1. It reads trusted
            route/anchor geometry, while near_me requests fresh permission
            for this Live query only. */}
        <div className="mt-5 flex flex-col gap-2">
          <p className="type-eyebrow text-parranda-live">{t("Var", "Where")}</p>
          <div className="flex flex-wrap gap-2" role="group" aria-label={t("Live-område", "Live area")}>
            <button
              type="button"
              aria-pressed={liveSheetScope === "around_place"}
              disabled={!aroundPlaceScopeAvailable}
              {...busyButton(liveQueryPending, () => requestLiveSheetScope("around_place"))}
              className={scopeChip(liveSheetScope === "around_place")}
            >
              {anchorIsPosition ? t("Runt din position", "Around your position") : t(`Runt ${anchorLabel}`, `Around ${anchorLabel}`)}
            </button>
            <button
              type="button"
              aria-pressed={liveSheetScope === "in_place"}
              disabled={!inPlaceScopeAvailable}
              {...busyButton(liveQueryPending, () => requestLiveSheetScope("in_place"))}
              className={scopeChip(liveSheetScope === "in_place")}
            >
              {t("Hela området", "Whole area")}
            </button>
            <button
              type="button"
              aria-pressed={liveSheetScope === "near_route"}
              disabled={!routeScopeAvailable}
              {...busyButton(liveQueryPending, () => requestLiveSheetScope("near_route"))}
              className={scopeChip(liveSheetScope === "near_route")}
            >
              {t("Nära rutten", "Near the route")}
            </button>
            <button
              type="button"
              aria-pressed={liveSheetScope === "near_me"}
              {...busyButton(liveQueryPending, () => requestLiveSheetScope("near_me"))}
              className={scopeChip(liveSheetScope === "near_me")}
            >
              <LocationIcon className="h-3.5 w-3.5 text-parranda-ember" />
              {t("Nära mig", "Near me")}
            </button>
          </div>
          {!routeScopeAvailable && (
            <p className="text-xs text-parranda-ink-meta">
              {t("Nära rutten blir tillgängligt när en rutt finns.", "Near the route becomes available when a route exists.")}
            </p>
          )}
          {liveQueryGeoHint && <p className="text-xs text-parranda-ink-meta">{liveQueryGeoHint}</p>}
          {liveSheetScope === "in_place" && <p className="text-xs text-parranda-ink-meta">{t("Söker inom platsens kartområde. Händelser längre bort visas med avstånd.", "Searches the place's map area. Events farther away show their distance.")}</p>}
        </div>

        {/* WHEN — a real axis over the live_events buckets. */}
        <div className="mt-4 flex flex-col gap-2">
          <p className="type-eyebrow text-parranda-live">{t("När", "When")}</p>
          <div className={segmentGroup} role="group" aria-label={t("Vilken tid", "Which time")}>
            {(["tonight", "week"] as const).map((key) => (
              <button
                type="button"
                key={key}
                aria-pressed={liveSheetTime === key}
                onClick={() => setLiveSheetTime(key)}
                className={segmentClass(liveSheetTime === key)}
              >
                {key === "tonight" ? liveDayLabel : t("Kommande 7 dagar", "Next 7 days")}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-4 flex flex-col gap-2">
          <p className="type-eyebrow text-parranda-live">{t("Ordning", "Order")}</p>
          <div className={segmentGroup} role="group" aria-label={t("Live-ordning", "Live order")}>
            {(["for_you", "by_time"] as const).map(sort => (
              <button key={sort} type="button" aria-pressed={liveSheetSort === sort} onClick={() => setLiveSheetSort(sort)}
                className={segmentClass(liveSheetSort === sort)}>
                {sort === "for_you" ? t("För dig", "For you") : t("Efter tid", "By time")}
              </button>
            ))}
          </div>
        </div>

        {/* The ACTIVE scope×time cell — heading, list or honest emptiness. */}
        <div className="mt-5 flex flex-col gap-3 border-t-line border-parranda-line-faint pt-4">
          <p className="type-eyebrow text-parranda-ink-meta">
            {liveSheetTime === "tonight" ? liveDayLabel : t("Kommande 7 dagar", "Next 7 days")} · {scopePhrase}
          </p>
          {liveSheetScope !== "near_me" && liveSheetTime === "tonight" && wovenNames.length > 0 && (
            <p className="text-xs text-parranda-ink-meta">
              {wovenNames.map((n: string) => `${n} · ${includedInRoute}`).join(" · ")}
            </p>
          )}
          {liveQueryPending ? (
            <div className="rounded-parranda border-line border-parranda-line-faint bg-parranda-fill-faint p-4" aria-live="polite">
              <p className="text-sm text-parranda-ink-muted">
                {t("Letar efter evenemang …", "Looking for events …")}
              </p>
            </div>
          ) : liveQueryError ? (
            <div className="rounded-parranda border-line border-parranda-line-faint bg-parranda-fill-faint p-4">
              <p className="text-sm leading-relaxed text-parranda-ink-soft">{liveQueryError}</p>
            </div>
          ) : sheetPulseState === "uncovered" ? (
            <div className="rounded-parranda border-line border-parranda-line-faint bg-parranda-fill-faint p-4">
              <p className="text-sm leading-relaxed text-parranda-ink-soft">
                {t(
                  "Vi har inga verifierade evenemangskällor för området ännu. Det kan ändå hända saker här.",
                  "We don't have verified event sources for this area yet. There may still be events here.",
                )}
              </p>
            </div>
          ) : sheetPulseState === "pending" ? (
            <div className="rounded-parranda border-line border-parranda-line-faint bg-parranda-fill-faint p-4">
              <p className="text-sm leading-relaxed text-parranda-ink-muted">
                {t(
                  "Kalendrarna uppdateras fortfarande. Försök igen för att fortsätta hämtningen.",
                  "The calendars are still updating. Try again to continue checking.",
                )}
              </p>
            </div>
          ) : sheetFailure ? (
            <div className="rounded-parranda border-line border-parranda-line-faint bg-parranda-fill-faint p-4">
              <p className="text-sm leading-relaxed text-parranda-ink-soft">{liveFailureSentence(sheetFailure)}</p>
            </div>
          ) : sheetPulseState === "unavailable" || sheetPulseState === "hidden" ? (
            <div className="rounded-parranda border-line border-parranda-line-faint bg-parranda-fill-faint p-4">
              <p className="text-sm leading-relaxed text-parranda-ink-soft">
                {t(
                  "Live-information är inte tillgänglig just nu. Vi vet därför inte vad som händer här — det betyder inte att inget är på gång.",
                  "Live information is unavailable right now. We don't know what's on here — that doesn't mean nothing is happening.",
                )}
              </p>
            </div>
          ) : sheetEvents.length > 0 || sheetMoreEvents.length > 0 ? (
            <div className="flex flex-col gap-3">
              {liveSheetSort === "by_time" ? <>
                {navigation.dates.map(group => dateSection(liveDateLabel(group.date, lang), group.rows, group.date))}
                {navigation.ranges.length > 0 && dateSection(t("Källans datumintervall", "Source date ranges"), navigation.ranges)}
                {navigation.undated.length > 0 && dateSection(t("Datum ej angivet", "Date not specified"), navigation.undated)}
              </> : <>
              {navigation.picks.length > 0 && (
                <>
                  <h3 className="text-xs font-bold text-parranda-ink-meta">{t("Höjdpunkter för dina val", "Highlights for your picks")}</h3>
                  <ul className="flex flex-col gap-3">
                    {navigation.picks.map((ev: PulseEvent, i: number) => sheetRow(ev, i, "font-bold", undefined, undefined, selectedDay))}
                  </ul>
                </>
              )}
              {navigation.other.length > 0 && (
                <>
                  <h3 className="text-xs font-bold text-parranda-ink-meta">
                    {navigation.picks.length > 0 ? t("Andra lokala höjdpunkter", "Other local highlights") : t("Höjdpunkter", "Highlights")}
                  </h3>
                  <ul className="flex flex-col gap-3">
                    {navigation.other.map((ev: PulseEvent, i: number) => sheetRow(ev, i, "font-bold", undefined, undefined, selectedDay))}
                  </ul>
                </>
              )}
              {sheetMoreEvents.length > 0 && (
                <details className="rounded-parranda border-line border-parranda-line-faint bg-parranda-fill-faint px-4 py-2">
                  <summary className="flex min-h-11 cursor-pointer items-center text-sm font-bold text-parranda-ink">
                    {t(`Visa ${sheetMoreEvents.length} fler händelser`, `Show ${sheetMoreEvents.length} more events`)}
                  </summary>
                  <ul className="flex flex-col gap-3 border-t-line border-parranda-line-faint pb-2 pt-3">
                    {sheetMoreEvents.map((ev: PulseEvent, i: number) => sheetRow(ev, i, "font-semibold", undefined, undefined, selectedDay))}
                  </ul>
                </details>
              )}
              </>}
            </div>
          ) : (
            <div className="rounded-parranda border-line border-parranda-line-faint bg-parranda-fill-faint p-4">
              <p className="text-sm leading-relaxed text-parranda-ink-soft">
                {/* An empty display is not proof of an empty calendar. Use the
                    same collection states as the Live card before describing
                    a genuinely empty selected period. */}
                {sheetPulseState === "rejected_empty"
                    ? liveRejectedSentence(sheetLiveEvents, lang)
                    : sheetPulseState === "soft_empty"
                        ? t("Källorna svarade men listar inga händelser för perioden.", "The sources responded but list no events for this period.")
                        : liveSheetTime === "tonight" && liveSheetScope !== "near_me" && wovenNames.length > 0
                          ? t("Inga ytterligare verifierade händelser listade här.", "No additional verified events listed here.")
                          : liveSheetTime === "tonight"
                            ? t(`Inget verifierat ${liveDayLabel} ${scopePhrase}.`, `Nothing verified ${liveDayLabel} ${scopePhrase}.`)
                            : t(`Inget listat under följande 7 dagar ${scopePhrase}.`, `Nothing listed in the following 7 days ${scopePhrase}.`)}
                {liveSheetTime === "tonight" && sheetBuckets.thisWeek.length > 0 && (
                  <strong className="text-parranda-ink">
                    {" "}
                    {sheetBuckets.thisWeek.length === 1
                      ? t("1 händelse är listad under följande 7 dagar.", "One event is listed in the following 7 days.")
                      : t(
                          `${sheetBuckets.thisWeek.length} händelser är listade under följande 7 dagar.`,
                          `${sheetBuckets.thisWeek.length} events are listed in the following 7 days.`,
                        )}
                  </strong>
                )}
              </p>
              {liveSheetTime === "tonight" && sheetBuckets.thisWeek.length > 0 && (
                <button
                  type="button"
                  onClick={() => setLiveSheetTime("week")}
                  className="mt-3 inline-flex min-h-11 items-center rounded-parranda-btn bg-parranda-live px-4 text-13 font-extrabold text-parranda-on-live hover:brightness-110"
                >
                  {t("Visa följande dagar", "Show following days")}
                </button>
              )}
              {liveSheetTime === "week" && sheetBuckets.tonight.length > 0 && (
                <button
                  type="button"
                  onClick={() => setLiveSheetTime("tonight")}
                  className="mt-3 inline-flex min-h-11 items-center rounded-parranda-btn bg-parranda-live px-4 text-13 font-extrabold text-parranda-on-live hover:brightness-110"
                >
                  {liveDayLabel}
                </button>
              )}
            </div>
          )}
          {liveFallback && (
            <section aria-label={t("Separata Live-förslag", "Separate Live suggestions")}
              className="flex flex-col gap-3 rounded-parranda border-line border-parranda-live/30 bg-parranda-live/5 p-4">
              <h3 className="text-sm font-bold text-parranda-live">
                {liveFallback.kind === "following"
                  ? t(`Följande dagar — runt ${anchorLabel}`, `Following days — around ${anchorLabel}`)
                  : t(`Samma dag — större område kring ${anchorLabel}`, `Same day — wider area around ${anchorLabel}`)}
              </h3>
              {liveFallback.status === "checking" ? <p role="status">{t("Kollar det större området…", "Checking the wider area…")}</p>
                : liveFallback.status === "unconfirmed" ? <p>{t("Det större området kunde inte bekräftas just nu.", "The wider area could not be confirmed right now.")}</p>
                : liveFallback.events.length > 0 ? <ul className="flex flex-col gap-3">
                  {liveFallback.events.map((ev, i) => {
                    const date = liveFallback.kind === "following" ? nextSourceDate(ev, liveFallback.selectedDate) : null;
                    return <li key={ev.id ?? i} className="flex flex-col gap-1">
                      {date && <span className="type-data text-xs font-semibold text-parranda-live">{liveDateLabel(date, lang)}</span>}
                      <ul>{sheetRow(ev, i, "font-bold", date || liveFallback.selectedDate)}</ul>
                    </li>;
                  })}
                </ul> : <p>{t("Inga verifierade händelser listades samma dag i det större området.", "No verified same-day events were listed in the wider area.")}</p>}
              {liveFallback.partial && <p className="text-xs text-parranda-ink-meta">
                {t("Vissa källor kunde inte läsas. De här träffarna är verifierade, men listan kan vara ofullständig.", "Some sources could not be read. These events are verified, but the list may be incomplete.")}
              </p>}
              {liveFallback.widerStatus && <p role={liveFallback.widerStatus === "checking" ? "status" : undefined} className="text-xs text-parranda-ink-meta">
                {liveFallback.widerStatus === "checking"
                  ? t("Kollar också samma dag i det större området…", "Also checking the same day in the wider area…")
                  : t("Det större området kunde inte bekräftas just nu.", "The wider area could not be confirmed right now.")}
              </p>}
              {liveFallback.kind === "following" && !liveFallback.widerStatus && liveFallback.events.length > 0 &&
                <p className="text-xs text-parranda-ink-meta">{t("Inga verifierade händelser listades samma dag i det större området. Här visas källornas senare lokala datum.", "No verified same-day events were listed in the wider area. These are the sources' later local dates.")}</p>}
            </section>
          )}
          {(liveQueryError || (!liveQueryPending && (sheetPulseState === "pending" || sheetPulseState === "unavailable"))) && (
            <button type="button" onClick={onRetry}
              className="inline-flex min-h-11 items-center self-start rounded-full border-line border-parranda-live/60 px-4 text-sm font-bold text-parranda-live">
              {t("Försök igen", "Try again")}
            </button>
          )}
          {sheetPulseState === "partial" && (
            <p className="text-xs text-parranda-ink-meta">
              {sheetSourceHealth?.reasons?.includes("source_collection_truncated")
            ? t("Vissa kalendrar kunde bara läsas delvis — fler händelser kan finnas hos källan.", "Some calendars were only partly read — more events may be listed at the source.")
            : t("Några källor kunde inte nås just nu — listan kan vara ofullständig.", "Some sources couldn't be reached right now — the list may be incomplete.")}
            </p>
          )}
          {/* Counts describe a finished collection; while waiting, "0/1
              responded" would read as a failure that has not happened. */}
          {sheetSourceHealth && Number.isInteger(sheetSourceHealth.selected_source_count) &&
            !liveQueryPending && sheetPulseState !== "pending" && sheetPulseState !== "uncovered" && (sheetSourceHealth.selected_source_count ?? 0) > 0 && (
            <p className="text-xs text-parranda-ink-meta">
              {t("Kalendrar", "Calendars")}: {sheetSourceHealth.responding_source_count ?? 0} {t("av", "of")} {sheetSourceHealth.selected_source_count ?? 0} {t("svarade", "responded")}
              {/* Returned rows are not hits: every row can still be
                  rejected by date, geometry or trust gates. Name hits
                  only when accepted events actually surfaced. */}
              {(sheetSourceHealth.accepted_event_count ?? 0) > 0 && (sheetSourceHealth.surfaced_event_count ?? 0) > 0 &&
                ` · ${sheetSourceHealth.event_bearing_source_count ?? 0} ${t("med träffar", "with events")}`}
            </p>
          )}
          {sheetSources && (
            <p className="text-xs text-parranda-ink-meta">
              {t("Källa", "Source")}: {sheetSources}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
