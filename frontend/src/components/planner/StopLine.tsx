/**
 * THE ROUTE as a line ("Linje"): every core stop is a station on one route-
 * coloured line, the walk INTO a stop is the segment above it, daypart headings
 * cross the line where that part of the day begins, and a woven live event is a
 * transfer — the Live colour, attached after the line it extends.
 *
 * It renders what the orchestrator already decided; it owns no request, no
 * race guard and no ledger. Every verb it offers (keep, dismiss, add, release)
 * is the orchestrator's own function, handed in by name.
 *
 * Grammar kept from the September tidy-up (docs/APP_ARCHITECTURE_AND_HIERARCHY.md):
 *   - the route's evidence (what the line is, what the numbers are, how the day
 *     was assembled) is stated beside the map, inside this section;
 *   - daypart headings come from stop.daypart only, never by reordering;
 *   - detours are collapsed, dashed, and explicitly not the route.
 */
import { useState, type ReactNode } from "react";
import { lineProgress } from "../../lib/line-progress.mjs";
import { eventSourceLink, eventTiming } from "../../lib/pulse-view.mjs";
import { mapsPlaceUrl } from "../../lib/maps-links.mjs";
import { selectedDayHoursLabel } from "../../lib/selected-day-hours.mjs";
import { stopHoursUnknown, stopTypeLabel } from "../../lib/stop-card-facts.mjs";
import { walkingDistanceLabel, type RouteContextSuggestion } from "../../lib/route-context-view.mjs";
import {
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ExternalIcon,
  KeepIcon,
  LocationIcon,
  MinusIcon,
  PlusIcon,
  WalkIcon,
} from "../shared/icons";
import { buttonClass, Eyebrow } from "../shared/ui";
import { DAYPART_LABELS, label, partialPreferenceLabels, typeLabel, type Lang, type Translate } from "./copy";
import { canCommitTo, type Commitments } from "./commitments";
import { useFollowPosition } from "./useFollowPosition";

type Leg = { km: number | null; minutes: number | null };

export default function StopLine({
  t,
  lang,
  map,
  stale,
  routeLineIsSketch,
  dayContextNote,
  split,
  routeStops,
  legForStop,
  mapsPlaceContext,
  expandedStopKey,
  setExpandedStopKey,
  expandedCandidateKey,
  setExpandedCandidateKey,
  commitments,
  cityKey,
  selected,
  releaseCommitment,
  keepStop,
  dismissStop,
  commit,
  eveningEvent,
  selectedDate,
  dayOffset,
  routeContextSuggestions,
  detoursOpen,
  setDetoursOpen,
}: {
  t: Translate;
  lang: Lang;
  /** The map, when it is drawn inline (phones). On wide screens it sits beside the day instead. */
  map: ReactNode;
  stale: boolean;
  routeLineIsSketch: boolean;
  dayContextNote: string | null | undefined;
  split: { core: any[]; woven: any[] };
  routeStops: any[];
  legForStop: (stop: any) => Leg | null;
  mapsPlaceContext: string | null | undefined;
  expandedStopKey: string | null;
  setExpandedStopKey: (key: string | null) => void;
  expandedCandidateKey: string | null;
  setExpandedCandidateKey: (key: string | null) => void;
  commitments: Commitments;
  cityKey: string | null;
  selected: string[];
  releaseCommitment: (identity: string) => void;
  keepStop: (identity: string, stopLabel: string) => void;
  dismissStop: (identity: string, stopLabel: string) => void;
  commit: (identity: string, kind: "exclude" | "pin", commitLabel: string) => void;
  eveningEvent: any;
  selectedDate: string | null | undefined;
  dayOffset: 0 | 1;
  routeContextSuggestions: RouteContextSuggestion[];
  detoursOpen: boolean;
  setDetoursOpen: (update: (cur: boolean) => boolean) => void;
}) {
  const legLabel = (leg: Leg) =>
    `${leg.minutes != null ? `${leg.minutes} min` : ""}${leg.minutes != null && leg.km != null ? " · " : ""}${leg.km != null ? walkingDistanceLabel(leg.km, lang) : ""}`;
  const lastCoreIndex = split.core.length - 1;

  // OPENING HOURS, SAID ONCE. When no source gives hours for any stop on the
  // chosen day, one line above the line says so; repeating it on every
  // station made it louder than the places themselves. A day where only some
  // stops lack hours still marks exactly those stops.
  const hoursUnknownEverywhere = split.core.length > 1 && split.core.every((stop: any) => stopHoursUnknown(stop));

  // "YOU ARE HERE". Today only, and only after an explicit tap: the reader's
  // live position is read against the stations in route order. Stations
  // behind the reader are muted, the next one is marked. The position never
  // leaves this component, and nothing about the day changes.
  const [following, setFollowing] = useState(false);
  const follow = useFollowPosition(following);
  const canFollow = follow.supported && dayOffset === 0;
  const progress = following && follow.state.status === "tracking"
    ? lineProgress(split.core, follow.state.position)
    : null;
  const currentIndex = progress?.state === "at" ? progress.index : progress?.state === "toward" ? progress.next : null;
  const coreName = (index: number) => String(split.core[index]?.label || split.core[index]?.name || "").trim();
  const followStatus = !following
    ? null
    : follow.state.status === "locating"
      ? t("Hämtar din position …", "Finding your position …")
      : follow.state.status === "denied"
        ? t("Positionen blockerades. Tillåt platsdelning för att följa dagen.", "Location was blocked. Allow location sharing to follow the day.")
        : follow.state.status === "unavailable"
          ? t("Din position kunde inte hämtas just nu.", "Your position couldn't be found right now.")
          : progress?.state === "at"
            ? t(`Du är vid ${coreName(progress.index)}`, `You're at ${coreName(progress.index)}`)
            : progress?.state === "toward"
              ? t(
                  `Nästa: ${coreName(progress.next)} · ${walkingDistanceLabel(progress.toNextKm, "sv")} bort`,
                  `Next: ${coreName(progress.next)} · ${walkingDistanceLabel(progress.toNextKm, "en")} away`,
                )
              : progress?.state === "off"
                ? t("Du är inte nära rutten just nu.", "You're not near the route right now.")
                : null;

  return (
    <section
      aria-label={t("Rutten", "The route")}
      className={`${stale ? "opacity-60 motion-safe:transition-opacity" : ""} flex flex-col`}
    >
      {map && <div className="rounded-parranda border border-parranda-ink/10 bg-parranda-ink/4 p-4 sm:p-5">{map}</div>}
      {/* The route's evidence, stated beside it: what the line is, what the
          numbers are, and how the day was assembled. */}
      <p className="mt-2.5 text-xs leading-relaxed text-parranda-ink/68">
        {routeLineIsSketch && t("Den prickade linjen visar stoppens ordning, inte gatorna. ", "The dotted line shows the order of the stops, not the streets. ")}
        {t("Avstånd och gångtider är uppskattningar. Google Maps beräknar gångvägen när du öppnar rutten.", "Distances and walking times are estimates. Google Maps calculates the walking path when you open the route.")}
        {dayContextNote && ` ${dayContextNote}`}
      </p>

      <div className="mb-1 mt-6 flex min-h-11 flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <Eyebrow>{t("Stoppen i ordning", "The stops, in order")}</Eyebrow>
        {canFollow && (
          <button
            type="button"
            aria-pressed={following}
            onClick={() => setFollowing((cur) => !cur)}
            className={
              "inline-flex min-h-11 items-center gap-2 rounded-full px-4 text-[13px] font-bold transition " +
              (following
                ? "bg-parranda-ink text-parranda-paper"
                : "border-[1.5px] border-parranda-ink/20 text-parranda-ink hover:border-parranda-ink/50")
            }
          >
            <LocationIcon className={"h-4 w-4 " + (following ? "" : "text-parranda-ember")} />
            {following ? t("Sluta följa", "Stop following") : t("Följ dagen", "Follow the day")}
          </button>
        )}
      </div>
      {followStatus && (
        <p className="mb-1 text-[13px] font-semibold text-parranda-ink" aria-live="polite">{followStatus}</p>
      )}
      {hoursUnknownEverywhere && (
        <p className="mb-1 text-xs leading-relaxed text-parranda-ink/72">
          {t(
            "Källorna anger inga öppettider för dagens stopp den valda dagen — kolla innan du går.",
            "The sources give no opening hours for today's stops on the chosen day — check before you go.",
          )}
        </p>
      )}
      {/* Core stops only, grouped under daypart headings taken from
          stop.daypart — only groups that exist render, and the engine's
          order is never changed to force a grouping. The walk INTO a stop
          comes before its daypart heading, so a heading always opens the
          part of the day it names. A woven live event is NOT an ordinary
          POI — it renders once below, as an attached route extension.
          The line itself is the list's ::before: one continuous segment
          from the first station to the last. */}
      <ol
        className="relative flex flex-col before:pointer-events-none before:absolute before:bottom-7 before:left-[19px] before:top-7 before:w-1.5 before:rounded-full before:bg-parranda-ember before:content-['']"
        aria-label={t("Stoppen i ordning", "The stops, in order")}
      >
        {split.core.map((stop: any, i: number) => {
          const name = String(stop?.label || stop?.name || "").trim();
          if (!name) return null;
          const routeNumber = routeStops.indexOf(stop) + 1;
          const leg = routeNumber === 1 ? null : legForStop(stop);
          const pin = mapsPlaceUrl(stop, mapsPlaceContext);
          const daypart = String(stop?.daypart || "");
          const previousDaypart = i > 0 ? String((split.core[i - 1] as any)?.daypart || "") : "";
          const daypartHeading = daypart && daypart !== previousDaypart ? label(DAYPART_LABELS, stop.daypart, lang) : null;
          const realId = String(stop?.id ?? stop?.place_id ?? stop?.candidate_id ?? "").trim();
          const hasRealId = realId.length > 0;
          const stopIdentity = hasRealId ? realId : String(i);
          const stopKey = `${stopIdentity}:${i}`;
          const panelId = `route-stop-panel-${i}`;
          const expanded = expandedStopKey === stopKey;
          const kept = commitments[stopIdentity]?.kind === "pin";
          const prevName = routeNumber > 1 ? String((split.core[i - 1] as any)?.label || (split.core[i - 1] as any)?.name || "").trim() : "";
          const hoursLabel = selectedDayHoursLabel(stop?.selected_day_hours, lang);
          const partialLabels = partialPreferenceLabels(stop, selected, lang);
          const stopKindLabel = stop?.type === "vintage-shop"
            ? stopTypeLabel(stop, lang)
            : typeLabel(stop?.type, lang);
          const hoursUnknown = stopHoursUnknown(stop);
          const sourceLabel = String(stop?.source?.label || "").trim();
          const behind = currentIndex != null && i < currentIndex;
          const isCurrent = currentIndex === i;
          const station = expanded
            ? "border-parranda-ink bg-parranda-terracotta text-white"
            : isCurrent
              ? "border-parranda-ember bg-parranda-paper text-parranda-ink"
              : behind
                ? "border-parranda-ink/35 bg-parranda-paper text-parranda-ink/68"
                : i === lastCoreIndex && split.woven.length === 0
                  ? "border-parranda-ink bg-parranda-ink text-parranda-paper"
                  : "border-parranda-ink bg-parranda-paper text-parranda-ink";
          return (
            <li key={stopKey} className="flex flex-col">
              {leg && (leg.minutes != null || leg.km != null) && (
                <span className="type-data flex min-h-8 items-center gap-2 pl-14 text-[11px] text-parranda-ink/68">
                  <WalkIcon className="h-3.5 w-3.5" />
                  {leg.minutes != null ? `${leg.minutes} min` : ""}
                  {leg.minutes != null && leg.km != null ? " · " : ""}
                  {leg.km != null ? walkingDistanceLabel(leg.km, lang) : ""}
                </span>
              )}
              {daypartHeading && (
                <p className="type-eyebrow relative mb-0.5 mt-3 flex min-h-6 items-center pl-14 text-parranda-glow">
                  <span aria-hidden="true" className="absolute left-3.5 top-1/2 h-1 w-4 -translate-y-1/2 rounded-full bg-parranda-ink" />
                  {daypartHeading}
                </p>
              )}
              {/* The stop row is a DISCLOSURE, not an external link: tapping
                  it opens an inline panel instead of ejecting to Google Maps.
                  The Maps jump becomes a deliberate action inside the panel. */}
              <button
                type="button"
                aria-expanded={expanded}
                aria-controls={panelId}
                onClick={() => setExpandedStopKey(expanded ? null : stopKey)}
                className="group flex min-h-14 w-full items-center gap-3 rounded-parranda-btn py-1.5 pr-1 text-left transition hover:bg-parranda-ink/5"
              >
                <span className={`type-data relative z-[1] flex h-11 w-11 shrink-0 items-center justify-center rounded-full border-4 text-sm font-semibold transition ${station}`}>
                  {isCurrent && (
                    <span aria-hidden="true" className="absolute -inset-2 rounded-full border-2 border-parranda-ember motion-safe:animate-ping" />
                  )}
                  {behind ? <CheckIcon className="h-4 w-4" /> : routeNumber}
                  {behind && <span className="sr-only">{routeNumber}</span>}
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className={"flex flex-wrap items-center gap-x-2 text-[17px] font-extrabold leading-tight " + (behind ? "text-parranda-ink/68" : "text-parranda-ink")}>
                    {name}
                    {isCurrent && (
                      <span className="type-eyebrow rounded-full bg-parranda-terracotta px-2 py-0.5 text-[10px] text-white">
                        {progress?.state === "at" ? t("Du är här", "You're here") : t("Nästa", "Next")}
                      </span>
                    )}
                  </span>
                  <span className="type-data flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] text-parranda-ink/68">
                    {stopKindLabel && <span>{stopKindLabel}</span>}
                    {kept && (
                      <span className="inline-flex items-center gap-1 font-semibold text-parranda-clay">
                        {stopKindLabel && <span aria-hidden="true" className="text-parranda-ink/68">·</span>}
                        <KeepIcon className="h-3 w-3" />
                        {t("Behålls", "Kept")}
                      </span>
                    )}
                    {/* Visitability stays visible without expanding: a place
                        whose source gives no hours for the chosen day says so
                        here instead of reading as a confirmed visit. */}
                    {hoursUnknown && !hoursUnknownEverywhere && (
                      <span className="text-xs text-parranda-ink/68">{(stopKindLabel || kept) && <span aria-hidden="true">· </span>}{t("Öppettider okända", "Hours unknown")}</span>
                    )}
                  </span>
                </span>
                <ChevronRightIcon
                  className={"h-4 w-4 shrink-0 transition " + (expanded ? "rotate-90 text-parranda-ember" : "text-parranda-ink/68 group-hover:text-parranda-ink")}
                />
              </button>
              {expanded && (
                <div
                  id={panelId}
                  className="mb-2 ml-14 mt-1 flex flex-col rounded-parranda border-[1.5px] border-parranda-ink/12 bg-parranda-ink/5 p-4"
                >
                  {/* Facts only. The schedule row is a bounded source fact
                      for the selected local day, never an "open now" claim. */}
                  <div className="flex flex-col gap-1.5 text-[13px] leading-snug text-parranda-ink/72">
                    {leg && (leg.minutes != null || leg.km != null) && (
                      <span>
                        {legLabel(leg)}
                        {prevName ? ` ${t("till fots från", "walk from")} ${prevName}` : ` ${t("till fots", "on foot")}`}
                      </span>
                    )}
                    {hoursLabel && <span>{hoursLabel}</span>}
                    {hoursUnknown && (
                      <span>{t("Källtider saknas för den valda dagen", "Source hours unavailable for the selected day")}</span>
                    )}
                    {stop?.address && <span>{stop.address}</span>}
                  </div>
                  {partialLabels.length > 0 && (
                    <p className="mt-2 text-xs text-parranda-ink/68">
                      {t("Lösare träff för:", "A looser match for:")} {partialLabels.join(", ")}
                    </p>
                  )}
                  {stop?.candidate_status === "partial" && (
                    <p className="mt-2 text-xs text-parranda-ink/68">
                      {sourceLabel
                        ? t(`Källstöd: ${sourceLabel} · underlaget är fortfarande provisoriskt`, `Source-backed by ${sourceLabel} · evidence is still provisional`)
                        : t("Källunderlaget är fortfarande provisoriskt", "Source evidence is still provisional")}
                    </p>
                  )}
                  <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
                    {pin && (
                      <a
                        href={pin}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={buttonClass("primary", "min-h-11 w-full px-4 text-sm sm:w-auto sm:px-5")}
                      >
                        {t("Öppna i Maps", "Open in Maps")}
                        <ExternalIcon />
                      </a>
                    )}
                    {/* Two verbs, both anchored to a real candidate id.
                        Keep says "whatever else changes, this stays";
                        dismiss removes it from consideration. They are
                        mutually exclusive by construction — the ledger
                        holds one commitment per candidate — so a kept stop
                        offers release rather than the opposite verb. */}
                    {!cityKey && hasRealId && (commitments[stopIdentity]?.kind === "pin" ? (
                      <button
                        type="button"
                        onClick={() => releaseCommitment(stopIdentity)}
                        className="inline-flex min-h-11 items-center justify-center gap-2 rounded-parranda-btn border-[1.5px] border-parranda-ember/60 bg-parranda-ember/10 px-4 text-sm font-bold text-parranda-ink transition hover:border-parranda-ember sm:px-5"
                      >
                        <KeepIcon className="h-4 w-4 text-parranda-ember" />
                        {t("Behålls — släpp", "Kept — release")}
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => keepStop(stopIdentity, name)}
                        className={buttonClass("secondary", "min-h-11 px-4 text-sm sm:px-5")}
                      >
                        <KeepIcon className="h-4 w-4" />
                        {t("Behåll den här", "Keep this one")}
                      </button>
                    ))}
                    {!cityKey && hasRealId && commitments[stopIdentity]?.kind !== "pin" && (
                      <button
                        type="button"
                        onClick={() => dismissStop(stopIdentity, name)}
                        className={buttonClass("secondary", "min-h-11 px-4 text-sm sm:px-5")}
                      >
                        <MinusIcon className="h-4 w-4" />
                        {t("Inte den här", "Not this one")}
                      </button>
                    )}
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ol>

      {/* Route extension: the walking-validated evening event. One full
          presentation — a transfer station attached to the line it genuinely
          extends (it stays in the Google Maps route via the untouched full
          stop order). */}
      {split.woven.map((stop: any) => {
        const name = String(stop?.label || stop?.name || "").trim();
        if (!name) return null;
        const leg = legForStop(stop);
        const legShown = Boolean(leg && (leg.minutes != null || leg.km != null));
        const legKm = Number.isFinite(eveningEvent?.route_leg_km) ? eveningEvent.route_leg_km : leg?.km;
        const pin = mapsPlaceUrl(stop, mapsPlaceContext);
        const venue = String(eveningEvent?.place || "").trim();
        // Attribution (the listing feed) and destination (where the link
        // leads) stay separate facts; the stop's own source wins, as before.
        const sourceLabel = String(stop?.source?.label || eveningEvent?.source_label || "").trim();
        const sourceLink = stop?.source?.url
          ? eventSourceLink(
              { source_url: stop.source.url, source_link_kind: stop.source.link_kind, source_link_host: stop.source.link_host },
              lang,
            )
          : eventSourceLink(eveningEvent, lang);
        const routeNumber = routeStops.indexOf(stop) + 1;
        return (
          <div key={stop?.id} className="flex flex-col">
            {legShown && leg && (
              <span className="type-data relative flex min-h-10 items-center gap-2 pl-14 text-[11px] text-parranda-ink/68">
                <span
                  aria-hidden="true"
                  className="absolute bottom-0 left-[19px] top-0 w-1.5 rounded-full bg-[repeating-linear-gradient(to_bottom,rgb(var(--p-color-live))_0_6px,transparent_6px_11px)]"
                />
                <WalkIcon className="h-3.5 w-3.5" />
                {legLabel(leg)}
              </span>
            )}
            <div className={`${legShown ? "" : "mt-3 "}flex items-start gap-3`}>
              <span
                className="type-data flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-parranda-live text-sm font-semibold text-parranda-on-live shadow-[0_0_0_4px_rgb(var(--p-color-paper)),0_0_0_7px_rgb(var(--p-color-live))]"
              >
                {routeNumber}
              </span>
              <div className="min-w-0 flex-1 rounded-parranda border-[1.5px] border-parranda-live/45 bg-parranda-live/8 p-4">
                <Eyebrow tone="live" dot>{t("Live i din rutt", "Live in your route")}</Eyebrow>
                <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-parranda-ink">
                  {pin ? (
                    <a href={pin} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 min-w-11 items-center gap-1.5 text-[17px] font-extrabold transition hover:text-parranda-live">
                      {name}
                      <ExternalIcon className="h-3.5 w-3.5 text-parranda-ink/68" />
                    </a>
                  ) : (
                    <span className="text-[17px] font-extrabold">{name}</span>
                  )}
                  {stop?.starts_at && (
                    <span className="type-data rounded-full bg-parranda-live px-2 py-0.5 text-[11px] font-semibold text-parranda-on-live">
                      {eventTiming(stop, lang, undefined, selectedDate)}
                    </span>
                  )}
                </p>
                {venue && venue !== name && <p className="mt-0.5 text-[13px] text-parranda-ink/72">{venue}</p>}
                <p className="mt-1 text-[13px] text-parranda-ink/72">
                  {dayOffset === 0
                    ? t("Tillagt till dagens rutt", "Added to today's route")
                    : t("Tillagt till morgondagens rutt", "Added to tomorrow's route")}
                  {!legShown && Number.isFinite(legKm)
                    ? t(
                        ` · ${walkingDistanceLabel(legKm, "sv")} från föregående stopp`,
                        ` · ${walkingDistanceLabel(legKm, "en")} from the previous stop`,
                      )
                    : ""}
                </p>
                {(sourceLabel || sourceLink) && (
                  <p className="mt-1 text-xs text-parranda-ink/68">
                    {sourceLabel && <>{t("Källa", "Source")}: {sourceLabel}</>}
                    {sourceLabel && sourceLink && " · "}
                    {sourceLink && (
                      <a href={sourceLink.href} target="_blank" rel="noopener noreferrer" className="-my-3 inline-flex min-h-11 min-w-11 items-center underline decoration-parranda-ink/30 underline-offset-2 hover:text-parranda-live">
                        <span>{sourceLink.text}<span aria-hidden="true">&nbsp;↗</span></span>
                      </a>
                    )}
                  </p>
                )}
              </div>
            </div>
          </div>
        );
      })}

      {/* Detours — collapsed by default (design handoff §3): optional ideas
          must never read as part of the route, and the caption stays visible
          even while collapsed. Their dots join the map only while open. */}
      {routeContextSuggestions.length > 0 && (
        <div className="mt-6 flex flex-col gap-2">
          <button
            type="button"
            aria-expanded={detoursOpen}
            onClick={() => setDetoursOpen((cur) => !cur)}
            className={buttonClass("dashed", "min-h-12 w-full justify-between px-4 text-left text-sm")}
          >
            <span>
              {routeContextSuggestions.length}{" "}
              {routeContextSuggestions.length === 1
                ? t("idé nära din rutt", "detour idea near your route")
                : t("idéer nära din rutt", "detour ideas near your route")}
            </span>
            <ChevronDownIcon className={"h-4 w-4 shrink-0 transition " + (detoursOpen ? "rotate-180" : "")} />
          </button>
          <p className="text-xs leading-relaxed text-parranda-ink/68">
            {t(
              "Valfria idéer från platsunderlaget — de ingår inte i dagens stopp eller Maps-rutten.",
              "Optional ideas from the place evidence — they are not part of this day's stops or the Maps route.",
            )}
          </p>
          {detoursOpen && (
            <ul className="mt-1 grid gap-2 sm:grid-cols-2">
              {routeContextSuggestions.map((stop, index) => {
                const name = String(stop.name || stop.label || "").trim();
                if (!name) return null;
                const url = mapsPlaceUrl(
                  { ...stop, lat: stop.lat ?? undefined, lng: stop.lng ?? undefined },
                  mapsPlaceContext,
                );
                const candidateKey = `detour:${stop.id || stop.candidate_id || stop.place_id || index}`;
                // Same id shape the composed stops use, so a pin resolves
                // against the very candidates the server already loaded.
                const candidateId = String(stop?.id ?? stop?.place_id ?? stop?.candidate_id ?? "").trim();
                const candidatePanelId = `candidate-panel-detour-${index}`;
                const expanded = expandedCandidateKey === candidateKey;
                return (
                  <li key={stop.id || stop.candidate_id || stop.place_id || name} className="rounded-parranda border-[1.5px] border-dashed border-parranda-ink/25 px-3.5 py-1.5">
                    <button
                      type="button"
                      aria-expanded={expanded}
                      aria-controls={candidatePanelId}
                      onClick={() => setExpandedCandidateKey(expanded ? null : candidateKey)}
                      className="flex min-h-11 w-full items-center justify-between gap-3 text-left text-sm font-bold text-parranda-ink transition hover:text-parranda-clay"
                    >
                      <span>{name}</span>
                      {expanded ? <MinusIcon className="h-4 w-4 shrink-0 text-parranda-ember" /> : <PlusIcon className="h-4 w-4 shrink-0 text-parranda-ink/68" />}
                    </button>
                    <p className="type-data pb-1.5 text-[11px] text-parranda-ink/68">
                      {walkingDistanceLabel(stop.distance_km, lang)} {t("från", "from")} {stop.route_stop_name}
                    </p>
                    {expanded && (
                      <div id={candidatePanelId} className="mb-1.5 mt-1 border-t border-parranda-ink/12 pt-3">
                        {url && (
                          <a
                            href={url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className={buttonClass("primary", "min-h-11 w-full px-4 text-sm")}
                          >
                            {t("Öppna platsen i Maps", "Open place in Maps")}
                            <ExternalIcon />
                          </a>
                        )}
                        {/* Add is the same commitment as Keep, reached from
                            a candidate the day did not choose. The server
                            still has to resolve it against its own loaded
                            pool — an unhonoured pin is reported, not faked. */}
                        {!cityKey && candidateId && (commitments[candidateId]?.kind === "pin" || canCommitTo(stop)) && (
                          <button
                            type="button"
                            onClick={() =>
                              commitments[candidateId]?.kind === "pin"
                                ? releaseCommitment(candidateId)
                                : commit(candidateId, "pin", name)
                            }
                            className={`mt-2 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-parranda-btn border-[1.5px] px-4 text-sm font-bold transition ${
                              commitments[candidateId]?.kind === "pin"
                                ? "border-parranda-ember/60 bg-parranda-ember/10 text-parranda-ink hover:border-parranda-ember"
                                : "border-parranda-ink/20 text-parranda-ink hover:border-parranda-ink/50"
                            }`}
                          >
                            <KeepIcon className="h-4 w-4 text-parranda-ember" />
                            {commitments[candidateId]?.kind === "pin"
                              ? t("Med i dagen — släpp", "In my day — release")
                              : t("Lägg till i min dag", "Add to my day")}
                          </button>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
