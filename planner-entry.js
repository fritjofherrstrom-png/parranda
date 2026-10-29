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
  return { place, coords, near, restore, hasIntent: Boolean(params.has("snapshot") || params.has("place_ref") || place || coords || near || restore) };
}

/** URL intent only: ready does not attest snapshot existence, expiry or facts. */
function readPublicDaySnapshotLink(search) {
  const params = typeof search === "string" ? new URLSearchParams(search) : search;
  if (!params.has("snapshot")) return { kind: "absent" };
  if (params.getAll("snapshot").length !== 1 || params.getAll("lang").length > 1) return { kind: "invalid" };
  for (const key of params.keys()) {
    if (key !== "snapshot" && key !== "lang") return { kind: "invalid" };
  }
  const reference = params.get("snapshot");
  if (reference.length !== 48 || /[^0-9a-f]/.test(reference)) return { kind: "invalid" };
  const lang = params.get("lang");
  if (lang !== null && lang !== "en" && lang !== "sv") return { kind: "invalid" };
  return { kind: "ready", reference, lang };
}
module.exports = { readPlannerEntry, readPublicDaySnapshotLink };
