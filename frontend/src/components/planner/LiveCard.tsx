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
import { eventTiming } from "../../lib/pulse-view.mjs";
import { ChevronRightIcon } from "../shared/icons";
import { buttonClass, Eyebrow } from "../shared/ui";
import type { Lang, Translate } from "./copy";
import { liveEventSource } from "./LiveEventSource";
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
  return (
    <section
      className="rounded-parranda border-[1.5px] border-parranda-live/35 bg-parranda-live/8 p-5 sm:p-6"
    >
      <Eyebrow tone="live" dot>
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
            <p className="text-[15px] font-bold leading-snug text-parranda-ink">
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
        <p className="mt-3 text-[13px] text-parranda-ink/72">
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

      {pulseBuckets.tonight.length > 0 && (
        <div className="mt-4">
          <p className="text-sm font-bold text-parranda-ink">{liveDayLabel}</p>
          <ul className="mt-2 flex flex-col gap-3">
            {pulseBuckets.tonight.slice(0, 4).map((ev: PulseEvent, i: number) => (
              <li key={ev.id ?? i} className="flex items-baseline gap-3 text-sm leading-relaxed text-parranda-ink/85">
                <span className="type-data min-w-[56px] shrink-0 text-xs font-semibold text-parranda-live">
                  {eventTiming(ev, lang, undefined, liveEvents?.selected_date)}
                </span>
                <span>
                  <span className="font-bold text-parranda-ink">{ev.title}</span>
                  {ev.place && <span className="text-parranda-ink/68"> · {ev.place}</span>}
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
        <p className="mt-4 border-t border-parranda-live/25 pt-3 text-sm text-parranda-ink/75">
          <span className="font-bold text-parranda-ink">{t("Följande 7 dagar", "Following 7 days")}</span>
          {" · "}
          {pulseBuckets.thisWeek.length}{" "}
          {pulseBuckets.thisWeek.length === 1 ? t("händelse listad", "more listed") : t("händelser listade", "more listed")}
        </p>
      )}
      {showExplore && (
        <button
          type="button"
          ref={liveSheetTriggerRef}
          onClick={openLiveSheet}
          className={buttonClass("live", "mt-4 min-h-12 w-full px-4 text-sm")}
        >
          {pulseBuckets.tonight.length > 0 || pulseBuckets.thisWeek.length > 0
            ? t("Se allt live", "See all live")
            : t("Utforska live", "Explore live")}
          <ChevronRightIcon className="h-4 w-4" />
        </button>
      )}
      {pulseState === "partial" && (
        <p className="mt-2 text-xs text-parranda-ink/68">
          {t("Alla källor kunde inte nås just nu — listan kan vara ofullständig.", "Some sources couldn't be reached right now — the list may be incomplete.")}
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
