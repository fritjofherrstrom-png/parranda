// Alternative/current official source-owned names only; never historical names.
// Kept server-side for identity, not as evidence of existence or quality.
function normalizeSourceNameAliases(values) {
  return [...new Set((Array.isArray(values) ? values : [])
    .filter((value) => typeof value === 'string' && value.length <= 160 &&
      !/[\r\n\u0000-\u001f]/.test(value))
    .map((value) => value.trim()).filter(Boolean))].slice(0, 8);
}

module.exports = { normalizeSourceNameAliases };
