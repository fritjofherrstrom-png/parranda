/**
 * The landing — where the day's geographic anchor is chosen ONCE (design
 * handoff §1). Two ways in, one decision:
 *   - type a city or place → the planner composes around it;
 *   - "Use my location" → position becomes the day's anchor (coords handed to
 *     the planner via sessionStorage, never the URL).
 * A registered city routes to the modern planner with its server-owned citypack
 * identity; anything else goes to freeform any-city intake. The registry is injected by
 * the server at serve time (a city is data, never code). No fake-live teaser,
 * no static Blitz cards — the surface promises only what it does.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { curatedCityHref, routeForInput, inlineCompletion, type CityRegistry } from "../lib/landing-routing.mjs";
import { storeAnchorCoords, requestPosition } from "../lib/location-anchor.mjs";
import { LAST_KEY } from "../lib/anywhere-storage.mjs";
import { liveDateLabel } from "../lib/live-event-query.mjs";
import AppBar from "./shared/AppBar";
import { ChevronRightIcon, LocationIcon, SearchIcon } from "./shared/icons";

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
    if (!entry || typeof entry !== "object" || !entry.safeResponse || !entry.classification) return null;
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
    const route = routeForInput(registry, value, lang);
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

  const curated = useMemo(() => {
    const seen = new Set<string>();
    const out: Array<{ key: string; label: string; status?: string }> = [];
    for (const entry of Object.values(registry)) {
      if (!entry || !entry.key || seen.has(entry.key)) continue;
      // Only publicly presentable curated cities get a chip (preview/internal
      // cities stay searchable-by-name but are not advertised).
      if (entry.status !== "public" && entry.status !== "beta") continue;
      seen.add(entry.key);
      out.push(entry);
    }
    return out.sort((a, b) => a.label.localeCompare(b.label));
  }, [registry]);

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-3xl flex-col px-5 py-6 sm:px-8 sm:py-7">
      <AppBar lang={lang} homeLabel={t("Parranda — till startsidan", "Parranda — home")} languageLabel={t("Språk", "Language")} />

      <main className="flex flex-1 flex-col justify-center gap-8 py-12">
        <header className="flex flex-col gap-3.5">
          <h1 className="font-display text-6xl font-semibold leading-[0.95] text-parranda-ink sm:text-7xl">
            {t("Nästa ", "Next ")}
            <em className="not-italic text-parranda-ember">{t("stopp?", "stop?")}</em>
          </h1>
          <p className="max-w-prose text-lg leading-relaxed text-parranda-ink/75">
            {t("Skriv en stad eller plats — eller använd din position.", "Type a city or place — or use your location.")}
          </p>
        </header>

        <div className="flex flex-col gap-3">
          <form onSubmit={submit} className="flex flex-col gap-2 sm:flex-row">
            <label htmlFor="landingCity" className="sr-only">
              {t("Skriv en stad eller plats", "Type a city or place")}
            </label>
            {/* The field shows focus on its rounded frame, so the input inside
                does not draw a second, square ring. */}
            <div
              className={
                "flex min-h-14 flex-1 items-center gap-3 rounded-parranda border bg-parranda-ink/6 px-5 transition focus-within:border-parranda-ember focus-within:ring-2 focus-within:ring-parranda-glow/70 " +
                (geoDenied ? "border-parranda-glow outline outline-2 outline-offset-2 outline-parranda-glow" : "border-parranda-ink/16")
              }
            >
              <SearchIcon className="h-5 w-5 text-parranda-ink/45" />
              <input
                id="landingCity"
                ref={inputRef}
                value={value}
                onChange={onChange}
                placeholder={t("Var som helst — Lyon, Tbilisi, Kyoto …", "Anywhere — Lyon, Tbilisi, Kyoto …")}
                autoComplete="off"
                autoFocus
                className="min-w-0 flex-1 bg-transparent text-lg text-parranda-ink outline-none placeholder:text-parranda-ink/45 focus-visible:outline-none"
              />
            </div>
            <button
              type="submit"
              className="min-h-14 whitespace-nowrap rounded-parranda bg-parranda-terracotta px-7 text-base font-bold text-white shadow-sm transition hover:brightness-110"
            >
              {t("Bygg min dag", "Build my day")}
            </button>
          </form>

          <div className="flex flex-wrap items-center gap-x-3.5 gap-y-2">
            <button
              type="button"
              onClick={useLocation}
              disabled={locating}
              className="inline-flex min-h-12 items-center gap-2 rounded-full border border-parranda-ember/50 bg-parranda-ember/8 px-5 text-[15px] font-bold text-parranda-clay transition hover:bg-parranda-ember/15 disabled:opacity-60"
            >
              <LocationIcon className="h-4 w-4" />
              {locating ? t("Hämtar position …", "Getting location …") : t("Använd min position", "Use my location")}
            </button>
            <span className="text-[13px] text-parranda-ink/65">
              {t("Din position blir dagens ankare — hela dagen planeras runt den.", "Your position becomes the day's anchor — the whole day is planned around it.")}
            </span>
          </div>

          {geoDenied && (
            <p className="text-[13px] leading-relaxed text-parranda-ink/65" aria-live="polite">
              {t(
                "Positionen blockerades — inga problem. Skriv en stad eller plats i stället.",
                "Location was blocked — no problem. Type a city or place instead.",
              )}
            </p>
          )}
        </div>

        {curated.length > 0 && (
          <section className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <p className="text-xs font-extrabold uppercase tracking-[0.16em] text-parranda-glow">
              {t("Extra kurerat", "Extra curated")}
            </p>
            {curated.map((city) => (
              <a
                key={city.key}
                href={curatedCityHref(city, lang) ?? "/anywhere"}
                className="inline-flex min-h-11 items-center rounded-full border border-parranda-ink/16 px-4 text-sm font-semibold text-parranda-ink transition hover:border-parranda-ember"
              >
                {city.label}
              </a>
            ))}
          </section>
        )}

        {/* A returning visitor's last day is one tap away; the planner restores
            it as a labelled snapshot and offers a fresh rebuild. */}
        {resume && (
          <a
            href={`/anywhere?lang=${lang}`}
            className="group inline-flex min-h-12 items-center gap-2 self-start rounded-parranda-btn border border-parranda-ink/12 bg-parranda-ink/[0.04] px-4 text-sm text-parranda-ink/75 transition hover:border-parranda-ember hover:text-parranda-ink"
          >
            <span>
              <span className="font-bold text-parranda-ink">{t("Fortsätt", "Continue")}</span>
              {" · "}
              {resume.place ? t(`En dag i ${resume.place}`, `A day in ${resume.place}`) : t("Din senaste dag", "Your last day")}
              {resume.dateIso ? ` · ${liveDateLabel(resume.dateIso, lang)}` : ""}
            </span>
            <ChevronRightIcon className="h-4 w-4 text-parranda-ember transition group-hover:translate-x-0.5" />
          </a>
        )}
      </main>

      <footer className="flex items-center justify-between border-t border-parranda-ink/10 pt-4 text-sm text-parranda-ink/50">
        <span>Parranda</span>
        <em className="font-display text-[15px]">{t("din rutt, din stad", "your route, your city")}</em>
      </footer>
    </div>
  );
}
