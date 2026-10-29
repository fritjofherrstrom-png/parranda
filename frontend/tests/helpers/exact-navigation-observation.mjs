import assert from 'node:assert/strict';

/** Copy actual browser-owned storage, including publication-instance records. */
export function browserStorage(storage) {
  return Object.fromEntries(Array.from({ length: storage.length }, (_, index) => {
    const key = storage.key(index);
    const raw = storage.getItem(key);
    try { return [key, JSON.parse(raw)]; } catch { return [key, raw]; }
  }));
}

/**
 * Native navigation is a display restore, not another compose. Navigate only
 * after the accepted answer is rendered and bound to this history entry; LAST
 * is written before that publication effect. Then observe the restored answer
 * and network quiescence. Keep native
 * PerformanceNavigationTiming intact: no full clock mocks, retry or sleeps.
 * Callers retain their domain-specific source/Keep/edit assertions afterwards.
 */
export async function assertExactNavigation({ page, navigate, expectedEntry, readComposeCount,
  listName = 'The stops, in order' }) {
  assert.ok(expectedEntry?.safeResponse, 'precondition: an accepted answer exists before navigation');
  const stops = expectedEntry.safeResponse.days?.[0]?.primary_route?.main_stops || [];
  const portable = JSON.parse(JSON.stringify(expectedEntry));
  delete portable.inputs.placeSelection;
  for (const key of ['live_completion', 'live_route_upgrade', 'planner_lifecycle']) delete portable.safeResponse[key];
  const view = { names: stops.filter(stop => !stop.is_live_event).map(stop => stop.label || stop.name),
    liveNames: stops.filter(stop => stop.is_live_event).map(stop => stop.label || stop.name),
    listName, empty: expectedEntry.classification.status === 'edited_empty' };
  const waitForView = ({ publication = null } = {}) => page.waitForFunction(({ names, liveNames, listName, empty, publication }) => {
    const island = [...document.querySelectorAll('astro-island')]
      .find(element => element.getAttribute('component-url')?.includes('AnywherePlanner'));
    if (!island || island.hasAttribute('ssr')) return false;
    if (publication) {
      const marker = history.state?.parrandaDayView;
      const records = JSON.parse(sessionStorage.getItem('parranda:anywhere:navigation:v1') || 'null')?.records;
      const record = records?.find(record => record.reference === marker?.reference);
      const params = new URLSearchParams(location.search);
      params.delete('lang'); params.delete('view'); params.sort();
      const address = `${location.pathname}?${params}`;
      if (marker?.version !== 1 || record?.version !== 1 || marker.address !== address ||
          record.address !== address || JSON.stringify(record.entry) !== JSON.stringify(publication)) return false;
    }
    if (empty) return /Dagen är tom|The day is empty/.test(document.body.textContent);
    const list = [...document.querySelectorAll('ol[aria-label]')]
      .find(element => publication
        ? ['The stops, in order', 'Stoppen i ordning'].includes(element.getAttribute('aria-label'))
        : element.getAttribute('aria-label') === listName);
    const rows = [...(list?.querySelectorAll(':scope > li > button') || [])];
    return rows.length === names.length && names.every((name, i) => rows[i].textContent.includes(name)) &&
      liveNames.every(name => document.body.textContent.includes(name));
  }, { ...view, publication });
  await waitForView({ publication: portable });
  const before = readComposeCount();
  await navigate();
  await waitForView();
  await page.waitForLoadState('networkidle');
  assert.equal(readComposeCount(), before, 'exact navigation must not submit another compose');
  const entry = await page.evaluate(() => JSON.parse(localStorage.getItem('parranda:anywhere:last')));
  assert.deepEqual(entry, expectedEntry,
    'the complete accepted response, original observation/date, inputs, Keep and applied edits survive unchanged');
  return entry;
}
