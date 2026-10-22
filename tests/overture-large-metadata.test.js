'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
// Break caught: materializing every Parquet metadata field into JS exhausts the
// existing 64MiB acquisition child's heap on a genuine official source footer.
test('official 512-row-group footer can prefetch inside the existing 64MiB child heap', () => {
  const child = spawnSync(process.execPath, ['--max-old-space-size=64', path.join(__dirname, 'helpers/overture-large-footer-replay.js')], { encoding: 'utf8', timeout: 20000 });
  assert.equal(child.status, 0, `metadata child failed (${child.signal}): ${child.stderr.slice(0, 1500)}`);
  const actual = JSON.parse(child.stdout);
  assert.equal(actual.sourceAssets.length, 1);
  assert.equal(actual.sourceAssets[0].etag, '"a77c4beb9d0e1f4873c8657c0f251b9e-11"');
  assert.equal(actual.sourceAssets[0].length, 714390669);
  assert.ok(actual.physicalBytes <= 32 * 1024 * 1024, 'existing shared physical-byte cap');
  // Frozen original full-metadata planner result for this immutable footer.
  // The independent reference needs a larger diagnostic heap/work allowance;
  // the production replay above must retain its existing 64MiB heap.
  assert.equal(actual.physicalBytes, 8441856);
  assert.equal(actual.rangeCount, 91);
  assert.equal(actual.rangeDigest, '0f03cab0c33fbe67975a7903a84b2c6a60830d3645ec4419e61e1efbce087363');
});
