/**
 * THE DAY HEADER (design handoff §3): title, honest counts, what the day did for
 * each pick, provenance, and the day-level actions — the walk in Maps, save and
 * share. The line below binds to primary_route only.
 *
 * "Linje": the title is signage (Archivo, wide and heavy), the counts are data
 * (mono), and the city name carries the route colour. Every honesty line keeps
 * the September rule — one fact, one place, beside what it qualifies.
 */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { RouteEnd, WalkingRoutePart } from "../../lib/maps-links.mjs";
import { walkingDistanceLabel } from "../../lib/route-context-view.mjs";
import { CheckIcon, ExternalIcon, HalfCircleIcon, MinusIcon, ShareIcon, StarIcon, SunIcon, WalkIcon } from "../shared/icons";
import { buttonClass, Eyebrow } from "../shared/ui";
import { pickLabel, type Lang, type Translate } from "./copy";

type RoutePart = WalkingRoutePart;
type PickCoverage = { key: string; state: "covered" | "partial" | "missing" };

/** A quiet fact about the day, not a control. */
const metaChip =
  "inline-flex items-center gap-1.5 rounded-full bg-parranda-ink/[0.07] px-2.5 py-1 text-xs font-semibold text-parranda-ink/85";

/** The weather source's daily summary (server/weather.js), in the reader's words. */
const WEATHER_CONDITIONS: Record<string, [string, string]> = {
  sun: ["Sol", "Sun"],
  clouds: ["Moln", "Clouds"],
  rain: ["Regn", "Rain"],
  mixed: ["Växlande", "Mixed"],
};

/**
 * The place name is set like a station sign: as large as the column allows for
 * ITS longest word, so "Rome", "Malmö" and "Barcelona" each fill one line and
 * no word ever breaks mid-way. The static render starts from an estimate (the
 * header is a size container; a capital in the wide display cut is roughly one
 * em). Once mounted, the real width of the longest word is measured and the
 * size is fitted to the column, between 2rem and 4.75rem; it refits when the
 * column or the fonts change. Only a word too long even at 2rem may break
 * (anywhere, as a last resort). Line height stays at 1 so the marks on Å, Ö
 * and É never touch the line above (a little room above the first line too).
 */
const SIGN_MIN_PX = 32;
const useClientLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;
const SIGN_MAX_PX = 76;

function signEstimate(text: string): string {
  const longestWord = Math.max(1, ...String(text).split(/\s+/).map((word) => word.length));
  return `clamp(2rem, calc(100cqi / ${(longestWord * 1.02).toFixed(2)}), 4.75rem)`;
}

export function PlaceSign({ text }: { text: string }) {
  const ref = useRef<HTMLElement | null>(null);
  const [fitted, setFitted] = useState<{ text: string; px: number; breakable: boolean } | null>(null);
  const words = String(text).split(/\s+/).filter(Boolean);

  useClientLayoutEffect(() => {
    const sign = ref.current;
    if (!sign || typeof window === "undefined") return;
    let frame = 0;
    const fit = () => {
      const column = sign.clientWidth;
      const current = parseFloat(window.getComputedStyle(sign).fontSize);
      // Measure each word unwrapped in a hidden probe, so the measurement does
      // not depend on whether the last fit allowed breaking.
      const probe = document.createElement("span");
      probe.setAttribute("aria-hidden", "true");
      probe.style.cssText = "position:absolute;visibility:hidden;white-space:nowrap;left:0;top:0;";
      sign.appendChild(probe);
      let widest = 0;
      for (const word of words) {
        probe.textContent = word;
        widest = Math.max(widest, probe.getBoundingClientRect().width);
      }
      sign.removeChild(probe);
      if (!column || !current || !widest) return;
      const emWidth = widest / current;
      const ideal = Math.floor((column / emWidth) * 0.98);
      const px = Math.max(SIGN_MIN_PX, Math.min(SIGN_MAX_PX, ideal));
      const breakable = ideal < SIGN_MIN_PX;
      setFitted((prev) => (prev && prev.text === text && prev.px === px && prev.breakable === breakable ? prev : { text, px, breakable }));
    };
    // Coalesce bursts of resize notifications into one fit per frame.
    const later = typeof window.requestAnimationFrame === "function"
      ? (fn: () => void) => window.requestAnimationFrame(fn)
      : (fn: () => void) => window.setTimeout(fn, 16);
    const cancel = typeof window.cancelAnimationFrame === "function"
      ? (id: number) => window.cancelAnimationFrame(id)
      : (id: number) => window.clearTimeout(id);
    const schedule = () => {
      cancel(frame);
      frame = later(fit);
    };
    fit();
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(schedule) : null;
    observer?.observe(sign);
    document.fonts?.ready?.then(schedule).catch(() => {});
    return () => {
      cancel(frame);
      observer?.disconnect();
    };
  }, [text]); // eslint-disable-line react-hooks/exhaustive-deps -- words derive from text

  const fit = fitted && fitted.text === text ? fitted : null;
  return (
    <em
      ref={ref}
      className={"type-display block not-italic text-parranda-ember" + (fit?.breakable ? " [overflow-wrap:anywhere]" : "")}
      style={{ fontSize: fit ? `${fit.px}px` : signEstimate(text), lineHeight: 1, paddingTop: "0.08em" }}
    >
      {words.map((word, index) => (
        <span key={index}>
          {index > 0 ? " " : null}
          <span data-sign-word="" className={fit?.breakable ? "" : "whitespace-nowrap"}>{word}</span>
        </span>
      ))}
    </em>
  );
}

function Note({ children }: { children: ReactNode }) {
  return (
    <p className="flex items-start gap-2 text-[13px] leading-relaxed text-parranda-ink/72">
      <span aria-hidden="true" className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-parranda-glow" />
      <span>{children}</span>
    </p>
  );
}

/**
 * How the day was assembled, in the order a reader needs it: where the places
 * came from, then how it sits on the clock. Said once, in "About this day".
 */
export function dayAssemblyNotes(t: Translate, { sourceBackedDay, timeAnchoring }: { sourceBackedDay: boolean; timeAnchoring: string | null }): string[] {
  const notes: string[] = [];
  if (sourceBackedDay) {
    notes.push(t(
      "Byggd från källstödda platser — Parranda har inte full kurering här ännu.",
      "Built from source-backed places — Parranda does not have full curation here yet.",
    ));
  }
  // Time-anchoring truth (#429): a today request at 22:00 must not read as a
  // doable midday plan. Quietly note the trimmed variant too.
  if (timeAnchoring === "full_arc_not_now") notes.push(t("En hel dags båge — inte förankrad till klockan just nu.", "A full-day arc — not anchored to right now."));
  if (timeAnchoring === "anchored_trimmed") notes.push(t("Förankrad till nu — tidigare dagdelar borttagna.", "Anchored to now — earlier dayparts trimmed."));
  return notes;
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
  primaryRoute,
  weather,
  coreCount,
  wovenCount,
  pickCoverage,
  dayLimitationNote,
  placesArriving = false,
  onUpdateDay,
  restoredAt,
  resolveAndRun,
}: {
  t: Translate;
  lang: Lang;
  staleNotice: string | null;
  navigationInterrupted: boolean;
  retryPlan: () => void;
  mode: "typed" | "near_me";
  placeLabel: string | null | undefined;
  anchorLabel: string;
  primaryRoute: any;
  /** The selected date's weather read (dayflow_context), present only when the server has one. */
  weather: any;
  coreCount: number;
  wovenCount: number;
  pickCoverage: PickCoverage[];
  dayLimitationNote: string | null | undefined;
  /** A place source is still fetching: more places can arrive. */
  placesArriving?: boolean;
  onUpdateDay?: () => void;
  restoredAt: string | null;
  resolveAndRun: () => void;
}) {
  // The day's facts as quiet chips: how far, how many stops, and the day's
  // weather when the server read one for this date. The anchor card above
  // already says which day; each stop states its own walk.
  const distance = Number.isFinite(primaryRoute?.estimated_km)
    ? `≈ ${walkingDistanceLabel(primaryRoute.estimated_km, lang)} ${t("till fots", "on foot")}`
    : null;
  const stops = `${coreCount} ${coreCount === 1 ? t("stopp", "stop") : t("stopp", "stops")}` +
    (wovenCount > 0 ? ` + ${wovenCount} live${lang === "en" ? " event" : "-event"}` : "");
  const observed = weather?.provenance?.observed;
  const condition = WEATHER_CONDITIONS[String(observed?.condition || "")];
  // Only a current read with a real temperature; a stale forecast is not shown as the day's weather.
  const allPicksCovered = pickCoverage.length > 0 && pickCoverage.every(({ state }) => state === "covered");
  const weatherChip = !weather?.provenance?.stale && Number.isFinite(observed?.max_temp)
    ? [condition ? t(condition[0], condition[1]) : null, `${t("max", "high")} ${Math.round(observed.max_temp)}°`].filter(Boolean).join(" · ")
    : null;
  return (
    <header className="@container flex flex-col gap-5" aria-busy={staleNotice === "updating"}>
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
      <h1 className="type-title text-[2.5rem] text-parranda-ink sm:text-5xl lg:text-[3.25rem]">
        {mode === "near_me" && !placeLabel ? (
          <>
            {t("En dag", "A day")} <PlaceSign text={t("nära dig", "near you")} />
          </>
        ) : (
          <>
            {t("En dag i", "A day in")} <PlaceSign text={anchorLabel} />
          </>
        )}
      </h1>
      <ul className="flex flex-wrap gap-1.5" aria-label={t("Om dagen", "About the day")}>
        {distance && (
          <li className={metaChip}>
            <WalkIcon className="h-3.5 w-3.5 text-parranda-ink/72" />
            {distance}
          </li>
        )}
        <li className={metaChip}>{stops}</li>
        {weatherChip && (
          <li className={metaChip}>
            {observed?.condition === "sun" && <SunIcon className="h-3.5 w-3.5 text-parranda-ink/72" />}
            {weatherChip}
          </li>
        )}
        {/* Every pick in the day: one fact here instead of repeating the picks
            the anchor card names. A partial or missing pick lists them all. */}
        {allPicksCovered && (
          <li className={metaChip}>
            <CheckIcon className="h-3 w-3 text-parranda-ember" />
            {t("Alla val finns med", "All picks included")}
          </li>
        )}
      </ul>
      {/* What the day did for each pick, in the pick's own words. A pick
          the route only partly covers, or does not cover, says so here
          rather than at the foot of the page. When every pick is in the day
          the facts row above says so in one chip instead. */}
      {pickCoverage.length > 0 && !allPicksCovered && (
        <ul className="flex flex-wrap gap-2" aria-label={t("Dina val i dagen", "Your picks in this day")}>
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
      {/* The server answered within its bounded wait while a place source is
          still fetching. The day is real but provisional: say that more is on
          its way and let the reader ask again, rather than judging the place. */}
      {placesArriving && (
        <div role="status" className="flex flex-col items-start gap-2 rounded-parranda border-[1.5px] border-parranda-ember/40 bg-parranda-ember/8 px-4 py-3">
          <p className="text-sm font-bold text-parranda-ink">{t("Fler platser är på väg", "More places are on their way")}</p>
          <p className="text-[13px] leading-relaxed text-parranda-ink/80">
            {t(
              "En källa hämtar fortfarande platser här. Dagen nedan bygger på det som hunnit komma — uppdatera om en stund för en rikare dag.",
              "A source is still fetching places here. The day below uses what has arrived so far — update in a moment for a fuller day.",
            )}
          </p>
          {onUpdateDay && (
            <button type="button" onClick={onUpdateDay} className={buttonClass("primary", "min-h-11 px-4 text-sm")}>
              {t("Uppdatera dagen", "Update the day")}
            </button>
          )}
        </div>
      )}
      {/* What the day CONTAINS stays under the title (a thin day says so);
          how it was ASSEMBLED is one "About this day" line beside the map. */}
      {dayLimitationNote && <Note>{dayLimitationNote}</Note>}
      {restoredAt && (
        <p className="text-xs text-parranda-ink/68">
          {t("Sparad dag", "Saved day")} · {new Date(restoredAt).toLocaleDateString(lang === "en" ? "en-GB" : "sv-SE")} —{" "}
          <button type="button" onClick={() => resolveAndRun()} className="inline-flex min-h-11 items-center font-semibold underline underline-offset-2 hover:text-parranda-clay">
            {t("bygg om för färska events", "rebuild for fresh events")}
          </button>
        </p>
      )}
    </header>
  );
}

/**
 * TAKING THE DAY WITH YOU — Maps, save and share. They follow the stops: the
 * page leads with the day itself, and these act on the day once it has been
 * read. Maps computes the real walking path, so that is said here, beside it.
 */
export function DayActions({
  t,
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
  stale = false,
}: {
  t: Translate;
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
  stale?: boolean;
}) {
  return (
    <section
      aria-label={t("Ta med dagen", "Take the day with you")}
      className={`${stale ? "opacity-60 motion-safe:transition-opacity" : ""} flex flex-col gap-3`}
    >
      {/* THE WALK IN MAPS. One link when Maps can take the whole walk. When
          it can't (Maps takes a few stops per link), a numbered sequence of
          named stretches: only the first is the primary action, the rest
          are the next steps of the same walk — never alternatives to it. */}
      {routeParts.length > 1 && (
        <div className="flex flex-col gap-2.5">
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
      <div className="grid grid-cols-2 gap-2.5 sm:flex sm:flex-wrap">
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
      {routeUrls.length > 0 && (
        <p className="text-xs text-parranda-ink/68">
          {t("Google Maps beräknar gångvägen när du öppnar rutten.", "Google Maps works out the walking path when you open the route.")}
        </p>
      )}
    </section>
  );
}
