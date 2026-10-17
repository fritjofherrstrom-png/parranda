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
  primary: "bg-parranda-terracotta font-extrabold text-white hover:brightness-110",
  secondary: "border-line border-parranda-ink/20 font-bold text-parranda-ink hover:border-parranda-ink/50",
  quiet: "bg-parranda-ink/8 font-bold text-parranda-ink hover:bg-parranda-ink/14",
  live: "bg-parranda-live font-extrabold text-parranda-on-live hover:brightness-110",
  // Optional, explicitly not part of the day.
  dashed: "border-line border-dashed border-parranda-ink/30 font-bold text-parranda-ink hover:border-parranda-ink/55",
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
  return `inline-flex items-center ${justify}gap-2 rounded-parranda-btn transition disabled:opacity-60 aria-disabled:opacity-60 aria-busy:cursor-progress ${TONES[tone]} ${size}`;
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

/** A rounded pill control (Adjust, Change, scope chips). */
export function pillClass(active = false, extra = ""): string {
  return (
    "inline-flex min-h-11 items-center gap-1.5 rounded-full px-4 text-13 transition " +
    (active
      ? "bg-parranda-ink font-bold text-parranda-paper"
      : "border-line border-parranda-ink/18 font-semibold text-parranda-ink/80 hover:border-parranda-ink/45 hover:text-parranda-ink") +
    (extra ? ` ${extra}` : "")
  );
}

/**
 * A 36px pill that is still a 44px target: the invisible ::before reaches 4px
 * above and below the pill, so rows 8px apart meet without overlapping. For
 * pills that sit in a row of their own kind (moods, a heading's one action);
 * size, padding and colours are the caller's.
 */
export const compactPillTarget =
  "relative inline-flex min-h-9 items-center rounded-full text-13 transition before:absolute before:inset-x-0 before:-inset-y-1 before:content-['']";

/**
 * A row of mutually exclusive choices drawn as one rounded control (Today /
 * Tomorrow, rhythm, Live's When and Order). The group draws the frame; each
 * segment rounds its own ends. Never `overflow-hidden` on the group: it would
 * clip the focus ring, which sits 3px outside the segment.
 */
export const segmentGroup = "inline-flex self-start rounded-full border-line border-parranda-ink/18";

/** One segment of `segmentGroup`. Selected is the system's one "chosen" fill: ink. */
export function segmentClass(active: boolean, extra = ""): string {
  return (
    "inline-flex min-h-11 items-center justify-center px-[18px] text-13 transition first:rounded-l-full last:rounded-r-full " +
    (active ? "bg-parranda-ink font-bold text-parranda-paper" : "font-semibold text-parranda-ink/72 hover:text-parranda-ink") +
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
  "inline-flex items-center gap-1.5 rounded-full bg-parranda-ink/[0.07] px-2.5 py-1 text-xs font-semibold text-parranda-ink/85";

/** A plain informational card: notices, refusals, errors. */
export const noticeCard =
  "rounded-parranda border-line border-parranda-ink/12 bg-parranda-ink/4 p-4 text-sm leading-relaxed text-parranda-ink/80";

/** The surface every grouped panel sits on. */
export const panelCard = "rounded-parranda border-line border-parranda-ink/12 bg-parranda-ink/4";

type EyebrowTone = "muted" | "glow" | "live";
const EYEBROW_TONES: Record<EyebrowTone, string> = {
  muted: "text-parranda-ink/68",
  glow: "text-parranda-glow",
  live: "text-parranda-live",
};

/**
 * The mono label over a section ("YOUR DAY", "MORNING", "LIVE IN …"). `line`
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

/** The mono fact line's look ("18 MIN · 1.5 KM"), for elements that also carry layout. */
export const dataLine = "type-data text-11 text-parranda-ink/68";

/** A small mono fact line ("18 MIN · 1.5 KM"). Text keeps its own case; CSS sets it in capitals. */
export function DataLine({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <span className={`${dataLine} ${className}`.trim()}>{children}</span>;
}
