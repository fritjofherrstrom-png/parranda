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
import { CheckIcon, CloudIcon, CloudSunIcon, ExternalIcon, FogIcon, HalfCircleIcon, MinusIcon, RainIcon, SearchIcon, ShareIcon, SnowIcon, StarIcon, SunIcon, ThunderstormIcon, WalkIcon } from "../shared/icons";
import { busyButton, buttonClass, compactPillTarget, Eyebrow, labelChip } from "../shared/ui";
import { pickLabel, type Lang, type Translate } from "./copy";
import { RingMark } from "../shared/RingMark";

type RoutePart = WalkingRoutePart;
// "pending": a pick the day on screen never answered — just added, its rebuild
// still coming. That day says nothing about it yet, so neither does the chip.
type PickCoverage = { key: string; state: "covered" | "partial" | "missing" | "pending" | "unanswered" };

/** A quiet fact about the day, not a control. */
// The day's facts are labels, not choices (ui.tsx labelChip).
const metaChip = labelChip;

/** The source's daily condition, separate from its effect on day composition. */
const WEATHER_CONDITIONS: Record<string, [string, string]> = {
  sun: ["Sol", "Sun"],
  partly_cloudy: ["Växlande", "Partly cloudy"],
  clouds: ["Moln", "Clouds"],
  fog: ["Dimma", "Fog"],
  rain: ["Regn", "Rain"],
  snow: ["Snö", "Snow"],
  thunderstorm: ["Åska", "Thunderstorms"],
  mixed: ["Växlande", "Mixed"],
};
const WEATHER_ICONS: Record<string, typeof SunIcon> = {
  sun: SunIcon, partly_cloudy: CloudSunIcon, clouds: CloudIcon, fog: FogIcon,
  rain: RainIcon, snow: SnowIcon, thunderstorm: ThunderstormIcon, mixed: CloudSunIcon,
};
// Match the provider's fresh-cache window (server/weather.js). Saved answers
// keep their original observation time; restoring one cannot renew its weather.
const FORECAST_FRESH_MS = 30 * 60 * 1000;

function selectedDate(value: string | null | undefined): Date | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? date : null;
}

/** "Thu 29 Oct" / "tors 29 okt": weekday, day, month (the design system's one
 *  date form); the year only when the day is not in the current one. */
function dayDateLabel(date: Date, lang: Lang): string {
  const sameYear = date.getUTCFullYear() === new Date().getUTCFullYear();
  return date
    .toLocaleDateString(lang === "en" ? "en-GB" : "sv-SE", {
      weekday: "short", day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }), timeZone: "UTC",
    })
    .replace(/[.,]/g, "");
}

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
    <p className="flex items-start gap-2 text-13 leading-relaxed text-parranda-ink/72">
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
      "Platserna kommer från externa källor; utbudet kan vara begränsat.",
      "Places come from external sources; coverage may be limited.",
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
  date,
  relativeDay = null,
  weatherSummary,
  titleAction = null,
  controls = null,
  coreCount,
  wovenCount,
  pickCoverage,
  priorityShortfall = null,
  dayLimitationNote,
  sourceShortfall = null,
  onLookForMorePlaces,
  rechecking = false,
  restoredAt,
  canUpdateSaved = true,
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
  /** The date of the answer on screen, including held or restored days. */
  date: string | null | undefined;
  /** 0 today, 1 tomorrow, null for any other day (a restored day after midnight is not "today"). */
  relativeDay?: 0 | 1 | null;
  /** A trusted selected-day forecast; absence never gets a weather guess. */
  weatherSummary: any;
  /** Beside the title: Change. */
  titleAction?: ReactNode;
  /** Under the title and date: the picks summary and Adjust. */
  controls?: ReactNode;
  coreCount: number;
  wovenCount: number;
  pickCoverage: PickCoverage[];
  priorityShortfall?: PickCoverage | null;
  dayLimitationNote: string | null | undefined;
  /** The published day's place sources fell short: one failed, or the places were not all in yet (historical, never a live job). */
  sourceShortfall?: "failed" | "partial" | null;
  /** Ask the same question again for more places (the day stays until the answer lands). */
  onLookForMorePlaces?: () => void;
  /** That look is the rebuild now running. */
  rechecking?: boolean;
  restoredAt: string | null;
  canUpdateSaved?: boolean;
  resolveAndRun: () => void;
}) {
  // The day's facts as quiet chips: how far and how many stops; each stop
  // states its own walk. The date and its forecast stand under the heading.
  const distance = Number.isFinite(primaryRoute?.estimated_km)
    ? `≈ ${walkingDistanceLabel(primaryRoute.estimated_km, lang)} ${t("till fots", "on foot")}`
    : null;
  const stops = `${coreCount} ${coreCount === 1 ? t("stopp", "stop") : t("stopp", "stops")}` +
    (wovenCount > 0 ? ` + ${wovenCount} live${lang === "en" ? " event" : "-event"}` : "");
  const displayedDate = selectedDate(date);
  const condition = WEATHER_CONDITIONS[String(weatherSummary?.condition || "")];
  const WeatherIcon = WEATHER_ICONS[String(weatherSummary?.condition || "")];
  const forecastFetchedAt = typeof weatherSummary?.fetched_at === "string" ? Date.parse(weatherSummary.fetched_at) : NaN;
  const forecastExpiresAt = forecastFetchedAt + FORECAST_FRESH_MS;
  const [expiredForecast, setExpiredForecast] = useState<number | null>(null);
  useEffect(() => {
    const remaining = forecastExpiresAt - Date.now();
    if (!Number.isFinite(remaining) || remaining <= 0) return;
    const timer = setTimeout(() => setExpiredForecast(forecastExpiresAt), remaining);
    return () => clearTimeout(timer);
  }, [forecastExpiresAt]);
  const forecastFresh = Number.isFinite(forecastFetchedAt) && forecastFetchedAt <= Date.now() + 5 * 60 * 1000
    && forecastExpiresAt > Date.now() && expiredForecast !== forecastExpiresAt;
  const allPicksCovered = pickCoverage.length > 0 && pickCoverage.every(({ state }) => state === "covered");
  const weatherChip = forecastFresh && displayedDate && weatherSummary?.date === date && weatherSummary?.stale === false && Number.isFinite(weatherSummary?.max_temp)
    ? `${Math.round(weatherSummary.max_temp)}°`
    : null;
  // The parent temporarily omits source notes while updating. They still
  // describe the held day, and its focused update action must stay mounted.
  const previousShortfall = useRef(sourceShortfall);
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const sourceUpdateRef = useRef<HTMLButtonElement | null>(null);
  const sourceUpdateHadFocus = useRef(false);
  const displayedShortfall = sourceShortfall || (staleNotice ? previousShortfall.current : null);
  useEffect(() => {
    if (sourceShortfall || !staleNotice) previousShortfall.current = sourceShortfall;
  }, [sourceShortfall, staleNotice]);
  useEffect(() => {
    // A healthy replacement removes the optional action. Keep a reader who
    // waited there with the day, without taking focus back from another task.
    if (!displayedShortfall && sourceUpdateHadFocus.current && document.activeElement === document.body) headingRef.current?.focus();
    if (staleNotice !== "updating") sourceUpdateHadFocus.current = false;
  }, [displayedShortfall, staleNotice]);
  return (
    <header className="@container flex flex-col gap-4" aria-busy={staleNotice === "updating"}>
      {(staleNotice === "updating" || staleNotice === "update_failed") && <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        {/* The day on screen is deliberately still here, and deliberately
            marked as not current. Never a silent swap. */}
        {staleNotice === "updating" && (
          <span
            aria-live="polite"
            className="inline-flex min-h-7 items-center gap-2 rounded-full border-line border-parranda-ember/60 px-2.5 text-xs font-bold text-parranda-clay"
          >
            <RingMark className="h-3 w-3" />
            {t("Uppdaterar dagen …", "Updating your day …")}
          </span>
        )}
        {staleNotice === "update_failed" && (
          <>
            <span
              aria-live="polite"
              className="inline-flex items-center gap-1.5 rounded-full bg-parranda-ember/12 px-2.5 py-0.5 text-11 font-bold text-parranda-clay"
            >
              {navigationInterrupted
                ? t("Planeringen pausades när du lämnade sidan — visar din förra dag", "Planning paused when you left — showing your previous day")
                : t("Kunde inte uppdatera — visar din förra dag", "Couldn't update — showing your previous day")}
            </span>
            <button
              type="button"
              onClick={retryPlan}
              className="inline-flex min-h-11 items-center rounded-full border-line border-parranda-ember/50 px-3.5 text-xs font-bold text-parranda-clay transition hover:border-parranda-ember"
            >
              {navigationInterrupted ? t("Fortsätt planera", "Continue planning") : t("Försök uppdatera igen", "Try updating again")}
            </button>
          </>
        )}
      </div>}
      {/* The compact title: "A day in Lyon" on one line where the place
          allows, with Change beside it, so the stops start high on a phone. */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-start justify-between gap-3">
          <h1 ref={headingRef} tabIndex={-1} className="type-title min-w-0 pt-2.5 text-[1.625rem] text-parranda-ink [overflow-wrap:anywhere] [text-wrap:balance] sm:text-[2rem]">
            {mode === "near_me" && !placeLabel ? (
              <>{t("En dag", "A day")} {t("nära dig", "near you")}</>
            ) : (
              <>{t("En dag i", "A day in")} {anchorLabel}</>
            )}
          </h1>
          {titleAction}
        </div>
        {/* When, under the title: the date as a timetable reads it, and the
            forecast as one unit — the high, then a small badge for the sky.
            Not among the facts chips: the weather is the day's condition,
            not something the route did. */}
        {(displayedDate || weatherChip) && (
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {displayedDate && <time dateTime={date!} className="type-data text-13 text-parranda-ink/80">
              {relativeDay === 0 ? `${t("Idag", "Today")} · ` : relativeDay === 1 ? `${t("Imorgon", "Tomorrow")} · ` : ""}
              {dayDateLabel(displayedDate, lang)}
            </time>}
            {/* A short rule, so "29 Oct" and "12°" never read as one figure. */}
            {displayedDate && weatherChip && <span aria-hidden="true" className="h-3.5 w-[1.5px] rounded-full bg-parranda-ink/20" />}
            {weatherChip && (
              <span role="img" className="inline-flex items-center gap-1.5"
                aria-label={t(`Prognosens högsta temperatur: ${weatherChip}C${condition ? `. ${condition[0]}` : ""}`, `Forecast high: ${weatherChip}C${condition ? `. ${condition[1]}` : ""}`)}
                title={condition ? t(condition[0], condition[1]) : t("Prognosens högsta temperatur", "Forecast high")}>
                <span className="type-data text-13 text-parranda-ink">{weatherChip}</span>
                {WeatherIcon && (
                  <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-parranda-ink/8">
                    <WeatherIcon className="h-3.5 w-3.5 text-parranda-ink/80" />
                  </span>
                )}
              </span>
            )}
          </p>
        )}
      </div>
      {/* What the reader can change: the picks and rhythm, with Adjust. */}
      {controls}
      <ul className="flex flex-wrap gap-1.5" aria-label={t("Om dagen", "About the day")}>
        {distance && (
          <li className={metaChip}>
            <WalkIcon className="h-3.5 w-3.5 text-parranda-ink/72" />
            {distance}
          </li>
        )}
        <li className={metaChip}>{stops}</li>
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
            // Status, not selection: covered and partial are labels like the
            // facts row (an ink fill would read as a chosen chip, as in Adjust).
            // Missing keeps the dashed tone, which means "not in the day".
            <li
              key={key}
              className={
                state === "missing"
                  ? "inline-flex items-center gap-1.5 rounded-full border-line border-dashed border-parranda-ink/30 px-2.5 py-1 text-xs font-semibold text-parranda-ink/72"
                  : labelChip
              }
            >
              {state === "covered" && <CheckIcon className="h-3 w-3 text-parranda-ember" />}
              {state === "partial" && <HalfCircleIcon className="h-3 w-3 text-parranda-glow" />}
              {state === "missing" && <MinusIcon className="h-3 w-3" />}
              {state === "pending" && <RingMark className="h-3 w-3" />}
              <span>{pickLabel(key, lang)}</span>
              {state === "covered" && <span className="sr-only">{t(" — med i dagen", " — in this day")}</span>}
              {state === "partial" && <span className="text-parranda-ink/68">{t(" · delvis", " · partly")}</span>}
              {state === "missing" && <span>{t(" · inte med", " · not in this day")}</span>}
              {state === "pending" && <span className="text-parranda-ink/68">{t(" · letar platser …", " · finding places …")}</span>}
              {state === "unanswered" && <span className="text-parranda-ink/68">{t(" · ännu inte bedömt", " · not assessed yet")}</span>}
            </li>
          ))}
        </ul>
      )}
      {priorityShortfall && (
        <p className="text-13 leading-relaxed text-parranda-ink/72" role="status">
          {priorityShortfall.state === "partial"
            ? t(`Ditt förstaval ${pickLabel(priorityShortfall.key, lang)} finns bara delvis med i den här dagen.`,
                `Your first choice ${pickLabel(priorityShortfall.key, lang)} is only partly represented in this day.`)
            : t(`Ditt förstaval ${pickLabel(priorityShortfall.key, lang)} finns inte med i den här dagen.`,
                `Your first choice ${pickLabel(priorityShortfall.key, lang)} is not represented in this day.`)}
        </p>
      )}
      {/* Source limitations describe this published answer, never a live job:
          one plain sentence and the one thing a reader can do about it. A
          bold "Some place information is missing", a hidden "About the place
          sources" and an "Update the day" link that could swap the stops
          silently confused more than they told (iPhone, 23 Oct 2026).
          Looking again asks the same question; its result is said in the
          change line ("Looked for more places: …", with Undo). */}
      {displayedShortfall && (
        <div className="flex flex-col items-start gap-2 text-13 leading-relaxed text-parranda-ink/72">
          <p role="status">
            {displayedShortfall === "failed"
              ? t("Inte alla platser kunde läsas in, så det kan finnas fler än de som visas.", "Not every place could be loaded, so there may be more than the ones shown.")
              : t("Inte alla platser hann läsas in, så det kan finnas fler än de som visas.", "Not every place loaded in time, so there may be more than the ones shown.")}
          </p>
          {onLookForMorePlaces && canUpdateSaved && (
            <button type="button" ref={sourceUpdateRef}
              {...busyButton(staleNotice === "updating", () => {
                sourceUpdateHadFocus.current = document.activeElement === sourceUpdateRef.current;
                onLookForMorePlaces();
              })}
              className={`${compactPillTarget} gap-2 border-line border-parranda-ink/18 px-3.5 font-bold text-parranda-ink hover:border-parranda-ink/50 aria-busy:cursor-progress ${rechecking ? "" : "aria-disabled:opacity-60"}`}>
              {rechecking ? <RingMark className="h-3.5 w-3.5" /> : <SearchIcon className="h-3.5 w-3.5 text-parranda-ink/72" />}
              {rechecking ? t("Letar efter fler platser …", "Looking for more places …") : t("Leta efter fler platser", "Look for more places")}
            </button>
          )}
        </div>
      )}
      {/* What the day CONTAINS stays under the title (a thin day says so);
          how it was ASSEMBLED is one "About this day" line beside the map. */}
      {dayLimitationNote && <Note>{dayLimitationNote}</Note>}
      {restoredAt && (
        <p className="text-xs text-parranda-ink/68">
          {t("Sparad dag", "Saved day")} · {new Date(restoredAt).toLocaleDateString(lang === "en" ? "en-GB" : "sv-SE", { day: "numeric", month: "short", year: "numeric" })} —{" "}
          {canUpdateSaved ? (
            <button type="button" onClick={() => resolveAndRun()} className="inline-flex min-h-11 items-center font-semibold underline underline-offset-2 hover:text-parranda-clay">
              {t("bygg om för färska events", "rebuild for fresh events")}
            </button>
          ) : (
            <span>{t("Den sparade dagen kan inte uppdateras säkert. ", "We cannot safely update this saved day. ")}
              <a href={`/?lang=${lang}`} className="inline-flex min-h-11 items-center font-semibold underline underline-offset-2">
                {t("Välj startpunkt och datum", "Choose a starting point and date")}
              </a>
            </span>
          )}
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
  anchorIsPosition,
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
  anchorIsPosition: boolean;
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
                      "flex min-h-14 items-center gap-3 rounded-parranda-btn px-3.5 py-2 text-left text-15 transition " +
                      (first
                        ? "bg-parranda-terracotta font-extrabold text-white hover:brightness-110"
                        : "border-line border-parranda-ink/20 font-bold text-parranda-ink hover:border-parranda-ink/50")
                    }
                  >
                    <span
                      aria-hidden="true"
                      className={
                        "type-data inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold " +
                        // A darker disc keeps the white digit at 6.7:1 on terracotta (white/22 gave 3.7:1).
                        (first ? "bg-black/15" : "bg-parranda-ink/8")
                      }
                    >
                      {index + 1}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="sr-only">{t(`Del ${index + 1} i Google Maps: `, `Part ${index + 1} in Google Maps: `)}</span>
                      {routeEndLabel(part.from)} → {routeEndLabel(part.to)}
                      <span className={"type-data block text-11 font-medium " + (first ? "text-white" : "text-parranda-ink/68")}>
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
            className={buttonClass("primary", "col-span-2 min-h-12 px-5 text-15 sm:px-6")}
          >
            {t("Öppna rutten i Maps", "Open route in Maps")}
            <ExternalIcon />
          </a>
        )}
        <button
          type="button"
          // Saved stays focusable: a disabled button would drop the focus
          // that just pressed it to the top of the page.
          onClick={isSaved ? undefined : saveDay}
          aria-disabled={isSaved || undefined}
          aria-label={isSaved ? t("Dagen är sparad", "Day is saved") : t("Spara dagen", "Save this day")}
          className={buttonClass("secondary", "min-h-12 px-4 text-sm aria-disabled:border-parranda-ember/50 aria-disabled:text-parranda-clay aria-disabled:opacity-100")}
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
          {Boolean(routeOrigin) && `${t("Start", "Start")}: ${anchorIsPosition ? t("Din position", "Your position") : String(publishedStart?.label || t("kartans startpunkt", "map start point"))}`}
          {routeOrigin && routeDestination ? " · " : ""}
          {Boolean(routeDestination) && `${t("Slut", "Finish")}: ${anchorIsPosition ? t("Din position", "Your position") : String(publishedEnd?.label || t("kartans slutpunkt", "map end point"))}`}
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
