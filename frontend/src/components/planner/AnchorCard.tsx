/**
 * THE DAY'S STARTING POINT — where (chosen once on the landing) and how (picks,
 * day, rhythm), in one card. "Change" goes back to the landing; it is never a
 * second form here. Adjusting is collapsed to one line by default; every change
 * recomposes on its own (no submit) — the orchestrator's handlers own that.
 */
import { useEffect, useId, useRef } from "react";
import { CheckIcon, ChevronDownIcon, LocationIcon } from "../shared/icons";
import { Eyebrow, panelCard } from "../shared/ui";
import type { Lang, Translate } from "./copy";

type Option = { key: string; sv: string; en: string };
type RhythmOption = Option & { noteSv: string; noteEn: string };

// A 36px pill that is still a 44px target: the invisible ::before reaches 4px
// above and below the pill. Rows sit 8px apart, so two rows' targets meet
// without overlapping. The pill reads lighter; the thumb gets the same room.
const PILL_TARGET =
  "relative inline-flex min-h-9 items-center rounded-full text-[13px] transition before:absolute before:inset-x-0 before:-inset-y-1 before:content-['']";

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
  // Opening swaps "Adjust" for "Done" (and closing swaps back), so the button
  // that had keyboard focus leaves the DOM. Move focus to its counterpart, but
  // only after the person toggled it here, never on an outside state change.
  const panelId = useId();
  const adjustButton = useRef<HTMLButtonElement>(null);
  const doneButton = useRef<HTMLButtonElement>(null);
  const toggledHere = useRef(false);
  useEffect(() => {
    if (!toggledHere.current) return;
    toggledHere.current = false;
    (adjustOpen ? doneButton : adjustButton).current?.focus();
  }, [adjustOpen]);
  const toggleAdjust = (open: boolean) => {
    toggledHere.current = true;
    setAdjustOpen(open);
  };
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
            ref={adjustButton}
            aria-expanded={false}
            onClick={() => toggleAdjust(true)}
            className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border-[1.5px] border-parranda-ink/18 px-3.5 text-[13px] font-bold text-parranda-ink transition hover:border-parranda-ink/50"
          >
            {t("Justera", "Adjust")}
            <ChevronDownIcon className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {adjustOpen && (
        <div id={panelId} className="flex flex-col gap-4 border-t border-parranda-ink/10 p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 flex-col gap-1">
              <Eyebrow>{t("Justera dagen", "Adjust the day")}</Eyebrow>
              <p className="text-xs text-parranda-ink/68">
                {t("Dagen byggs om direkt när du ändrar.", "The day rebuilds as you change it.")}
              </p>
            </div>
            <button
              type="button"
              ref={doneButton}
              aria-expanded={true}
              aria-controls={panelId}
              onClick={() => toggleAdjust(false)}
              className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border-[1.5px] border-parranda-ink/18 px-3.5 text-[13px] font-bold text-parranda-ink transition hover:border-parranda-ink/50"
            >
              {t("Klar", "Done")}
              <ChevronDownIcon className="h-3.5 w-3.5 rotate-180" />
            </button>
          </div>

          <div className="flex flex-col gap-2">
            <Eyebrow tone="glow">{t("Känsla", "Mood")}</Eyebrow>
            <div className="flex flex-wrap gap-x-1.5 gap-y-2">
              {preferences.map((pref) => {
                const active = selected.includes(pref.key);
                return (
                  <button
                    type="button"
                    key={pref.key}
                    aria-pressed={active}
                    onClick={() => onToggleMood(pref.key)}
                    className={
                      `${PILL_TARGET} gap-1.5 px-3.5 ` +
                      (active
                        ? "bg-parranda-ink font-bold text-parranda-paper"
                        : "border-[1.5px] border-parranda-ink/18 font-semibold text-parranda-ink/72 hover:border-parranda-ink/45 hover:text-parranda-ink")
                    }
                  >
                    {active && <CheckIcon className="h-3 w-3" />}
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
            <div className="flex min-h-11 items-center justify-between gap-3">
              <Eyebrow tone="glow">{t("Dagens rytm", "Day rhythm")}</Eyebrow>
              {free && (
                <button
                  type="button"
                  aria-pressed={walkKey === free.key}
                  onClick={() => onSetRhythm(free.key)}
                  className={
                    `${PILL_TARGET} shrink-0 gap-1.5 px-3 ` +
                    (walkKey === free.key
                      ? "bg-parranda-ink font-bold text-parranda-paper"
                      : "border-[1.5px] border-dashed border-parranda-ink/30 font-semibold text-parranda-ink/72 hover:border-parranda-ink/50 hover:text-parranda-ink")
                  }
                >
                  {walkKey === free.key && <CheckIcon className="h-3 w-3" />}
                  {t("Låt Parranda välja", "Let Parranda choose")}
                </button>
              )}
            </div>
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
          </div>

        </div>
      )}
    </section>
  );
}
