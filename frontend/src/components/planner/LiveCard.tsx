import { useLiveClock } from "./useLiveClock";
/**
 * LIVE — the city's now-context: weather read, clothing advice and current
 * events. It renders independently of route composition (live_events survives a
 * blocked compose), so a failed route never hides trusted context. Woven events
 * are excluded here — they own the route-extension presentation on the line.
 *
 * "Linje": Live has its own colour (blue), distinct from the route's, so "what
 * is happening now" never reads as part of the plan.
 *
 * Like the Live sheet, this card cannot change the day: it is handed read-only
 * data and one callback that opens the sheet.
 */
import type { Ref } from "react";
import { ChevronRightIcon } from "../shared/icons";
import { buttonClass } from "../shared/ui";
import type { Lang, Translate } from "./copy";
import LiveEventSummary from "./LiveEventSummary";
import EventOccurrences from "./EventOccurrences";
import { liveRejectedSentence } from "../../lib/live-empty-copy.mjs";
import { eventBoardClock, pulseBrowseBuckets } from "../../lib/pulse-view.mjs";
import type { LiveEvents, PulseEvent } from "./types";

export default function LiveCard({
  t,
  lang,
  mode,
  anchorLabel,
  liveEvents,
  liveDayLabel,
  showDay,
  dayflow,
  clothing,
  wovenNames,
  includedInRoute,
  pulseState,
  liveFailure,
  liveFailureSentence,
  pulseBuckets,
  showExplore,
  startsWithWeek = false,
  pulseSources,
  liveSheetTriggerRef,
  openLiveSheet,
}: {
  t: Translate;
  lang: Lang;
  mode: "typed" | "near_me";
  anchorLabel: string;
  liveEvents: LiveEvents | null;
  liveDayLabel: string;
  showDay: boolean;
  dayflow: any;
  clothing: { headline: string; advice: string } | null;
  wovenNames: string[];
  includedInRoute: string;
  pulseState: string;
  liveFailure: { selected: number; responding: number } | null;
  liveFailureSentence: (failure: { selected: number; responding: number }) => string;
  pulseBuckets: { tonight: PulseEvent[]; thisWeek: PulseEvent[] };
  showExplore: boolean;
  startsWithWeek?: boolean;
  pulseSources: string | null;
  liveSheetTriggerRef: Ref<HTMLButtonElement>;
  openLiveSheet: () => void;
}) {
  const now = useLiveClock([...pulseBuckets.tonight, ...pulseBuckets.thisWeek]);
  // The board names the place, then says when on the right: "Tonight" or
  // "Today" only for the viewer's own today, any other day by its date.
  const shownDate = liveEvents?.selected_date ?? null;
  const viewerToday = new Date(now).toLocaleDateString("en-CA");
  const evening = new Date(now).getHours() >= 17;
  const boardTitle = mode === "near_me"
    ? t("Live nära dig", "Live near you")
    : anchorLabel
      ? t(`Live i ${anchorLabel}`, `Live in ${anchorLabel}`)
      : t("Live här", "Live here");
  const boardWhen = shownDate && shownDate === viewerToday
    ? evening ? t("I kväll", "Tonight") : t("Idag", "Today")
    : liveDayLabel;
  const boardRows = pulseBuckets.tonight.slice(0, 4);
  const browse = pulseBrowseBuckets(liveEvents);
  const hasSelectedDayListings = boardRows.length > 0 || wovenNames.length > 0 ||
    browse.tonight.length > 0 || Boolean(liveEvents?.browse?.tonight?.hidden_count);
  const hasWeekListings = pulseBuckets.thisWeek.length > 0 || browse.thisWeek.length > 0;
  const showSelectedDayStatus = shownDate && !hasSelectedDayListings && hasWeekListings &&
    (pulseState === "ok" || pulseState === "partial");
  const exploreLabel = startsWithWeek && showSelectedDayStatus
    ? t("Se kommande 7 dagar", "See next 7 days")
    : boardRows.length > 0 || pulseBuckets.thisWeek.length > 0
      ? t("Se allt live", "See all live")
      : t("Utforska live", "Explore live");
  return (
    <section
      className="rounded-parranda bg-parranda-live/8 p-5 sm:p-6"
    >
      {/* A departures board: what is on, then when, in one glance. The day
          sits on the right so the heading reads as a place. */}
      <h2 className="flex items-baseline justify-between gap-3 text-19 font-extrabold leading-tight text-parranda-ink">
        <span className="flex min-w-0 items-center gap-2.5 wrap-anywhere">
          <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-full bg-parranda-live" />
          {boardTitle}
        </span>
        {liveEvents?.selected_date ? (
          <span className="type-data shrink-0 text-13 font-semibold text-parranda-ink-meta">
            <span className="sr-only"> · </span>{boardWhen}
          </span>
        ) : null}
      </h2>

      {((showDay && dayflow?.weather?.headline) || clothing) && (
        <div className="mt-3 flex flex-col gap-1">
          {showDay && dayflow?.weather?.headline && (
            <p className="text-15 font-bold leading-snug text-parranda-ink">
              {dayflow.weather.headline}
              {dayflow.weather.pitch ? <span className="font-medium text-parranda-ink-muted"> — {dayflow.weather.pitch}</span> : null}
            </p>
          )}
          {clothing && (
            <p className="text-sm text-parranda-ink">
              <span className="font-bold">{clothing.headline}</span>
              <span className="text-parranda-ink-muted"> — {clothing.advice}</span>
            </p>
          )}
        </div>
      )}

      {wovenNames.length > 0 && (
        <p className="mt-3 text-13 text-parranda-ink-muted">
          {wovenNames.map((n: string) => `${n} · ${includedInRoute}`).join(" · ")}
        </p>
      )}

      {/* Honest source-health states — coverage only says sources exist HERE;
          pulseHealthState says whether collection actually succeeded. Raw
          backend reason tokens never reach product copy. */}
      {pulseState === "uncovered" && (
        <p className="mt-3 text-sm text-parranda-ink-muted">
          {t("Vi har inga verifierade evenemangskällor för området ännu. Det kan ändå hända saker här.", "We don't have verified event sources for this area yet. There may still be events here.")}
        </p>
      )}
      {pulseState === "pending" && (
        <p className="mt-3 text-sm text-parranda-ink-muted">{t("Kollar kalendrarna — uppdateras automatiskt strax.", "Checking the calendars — updates automatically in a moment.")}</p>
      )}
      {pulseState === "soft_empty" && (
        <p className="mt-3 text-sm text-parranda-ink-muted">
          {t("Källorna svarade men listar inga händelser för perioden.", "The sources responded but list no events for this period.")}
        </p>
      )}
      {pulseState === "rejected_empty" && (
        <p className="mt-3 text-sm text-parranda-ink-muted">
          {liveRejectedSentence(liveEvents, lang)}
        </p>
      )}
      {pulseState === "unavailable" && (
        <p className="mt-3 text-sm text-parranda-ink-muted">
          {liveFailure
            ? liveFailureSentence(liveFailure)
            : t("Parranda kunde inte verifiera händelser just nu — försök igen om en stund.", "Parranda couldn't verify events right now — try again shortly.")}
        </p>
      )}
      {showSelectedDayStatus && (
        <p className="mt-3 text-sm text-parranda-ink-muted">
          {t("Inga verifierade evenemang för den valda dagen.", "No verified events for the selected day.")}
        </p>
      )}

      {pulseBuckets.tonight.length > 0 && (
        <div className="mt-4">
          {!liveEvents?.selected_date && <p className="mb-2 text-sm font-bold text-parranda-ink">{liveDayLabel}</p>}
          <ul className="flex flex-col border-b-line border-parranda-live/25">
            {boardRows.map((ev: PulseEvent, i: number) => {
              const clock = eventBoardClock(ev, lang, now, liveEvents?.selected_date);
              return (
                <li key={ev.id ?? i} className={`${clock ? "grid grid-cols-[4.25rem_minmax(0,1fr)] gap-x-3" : "flex flex-col"} min-w-0 border-t-line border-parranda-live/25 py-3 text-sm leading-relaxed text-parranda-ink-soft`}>
                  {clock && (
                    <p className="type-data flex flex-col pt-0.5 leading-tight">
                      <span className="text-base font-extrabold text-parranda-live">{clock.at}</span>
                      {clock.until && <span className="text-13 text-parranda-ink-meta"><span className="sr-only">, </span>{clock.until}</span>}
                    </p>
                  )}
                  <div className="flex min-w-0 flex-col gap-1">
                    <LiveEventSummary event={ev} lang={lang} now={now} selectedDate={liveEvents?.selected_date} timing={clock ? "" : undefined} compact />
                    <EventOccurrences event={ev} lang={lang} now={now} selectedDate={liveEvents?.selected_date} />
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {showExplore && (
        <button
          type="button"
          ref={liveSheetTriggerRef}
          onClick={openLiveSheet}
          className={buttonClass("live", "mt-4 min-h-12 w-full px-4 text-sm")}
        >
          {exploreLabel}
          <ChevronRightIcon className="h-4 w-4" />
        </button>
      )}
      {pulseState === "partial" && (
        <p className="mt-2 text-xs text-parranda-ink-meta">
          {liveEvents?.acquisition?.source_health?.reasons?.includes("source_collection_truncated")
            ? t("Vissa kalendrar kunde bara läsas delvis — fler händelser kan finnas hos källan.", "Some calendars were only partly read — more events may be listed at the source.")
            : t("Några källor kunde inte nås just nu — listan kan vara ofullständig.", "Some sources couldn't be reached right now — the list may be incomplete.")}
        </p>
      )}

      {pulseSources && (
        <p className="mt-3 text-xs text-parranda-ink-meta">
          {t("Källa", "Source")}: {pulseSources}
        </p>
      )}
    </section>
  );
}
