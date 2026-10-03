/**
 * THE DAY HEADER (design handoff §3): title, honest counts, what the day did for
 * each pick, provenance, and the day-level actions — the walk in Maps, save and
 * share. The line below binds to primary_route only.
 *
 * "Linje": the title is signage (Archivo, wide and heavy), the counts are data
 * (mono), and the city name carries the route colour. Every honesty line keeps
 * the September rule — one fact, one place, beside what it qualifies.
 */
import type { ReactNode } from "react";
import type { RouteEnd, WalkingRoutePart } from "../../lib/maps-links.mjs";
import { walkingDistanceLabel } from "../../lib/route-context-view.mjs";
import { CheckIcon, ExternalIcon, HalfCircleIcon, MinusIcon, ShareIcon, StarIcon } from "../shared/icons";
import { buttonClass, Eyebrow } from "../shared/ui";
import { pickLabel, type Lang, type Translate } from "./copy";

type RoutePart = WalkingRoutePart;
type PickCoverage = { key: string; state: "covered" | "partial" | "missing" };

/**
 * The place name is set like a station sign: as large as the column allows for
 * ITS length, so "Rome" and "Barcelona" both fill one line instead of the
 * longer one breaking mid-word. The header is a size container; a capital in
 * the wide display cut is about 0.92em, and the size stays between 2rem and
 * 4.75rem. Only a name too long even at 2rem wraps (anywhere, as a last resort).
 */
function signSize(text: string): { fontSize: string } {
  const longestWord = Math.max(1, ...String(text).split(/\s+/).map((word) => word.length));
  return { fontSize: `clamp(2rem, calc(100cqi / ${(longestWord * 0.92).toFixed(2)}), 4.75rem)` };
}

function Note({ children }: { children: ReactNode }) {
  return (
    <p className="flex items-start gap-2 text-[13px] leading-relaxed text-parranda-ink/72">
      <span aria-hidden="true" className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-parranda-glow" />
      <span>{children}</span>
    </p>
  );
}

export default function DayHeader({
  t,
  lang,
  staleNotice,
  navigationInterrupted,
  retryPlan,
  mode,
  placeLabel,
  anchorLabel,
  dayWord,
  primaryRoute,
  coreCount,
  wovenCount,
  pickCoverage,
  sourceBackedDay,
  dayLimitationNote,
  timeAnchoring,
  restoredAt,
  resolveAndRun,
  routeParts,
  routeUrls,
  routeEndLabel,
  saveDay,
  isSaved,
  canShare,
  shareDay,
  shareCopied,
  routeOrigin,
  routeDestination,
  routeAnchorCoords,
  publishedStart,
  publishedEnd,
}: {
  t: Translate;
  lang: Lang;
  staleNotice: string | null;
  navigationInterrupted: boolean;
  retryPlan: () => void;
  mode: "typed" | "near_me";
  placeLabel: string | null | undefined;
  anchorLabel: string;
  dayWord: string;
  primaryRoute: any;
  coreCount: number;
  wovenCount: number;
  pickCoverage: PickCoverage[];
  sourceBackedDay: boolean;
  dayLimitationNote: string | null | undefined;
  timeAnchoring: string | null;
  restoredAt: string | null;
  resolveAndRun: () => void;
  routeParts: RoutePart[];
  routeUrls: string[];
  routeEndLabel: (end: RouteEnd) => string;
  saveDay: () => void;
  isSaved: boolean;
  canShare: boolean;
  shareDay: () => void;
  shareCopied: boolean;
  routeOrigin: unknown;
  routeDestination: unknown;
  routeAnchorCoords: unknown;
  publishedStart: any;
  publishedEnd: any;
}) {
  return (
    <header className="@container flex flex-col gap-3.5" aria-busy={staleNotice === "updating"}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <Eyebrow tone="glow" line>{t("Din dag", "Your day")}</Eyebrow>
        {/* The day on screen is deliberately still here, and deliberately
            marked as not current. Never a silent swap. */}
        {staleNotice === "updating" && (
          <span
            aria-live="polite"
            className="inline-flex items-center gap-1.5 rounded-full bg-parranda-ink/10 px-2.5 py-0.5 text-[11px] font-bold text-parranda-ink/75"
          >
            <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-parranda-glow motion-safe:animate-pulse" />
            {t("Uppdaterar dagen …", "Updating your day …")}
          </span>
        )}
        {staleNotice === "update_failed" && (
          <>
            <span
              aria-live="polite"
              className="inline-flex items-center gap-1.5 rounded-full bg-parranda-ember/12 px-2.5 py-0.5 text-[11px] font-bold text-parranda-clay"
            >
              {navigationInterrupted
                ? t("Planeringen pausades när du lämnade sidan — visar din förra dag", "Planning paused when you left — showing your previous day")
                : t("Kunde inte uppdatera — visar din förra dag", "Couldn't update — showing your previous day")}
            </span>
            <button
              type="button"
              onClick={retryPlan}
              className="inline-flex min-h-11 items-center rounded-full border-[1.5px] border-parranda-ember/50 px-3.5 text-xs font-bold text-parranda-clay transition hover:border-parranda-ember"
            >
              {navigationInterrupted ? t("Fortsätt planera", "Continue planning") : t("Försök uppdatera igen", "Try updating again")}
            </button>
          </>
        )}
      </div>
      <h2 className="type-title text-[2.5rem] text-parranda-ink sm:text-5xl lg:text-[3.25rem]">
        {mode === "near_me" && !placeLabel ? (
          <>
            {t("En dag", "A day")} <em className="type-display block not-italic text-parranda-ember" style={signSize(t("nära dig", "near you"))}>{t("nära dig", "near you")}</em>
          </>
        ) : (
          <>
            {t("En dag i", "A day in")} <em className="type-display block not-italic text-parranda-ember [overflow-wrap:anywhere]" style={signSize(anchorLabel)}>{anchorLabel}</em>
          </>
        )}
      </h2>
      <p className="type-data text-xs text-parranda-ink/72">
        {dayWord}
        {Number.isFinite(primaryRoute?.estimated_km)
          ? ` · ≈ ${walkingDistanceLabel(primaryRoute.estimated_km, lang)} ${t("till fots", "on foot")}`
          : ""}
        {Number.isFinite(primaryRoute?.longest_leg_km)
          ? ` · ${t("längsta sträcka", "longest stretch")} ${walkingDistanceLabel(primaryRoute.longest_leg_km, lang)}`
          : ""}
        {` · ${coreCount} ${coreCount === 1 ? t("stopp", "stop") : t("stopp", "stops")}`}
        {wovenCount > 0 ? ` + ${wovenCount} live${lang === "en" ? " event" : "-event"}` : ""}
      </p>
      {/* What the day did for each pick, in the pick's own words. A pick
          the route only partly covers, or does not cover, says so here
          rather than at the foot of the page. */}
      {pickCoverage.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label={t("Dina val i dagen", "Your picks in this day")}>
          {pickCoverage.map(({ key, state }) => (
            <li
              key={key}
              className={
                "inline-flex min-h-7 items-center gap-1.5 rounded-full px-3 text-xs " +
                (state === "covered"
                  ? "bg-parranda-ink font-bold text-parranda-paper"
                  : state === "partial"
                    ? "border-[1.5px] border-parranda-ink/22 font-semibold text-parranda-ink/80"
                    : "border-[1.5px] border-dashed border-parranda-ink/30 text-parranda-ink/72")
              }
            >
              {state === "covered" && <CheckIcon className="h-3 w-3" />}
              {state === "partial" && <HalfCircleIcon className="h-3 w-3 text-parranda-glow" />}
              {state === "missing" && <MinusIcon className="h-3 w-3" />}
              <span>{pickLabel(key, lang)}</span>
              {state === "covered" && <span className="sr-only">{t(" — med i dagen", " — in this day")}</span>}
              {state === "partial" && <span className="text-parranda-ink/68">{t(" · delvis", " · partly")}</span>}
              {state === "missing" && <span>{t(" · inte med", " · not in this day")}</span>}
            </li>
          ))}
        </ul>
      )}
      {sourceBackedDay && (
        <Note>
          {t(
            "Byggd från källstödda platser — Parranda har inte full kurering här ännu",
            "Built from source-backed places — Parranda does not have full curation here yet",
          )}
        </Note>
      )}
      {dayLimitationNote && <Note>{dayLimitationNote}</Note>}
      {/* Time-anchoring truth (#429): say when the arc is not anchored to
          the local clock — a today request at 22:00 must not read as a
          doable midday plan. Quietly note the trimmed variant too. */}
      {timeAnchoring === "full_arc_not_now" && (
        <Note>{t("En hel dags båge — inte förankrad till klockan just nu", "A full-day arc — not anchored to right now")}</Note>
      )}
      {timeAnchoring === "anchored_trimmed" && (
        <Note>{t("Förankrad till nu — tidigare dagdelar borttagna", "Anchored to now — earlier dayparts trimmed")}</Note>
      )}
      {restoredAt && (
        <p className="text-xs text-parranda-ink/68">
          {t("Sparad dag", "Saved day")} · {new Date(restoredAt).toLocaleDateString(lang === "en" ? "en-GB" : "sv-SE")} —{" "}
          <button type="button" onClick={() => resolveAndRun()} className="inline-flex min-h-11 items-center font-semibold underline underline-offset-2 hover:text-parranda-clay">
            {t("bygg om för färska events", "rebuild for fresh events")}
          </button>
        </p>
      )}
      {/* THE WALK IN MAPS. One link when Maps can take the whole walk. When
          it can't (Maps takes a few stops per link), a numbered sequence of
          named stretches: only the first is the primary action, the rest
          are the next steps of the same walk — never alternatives to it. */}
      {routeParts.length > 1 && (
        <div className="mt-1 flex flex-col gap-2">
          <Eyebrow>
            {t(`Promenaden i Maps · ${routeParts.length} delar`, `The walk in Maps · ${routeParts.length} parts`)}
          </Eyebrow>
          <ol className="flex flex-col gap-1.5">
            {routeParts.map((part, index) => {
              const newStops = part.stopIndexes.length;
              const first = index === 0;
              return (
                <li key={part.url}>
                  <a
                    href={part.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={
                      "flex min-h-14 items-center gap-3 rounded-parranda-btn px-3.5 py-2 text-left text-[15px] transition " +
                      (first
                        ? "bg-parranda-terracotta font-extrabold text-white hover:brightness-110"
                        : "border-[1.5px] border-parranda-ink/20 font-bold text-parranda-ink hover:border-parranda-ink/50")
                    }
                  >
                    <span
                      aria-hidden="true"
                      className={
                        "type-data inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold " +
                        (first ? "bg-white/22" : "bg-parranda-ink/8")
                      }
                    >
                      {index + 1}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="sr-only">{t(`Del ${index + 1} i Google Maps: `, `Part ${index + 1} in Google Maps: `)}</span>
                      {routeEndLabel(part.from)} → {routeEndLabel(part.to)}
                      <span className={"type-data block text-[11px] font-medium " + (first ? "text-white/85" : "text-parranda-ink/68")}>
                        {newStops > 0
                          ? t(`${newStops} stopp`, `${newStops} ${newStops === 1 ? "stop" : "stops"}`)
                          : t("Sista biten", "The last stretch")}
                      </span>
                    </span>
                    <ExternalIcon />
                  </a>
                </li>
              );
            })}
          </ol>
          <p className="text-xs leading-relaxed text-parranda-ink/68">
            {t(
              "Google Maps tar bara några stopp per länk, så promenaden öppnas i delar. Ta dem i ordning — varje del börjar där den förra slutar.",
              "Google Maps takes only a few stops per link, so the walk opens in parts. Take them in order — each part starts where the previous one ends.",
            )}
          </p>
        </div>
      )}
      <div className="mt-1 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
        {routeParts.length === 1 && (
          <a
            href={routeUrls[0]}
            target="_blank"
            rel="noopener noreferrer"
            className={buttonClass("primary", "col-span-2 min-h-12 px-5 text-[15px] sm:px-6")}
          >
            {t("Öppna rutten i Maps", "Open route in Maps")}
            <ExternalIcon />
          </a>
        )}
        <button
          type="button"
          onClick={saveDay}
          disabled={isSaved}
          aria-label={isSaved ? t("Dagen är sparad", "Day is saved") : t("Spara dagen", "Save this day")}
          className={buttonClass("secondary", "min-h-12 px-4 text-sm disabled:border-parranda-ember/50 disabled:text-parranda-clay disabled:opacity-100")}
        >
          <StarIcon filled={isSaved} />
          {isSaved ? t("Sparad", "Saved") : t("Spara", "Save")}
        </button>
        {canShare && (
          <button
            type="button"
            onClick={shareDay}
            aria-label={t("Dela dagen", "Share this day")}
            className={buttonClass("secondary", "min-h-12 px-4 text-sm")}
          >
            {shareCopied ? <CheckIcon className="h-4 w-4 text-parranda-ember" /> : <ShareIcon />}
            {shareCopied ? t("Länk kopierad", "Link copied") : t("Dela", "Share")}
          </button>
        )}
      </div>
      {/* A split walk already names its start and finish in the sequence. */}
      {routeParts.length <= 1 && Boolean(routeOrigin || routeDestination) && (
        <p className="text-xs text-parranda-ink/68">
          {Boolean(routeOrigin) && `${t("Start", "Start")}: ${routeAnchorCoords ? t("din valda position", "your chosen location") : String(publishedStart?.label || t("kartans startpunkt", "map start point"))}`}
          {routeOrigin && routeDestination ? " · " : ""}
          {Boolean(routeDestination) && `${t("Slut", "Finish")}: ${routeAnchorCoords ? t("din valda position", "your chosen location") : String(publishedEnd?.label || t("kartans slutpunkt", "map end point"))}`}
        </p>
      )}
      {routeUrls.length === 0 && (
        <p className="text-xs text-parranda-ink/68">
          {t("Hela rutten kan inte öppnas i Maps. Öppna platserna var för sig där kartlänk finns.", "The whole route cannot be opened in Maps. Open places individually where a map link is available.")}
        </p>
      )}
    </header>
  );
}
