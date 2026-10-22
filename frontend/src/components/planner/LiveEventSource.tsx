/**
 * A Live row's source, as two separate facts: the feed that listed the event
 * ("via …", attribution) and where the link leads (its destination host; a site
 * root says it is only a homepage). The feed label is never the link text.
 *
 * Shared by the Live card and the Live sheet so both surfaces say the same
 * thing about the same row.
 */
import { eventSourceLink } from "../../lib/pulse-view.mjs";
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
  const sourceArea = !holiday && event.source_scope_verified === true && event.geographic_relevance === "source_scope";
  const holidayFlags = Array.isArray(holiday?.flags) ? holiday.flags : [];
  const scope = holiday && (lang === "en"
    ? { national: "National", regional: "Regional", local: "Local" }
    : { national: "Nationell", regional: "Regional", local: "Lokal" })[holiday.scope];
  if (!listedBy && !link && !credits.length && !recurring && !holiday) return null;
  return (
    <span className="text-parranda-ink/68">
      {holiday && <> · {scope} {lang === "en" ? "public holiday — programme not verified" : "helgdag — program inte verifierat"}
        {holiday.temporal_scope === "half_day" && <> · {lang === "en" ? "Half day — time unspecified" : "Halvdag — tid saknas"}</>}
        {holidayFlags.includes("Recommended") && <> · {lang === "en" ? "Recommended by source" : "Rekommenderad enligt källan"}</>}
        {holidayFlags.includes("Provisional") && <> · {lang === "en" ? "Provisional date" : "Preliminärt datum"}</>}
      </>}
      {recurring && <> · {lang === "en"
        ? "Recurring schedule — occurrence unconfirmed"
        : "Återkommande schema — tillfället är inte bekräftat"}</>}
      {sourceArea && <> · {lang === "en" ? "Approximate location" : "Ungefärlig plats"}</>}
      {listedBy && <>{" · "}via&nbsp;{listedBy}</>}
      {credits.length > 0 && <>{" · "}{credits.join(" · ")}</>}
      {link && (
        <>
          {" · "}
          {/* Inline in the row's text: the 44px target is drawn by ::before, so
              a wrapped link keeps the line spacing and its mark after the last word. */}
          <a href={link.href} target="_blank" rel="noopener noreferrer" className={`${inlineLinkTarget} underline decoration-parranda-ink/30 underline-offset-2 hover:text-parranda-clay hover:decoration-parranda-clay`}>
            <ExternalLinkText text={link.text} />
          </a>
        </>
      )}
    </span>
  );
}
