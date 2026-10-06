"use strict";
/** URL intent only, never trusted location identity or route data.
 * Read the same first-value URLSearchParams contract on server and client.
 * anchor=near is the consented sessionStorage handoff, not a coordinate claim.
 * restore=last explicitly requests the local saved snapshot (which may be absent).
 */
function readPlannerEntry(search) {
  const params = typeof search === "string" ? new URLSearchParams(search) : search;
  const rawPlace = (params.get("place") || "").trim();
  const place = rawPlace && !/[\u0000-\u001f\u007f\ufffd]/u.test(rawPlace) ? rawPlace : "";
  const number = (key, bound) => {
    const raw = (params.get(key) || "").trim();
    if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(raw)) return null;
    const value = Number(raw);
    return Number.isFinite(value) && Math.abs(value) <= bound ? value : null;
  };
  const lat = number("lat", 90);
  const lng = number("lng", 180);
  const coords = lat !== null && lng !== null ? { lat, lng } : null;
  const near = params.get("anchor") === "near";
  const restore = params.get("restore") === "last";
  return { place, coords, near, restore, hasIntent: Boolean(place || coords || near || restore) };
}
module.exports = { readPlannerEntry };
