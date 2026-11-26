import LiveEventTiming from "./LiveEventTiming";
import { liveEventSource } from "./LiveEventSource";
import { eventSourceLink } from "../../lib/pulse-view.mjs";
import { ExternalIcon } from "../shared/icons";
import type { Lang } from "./copy";
import type { PulseEvent } from "./types";

// Display only. A contact must follow a separator and contain an actual phone
// number or email address; venue words such as Telefonplan are not contacts.
function placeDisplay(place?: string) {
  if (!place) return "";
  const field = String.raw`(?:(?:tel(?:efon)?\.?|phone)\s*:?\s*\+?\d[\d\s()./-]{4,}|(?:(?:e-?post|e-?mail)\s*:?\s*)?[^\s@,;|·]+@[^\s@,;|·]+\.[^\s@,;|·]+)`;
  const separator = String.raw`(?:[,;|·]|\s[–—-]\s)\s*`;
  // Only a closed contact-only tail may be omitted. An interior contact must
  // never swallow a later street, town or entrance instruction.
  const match = new RegExp(`${separator}${field}(?:\\s*${separator}${field})*\\s*$`, "i").exec(place);
  return match && match.index > 0 ? place.slice(0, match.index).trim() : place;
}

/** Shared reading order for the compact card and full Live sheet. Original
 *  titles and backend facts are preserved; only the visible place is tidied. */
export default function LiveEventSummary({ event, lang, now, selectedDate, timing, distance, heading = "h3", titleClassName = "font-bold", compact = false }: {
  event: PulseEvent;
  lang: Lang;
  now?: Date;
  selectedDate?: string | null;
  timing?: string;
  distance?: string | null;
  heading?: "h3" | "h5";
  titleClassName?: string;
  /** The Live card's board row: tighter, same facts and targets. */
  compact?: boolean;
}) {
  const Heading = heading;
  const place = placeDisplay(event.place);
  const sourceLink = eventSourceLink(event, lang);
  return (
    <div className={"flex min-w-0 max-w-full flex-col [overflow-wrap:anywhere] " + (compact ? "gap-0.5" : "gap-1")}>
      {/* The Name role: a board row's title at 15px beside its clock, the
          sheet's at 17px. The link is the whole title line, 44px tall. */}
      <Heading aria-label={event.title} className={`${compact ? "text-15 leading-snug" : "text-17 leading-tight"} text-parranda-ink ${titleClassName}`}>
        {sourceLink ? <a href={sourceLink.href} target="_blank" rel="noopener noreferrer"
          aria-label={sourceLink.kind === "site_home" ? `${event.title} — ${sourceLink.text}` : event.title}
          className="flex min-h-11 items-center no-underline transition-colors duration-150 ease-out hover:text-parranda-live focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-parranda-live">
          {/* The mark follows the title's last word, not the row's far edge. */}
          <span className="min-w-0">{event.title}<ExternalIcon className="ml-1 inline-block h-3.5 w-3.5 align-baseline text-parranda-ink-meta" /></span>
        </a> : event.title}
      </Heading>
      <LiveEventTiming event={event} lang={lang} now={now} selectedDate={selectedDate} timing={timing} />
      {/* One Meta line: where, and how far when it is known. */}
      {(place || distance) && <p className={`type-data text-13 text-parranda-ink-meta ${compact ? "leading-snug" : "leading-relaxed"}`}>
        {place}{place && distance ? " · " : ""}{distance && <span className="font-semibold text-parranda-live">{distance}</span>}
      </p>}
      {liveEventSource(event, lang)}
    </div>
  );
}
