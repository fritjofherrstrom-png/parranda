/**
 * A Live row's source, as two separate facts: the feed that listed the event
 * ("via …", attribution) and where the link leads (its destination host; a site
 * root says it is only a homepage). The feed label is never the link text.
 *
 * Shared by the Live card and the Live sheet so both surfaces say the same
 * thing about the same row.
 */
import { eventSourceLink } from "../../lib/pulse-view.mjs";
import type { Lang } from "./copy";
import type { PulseEvent } from "./types";

export function liveEventSource(event: PulseEvent, lang: Lang) {
  const link = eventSourceLink(event, lang);
  const listedBy = String(event.source_label || "").trim();
  if (!event.source_url || (!listedBy && !link)) return null;
  return (
    <span className="text-parranda-ink/50">
      {listedBy && <>{" · "}via&nbsp;{listedBy}</>}
      {link && (
        <>
          {" · "}
          {/* The 44px target keeps its height, but negative block margins stop
              it from pushing the text line apart where the row wraps. */}
          <a href={link.href} target="_blank" rel="noopener noreferrer" className="-my-3 inline-flex min-h-11 min-w-11 items-center underline decoration-parranda-ink/30 underline-offset-2 hover:text-parranda-clay hover:decoration-parranda-clay">
            {/* One flow, so a wrapped homepage label keeps its arrow after the last word. */}
            <span>{link.text}<span aria-hidden="true">&nbsp;↗</span></span>
          </a>
        </>
      )}
    </span>
  );
}
