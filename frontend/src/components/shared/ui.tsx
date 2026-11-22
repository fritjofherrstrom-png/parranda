/**
 * Parranda's small UI vocabulary ("Linje").
 *
 * The same long class strings used to recur across the landing, the planner
 * and the Live sheet — eyebrows, buttons, chips, notice cards. They live here
 * once, so the design system is explicit and a restyle is one edit. These are
 * deliberately thin: class helpers and a few tiny components, no behaviour.
 *
 * Every control keeps the 44 px minimum target; the focus ring is the global
 * contract in tailwind.css.
 */
import type { ReactNode } from "react";
import { ExternalIcon } from "./icons";

type ButtonTone = "primary" | "secondary" | "quiet" | "live" | "dashed";

const TONES: Record<ButtonTone, string> = {
  // The one filled action on a surface: white on terracotta, 5.2:1 in both themes.
  primary: "bg-parranda-terracotta font-extrabold text-parranda-on-terracotta hover:brightness-110",
  // Tonal, not outlined: a soft fill reads as a surface you can press, and a
  // page of hairline frames read as a wireframe (Linje 2, Nov 2026).
  secondary: "bg-parranda-fill font-bold text-parranda-ink hover:bg-parranda-fill-strong",
  // Words alone, for the actions that come second on a surface (a stop's
  // Keep, Replace and Remove). The fill appears under the pointer.
  quiet: "font-bold text-parranda-ink hover:bg-parranda-fill",
  live: "bg-parranda-live font-extrabold text-parranda-on-live hover:brightness-110",
  // Optional, explicitly not part of the day.
  dashed: "border-line border-dashed border-parranda-line-firm font-bold text-parranda-ink hover:border-parranda-line-strong",
};

/**
 * Class string for a button, or a link styled as one. The tone is the system's;
 * the size stays at the call site (`"min-h-11 px-4 text-sm"`), so every
 * control's touch target is visible where it is drawn.
 */
export function buttonClass(tone: ButtonTone, size: string): string {
  // A call site that aligns its own content (`justify-between` for a label and
  // a chevron) must not also get `justify-center`: Tailwind orders the two by
  // name, not by position in the class string, so center won.
  const justify = /(^|\s)justify-/.test(size) ? "" : "justify-center ";
  return `inline-flex items-center ${justify}gap-2 rounded-parranda-btn transition press disabled:opacity-60 aria-disabled:opacity-60 aria-busy:cursor-progress ${TONES[tone]} ${size}`;
}

/**
 * The working state of a button ("Getting location …", "Reading the moment …").
 * Spread it instead of `disabled`: a focused button that becomes disabled drops
 * keyboard focus to the top of the page mid-action. This keeps the button
 * focusable, announces it as busy and unavailable, and ignores the click.
 */
export function busyButton(busy: boolean, onClick: () => void) {
  return {
    "aria-disabled": busy ? true : undefined,
    "aria-busy": busy ? true : undefined,
    onClick: busy ? undefined : onClick,
  } as const;
}

/**
 * A choice among several (Live's Where, the interests). Circles belong to the
 * line's stations and the ring in the wordmark; a control is a soft rectangle.
 */
/** A chosen choice: the system's one "selected" fill, ink. */
export const choiceOn = "bg-parranda-ink font-bold text-parranda-paper";
/** A choice not taken: a soft fill that deepens under the pointer. */
export const choiceOff = "bg-parranda-fill font-semibold text-parranda-ink-soft hover:bg-parranda-fill-strong hover:text-parranda-ink";
/** A standalone control that is not the surface's one filled action (Change, Adjust, Follow). */
export const controlTone = "bg-parranda-fill font-bold text-parranda-ink hover:bg-parranda-fill-strong";

export function pillClass(active = false, extra = ""): string {
  return (
    "inline-flex min-h-11 items-center gap-1.5 rounded-parranda-btn px-4 text-13 transition press " +
    (active ? choiceOn : choiceOff) +
    (extra ? ` ${extra}` : "")
  );
}

/**
 * A 36px control that is still a 44px target: the invisible ::before reaches
 * 4px above and below it, so rows 8px apart meet without overlapping. For
 * controls that sit in a row of their own kind (moods, a heading's one action);
 * size, padding and colours are the caller's.
 */
export const compactPillTarget =
  "relative inline-flex min-h-9 items-center rounded-parranda-btn text-13 transition press before:absolute before:inset-x-0 before:-inset-y-1 before:content-['']";

/**
 * A row of mutually exclusive choices drawn as one control (Today / Tomorrow,
 * rhythm, Live's When and Order). The group is a soft track; each segment
 * rounds itself. Never `overflow-hidden` on the group: it would clip the
 * focus ring, which sits 3px outside the segment.
 */
export const segmentGroup = "inline-flex self-start rounded-parranda-btn bg-parranda-fill";

/** One segment of `segmentGroup`. Selected is the system's one "chosen" fill: ink. */
export function segmentClass(active: boolean, extra = ""): string {
  return (
    "inline-flex min-h-11 items-center justify-center rounded-parranda-btn px-[18px] text-13 transition press " +
    (active ? "bg-parranda-ink font-bold text-parranda-paper" : "font-semibold text-parranda-ink-muted hover:text-parranda-ink") +
    (extra ? ` ${extra}` : "")
  );
}

/**
 * An inline text link that is still a 44px target. The invisible ::before
 * reaches 14px above and below the line, so the link never changes the text's
 * layout: no negative margins, and a wrapped link cannot run into the next row.
 */
export const inlineLinkTarget = "relative before:absolute before:-inset-x-1 before:-inset-y-[14px] before:content-['']";

/**
 * Link text that leaves Parranda: the text, then the external mark. The mark is
 * the SVG, never the "↗" glyph, which Safari draws as a blue emoji box. The last
 * word and the mark never wrap apart, and the mark adds no text of its own.
 */
export function ExternalLinkText({ text }: { text: string }) {
  const space = text.lastIndexOf(" ");
  const head = space > 0 ? text.slice(0, space + 1) : "";
  const tail = space > 0 ? text.slice(space + 1) : text;
  return (
    <>
      {head}
      <span className="whitespace-nowrap">
        {tail}
        <ExternalIcon className="ml-[0.2em] h-[0.95em] w-[0.95em] align-[-0.12em]" />
      </span>
    </>
  );
}

/**
 * A fact or status shown as a small label, never a control: the day's facts
 * ("2 km on foot", "5 stops"), what the day did with a pick, a Live row's
 * categories. A quiet fill, so it never reads as a selected chip (ink fill).
 */
export const labelChip =
  "inline-flex items-center gap-1.5 rounded-parranda-tag bg-parranda-fill px-2 py-1 text-xs font-semibold text-parranda-ink-soft";

/** A plain informational card: notices, refusals, errors. */
export const noticeCard =
  "rounded-parranda bg-parranda-surface p-4 text-sm leading-relaxed text-parranda-ink-soft shadow-card";

/** The surface every grouped panel sits on. */
export const panelCard = "rounded-parranda bg-parranda-surface shadow-card";

type EyebrowTone = "muted" | "glow" | "live";
const EYEBROW_TONES: Record<EyebrowTone, string> = {
  muted: "text-parranda-ink-meta",
  glow: "text-parranda-glow",
  live: "text-parranda-live",
};

/**
 * The label over a section ("Your day", "Morning", "Live in …"). `line`
 * draws the short route-coloured bar that marks the day's own sections; `dot`
 * the live dot.
 */
export function Eyebrow({
  children,
  tone = "muted",
  line = false,
  dot = false,
  id,
  className = "",
  as: Tag = "p",
}: {
  children: ReactNode;
  tone?: EyebrowTone;
  line?: boolean;
  dot?: boolean;
  id?: string;
  className?: string;
  /** A section title is a heading for assistive tech; it looks the same. */
  as?: "p" | "h2" | "h3";
}) {
  return (
    <Tag id={id} className={`type-eyebrow flex items-center gap-2 ${EYEBROW_TONES[tone]} ${className}`.trim()}>
      {line && <span aria-hidden="true" className="h-1 w-5 shrink-0 rounded-full bg-parranda-ember" />}
      {dot && <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full bg-current motion-safe:animate-pulse" />}
      {children}
    </Tag>
  );
}

/** The fact line's look ("18 min · 1.5 km"), for elements that also carry layout. */
export const dataLine = "type-data text-13 text-parranda-ink-meta";

/** A small fact line ("18 min · 1.5 km"), in the narrow width with lining figures. */
export function DataLine({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <span className={`${dataLine} ${className}`.trim()}>{children}</span>;
}
