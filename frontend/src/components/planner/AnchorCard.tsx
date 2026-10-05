/**
 * THE DAY'S STARTING POINT — where (chosen once on the landing) and how (picks,
 * day, rhythm), in one card. "Change" goes back to the landing; it is never a
 * second form here. Adjusting is collapsed to one line by default; every change
 * recomposes on its own (no submit) — the orchestrator's handlers own that.
 */
import { CheckIcon, ChevronDownIcon, LocationIcon } from "../shared/icons";
import { Eyebrow, panelCard } from "../shared/ui";
import type { Lang, Translate } from "./copy";

type Option = { key: string; sv: string; en: string };
type RhythmOption = Option & { noteSv: string; noteEn: string };

export default function AnchorCard({
  t,
  lang,
  anchorLabel,
  dayOffset,
  moodLabel,
  walkLabel,
  adjustOpen,
  setAdjustOpen,
  preferences,
  selected,
  onToggleMood,
  onSetDay,
  rhythms,
  walkKey,
  onSetRhythm,
  onChangePlace,
}: {
  t: Translate;
  lang: Lang;
  anchorLabel: string;
  dayOffset: 0 | 1;
  moodLabel: string;
  walkLabel: string;
  adjustOpen: boolean;
  setAdjustOpen: (open: boolean) => void;
  preferences: Option[];
  selected: string[];
  onToggleMood: (key: string) => void;
  onSetDay: (offset: 0 | 1) => void;
  rhythms: RhythmOption[];
  walkKey: string;
  onSetRhythm: (key: string) => void;
  /** A plain left-click on "Change": the planner cancels work it no longer needs. */
  onChangePlace: () => void;
}) {
  const scale = rhythms.filter((preset) => preset.key !== "free");
  const free = rhythms.find((preset) => preset.key === "free");
  const current = rhythms.find((preset) => preset.key === walkKey);
  const segment = (active: boolean) =>
    "inline-flex min-h-11 items-center justify-center px-[18px] text-[13px] transition " +
    (active ? "bg-parranda-ink font-bold text-parranda-paper" : "font-semibold text-parranda-ink/72 hover:text-parranda-ink");
  return (
    <section aria-label={t("Dagens utgångspunkt", "Your day's starting point")} className={`overflow-hidden ${panelCard}`}>
      <div className="flex min-h-14 items-center gap-2.5 py-1.5 pl-4 pr-1.5">
        <LocationIcon className="h-4 w-4 text-parranda-ember" />
        <span className="min-w-0 flex-1 truncate text-base font-extrabold text-parranda-ink">
          {anchorLabel}
          <span className="font-medium text-parranda-ink/68">
            {" · "}
            {dayOffset === 0 ? t("idag", "today") : t("imorgon", "tomorrow")}
          </span>
        </span>
        <a
          href={`/?lang=${lang}`}
          onClick={(event) => {
            if (event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
              onChangePlace();
            }
          }}
          aria-label={t("Byt plats", "Change place")}
          className="inline-flex min-h-11 shrink-0 items-center rounded-full bg-parranda-ink/8 px-4 text-[13px] font-bold text-parranda-ink transition hover:bg-parranda-ink/14"
        >
          {t("Byt", "Change")}
        </a>
      </div>

      {!adjustOpen && (
        <div className="flex min-h-12 items-center gap-2.5 border-t border-parranda-ink/10 py-1.5 pl-4 pr-1.5">
          <span className="min-w-0 flex-1 text-[13px] leading-snug text-parranda-ink/72">
            <strong className="font-bold text-parranda-ink">{moodLabel || t("Inga val", "No moods")}</strong>
            {` · ${t("Dagens rytm", "Day rhythm")}: ${walkLabel}`}
          </span>
          <button
            type="button"
            aria-expanded={false}
            onClick={() => setAdjustOpen(true)}
            className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border-[1.5px] border-parranda-ink/18 px-3.5 text-[13px] font-bold text-parranda-ink transition hover:border-parranda-ink/50"
          >
            {t("Justera", "Adjust")}
            <ChevronDownIcon className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {adjustOpen && (
        <div className="flex flex-col gap-4 border-t border-parranda-ink/10 p-4">
          <div className="flex items-center justify-between">
            <Eyebrow>{t("Justera dagen", "Adjust the day")}</Eyebrow>
            <button
              type="button"
              aria-expanded={true}
              onClick={() => setAdjustOpen(false)}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-full border-[1.5px] border-parranda-ink/18 px-3.5 text-[13px] font-bold text-parranda-ink transition hover:border-parranda-ink/50"
            >
              {t("Klar", "Done")}
              <ChevronDownIcon className="h-3.5 w-3.5 rotate-180" />
            </button>
          </div>

          <div className="flex flex-col gap-2">
            <Eyebrow tone="glow">{t("Känsla", "Mood")}</Eyebrow>
            <div className="flex flex-wrap gap-2">
              {preferences.map((pref) => {
                const active = selected.includes(pref.key);
                return (
                  <button
                    type="button"
                    key={pref.key}
                    aria-pressed={active}
                    onClick={() => onToggleMood(pref.key)}
                    className={
                      "inline-flex min-h-11 items-center gap-1.5 rounded-full px-4 text-[13px] transition " +
                      (active
                        ? "bg-parranda-ink font-bold text-parranda-paper"
                        : "border-[1.5px] border-parranda-ink/18 font-semibold text-parranda-ink/72 hover:border-parranda-ink/45 hover:text-parranda-ink")
                    }
                  >
                    {active && <CheckIcon className="h-3.5 w-3.5" />}
                    {lang === "en" ? pref.en : pref.sv}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex flex-col gap-2 border-t border-parranda-ink/10 pt-4">
            <Eyebrow tone="glow">{t("När", "When")}</Eyebrow>
            <div className="inline-flex self-start overflow-hidden rounded-full border-[1.5px] border-parranda-ink/18" role="group" aria-label={t("Vilken dag", "Which day")}>
              {([0, 1] as const).map((offset) => (
                <button type="button" key={offset} aria-pressed={dayOffset === offset} onClick={() => onSetDay(offset)} className={segment(dayOffset === offset)}>
                  {offset === 0 ? t("Idag", "Today") : t("Imorgon", "Tomorrow")}
                </button>
              ))}
            </div>
          </div>

          {/* Rhythm is day DENSITY on one three-step scale — Easy, Balanced,
              Full — with one short line saying what the engine does with the
              choice. "Parranda chooses" sits apart: it is no fourth step.
              Each tap sets one value and recomposes once (the orchestrator
              owns that and Undo); nothing is sent while choosing. */}
          <div className="flex flex-col gap-2 border-t border-parranda-ink/10 pt-4">
            <Eyebrow tone="glow">{t("Dagens rytm", "Day rhythm")}</Eyebrow>
            <div
              className="grid grid-cols-3 overflow-hidden rounded-full border-[1.5px] border-parranda-ink/18 sm:max-w-sm"
              role="group"
              aria-label={t("Dagens rytm", "Day rhythm")}
            >
              {scale.map((preset, index) => {
                const active = walkKey === preset.key;
                return (
                  <button
                    type="button"
                    key={preset.key}
                    aria-pressed={active}
                    onClick={() => onSetRhythm(preset.key)}
                    className={
                      "min-h-11 px-2 text-[13px] leading-tight transition " +
                      (index > 0 ? "border-l-[1.5px] border-parranda-ink/18 " : "") +
                      (active ? "bg-parranda-ink font-bold text-parranda-paper" : "font-semibold text-parranda-ink/72 hover:text-parranda-ink")
                    }
                  >
                    {lang === "en" ? preset.en : preset.sv}
                  </button>
                );
              })}
            </div>
            {current && (
              <p className="text-[13px] leading-snug text-parranda-ink/72" aria-live="polite">
                <strong className="font-bold text-parranda-ink">{lang === "en" ? current.en : current.sv}:</strong>{" "}
                {lang === "en" ? current.noteEn : current.noteSv}
              </p>
            )}
            {free && (
              <button
                type="button"
                aria-pressed={walkKey === free.key}
                onClick={() => onSetRhythm(free.key)}
                className={
                  "inline-flex min-h-11 items-center gap-1.5 self-start rounded-full px-4 text-[13px] transition " +
                  (walkKey === free.key
                    ? "bg-parranda-ink font-bold text-parranda-paper"
                    : "border-[1.5px] border-dashed border-parranda-ink/30 font-semibold text-parranda-ink/72 hover:border-parranda-ink/50 hover:text-parranda-ink")
                }
              >
                {walkKey === free.key && <CheckIcon className="h-3.5 w-3.5" />}
                {t("Låt Parranda välja", "Let Parranda choose")}
              </button>
            )}
          </div>

          <p className="text-xs text-parranda-ink/68">
            {t("Ändringar gäller av sig själva — dagen komponeras om medan du justerar.", "Changes apply on their own — the day recomposes as you adjust.")}
          </p>
        </div>
      )}
    </section>
  );
}
