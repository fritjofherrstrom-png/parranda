/**
 * Whether a CSS media query matches, for layout decisions CSS alone cannot make
 * (moving the one Leaflet map beside the day on wide screens).
 *
 * Built on useSyncExternalStore with a server snapshot of `false`: the static
 * build and the first client render agree (narrow), and React re-renders with
 * the real value right after hydration — never a hydration mismatch. Without
 * matchMedia (jsdom, very old browsers) it stays `false`, the phone layout.
 */
import { useCallback, useSyncExternalStore } from "react";

export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (notify: () => void) => {
      if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};
      const list = window.matchMedia(query);
      list.addEventListener?.("change", notify);
      return () => list.removeEventListener?.("change", notify);
    },
    [query],
  );
  const snapshot = () =>
    typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia(query).matches : false;
  return useSyncExternalStore(subscribe, snapshot, () => false);
}
