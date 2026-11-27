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
import { ChevronRightIcon, CrosshairIcon, WalkIcon } from "./shared/icons";
import { busyButton, buttonClass, pressRow } from "./shared/ui";

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

interface LandingProps {
  lang?: Lang;
  streetPhoto?: { small: string; large: string };
}

export default function LandingHero({ lang: initialLang = "en", streetPhoto }: LandingProps) {
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
    <div className="landing-page">
      <div className="landing-shell">
        <header className="landing-masthead">
          <AppBar lang={lang} homeLabel={t("Parranda — till startsidan", "Parranda — home")} languageLabel={t("Språk", "Language")} />
        </header>

        <main className="landing-layout">
          <div className="landing-intro">
            <h1 className="landing-title">
              {t("Nästa", "Next")}{" "}<em>{t("stopp?", "stop?")}</em>
            </h1>
            <p className="landing-lede">
              {t("Välj en plats. Vi sätter ihop en promenad med stopp att upptäcka längs vägen.",
                "Choose a place. We’ll connect the stops into a day you can explore on foot.")}
            </p>
            <form onSubmit={submit} className="landing-form">
              <label htmlFor="landingCity" className="landing-label">
                {t("Skriv en stad eller plats", "Type a city or place")}
              </label>
              <div className="landing-form-row">
                <PlaceSearchField value={value} lang={lang} selected={selectedPlace} inputRef={inputRef}
                  onChange={onChange} geoDenied={geoDenied}
                  onSelect={choice => { setSelectedPlace(choice); setValue(choice.query); inputRef.current?.focus(); }} />
                <button
                  type="submit"
                  onPointerDown={event => {
                    // Keep the mobile in-flow list in place through pointer-up.
                    if (event.button === 0) event.preventDefault();
                  }}
                  className={buttonClass("primary", "landing-submit min-h-14 gap-3 px-5 text-17")}
                >
                  {t("Bygg min dag", "Build my day")}
                  <svg aria-hidden="true" focusable="false" className="h-4.5 w-4.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M4 12h15m-6-6 6 6-6 6" />
                  </svg>
                </button>
              </div>
            </form>
            <button type="button" {...busyButton(locating, useLocation)} aria-describedby="landingLocationNote"
              className={buttonClass("quiet", "landing-location -ml-2 min-h-11 self-start px-2 text-15")}>
              <CrosshairIcon className="h-4 w-4 shrink-0" />
              {locating ? t("Hämtar position …", "Getting location …") : t("Börja där du är", "Start from my location")}
            </button>
            <span id="landingLocationNote" className="sr-only">
              {t("Hela dagen planeras runt din position.", "The day is planned around where you are.")}
            </span>
            {geoDenied && (
              <p className="mt-1 text-13 leading-relaxed text-parranda-ink-muted" aria-live="polite">
                {t("Positionen blockerades — inga problem. Skriv en stad eller plats i stället.",
                  "Location was blocked — no problem. Type a city or place instead.")}
              </p>
            )}
          </div>

          <figure className="landing-postcard">
            {streetPhoto && (
              <img className="landing-street" alt="" width="1200" height="1499" fetchPriority="high"
                src={streetPhoto.large} srcSet={`${streetPhoto.small} 640w, ${streetPhoto.large} 1200w`}
                sizes="(min-width: 88rem) 43rem, (min-width: 56rem) 48vw, (min-width: 42rem) 90vw, 100vw" />
            )}
            <figcaption className="landing-walk">
              <span className="landing-walk-label"><WalkIcon className="h-4 w-4" />{t("Exempel på promenad", "Example walk")}</span>
              <ol className="landing-walk-stops">
                {[t("Kafé", "Café"), t("Galleri", "Gallery"), t("Park", "Park")].map(stop =>
                  <li key={stop}><span aria-hidden="true" />{stop}</li>
                )}
              </ol>
            </figcaption>
          </figure>

          {stations.length > 0 && (
            <section aria-labelledby="landingPickUp" className="landing-guide landing-saved">
              <h2 id="landingPickUp" className="landing-section-title">{t("Fortsätt en dag", "Pick up a day")}</h2>
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
                      <ChevronRightIcon className="h-4 w-4 shrink-0 text-parranda-ink-meta transition-transform duration-200 ease-out motion-safe:group-hover:translate-x-0.5" />
                    </a>
                  </li>
                ))}
              </ol>
            </section>
          )}

          {(!stationsRead || stations.length === 0) && (
            <section aria-labelledby={stationsRead ? "landingHowItWorks" : undefined} aria-hidden={stationsRead ? undefined : true}
              className={"landing-guide" + (stationsRead ? "" : " invisible")}>
              <h2 id="landingHowItWorks" className="landing-section-title">{t("Så funkar det", "How a day works")}</h2>
              <ol className="landing-guide-steps">
                {[
                  t("Välj en startplats", "Choose a starting point"),
                  t("Få en rutt till fots", "Get your walking route"),
                  t("Öppna rutten i Maps", "Take it to Maps"),
                ].map((step, index) => (
                  <li key={step}><span aria-hidden="true" className="landing-step-number">{String(index + 1).padStart(2, "0")}</span>{step}</li>
                ))}
              </ol>
            </section>
          )}
        </main>
      </div>
    </div>
  );
}
