/**
 * Landing search routing — pure + testable. Same product contract as the
 * current landing (landing.js):
 *   - a REGISTERED city (exact name or alias) → the modern planner carrying
 *     the exact server-owned citypack identity;
 *   - any other non-empty text → the any-city planner `/anywhere?place=…`
 *     (freeform place, never a recognized city key);
 *   - empty input → nothing.
 * Prefix matching only powers inline completion; it never promotes submitted
 * freeform text by itself. The registry is a map of lowercased alias →
 * { key, label, status } injected by
 * the server at serve time (a city is data, never code).
 */

const STATUS_RANK = { public: 0, beta: 1, preview: 2 };
const MIN_PREFIX_LENGTH = 3;

export function resolveEntry(registry, raw) {
  if (!registry) return null;
  return registry[String(raw || "").trim().toLowerCase()] || null;
}

// Unique city whose alias starts with the typed text — so "Barc" finds Barcelona.
// Ambiguous prefixes stay silent; submit routing remains exact-only.
export function bestPrefixMatch(registry, raw) {
  const q = String(raw || "").trim().toLowerCase();
  if (q.length < MIN_PREFIX_LENGTH || !registry) return null;
  const matches = new Map();
  for (const aliasKey of Object.keys(registry)) {
    if (aliasKey.indexOf(q) !== 0) continue;
    const entry = registry[aliasKey];
    if (!entry) continue;
    const key = entry.key || aliasKey;
    if (!matches.has(key)) matches.set(key, entry);
  }
  if (matches.size !== 1) return null;
  return Array.from(matches.values())[0] || null;
}

// The inline completion suggestion ("Barc" → "Barcelona"), or null.
export function inlineCompletion(registry, typed) {
  const raw = String(typed || "");
  if (!raw.trim()) return null;
  const match = bestPrefixMatch(registry, raw);
  if (!match) return null;
  const label = String(match.label || "");
  if (label.length <= raw.length) return null;
  if (label.toLowerCase().indexOf(raw.toLowerCase()) !== 0) return null;
  return raw + label.slice(raw.length);
}

export function curatedCityHref(entry, lang = "en") {
  if (!entry || !entry.key) return null;
  const params = new URLSearchParams();
  params.set("city", String(entry.key));
  params.set("place", String(entry.label || entry.key));
  params.set("planner", "open");
  params.set("lang", lang === "sv" ? "sv" : "en");
  return `/anywhere?${params.toString()}`;
}

/**
 * The submit decision: where does this input take the user?
 * @returns {{ type: "city"|"anywhere", href: string } | null}
 */
export function routeForInput(registry, raw, lang = "en") {
  const value = String(raw || "").trim();
  if (!value) return null;
  const uiLang = lang === "sv" ? "sv" : "en";
  // Submitting freeform text must never promote a loose prefix into a curated
  // city. Inline completion may turn an accepted suggestion into an exact
  // value, but otherwise the user's text belongs to the any-city planner.
  const entry = resolveEntry(registry, value);
  if (entry && entry.key) {
    return { type: "city", href: curatedCityHref(entry, uiLang) };
  }
  const params = new URLSearchParams();
  params.set("place", value);
  params.set("planner", "open");
  params.set("lang", uiLang);
  return { type: "anywhere", href: `/anywhere?${params.toString()}` };
}
