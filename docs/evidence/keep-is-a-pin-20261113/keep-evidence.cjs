// Before/after evidence for "Keep is a pin".
// before: staging (main 2590f540), the real Keep on the first Malmö stop.
// after:  the branch UI served locally, the SAME staging Malmö day replayed
//         through page.route().fulfill (staging replay, not a local compose).
// Usage: PARRANDA_STAGING_URL=<tunnel> node keep-evidence.cjs <worktree> <outDir> <localPort>
//        (with the worktree served by `PORT=<localPort> node server.js`)
const path = require('node:path');
const fs = require('node:fs');
const [, , WT, OUT, PORT] = process.argv;
const { chromium } = require(path.join(WT, 'node_modules/playwright-core'));
const STAGING = process.env.PARRANDA_STAGING_URL; // the shared staging tunnel; not committed
if (!STAGING) throw new Error('set PARRANDA_STAGING_URL');
const PLACE = '/anywhere?place=Malm%C3%B6&lang=en';
fs.mkdirSync(OUT, { recursive: true });

const stopsOn = (p) => p.evaluate(() => [...document.querySelectorAll('ol[aria-label="The stops, in order"] > li')]
  .map((li) => li.querySelector(':scope > button span span')?.childNodes[0]?.textContent?.trim() || li.innerText.split('\n')[1]));
const receiptOn = (p) => p.evaluate(() => [...document.querySelectorAll('[role="status"]')]
  .map((e) => e.textContent.replace(/\s+/g, ' ').trim()).filter((t) => /Kept|Changed|kept/.test(t)));
const kmOn = (p) => p.evaluate(() => (document.body.innerText.match(/≈ ?[\d.,]+ km on foot/) || [''])[0]);

async function dayReady(p) {
  await p.waitForSelector('ol[aria-label="The stops, in order"] > li', { timeout: 90000 });
  await p.waitForTimeout(1500);
}

async function keepFirst(p) {
  await p.locator('ol[aria-label="The stops, in order"] > li > button').first().click();
  await p.waitForTimeout(600);
  await p.getByRole('button', { name: /Keep this one/i }).first().click();
  await p.waitForTimeout(12000);
}

(async () => {
  const b = await chromium.launch();
  const ctx = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 };
  const report = {};

  // BEFORE — staging main.
  {
    const p = await b.newPage(ctx);
    const posts = [];
    let captured = null;
    p.on('request', (r) => { if (new URL(r.url()).pathname === '/api/route-recommendations') posts.push(r.url()); });
    p.on('response', async (r) => {
      if (new URL(r.url()).pathname !== '/api/route-recommendations' || r.status() !== 200) return;
      try { const body = await r.json(); if (!captured && body.days?.[0]?.primary_route) captured = body; } catch {}
    });
    await p.goto(STAGING + PLACE);
    await dayReady(p);
    const stopsBefore = await stopsOn(p);
    const kmBefore = await kmOn(p);
    const postsBefore = posts.length;
    await keepFirst(p);
    report.before = { build: '2590f540 (staging)', stopsBefore, kmBefore, stopsAfter: await stopsOn(p), kmAfter: await kmOn(p),
      composesCausedByKeep: posts.length - postsBefore, keepQuery: posts.at(-1)?.split('?')[1], receipt: await receiptOn(p) };
    await p.screenshot({ path: path.join(OUT, 'before-staging-keep.png') });
    fs.writeFileSync(path.join(OUT, 'staging-malmo-day.json'), JSON.stringify(captured));
    await p.close();
    if (!captured) throw new Error('no staging day captured');

    // AFTER — branch UI, replaying that same staging day.
    const replay = { ...captured };
    delete replay.live_completion;
    const q = await b.newPage(ctx);
    const local = [];
    await q.route('**/api/route-recommendations**', async (route) => {
      local.push(route.request().postDataJSON());
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(replay) });
    });
    await q.goto(`http://127.0.0.1:${PORT}${PLACE}`);
    await dayReady(q);
    const stops0 = await stopsOn(q);
    const km0 = await kmOn(q);
    const n0 = local.length;
    await keepFirst(q);
    report.after = { build: 'branch (staging replay)', stopsBefore: stops0, kmBefore: km0, stopsAfter: await stopsOn(q), kmAfter: await kmOn(q),
      composesCausedByKeep: local.length - n0, receipt: await receiptOn(q),
      rememberedPins: await q.evaluate(() => JSON.parse(localStorage.getItem('parranda:anywhere:last') || 'null')?.commitments?.entries) };
    await q.screenshot({ path: path.join(OUT, 'after-branch-keep.png') });
    // Undo puts it back without a compose.
    await q.getByRole('button', { name: 'Undo this change' }).click();
    await q.waitForTimeout(2000);
    report.afterUndo = { composes: local.length - n0, receipt: await receiptOn(q), stops: await stopsOn(q) };
    // The next adjustment carries the Keep.
    await q.getByRole('button', { name: /Keep this one/i }).count().then(async (n) => {
      if (!n) await q.locator('ol[aria-label="The stops, in order"] > li > button').first().click();
    });
    await q.getByRole('button', { name: /Keep this one/i }).first().click();
    await q.waitForTimeout(1000);
    await q.getByRole('button', { name: /^Adjust$/ }).click();
    await q.getByRole('button', { name: /^Full$/ }).click();
    await q.waitForTimeout(3000);
    report.nextAdjustment = { composes: local.length - n0, pinned: local.at(-1)?.pinned_candidate_ids ?? null };
    await q.close();
  }
  await b.close();
  fs.writeFileSync(path.join(OUT, 'keep-evidence.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
})().catch((e) => { console.error(e); process.exit(1); });
