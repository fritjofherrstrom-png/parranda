/**
 * The landing — the new frontend's second production surface.
 *
 * One promise, honestly: type ANY place and Parranda builds the day. A
 * registered city routes to its curated shell (unchanged URL contract); anything
 * else goes to the any-city planner, which auto-plans on arrival. The city
 * registry is injected by the server at serve time (a city is data, never code).
 *
 * Deliberately NOT ported from the old landing: the static "Live Pulse" teaser
 * (fake-live copy — flagged dishonest in the experience inspection) and the
 * static Blitz idea cards. The surface promises only what it does.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { routeForInput, inlineCompletion, type CityRegistry } from "../lib/landing-routing.mjs";

type Lang = "sv" | "en";

declare global {
  interface Window {
    __PARRANDA_CITIES__?: CityRegistry | string;
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
  const inputRef = useRef<HTMLInputElement | null>(null);
  const registry = useMemo<CityRegistry>(() => {
    // Type-guard: the serve-time token may be an unreplaced string in dev.
    const injected = typeof window !== "undefined" ? window.__PARRANDA_CITIES__ : null;
    return injected && typeof injected === "object" && !Array.isArray(injected) ? injected : {};
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
    if (route) window.location.href = route.href;
  }

  function switchLang(next: Lang) {
    const params = new URLSearchParams(window.location.search);
    params.set("lang", next);
    window.location.href = `${window.location.pathname}?${params.toString()}`;
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
    <div className="mx-auto flex min-h-screen w-full max-w-2xl flex-col px-4 py-10">
      <nav className="flex items-center justify-between">
        <p className="font-display text-lg font-bold text-parranda-ink">Parranda</p>
        <div className="flex gap-1" role="group" aria-label={t("Språk", "Language")}>
          {(["en", "sv"] as const).map((l) => (
            <button
              type="button"
              key={l}
              onClick={() => switchLang(l)}
              aria-pressed={lang === l}
              className={
                "rounded-full px-3 py-1 text-sm font-semibold transition " +
                (lang === l ? "bg-parranda-accent/15 text-parranda-ink" : "text-parranda-ink/60")
              }
            >
              {l.toUpperCase()}
            </button>
          ))}
        </div>
      </nav>

      <main className="flex flex-1 flex-col justify-center gap-8 py-16">
        <header className="flex flex-col gap-3">
          <h1 className="font-display text-5xl font-bold text-parranda-ink">{t("Nästa stopp?", "Next stop?")}</h1>
          <p className="max-w-prose text-lg text-parranda-ink/75">
            {t(
              "Skriv vilken stad som helst. Parranda bygger en dag med rätt rytm, rätt kvarter och rätt timing — extra kurerat där lokala kuratorer finns.",
              "Type any city. Parranda builds a day with the right rhythm, neighborhoods and timing — extra curated where local curators exist.",
            )}
          </p>
        </header>

        <form onSubmit={submit} className="flex flex-col gap-3">
          <label htmlFor="landingCity" className="text-xs font-semibold uppercase tracking-wider text-parranda-ink/60">
            {t("Skriv en stad — vilken som helst", "Type a city — any city")}
          </label>
          <div className="flex gap-2">
            <input
              id="landingCity"
              ref={inputRef}
              value={value}
              onChange={onChange}
              placeholder={t("t.ex. Malmö, Lyon, Kyoto …", "e.g. Malmö, Lyon, Kyoto …")}
              autoComplete="off"
              className="flex-1 rounded-parranda border border-parranda-ink/15 bg-parranda-ink/10 px-4 py-3 text-lg text-parranda-ink shadow-sm outline-none focus:border-parranda-accent"
            />
            <button
              type="submit"
              disabled={!value.trim()}
              className="rounded-parranda bg-parranda-accent px-5 py-3 font-semibold text-white shadow-sm disabled:opacity-40"
            >
              {t("Bygg min dag", "Build my day")}
            </button>
          </div>
        </form>

        {curated.length > 0 && (
          <section className="flex flex-col gap-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-parranda-ink/60">
              {t("Extra kurerat", "Extra curated")}
            </p>
            <div className="flex flex-wrap gap-2">
              {curated.map((city) => (
                <a
                  key={city.key}
                  href={`/${city.key}?planner=open&lang=${lang}`}
                  className="rounded-full border border-parranda-ink/15 bg-parranda-ink/10 px-4 py-1.5 text-sm font-semibold text-parranda-ink hover:border-parranda-accent"
                >
                  {city.label}
                </a>
              ))}
            </div>
          </section>
        )}
      </main>

      <footer className="flex items-center justify-between border-t border-parranda-ink/10 pt-4 text-sm text-parranda-ink/50">
        <span>Parranda</span>
        <span>{t("din rutt, din stad", "your route, your city")}</span>
      </footer>
    </div>
  );
}
