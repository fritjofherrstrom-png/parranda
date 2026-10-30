import LiveEventTiming from "./LiveEventTiming";
import { liveEventSource } from "./LiveEventSource";
import type { ReactNode } from "react";
import type { PulseEvent } from "./types";

export default function EventOccurrences({ event, lang, selectedDate, now, renderChoice }: {
  event: PulseEvent; lang: "sv" | "en"; selectedDate?: string; now?: Date; renderChoice?: (slot: PulseEvent) => ReactNode;
}) {
  const slots = event.occurrences;
  if (!slots || slots.length < 1 || (slots.length === 1 && !renderChoice)) return null;
  return (
    <details className="mt-1 text-xs text-parranda-ink-muted">
      <summary className="min-h-11 cursor-pointer py-3 font-semibold text-parranda-live">
        {slots.length} {lang === "en" ? slots.length === 1 ? "occurrence" : "occurrences" : slots.length === 1 ? "tillfälle" : "tillfällen"}
      </summary>
      <ul className="flex flex-col gap-2 pb-2">
        {slots.map((slot, i) => (
          <li key={slot.id || i} className="flex min-w-0 flex-col gap-1 [overflow-wrap:anywhere]">
            <LiveEventTiming event={slot} lang={lang} now={now} selectedDate={selectedDate} />
            {liveEventSource(slot, lang)}
            {renderChoice?.(slot)}
          </li>
        ))}
      </ul>
    </details>
  );
}
