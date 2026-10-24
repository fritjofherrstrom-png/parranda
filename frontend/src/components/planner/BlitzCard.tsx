/**
 * BLITZ — one trusted next move beside the day, in the same "now" zone as Live.
 * It reads the anchor and picks but never re-composes the day. Whether it is
 * offered at all (not in curated mode, not after a refusal or an unresolved
 * place) is the orchestrator's decision; this renders the offer and the answer.
 * Its copy says "near you" only when the anchor IS the reader's position, and
 * promises the day stays as it is only when there is a day on screen.
 */
import type { AnywhereBlitzView, BlitzMoveView } from "../../lib/blitz-view.mjs";
import { mapsPlaceUrl } from "../../lib/maps-links.mjs";
import { eventSourceLink, eventTiming } from "../../lib/pulse-view.mjs";
import { BoltIcon, ExternalIcon } from "../shared/icons";
import { busyButton, buttonClass, Eyebrow } from "../shared/ui";
import type { Lang, Translate } from "./copy";

function placeHoursNote(move: BlitzMoveView, t: Translate) {
  return move.availability_status === "available_in_window"
    ? t("Källans schema anger öppet vid kontrollen. Kontrollera att du hinner fram.", "Listed hours indicate open at the time checked. Check that you can arrive in time.")
    : t("Öppet just nu är inte bekräftat. Kolla innan du går.", "Open now is not confirmed. Check before you go.");
}

export default function BlitzCard({
  t,
  lang,
  mode,
  anchorLabel,
  dayOnScreen,
  blitz,
  blitzPhase,
  sharePositionForBlitz,
  blitzPositionFailed,
  blitzResult,
  typedPlaceLabel,
}: {
  t: Translate;
  lang: Lang;
  mode: "typed" | "near_me";
  anchorLabel: string;
  dayOnScreen: boolean;
  blitz: () => void;
  blitzPhase: "idle" | "loading" | "done" | "error" | "position_needed" | "locating";
  sharePositionForBlitz: () => void;
  blitzPositionFailed: boolean;
  blitzResult: AnywhereBlitzView | null;
  typedPlaceLabel: string;
}) {
  return (
    <div className="flex flex-col gap-3">
      <button
        type="button"
        {...busyButton(blitzPhase === "loading" || blitzPhase === "locating", blitz)}
        className={buttonClass("secondary", "min-h-11 w-full px-4 text-sm")}
      >
        <BoltIcon className="h-4 w-4 text-parranda-glow" />
        {blitzPhase === "loading" ? t("Läser läget …", "Reading the moment …") : t("Blitz just nu", "Blitz right now")}
      </button>
      {blitzPhase === "idle" && (
        <p className="-mt-1 text-center text-xs text-parranda-ink-meta">
          {mode === "near_me"
            ? t("Ett förslag nära dig, just nu", "One idea near you, right now")
            : t(`Ett förslag i ${anchorLabel}, just nu`, `One idea in ${anchorLabel}, right now`)}
          {dayOnScreen ? t(" — din dag ändras inte.", " — your day stays as it is.") : "."}
        </p>
      )}
      {blitzPhase !== "idle" && (
        <section className="rounded-parranda border-line border-parranda-line-faint bg-parranda-fill-faint p-4" aria-live="polite">
          <div className="flex items-center gap-2">
            <BoltIcon className="h-3.5 w-3.5 text-parranda-glow" />
            <Eyebrow tone="glow">{t("Blitz just nu", "Blitz right now")}</Eyebrow>
          </div>
          {blitzPhase === "loading" && (
            <p className="mt-2 text-sm text-parranda-ink-muted">
              {t("Läser tiden, platsen och vad som händer nära dig …", "Reading the time, place and what is happening nearby …")}
            </p>
          )}
          {(blitzPhase === "position_needed" || blitzPhase === "locating") && (
            <div className="mt-2 flex flex-col items-start gap-3">
              <p className="text-sm text-parranda-ink-muted">
                {t("Blitz behöver din position. Den sparas inte när dagen öppnas igen. Dela den för ett förslag nära dig.", "Blitz needs your location. It isn't kept when a saved day is reopened. Share it for an idea near you.")}
              </p>
              <button type="button" {...busyButton(blitzPhase === "locating", sharePositionForBlitz)} className={buttonClass("secondary", "min-h-11 px-4 text-sm")}>
                {blitzPhase === "locating" ? t("Hämtar position …", "Getting location …") : t("Dela position för Blitz", "Share position for Blitz")}
              </button>
              {blitzPositionFailed && <p className="text-sm text-parranda-ink-muted">{t("Positionen kunde inte delas. Försök igen eller välj en plats på startsidan.", "Your position could not be shared. Try again or choose a place on the home page.")}</p>}
            </div>
          )}
          {blitzPhase === "error" && (
            <p className="mt-2 text-sm text-parranda-ink-muted">
              {t("Blitz kunde inte läsa läget just nu.", "Blitz could not read the moment right now.")}
              {dayOnScreen ? t(" Din plan är oförändrad.", " Your day is unchanged.") : ""}
            </p>
          )}
          {blitzPhase === "done" && blitzResult?.state === "blocked" && (
            <p className="mt-2 text-sm text-parranda-ink-muted">
              {mode === "near_me"
                ? t("Inget tillräckligt säkert förslag nära dig just nu.", "No reliable idea near you right now.")
                : t(
                    `Inget tillräckligt säkert förslag i ${anchorLabel} just nu.`,
                    `No reliable idea in ${anchorLabel} right now.`,
                  )}
              {dayOnScreen ? t(" Din plan är oförändrad.", " Your day is unchanged.") : ""}
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
                  <p className="type-title text-2xl text-parranda-ink">{move.title}</p>
                  <div className="type-data mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-11 text-parranda-ink-muted">
                    {move.kind === "live_event" && <span>{t("Live-händelse", "Live event")}</span>}
                    {timing && <span>{timing}</span>}
                    {Number.isFinite(move.walking_minutes) && <span>{move.walking_minutes} {t("min till fots", "min walk")}</span>}
                    {move.source.label && <span>{move.source.label}</span>}
                  </div>
                </div>
                {move.kind === "place" && (
                  <p className="text-sm text-parranda-ink-soft">{placeHoursNote(move, t)}</p>
                )}
                <p className="text-xs text-parranda-ink-meta">
                  {move.kind === "place"
                    ? dayOnScreen
                      ? t("Ett källstött platsförslag. Det ändrar inte dagens rutt.", "A source-backed place suggestion. It does not change today's route.")
                      : t("Ett källstött platsförslag.", "A source-backed place suggestion.")
                    : dayOnScreen
                    ? t("Ett förslag utifrån platsen, tiden och dina intressen. Det ändrar inte dagens rutt.", "An idea from your place, time and interests. It doesn't change today's route.")
                    : t("Ett förslag utifrån platsen, tiden och dina intressen.", "An idea from your place, time and interests.")}
                </p>
                <div className="flex flex-wrap gap-2">
                  {mapsUrl && (
                    <a href={mapsUrl} target="_blank" rel="noreferrer" className={buttonClass("primary", "min-h-11 px-4 text-sm")}>
                      {t("Öppna i Maps", "Open in Maps")}
                      <ExternalIcon />
                    </a>
                  )}
                  {move.kind === "live_event"
                    ? liveSourceLink && (
                        <a href={liveSourceLink.href} target="_blank" rel="noreferrer" className={buttonClass("secondary", "min-h-11 px-4 text-sm")}>
                          <span>{liveSourceLink.text}</span>
                          <ExternalIcon />
                        </a>
                      )
                    : move.source.url && (
                        <a href={move.source.url} target="_blank" rel="noreferrer" className={buttonClass("secondary", "min-h-11 px-4 text-sm")}>
                          {t("Källa", "Source")}
                          <ExternalIcon />
                        </a>
                      )}
                </div>
                {secondary && (
                  <p className="border-t-line border-parranda-line-faint pt-2 text-xs text-parranda-ink-meta">
                    {secondary.kind === "live_event" ? t("Senare i närheten: ", "Later nearby: ") : t("Annars i närheten: ", "Otherwise nearby: ")}
                    <span className="font-bold text-parranda-ink-soft">{secondary.title}</span>
                    {secondary.kind === "place" && <span className="mt-1 block">{placeHoursNote(secondary, t)}</span>}
                  </p>
                )}
              </div>
            );
          })()}
        </section>
      )}
    </div>
  );
}
