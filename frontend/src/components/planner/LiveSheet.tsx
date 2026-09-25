/**
 * THE LIVE SHEET (design handoff §3B) — explores the live_events buckets only.
 *
 * It never changes the day's anchor or the route, and it cannot: it receives
 * read-only data plus three callbacks — pick a scope (a separate, non-mutating
 * live_event_query_v1 request), pick a time, close. The landing's location
 * consent anchors the DAY; a separate near-me consent applies only to a Live
 * query, and that consent is requested by the planner, not here.
 *
 * Focus trapping, Escape and scroll locking stay with the planner, which owns
 * the trigger the focus returns to.
 */
import type { RefObject } from "react";
import { eventTiming, liveEventRelevance, liveHighlightGroups } from "../../lib/pulse-view.mjs";
import type { LiveEventScope } from "../../lib/live-event-query.mjs";
import { CloseIcon, LocationIcon } from "../shared/icons";
import { liveRelevanceSentence, nearbyDistanceLabel, type Lang, type Translate } from "./copy";
import { liveEventSource } from "./LiveEventSource";
import type { LiveEvents, LiveFailure, LiveSourceHealth, PulseEvent } from "./types";

type SheetState = "hidden" | "uncovered" | "pending" | "unavailable" | "partial" | "ok" | "rejected_empty" | "soft_empty";

const scopeChip = (active: boolean) =>
  "inline-flex min-h-11 items-center gap-2 rounded-full border px-4 text-[13px] transition disabled:cursor-not-allowed disabled:opacity-40 " +
  (active
    ? "border-parranda-ember/55 bg-parranda-ember/10 font-bold text-parranda-ink"
    : "border-parranda-ink/14 text-parranda-ink/65 hover:border-parranda-ink/30");

export default function LiveSheet({
  lang,
  t,
  anchorLabel,
  selected,
  liveDayLabel,
  liveSheetTime,
  setLiveSheetTime,
  liveSheetScope,
  requestLiveSheetScope,
  aroundPlaceScopeAvailable,
  routeScopeAvailable,
  liveQueryPending,
  liveQueryGeoHint,
  liveQueryError,
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
  selected: string[];
  liveDayLabel: string;
  liveSheetTime: "tonight" | "week";
  setLiveSheetTime: (time: "tonight" | "week") => void;
  liveSheetScope: LiveEventScope;
  requestLiveSheetScope: (scope: LiveEventScope) => void;
  aroundPlaceScopeAvailable: boolean;
  routeScopeAvailable: boolean;
  liveQueryPending: boolean;
  liveQueryGeoHint: string | null;
  liveQueryError: string | null;
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
  // Relevance is claimed only where the server established it for the
  // current picks: matched rows get the picks heading, every other row
  // (the reserved local discovery included) is listed as "other".
  const highlightGroups = liveHighlightGroups(sheetEvents, selected);
  const sheetRow = (ev: PulseEvent, i: number, titleClassName: string) => {
    const relevance = liveRelevanceSentence(liveEventRelevance(ev, selected), lang, t);
    const distance = nearbyDistanceLabel(ev, lang);
    return (
      <li key={ev.id ?? i} className="flex items-baseline gap-3">
        <span className="min-w-[52px] shrink-0 text-xs font-extrabold tabular-nums text-parranda-clay">{eventTiming(ev, lang, undefined, sheetLiveEvents?.selected_date)}</span>
        <span className="text-sm leading-relaxed text-parranda-ink/90">
          <span className={titleClassName}>{ev.title}</span>
          {ev.place && <span className="text-parranda-ink/60"> · {ev.place}</span>}
          {distance && <span className="font-semibold text-parranda-clay"> · {distance}</span>}
          {liveEventSource(ev, lang)}
          {relevance && <span className="mt-0.5 block text-xs text-parranda-ink/55">{relevance}</span>}
        </span>
      </li>
    );
  };
  const scopePhrase =
    liveSheetScope === "near_route"
      ? t("nära rutten", "near the route")
      : liveSheetScope === "near_me"
        ? t("nära dig", "near you")
        : t(`runt ${anchorLabel}`, `around ${anchorLabel}`);

  return (
    <div className="fixed inset-0 z-[1100]">
      <div aria-hidden="true" onClick={onClose} className="absolute inset-0 bg-black/60 backdrop-blur-[2px]" />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={t("Live-händelser", "Live events")}
        tabIndex={-1}
        className="absolute inset-x-0 bottom-0 max-h-[85vh] overflow-y-auto rounded-t-3xl border-t border-parranda-ink/14 bg-parranda-paper px-5 pb-8 pt-4 shadow-2xl sm:inset-x-auto sm:bottom-6 sm:left-1/2 sm:w-full sm:max-w-xl sm:-translate-x-1/2 sm:rounded-3xl sm:border sm:px-7"
      >
        <div className="flex justify-center sm:hidden" aria-hidden="true">
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
            ref={closeRef}
            type="button"
            aria-label={t("Stäng live", "Close live")}
            onClick={onClose}
            className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-full border border-parranda-ink/16 text-parranda-ink/80 transition hover:border-parranda-ember"
          >
            <CloseIcon />
          </button>
        </div>

        {/* WHERE — a real axis over live_event_query_v1. It reads trusted
            route/anchor geometry, while near_me requests fresh permission
            for this Live query only. */}
        <div className="mt-5 flex flex-col gap-2">
          <p className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-parranda-glow">{t("Var", "Where")}</p>
          <div className="flex flex-wrap gap-2" role="group" aria-label={t("Live-område", "Live area")}>
            <button
              type="button"
              aria-pressed={liveSheetScope === "around_place"}
              disabled={!aroundPlaceScopeAvailable || liveQueryPending}
              onClick={() => requestLiveSheetScope("around_place")}
              className={scopeChip(liveSheetScope === "around_place")}
            >
              {t(`Runt ${anchorLabel}`, `Around ${anchorLabel}`)}
            </button>
            <button
              type="button"
              aria-pressed={liveSheetScope === "near_route"}
              disabled={!routeScopeAvailable || liveQueryPending}
              onClick={() => requestLiveSheetScope("near_route")}
              className={scopeChip(liveSheetScope === "near_route")}
            >
              {t("Nära rutten", "Near the route")}
            </button>
            <button
              type="button"
              aria-pressed={liveSheetScope === "near_me"}
              disabled={liveQueryPending}
              onClick={() => requestLiveSheetScope("near_me")}
              className={scopeChip(liveSheetScope === "near_me")}
            >
              <LocationIcon className="h-3.5 w-3.5 text-parranda-ember" />
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
                  (liveSheetTime === key ? "bg-parranda-ember/16 font-bold text-parranda-ink" : "text-parranda-ink/65 hover:text-parranda-ink")
                }
              >
                {key === "tonight" ? liveDayLabel : t("Följande 7 dagar", "Following 7 days")}
              </button>
            ))}
          </div>
        </div>

        {/* The ACTIVE scope×time cell — heading, list or honest emptiness. */}
        <div className="mt-5 flex flex-col gap-3 border-t border-parranda-ink/10 pt-4">
          <p className="text-[11px] font-extrabold uppercase tracking-[0.16em] text-parranda-ink/55">
            {liveSheetTime === "tonight" ? liveDayLabel : t("Följande 7 dagar", "Following 7 days")} · {scopePhrase}
          </p>
          {liveSheetScope !== "near_me" && liveSheetTime === "tonight" && wovenNames.length > 0 && (
            <p className="text-xs text-parranda-ink/60">
              {wovenNames.map((n: string) => `${n} · ${includedInRoute}`).join(" · ")}
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
          ) : sheetFailure ? (
            <div className="rounded-parranda border border-parranda-ink/10 bg-parranda-ink/5 p-4">
              <p className="text-sm leading-relaxed text-parranda-ink/80">{liveFailureSentence(sheetFailure)}</p>
            </div>
          ) : sheetEvents.length > 0 || sheetMoreEvents.length > 0 ? (
            <div className="flex flex-col gap-3">
              {highlightGroups.picks.length > 0 && (
                <>
                  <p className="text-xs font-bold text-parranda-ink/65">{t("Höjdpunkter för dina val", "Highlights for your picks")}</p>
                  <ul className="flex flex-col gap-3">
                    {highlightGroups.picks.map((ev: PulseEvent, i: number) => sheetRow(ev, i, "font-bold"))}
                  </ul>
                </>
              )}
              {highlightGroups.other.length > 0 && (
                <>
                  <p className="text-xs font-bold text-parranda-ink/65">
                    {highlightGroups.picks.length > 0 ? t("Andra lokala höjdpunkter", "Other local highlights") : t("Höjdpunkter", "Highlights")}
                  </p>
                  <ul className="flex flex-col gap-3">
                    {highlightGroups.other.map((ev: PulseEvent, i: number) => sheetRow(ev, i, "font-bold"))}
                  </ul>
                </>
              )}
              {sheetMoreEvents.length > 0 && (
                <details className="rounded-parranda border border-parranda-ink/10 bg-parranda-ink/5 px-4 py-2">
                  <summary className="flex min-h-11 cursor-pointer items-center text-sm font-bold text-parranda-ink">
                    {t(`Visa ${sheetMoreEvents.length} fler händelser`, `Show ${sheetMoreEvents.length} more events`)}
                  </summary>
                  <ul className="flex flex-col gap-3 border-t border-parranda-ink/10 pb-2 pt-3">
                    {sheetMoreEvents.map((ev: PulseEvent, i: number) => sheetRow(ev, i, "font-semibold"))}
                  </ul>
                </details>
              )}
            </div>
          ) : (
            <div className="rounded-parranda border border-parranda-ink/10 bg-parranda-ink/5 p-4">
              <p className="text-sm leading-relaxed text-parranda-ink/80">
                {liveSheetTime === "tonight"
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
                  className="mt-3 inline-flex min-h-11 items-center rounded-parranda-btn border border-parranda-ember/50 bg-parranda-ember/10 px-4 text-[13px] font-bold text-parranda-clay"
                >
                  {t("Visa följande dagar", "Show following days")}
                </button>
              )}
              {liveSheetTime === "week" && sheetBuckets.tonight.length > 0 && (
                <button
                  type="button"
                  onClick={() => setLiveSheetTime("tonight")}
                  className="mt-3 inline-flex min-h-11 items-center rounded-parranda-btn border border-parranda-ember/50 bg-parranda-ember/10 px-4 text-[13px] font-bold text-parranda-clay"
                >
                  {liveDayLabel}
                </button>
              )}
            </div>
          )}
          {sheetPulseState === "partial" && (
            <p className="text-xs text-parranda-ink/55">
              {t("Alla källor kunde inte nås just nu — listan kan vara ofullständig.", "Some sources couldn't be reached right now — the list may be incomplete.")}
            </p>
          )}
          {/* Counts describe a finished collection; while waiting, "0/1
              responded" would read as a failure that has not happened. */}
          {sheetSourceHealth && Number.isInteger(sheetSourceHealth.selected_source_count) &&
            !liveQueryPending && sheetPulseState !== "pending" && (
            <p className="text-xs text-parranda-ink/50">
              {t("Källstatus", "Source health")}: {sheetSourceHealth.responding_source_count ?? 0}/{sheetSourceHealth.selected_source_count ?? 0} {t("svarade", "responded")}
              {/* Returned rows are not hits: every row can still be
                  rejected by date, geometry or trust gates. Name hits
                  only when accepted events actually surfaced. */}
              {(sheetSourceHealth.accepted_event_count ?? 0) > 0 && (sheetSourceHealth.surfaced_event_count ?? 0) > 0 &&
                ` · ${sheetSourceHealth.event_bearing_source_count ?? 0} ${t("med träffar", "with events")}`}
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
}
