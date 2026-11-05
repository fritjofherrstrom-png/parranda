/**
 * Saved days — navigation, not content, so it comes last on the page. Each row
 * restores a labelled snapshot; the planner offers a fresh rebuild from there.
 */
import type { SavedEntry } from "../../lib/anywhere-storage.mjs";
import { liveDateLabel } from "../../lib/live-event-query.mjs";
import { CloseIcon } from "../shared/icons";
import { Eyebrow } from "../shared/ui";
import type { Lang, Translate } from "./copy";

export default function SavedDays({
  t,
  lang,
  savedDays,
  restoreEntry,
  removeSavedDay,
}: {
  t: Translate;
  lang: Lang;
  savedDays: SavedEntry[];
  restoreEntry: (entry: SavedEntry) => void;
  removeSavedDay: (id: string) => void;
}) {
  return (
    <section className="border-t-line border-parranda-line-faint pt-3">
      <Eyebrow className="py-1">{t("Sparade dagar", "Saved days")}</Eyebrow>
      <ul className="flex flex-col">
        {savedDays.map((entry) => (
          <li key={entry.id} className="flex items-center gap-2 border-t-line border-parranda-line-faint first:border-t-0">
            <button
              type="button"
              onClick={() => restoreEntry(entry)}
              className="inline-flex min-h-11 flex-1 items-center py-1 text-left text-15 text-parranda-ink transition hover:text-parranda-clay"
            >
              <span className="font-bold">{entry.label}</span>
              {entry.dateIso && <span className="text-parranda-ink-meta"> · {liveDateLabel(entry.dateIso, lang)}</span>}
            </button>
            <button
              type="button"
              onClick={() => removeSavedDay(entry.id)}
              aria-label={t("Ta bort", "Remove")}
              className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-full text-parranda-ink-meta transition hover:bg-parranda-fill hover:text-parranda-ink"
            >
              <CloseIcon />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
