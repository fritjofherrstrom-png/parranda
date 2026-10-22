import { useEffect, useRef, useState } from "react";
import type { Translate } from "./copy";

/**
 * WHILE AN ADJUSTMENT REBUILDS THE DAY. One sign everywhere it is said — in
 * the Adjust panel, beside "Your day", in the pill — the dots that take the
 * ember in turn, the same trace the loading day's stations run. A small grey
 * "Updating your day …" beside the heading was easy to miss, and with Adjust
 * open on a phone it sat below the screen.
 *
 * Decorative only: the words beside the dots carry the state, and the
 * heading's chip is the one live region that announces it.
 */
export function TraceDots({ count = 5, className = "" }: { count?: number; className?: string }) {
  return (
    <span aria-hidden="true" className={`inline-flex shrink-0 items-center gap-1 ${className}`.trim()}>
      {Array.from({ length: count }, (_, index) => (
        <span
          key={index}
          className="trace-dot h-1.5 w-1.5 rounded-full motion-safe:animate-[parranda-trace-dot_1.6s_ease-in-out_infinite]"
          style={{ animationDelay: `${index * 0.2}s` }}
        />
      ))}
    </span>
  );
}

/** A rebuild that has run this long is a wait, not a blink: say so wherever the reader is. */
export const SLOW_REBUILD_MS = 4000;
const SETTLED_PILL_MS = 6000;

/**
 * The floating status for a slow rebuild only. A quick one (most cached
 * places) is said by the panel and the day itself; past SLOW_REBUILD_MS the
 * reader may have scrolled anywhere, so a pill above the browser's toolbar
 * says it is still working and, once the day has changed, what changed and
 * where to look.
 */
export function RebuildPill({
  t,
  updating,
  summary,
  onShowDay,
}: {
  t: Translate;
  updating: boolean;
  /** What the adjustment changed ("+ Fika · 4 stops swapped"), once the new day is on screen. */
  summary: string;
  onShowDay: () => void;
}) {
  const [shown, setShown] = useState<"working" | "settled" | null>(null);
  const wasShown = useRef(false);
  const summaryRef = useRef(summary);
  summaryRef.current = summary;

  useEffect(() => {
    if (updating) {
      const timer = setTimeout(() => {
        wasShown.current = true;
        setShown("working");
      }, SLOW_REBUILD_MS);
      return () => clearTimeout(timer);
    }
    if (!wasShown.current) return;
    wasShown.current = false;
    // A failed rebuild says so in the day's own header; the pill only ever
    // reports a change that is actually on screen.
    if (!summaryRef.current) {
      setShown(null);
      return;
    }
    setShown("settled");
    const timer = setTimeout(() => setShown(null), SETTLED_PILL_MS);
    return () => clearTimeout(timer);
  }, [updating]);

  if (!shown) return null;
  const pill =
    "pointer-events-auto inline-flex min-h-11 max-w-sm items-center rounded-full bg-parranda-ink text-13 font-bold text-parranda-paper shadow-pop";
  return (
    <div
      data-rebuild-pill={shown}
      className="pointer-events-none fixed inset-x-0 bottom-0 z-(--p-z-toast) flex justify-center px-4 pb-[calc(env(safe-area-inset-bottom)+1rem)]"
    >
      {shown === "working" ? (
        <p aria-hidden="true" className={`${pill} gap-2.5 px-4 [--trace-base:rgb(var(--p-color-paper)/0.3)]`}>
          <TraceDots />
          {t("Uppdaterar dagen …", "Updating your day …")}
        </p>
      ) : (
        <button
          type="button"
          onClick={() => {
            setShown(null);
            onShowDay();
          }}
          className={`${pill} gap-3 py-1 pl-4 pr-1`}
        >
          <span className="min-w-0 truncate">{summaryRef.current}</span>
          <span className="shrink-0 rounded-full bg-parranda-paper/14 px-3 py-2">{t("Visa dagen ↓", "Show the day ↓")}</span>
        </button>
      )}
    </div>
  );
}
