'use strict';

// Test-only observation; never modifies product state.
async function writeMapInteractionTrace(page, label, log = console.error) {
  if (!page) return;
  try {
    const trace = await page.evaluate(() => ({
      events: window.__routeInteractionTrace || [],
      tooltip: document.querySelector('[data-route-map] [role="tooltip"]')?.textContent || null,
      markers: Array.from(document.querySelectorAll('.route-map-marker-shell')).map(e => e.getAttribute('aria-label')),
    }));
    log('[map-interaction-trace]', label, JSON.stringify(trace));
  } catch (error) {
    // A closed/crashed page is unavailable evidence, not a new test failure.
    try { log('[map-interaction-trace-unavailable]', label, error?.name || 'Error'); }
    catch { /* The logger itself can be unavailable; preserve the test result. */ }
  }
}

module.exports = { writeMapInteractionTrace };
