import type { ReactNode } from "react";

/**
 * The shape of the day that is coming, in the order the day lands: the
 * compact title and its date, the day's facts, then — on a phone — the map's
 * short overview and the stops on their line. Wide screens hold the map's
 * column with DayMapPlaceholder instead, so the day arrives where its shape
 * stood rather than jumping down or sideways.
 *
 * Decorative only: it carries no place, number or claim. The status line
 * passed in sits above the title's shape, and is the one thing a reader hears.
 *
 * Every bar and frame carries the same slow sheen (skeleton + parranda-sheen
 * in tailwind.css) and the stations breathe in a soft wave down the line
 * (parranda-breathe), so the page reads as one calm "still coming". A block
 * pulsing on and off read as blinking, a still page read as broken, and
 * ember stations lighting in turn read as hectic.
 */

const shape = "skeleton motion-safe:animate-[parranda-sheen_2.8s_ease-in-out_infinite]";
const bar = `${shape} rounded-full`;
// Five stations, as in a balanced day; uneven like real place names, so the
// line does not read as a table.
const NAME_WIDTHS = ["62%", "46%", "70%", "54%", "40%"];

/**
 * `part` splits the shape around the anchor card, which stands between the
 * day's title and the rest while the day composes: "heading" goes above the
 * card, "body" below it.
 */
export default function DayPlaceholder({ status, inlineMap = true, part = "all" }: { status?: ReactNode; inlineMap?: boolean; part?: "all" | "heading" | "body" }) {
  const heading = (
      <div className="flex flex-col gap-4">
        {status}
        {/* DayHeader's title row (the title, Change beside it) and the date. */}
        <div aria-hidden="true" data-day-shape="heading" className="flex flex-col gap-1.5">
          <div className="flex min-h-11 items-center justify-between gap-3">
            <div className={`${bar} h-7 w-3/5`} />
            <div className={`${bar} h-11 w-24`} />
          </div>
          <div className={`${bar} h-4 w-40`} />
        </div>
      </div>
  );

  const body = (
      <div aria-hidden="true" className={"flex flex-col" + (part === "body" ? "" : " mt-4")}>
        <div className="flex flex-wrap gap-1.5">
          <div className={`${bar} h-6 w-28`} />
          <div className={`${bar} h-6 w-16`} />
        </div>
        {/* What the day did for each pick. A note on missing sources only
            stands when a source fell short, so the shape leaves it out: it
            is the healthy day that should land without moving. */}
        <div className="mt-4 flex flex-wrap gap-2">
          <div className={`${bar} h-6 w-28`} />
          <div className={`${bar} h-6 w-20`} />
          <div className={`${bar} h-6 w-24`} />
        </div>
        {/* On a phone the route opens with the map's overview, the strip it
            will be; then "About this day and map" and the stops' heading. */}
        {inlineMap && <div data-day-shape="map" className={`${shape} mt-8 h-52 rounded-parranda`} />}
        <div className={(inlineMap ? "mt-2" : "mt-8") + " flex min-h-11 items-center"}>
          <div className={`${bar} h-3 w-40`} />
        </div>
        <div className="mb-3 mt-8 flex min-h-9 items-center justify-between gap-3">
          <div className={`${bar} h-3 w-36`} />
          <div className={`${bar} h-9 w-32`} />
        </div>
        <div
          data-day-shape="stations"
          className="relative flex flex-col before:absolute before:bottom-7 before:left-[19px] before:top-7 before:w-1.5 before:rounded-full before:bg-parranda-fill before:content-['']"
        >
          {NAME_WIDTHS.map((width, index) => (
            <div key={index} className="flex flex-col">
              {index > 0 && (
                <div className="flex min-h-10 items-center pl-14">
                  <div className={`${bar} h-2.5 w-24`} />
                </div>
              )}
              <div className="flex min-h-16 items-center gap-3.5 py-2">
                {/* Paper under the disc, so the line stops at the station. Each
                    disc breathes, a beat after the one above it. */}
                <div className="relative z-(--p-z-raised) h-11 w-11 shrink-0 rounded-full bg-parranda-paper">
                  <div
                    data-day-station=""
                    className="h-full w-full rounded-full bg-parranda-fill motion-safe:animate-[parranda-breathe_2.8s_ease-in-out_infinite]"
                    style={{ animationDelay: `${index * 300}ms` }}
                  />
                </div>
                <div className="flex min-w-0 flex-1 flex-col gap-2">
                  <div className={`${bar} h-4`} style={{ width }} />
                  <div className={`${bar} h-5 w-20`} />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
  );

  if (part === "heading") return heading;
  if (part === "body") return body;
  return (
    <div className="flex flex-col">
      {heading}
      {body}
    </div>
  );
}

/** The wide-screen map column while the day composes: the same sticky frame the map will fill. */
export function DayMapPlaceholder() {
  return (
    <div
      aria-hidden="true"
      data-day-shape="map-column"
      className={`${shape} sticky top-4 h-[calc(100dvh-2rem)] min-h-[30rem] rounded-parranda`}
    />
  );
}
