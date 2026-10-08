/**
 * Shareable any-city day links — pure encode/decode of the day's inputs into URL
 * query params, so a shared link auto-plans the SAME day (place + preferences +
 * day + rhythm + language). Legacy kilometer links restore rhythm intent only.
 *
 * Only inputs are encoded, never results — the recipient's engine composes fresh
 * (honest: events / "today" reflect when THEY open it, not when it was shared).
 */

export function encodeShareParams({ city, place, preferences = [], dayOffset = 0, walkKey = "balanced", lang = "en" } = {}) {
  const params = new URLSearchParams();
  const cityKey = String(city || "").trim().toLowerCase();
  if (/^[a-z0-9-]{1,64}$/.test(cityKey)) params.set("city", cityKey);
  const p = String(place || "").trim();
  if (p) params.set("place", p);
  params.set("planner", "open");
  if (Array.isArray(preferences) && preferences.length) params.set("prefs", preferences.join(","));
  if (dayOffset === 1) params.set("day", "1");
  if (walkKey && walkKey !== "balanced") params.set("rhythm", walkKey);
  params.set("lang", lang === "sv" ? "sv" : "en");
  return params.toString();
}

// Build a full absolute share URL from an origin + inputs.
export function buildShareUrl(origin, inputs) {
  const base = String(origin || "").replace(/\/$/, "");
  return `${base}/anywhere?${encodeShareParams(inputs)}`;
}

// Losing a selected qualifier can silently share a different namesake.
// Decline sharing when the canonical label exceeds the resolver query budget.
export function shareablePlace(inputs) {
  if (!inputs?.place) return null;
  const place = String(inputs.placeLabel || inputs.place).trim();
  return place && place.length <= 200 ? place : null;
}

// Decode a query string (or URLSearchParams) back into day inputs. Unknown/absent
// params fall back to sensible defaults; only whitelisted preference keys survive.
export function decodeShareParams(search, allowedPrefKeys = null) {
  const params = typeof search === "string" ? new URLSearchParams(search) : search;
  const rawCity = (params.get("city") || "").trim().toLowerCase();
  const city = /^[a-z0-9-]{1,64}$/.test(rawCity) ? rawCity : null;
  const place = (params.get("place") || "").trim();
  const rawPrefs = (params.get("prefs") || "").split(",").map((s) => s.trim()).filter(Boolean);
  const preferences = allowedPrefKeys ? rawPrefs.filter((k) => allowedPrefKeys.includes(k)) : rawPrefs;
  const dayOffset = params.get("day") === "1" ? 1 : 0;
  const rhythmRaw = params.get("rhythm");
  // Old kilometer links remain readable as intent, but never restore a km target.
  const legacy = params.get("km");
  const walkKey = ["calm", "balanced", "full", "free"].includes(rhythmRaw)
    ? rhythmRaw
    : legacy === "short" ? "calm" : legacy === "long" ? "full" : "balanced";
  const langRaw = params.get("lang");
  const lang = langRaw === "sv" ? "sv" : langRaw === "en" ? "en" : null;
  return { city, place, preferences, dayOffset, walkKey, lang };
}
