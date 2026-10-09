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
import { isComposedEntry, LAST_KEY } from "../lib/anywhere-storage.mjs";
import { liveDateLabel } from "../lib/live-event-query.mjs";
import AppBar from "./shared/AppBar";
import { ChevronRightIcon, LocationIcon } from "./shared/icons";

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
function lastDay(): { place: string | null; dateIso: string | null } | null {
  try {
    const raw = window.localStorage.getItem(LAST_KEY);
    const entry = raw ? JSON.parse(raw) : null;
    if (!isComposedEntry(entry)) return null;
    const place = typeof entry.place === "string" && entry.place.trim() ? entry.place.trim() : null;
    const dateIso = typeof entry.dateIso === "string" ? entry.dateIso : null;
    return { place, dateIso };
  } catch {
    return null;
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
  const [resume, setResume] = useState<{ place: string | null; dateIso: string | null } | null>(null);
  useEffect(() => {
    setRegistry(injectedRegistry());
    setResume(lastDay());
  }, []);

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

      <main className="flex flex-1 flex-col justify-center gap-7 py-10 sm:gap-9 sm:py-16">
        <header className="flex flex-col gap-4">
          {/* Signage, not a slogan: the question the whole product answers. */}
          <h1 className="type-display text-[4rem] leading-[0.86] text-parranda-ink min-[400px]:text-[4.5rem] sm:text-[7rem] lg:text-[10rem]">
            {t("Nästa ", "Next ")}
            <br className="sm:hidden" />
            {t("stopp", "stop")}
            <em className="not-italic text-parranda-ember">?</em>
          </h1>
          <p className="max-w-md text-lg leading-relaxed text-parranda-ink/75 sm:text-xl">
            {t("Skriv en stad eller plats — eller använd din position.", "Type a city or place — or use your location.")}
          </p>
        </header>

        <div className="flex flex-col gap-3.5">
          <form onSubmit={submit} className="flex flex-col gap-2 sm:flex-row">
            <label htmlFor="landingCity" className="sr-only">
              {t("Skriv en stad eller plats", "Type a city or place")}
            </label>
            <PlaceSearchField value={value} lang={lang} selected={selectedPlace} inputRef={inputRef}
              onChange={onChange} geoDenied={geoDenied}
              onSelect={choice => { setSelectedPlace(choice); setValue(choice.query); inputRef.current?.focus(); }} />
            <button
              type="submit"
              className="min-h-[3.75rem] whitespace-nowrap rounded-parranda bg-parranda-terracotta px-8 text-[17px] font-extrabold text-white transition [font-stretch:110%] hover:brightness-110 sm:min-h-16 sm:text-lg"
            >
              {t("Bygg min dag", "Build my day")}
            </button>
          </form>

          <div className="flex flex-wrap items-center gap-x-3.5 gap-y-2">
            <button
              type="button"
              onClick={useLocation}
              disabled={locating}
              className="inline-flex min-h-12 items-center gap-2 rounded-full border-[1.5px] border-parranda-ink/22 px-5 text-[15px] font-bold text-parranda-ink transition hover:border-parranda-ink/55 disabled:opacity-60"
            >
              <LocationIcon className="h-4 w-4 text-parranda-ember" />
              {locating ? t("Hämtar position …", "Getting location …") : t("Använd min position", "Use my location")}
            </button>
            <span className="text-[13px] text-parranda-ink/68">
              {t("Hela dagen planeras runt din position.", "The day is planned around where you are.")}
            </span>
          </div>

          {geoDenied && (
            <p className="text-[13px] leading-relaxed text-parranda-ink/72" aria-live="polite">
              {t(
                "Positionen blockerades — inga problem. Skriv en stad eller plats i stället.",
                "Location was blocked — no problem. Type a city or place instead.",
              )}
            </p>
          )}
        </div>

        {/* A returning visitor's last day is one tap away; the planner restores
            it as a labelled snapshot and offers a fresh rebuild. */}
        {resume && (
          <a
            href={`/anywhere?restore=last&lang=${lang}`}
            className="group flex min-h-14 items-center gap-3 self-stretch rounded-parranda-btn bg-parranda-ink px-4 text-sm text-parranda-paper transition hover:brightness-125 sm:self-start"
          >
            <span className="type-eyebrow text-parranda-paper/72">{t("Fortsätt", "Continue")}<span className="sr-only"> · </span></span>
            <span className="min-w-0 flex-1">
              {resume.place ? t(`En dag i ${resume.place}`, `A day in ${resume.place}`) : t("Din senaste dag", "Your last day")}
              {resume.dateIso ? <span className="text-parranda-paper/72"> · {liveDateLabel(resume.dateIso, lang)}</span> : ""}
            </span>
            <ChevronRightIcon className="h-4 w-4 transition group-hover:translate-x-0.5" />
          </a>
        )}
      </main>

      <footer className="type-data flex items-center justify-between border-t-[1.5px] border-parranda-ink/14 py-4 text-[11px] text-parranda-ink/68">
        <span>Parranda</span>
        <span>{t("din rutt, din stad", "your route, your city")}</span>
      </footer>
    </div>
  );
}
