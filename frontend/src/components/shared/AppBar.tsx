/**
 * The one frame every Parranda page shares: the wordmark home and the language
 * switch. Before this, only the landing had either, so a planner tab offered no
 * way home except "Change place" and no way to change language at all.
 *
 * Language switching keeps the page's own query (place, picks, day, walk) and
 * swaps only `lang`, so a planner reopens the same day in the other language
 * rather than dropping the user back at an empty form. The current query is
 * adopted after hydration: the static build cannot see it, and reading it
 * during render would make the two trees disagree.
 */
import { useEffect, useState } from "react";

type Lang = "sv" | "en";

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
}: {
  lang: Lang;
  /** Accessible name for the wordmark link ("Parranda — start"). */
  homeLabel: string;
  /** Accessible name for the language group. */
  languageLabel: string;
  /**
   * Runs before a plain left-click leaves the page, while the document is still
   * alive — the planner uses it to cancel server work it no longer needs.
   */
  onNavigate?: () => void;
}) {
  const [search, setSearch] = useState("");
  useEffect(() => {
    setSearch(window.location.search);
  }, []);

  const leaving = (event: React.MouseEvent<HTMLAnchorElement>) => {
    if (event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
      onNavigate?.();
    }
  };

  return (
    <nav className="flex items-center justify-between gap-4" aria-label="Parranda">
      <a
        href={`/?lang=${lang}`}
        onClick={leaving}
        aria-label={homeLabel}
        className="inline-flex min-h-11 items-center font-display text-2xl font-bold leading-none text-parranda-ink transition hover:text-parranda-clay"
      >
        Parranda
      </a>
      <div className="flex overflow-hidden rounded-full border border-parranda-ink/18" role="group" aria-label={languageLabel}>
        {(["en", "sv"] as const).map((option) => (
          <a
            key={option}
            href={withLang(search, option)}
            onClick={leaving}
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
