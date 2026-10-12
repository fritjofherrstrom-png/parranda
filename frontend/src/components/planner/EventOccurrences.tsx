import { eventTiming } from "../../lib/pulse-view.mjs";
import { liveEventSource } from "./LiveEventSource";
import type { PulseEvent } from "./types";

export default function EventOccurrences({ event, lang, selectedDate }: {
  event: PulseEvent; lang: "sv" | "en"; selectedDate?: string;
}) {
  const slots = event.occurrences;
  if (!slots || slots.length < 2) return null;
  return (
    <details className="mt-1 text-xs text-parranda-ink/75">
      <summary className="min-h-11 cursor-pointer py-3 font-semibold text-parranda-live">
        {slots.length} {lang === "en" ? "occurrences" : "tillfällen"}
      </summary>
      <ul className="flex flex-col gap-2 pb-2">
        {slots.map((slot, i) => (
          <li key={slot.id || i}>
            {eventTiming(slot, lang, undefined, selectedDate)}
            {liveEventSource(slot, lang)}
          </li>
        ))}
      </ul>
    </details>
  );
}
