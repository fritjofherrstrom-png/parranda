import { useEffect, useState } from "react";
import type { PulseEvent } from "./types";

// Repaint time claims at minute boundaries and at any source's sub-minute
// boundary. This does not refresh providers or recompose the day. Clock changes
// while a tab sleeps are reconciled immediately when it is shown/focused again.
export function useLiveClock(events: readonly PulseEvent[]) {
  const [now, setNow] = useState(() => new Date());
  const offsets = new Set([0]);
  for (const event of events.flatMap(ev => [ev, ...(ev.occurrences || [])])) {
    const win = event.time_window;
    for (const value of [event.starts_at, event.ends_at, win?.starts_at, win?.ends_at]) {
      const time = value ? Date.parse(value) : NaN;
      if (Number.isFinite(time)) offsets.add(((time % 60000) + 60000) % 60000);
    }
    for (const value of [win?.local_start, win?.local_end]) {
      const seconds = value?.match(/^\d{2}:\d{2}:([0-5]\d)$/)?.[1];
      if (seconds) offsets.add(Number(seconds) * 1000);
    }
  }
  const boundaryKey = [...offsets].sort((a, b) => a - b).join(",");
  useEffect(() => {
    const boundaries = boundaryKey.split(",").map(Number);
    let timer: number;
    function update() {
      window.clearTimeout(timer);
      const epoch = Date.now(), elapsed = ((epoch % 60000) + 60000) % 60000;
      setNow(new Date(epoch));
      const next = boundaries.find(offset => offset > elapsed);
      const delay = next === undefined ? 60000 - elapsed + boundaries[0] : next - elapsed;
      timer = window.setTimeout(update, Math.max(1, delay));
    }
    update();
    window.addEventListener("focus", update);
    document.addEventListener("visibilitychange", update);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("focus", update);
      document.removeEventListener("visibilitychange", update);
    };
  }, [boundaryKey]);
  return now;
}
