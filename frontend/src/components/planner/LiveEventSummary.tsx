import LiveEventTiming from "./LiveEventTiming";
import { liveEventSource } from "./LiveEventSource";
import type { Lang } from "./copy";
import type { PulseEvent } from "./types";

// Display only. A contact must follow a separator and contain an actual phone
// number or email address; venue words such as Telefonplan are not contacts.
function placeDisplay(place?: string) {
  if (!place) return "";
  const contact = /(?:[,;|·]|\s[–—-]\s)\s*(?:(?:tel(?:efon)?\.?|phone)\s*:?\s*\+?\d[\d\s()./-]{4,}|(?:(?:e-?post|e-?mail)\s*:?\s*)?[^\s@,;|·]+@[^\s@,;|·]+\.[^\s@,;|·]+)/i;
  const match = contact.exec(place);
  return match && match.index > 0 ? place.slice(0, match.index).trim() : place;
}

/** Shared reading order for the compact card and full Live sheet. Original
 *  titles and backend facts are preserved; only the visible place is tidied. */
export default function LiveEventSummary({ event, lang, now, selectedDate, timing, distance, heading = "h3", titleClassName = "font-bold" }: {
  event: PulseEvent;
  lang: Lang;
  now?: Date;
  selectedDate?: string | null;
  timing?: string;
  distance?: string;
  heading?: "h3" | "h5";
  titleClassName?: string;
}) {
  const Heading = heading;
  const place = placeDisplay(event.place);
  return (
    <div className="flex min-w-0 max-w-full flex-col gap-1 [overflow-wrap:anywhere]">
      <Heading className={`text-15 leading-snug text-parranda-ink ${titleClassName}`}>{event.title}</Heading>
      <LiveEventTiming event={event} lang={lang} now={now} selectedDate={selectedDate} timing={timing} />
      {(place || distance) && <p className="text-sm leading-relaxed text-parranda-ink/75">
        {place}{place && distance ? " · " : ""}{distance && <span className="font-semibold text-parranda-live">{distance}</span>}
      </p>}
      {liveEventSource(event, lang)}
    </div>
  );
}
