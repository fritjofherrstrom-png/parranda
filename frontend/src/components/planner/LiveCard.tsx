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
import { buttonClass, panelCard, pressable } from "../shared/ui";
import { liveRelevanceSentence, type Lang, type Translate } from "./copy";
import LiveEventSummary from "./LiveEventSummary";
import EventOccurrences from "./EventOccurrences";
import { liveRejectedSentence } from "../../lib/live-empty-copy.mjs";
import { suggestLiveRouteEnd, type LiveRouteSuggestionContext } from "../../lib/live-stop-choice.mjs";
import { eventBoardClock, pulseBrowseBuckets, pulseRowsWithoutOccurrence } from "../../lib/pulse-view.mjs";
import type { LiveEvents, PulseEvent } from "./types";

/** A source-health or empty state: a sentence, in the body size. */
const stateCopy = "mt-4 text-15 leading-relaxed text-parranda-ink-muted";

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
  suggestion,
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
  suggestion?: LiveRouteSuggestionContext & { onPlan: (event: PulseEvent, label: string) => void };
}) {
  const browse = pulseBrowseBuckets(liveEvents);
  const now = useLiveClock([...pulseBuckets.tonight, ...pulseBuckets.thisWeek, ...browse.tonight]);
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
  const offer = suggestion ? suggestLiveRouteEnd({ ...suggestion, now }) : null;
  const boardRows = pulseRowsWithoutOccurrence(pulseBuckets.tonight, offer?.event.live_occurrence_id).slice(0, 4);
  const hasSelectedDayListings = offer || boardRows.length > 0 || wovenNames.length > 0 ||
    browse.tonight.length > 0 || Boolean(liveEvents?.browse?.tonight?.hidden_count);
  const hasWeekListings = pulseBuckets.thisWeek.length > 0 || browse.thisWeek.length > 0;
  const showSelectedDayStatus = shownDate && !hasSelectedDayListings && hasWeekListings &&
    (pulseState === "ok" || pulseState === "partial");
  const exploreLabel = startsWithWeek && showSelectedDayStatus
    ? t("Se kommande 7 dagar", "See next 7 days")
    : boardRows.length > 0 || pulseBuckets.thisWeek.length > 0
      ? t("Se allt live", "See all live")
      : t("Utforska live", "Explore live");
  // One control opens the sheet: a pill in the heading row, in Live's colour,
  // never a second filled button. The card's one filled action is "Plan with
  // this event", and only when that offer exists.
  const explore = showExplore ? (
    <button
      type="button"
      ref={liveSheetTriggerRef}
      onClick={openLiveSheet}
      className={`group inline-flex min-h-11 shrink-0 items-center gap-1 rounded-parranda-btn bg-parranda-fill pl-3 pr-2 text-13 font-bold whitespace-nowrap text-parranda-live hover:bg-parranda-fill-strong active:bg-parranda-fill-strong ${pressable}`}
    >
      {exploreLabel}
      <ChevronRightIcon className="h-4 w-4 shrink-0 transition-transform duration-200 ease-out motion-safe:group-hover:translate-x-0.5" />
    </button>
  ) : null;
  return (
    <section
      className={`${panelCard} relative p-5 sm:p-6 before:absolute before:left-5 before:top-0 before:h-[3px] before:w-16 before:rounded-full before:bg-parranda-live before:content-[''] sm:before:left-6`}
    >
      {/* A departures board: the place, then when, and the way into the full
          board on the right. Blue marks live data; the card itself is the
          system's one panel. */}
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <h2 className="flex min-w-0 grow basis-40 flex-col gap-1">
          <span className="type-title flex min-w-0 items-center gap-2.5 text-xl leading-tight text-parranda-ink wrap-anywhere">
            <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-full bg-parranda-live [--p-ring-rgb:var(--p-color-live)] motion-safe:animate-ring-once" />
            {boardTitle}
          </span>
          {liveEvents?.selected_date ? (
            <span className="type-data pl-5 text-13 normal-case text-parranda-ink-meta">
              <span className="sr-only"> · </span>{boardWhen}
            </span>
          ) : null}
        </h2>
        {explore}
      </div>

      {((showDay && dayflow?.weather?.headline) || clothing) && (
        <div className="mt-4 flex flex-col gap-1">
          {showDay && dayflow?.weather?.headline && (
            <p className="text-15 font-semibold leading-relaxed text-parranda-ink">
              {dayflow.weather.headline}
              {dayflow.weather.pitch ? <span className="font-normal text-parranda-ink-muted"> — {dayflow.weather.pitch}</span> : null}
            </p>
          )}
          {clothing && (
            <p className="text-15 leading-relaxed text-parranda-ink">
              <span className="font-semibold">{clothing.headline}</span>
              <span className="text-parranda-ink-muted"> — {clothing.advice}</span>
            </p>
          )}
        </div>
      )}

      {wovenNames.length > 0 && (
        <p className="type-data mt-3 text-13 text-parranda-ink-meta">
          {wovenNames.map((n: string) => `${n} · ${includedInRoute}`).join(" · ")}
        </p>
      )}

      {/* Honest source-health states — coverage only says sources exist HERE;
          pulseHealthState says whether collection actually succeeded. Raw
          backend reason tokens never reach product copy. */}
      {pulseState === "uncovered" && (
        <p className={stateCopy}>
          {t("Vi har inga verifierade evenemangskällor för området ännu. Det kan ändå hända saker här.", "We don't have verified event sources for this area yet. There may still be events here.")}
        </p>
      )}
      {pulseState === "pending" && (
        <p className={stateCopy}>{t("Kollar kalendrarna — uppdateras automatiskt strax.", "Checking the calendars — updates automatically in a moment.")}</p>
      )}
      {pulseState === "soft_empty" && (
        <p className={stateCopy}>
          {t("Källorna svarade men listar inga händelser för perioden.", "The sources responded but list no events for this period.")}
        </p>
      )}
      {pulseState === "rejected_empty" && (
        <p className={stateCopy}>
          {liveRejectedSentence(liveEvents, lang)}
        </p>
      )}
      {pulseState === "unavailable" && (
        <p className={stateCopy}>
          {liveFailure
            ? liveFailureSentence(liveFailure)
            : t("Parranda kunde inte verifiera händelser just nu — försök igen om en stund.", "Parranda couldn't verify events right now — try again shortly.")}
        </p>
      )}
      {showSelectedDayStatus && (
        <p className={stateCopy}>
          {t("Inga verifierade evenemang för den valda dagen.", "No verified events for the selected day.")}
        </p>
      )}

      {offer && suggestion && (
        <div data-live-route-suggestion="" className="mt-4 flex flex-col gap-2 border-t-line border-parranda-live/15 pt-4">
          <p className="wrap-anywhere text-15 font-semibold leading-snug text-parranda-ink">
            {t(`Föreslaget kvällsstopp nära ${offer.lastLabel}`, `Suggested evening stop near ${offer.lastLabel}`)}
          </p>
          <LiveEventSummary event={offer.event} lang={lang} now={now} selectedDate={suggestion.date} compact />
          <p className="type-data text-13 text-parranda-ink-meta">{liveRelevanceSentence(offer.relevance, lang, t)}</p>
          <p className="text-13 leading-relaxed text-parranda-ink-muted">
            {t("Parranda prövar en ny gångrutt med evenemanget sist. Andra stopp kan ändras.",
              "Parranda checks a new walking route ending at the event. Other stops may change.")}
          </p>
          <button type="button" onClick={() => suggestion.onPlan(offer.event, offer.event.title || "")}
            className={buttonClass("live", "mt-1 min-h-11 self-start px-4 py-2 text-left text-15")}>
            {t("Planera med evenemanget", "Plan with this event")}
          </button>
        </div>
      )}

      {boardRows.length > 0 && (
        <div className="mt-4">
          {!liveEvents?.selected_date && <p className="type-data mb-2 text-13 text-parranda-ink-meta">{liveDayLabel}</p>}
          <ul className="flex flex-col">
            {boardRows.map((ev: PulseEvent, i: number) => {
              const clock = eventBoardClock(ev, lang, now, liveEvents?.selected_date);
              return (
                <li key={ev.id ?? i} className={`${clock ? "grid grid-cols-[3.5rem_minmax(0,1fr)] items-baseline gap-x-3" : "flex flex-col"} min-w-0 border-t-line border-parranda-live/15 py-2.5`}>
                  {clock && (
                    <p className="type-data flex w-14 flex-col leading-tight">
                      <span className="text-15 font-bold text-parranda-live">{clock.at}</span>
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
      {pulseState === "partial" && (
        <p className="mt-3 text-13 leading-relaxed text-parranda-ink-meta">
          {liveEvents?.acquisition?.source_health?.reasons?.includes("source_collection_truncated")
            ? t("Vissa kalendrar kunde bara läsas delvis — fler händelser kan finnas hos källan.", "Some calendars were only partly read — more events may be listed at the source.")
            : t("Några källor kunde inte nås just nu — listan kan vara ofullständig.", "Some sources couldn't be reached right now — the list may be incomplete.")}
        </p>
      )}

      {pulseSources && (
        <p className="mt-4 text-11 leading-relaxed text-parranda-ink-meta">
          {t("Källa", "Source")}: {pulseSources}
        </p>
      )}
    </section>
  );
}
