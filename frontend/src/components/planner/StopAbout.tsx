import { useLayoutEffect, useRef, useState } from "react";
/**
 * What the place is, in sourced words (docs/PLACE_MEDIA.md): the Wikidata
 * description as a kicker and a verbatim Wikipedia excerpt as a quote, with its
 * credit. Never translated: an excerpt in the other language waits behind a
 * quiet button. A curated visit note wins — the normalizer gives no excerpt
 * for a stop that has one.
 */
import { excerptCredit, otherLanguageExcerptLabel, type StopAboutExcerpt, type StopSubtitle } from "../../lib/place-media.mjs";
import { inlineLinkTarget } from "../shared/ui";
import type { Lang, Translate } from "./copy";

const creditLink = "underline decoration-parranda-line-firm underline-offset-2 hover:text-parranda-ink";
/** Four lines of the quote before "Mer"; used when the browser cannot measure. */
const CLAMP_FALLBACK_CHARS = 180;

/** `Utdrag ur Wikipedia ({språk}) · CC BY-SA 4.0`; in full, the article's title too. */
export function ExcerptCreditLine({ about, lang, full = false, className = "" }: { about: StopAboutExcerpt; lang: Lang; full?: boolean; className?: string }) {
  const credit = excerptCredit(about, lang);
  return (
    <span className={className}>
      {credit.lead}{" "}
      <a href={credit.sourceHref} target="_blank" rel="noopener noreferrer" className={creditLink}>{credit.source}</a>
      {full && <>{": "}<span lang={about.lang}>{about.article_title}</span></>}
      {" · "}
      {credit.licenseHref
        ? <a href={credit.licenseHref} target="_blank" rel="noopener noreferrer" className={creditLink}>{credit.license}</a>
        : credit.license}
    </span>
  );
}

function Excerpt({ about, t, lang }: { about: StopAboutExcerpt; t: Translate; lang: Lang }) {
  const [more, setMore] = useState(false);
  const [overflows, setOverflows] = useState(about.text.length > CLAMP_FALLBACK_CHARS);
  const textRef = useRef<HTMLParagraphElement | null>(null);
  useLayoutEffect(() => {
    const el = textRef.current;
    if (!el || more || el.clientHeight === 0) return;
    setOverflows(el.scrollHeight > el.clientHeight + 1);
  }, [about.text, more]);
  // The quote's rule is a quiet hairline-weight bar: ember is the route's
  // colour (line, stations, live dot), and a second ember stroke beside the
  // line read as part of it. The credit stays the first thing under the
  // quote, in the credit size; "More" closes that line on the right, beside
  // the quote it opens.
  return (
    <div className="flex flex-col gap-1.5">
      <blockquote
        lang={about.lang}
        cite={about.article_url}
        data-stop-excerpt=""
        className="m-0 border-l-2 border-parranda-line-firm pl-3"
      >
        <p ref={textRef} className={"text-15 leading-relaxed text-parranda-ink-soft" + (more ? "" : " line-clamp-4")}>
          {about.text}
        </p>
      </blockquote>
      <p className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 pl-3.5">
        <ExcerptCreditLine about={about} lang={lang} className="min-w-0 text-11 leading-snug text-parranda-ink-meta" />
        {overflows && !more && (
          <button
            type="button"
            onClick={() => setMore(true)}
            className={`${inlineLinkTarget} shrink-0 text-13 font-semibold text-parranda-ink underline decoration-parranda-line-firm underline-offset-4 transition-colors hover:decoration-parranda-ink`}
          >
            {t("Mer", "More")}
          </button>
        )}
      </p>
    </div>
  );
}

export default function StopAbout({ subtitle, about, t, lang }: {
  subtitle: StopSubtitle | null;
  about: StopAboutExcerpt | null;
  t: Translate;
  lang: Lang;
}) {
  const [otherOpen, setOtherOpen] = useState(false);
  // The kicker is a short label: shown only in the reader's own language.
  const kicker = subtitle && subtitle.lang === lang ? subtitle : null;
  if (!kicker && !about) return null;
  const otherLanguage = Boolean(about && about.lang !== lang);
  return (
    <div data-stop-about="" className="flex flex-col gap-2">
      {/* The kicker is what the place is, in a reading sentence: body weight
          600 in ink, not an eyebrow. Glow is for honesty notes. */}
      {kicker && (
        <p lang={kicker.lang} className="text-15 font-semibold leading-snug text-parranda-ink first-letter:uppercase">{kicker.text}</p>
      )}
      {about && !otherLanguage && <Excerpt about={about} t={t} lang={lang} />}
      {about && otherLanguage && (
        <>
          <button
            type="button"
            aria-expanded={otherOpen}
            onClick={() => setOtherOpen((cur) => !cur)}
            className="inline-flex min-h-11 items-center self-start text-13 font-semibold text-parranda-ink-muted underline decoration-parranda-line-firm underline-offset-4 transition-colors hover:text-parranda-ink"
          >
            {otherLanguageExcerptLabel(about.lang, lang)}
          </button>
          {otherOpen && <Excerpt about={about} t={t} lang={lang} />}
        </>
      )}
    </div>
  );
}
