/** Explain only observed rejection categories; never equate exclusions with publisher unreliability. */
export function liveRejectedSentence(events, lang = 'en') {
  const summary = events?.acquisition?.rejection_summary;
  const rows = Array.isArray(summary) ? summary.filter(row => Number.isInteger(row?.count) && row.count > 0) : [];
  const geographic = new Set(['outside_anchor_radius', 'missing_event_coordinates']);
  const total = rows.reduce((sum, row) => sum + row.count, 0);
  const rejected = events?.acquisition?.source_health?.rejected_event_count;
  if (rows.length && total === rejected && rows.every(row => geographic.has(row.reason))) {
    const outside = rows.some(row => row.reason === 'outside_anchor_radius');
    const missing = rows.some(row => row.reason === 'missing_event_coordinates');
    if (outside && missing) return lang === 'en'
      ? 'The listings were outside the area, or we could not confirm their locations.'
      : 'Listningarna låg utanför området, eller så kunde vi inte bekräfta var de äger rum.';
    if (outside) return lang === 'en'
      ? 'The listings were outside the selected area.'
      : 'Listningarna låg utanför det valda området.';
    return lang === 'en' ? 'We found listings, but could not confirm their locations.'
      : 'Vi hittade listningar, men kunde inte bekräfta var de äger rum.';
  }
  return lang === 'en' ? 'We found listings, but none met the checks for this view.'
    : 'Vi hittade listningar, men inga klarade kontrollerna för den här vyn.';
}
