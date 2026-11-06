export function normalizeDayPlaceSearch(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).some(key => key !== 'query') || typeof value.query !== 'string') return null;
  const query = value.query.trim();
  return query.length > 0 && query.length <= 80 && !/[\u0000-\u001f\u007f]/.test(query) ? { query } : null;
}
