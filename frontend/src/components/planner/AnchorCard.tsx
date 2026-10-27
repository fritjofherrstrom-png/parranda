/**
 * THE DAY'S STARTING POINT — where (chosen once on the landing) and how (picks,
 * day, rhythm), in one card. "Change" goes back to the landing; it is never a
 * second form here. Adjusting is collapsed to one line by default; every change
 * recomposes on its own (no submit) — the orchestrator's handlers own that.
 */
import { useEffect, useId, useRef, useState } from "react";
import { normalizePreferencePriority } from "../../../../shared/planner-intent.mjs";
import { CheckIcon, ChevronDownIcon, LocationIcon } from "../shared/icons";
import { compactPillTarget, Eyebrow, panelCard, segmentClass, segmentGroup } from "../shared/ui";
import type { Lang, Translate } from "./copy";
import { RingMark } from "../shared/RingMark";

type Option = { key: string; sv: string; en: string };
type RhythmOption = Option & { noteSv: string; noteEn: string };
/** Where the day stands after the reader's last adjustment, said where they made it. */
export type AdjustRebuild =
  | { state: "updating" }
  | { state: "updated"; summary: string }
  | { state: "failed" }
  | null;


export default function AnchorCard({
  t,
  lang,
  anchorLabel,
  dayOffset,
  publishedDateLabel,
  activeDayOffset,
  moodLabel,
  walkLabel,
  adjustOpen,
  setAdjustOpen,
  preferences,
  selected,
  preferencePriority = [],
  onToggleMood,
  onClearPriority,
  onSetDay,
  rhythms,
  walkKey,
  onSetRhythm,
  onChangePlace,
  rebuild = null,
}: {
  t: Translate;
  lang: Lang;
  anchorLabel: string;
  dayOffset: 0 | 1;
  /** H1 projection: a restored absolute day is not necessarily today/tomorrow. */
  publishedDateLabel?: string;
  activeDayOffset?: 0 | 1 | null;
  moodLabel: string;
  walkLabel: string;
  adjustOpen: boolean;
  setAdjustOpen: (open: boolean) => void;
  preferences: Option[];
  selected: string[];
  preferencePriority?: string[];
  onToggleMood: (key: string) => void;
  /** Back to unranked interests: the only way out of a ranking besides Undo. */
  onClearPriority?: () => void;
  onSetDay: (offset: 0 | 1) => void;
  rhythms: RhythmOption[];
  walkKey: string;
  onSetRhythm: (key: string) => void;
  /** A plain left-click on "Change": the planner cancels work it no longer needs. */
  onChangePlace: () => void;
  rebuild?: AdjustRebuild;
}) {
  // Opening swaps "Adjust" for "Done" (and closing swaps back), so the button
  // that had keyboard focus leaves the DOM. Move focus to its counterpart, but
  // only after the person toggled it here, never on an outside state change.
  const panelId = useId();
  const priorityHelpId = useId();
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
  // The control the reader just tapped carries the rebuild's ring until the
  // new day is on screen, so the wait is tied to the choice that caused it.
  const [touched, setTouched] = useState<string | null>(null);
  const rebuilding = rebuild?.state === "updating";
  useEffect(() => {
    if (rebuild?.state !== "updating") setTouched(null);
  }, [rebuild?.state]);
  const ring = (key: string) => (rebuilding && touched === key ? " motion-safe:animate-[parranda-ring_2.4s_ease-out_infinite]" : "");
  const scale = rhythms.filter((preset) => preset.key !== "free");
  const priority = normalizePreferencePriority(preferencePriority, selected);
  const priorityRanks = new Map<string, number>(priority.map((key, index) => [key, index + 1]));
  // Chips keep their place; only the numbers change, so a tap never moves
  // another chip under the finger.
  const orderedPreferences = preferences;
  const free = rhythms.find((preset) => preset.key === "free");
  const current = rhythms.find((preset) => preset.key === walkKey);
  return (
    // No overflow-hidden: Change and Adjust sit 6px from the card's edge, and
    // clipping would cut their focus rings.
    <section aria-label={t("Dagens utgångspunkt", "Your day's starting point")} className={panelCard}>
      <div className="flex min-h-14 flex-wrap items-center gap-2.5 py-1.5 pl-4 pr-1.5">
        <LocationIcon className="h-4 w-4 text-parranda-ember" />
        {/* Wraps rather than truncates: at large text sizes "· tomorrow" was
            cut off. Below ~10rem the row wraps and Change moves under it. */}
        <span className="min-w-[min(100%,10rem)] flex-1 break-words text-base font-extrabold text-parranda-ink">
          {anchorLabel}
          <span className="font-medium text-parranda-ink/68">
            {" · "}
            {publishedDateLabel ?? (dayOffset === 0 ? t("idag", "today") : t("imorgon", "tomorrow"))}
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
          className="inline-flex min-h-11 shrink-0 items-center rounded-full bg-parranda-ink/8 px-4 text-13 font-bold text-parranda-ink transition hover:bg-parranda-ink/14"
        >
          {t("Byt", "Change")}
        </a>
      </div>

      {!adjustOpen && (
        <div className="flex min-h-12 flex-wrap items-center gap-2.5 border-t border-parranda-ink/10 py-1.5 pl-4 pr-1.5">
          <span className="min-w-[min(100%,10rem)] flex-1 text-13 leading-snug text-parranda-ink/72">
            <strong className="font-bold text-parranda-ink">{moodLabel || t("Inga intressen", "No interests")}</strong>
            {` · ${t("Dagens rytm", "Day rhythm")}: ${walkLabel}`}
          </span>
          <button
            type="button"
            ref={adjustButton}
            aria-expanded={false}
            onClick={() => toggleAdjust(true)}
            className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border-line border-parranda-ink/18 px-3.5 text-13 font-bold text-parranda-ink transition hover:border-parranda-ink/50"
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
              {/* With the panel open on a phone, the day is below the screen:
                  this line is where the reader learns the day is rebuilding,
                  then what the rebuild changed. */}
              {rebuild?.state === "updating" ? (
                <p data-adjust-rebuild="updating" className="flex items-center gap-2 text-xs font-bold text-parranda-clay">
                  <RingMark className="h-3 w-3" />
                  {t("Uppdaterar dagen …", "Updating your day …")}
                </p>
              ) : rebuild?.state === "updated" ? (
                <p data-adjust-rebuild="updated" className="flex items-start gap-1.5 text-xs leading-snug text-parranda-ink/72">
                  <CheckIcon className="mt-px h-3 w-3 shrink-0 text-parranda-ember" />
                  <span>
                    <span className="font-bold text-parranda-ink">{t("Uppdaterad", "Updated")}: </span>
                    {rebuild.summary}
                  </span>
                </p>
              ) : rebuild?.state === "failed" ? (
                <p data-adjust-rebuild="failed" className="text-xs font-semibold text-parranda-clay">
                  {t("Kunde inte uppdatera — din förra dag visas.", "Couldn't update — your previous day is shown.")}
                </p>
              ) : (
                <p className="text-xs text-parranda-ink/68">
                  {t("Dagen byggs om direkt när du ändrar.", "The day rebuilds as you change it.")}
                </p>
              )}
            </div>
            <button
              type="button"
              ref={doneButton}
              aria-expanded={true}
              aria-controls={panelId}
              onClick={() => toggleAdjust(false)}
              className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border-line border-parranda-ink/18 px-3.5 text-13 font-bold text-parranda-ink transition hover:border-parranda-ink/50"
            >
              {t("Klar", "Done")}
              <ChevronDownIcon className="h-3.5 w-3.5 rotate-180" />
            </button>
          </div>

          <div className="flex flex-col gap-2">
            <Eyebrow tone="glow">{t("Intressen", "Interests")}</Eyebrow>
            <p id={priorityHelpId} className="text-xs text-parranda-ink/68">
              {priority.length > 0
                ? t("Siffrorna visar ordningen du valde i. Ettan väger tyngst.", "Numbers show the order you picked. 1 weighs most.")
                : t("Tryck av och på ett intresse för att låta det väga tyngst.", "Tap an interest off and on to make it weigh most.")}
            </p>
            <div role="group" aria-label={t("Intressen", "Interests")} aria-describedby={priorityHelpId} className="flex flex-wrap gap-x-1.5 gap-y-2">
              {orderedPreferences.map((pref) => {
                const active = selected.includes(pref.key);
                const rank = priorityRanks.get(pref.key);
                const name = lang === "en" ? pref.en : pref.sv;
                return (
                  <div key={pref.key} data-preference-key={pref.key} role="group" aria-label={rank ? t(`Prioritet ${rank}: ${name}`, `Priority ${rank}: ${name}`) : name} className="inline-flex items-center gap-0.5">
                    <button
                      type="button"
                      aria-pressed={active}
                      onClick={() => {
                        setTouched(`pick:${pref.key}`);
                        onToggleMood(pref.key);
                      }}
                      className={
                        `${compactPillTarget} gap-1.5 px-3.5${ring(`pick:${pref.key}`)} ` +
                        (active
                          ? "bg-parranda-ink font-bold text-parranda-paper"
                          : "border-line border-parranda-ink/18 font-semibold text-parranda-ink/72 hover:border-parranda-ink/45 hover:text-parranda-ink")
                      }
                    >
                      {active && (rank
                        ? <span aria-hidden="true" className="text-11 tabular-nums text-parranda-paper/72">{rank}</span>
                        : <CheckIcon className="h-3 w-3" />)}
                      {name}
                    </button>
                  </div>
                );
              })}
            </div>
            {priority.length > 0 && onClearPriority && (
              <button
                type="button"
                onClick={onClearPriority}
                className="inline-flex min-h-11 self-start items-center text-xs font-semibold text-parranda-ink/72 underline underline-offset-2 hover:text-parranda-clay"
              >
                {t("Rensa ordningen", "Clear order")}
              </button>
            )}
          </div>

          <div className="flex flex-col gap-2 border-t border-parranda-ink/10 pt-4">
            <Eyebrow tone="glow">{t("När", "When")}</Eyebrow>
            <div className={segmentGroup} role="group" aria-label={t("Vilken dag", "Which day")}>
              {([0, 1] as const).map((offset) => (
                <button type="button" key={offset} aria-pressed={(activeDayOffset === undefined ? dayOffset : activeDayOffset) === offset} onClick={() => { setTouched(`day:${offset}`); onSetDay(offset); }} className={segmentClass((activeDayOffset === undefined ? dayOffset : activeDayOffset) === offset) + ring(`day:${offset}`)}>
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
                  onClick={() => {
                    setTouched(`rhythm:${free.key}`);
                    onSetRhythm(free.key);
                  }}
                  className={
                    `${compactPillTarget} shrink-0 gap-1.5 px-3${ring(`rhythm:${free.key}`)} ` +
                    // A choice like the moods above. The dashed tone means
                    // "optional, not part of the day" (ui.tsx), which a rhythm is not.
                    (walkKey === free.key
                      ? "bg-parranda-ink font-bold text-parranda-paper"
                      : "border-line border-parranda-ink/18 font-semibold text-parranda-ink/72 hover:border-parranda-ink/45 hover:text-parranda-ink")
                  }
                >
                  {walkKey === free.key && <CheckIcon className="h-3 w-3" />}
                  {t("Låt Parranda välja", "Let Parranda choose")}
                </button>
              )}
            </div>
            <div
              className="grid grid-cols-3 rounded-full border-line border-parranda-ink/18 sm:max-w-sm"
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
                    onClick={() => {
                      setTouched(`rhythm:${preset.key}`);
                      onSetRhythm(preset.key);
                    }}
                    className={
                      "min-h-11 px-2 text-13 leading-tight transition first:rounded-l-full last:rounded-r-full" + ring(`rhythm:${preset.key}`) + " " +
                      (index > 0 ? "border-l-line border-parranda-ink/18 " : "") +
                      (active ? "bg-parranda-ink font-bold text-parranda-paper" : "font-semibold text-parranda-ink/72 hover:text-parranda-ink")
                    }
                  >
                    {lang === "en" ? preset.en : preset.sv}
                  </button>
                );
              })}
            </div>
            {current && (
              <p className="text-13 leading-snug text-parranda-ink/72" aria-live="polite">
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
