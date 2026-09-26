/**
 * Parranda's small inline icon set.
 *
 * Unicode glyphs (▸ ▾ ↗ ☆ ⌕ ◉ ✦) render at different sizes and weights on every
 * platform — on some they collapse to a few pixels, on others they fall back to
 * an emoji. These strokes inherit `currentColor` and size from the control they
 * sit in, so every surface draws the same mark.
 *
 * Every icon is decorative: it is hidden from assistive technology, and the
 * control it decorates carries its own text or aria-label.
 */
import type { ReactNode } from "react";

interface IconProps {
  className?: string;
}

function Icon({ className, children, fill = "none" }: IconProps & { children: ReactNode; fill?: string }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 24 24"
      fill={fill}
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`inline-block shrink-0 ${className ?? "h-4 w-4"}`}
    >
      {children}
    </svg>
  );
}

export function SearchIcon({ className }: IconProps) {
  return (
    <Icon className={className}>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4.5 4.5" />
    </Icon>
  );
}

/** The day's anchor: a position, not a pin on a specific map provider. */
export function LocationIcon({ className }: IconProps) {
  return (
    <Icon className={className}>
      <circle cx="12" cy="12" r="7.5" />
      <circle cx="12" cy="12" r="2.5" fill="currentColor" stroke="none" />
    </Icon>
  );
}

export function ChevronRightIcon({ className }: IconProps) {
  return (
    <Icon className={className}>
      <path d="m9 5 7 7-7 7" />
    </Icon>
  );
}

export function ChevronDownIcon({ className }: IconProps) {
  return (
    <Icon className={className}>
      <path d="m5 9 7 7 7-7" />
    </Icon>
  );
}

/** Leaves Parranda (Maps, a source page). */
export function ExternalIcon({ className }: IconProps) {
  return (
    <Icon className={className}>
      <path d="M8 16 16 8" />
      <path d="M9.5 8H16v6.5" />
    </Icon>
  );
}

export function StarIcon({ className, filled = false }: IconProps & { filled?: boolean }) {
  return (
    <Icon className={className} fill={filled ? "currentColor" : "none"}>
      <path d="m12 3.8 2.5 5.1 5.6.8-4.05 3.95.96 5.6L12 16.6l-5.01 2.65.96-5.6L3.9 9.7l5.6-.8Z" />
    </Icon>
  );
}

/** Share a link — deliberately not the same arrow as "leaves Parranda". */
export function ShareIcon({ className }: IconProps) {
  return (
    <Icon className={className}>
      <path d="M12 15V3.5" />
      <path d="m7.5 8 4.5-4.5L16.5 8" />
      <path d="M5.5 12.5v5.5a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2v-5.5" />
    </Icon>
  );
}

export function CheckIcon({ className }: IconProps) {
  return (
    <Icon className={className}>
      <path d="m5 12.5 4.5 4.5L19 7.5" />
    </Icon>
  );
}

export function ExpandIcon({ className }: IconProps) {
  return (
    <Icon className={className}>
      <path d="M14.5 4H20v5.5" />
      <path d="M9.5 20H4v-5.5" />
      <path d="m20 4-6 6" />
      <path d="m4 20 6-6" />
    </Icon>
  );
}

export function CollapseIcon({ className }: IconProps) {
  return (
    <Icon className={className}>
      <path d="M20 9.5h-5.5V4" />
      <path d="M4 14.5h5.5V20" />
      <path d="m14.5 9.5 6-6" />
      <path d="m9.5 14.5-6 6" />
    </Icon>
  );
}

export function CloseIcon({ className }: IconProps) {
  return (
    <Icon className={className}>
      <path d="M6 6 18 18" />
      <path d="M18 6 6 18" />
    </Icon>
  );
}

export function PlusIcon({ className }: IconProps) {
  return (
    <Icon className={className}>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </Icon>
  );
}

export function MinusIcon({ className }: IconProps) {
  return (
    <Icon className={className}>
      <path d="M5 12h14" />
    </Icon>
  );
}

/** "Keep this one" — a commitment the day has to honour. */
export function KeepIcon({ className }: IconProps) {
  return (
    <Icon className={className}>
      <path d="M7 3.5h10a1 1 0 0 1 1 1v16l-6-4-6 4v-16a1 1 0 0 1 1-1Z" />
    </Icon>
  );
}

/** Blitz — one move, right now. */
export function BoltIcon({ className }: IconProps) {
  return (
    <Icon className={className}>
      <path d="M13 2.5 4.5 13.5H11l-1 8 8.5-11H12l1-8Z" />
    </Icon>
  );
}

/** A preference the day only partly covers. */
export function HalfCircleIcon({ className }: IconProps) {
  return (
    <Icon className={className}>
      <circle cx="12" cy="12" r="7.5" />
      <path d="M12 4.5a7.5 7.5 0 0 1 0 15Z" fill="currentColor" stroke="none" />
    </Icon>
  );
}
