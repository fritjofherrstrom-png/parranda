/** Bounded display contract only. The server owns source/venue attestation. */
export function normalizeVisitContent(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.version !== 1 ||
      !value.text || typeof value.text !== 'object' || Array.isArray(value.text)) return null;
  const text = {};
  for (const lang of ['sv', 'en']) {
    const s = value.text[lang];
    if (typeof s !== 'string' || !s || s !== s.trim() || s.length > 320 || /[\u0000-\u001f\u007f]/.test(s)) return null;
    text[lang] = s;
  }
  const date = value.checked_on;
  if (typeof date !== 'string' || !/^\d{4}-\d\d-\d\d$/.test(date) || date.startsWith('0000') ||
      !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) return null;
  const href = value.source_url;
  if (typeof href !== 'string' || href.length > 2048 || !/^https?:\/\//i.test(href) || /[\u0000-\u0020\u007f\\]/.test(href)) return null;
  try {
    const url = new URL(href);
    if (!url.hostname || url.username || url.password || !['https:', 'http:'].includes(url.protocol)) return null;
  } catch { return null; }
  return { version: 1, text, source_url: href, checked_on: date };
}
