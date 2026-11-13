import { useEffect, useId, useRef, useState } from "react";
import { MAX_PLANNER_PREFERENCES, PLANNER_INTEREST_GROUPS, normalizePreferencePriority, togglePreferenceSelection } from "../../../../shared/planner-intent.mjs";
import { CheckIcon } from "../shared/icons";
import { buttonClass, pillClass } from "../shared/ui";
import { pickLabel, type Lang, type Translate } from "./copy";

export type InterestSelection = { selected: string[]; preferencePriority: string[] };

export default function InterestChooser({ t, lang, selected, preferencePriority, onApply, onCancel }: InterestSelection & {
  t: Translate;
  lang: Lang;
  onApply: (selection: InterestSelection) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<InterestSelection>(() => ({
    selected, preferencePriority: normalizePreferencePriority(preferencePriority, selected),
  }));
  const title = useRef<HTMLHeadingElement>(null);
  const selectionHeading = useRef<HTMLHeadingElement>(null);
  const countId = useId();
  useEffect(() => { title.current?.focus(); }, []);

  const atLimit = draft.selected.length >= MAX_PLANNER_PREFERENCES;
  const ranked = draft.preferencePriority;
  const orderedSelection = [...ranked, ...draft.selected.filter(key => !ranked.includes(key))];
  const unchanged = selected.join(",") === draft.selected.join(",") && preferencePriority.join(",") === ranked.join(",");
  return (
    <section aria-label={t("Alla intressen", "All interests")} aria-describedby={countId}
      className="flex min-w-0 flex-col gap-5"
      onKeyDown={event => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          onCancel();
        }
      }}>
      <div className="flex flex-col gap-1">
        <h2 ref={title} tabIndex={-1} className="type-title text-xl font-extrabold text-parranda-ink">{t("Alla intressen", "All interests")}</h2>
        <p className="text-13 leading-relaxed text-parranda-ink-muted">
          {t("Kombinera upp till sju intressen. Dagen byggs om när du uppdaterar.", "Combine up to seven interests. Your day rebuilds when you update it.")}
        </p>
      </div>

      <div className="border-y-line border-parranda-line-faint py-2">
        <div className="flex flex-wrap items-center justify-between gap-x-3">
          <h3 ref={selectionHeading} tabIndex={-1} className="text-sm font-bold text-parranda-ink">{t("Dina val", "Your selection")}</h3>
          <button type="button" aria-disabled={!draft.selected.length || undefined}
            className={buttonClass("secondary", "min-h-11 px-3 text-xs")}
            onClick={() => { if (draft.selected.length) setDraft({ selected: [], preferencePriority: [] }); }}>
            {t("Rensa val", "Clear selection")}
          </button>
        </div>
        <p id={countId} role="status" className="text-xs leading-relaxed text-parranda-ink-muted">
          {t(`${draft.selected.length} av ${MAX_PLANNER_PREFERENCES} valda`, `${draft.selected.length} of ${MAX_PLANNER_PREFERENCES} selected`)}
          {atLimit && t(" · Ta bort ett val för att lägga till ett annat.", " · Remove a choice to add another.")}
        </p>
        {orderedSelection.length > 0 && (
          <ol className="mt-2 divide-y divide-parranda-line-faint">
            {orderedSelection.map((key, index) => {
              const name = pickLabel(key, lang);
              const first = ranked[0] === key;
              return (
                <li key={key} className="flex min-h-11 flex-wrap items-center justify-between gap-x-3">
                  <span className="py-1 text-13 font-semibold text-parranda-ink">
                    {index < ranked.length && <span className="mr-2 tabular-nums text-parranda-ink-meta">{index + 1}.</span>}
                    {name}
                  </span>
                  <div className="flex flex-wrap gap-x-3">
                    <button type="button" aria-disabled={first || undefined}
                      aria-label={first ? t(`${name} är förstaval`, `${name} is first choice`) : t(`Sätt ${name} först`, `Make ${name} first`)}
                      className="min-h-11 text-xs font-semibold text-parranda-ink-muted hover:text-parranda-ink"
                      onClick={() => {
                        if (!first) setDraft(current => ({ ...current, preferencePriority: [key, ...current.preferencePriority.filter(value => value !== key)] }));
                      }}>
                      {first ? t("Förstaval", "First choice") : t("Sätt först", "Make first")}
                    </button>
                    <button type="button" aria-label={t(`Ta bort ${name}`, `Remove ${name}`)}
                      className="min-h-11 text-xs font-semibold text-parranda-ink-muted underline underline-offset-2 hover:text-parranda-ink"
                      onClick={() => {
                        setDraft(current => togglePreferenceSelection(current, key));
                        selectionHeading.current?.focus();
                      }}>
                      {t("Ta bort", "Remove")}
                    </button>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </div>

      <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
        {PLANNER_INTEREST_GROUPS.map(group => (
          <fieldset key={group.key} className="min-w-0">
            <legend className="mb-2 text-sm font-extrabold text-parranda-ink">{group[lang]}</legend>
            <div className="flex flex-wrap gap-2">
              {group.options.map(option => {
                const active = draft.selected.includes(option.key);
                const blocked = atLimit && !active;
                return (
                  <button key={option.key} type="button" aria-pressed={active} aria-disabled={blocked || undefined}
                    className={pillClass(active, "px-3.5 aria-disabled:opacity-60")}
                    onClick={() => { if (!blocked) setDraft(current => togglePreferenceSelection(current, option.key)); }}>
                    {active && <CheckIcon className="h-3 w-3 shrink-0" />}
                    {option[lang]}
                  </button>
                );
              })}
            </div>
          </fieldset>
        ))}
      </div>

      <div className="flex flex-wrap justify-end gap-2 border-t-line border-parranda-line-faint pt-3">
        <button type="button" className={buttonClass("secondary", "min-h-11 px-4 text-sm")} onClick={onCancel}>
          {t("Avbryt", "Cancel")}
        </button>
        <button type="button" aria-disabled={unchanged || undefined} className={buttonClass("primary", "min-h-11 px-4 text-sm")}
          onClick={() => { if (!unchanged) onApply(draft); }}>
          {t("Uppdatera dagen", "Update day")}
        </button>
      </div>
    </section>
  );
}
