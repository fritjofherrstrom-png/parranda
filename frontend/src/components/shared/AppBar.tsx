/**
 * The one frame every Parranda page shares: the wordmark home and the language
 * switch. Before this, only the landing had either, so a planner tab offered no
 * way home except "Change place" and no way to change language at all.
 *
 * Language switching reopens the same page in the other language. By default a
 * link keeps the page's own query and swaps only `lang`; a page whose state has
 * moved on since it loaded (the planner, after adjustments) passes
 * `languageHref` so the link carries what is on screen now. The default query
 * is adopted after hydration: the static build cannot see it, and reading it
 * during render would make the two trees disagree.
 *
 * The theme switch flips "Linje" between its day and night themes and keeps
 * the choice. The theme lives on <html data-theme> (set before first paint by
 * layouts/Shell.astro); the button draws both glyphs and CSS shows the right
 * one, so nothing about it differs between the static build and hydration.
 * Only its pressed state is adopted after mount.
 */
const THEME_KEY = "parranda:theme";
type Theme = "day" | "night";

function currentTheme(): Theme {
  return document.documentElement.getAttribute("data-theme") === "night" ? "night" : "day";
}
import { useEffect, useState } from "react";
import { MoonIcon, SunIcon } from "./icons";

type Lang = "sv" | "en";
export type AppBarTarget = "home" | "language";

function withLang(search: string, lang: Lang): string {
  const params = new URLSearchParams(search);
  params.set("lang", lang);
  return `?${params.toString()}`;
}

export default function AppBar({
  lang,
  homeLabel,
  languageLabel,
  onNavigate,
  languageHref,
}: {
  lang: Lang;
  /** Accessible name for the wordmark link ("Parranda — start"). */
  homeLabel: string;
  /** Accessible name for the language group. */
  languageLabel: string;
  /**
   * Runs before a plain left-click leaves the page, while the document is still
   * alive — the planner uses it to cancel server work it no longer needs and,
   * on a language switch, to hand the day's position to the next page.
   */
  onNavigate?: (target: AppBarTarget) => void;
  /** Where the link to `option` leads; defaults to this page's query with `lang` swapped. */
  languageHref?: (option: Lang) => string;
}) {
  const [search, setSearch] = useState("");
  const [night, setNight] = useState<boolean | undefined>(undefined);
  useEffect(() => {
    setSearch(window.location.search);
    setNight(currentTheme() === "night");
  }, []);

  const toggleTheme = () => {
    const next: Theme = currentTheme() === "night" ? "day" : "night";
    document.documentElement.setAttribute("data-theme", next);
    try {
      window.localStorage.setItem(THEME_KEY, next);
    } catch {
      /* storage unavailable: the choice lasts for this page */
    }
    setNight(next === "night");
  };

  const leaving = (target: AppBarTarget) => (event: React.MouseEvent<HTMLAnchorElement>) => {
    if (event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
      onNavigate?.(target);
    }
  };

  return (
    <nav className="flex items-center justify-between gap-4 py-1" aria-label="Parranda">
      <a
        href={`/?lang=${lang}`}
        onClick={leaving("home")}
        aria-label={homeLabel}
        className="group inline-flex min-h-11 items-center gap-2.5 text-parranda-ink transition hover:text-parranda-clay"
      >
        {/* The mark: a station ring on the route colour. */}
        <span aria-hidden="true" className="h-[18px] w-[18px] rounded-full border-4 border-parranda-ember transition group-hover:scale-110" />
        <span className="type-display text-[17px] tracking-[0.02em]">Parranda</span>
      </a>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={toggleTheme}
          aria-pressed={night}
          aria-label={lang === "sv" ? "Kvällsläge" : "Night mode"}
          className="inline-flex h-11 w-11 items-center justify-center rounded-full border-[1.5px] border-parranda-ink/18 text-parranda-ink transition hover:border-parranda-ink/50"
        >
          <span data-theme-glyph="day"><SunIcon className="h-[18px] w-[18px]" /></span>
          <span data-theme-glyph="night"><MoonIcon className="h-[18px] w-[18px]" /></span>
        </button>
        <div className="flex overflow-hidden rounded-full border-[1.5px] border-parranda-ink/18" role="group" aria-label={languageLabel}>
          {(["en", "sv"] as const).map((option) => (
            <a
              key={option}
              href={languageHref ? languageHref(option) : withLang(search, option)}
              onClick={leaving("language")}
              aria-current={lang === option ? "true" : undefined}
              className={
                "type-data inline-flex min-h-11 min-w-11 items-center justify-center px-3 text-xs font-semibold transition " +
                (lang === option ? "bg-parranda-ink text-parranda-paper" : "text-parranda-ink/72 hover:text-parranda-ink")
              }
            >
              {option.toUpperCase()}
            </a>
          ))}
        </div>
      </div>
    </nav>
  );
}
