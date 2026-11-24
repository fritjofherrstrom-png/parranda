/**
 * Every photo and excerpt the day shows, with its full credit, inside "About
 * this day and map" (docs/PLACE_MEDIA.md). Rendered only when the day has
 * place media; a day without any reads exactly as before. The shared-day page
 * renders the same line, so a recipient sees the same credits.
 */
import { dayHasPlaceMedia, dayMediaCredits, wikidataCredit } from "../../lib/place-media.mjs";
import type { Lang, Translate } from "./copy";
import { PhotoCreditLine } from "./StopPhoto";
import { ExcerptCreditLine } from "./StopAbout";

const creditLink = "underline decoration-parranda-line-firm underline-offset-2 hover:text-parranda-ink";

export default function DayCredits({ stops, t, lang }: { stops: readonly object[]; t: Translate; lang: Lang }) {
  if (!dayHasPlaceMedia(stops)) return null;
  const rows = dayMediaCredits(stops);
  const wikidata = wikidataCredit(lang);
  return (
    <li data-day-credits="" className="mt-1 flex flex-col gap-1.5">
      <span className="font-semibold text-parranda-ink-muted">{t("Foton och texter", "Photos and text")}</span>
      {rows.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {rows.map((row) => (
            <li key={row.key} className="flex flex-col gap-0.5">
              <span className="font-semibold text-parranda-ink-soft">{row.name}</span>
              {row.media && <PhotoCreditLine media={row.media} t={t} lang={lang} full />}
              {row.about && (
                <ExcerptCreditLine about={row.about} lang={lang} full className="text-11 leading-snug text-parranda-ink-meta wrap-anywhere" />
              )}
            </li>
          ))}
        </ul>
      )}
      <span>
        <a href={wikidata.href} target="_blank" rel="noopener noreferrer" className={creditLink}>{wikidata.text}</a>
        {" ("}
        {wikidata.licenseHref
          ? <a href={wikidata.licenseHref} target="_blank" rel="noopener noreferrer" className={creditLink}>{wikidata.license}</a>
          : wikidata.license}
        {")"}
      </span>
    </li>
  );
}
