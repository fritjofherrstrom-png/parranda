/**
 * "Follow the day": the reader's live position, only while they ask for it.
 *
 * Nothing is requested until `following` turns on (an explicit tap), the watch
 * stops the moment it turns off or the component goes away, and the position
 * lives in this hook's state only — never stored, never put in a URL, never
 * sent anywhere. It cannot change the day: the line reads it, nothing else.
 *
 * `supported` is adopted after mount, so the static build and the first client
 * render agree (no geolocation in either).
 */
import { useEffect, useState } from "react";

export type FollowState =
  | { status: "idle" }
  | { status: "locating" }
  | { status: "tracking"; position: { lat: number; lng: number } }
  | { status: "denied" }
  | { status: "unavailable" };

export function useFollowPosition(following: boolean): { supported: boolean; state: FollowState } {
  const [supported, setSupported] = useState(false);
  const [state, setState] = useState<FollowState>({ status: "idle" });

  useEffect(() => {
    setSupported(typeof navigator !== "undefined" && typeof navigator.geolocation?.watchPosition === "function");
  }, []);

  useEffect(() => {
    if (!following) {
      setState({ status: "idle" });
      return;
    }
    const geolocation = typeof navigator !== "undefined" ? navigator.geolocation : undefined;
    if (!geolocation || typeof geolocation.watchPosition !== "function") {
      setState({ status: "unavailable" });
      return;
    }
    setState({ status: "locating" });
    const id = geolocation.watchPosition(
      (pos) => setState({ status: "tracking", position: { lat: pos.coords.latitude, lng: pos.coords.longitude } }),
      (err) => setState({ status: err && err.code === 1 ? "denied" : "unavailable" }),
      { enableHighAccuracy: true, maximumAge: 15000, timeout: 20000 },
    );
    return () => geolocation.clearWatch(id);
  }, [following]);

  return { supported, state };
}
