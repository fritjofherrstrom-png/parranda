'use strict';

const fs = require('node:fs');
const path = require('node:path');

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
    const dir = process.env.PARRANDA_MAP_DIAGNOSTICS_DIR;
    if (dir) {
      fs.mkdirSync(dir, { recursive: true });
      const name = String(label).replace(/[^a-z0-9_-]/gi, '_');
      const rendered = await page.evaluate(() => {
        const describe = element => {
          const box = element.getBoundingClientRect();
          const style = getComputedStyle(element);
          return { tag: element.tagName, class: String(element.className), label: element.getAttribute('aria-label'),
            rect: { x: box.x, y: box.y, width: box.width, height: box.height },
            display: style.display, visibility: style.visibility, opacity: style.opacity,
            transform: style.transform, position: style.position };
        };
        return { viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
          readyState: document.readyState,
          frames: Array.from(document.querySelectorAll('[data-route-map]')).map(element => ({
            ...describe(element), region: element.closest('[role="region"],section,aside')?.getAttribute('aria-label'),
            ancestors: Array.from((function* () { for (let e = element.parentElement; e; e = e.parentElement) yield e; })()).map(describe),
            markers: Array.from(element.querySelectorAll('.route-map-marker-shell,.route-map-marker')).map(describe),
            canvases: Array.from(element.querySelectorAll('canvas')).map(describe),
          })),
          styles: Array.from(document.styleSheets).map(sheet => { let rules; try { rules = sheet.cssRules.length; } catch { rules = null; }
            return { href: sheet.href, disabled: sheet.disabled, rules }; }),
          resources: performance.getEntriesByType('resource').filter(e => /\.js|\.css/.test(e.name)).map(e => ({ name: e.name, start: e.startTime, duration: e.duration, size: e.transferSize })),
          events: window.__routeInteractionTrace || [] };
      });
      fs.writeFileSync(path.join(dir, `${name}.json`), JSON.stringify(rendered, null, 2));
      fs.writeFileSync(path.join(dir, `${name}.html`), await page.content());
      await page.screenshot({ path: path.join(dir, `${name}.png`), fullPage: true });
    }
  } catch (error) {
    // A closed/crashed page is unavailable evidence, not a new test failure.
    try { log('[map-interaction-trace-unavailable]', label, error?.name || 'Error'); }
    catch { /* The logger itself can be unavailable; preserve the test result. */ }
  }
}

module.exports = { writeMapInteractionTrace };
