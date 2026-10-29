import { eventTiming, eventTimingNotice } from "../../lib/pulse-view.mjs";
import type { Lang } from "./copy";

/** Dates and clocks stay compact and in natural case. A period's uncertain
 *  session days remain a visible sentence, never part of the time heading. */
export default function LiveEventTiming({ event, lang, now, selectedDate, timing }: {
  event: Parameters<typeof eventTiming>[0];
  lang: Lang;
  now?: Date;
  selectedDate?: string | null;
  timing?: string;
}) {
  const label = timing ?? eventTiming(event, lang, now, selectedDate);
  if (!label) return null;
  const notice = eventTimingNotice(event, lang);
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <p className="max-w-full whitespace-normal text-sm font-medium leading-snug text-parranda-live tabular-nums [overflow-wrap:anywhere]">{label}</p>
      {notice && <p className="text-xs leading-relaxed text-parranda-ink/68">{notice}</p>}
    </div>
  );
}
