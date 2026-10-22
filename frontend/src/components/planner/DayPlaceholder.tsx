import type { ReactNode } from "react";

/**
 * The shape of the day that is coming, in the order the day lands: the
 * heading and its facts, the stops on their line, and — on a phone — the map
 * after them (StopLine: "on a phone the day comes first"). Wide screens hold
 * the map's column with DayMapPlaceholder instead, so the day arrives where
 * its shape stood rather than jumping down or sideways.
 *
 * Decorative only: it carries no place, number or claim. The status line
 * passed in sits where "Your day" will, and is the one thing a reader hears.
 *
 * The shape holds still. Only the empty stations move, each taking the ember
 * in turn down the line (parranda-trace in tailwind.css) — a whole block
 * pulsing on and off read as blinking. Reduced motion keeps them quiet.
 */

const bar = "rounded-full bg-parranda-ink/10";
// Five stations, as in a balanced day; uneven like real place names, so the
// line does not read as a table.
const NAME_WIDTHS = ["62%", "46%", "70%", "54%", "40%"];

export default function DayPlaceholder({ status, inlineMap }: { status: ReactNode; inlineMap: boolean }) {
  return (
    <div className="flex flex-col">
      {/* DayHeader's rhythm: eyebrow row, heading, facts — gap-5 apart. */}
      <div className="flex flex-col gap-5">
        {status}
        <div aria-hidden="true" data-day-shape="heading" className="flex flex-col gap-5">
          <div className="flex flex-col gap-2">
            <div className={`${bar} h-8 w-2/5 lg:h-11`} />
            <div className={`${bar} h-10 w-4/5 sm:h-12 lg:h-14`} />
          </div>
          <div className="flex flex-wrap gap-1.5">
            <div className={`${bar} h-6 w-28`} />
            <div className={`${bar} h-6 w-16`} />
          </div>
          {/* What the day did for each pick. A note on missing sources only
              stands when a source fell short, so the shape leaves it out: it
              is the healthy day that should land without moving. */}
          <div className="flex flex-wrap gap-2">
            <div className={`${bar} h-6 w-28`} />
            <div className={`${bar} h-6 w-20`} />
            <div className={`${bar} h-6 w-24`} />
          </div>
        </div>
      </div>

      {/* A phone's stops follow the header closely (StopLine's -mt-6); wide
          screens open with the "About this day" line first. */}
      <div aria-hidden="true" className={inlineMap ? "mt-4" : "mt-10"}>
        {!inlineMap && (
          <div className="flex min-h-11 items-center">
            <div className={`${bar} h-3 w-40`} />
          </div>
        )}
        <div className={(inlineMap ? "" : "mt-8 ") + "mb-3 flex min-h-9 items-center justify-between gap-3"}>
          <div className={`${bar} h-3 w-36`} />
          <div className="h-9 w-32 rounded-full border-line border-parranda-ink/12" />
        </div>
        <div
          data-day-shape="stations"
          className="relative flex flex-col before:absolute before:bottom-7 before:left-[19px] before:top-7 before:w-1.5 before:rounded-full before:bg-parranda-ink/10 before:content-['']"
        >
          {NAME_WIDTHS.map((width, index) => (
            <div key={index} className="flex flex-col">
              {index > 0 && (
                <div className="flex min-h-10 items-center pl-14">
                  <div className={`${bar} h-2.5 w-24`} />
                </div>
              )}
              <div className="flex min-h-16 items-center gap-3.5 py-2">
                <div
                  className="relative z-[1] h-11 w-11 shrink-0 rounded-full border-4 border-parranda-ink/12 bg-parranda-paper motion-safe:animate-[parranda-trace_3.2s_ease-in-out_infinite]"
                  style={{ animationDelay: `${index * 0.45}s` }}
                />
                <div className="flex min-w-0 flex-1 flex-col gap-2">
                  <div className={`${bar} h-4`} style={{ width }} />
                  <div className={`${bar} h-5 w-20`} />
                </div>
              </div>
            </div>
          ))}
        </div>
        {inlineMap && (
          <>
            <div data-day-shape="map" className="mt-8 h-48 rounded-parranda bg-parranda-ink/8 sm:h-60" />
            <div className="flex min-h-11 items-center">
              <div className={`${bar} h-3 w-40`} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** The wide-screen map column while the day composes: the same sticky frame the map will fill. */
export function DayMapPlaceholder() {
  return (
    <div
      aria-hidden="true"
      data-day-shape="map-column"
      className="sticky top-4 h-[calc(100dvh-2rem)] min-h-[30rem] rounded-parranda bg-parranda-ink/8"
    />
  );
}
