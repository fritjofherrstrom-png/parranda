/** Bounded display contract, not publisher certification. Server admission owns evidence. */
export const MAX_VENUE_MENTIONS = 8;
const object = value => !!value && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const text = (value, max) => typeof value === 'string' && value.length > 0 && value.length <= max && value === value.trim() && !/[\u0000-\u001f\u007f]/.test(value);
const keys = (value, names) => object(value) && Object.keys(value).length === names.length && Object.keys(value).every(key => names.includes(key) && Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value'));
const date = value => typeof value === 'string' && /^\d{4}-\d\d-\d\d$/.test(value) && !value.startsWith('0000') && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
const nullableDate = value => value === null || date(value);
const point = value => typeof value?.lat === 'number' && Number.isFinite(value.lat) && Math.abs(value.lat) <= 90 && typeof value?.lng === 'number' && Number.isFinite(value.lng) && Math.abs(value.lng) <= 180;
function publicArticleUrl(value) {
  if (!text(value, 1000) || /[\u0000-\u0020\u007f]/.test(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash && !url.port &&
      url.hostname.includes('.') && !/^[\d.]+$/.test(url.hostname) && !url.hostname.includes(':') && !url.hostname.endsWith('.') &&
      !/(?:^|\.)(?:localhost|local|localdomain|internal|invalid|test|home\.arpa)$/.test(url.hostname);
  } catch { return false; }
}
const FIELDS = ['venue_id','venue_binding','article_id','publisher_id','publisher','publisher_group','article_url','article_title','relation_kind','published_on','updated_on','verified_at','source_evidence','independence','sponsorship'];
function validMention(row, place) {
  if (!keys(row, FIELDS) || !text(row.venue_id, 128) || !text(row.article_id, 128) || !text(row.publisher_id, 80) || !text(row.publisher, 120) ||
      !(row.publisher_group === null || text(row.publisher_group, 120)) || !publicArticleUrl(row.article_url) || !text(row.article_title, 240) ||
      !['mentioned','listed','recommended'].includes(row.relation_kind) || !nullableDate(row.published_on) || !nullableDate(row.updated_on) ||
      (row.published_on && row.updated_on && row.updated_on < row.published_on) ||
      !text(row.verified_at, 40) || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(row.verified_at) || !date(row.verified_at.slice(0, 10)) || !Number.isFinite(Date.parse(row.verified_at)) || new Date(row.verified_at).toISOString() !== row.verified_at ||
      !['independent','not_independent','unknown'].includes(row.independence) || !['sponsored','not_sponsored','unknown'].includes(row.sponsorship)) return false;
  const binding = row.venue_binding, evidence = row.source_evidence;
  return keys(binding, ['label','lat','lng']) && text(binding.label, 500) && point(binding) && point(place) &&
    binding.label === (place.label || place.name) && binding.lat === place.lat && binding.lng === place.lng &&
    keys(evidence, ['document_sha256','locator']) && /^[a-f0-9]{64}$/.test(evidence.document_sha256) && text(evidence.locator, 256);
}
/** Invalid metadata hides this optional disclosure, never repairs facts or changes the route. */
export function readVenueMentions(value, place) {
  try {
    if (!Array.isArray(value) || value.length > MAX_VENUE_MENTIONS) return [];
    for (let i = 0; i < value.length; i++) {
      if (!Object.hasOwn(value, i) || !Object.hasOwn(Object.getOwnPropertyDescriptor(value, String(i)), 'value')) return [];
    }
    if (!value.every(row => validMention(row, place))) return [];
    if (new Set(value.map(row => row.article_url)).size !== value.length || new Set(value.map(row => `${row.venue_id}|${row.article_id}`)).size !== value.length) return [];
    return value;
  } catch { return []; }
}
