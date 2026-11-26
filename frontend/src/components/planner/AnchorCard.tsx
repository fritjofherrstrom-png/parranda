/**
 * THE DAY'S STARTING POINT — where (chosen once on the landing) and how (picks,
 * day, rhythm), in one card. "Change" goes back to the landing; it is never a
 * second form here. Adjusting is collapsed to one line by default; every change
 * recomposes on its own (no submit) — the orchestrator's handlers own that.
 */
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { MAX_PLANNER_PREFERENCES, normalizePreferencePriority } from "../../../../shared/planner-intent.mjs";
import { CheckIcon, ChevronDownIcon, LocationIcon, UndoIcon } from "../shared/icons";
import { buttonClass, choiceOff, choiceOn, compactPillTarget, controlTone, Eyebrow, noticeCard, panelCard, pressable, segmentClass, segmentGroup } from "../shared/ui";
import type { Lang, Translate } from "./copy";
import { RingMark } from "../shared/RingMark";
import InterestChooser, { type InterestSelection } from "./InterestChooser";

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
  interestChooserOpen = false,
  setInterestChooserOpen,
  onApplyInterests,
  parrandaChoosing = false,
  takeOverFocus,
  notice,
  onSetDay,
  rhythms,
  walkKey,
  onSetRhythm,
  onChangePlace,
  rebuild = null,
  pendingRecompose = false,
  compact = false,
  dayWhen = null,
  summary = null,
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
  interestChooserOpen?: boolean;
  setInterestChooserOpen?: (open: boolean) => void;
  onApplyInterests?: (selection: InterestSelection) => void;
  /** "Let Parranda choose" is on: applying interests hands the choice back. */
  parrandaChoosing?: boolean;
  takeOverFocus?: RefObject<boolean>;
  /**
   * The notice under the controls for a no-day result, a failed rebuild or
   * a suggested replacement awaiting a decision. `announce` is set only when
   * the page's own result region does not already carry the message.
   */
  notice?: {
    message: string;
    attemptedLabels?: string;
    action?: "edit_interests" | "retry" | "restart" | null;
    onRetry?: () => void;
    restartHref?: string;
    onUndo?: () => void;
    onUseSuggestion?: () => void;
    announce?: boolean;
  };
  /** Returns false when the tap changed nothing (that day is already the one asked for). */
  onSetDay: (offset: 0 | 1) => boolean | void;
  rhythms: RhythmOption[];
  walkKey: string;
  /** Returns false when the tap changed nothing (that rhythm is already set). */
  onSetRhythm: (key: string) => boolean | void;
  /** A plain left-click on "Change": the planner cancels work it no longer needs. */
  onChangePlace: () => void;
  rebuild?: AdjustRebuild;
  /**
   * An adjustment is queued behind the planner's debounce and its compose not
   * yet sent. Only the tapped control says so; the day is not stale yet.
   */
  pendingRecompose?: boolean;
  /** A day is on screen: its heading names the place above this card. */
  compact?: boolean;
  /** Compact: which day is on screen, said first in the picks line. */
  dayWhen?: ReactNode;
  /** Compact (Linje 2): what the day did for each pick and its rhythm, in the Adjust row. */
  summary?: ReactNode;
}) {
  // Opening swaps "Adjust" for "Done" (and closing swaps back), so the button
  // that had keyboard focus leaves the DOM. Move focus to its counterpart, but
  // only after the person toggled it here, never on an outside state change.
  const panelId = useId();
  const priorityHelpId = useId();
  const allInterestsButton = useRef<HTMLButtonElement>(null);
  const retryInterestsButton = useRef<HTMLButtonElement>(null);
  const interestNotice = useRef<HTMLParagraphElement>(null);
  const hasInterestSuggestion = Boolean(notice?.onUseSuggestion);
  useEffect(() => {
    if (hasInterestSuggestion && document.activeElement === allInterestsButton.current) interestNotice.current?.focus();
  }, [hasInterestSuggestion]);
  const interestTrigger = useRef<HTMLButtonElement | null>(null);
  const returnInterestFocus = useRef(false);
  useEffect(() => {
    if (!interestChooserOpen && returnInterestFocus.current) {
      returnInterestFocus.current = false;
      const trigger = interestTrigger.current;
      (trigger?.isConnected ? trigger : allInterestsButton.current)?.focus();
    }
  }, [interestChooserOpen]);
  const closeInterestChooser = () => {
    returnInterestFocus.current = true;
    setInterestChooserOpen?.(false);
  };
  const adjustButton = useRef<HTMLButtonElement>(null);
  const doneButton = useRef<HTMLButtonElement>(null);
  const toggledHere = useRef(false);
  useLayoutEffect(() => {
    if (!toggledHere.current && !takeOverFocus?.current) return;
    toggledHere.current = false;
    if (takeOverFocus) takeOverFocus.current = false;
    (adjustOpen ? doneButton : adjustButton).current?.focus();
  }, [adjustOpen, parrandaChoosing, takeOverFocus]);
  const toggleAdjust = (open: boolean) => {
    toggledHere.current = true;
    if (!open) setInterestChooserOpen?.(false);
    setAdjustOpen(open);
  };
  // The control the reader just tapped carries the ring from the tap itself —
  // while its compose is still queued behind the debounce — until the new day
  // is on screen, so the wait is tied to the choice that caused it. The ring
  // plays a finite number of times; the panel's status line carries the rest.
  // Only a tap that changes something sets it: a no-op tap left a key behind
  // for a later wait it did not cause to light (review, Nov 2026).
  const [touched, setTouched] = useState<{ key: string; tap: number } | null>(null);
  const tapCount = useRef(0);
  const touch = (key: string) => setTouched({ key, tap: ++tapCount.current });
  // The last tap a wait has been seen for. A tap's own commit comes before
  // the wait it arms (the planner queues it in an effect), so that one commit
  // may be "not waiting" without ending the tap; any later "not waiting"
  // commit does: its wait is over, or it never began (the tap armed nothing,
  // e.g. on a restored day) and must not light a later wait it did not cause.
  // Runs every commit (refs and one comparison) so that second commit counts
  // even when neither `waiting` nor `touched` changes in it.
  const waitSeenFor = useRef(0);
  const graceFor = useRef(0);
  const rebuilding = rebuild?.state === "updating";
  const waiting = rebuilding || pendingRecompose;
  useEffect(() => {
    if (!touched) return;
    if (waiting) {
      waitSeenFor.current = touched.tap;
      return;
    }
    if (waitSeenFor.current !== touched.tap && graceFor.current !== touched.tap) {
      graceFor.current = touched.tap;
      return;
    }
    setTouched(null);
  });
  const ring = (key: string) => (waiting && touched?.key === key ? " motion-safe:animate-ring-pending" : "");
  const scale = rhythms.filter((preset) => preset.key !== "free");
  const atLimit = selected.length >= MAX_PLANNER_PREFERENCES;
  const priority = normalizePreferencePriority(preferencePriority, selected);
  const priorityRanks = new Map<string, number>(priority.map((key, index) => [key, index + 1]));
  // Chips keep their place; only the numbers change, so a tap never moves
  // another chip under the finger.
  const orderedPreferences = preferences;
  const free = rhythms.find((preset) => preset.key === "free");
  const current = rhythms.find((preset) => preset.key === walkKey);
  const doneControl = (
    <button
      type="button"
      ref={doneButton}
      aria-expanded={true}
      aria-controls={panelId}
      onClick={() => toggleAdjust(false)}
      className={compact && summary ? rowControl : controlPill}
    >
      {t("Klar", "Done")}
      {compact && summary && <ChevronDownIcon className="h-3.5 w-3.5 rotate-180 transition-transform duration-200 ease-out" />}
    </button>
  );
  return (
    // No overflow-hidden: Change and Adjust sit 6px from the card's edge, and
    // clipping would cut their focus rings.
    <section aria-label={t("Dagens utgångspunkt", "Your day's starting point")} className={compact ? "flex flex-col" : panelCard}>
      {/* With a day on screen its heading names the place and carries
          Change, so only which day, the picks and Adjust stay here: one
          plain row under the heading, no card of its own. */}
      {!compact && (
        <div className="flex min-h-14 flex-wrap items-center gap-2 py-2 pl-4 pr-2">
          {/* Ember is the route's alone: the place's pin is ink. */}
          <LocationIcon className="h-4 w-4 text-parranda-ink-soft" />
          {/* Wraps rather than truncates: at large text sizes "· tomorrow" was
              cut off. Below ~10rem the row wraps and Change moves under it. */}
          <span className="min-w-[min(100%,10rem)] flex-1 break-words text-17 font-bold leading-tight text-parranda-ink">
            {anchorLabel}
            <span className="font-medium text-parranda-ink-meta">
              {" · "}
              {publishedDateLabel ?? (dayOffset === 0 ? t("idag", "today") : t("imorgon", "tomorrow"))}
            </span>
          </span>
          <ChangePlaceLink t={t} lang={lang} onChangePlace={onChangePlace} />
        </div>
      )}

      {/* Compact, the line stays while the panel is open, with Adjust
          turned into Done in its place: which day is shown, and the picks
          as they change, stay in view above the controls that change them. */}
      {(compact || !adjustOpen) && (
        <div className={compact
          ? summary
            // A settings line, not a form field: no frame, no fill, and the
            // whole row is Adjust (the button's ::after stretches over it;
            // the picks stay a list). The pill alone answers the pointer.
            ? "group relative flex min-h-12 items-start gap-2 py-1"
            : "flex min-h-9 items-center justify-between gap-3"
          : "flex min-h-12 flex-wrap items-center gap-2 border-t-line border-parranda-line-faint py-2 pl-4 pr-2"}>
          {/* Compact, one even line in the title's quiet voice: the day, then
              the picks and the rhythm. The card form keeps the picks in bold
              under the place it names. */}
          {compact && summary ? summary : compact ? (
            <span className="min-w-0 flex-1 text-13 leading-snug text-parranda-ink-muted">
              {dayWhen}
              {dayWhen ? " · " : ""}
              {moodLabel || t("Inga intressen", "No interests")}
              {` · ${t("Dagens rytm", "Day rhythm")}: ${walkLabel}`}
            </span>
          ) : (
            <span className="min-w-0 flex-1 text-13 leading-snug text-parranda-ink-muted">
              <strong className="font-bold text-parranda-ink">{moodLabel || t("Inga intressen", "No interests")}</strong>
              {` · ${t("Dagens rytm", "Day rhythm")}: ${walkLabel}`}
            </span>
          )}
          {adjustOpen ? doneControl : (
            <button
              type="button"
              ref={adjustButton}
              aria-expanded={false}
              onClick={() => toggleAdjust(true)}
              className={compact && summary ? rowControl : controlPill}
            >
              {t("Justera", "Adjust")}
              {compact && summary && <ChevronDownIcon className="h-3.5 w-3.5 transition-transform duration-200 ease-out" />}
            </button>
          )}
        </div>
      )}

      {notice && (
        <div className={`mt-2 flex flex-col items-start gap-2 ${noticeCard}`}>
          {notice.announce
            ? <p role="status" ref={interestNotice} tabIndex={hasInterestSuggestion ? -1 : undefined}>{notice.message}</p>
            : <div>{notice.message}</div>}
          {notice.attemptedLabels && <p className="text-13 text-parranda-ink-muted">{notice.attemptedLabels}</p>}
          {notice.action === "restart" && notice.restartHref && (
            <p>{t("Den sparade dagen kan inte uppdateras säkert. ", "We cannot safely update this saved day. ")}
              <a href={notice.restartHref} className="inline-flex min-h-11 items-center font-semibold underline underline-offset-2">
                {t("Välj startpunkt och datum", "Choose a starting point and date")}
              </a>
            </p>
          )}
          {(notice.action === "edit_interests" || notice.action === "retry" || notice.onUndo || notice.onUseSuggestion) && (
            <div className="flex flex-wrap gap-2">
              {notice.action === "edit_interests" && onApplyInterests && setInterestChooserOpen && (
                <button type="button" ref={retryInterestsButton} aria-expanded={interestChooserOpen} onClick={() => {
                  interestTrigger.current = retryInterestsButton.current;
                  setAdjustOpen(true);
                  setInterestChooserOpen(true);
                }} className={buttonClass("secondary", "min-h-11 px-4 text-13")}>
                  {t("Ändra intressen", "Edit interests")}
                </button>
              )}
              {notice.action === "retry" && notice.onRetry && (
                <button type="button" onClick={notice.onRetry} className={buttonClass("primary", "min-h-11 px-4 text-13")}>
                  {t("Försök igen", "Try again")}
                </button>
              )}
              {notice.onUndo && (
                <button type="button" onClick={notice.onUndo}
                  aria-label={hasInterestSuggestion ? undefined : t("Ångra ändringen", "Undo this change")}
                  className={buttonClass("secondary", "min-h-11 px-4 text-13")}>
                  {!hasInterestSuggestion && <UndoIcon className="h-3.5 w-3.5" />}
                  {hasInterestSuggestion ? t("Behåll min dag", "Keep current day") : t("Ångra", "Undo")}
                </button>
              )}
              {notice.onUseSuggestion && (
                <button type="button" onClick={notice.onUseSuggestion} className={buttonClass("secondary", "min-h-11 px-4 text-13")}>
                  {t("Använd förslaget", "Use suggested day")}
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {adjustOpen && (
        <div id={panelId} className={compact ? `${panelCard} mt-2 flex flex-col gap-5 p-4 motion-safe:animate-panel-in` : "flex flex-col gap-5 border-t-line border-parranda-line-faint p-4"}>
          {/* The status line, then Done (in the card form; compact, Done
              stands in the line above): the panel needs no title of its own,
              the row it opened from says what it adjusts. */}
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 flex-col gap-1">
              {/* With the panel open on a phone, the day is below the screen:
                  this line is where the reader learns the day is rebuilding,
                  then what the rebuild changed. While a newer change is
                  queued, that result is no longer the day being asked for:
                  the neutral hint stands in until the rebuild is sent. */}
              {rebuild?.state === "updating" ? (
                <p data-adjust-rebuild="updating" className="flex items-center gap-2 text-13 font-bold text-parranda-clay">
                  <RingMark className="h-3 w-3" />
                  {t("Uppdaterar dagen …", "Updating your day …")}
                </p>
              ) : rebuild?.state === "updated" && !pendingRecompose ? (
                <p data-adjust-rebuild="updated" className="flex items-start gap-1.5 text-13 leading-snug text-parranda-ink-muted">
                  <CheckIcon className="mt-0.5 h-3 w-3 shrink-0 text-parranda-ink-soft" />
                  <span>
                    <span className="font-bold text-parranda-ink">{t("Uppdaterad", "Updated")}: </span>
                    {rebuild.summary}
                  </span>
                </p>
              ) : rebuild?.state === "failed" ? (
                <p data-adjust-rebuild="failed" className="text-13 font-semibold text-parranda-clay">
                  {t("Kunde inte uppdatera — din förra dag visas.", "Couldn't update — your previous day is shown.")}
                </p>
              ) : (
                <p className="text-13 text-parranda-ink-meta">
                  {onApplyInterests
                    ? t("Snabbval, datum och rytm uppdaterar dagen direkt.", "Quick choices, date and rhythm update the day as you change them.")
                    : t("Dagen byggs om direkt när du ändrar.", "The day rebuilds as you change it.")}
                </p>
              )}
            </div>
            {!compact && doneControl}
          </div>

          {interestChooserOpen && onApplyInterests ? (
            <InterestChooser t={t} lang={lang} selected={selected} preferencePriority={preferencePriority}
              handsBackChoice={parrandaChoosing}
              onCancel={closeInterestChooser}
              onApply={draft => {
                touch("all-interests");
                closeInterestChooser();
                onApplyInterests(draft);
              }} />
          ) : <>
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center justify-between gap-x-3">
              <Eyebrow tone="glow">{t("Intressen", "Interests")}</Eyebrow>
              {onApplyInterests && <button type="button" ref={allInterestsButton}
                onClick={() => {
                  interestTrigger.current = allInterestsButton.current;
                  setInterestChooserOpen?.(true);
                }} className={controlPill + ring("all-interests")}>
                {t("Alla intressen", "All interests")}
              </button>}
            </div>
            <p id={priorityHelpId} className="text-13 leading-snug text-parranda-ink-meta">
              {priority.length > 0
                ? t("Siffrorna visar ordningen du valde i. Ettan väger tyngst.", "Numbers show the order you picked. 1 weighs most.")
                : t("Tryck av och på ett intresse för att låta det väga tyngst.", "Tap an interest off and on to make it weigh most.")}
              {atLimit && t(" Högst sju intressen. Ta bort ett val för att lägga till ett annat.", " Up to seven interests. Remove a choice to add another.")}
            </p>
            <div role="group" aria-label={t("Intressen", "Interests")} aria-describedby={priorityHelpId} className="flex flex-wrap gap-x-1.5 gap-y-2">
              {orderedPreferences.map((pref) => {
                const active = selected.includes(pref.key);
                const blocked = atLimit && !active;
                const rank = priorityRanks.get(pref.key);
                const name = lang === "en" ? pref.en : pref.sv;
                return (
                  <div key={pref.key} data-preference-key={pref.key} role="group" aria-label={rank ? t(`Prioritet ${rank}: ${name}`, `Priority ${rank}: ${name}`) : name} className="inline-flex items-center gap-0.5">
                    <button
                      type="button"
                      aria-pressed={active}
                      aria-disabled={blocked || undefined}
                      onClick={() => {
                        if (blocked) return;
                        touch(`pick:${pref.key}`);
                        onToggleMood(pref.key);
                      }}
                      className={
                        `${compactPillTarget} gap-1.5 px-3.5${ring(`pick:${pref.key}`)} aria-disabled:opacity-60 ` +
                        (active ? choiceOn : choiceOff)
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
                className="inline-flex min-h-11 self-start items-center text-13 font-semibold text-parranda-ink-muted underline underline-offset-2 transition-[color] duration-150 ease-out hover:text-parranda-ink"
              >
                {t("Rensa ordningen", "Clear order")}
              </button>
            )}
          </div>

          {/* When and rhythm are one short row of settings: side by side
              where there is room, stacked on a phone, no rules between. */}
          <div className="grid gap-5 sm:grid-cols-[auto_minmax(0,1fr)] sm:gap-x-8">
          <div className="flex flex-col gap-2">
            <Eyebrow tone="glow">{t("När", "When")}</Eyebrow>
            <div className={segmentGroup} role="group" aria-label={t("Vilken dag", "Which day")}>
              {([0, 1] as const).map((offset) => (
                <button type="button" key={offset} aria-pressed={(activeDayOffset === undefined ? dayOffset : activeDayOffset) === offset} onClick={() => { if (onSetDay(offset) !== false) touch(`day:${offset}`); }} className={segmentClass((activeDayOffset === undefined ? dayOffset : activeDayOffset) === offset) + ring(`day:${offset}`)}>
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
          <div className="flex min-w-0 flex-col gap-2">
            <div className="flex min-h-11 items-center justify-between gap-3">
              <Eyebrow tone="glow">{t("Dagens rytm", "Day rhythm")}</Eyebrow>
              {free && (
                <button
                  type="button"
                  aria-pressed={walkKey === free.key}
                  onClick={() => {
                    if (onSetRhythm(free.key) !== false) touch(`rhythm:${free.key}`);
                  }}
                  className={
                    `${compactPillTarget} shrink-0 gap-1.5 px-3${ring(`rhythm:${free.key}`)} ` +
                    // A choice like the moods above. The dashed tone means
                    // "optional, not part of the day" (ui.tsx), which a rhythm is not.
                    (walkKey === free.key ? choiceOn : choiceOff)
                  }
                >
                  {walkKey === free.key && <CheckIcon className="h-3 w-3" />}
                  {t("Låt Parranda välja", "Let Parranda choose")}
                </button>
              )}
            </div>
            <div
              className="grid grid-cols-3 rounded-parranda-btn bg-parranda-fill sm:max-w-sm"
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
                      if (onSetRhythm(preset.key) !== false) touch(`rhythm:${preset.key}`);
                    }}
                    className={
                      `min-h-11 rounded-parranda-btn px-2 text-13 leading-tight ${pressable}` + ring(`rhythm:${preset.key}`) + " " +
                      (active ? "bg-parranda-ink font-bold text-parranda-paper" : "font-semibold text-parranda-ink-muted hover:text-parranda-ink active:bg-parranda-fill-strong")
                    }
                  >
                    {lang === "en" ? preset.en : preset.sv}
                  </button>
                );
              })}
            </div>
            {current && (
              <p className="text-13 leading-relaxed text-parranda-ink-muted" aria-live="polite">
                <strong className="font-bold text-parranda-ink">{lang === "en" ? current.en : current.sv}:</strong>{" "}
                {lang === "en" ? current.noteEn : current.noteSv}
              </p>
            )}
          </div>
          </div>
          </>}
        </div>
      )}
    </section>
  );
}

/**
 * Adjust and Done where there is no picks row (the card before a day, a day
 * without a summary), and All interests: plain words on a soft 36px rectangle
 * with a 44px touch target. Same tone as the 44px pills, one rank of control.
 */
const controlPill = `${compactPillTarget} shrink-0 gap-1.5 px-3.5 ${controlTone}`;

/**
 * Adjust and Done inside the picks row: the same 44px pill as Change place,
 * and the whole row is its target (::after stretches over the row). The row
 * has no fill of its own, so the pill answers the pointer anywhere on it.
 * No press scale here: a scaled button becomes the ::after's containing
 * block, so the row-wide target would shrink to the pill mid-press and a
 * release over the picks would lose the click. The fill deepens instead.
 */
const rowControl = "inline-flex min-h-11 shrink-0 items-center gap-1.5 self-start rounded-parranda-btn bg-parranda-fill px-3 text-13 font-bold text-parranda-ink " +
  "transition-[background-color,color] duration-150 ease-out group-hover:bg-parranda-fill-strong active:bg-parranda-fill-strong " +
  "after:absolute after:inset-0 after:rounded-parranda-btn after:content-['']";

/** Change place's mark: one way there, one way back. Decorative; the link says it in words. */
function SwapIcon() {
  return (
    <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
      strokeLinecap="round" strokeLinejoin="round" className="inline-block h-3.5 w-3.5 shrink-0">
      <path d="M7 4 3 8l4 4" />
      <path d="M3 8h14" />
      <path d="m17 20 4-4-4-4" />
      <path d="M21 16H7" />
    </svg>
  );
}

/**
 * "Change": back to the landing for another place. A plain left-click lets the
 * planner cancel work it no longer needs; the link still works on its own.
 * Beside the day's title once a day is on screen, in the card before that.
 * A pill like Adjust, never an underline: it changes this page's place, it
 * does not read as navigating away. 44px tall itself.
 */
export function ChangePlaceLink({ t, lang, onChangePlace }: { t: Translate; lang: Lang; onChangePlace: () => void }) {
  return (
    <a
      href={`/?lang=${lang}`}
      onClick={(event) => {
        if (event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
          onChangePlace();
        }
      }}
      aria-label={t("Byt plats", "Change place")}
      className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-1.5 rounded-parranda-btn px-3 text-13 bg-parranda-fill font-bold text-parranda-ink hover:bg-parranda-fill-strong active:bg-parranda-fill-strong transition-[scale,background-color,color,filter] duration-150 ease-out motion-safe:active:scale-[0.97]"
    >
      <SwapIcon />
      {/* Beside the day's title (an @container row), a row narrower than
          20rem keeps only the glyph: on a 320px phone the words left
          "UPPSALA" too narrow for itself (it broke as "UPPSAL A"), and at
          200% text the title had no room at all. The name stays for
          assistive tech; the rem threshold tracks the text size. */}
      {/* The visible word is always the short one ("Change" / "Byt"), so a
          long single-word place like GOTHENBURG keeps its title on one
          line on desktop as well as on a phone. The second word stays for
          assistive tech, so the link's text is still "Change place". */}
      <span className="@max-[20rem]:sr-only">
        {t("Byt", "Change")}
        <span className="sr-only">{t(" plats", " place")}</span>
      </span>
    </a>
  );
}
