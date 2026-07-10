/**
 * Landing search routing — pure + testable. Same product contract as the
 * current landing (landing.js):
 *   - a REGISTERED city (exact alias or best prefix match) → its curated city
 *     shell `/:city?planner=open` (unchanged URL contract);
 *   - any other non-empty text → the any-city planner `/anywhere?place=…`
 *     (freeform place, never a recognized city key);
 *   - empty input → nothing.
 * The registry is a map of lowercased alias → { key, label, status } injected by
 * the server at serve time (a city is data, never code).
 */

const STATUS_RANK = { public: 0, beta: 1, preview: 2 };

export function resolveEntry(registry, raw) {
  if (!registry) return null;
  return registry[String(raw || "").trim().toLowerCase()] || null;
}

// Best city whose alias starts with the typed text — so "Barc" finds Barcelona.
// Deterministic: label-prefix beats alias-only, then status rank, then shortest.
export function bestPrefixMatch(registry, raw) {
  const q = String(raw || "").trim().toLowerCase();
  if (!q || !registry) return null;
  let best = null;
  let bestScore = Infinity;
  for (const aliasKey of Object.keys(registry)) {
    if (aliasKey.indexOf(q) !== 0) continue;
    const entry = registry[aliasKey];
    if (!entry) continue;
    const labelLc = String(entry.label || "").toLowerCase();
    const labelIsPrefix = labelLc.indexOf(q) === 0 ? 0 : 1;
    const rank = STATUS_RANK[entry.status] != null ? STATUS_RANK[entry.status] : 3;
    const score = labelIsPrefix * 1000 + rank * 100 + labelLc.length;
    if (score < bestScore) {
      bestScore = score;
      best = entry;
    }
  }
  return best;
}

export function resolveEntryLoose(registry, raw) {
  return resolveEntry(registry, raw) || bestPrefixMatch(registry, raw);
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

/**
 * The submit decision: where does this input take the user?
 * @returns {{ type: "city"|"anywhere", href: string } | null}
 */
export function routeForInput(registry, raw, lang = "en") {
  const value = String(raw || "").trim();
  if (!value) return null;
  const uiLang = lang === "sv" ? "sv" : "en";
  const entry = resolveEntryLoose(registry, value);
  if (entry && entry.key) {
    const params = new URLSearchParams();
    params.set("planner", "open");
    params.set("lang", uiLang);
    return { type: "city", href: `/${entry.key}?${params.toString()}` };
  }
  const params = new URLSearchParams();
  params.set("place", value);
  params.set("planner", "open");
  params.set("lang", uiLang);
  return { type: "anywhere", href: `/anywhere?${params.toString()}` };
}
