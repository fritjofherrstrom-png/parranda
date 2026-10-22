/**
 * WHILE AN ADJUSTMENT REBUILDS THE DAY. One sign everywhere it is said — in
 * the Adjust panel and beside "Your day" — three dots that warm to ember
 * and back in a slow swell, in the loading day's calm tempo. A small grey
 * "Updating your day …" beside the heading was easy to miss, and with Adjust
 * open on a phone it sat below the screen.
 *
 * Decorative only: the words beside the dots carry the state, and the
 * heading's chip is the one live region that announces it.
 */
export function TraceDots({ count = 3, className = "" }: { count?: number; className?: string }) {
  return (
    <span aria-hidden="true" className={`inline-flex shrink-0 items-center gap-1 ${className}`.trim()}>
      {Array.from({ length: count }, (_, index) => (
        <span
          key={index}
          className="trace-dot h-1.5 w-1.5 rounded-full motion-safe:animate-[parranda-trace-dot_2.4s_ease-in-out_infinite]"
          style={{ animationDelay: `${index * 0.35}s` }}
        />
      ))}
    </span>
  );
}
