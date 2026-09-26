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
 */
import { useEffect, useState } from "react";

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
  useEffect(() => {
    setSearch(window.location.search);
  }, []);

  const leaving = (target: AppBarTarget) => (event: React.MouseEvent<HTMLAnchorElement>) => {
    if (event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
      onNavigate?.(target);
    }
  };

  return (
    <nav className="flex items-center justify-between gap-4" aria-label="Parranda">
      <a
        href={`/?lang=${lang}`}
        onClick={leaving("home")}
        aria-label={homeLabel}
        className="inline-flex min-h-11 items-center font-display text-2xl font-bold leading-none text-parranda-ink transition hover:text-parranda-clay"
      >
        Parranda
      </a>
      <div className="flex overflow-hidden rounded-full border border-parranda-ink/18" role="group" aria-label={languageLabel}>
        {(["en", "sv"] as const).map((option) => (
          <a
            key={option}
            href={languageHref ? languageHref(option) : withLang(search, option)}
            onClick={leaving("language")}
            aria-current={lang === option ? "true" : undefined}
            className={
              "inline-flex min-h-11 min-w-11 items-center justify-center px-3.5 text-xs font-bold transition " +
              (lang === option ? "bg-parranda-ink/12 text-parranda-ink" : "text-parranda-ink/65 hover:text-parranda-ink")
            }
          >
            {option.toUpperCase()}
          </a>
        ))}
      </div>
    </nav>
  );
}
