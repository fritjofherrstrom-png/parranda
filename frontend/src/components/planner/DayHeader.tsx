import { createPortal } from "react-dom";
/**
 * THE DAY HEADER (design handoff §3): title, honest counts, what the day did for
 * each pick, provenance, and the day-level actions — the walk in Maps, save and
 * share. The line below binds to primary_route only.
 *
 * "Linje": the title uses the same compact Archivo signage as the public day.
 * Each fact stays beside what it qualifies.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { RouteEnd, WalkingRoutePart } from "../../lib/maps-links.mjs";
import { routeUnconfirmedTonightPicks, walkingDistanceLabel } from "../../lib/route-context-view.mjs";
import { CheckIcon, CloudIcon, CloudSunIcon, ExternalIcon, FogIcon, HalfCircleIcon, MinusIcon, RainIcon, SearchIcon, ShareIcon, SnowIcon, StarIcon, SunIcon, ThunderstormIcon, WalkIcon } from "../shared/icons";
import { busyButton, buttonClass, compactPillTarget, controlTone, Eyebrow, labelChip } from "../shared/ui";
import { pickLabel, type Lang, type Translate } from "./copy";
import { RingMark } from "../shared/RingMark";
import { dayIdea } from "../../lib/day-idea.mjs";
import { daySummary } from "../../lib/day-summary.mjs";

type RoutePart = WalkingRoutePart;
// "pending": a pick the day on screen never answered — just added, its rebuild
// still coming. That day says nothing about it yet, so neither does the chip.
type PickCoverage = { key: string; state: "covered" | "partial" | "missing" | "pending" | "unanswered" };


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
 * Which day is on screen, said first in the picks line under the title (When
 * is one of the settings Adjust opens): "Today" and "Tomorrow" only when the
 * shown date is today's or tomorrow's, otherwise the date itself, so a saved
 * day reopened later never reads as today.
 */
export function DayWhen({ t, lang, date, relativeDay }: {
  t: Translate;
  lang: Lang;
  date: string | null | undefined;
  /** 0 today, 1 tomorrow, null for any other day. */
  relativeDay: 0 | 1 | null;
}) {
  const shown = selectedDate(date);
  if (!shown) return null;
  return (
    <time dateTime={date!}>
      {relativeDay === 0 ? t("Idag", "Today") : relativeDay === 1 ? t("Imorgon", "Tomorrow") : dayDateLabel(shown, lang)}
    </time>
  );
}

/** A day-shape caveat under the facts: one plain line, like the facts' own voice. */
function Note({ children }: { children: ReactNode }) {
  return <p className="text-13 leading-relaxed text-parranda-ink-muted">{children}</p>;
}

/**
 * How the day was assembled, in the order a reader needs it: where the places
 * came from, then how it sits on the clock. Said once, in "About this day".
 */
export function dayAssemblyNotes(t: Translate, { sourceBackedDay, timeAnchoring, eveningIsTonight = false, eveningDate = null, lang = "sv" }: {
  sourceBackedDay: boolean; timeAnchoring: string | null;
  /** The evening is tonight on the place's own trusted calendar day; otherwise the day's date names it. */
  eveningIsTonight?: boolean; eveningDate?: string | null; lang?: Lang;
}): string[] {
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
  if (timeAnchoring === "evening_plan") {
    const shown = eveningIsTonight ? null : selectedDate(eveningDate);
    const label = shown ? dayDateLabel(shown, lang) : null;
    notes.push(eveningIsTonight
      ? t("Planerad för kvällen. För några av dina val är öppettiderna i kväll okända.", "Planned for the evening. For some of your picks, tonight's opening hours are unknown.")
      : label
        ? t(`Planerad för kvällen ${label}. För några av dina val är kvällens öppettider okända.`,
          `Planned for the evening of ${label}. For some of your picks, that evening's opening hours are unknown.`)
        : t("Planerad för kvällen. För några av dina val är kvällens öppettider okända.", "Planned for the evening. For some of your picks, the evening's opening hours are unknown."));
  }
  return notes;
}

/**
 * What the day did for each pick, in one line inside the Adjust row (Linje 2):
 * the pick's name after its mark (in the day, partly, not in it, still
 * looking). Status, never selection: no ink fill, no chip.
 */
export function PickSummary({ t, lang, pickCoverage, rhythmLabel }: {
  t: Translate; lang: Lang; pickCoverage: PickCoverage[]; rhythmLabel: string;
}) {
  return (
    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
      <ul className="flex flex-wrap gap-x-3 gap-y-0.5 text-sm font-semibold text-parranda-ink" aria-label={t("Dina val i dagen", "Your picks in this day")}>
        {pickCoverage.map(({ key, state }) => (
          <li key={key} className="inline-flex items-center gap-1.5 whitespace-nowrap">
            {state === "covered" && <CheckIcon className="h-3.5 w-3.5 text-parranda-ember" />}
            {state === "partial" && <HalfCircleIcon className="h-3.5 w-3.5 text-parranda-glow" />}
            {state === "missing" && <MinusIcon className="h-3.5 w-3.5 text-parranda-ink-meta" />}
            {state === "pending" && <RingMark className="h-3.5 w-3.5" />}
            <span className={state === "missing" || state === "unanswered" ? "text-parranda-ink-muted" : ""}>{pickLabel(key, lang)}</span>
            {state === "covered" && <span className="sr-only">{t(" — med i dagen", " — in this day")}</span>}
            {state === "partial" && <span className="font-medium text-parranda-ink-meta">{t(" · delvis", " · partly")}</span>}
            {state === "missing" && <span className="font-medium text-parranda-ink-meta">{t(" · inte med", " · not in this day")}</span>}
            {state === "pending" && <span className="font-medium text-parranda-ink-meta">{t(" · letar platser …", " · finding places …")}</span>}
            {state === "unanswered" && <span className="font-medium text-parranda-ink-meta">{t(" · ännu inte bedömt", " · not assessed yet")}</span>}
          </li>
        ))}
      </ul>
      <span className="text-13 text-parranda-ink-meta">{rhythmLabel}</span>
    </span>
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
  primaryRoute,
  date,
  eveningIsTonight = false,
  weatherSummary,
  titleAction = null,
  controls = null,
  overview = null,
  picksInControls = false,
  relativeDay = null,
  coreCount,
  wovenCount,
  pickCoverage,
  priorityShortfall = null,
  dayLimitationNote,
  sourceShortfall = null,
  onLookForMorePlaces,
  rechecking = false,
  shortfallHost = null,
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
  /** The evening is tonight on the place's own trusted calendar day (routeEveningIsTonight). */
  eveningIsTonight?: boolean;
  /** A trusted selected-day forecast; absence never gets a weather guess. */
  weatherSummary: any;
  /** Beside the title: Change. */
  titleAction?: ReactNode;
  /** Under the title: which day, the picks and rhythm, with Adjust. */
  controls?: ReactNode;
  /** A phone: the map's short, still overview, between the title and the facts. */
  overview?: ReactNode;
  /** The picks are said in the Adjust row (PickSummary), not again here. */
  picksInControls?: boolean;
  /** 0 today, 1 tomorrow, null for any other day: the facts line says the day the way a person would. */
  relativeDay?: 0 | 1 | null;
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
  /** Linje 2: when the route's "About this day and map" exists, the place
   *  shortfall and its action are said there instead of under the title. */
  shortfallHost?: HTMLElement | null;
  restoredAt: string | null;
  canUpdateSaved?: boolean;
  resolveAndRun: () => void;
}) {
  // The day's facts as quiet chips: how far, how many stops and the selected
  // date's forecast; each stop states its own walk, the picks line says which day.
  const distance = Number.isFinite(primaryRoute?.estimated_km)
    ? `≈ ${walkingDistanceLabel(primaryRoute.estimated_km, lang)} ${t("till fots", "on foot")}`
    : null;
  // Picks an evening plan keeps although only places whose kind usually fits
  // the daytime serve them. Said the same way for one pick or several; the day
  // never moves them to another date.
  const unconfirmedTonight = routeUnconfirmedTonightPicks(primaryRoute).map((key) => pickLabel(key, lang));
  const unconfirmedList = unconfirmedTonight.length > 1
    ? `${unconfirmedTonight.slice(0, -1).join(", ")} ${t("och", "and")} ${unconfirmedTonight[unconfirmedTonight.length - 1]}`
    : unconfirmedTonight[0] || "";
  const idea = dayIdea(primaryRoute, lang);
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
  const weatherChip = forecastFresh && displayedDate && weatherSummary?.date === date && weatherSummary?.stale === false && Number.isFinite(weatherSummary?.max_temp)
    ? `${Math.round(weatherSummary.max_temp)}°`
    : null;
  // The parent temporarily omits source notes while updating. They still
  // describe the held day, and its focused update action must stay mounted.
  const previousShortfall = useRef(sourceShortfall);
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const sourceUpdateHadFocus = useRef(false);
  // Sample at removal, not at activation: the reader can tab to or from
  // the busy button while the answer is on its way.
  const sourceUpdateRef = useCallback((button: HTMLButtonElement | null) => {
    if (button) return () => { sourceUpdateHadFocus.current = document.activeElement === button; };
  }, []);
  const displayedShortfall = sourceShortfall || (staleNotice ? previousShortfall.current : null);
  useEffect(() => {
    if (sourceShortfall || !staleNotice) previousShortfall.current = sourceShortfall;
  }, [sourceShortfall, staleNotice]);
  useLayoutEffect(() => {
    // A healthy replacement removes the optional action. Keep a reader who
    // waited there with the day, without taking focus back from another task.
    if (!displayedShortfall && sourceUpdateHadFocus.current && document.activeElement === document.body) headingRef.current?.focus();
    if (staleNotice !== "updating") sourceUpdateHadFocus.current = false;
  }, [displayedShortfall, staleNotice]);
  const shortfallBlock = displayedShortfall ? (
          <div className="flex flex-col items-start gap-2 text-13 leading-relaxed text-parranda-ink-muted">
            <p role="status">
              {displayedShortfall === "failed"
                ? t("Inte alla platser kunde läsas in, så det kan finnas fler än de som visas.", "Not every place could be loaded, so there may be more than the ones shown.")
                : t("Inte alla platser hann läsas in, så det kan finnas fler än de som visas.", "Not every place loaded in time, so there may be more than the ones shown.")}
            </p>
            {onLookForMorePlaces && canUpdateSaved && (
              <button type="button" ref={sourceUpdateRef}
                {...busyButton(staleNotice === "updating", onLookForMorePlaces)}
                className={`${compactPillTarget} gap-2 px-3.5 ${controlTone} aria-busy:cursor-progress ${rechecking ? "" : "aria-disabled:opacity-60"}`}>
                {rechecking ? <RingMark className="h-3.5 w-3.5" /> : <SearchIcon className="h-3.5 w-3.5 text-parranda-ink-muted" />}
                {rechecking ? t("Letar efter fler platser …", "Looking for more places …") : t("Leta efter fler platser", "Look for more places")}
              </button>
            )}
          </div>
      ) : null;

  // What the day contains and how it stands (a thin day, a saved snapshot)
  // is said before the picks and the map, so the map is the last thing in
  // the header and the line can come straight out of it (Linje 2).
  const tail = (
      <div className="flex flex-col gap-1.5 empty:hidden">
        {pickCoverage.length > 0 && !picksInControls && (
          <ul className="flex flex-wrap gap-2" aria-label={t("Dina val i dagen", "Your picks in this day")}>
            {pickCoverage.map(({ key, state }) => (
              <li key={key} className={state === "missing"
                ? "inline-flex items-center gap-1.5 rounded-parranda-tag border-line border-dashed border-parranda-line-firm px-2 py-1 text-xs font-semibold text-parranda-ink-muted"
                : labelChip}>
                {state === "covered" && <CheckIcon className="h-3 w-3 text-parranda-ember" />}
                {state === "partial" && <HalfCircleIcon className="h-3 w-3 text-parranda-glow" />}
                {state === "missing" && <MinusIcon className="h-3 w-3" />}
                {state === "pending" && <RingMark className="h-3 w-3" />}
                <span>{pickLabel(key, lang)}</span>
                {state === "covered" && <span className="sr-only">{t(" — med i dagen", " — in this day")}</span>}
                {state === "partial" && <span className="text-parranda-ink-meta">{t(" · delvis", " · partly")}</span>}
                {state === "missing" && <span>{t(" · inte med", " · not in this day")}</span>}
                {state === "pending" && <span className="text-parranda-ink-meta">{t(" · letar platser …", " · finding places …")}</span>}
                {state === "unanswered" && <span className="text-parranda-ink-meta">{t(" · ännu inte bedömt", " · not assessed yet")}</span>}
              </li>
            ))}
          </ul>
        )}
        {priorityShortfall && (
          <p className="text-13 leading-relaxed text-parranda-ink-muted" role="status">
            {priorityShortfall.state === "partial"
              ? t(`Ditt förstaval ${pickLabel(priorityShortfall.key, lang)} finns bara delvis med i den här dagen.`,
                  `Your first choice ${pickLabel(priorityShortfall.key, lang)} is only partly represented in this day.`)
              : t(`Ditt förstaval ${pickLabel(priorityShortfall.key, lang)} finns inte med i den här dagen.`,
                  `Your first choice ${pickLabel(priorityShortfall.key, lang)} is not represented in this day.`)}
          </p>
        )}
        {unconfirmedTonight.length > 0 && (
          <p className="text-13 leading-relaxed text-parranda-ink-muted" role="status">
            {eveningIsTonight
              ? t(`${unconfirmedList}: öppettiderna i kväll är okända – kontrollera innan du går.`,
                `${unconfirmedList}: tonight's opening hours are unknown — check before you go.`)
              : displayedDate
                ? t(`${unconfirmedList}: öppettiderna på kvällen ${dayDateLabel(displayedDate, lang)} är okända – kontrollera innan du går.`,
                  `${unconfirmedList}: opening hours on the evening of ${dayDateLabel(displayedDate, lang)} are unknown — check before you go.`)
                : t(`${unconfirmedList}: kvällens öppettider är okända – kontrollera innan du går.`,
                  `${unconfirmedList}: the evening's opening hours are unknown — check before you go.`)}
          </p>
        )}
        {/* Source limitations describe this published answer, never a live job:
            one plain sentence and the one thing a reader can do about it. A
            bold "Some place information is missing", a hidden "About the place
            sources" and an "Update the day" link that could swap the stops
            silently confused more than they told (iPhone, 23 Oct 2026).
            Looking again asks the same question; its result is said in the
            change line ("Looked for more places: …", with Undo). */}
        {displayedShortfall && (shortfallHost ? createPortal(shortfallBlock, shortfallHost) : shortfallBlock)}
        {/* What the day CONTAINS stays under the title (a thin day says so);
            how it was ASSEMBLED is one "About this day" line beside the map. */}
        {dayLimitationNote && <Note>{dayLimitationNote}</Note>}
        {restoredAt && (
          <p className="text-xs text-parranda-ink-meta">
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
      </div>
  );

  return (
    <header className="flex flex-col gap-4" aria-busy={staleNotice === "updating"}>
      {(staleNotice === "updating" || staleNotice === "update_failed") && <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        {/* The day on screen is deliberately still here, and deliberately
            marked as not current. Never a silent swap. */}
        {staleNotice === "updating" && (
          <span
            aria-live="polite"
            className="inline-flex min-h-7 items-center gap-2 rounded-parranda-tag border-line border-parranda-ember/60 px-2.5 text-xs font-bold text-parranda-clay"
          >
            <RingMark className="h-3 w-3" />
            {t("Uppdaterar dagen …", "Updating your day …")}
          </span>
        )}
        {staleNotice === "update_failed" && (
          <>
            <span
              aria-live="polite"
              className="inline-flex items-center gap-1.5 rounded-parranda-tag bg-parranda-ember/12 px-2.5 py-1 text-xs font-bold text-parranda-clay"
            >
              {navigationInterrupted
                ? t("Planeringen pausades när du lämnade sidan — visar din förra dag", "Planning paused when you left — showing your previous day")
                : t("Kunde inte uppdatera — visar din förra dag", "Couldn't update — showing your previous day")}
            </span>
            <button
              type="button"
              onClick={retryPlan}
              className="inline-flex min-h-11 items-center rounded-parranda-btn border-line border-parranda-ember/50 px-3.5 text-xs font-bold text-parranda-clay transition hover:border-parranda-ember"
            >
              {navigationInterrupted ? t("Fortsätt planera", "Continue planning") : t("Försök uppdatera igen", "Try updating again")}
            </button>
          </>
        )}
      </div>}
      <div className="flex flex-col">
        <div className="flex items-start justify-between gap-3">
          <h1 ref={headingRef} tabIndex={-1} className="type-title min-w-0 wrap-anywhere pt-2 text-[1.625rem] text-parranda-ink sm:pt-1.5 sm:text-[2rem]">
            {mode === "near_me" && !placeLabel
              ? t("En dag nära dig", "A day near you")
              : `${t("En dag i", "A day in")} ${anchorLabel}`}
          </h1>
          {titleAction}
        </div>
        <div data-day-facts="" className="mt-2.5 flex flex-col gap-0.5 [overflow-wrap:anywhere]">
          <p className="text-17 font-semibold leading-snug text-parranda-ink">
            {daySummary({ stops: coreCount, live: wovenCount, distance: distance ? walkingDistanceLabel(primaryRoute.estimated_km, lang) : null, lang })}
          </p>
          <p className="text-15 text-parranda-ink-muted">
            {displayedDate && <time dateTime={date!}>{relativeDay === 0 ? t("Idag", "Today") : relativeDay === 1 ? t("Imorgon", "Tomorrow") : dayDateLabel(displayedDate, lang)}</time>}
            {/* The selected date's forecast, said after the date: the sky's
                icon, the high and the sky in words. Only a fresh reading. */}
            {weatherChip && (
              <>
                {/* Said as a sentence, as on the board: "Today, 5° and rain." */}
                {displayedDate ? <span aria-hidden="true">{", "}</span> : null}
                <span role="img" className="inline-flex items-center gap-1 align-[-0.15em]"
                  aria-label={t(`Prognosens högsta temperatur: ${weatherChip}C${condition ? `. ${condition[0]}` : ""}`, `Forecast high: ${weatherChip}C${condition ? `. ${condition[1]}` : ""}`)}
                  title={condition ? t(condition[0], condition[1]) : t("Prognosens högsta temperatur", "Forecast high")}>
                  {WeatherIcon && <WeatherIcon className="h-4 w-4" />}
                  {weatherChip}
                </span>
                <span aria-hidden="true">{condition ? ` ${t("och", "and")} ${t(condition[0], condition[1]).toLowerCase()}.` : "."}</span>
              </>
            )}
          </p>
        </div>
        {/* The day's character from its published places, said once and
            quietly under the facts: "Culture, food and history. From
            Postmuseum to Strömparterren." */}
        {idea && (
          <p data-day-idea="" className="mt-1.5 text-13 leading-snug text-parranda-ink-muted [overflow-wrap:anywhere]">
            <span className="font-semibold text-parranda-ink-soft">{idea.headline}.</span>
            {idea.journey ? <> {idea.journey}</> : null}
          </p>
        )}
      </div>
      {tail}
      {controls}
      {/* On a phone the map's still overview pictures the day, edge to edge. */}
      {overview}
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
      className={`${stale ? "opacity-60 motion-safe:transition-opacity" : ""} flex flex-col gap-1.5`}
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
                        ? "bg-parranda-terracotta font-extrabold text-parranda-on-terracotta hover:brightness-110"
                        : "bg-parranda-fill font-bold text-parranda-ink hover:bg-parranda-fill-strong")
                    }
                  >
                    <span
                      aria-hidden="true"
                      className={
                        "type-data inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-parranda-tag text-13 font-bold " +
                        // A darker disc keeps the white digit at 6.7:1 on terracotta (white/22 gave 3.7:1).
                        (first ? "bg-parranda-shade" : "bg-parranda-fill")
                      }
                    >
                      {index + 1}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="sr-only">{t(`Del ${index + 1} i Google Maps: `, `Part ${index + 1} in Google Maps: `)}</span>
                      {routeEndLabel(part.from)} → {routeEndLabel(part.to)}
                      <span className={"type-data block text-13 font-medium " + (first ? "text-parranda-on-terracotta" : "text-parranda-ink-meta")}>
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
          <p className="text-xs leading-relaxed text-parranda-ink-meta">
            {t(
              "Google Maps tar bara några stopp per länk, så promenaden öppnas i delar. Ta dem i ordning — varje del börjar där den förra slutar.",
              "Google Maps takes only a few stops per link, so the walk opens in parts. Take them in order — each part starts where the previous one ends.",
            )}
          </p>
        </div>
      )}
      {/* One walk, one card: the action, then where it starts and ends.
          The line of stops above leads into it. */}
      {routeParts.length === 1 && (
        <a
          href={routeUrls[0]}
          target="_blank"
          rel="noopener noreferrer"
          className="flex min-h-16 items-center gap-3 rounded-parranda-btn bg-parranda-terracotta px-4 py-3 text-parranda-on-terracotta transition hover:brightness-110"
        >
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="text-17 font-extrabold leading-tight">{t("Öppna rutten i Maps", "Open route in Maps")}</span>
            {!routeOrigin && !routeDestination && (
              <span className="text-13 font-medium leading-snug">
                {routeEndLabel(routeParts[0].from)} → {routeEndLabel(routeParts[0].to)}
                {`, ${routeParts[0].stopIndexes.length} ${t("stopp", routeParts[0].stopIndexes.length === 1 ? "stop" : "stops")}`}
              </span>
            )}
            {Boolean(routeOrigin || routeDestination) && (
              <span className="text-13 font-medium leading-snug">
                {Boolean(routeOrigin) && `${t("Start", "Start")}: ${anchorIsPosition ? t("Din position", "Your position") : String(publishedStart?.label || t("kartans startpunkt", "map start point"))}`}
                {routeOrigin && routeDestination ? " · " : ""}
                {Boolean(routeDestination) && `${t("Slut", "Finish")}: ${anchorIsPosition ? t("Din position", "Your position") : String(publishedEnd?.label || t("kartans slutpunkt", "map end point"))}`}
              </span>
            )}
          </span>
          <ExternalIcon className="h-[18px] w-[18px]" />
        </a>
      )}
      <div className="flex flex-wrap gap-x-5">
        <button
          type="button"
          // Saved stays focusable: a disabled button would drop the focus
          // that just pressed it to the top of the page.
          onClick={isSaved ? undefined : saveDay}
          aria-disabled={isSaved || undefined}
          aria-label={isSaved ? t("Dagen är sparad", "Day is saved") : t("Spara dagen", "Save this day")}
          className={buttonClass("quiet", "min-h-11 -ml-2 px-2 text-15 aria-disabled:text-parranda-clay aria-disabled:opacity-100")}
        >
          <StarIcon filled={isSaved} />
          {isSaved ? t("Sparad", "Saved") : t("Spara", "Save")}
        </button>
        {canShare && (
          <button
            type="button"
            onClick={shareDay}
            aria-label={t("Dela dagen", "Share this day")}
            className={buttonClass("quiet", "min-h-11 px-2 text-15")}
          >
            {shareCopied ? <CheckIcon className="h-4 w-4 text-parranda-ember" /> : <ShareIcon />}
            {shareCopied ? t("Länk kopierad", "Link copied") : t("Dela", "Share")}
          </button>
        )}
      </div>
      {/* A split walk names its start and finish in the sequence, one walk in its card. */}
      {routeParts.length === 0 && Boolean(routeOrigin || routeDestination) && (
        <p className="text-xs text-parranda-ink-meta">
          {Boolean(routeOrigin) && `${t("Start", "Start")}: ${anchorIsPosition ? t("Din position", "Your position") : String(publishedStart?.label || t("kartans startpunkt", "map start point"))}`}
          {routeOrigin && routeDestination ? " · " : ""}
          {Boolean(routeDestination) && `${t("Slut", "Finish")}: ${anchorIsPosition ? t("Din position", "Your position") : String(publishedEnd?.label || t("kartans slutpunkt", "map end point"))}`}
        </p>
      )}
      {routeUrls.length === 0 && (
        <p className="text-xs text-parranda-ink-meta">
          {t("Hela rutten kan inte öppnas i Maps. Öppna platserna var för sig där kartlänk finns.", "The whole route cannot be opened in Maps. Open places individually where a map link is available.")}
        </p>
      )}
      {routeUrls.length > 0 && (
        <p className="text-xs text-parranda-ink-meta">
          {t("Google Maps beräknar gångvägen när du öppnar rutten.", "Google Maps works out the walking path when you open the route.")}
        </p>
      )}
    </section>
  );
}
