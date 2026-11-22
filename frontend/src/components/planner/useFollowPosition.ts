/**
 * One opt-in, memory-only position session, shared by the map and day's line.
 * A fix never changes the day, enters storage or goes to a Parranda API.
 */
import { useCallback, useEffect, useState } from "react";

export type CurrentPosition = { lat: number; lng: number; accuracy: number; timestamp: number };
export type FollowState =
  | { status: "idle" | "locating" | "paused" | "denied" | "unavailable" }
  | { status: "tracking"; position: CurrentPosition };
export type PositionSession = { supported: boolean; state: FollowState; retry: () => void };
const MAX_AGE_MS = 60000;

function currentFix(pos: GeolocationPosition): CurrentPosition | null {
  const { latitude: lat, longitude: lng, accuracy } = pos?.coords ?? {};
  const timestamp = pos?.timestamp;
  const now = Date.now();
  if (!Number.isFinite(lat) || Math.abs(lat) > 90 || !Number.isFinite(lng) || Math.abs(lng) > 180 ||
      !Number.isFinite(accuracy) || accuracy < 0 || !Number.isFinite(timestamp) ||
      timestamp < now - MAX_AGE_MS || timestamp > now + 5000) return null;
  return { lat, lng, accuracy, timestamp };
}

export function useFollowPosition(following: boolean): PositionSession {
  const [supported, setSupported] = useState(false);
  const [state, setState] = useState<FollowState>({ status: "idle" });
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt(value => value + 1), []);
  useEffect(() => {
    setSupported(typeof navigator !== "undefined" && typeof navigator.geolocation?.watchPosition === "function");
  }, []);

  useEffect(() => {
    if (!following) { setState({ status: "idle" }); return; }
    const geo = typeof navigator !== "undefined" ? navigator.geolocation : undefined;
    if (!geo || typeof geo.watchPosition !== "function") { setState({ status: "unavailable" }); return; }
    let watchId: number | undefined;
    let expiry: ReturnType<typeof setTimeout> | undefined;
    let generation = 0;
    let disposed = false;
    let suspended = document.visibilityState === "hidden";
    const stop = () => {
      generation += 1;
      if (expiry !== undefined) clearTimeout(expiry);
      expiry = undefined;
      if (watchId !== undefined) geo.clearWatch(watchId);
      watchId = undefined;
    };
    const start = () => {
      stop();
      const own = generation;
      const current = () => !disposed && own === generation;
      setState({ status: "locating" });
      const fail = (status: "denied" | "unavailable") => {
        if (!current()) return;
        stop();
        setState({ status });
      };
      try {
        const id = geo.watchPosition(
          pos => {
            if (!current()) return;
            const position = currentFix(pos);
            if (!position) { fail("unavailable"); return; }
            if (expiry !== undefined) clearTimeout(expiry);
            setState({ status: "tracking", position });
            expiry = setTimeout(() => fail("unavailable"), Math.max(1, position.timestamp + MAX_AGE_MS - Date.now()));
          },
          error => fail(error?.code === 1 ? "denied" : "unavailable"),
          { enableHighAccuracy: true, maximumAge: 15000, timeout: 20000 },
        );
        if (current()) watchId = id;
        else geo.clearWatch(id);
      } catch { fail("unavailable"); }
    };
    const pause = () => {
      if (suspended) return;
      suspended = true;
      stop();
      setState({ status: "paused" });
    };
    const resume = () => {
      if (!suspended || document.visibilityState === "hidden") return;
      suspended = false;
      start();
    };
    const visibility = () => document.visibilityState === "hidden" ? pause() : resume();
    if (suspended) setState({ status: "paused" });
    else start();
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("pagehide", pause);
    window.addEventListener("pageshow", resume);
    return () => {
      disposed = true;
      stop();
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("pagehide", pause);
      window.removeEventListener("pageshow", resume);
    };
  }, [following, attempt]);
  // A stopped/superseded session has no visible fix even before effect cleanup.
  return { supported, state: following ? state : { status: "idle" }, retry };
}
