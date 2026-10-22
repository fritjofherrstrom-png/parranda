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
  // Frozen original full-metadata plan: every required byte must still be
  // present after bounded transport coalesces short gaps and splits bodies.
  // The logical reference hash stays unchanged; physical transfer can include
  // short gaps only inside the unchanged aggregate disk limit.
  const fs=require('node:fs'),crypto=require('node:crypto');
  const ranges=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/overture-metadata-20261021/logical-ranges.json')));
  assert.equal(crypto.createHash('sha256').update(JSON.stringify(ranges)).digest('hex'),'0f03cab0c33fbe67975a7903a84b2c6a60830d3645ec4419e61e1efbce087363');
  const transport=[...actual.ranges].sort((a,b)=>a.start-b.start);
  for(const needed of ranges){
    let cursor=needed.start;
    for(const received of transport){if(received.start<=cursor&&received.end>=cursor)cursor=received.end+1;if(cursor>needed.end)break;}
    assert.ok(cursor>needed.end,'every original projected byte must remain covered');
  }
  assert.ok(actual.maxRangeBytes<=512*1024);
});

// Source transport control models the observed >3MiB body exceeding one10s
// operation. No live network, retries, larger timer or child heap is used.
test('dense official footer uses bounded bodies and fewer requests inside unchanged disk/heap caps', () => {
  const child = spawnSync(process.execPath, ['--max-old-space-size=64', path.join(__dirname,'helpers/overture-large-footer-replay.js')], {encoding:'utf8',timeout:20000,env:{...process.env,PARRANDA_METADATA_REPLAY_FIXTURE:path.join(__dirname,'fixtures/overture-dense-footer-20261021'),PARRANDA_REPLAY_MAX_RANGE_BYTES:String(512*1024)}});
  assert.equal(child.status,0,`bounded dense replay failed: ${child.stderr.slice(0,1500)}`);
  const actual=JSON.parse(child.stdout);
  assert.ok(actual.maxRangeBytes<=512*1024);
  assert.ok(actual.rangeCount<=160, 'avoid hundreds of fragmented round trips in one bounded acquisition');
  assert.ok(actual.physicalBytes<=32*1024*1024);
  assert.equal(actual.sourceAssets[0].etag,'"e92948dbce4b18503f5633f019a52b20-11"');
});

// Controlled network model from the measured failure envelope:650ms response
// overhead and300KiB/s per read, advanced by a virtual clock. This proves the
// bounded acquisition architecture, not a future provider SLA. Real DuckDB
// parses the immutable footer; native CPU time is outside the network model.
test('dense catalogue transfer fits the bounded acquisition window under controlled latency', () => {
  const child=spawnSync(process.execPath,['--max-old-space-size=64',path.join(__dirname,'helpers/overture-large-footer-replay.js')],{encoding:'utf8',timeout:20000,env:{...process.env,PARRANDA_METADATA_REPLAY_FIXTURE:path.join(__dirname,'fixtures/overture-dense-footer-20261021'),PARRANDA_REPLAY_LATENCY_MODEL:'1'}});
  assert.equal(child.status,0,`bounded latency model failed: ${child.stderr.slice(0,1500)}`);
  const actual=JSON.parse(child.stdout);assert.ok(actual.virtualMs<75000);assert.ok(actual.maximumActive<=4);
});
