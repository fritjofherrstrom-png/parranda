/**
 * Parranda's small UI vocabulary ("Linje").
 *
 * The same long class strings used to recur across the landing, the planner
 * and the Live sheet — eyebrows, buttons, chips, notice cards. They live here
 * once, so the design system is explicit and a restyle is one edit. These are
 * deliberately thin: class helpers and two tiny components, no behaviour.
 *
 * Every control keeps the 44 px minimum target; the focus ring is the global
 * contract in tailwind.css.
 */
import type { ReactNode } from "react";

type ButtonTone = "primary" | "secondary" | "quiet" | "live" | "dashed";

const TONES: Record<ButtonTone, string> = {
  // The one filled action on a surface: white on terracotta, 5.2:1 in both themes.
  primary: "bg-parranda-terracotta font-extrabold text-white hover:brightness-110",
  secondary: "border-[1.5px] border-parranda-ink/20 font-bold text-parranda-ink hover:border-parranda-ink/50",
  quiet: "bg-parranda-ink/8 font-bold text-parranda-ink hover:bg-parranda-ink/14",
  live: "bg-parranda-live font-extrabold text-parranda-on-live hover:brightness-110",
  // Optional, explicitly not part of the day.
  dashed: "border-[1.5px] border-dashed border-parranda-ink/30 font-bold text-parranda-ink hover:border-parranda-ink/55",
};

/**
 * Class string for a button, or a link styled as one. The tone is the system's;
 * the size stays at the call site (`"min-h-11 px-4 text-sm"`), so every
 * control's touch target is visible where it is drawn.
 */
export function buttonClass(tone: ButtonTone, size: string): string {
  return `inline-flex items-center justify-center gap-2 rounded-parranda-btn transition disabled:opacity-60 ${TONES[tone]} ${size}`;
}

/** A rounded pill control (Adjust, Change, scope chips). */
export function pillClass(active = false, extra = ""): string {
  return (
    "inline-flex min-h-11 items-center gap-1.5 rounded-full px-4 text-[13px] transition " +
    (active
      ? "bg-parranda-ink font-bold text-parranda-paper"
      : "border-[1.5px] border-parranda-ink/18 font-semibold text-parranda-ink/80 hover:border-parranda-ink/45 hover:text-parranda-ink") +
    (extra ? ` ${extra}` : "")
  );
}

/** A plain informational card: notices, refusals, errors. */
export const noticeCard =
  "rounded-parranda border-[1.5px] border-parranda-ink/12 bg-parranda-ink/4 p-4 text-sm leading-relaxed text-parranda-ink/80";

/** The surface every grouped panel sits on. */
export const panelCard = "rounded-parranda border-[1.5px] border-parranda-ink/12 bg-parranda-ink/4";

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

/** A small mono fact line ("18 MIN · 1.5 KM"). Text keeps its own case; CSS sets it in capitals. */
export function DataLine({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <span className={`type-data text-[11px] text-parranda-ink/68 ${className}`.trim()}>{children}</span>;
}
