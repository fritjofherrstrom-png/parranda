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
 * Native navigation is a display restore, not another compose. Wait for the
 * real island and rendered answer, then observe network quiescence. Keep native
 * PerformanceNavigationTiming intact: no full clock mocks, retry or sleeps.
 * Callers retain their domain-specific source/Keep/edit assertions afterwards.
 */
export async function assertExactNavigation({ page, navigate, expectedEntry, readComposeCount,
  listName = 'The stops, in order' }) {
  assert.ok(expectedEntry?.safeResponse, 'precondition: an accepted answer exists before navigation');
  const before = readComposeCount();
  await navigate();
  const stops = expectedEntry.safeResponse.days?.[0]?.primary_route?.main_stops || [];
  await page.waitForFunction(({ names, liveNames, listName, empty }) => {
    const island = [...document.querySelectorAll('astro-island')]
      .find(element => element.getAttribute('component-url')?.includes('AnywherePlanner'));
    if (!island || island.hasAttribute('ssr')) return false;
    if (empty) return /Dagen är tom|The day is empty/.test(document.body.textContent);
    const list = [...document.querySelectorAll('ol[aria-label]')]
      .find(element => element.getAttribute('aria-label') === listName);
    const rows = [...(list?.querySelectorAll(':scope > li > button') || [])];
    return rows.length === names.length && names.every((name, i) => rows[i].textContent.includes(name)) &&
      liveNames.every(name => document.body.textContent.includes(name));
  }, { names: stops.filter(stop => !stop.is_live_event).map(stop => stop.label || stop.name),
    liveNames: stops.filter(stop => stop.is_live_event).map(stop => stop.label || stop.name),
    listName, empty: expectedEntry.classification.status === 'edited_empty' });
  await page.waitForLoadState('networkidle');
  assert.equal(readComposeCount(), before, 'exact navigation must not submit another compose');
  const entry = await page.evaluate(() => JSON.parse(localStorage.getItem('parranda:anywhere:last')));
  assert.deepEqual(entry, expectedEntry,
    'the complete accepted response, original observation/date, inputs, Keep and applied edits survive unchanged');
  return entry;
}
