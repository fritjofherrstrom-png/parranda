/**
 * Location-anchor handoff — the landing chooses the day's geographic anchor
 * ONCE; when that anchor is the user's position, the coordinates travel from
 * landing → planner via sessionStorage, never the URL (coordinates are personal
 * data and must not land in a query string, history, or a referrer). The URL
 * only carries the non-sensitive flag `?anchor=near`; the planner reads the
 * coordinates from storage on arrival and composes around them.
 *
 * Semantic firewall (design handoff): this is the DAY anchor. The Live sheet's
 * "Near me" is a separate, later consent that scopes the events query only and
 * never touches the anchor.
 */

const KEY = "parranda:anchor:coords";
export const GEO_TIMEOUT_MS = 12000;

export function storeAnchorCoords(coords) {
  if (!coords || !Number.isFinite(coords.lat) || !Number.isFinite(coords.lng)) return false;
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify({ lat: coords.lat, lng: coords.lng, at: Date.now() }));
    return true;
  } catch {
    return false;
  }
}

// Read + CONSUME the handed-off coordinates (one-shot: a reload must re-ask,
// never silently reuse a stale position).
export function consumeAnchorCoords() {
  try {
    const raw = window.sessionStorage.getItem(KEY);
    if (!raw) return null;
    window.sessionStorage.removeItem(KEY);
    const parsed = JSON.parse(raw);
    if (parsed && Number.isFinite(parsed.lat) && Number.isFinite(parsed.lng)) {
      return { lat: parsed.lat, lng: parsed.lng };
    }
  } catch {
    /* storage blocked / malformed → no anchor */
  }
  return null;
}

// Request the current position exactly once, on an explicit user gesture.
// Resolves { lat, lng } or rejects with a { code } describing why.
export function requestPosition(geolocation = typeof navigator !== "undefined" ? navigator.geolocation : null) {
  return new Promise((resolve, reject) => {
    if (!geolocation || typeof geolocation.getCurrentPosition !== "function") {
      reject({ code: "unsupported" });
      return;
    }
    geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      (err) => reject({ code: err && err.code === 1 ? "denied" : "unavailable" }),
      { enableHighAccuracy: false, timeout: GEO_TIMEOUT_MS, maximumAge: 60000 },
    );
  });
}
