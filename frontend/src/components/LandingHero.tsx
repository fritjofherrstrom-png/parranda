/**
 * The landing — where the day's geographic anchor is chosen ONCE (design
 * handoff §1). Two ways in, one decision:
 *   - type a city or place → the planner composes around it;
 *   - "Use my location" → position becomes the day's anchor (coords handed to
 *     the planner via sessionStorage, never the URL).
 * Every place routes to the modern planner and freeform any-place intake.
 * Registered aliases supply canonical display labels only. The registry is injected by
 * the server at serve time (a city is data, never code). It powers the inline
 * completion and the routing only: the landing advertises no list of cities
 * (the hand-picked city stations were removed in October 2026 — they read as a
 * menu of the only places Parranda works, which is the opposite of the
 * product). No fake-live teaser, no static Blitz cards — the surface promises
 * only what it does.
 */
import { useEffect, useRef, useState } from "react";
import { routeForInput, inlineCompletion, type CityRegistry } from "../lib/landing-routing.mjs";
import { storeAnchorCoords, requestPosition } from "../lib/location-anchor.mjs";
import PlaceSearchField, { type PlaceSuggestion } from "./PlaceSearchField";
import { storePlaceChoice } from "../lib/place-choice.mjs";
import { isComposedEntry, LAST_KEY, SAVED_KEY } from "../lib/anywhere-storage.mjs";
import { dayStationLine } from "../lib/day-summary.mjs";
import AppBar from "./shared/AppBar";
import { ChevronRightIcon, CrosshairIcon } from "./shared/icons";
import { busyButton, buttonClass, dataLine, pressRow } from "./shared/ui";

type Lang = "sv" | "en";

declare global {
  interface Window {
    __PARRANDA_CITIES__?: CityRegistry | string;
  }
}

/** No cities. A module constant, so the pre-hydration value is referentially stable. */
const EMPTY_REGISTRY: CityRegistry = {};

/**
 * The city registry Express writes into the document before this island loads.
 *
 * Type-guarded: with the token unreplaced (astro dev, or a serve path that did
 * not substitute it) the global is the literal string, which is not a registry.
 */
function injectedRegistry(): CityRegistry {
  const injected = typeof window !== "undefined" ? window.__PARRANDA_CITIES__ : null;
  return injected && typeof injected === "object" && !Array.isArray(injected) ? injected : EMPTY_REGISTRY;
}

/**
 * The day the planner would restore on its own, if there is one — only enough
 * of it to name it. A stored entry without a composed result is not offered.
 */
type Station = { key: string; href: string; place: string | null; dateIso: string | null; safeResponse: any; saved: boolean };

/** The station's name, as on the day's sign: the place's first part. */
const stationPlace = (place: unknown) =>
  typeof place === "string" && place.trim() ? place.split(",")[0].trim() || null : null;

function lastDay(lang: Lang): Station | null {
  try {
    const raw = window.localStorage.getItem(LAST_KEY);
    const entry = raw ? JSON.parse(raw) : null;
    if (!isComposedEntry(entry)) return null;
    return { key: "last", href: `/anywhere?restore=last&lang=${lang}`, place: stationPlace(entry.place),
      dateIso: typeof entry.dateIso === "string" ? entry.dateIso : null, safeResponse: entry.safeResponse, saved: false };
  } catch {
    return null;
  }
}

/**
 * Saved days, newest first, as further stations (Linje 2 board). Each opens
 * by its own id; the planner restores it as the labelled snapshot it is.
 */
function savedDays(lang: Lang, lastId: string | null): Station[] {
  try {
    const raw = window.localStorage.getItem(SAVED_KEY);
    const list = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(list)) return [];
    return list
      .filter((entry: any) => isComposedEntry(entry) && typeof entry.id === "string" && entry.id && entry.id !== lastId)
      .slice(0, 4)
      .map((entry: any) => ({ key: `saved:${entry.id}`, href: `/anywhere?saved=${encodeURIComponent(entry.id)}&lang=${lang}`,
        place: stationPlace(entry.place), dateIso: typeof entry.dateIso === "string" ? entry.dateIso : null,
        safeResponse: entry.safeResponse, saved: true }));
  } catch {
    return [];
  }
}

export default function LandingHero({ lang: initialLang = "en" }: { lang?: Lang }) {
  const [lang, setLang] = useState<Lang>(initialLang);
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("lang");
    if (q === "sv" || q === "en") setLang(q);
  }, []);
  useEffect(() => {
    document.title = lang === "sv" ? "Parranda — Nästa stopp?" : "Parranda — Next stop?";
    document.documentElement.lang = lang;
  }, [lang]);

  const [value, setValue] = useState("");
  const [selectedPlace, setSelectedPlace] = useState<PlaceSuggestion | null>(null);
  const [locating, setLocating] = useState(false);
  const [geoDenied, setGeoDenied] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  // The registry is injected by Express at serve time, so the STATIC BUILD
  // cannot see it: prerendering finds no cities and emits no curated section,
  // while the browser's first render would find two and emit one. Reading it
  // during render therefore made the two trees disagree and React discarded the
  // whole island (hydration error #418) on every landing view.
  //
  // So it is adopted AFTER hydration commits, exactly as `lang` above is: the
  // first client render matches the build, and the cities arrive on the render
  // right after. A value the build cannot see must never be read during the
  // render React is comparing against it.
  const [registry, setRegistry] = useState<CityRegistry>(EMPTY_REGISTRY);
  // The returning visitor's last day lives in localStorage — the same class of
  // value, adopted the same way.
  const [stations, setStations] = useState<Station[]>([]);
  // Whether storage has been read yet. Until it has, the build and the first
  // client render cannot know if this is a first visit, so the first-visit
  // section only holds its place (invisible) rather than being painted and
  // then swapped for "Pick up a day" on a returning visitor's screen.
  const [stationsRead, setStationsRead] = useState(false);
  useEffect(() => {
    setRegistry(injectedRegistry());
  }, []);
  // Re-read with the language: the stations' links and lines speak it.
  useEffect(() => {
    let lastId: string | null = null;
    try { lastId = JSON.parse(window.localStorage.getItem(LAST_KEY) || "null")?.id ?? null; } catch { /* unreadable */ }
    const last = lastDay(lang);
    setStations([...(last ? [last] : []), ...savedDays(lang, lastId)]);
    setStationsRead(true);
  }, [lang]);

  const t = (sv: string, en: string) => (lang === "en" ? en : sv);

  function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    setSelectedPlace(null);
    const el = e.target;
    const typed = el.value;
    const inserting =
      typeof (e.nativeEvent as InputEvent).inputType !== "string" ||
      (e.nativeEvent as InputEvent).inputType.indexOf("insert") === 0;
    // Inline completion lives inside the field ("Barc[elona]") and never covers
    // other controls; typing over the selection continues editing.
    if (inserting && el.selectionStart === typed.length && el.selectionEnd === typed.length) {
      const completed = inlineCompletion(registry, typed);
      if (completed) {
        setValue(completed);
        requestAnimationFrame(() => {
          try {
            el.setSelectionRange(typed.length, completed.length);
          } catch {
            /* unsupported */
          }
        });
        return;
      }
    }
    setValue(typed);
  }

  function submit(e?: { preventDefault?: () => void }) {
    e?.preventDefault?.();
    // Every selected suggestion uses the shared any-place intake, including
    // registered cities. Keep its receipt bound to the qualified query.
    const route = selectedPlace
      ? routeForInput({}, selectedPlace.query, lang, { placeRef: selectedPlace.place_ref ?? null })
      : routeForInput(registry, value, lang);
    if (selectedPlace) storePlaceChoice({ place: selectedPlace.query, selection: selectedPlace.selection_id, label: selectedPlace.query });
    // Empty submit isn't a dead end: focus the field so the next keystroke lands
    // where it should (the CTA stays visually live rather than reading as broken).
    if (!route) {
      inputRef.current?.focus();
      return;
    }
    window.location.href = route.href;
  }

  // "Use my location": permission is requested ONLY on this tap. Success →
  // anchored planner, composing around coords. Denial → stay here, help text,
  // focus the input (never a full-screen block).
  async function useLocation() {
    if (locating) return;
    setLocating(true);
    setGeoDenied(false);
    try {
      const coords = await requestPosition();
      storeAnchorCoords(coords);
      window.location.href = `/anywhere?anchor=near&planner=open&lang=${lang}`;
    } catch {
      setLocating(false);
      setGeoDenied(true);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }

  return (
    <div className="mx-auto flex min-h-svh w-full max-w-6xl flex-col px-4 pt-3 sm:px-8 sm:pt-5">
      <AppBar lang={lang} homeLabel={t("Parranda — till startsidan", "Parranda — home")} languageLabel={t("Språk", "Language")} />

      {/* Phone: the question sits high, so the field is in reach of the thumb
          and the page does not open on a blank band. Wider: centred. */}
      <main className="flex flex-1 flex-col justify-start gap-7 pt-[12svh] pb-10 sm:justify-center sm:gap-9 sm:py-16">
        <header className="flex flex-col gap-4">
          {/* Signage, not a slogan: the question the whole product answers. */}
          <h1 className="type-display text-[clamp(3rem,17vw,4rem)] leading-[0.86] text-parranda-ink min-[400px]:text-[4.5rem] sm:text-[7rem] lg:text-[8.5rem]">
            {t("Nästa ", "Next ")}
            <br className="sm:hidden" />
            {t("stopp", "stop")}
            <em className="not-italic text-parranda-ember">?</em>
          </h1>
          <p className="max-w-[28ch] text-17 leading-relaxed text-pretty text-parranda-ink-muted sm:max-w-md sm:text-xl">
            {t("Skriv en stad eller en plats, eller börja där du är.", "Type a city or a place, or start from where you are.")}
          </p>
        </header>

        <div className="flex w-full flex-col gap-3 sm:max-w-2xl">
          <form onSubmit={submit} className="flex flex-col gap-2 sm:flex-row">
            <label htmlFor="landingCity" className="sr-only">
              {t("Skriv en stad eller plats", "Type a city or place")}
            </label>
            <PlaceSearchField value={value} lang={lang} selected={selectedPlace} inputRef={inputRef}
              onChange={onChange} geoDenied={geoDenied}
              onSelect={choice => { setSelectedPlace(choice); setValue(choice.query); inputRef.current?.focus(); }} />
            <button
              type="submit"
              onPointerDown={event => {
                // Keep focus in the combobox until the click submits. Blurring
                // it on pointer-down removes the mobile's in-flow suggestions
                // and moves this button before pointer-up can activate it.
                if (event.button === 0) event.preventDefault();
              }}
              className={buttonClass("primary", "min-h-14 whitespace-nowrap px-8 text-17 [font-stretch:110%] sm:min-h-16")}
            >
              {t("Bygg min dag", "Build my day")}
            </button>
          </form>

          {/* The second way in, in words: a quiet button under the field, its
              mark in ink (ember is the route's). What it does is its
              description, not a line of its own. */}
          <button
            type="button"
            {...busyButton(locating, useLocation)}
            aria-describedby="landingLocationNote"
            className={buttonClass("quiet", "-ml-3 min-h-11 self-start px-3 text-15")}
          >
            <CrosshairIcon className="h-4.5 w-4.5 shrink-0" />
            {locating ? t("Hämtar position …", "Getting location …") : t("Börja där du är", "Start from my location")}
          </button>
          <span id="landingLocationNote" className="sr-only">
            {t("Hela dagen planeras runt din position.", "The day is planned around where you are.")}
          </span>

          {geoDenied && (
            <p className="text-13 leading-relaxed text-parranda-ink-muted" aria-live="polite">
              {t(
                "Positionen blockerades — inga problem. Skriv en stad eller plats i stället.",
                "Location was blocked — no problem. Type a city or place instead.",
              )}
            </p>
          )}
        </div>

        {/* A returning visitor's last day is one tap away; the planner restores
            it as a labelled snapshot and offers a fresh rebuild. */}
        {/* Linje 2 board: the last day and the saved ones wait as stations on
            a short line, each one tap from being opened again. */}
        {stations.length > 0 && (
          <section aria-labelledby="landingPickUp" className="flex flex-col gap-2 border-t-line border-parranda-line-faint pt-6">
            <h2 id="landingPickUp" className="type-eyebrow text-parranda-glow">{t("Fortsätt en dag", "Pick up a day")}</h2>
            <ol className="flex flex-col">
              {stations.map((station) => (
                <li key={station.key} className="relative before:pointer-events-none before:absolute before:inset-y-0 before:left-[6px] before:w-1 before:bg-parranda-ember first:before:top-1/2 last:before:bottom-1/2">
                  <a
                    href={station.href}
                    className={`group relative flex min-h-[3.75rem] items-center gap-3 rounded-parranda-btn py-2 hover:bg-parranda-fill-faint sm:pr-3 ${pressRow}`}
                  >
                    <span aria-hidden="true" className="relative h-4 w-4 shrink-0 rounded-full border-[3px] border-parranda-ink bg-parranda-paper" />
                    <span className="flex min-w-0 flex-1 flex-col wrap-anywhere">
                      <span className="text-17 font-bold leading-tight text-parranda-ink">
                        {station.place ? t(`En dag i ${station.place}`, `A day in ${station.place}`)
                          : station.saved ? t("Din sparade dag", "Your saved day") : t("Din senaste dag", "Your last day")}
                      </span>
                      <span className="type-data text-13 text-parranda-ink-meta">
                        {station.saved ? null : <span className="sr-only">{t("Fortsätt", "Continue")}: </span>}
                        {dayStationLine(station, { lang, saved: station.saved })}
                      </span>
                    </span>
                    <ChevronRightIcon className="h-4 w-4 shrink-0 text-parranda-ink-meta transition-transform duration-200 ease-out group-hover:translate-x-0.5" />
                  </a>
                </li>
              ))}
            </ol>
          </section>
        )}

        {/* A first visit: how a day works, drawn as the line a day becomes.
            Three stations, no city and no link (the landing advertises no
            place). Vertical on a phone, across the page from sm. Before
            storage is read it is only a placeholder of the same height, so a
            first visit does not reflow the centred hero when it appears. */}
        {(!stationsRead || stations.length === 0) && (
          <section aria-labelledby={stationsRead ? "landingHowItWorks" : undefined} aria-hidden={stationsRead ? undefined : true}
            className={"flex flex-col gap-2 border-t-line border-parranda-line-faint pt-6" + (stationsRead ? "" : " invisible")}>
            <p id="landingHowItWorks" className="type-eyebrow text-parranda-ink-meta">{t("Så blir en dag till", "How a day works")}</p>
            <ol className="flex flex-col sm:grid sm:max-w-2xl sm:grid-cols-3">
              {[
                t("Skriv en plats", "Name a place"),
                t("Få en gånglinje av stopp", "Get a walking line of stops"),
                t("Ta med den till Maps", "Take it to Maps"),
              ].map((step, index, steps) => (
                <li key={index} className="relative flex min-h-11 items-center gap-3 sm:min-h-0 sm:flex-col sm:items-start sm:pr-4">
                  {/* The line runs from this station's centre to the next one's. */}
                  {index < steps.length - 1 && (
                    <span aria-hidden="true" className="pointer-events-none absolute top-1/2 left-[6px] h-full w-1 bg-parranda-ember sm:top-[6px] sm:left-2 sm:h-1 sm:w-full" />
                  )}
                  <span aria-hidden="true" className="relative h-4 w-4 shrink-0 rounded-full border-[3px] border-parranda-ink bg-parranda-paper" />
                  <span className="text-15 leading-snug font-semibold text-parranda-ink-soft">{step}</span>
                </li>
              ))}
            </ol>
          </section>
        )}
      </main>

      <footer className={`${dataLine} flex items-center justify-between border-t-line border-parranda-line-faint py-4`}>
        <span>{t("Din rutt, din stad.", "Your route, your city.")}</span>
      </footer>
    </div>
  );
}
