/**
 * The ONE set of text rules for place media credits and excerpts
 * (docs/PLACE_MEDIA.md). The Commons gate, the index record, the published-day
 * schema and the frontend normalizers all read this file, so a credit or an
 * excerpt is judged the same way everywhere.
 */

// ---------- photo credits ----------

// Words that, on their own, say only that nobody is named ("Unknown author",
// "Okänd Okänd", "Unknown illustrator and xylographer", "Anonymous").
const UNKNOWN_WORDS = new Set([
  'unknown', 'anonymous', 'anon', 'anonym', 'okänd', 'okänt', 'okända', 'unbekannt', 'unbekannter', 'inconnu', 'inconnue',
  'desconocido', 'desconocida', 'sconosciuto', 'ignoto', 'tuntematon', 'ukendt', 'ukjent', 'onbekend', 'nieznany',
]);
const ROLE_WORDS = new Set([
  'author', 'authors', 'artist', 'photographer', 'illustrator', 'xylographer', 'creator', 'painter', 'engraver',
  'fotograf', 'fotografen', 'upphovsman', 'upphovsperson', 'författare', 'konstnär', 'autor', 'auteur', 'photographe',
  'fotografo', 'fotógrafo', 'künstler', 'and', 'och', 'und', 'et', 'y', 'e', 'or', 'eller', 'the', 'an', 'a',
]);
const NO_MACHINE_READABLE = /^No machine-readable (?:author|source) provided\b/i;
const OWN_WORK = /^(?:own work|self-photographed|eget arbete|egen bild|travail personnel|trabajo propio|eigenes werk|opera propria|treball propi)\.?$/i;

/**
 * Whether a credit text names nobody: an "unknown"/"anonymous" placeholder in
 * any of the languages Commons uses, Commons' "No machine-readable author
 * provided" note, or a source note such as "Own work".
 */
export function isPlaceholderCredit(value) {
  if (typeof value !== 'string') return false;
  const text = value.trim();
  if (NO_MACHINE_READABLE.test(text) || OWN_WORK.test(text)) return true;
  const words = text.toLowerCase().replace(/[^\p{L}\p{N}\s]+/gu, ' ').split(/\s+/).filter(Boolean);
  return words.length > 0 && words.some(word => UNKNOWN_WORDS.has(word)) &&
    words.every(word => UNKNOWN_WORDS.has(word) || ROLE_WORDS.has(word));
}

/**
 * Whether a text may stand as the shown photo credit: at most 200 characters,
 * no control characters, not a link, a letter and at least two letters or digits (a bare footnote
 * link such as "[1]" or a lone initial names nobody) and not a placeholder.
 */
export function isCreditName(value) {
  if (typeof value !== 'string' || !value.length || value.length > 200 || value !== value.trim()) return false;
  if (/[\u0000-\u001f\u007f-\u009f]/.test(value)) return false;
  if (/^(?:https?|www\.|\/\/|javascript:)/i.test(value)) return false;
  if (/^\[\d+\]$/.test(value)) return false;
  if (!/\p{L}/u.test(value) || (value.match(/[\p{L}\p{N}]/gu) || []).length < 2) return false;
  return !isPlaceholderCredit(value);
}

// ---------- Wikipedia excerpts ----------

// A hatnote (dablink) points the reader to another article; it says nothing
// about this place. Swedish Wikipedia's TextExtracts intro keeps it as its own
// first paragraph ("För slottet i Helsingborg, se Rosendals slott, Helsingborg.").
const HATNOTES = [
  // sv
  /^För\s[^.]*?\bse\b/i,
  /^Om\s[^.]*?,\s*se\b/i,
  /^Se\s/i,
  /^(?:Ej|Inte|Icke)\s+att\s+förväxla\s+med\b/i,
  /^Förväxla\s+inte\b/i,
  /^(?:Denna|Den\s+här)\s+(?:sida|artikel|artikeln)\s+(?:handlar|beskriver|behandlar|avser|gäller)\b/i,
  /^Huvudartikel\s*:/i,
  /^[^.]{1,120}\sär\s+(?:även|också)\s+(?:namnet|ett\s+namn)\s+på\s/i,
  /\(förgreningssida\)/i,
  // en
  /^(?:This|The)\s+(?:article|page)\s+(?:is\s+about|describes|covers)\b/i,
  /^For\s[^.]*?,\s*see\b/i,
  /^For\s+other\s+(?:uses|places|meanings|people)\b/i,
  /^Not\s+to\s+be\s+confused\s+with\b/i,
  /^See\s+also\b/i,
  /^(?:Main\s+article|Further\s+information)\s*:/i,
  /^"[^"]+"\s+redirects\s+here\b/i,
  /\bredirects\s+here\.\s*(?:For\b|$)/i,
  /\(disambiguation\)/i,
];

/** Whether a paragraph (or an excerpt) is, or starts as, a hatnote to another article. */
export function isHatnoteText(value) {
  if (typeof value !== 'string') return false;
  const text = value.trim();
  return Boolean(text) && HATNOTES.some(pattern => pattern.test(text));
}

// Wikipedia's inline maintenance and reference markers. Bracketed IPA
// ("[ˈalmɛˈdɑːlɛn]") and editorial notes stay: they are part of the text.
const MAINTENANCE_MARKER = new RegExp([
  String.raw`\[\d{1,3}\]`,
  String.raw`\[(?:who|when|where|which|why|whom|vem|när|var|vilka|vilken|vad|hur)\?\]`,
  String.raw`\[[^\][]{0,60}?(?:behövs|needed|citation|källa|källor|förtydliga|clarif|dubious|disputed|ifrågasatt|verification|verify|according to whom|enligt vem|by whom|original research|dead link|död länk|inaktuell|update|vague|specify)[^\][]{0,40}\]`,
].join('|'), 'iu');

/**
 * Whether a text carries a bracketed maintenance or reference marker
 * ("[källa behövs]", "[citation needed]", "[1]"): an excerpt never shows one.
 */
export function hasMaintenanceMarker(value) {
  return typeof value === 'string' && MAINTENANCE_MARKER.test(value);
}

/** The index of the first maintenance marker in a text, or -1. */
export function maintenanceMarkerIndex(value) {
  if (typeof value !== 'string') return -1;
  const match = MAINTENANCE_MARKER.exec(value);
  return match ? match.index : -1;
}
