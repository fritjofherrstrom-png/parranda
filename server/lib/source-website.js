"use strict";

// A venue link is a source-owned optional fact, separate from attribution.
function normalizeSourceWebsite(value) {
  if (typeof value !== 'string') return null;
  const raw = value.trim();
  if (!raw || raw.length > 2048 || !/^https?:\/\//i.test(raw) || /[\u0000-\u001f\u007f]/.test(raw)) return null;
  try {
    const url = new URL(raw);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    const normalized = url.toString();
    return normalized.length <= 2048 ? normalized : null;
  } catch (_error) {
    return null;
  }
}

module.exports = { normalizeSourceWebsite };
