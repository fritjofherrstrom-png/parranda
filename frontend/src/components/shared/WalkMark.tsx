/**
 * "Working on it" in Parranda's own terms: a walker crossing a short route.
 * The dot walks the line in three small steps while the route fills in behind
 * it, then both fade and the walk begins again (walk-step / walk-trail in
 * tailwind.css). It replaced a still ember rule that read as nothing
 * happening. Under reduced motion it is that rule again.
 *
 * Decorative only: the words beside it carry the state.
 */
export function WalkMark({ className = "" }: { className?: string }) {
  return (
    <span aria-hidden="true" data-walk-mark="" className={`relative inline-block h-2 w-7 shrink-0 ${className}`.trim()}>
      <span className="absolute inset-x-0 top-0.5 h-1 rounded-full bg-parranda-ink/15" />
      <span className="walk-trail absolute left-0 top-0.5 h-1 w-full rounded-full bg-parranda-ember" />
      <span className="walk-step absolute left-0 top-0 h-2 w-2 rounded-full bg-parranda-ember" />
    </span>
  );
}
