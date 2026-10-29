/**
 * A Live row's source, as two separate facts: the feed that listed the event
 * ("via …", attribution) and where the link leads (its destination host; a site
 * root says it is only a homepage). The feed label is never the link text.
 *
 * Destination and required credits stay visible. A long feed label has its
 * own disclosure, while location/calendar/recurrence uncertainty stays open.
 */
import { eventSourceLink, eventTiming } from "../../lib/pulse-view.mjs";
import { ExternalLinkText, inlineLinkTarget } from "../shared/ui";
import type { Lang } from "./copy";
import type { PulseEvent } from "./types";

export function liveEventSource(event: PulseEvent, lang: Lang) {
  const link = eventSourceLink(event, lang);
  const listedBy = String(event.source_label || "").trim();
  const credits = [...new Set((Array.isArray(event.sources) ? event.sources : [])
    .map((source) => typeof source?.attribution === "string" ? source.attribution.trim() : "")
    .filter(Boolean))];
  const recurring = event.recurrence?.occurrence_status === "unconfirmed";
  const holiday = event.calendar_fact?.kind === "public_holiday" ? event.calendar_fact : null;
  const programme = event.programme;
  const programmeDates = programme ? eventTiming({ starts_on: programme.starts_on, ends_on: programme.ends_on,
    time_window: { kind: "all_day", starts_on: programme.starts_on, ends_on: programme.ends_on } }, lang) : "";
  const sourceArea = !holiday && event.source_scope_verified === true && event.geographic_relevance === "source_scope";
  const holidayFlags = Array.isArray(holiday?.flags) ? holiday.flags : [];
  const scope = holiday && (lang === "en"
    ? { national: "National", regional: "Regional", local: "Local" }
    : { national: "Nationell", regional: "Regional", local: "Lokal" })[holiday.scope];
  if (!listedBy && !link && !credits.length && !recurring && !holiday && !programme && !sourceArea) return null;
  return (
    <div className="flex min-w-0 flex-col gap-0.5 text-xs leading-relaxed text-parranda-ink/68 [overflow-wrap:anywhere]">
      {programme && <p>{lang === "en" ? "Programme" : "Program"}: {programme.title}
        {programmeDates && <> ({programmeDates})</>}
      </p>}
      {holiday && <p>{scope} {lang === "en" ? "public holiday — programme not verified" : "helgdag — program inte verifierat"}
        {holiday.temporal_scope === "half_day" && <> · {lang === "en" ? "Half day — time unspecified" : "Halvdag — tid saknas"}</>}
        {holidayFlags.includes("Recommended") && <> · {lang === "en" ? "Recommended by source" : "Rekommenderad enligt källan"}</>}
        {holidayFlags.includes("Provisional") && <> · {lang === "en" ? "Provisional date" : "Preliminärt datum"}</>}
      </p>}
      {recurring && <p>{lang === "en"
        ? "Recurring schedule — occurrence unconfirmed"
        : "Återkommande schema — tillfället är inte bekräftat"}</p>}
      {sourceArea && <p>{lang === "en" ? "Approximate location" : "Ungefärlig plats"}</p>}
      {credits.map(credit => <p key={credit}>{credit}</p>)}
      {(link || listedBy) && <div className="flex min-w-0 flex-wrap items-start gap-x-4">
        {link && <p className="min-w-0 max-w-full py-3">
          <a href={link.href} target="_blank" rel="noopener noreferrer" className={`${inlineLinkTarget} underline decoration-parranda-ink/30 underline-offset-2 hover:text-parranda-clay hover:decoration-parranda-clay`}>
            <ExternalLinkText text={link.text} />
          </a>
        </p>}
        {listedBy && <details className="min-w-0 max-w-full">
          <summary className="min-h-11 cursor-pointer py-3 font-medium">{lang === "en" ? "Source details" : "Källinformation"}</summary>
          <p className="pb-2">via&nbsp;{listedBy}</p>
        </details>}
      </div>}
    </div>
  );
}
