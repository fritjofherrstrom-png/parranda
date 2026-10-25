/**
 * "Working on it": the wordmark's ring, small, drawing itself as a loop over
 * a faint track and letting it go again while it slowly turns
 * (parranda-mark-draw / parranda-mark-turn in tailwind.css). The wordmark
 * itself stays still; this is the one moving sign wherever the planner is
 * working. Under reduced motion it is the still ring.
 *
 * Decorative only: the words beside it carry the state.
 */
export function RingMark({ className = "h-3.5 w-3.5" }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      data-ring-mark=""
      viewBox="0 0 18 18"
      className={`shrink-0 text-parranda-ember motion-safe:animate-[parranda-mark-turn_4.8s_linear_infinite] ${className}`}
    >
      <circle cx="9" cy="9" r="7" fill="none" stroke="currentColor" strokeWidth="4" opacity="0.22" />
      <circle
        cx="9"
        cy="9"
        r="7"
        fill="none"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinecap="round"
        pathLength={100}
        className="motion-safe:animate-[parranda-mark-draw_2.4s_ease-in-out_infinite]"
      />
    </svg>
  );
}
