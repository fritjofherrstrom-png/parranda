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
import { eventTiming, liveTimeGroups, liveTimeRepresentative } from "../../lib/pulse-view.mjs";
import { ChevronRightIcon } from "../shared/icons";
import { buttonClass, Eyebrow } from "../shared/ui";
import { liveTimeGroupLabel, type Lang, type Translate } from "./copy";
import { liveEventSource } from "./LiveEventSource";
import EventOccurrences from "./EventOccurrences";
import { liveRejectedSentence } from "../../lib/live-empty-copy.mjs";
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
  pulseSources: string | null;
  liveSheetTriggerRef: Ref<HTMLButtonElement>;
  openLiveSheet: () => void;
}) {
  const now = useLiveClock([...pulseBuckets.tonight, ...pulseBuckets.thisWeek]);
  // The same four highlights as before, read by where they stand in the day:
  // on now, later, during the day, started earlier. The day itself is named
  // once, in the heading above, so a row says only its clock. Rows the
  // sources give no place in time keep the plain list. A programme row's time
  // line is read from the same slot that places it in a group.
  const selectedDate = liveEvents?.selected_date ?? null;
  const shown = pulseBuckets.tonight.slice(0, 4);
  const timeGroups = liveTimeGroups(shown, { now, selectedDate });
  const grouped = Boolean(selectedDate) && timeGroups.some((group) => group.state !== "unknown");
  return (
    <section
      className="rounded-parranda border-line border-parranda-live/35 bg-parranda-live/8 p-5 sm:p-6"
    >
      <Eyebrow as="h2" tone="live" dot>
        {mode === "near_me"
          ? t("Live nära dig", "Live near you")
          : anchorLabel
            ? t(`Live i ${anchorLabel}`, `Live in ${anchorLabel}`)
            : t("Live här", "Live here")}
        {liveEvents?.selected_date ? ` · ${liveDayLabel}` : ""}
      </Eyebrow>

      {((showDay && dayflow?.weather?.headline) || clothing) && (
        <div className="mt-3 flex flex-col gap-1">
          {showDay && dayflow?.weather?.headline && (
            <p className="text-15 font-bold leading-snug text-parranda-ink">
              {dayflow.weather.headline}
              {dayflow.weather.pitch ? <span className="font-medium text-parranda-ink/75"> — {dayflow.weather.pitch}</span> : null}
            </p>
          )}
          {clothing && (
            <p className="text-sm text-parranda-ink">
              <span className="font-bold">{clothing.headline}</span>
              <span className="text-parranda-ink/75"> — {clothing.advice}</span>
            </p>
          )}
        </div>
      )}

      {wovenNames.length > 0 && (
        <p className="mt-3 text-13 text-parranda-ink/72">
          {wovenNames.map((n: string) => `${n} · ${includedInRoute}`).join(" · ")}
        </p>
      )}

      {/* Honest source-health states — coverage only says sources exist HERE;
          pulseHealthState says whether collection actually succeeded. Raw
          backend reason tokens never reach product copy. */}
      {pulseState === "uncovered" && (
        <p className="mt-3 text-sm text-parranda-ink/75">
          {t("Ingen live-eventkälla täcker den här platsen än — Parranda hittar inte på en.", "No live-events feed reaches this place yet — Parranda won't invent one.")}
        </p>
      )}
      {pulseState === "pending" && (
        <p className="mt-3 text-sm text-parranda-ink/75">{t("Kollar kalendrarna — uppdateras automatiskt strax.", "Checking the calendars — updates automatically in a moment.")}</p>
      )}
      {pulseState === "soft_empty" && (
        <p className="mt-3 text-sm text-parranda-ink/75">
          {t("Källorna svarade men listar inga händelser för perioden.", "The sources responded but list no events for this period.")}
        </p>
      )}
      {pulseState === "rejected_empty" && (
        <p className="mt-3 text-sm text-parranda-ink/75">
          {liveRejectedSentence(liveEvents, lang)}
        </p>
      )}
      {pulseState === "unavailable" && (
        <p className="mt-3 text-sm text-parranda-ink/75">
          {liveFailure
            ? liveFailureSentence(liveFailure)
            : t("Parranda kunde inte verifiera händelser just nu — försök igen om en stund.", "Parranda couldn't verify events right now — try again shortly.")}
        </p>
      )}

      {shown.length > 0 && (
        <div className="mt-4 flex flex-col gap-4">
          {!grouped && <p className="text-sm font-bold text-parranda-ink">{liveDayLabel}</p>}
          {(grouped ? timeGroups : [{ state: null, events: shown }]).map((group) => (
            <div key={group.state ?? "all"} className="flex flex-col gap-2" data-live-time-group={group.state ?? undefined}>
              {group.state && <h3 className="text-xs font-bold text-parranda-ink/75">{liveTimeGroupLabel(group.state, t)}</h3>}
              <ul className="flex flex-col gap-3">
                {group.events.map((ev: PulseEvent, i: number) => (
                  <li key={ev.id ?? i} className="flex min-w-0 flex-col gap-1 text-sm leading-relaxed text-parranda-ink/85">
                    <span className="type-data max-w-full whitespace-normal break-words text-xs font-semibold text-parranda-live">
                      {eventTiming(liveTimeRepresentative(ev, now, selectedDate), lang, now, selectedDate,
                        { omitDate: grouped ? selectedDate : null, underOnNow: group.state === "now" })}
                    </span>
                    <span className="min-w-0 max-w-full break-words">
                      <span className="font-bold text-parranda-ink">{ev.title}</span>
                      {ev.place && <span className="text-parranda-ink/68"> · {ev.place}</span>}
                      {liveEventSource(ev, lang)}
                    </span>
                    <EventOccurrences event={ev} lang={lang} now={now} selectedDate={selectedDate ?? undefined} />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
      {/* The card keeps a one-line summary for the week — the full list
          lives in the Live sheet. The count comes from the bucket, never
          from copy. */}
      {pulseBuckets.thisWeek.length > 0 && (
        <p className="mt-4 border-t border-parranda-live/25 pt-3 text-sm text-parranda-ink/75">
          <span className="font-bold text-parranda-ink">{t("Kommande 7 dagar", "Next 7 days")}</span>
          {" · "}
          {pulseBuckets.thisWeek.length}{" "}
          {pulseBuckets.thisWeek.length === 1 ? t("till", "more") : t("till", "more")}
        </p>
      )}
      {showExplore && (
        <button
          type="button"
          ref={liveSheetTriggerRef}
          onClick={openLiveSheet}
          className={buttonClass("liveOutline", "mt-4 min-h-12 w-full px-4 text-sm")}
        >
          {pulseBuckets.tonight.length > 0 || pulseBuckets.thisWeek.length > 0
            ? t("Se allt live", "See all live")
            : t("Utforska live", "Explore live")}
          <ChevronRightIcon className="h-4 w-4" />
        </button>
      )}
      {pulseState === "partial" && (
        <p className="mt-2 text-xs text-parranda-ink/68">
          {liveEvents?.acquisition?.source_health?.reasons?.includes("source_collection_truncated")
            ? t("Vissa kalendrar kunde bara läsas delvis — fler händelser kan finnas hos källan.", "Some calendars were only partly read — more events may be listed at the source.")
            : t("Några källor kunde inte nås just nu — listan kan vara ofullständig.", "Some sources couldn't be reached right now — the list may be incomplete.")}
        </p>
      )}

      {pulseSources && (
        <p className="mt-3 text-xs text-parranda-ink/68">
          {t("Källa", "Source")}: {pulseSources}
        </p>
      )}
    </section>
  );
}
