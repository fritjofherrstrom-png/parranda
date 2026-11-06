export function normalizeDayPlaceSearch(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).some(key => !['query', 'visible_candidate_ids'].includes(key)) || typeof value.query !== 'string') return null;
  const query = value.query.trim();
  if (!(query.length > 0 && query.length <= 80 && !/[\u0000-\u001f\u007f]/.test(query))) return null;
  if (Object.hasOwn(value, 'visible_candidate_ids')) {
    const ids = value.visible_candidate_ids;
    if (!Array.isArray(ids) || ids.length > 6 || new Set(ids).size !== ids.length || ids.some(id =>
      typeof id !== 'string' || !id || id.length > 200 || id !== id.trim() || /[\u0000-\u001f\u007f]/.test(id))) return null;
    return { query, visible_candidate_ids: [...ids] };
  }
  return { query };
}
