import assert from 'node:assert/strict';
import test from 'node:test';
import { liveRejectedSentence } from '../src/lib/live-empty-copy.mjs';
const events = rows => ({ acquisition: { rejection_summary: rows, source_health: { rejected_event_count: rows.reduce((n,r) => n+r.count,0) } } });
for (const lang of ['en','sv']) test(`rejected-empty copy uses only complete observed categories in ${lang}`, () => {
  assert.match(liveRejectedSentence(events([{reason:'outside_anchor_radius',count:7}]),lang),lang==='en' ? /outside the selected area/ : /utanför det valda området/);
  assert.match(liveRejectedSentence(events([{reason:'missing_event_coordinates',count:7}]),lang),lang==='en' ? /confirm their locations/ : /bekräfta var/);
  const mixed=events([{reason:'outside_anchor_radius',count:7},{reason:'unknown_reason',count:1}]);
  assert.match(liveRejectedSentence(mixed,lang),lang==='en' ? /met the checks/ : /klarade kontrollerna/);
  const mismatch=events([{reason:'outside_anchor_radius',count:7}]); mismatch.acquisition.source_health.rejected_event_count=14;
  assert.match(liveRejectedSentence(mismatch,lang),lang==='en' ? /met the checks/ : /klarade kontrollerna/);
  assert.doesNotMatch(liveRejectedSentence(null,lang),/unreliable|opålitlig/);
});
