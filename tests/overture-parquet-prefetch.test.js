'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { DuckDBInstance } = require('@duckdb/node-api');
const { buildOvertureQuery } = require('../server/place-candidates/overture-source');
const modulePath = path.join(__dirname, '../server/place-candidates/overture-parquet-prefetch.js');
const native = fs.existsSync(modulePath) ? require(modulePath) : {};
const asset = 's3://overturemaps-us-west-2/release/2026-09-23.1/theme=places/type=place/part-00001-fixture-c000.zstd.parquet';

async function fixture(t, { x = 'CASE WHEN i<2048 OR (i>=4096 AND i<6144) THEN 12.0+(i%20)*0.0001 ELSE 50.0 END', y = '40.0+(i%10)*0.0001' } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'parranda-prefetch-test-'));
  const db = await DuckDBInstance.create(':memory:', { memory_limit: '128MB', threads: '1', autoload_known_extensions: 'false', autoinstall_known_extensions: 'false' });
  const conn = await db.connect();
  t.after(() => { conn.closeSync(); db.closeSync(); fs.rmSync(dir, { recursive: true, force: true }); });
  const file = path.join(dir, 'full.parquet');
  await conn.run(`COPY (SELECT
    printf('10000000-0000-0000-0000-%012d',i) AS id,
    {'primary':'Place ' || i} AS "names",
    {'primary':CASE WHEN i%3=0 THEN 'cafe' ELSE 'garden' END,
     'hierarchy':['root',CASE WHEN i%3=0 THEN 'cafe' ELSE 'garden' END]} AS taxonomy,
    0.99 AS confidence, CASE WHEN i%19=0 THEN 'closed' ELSE 'open' END AS operating_status,
    ['https://example.test/' || i] AS websites,
    {'names':{'primary':CASE WHEN i%7=0 THEN 'Chain' END}} AS brand,
    [{'property':'name','dataset':'fixture','license':'CC0-1.0','record_id':repeat(md5(i::VARCHAR),4),
      'update_time':'2026-01-01','confidence':0.99,'between':[0.1,0.2],
      'provider':'fixture','resource':'fixture','version':'v1'}] AS sources,
    {'xmin':${x}, 'ymin':${y}} AS bbox,
    repeat(md5(i::VARCHAR),16) AS unused_payload
    FROM range(8192)t(i)) TO '${file}' (FORMAT PARQUET, ROW_GROUP_SIZE 2048)`);
  const bytes = fs.readFileSync(file);
  let active = 0, maximum = 0;
  const requests = [];
  const server = http.createServer((req, res) => {
    res.setHeader('etag', '"fixture-v1"');
    if (req.method === 'HEAD') { res.setHeader('content-length', bytes.length); res.end(); return; }
    assert.equal(req.headers['if-match'], '"fixture-v1"');
    const match = req.headers.range?.match(/^bytes=(\d+)-(\d+)$/);
    assert.ok(match);
    const start = Number(match[1]), end = Number(match[2]);
    requests.push({ start, end }); active++; maximum = Math.max(maximum, active);
    setTimeout(() => {
      res.writeHead(206, { 'content-range': `bytes ${start}-${end}/${bytes.length}`, 'content-length': end-start+1 });
      res.end(bytes.subarray(start,end+1)); active--;
    }, 5);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const fetcher = (url, options) => { assert.match(url, /^https:\/\/overturemaps-us-west-2\.s3\.us-west-2\.amazonaws\.com\/release\//); return fetch(`http://127.0.0.1:${server.address().port}/fixture`, options); };
  return { dir, conn, file, bytes, fetcher, requests, url: `http://127.0.0.1:${server.address().port}/fixture`, maxActive: () => maximum };
}

test('pinned sparse prefetch preserves actual stratified SQL output and overlaps range requests', async t => {
  assert.equal(typeof native.prefetchOvertureParquet, 'function', 'native range prefetch is missing');
  const f = await fixture(t);
  const tempDir = path.join(f.dir, 'sparse'); fs.mkdirSync(tempDir);
  const result = await native.prefetchOvertureParquet({ conn: f.conn, paths: [asset], window: { lat:40,lng:12,radiusKm:5 }, tempDir, fetcher: f.fetcher });
  const sql = buildOvertureQuery({ release:'2026-09-23.1',lat:40,lng:12,parquetPaths:[asset] });
  const expected = (await f.conn.runAndReadAll(sql.replaceAll(`'${asset}'`, `'${f.file}'`))).getRowObjectsJson();
  const actual = (await f.conn.runAndReadAll(native.localizeOvertureSql(sql,result.sqlPaths))).getRowObjectsJson();
  assert.equal(actual.length,600);
  assert.deepEqual(actual,expected);
  assert.deepEqual(result.sourceAssets,[{path:asset,etag:'"fixture-v1"',length:f.bytes.length}]);
  assert.ok(f.maxActive()>1, 'native chunks must be fetched concurrently');
  assert.ok(f.maxActive()<=4);
  assert.ok(result.physicalBytes<=32*1024*1024);
  assert.ok(f.requests.reduce((n,r)=>n+r.end-r.start+1,0)<f.bytes.length,'far row groups and unused columns must not be fetched');
  const meta=(await f.conn.runAndReadAll(`SELECT * FROM parquet_metadata('${f.file}')`)).getRowObjectsJson();
  const far=meta.find(r=>r.row_group_id==='1'&&r.path_in_schema==='id');
  const offset=Number(far.dictionary_page_offset||far.data_page_offset);
  assert.ok(!f.requests.some(r=>r.start<=offset&&r.end>=offset),'irrelevant group chunks must remain holes');
});

// Break caught: rectangle-only acquisition reads a whole corner group even
// though the unchanged sample SQL rejects every one of its rows by distance.
test('sample-radius acquisition skips a proven outside corner through real HTTP without changing the ordered SQL result', async t => {
  const f = await fixture(t, {
    x: '(CASE WHEN i<2048 OR (i>=4096 AND i<6144) THEN 12.001 ELSE 12.049 END)::FLOAT',
    y: '(CASE WHEN i<2048 OR (i>=4096 AND i<6144) THEN 40.001 ELSE 40.038 END)::FLOAT',
  });
  // The corner is inside both 5km rectangular bounds, but >5.9km away.
  const sql = buildOvertureQuery({ release: '2026-09-23.1', lat: 40, lng: 12, parquetPaths: [asset] });
  const expected = (await f.conn.runAndReadAll(sql.replaceAll(`'${asset}'`, `'${f.file}'`))).getRowObjectsJson();
  assert.equal(expected.length, 600);
  const metadata = (await f.conn.runAndReadAll(`SELECT * FROM parquet_metadata('${f.file}')`)).getRowObjectsJson();
  const corner = metadata.find(row => row.row_group_id === '1' && row.path_in_schema === 'id');
  const start = Number(corner.dictionary_page_offset || corner.data_page_offset);
  const coversCorner = ranges => ranges.some(range => range.start <= start && range.end >= start);
  const results = [];
  for (const distanceFilter of [undefined, 'sample-radius-v1']) {
    const tempDir = path.join(f.dir, distanceFilter || 'rectangle'); fs.mkdirSync(tempDir);
    const from = f.requests.length;
    const result = await native.prefetchOvertureParquet({ conn: f.conn, paths: [asset],
      window: { lat: 40, lng: 12, radiusKm: 5 }, distanceFilter, tempDir, fetcher: f.fetcher });
    const actual = (await f.conn.runAndReadAll(native.localizeOvertureSql(sql, result.sqlPaths))).getRowObjectsJson();
    assert.deepEqual(actual, expected, 'all fields and the complete stratified order must remain identical');
    results.push({ ...result, ranges: f.requests.slice(from) });
  }
  assert.ok(coversCorner(results[0].ranges), 'generic rectangle acquisition must retain its existing contract');
  assert.ok(!coversCorner(results[1].ranges), 'a provably outside group must never be acquired');
  assert.deepEqual(results[1].sourceAssets, results[0].sourceAssets, 'same strong source identity');
  assert.ok(results[1].physicalBytes < results[0].physicalBytes);
  assert.ok(results[1].ranges.reduce((n,r) => n+r.end-r.start+1,0)
    < results[0].ranges.reduce((n,r) => n+r.end-r.start+1,0));
});

test('source-owned radius pruning survives real parent/child IPC and returns the same verified sample', async t => {
  const { createOvertureSource, mapOvertureRow } = require('../server/place-candidates/overture-source');
  const { createBoundedOvertureQuery } = require('../server/place-candidates/bounded-overture-query');
  const { fork } = require('node:child_process');
  const f = await fixture(t, {
    x: '(CASE WHEN i<2048 OR (i>=4096 AND i<6144) THEN 12.001 ELSE 12.049 END)::FLOAT',
    y: '(CASE WHEN i<2048 OR (i>=4096 AND i<6144) THEN 40.001 ELSE 40.038 END)::FLOAT',
  });
  // Only the external asset boundary is redirected; the source, validation,
  // IPC child, sparse reader, SQL, normalization and receipt are production.
  const preload = path.join(f.dir, 'controlled-fetch.cjs');
  fs.writeFileSync(preload, `const fetchAsset = globalThis.fetch;
globalThis.fetch = (url, options) => {
  if (!String(url).startsWith('https://overturemaps-us-west-2.s3.us-west-2.amazonaws.com/release/')) throw Error('unexpected_external_request');
  return fetchAsset(${JSON.stringify(f.url)}, options);
};\n`);
  let closed;
  const execute = createBoundedOvertureQuery({ timeoutMs: 20000, tempRoot: f.dir, spawn: (file, args, options) => {
    const child = fork(file, args, { ...options, execArgv: [...options.execArgv, '--require', preload] });
    closed = new Promise(resolve => child.once('close', resolve));
    t.after(async () => { child.kill('SIGKILL'); await closed; });
    return child;
  } });
  const source = createOvertureSource({ releaseResolver: async () => '2026-09-23.1',
    assetResolver: async () => [asset], queryRows: execute, now: () => 1792713600000 });
  const sql = buildOvertureQuery({ release: '2026-09-23.1', lat: 40, lng: 12, parquetPaths: [asset] });
  const expected = (await f.conn.runAndReadAll(sql.replaceAll(`'${asset}'`, `'${f.file}'`))).getRowObjectsJson().map(row => mapOvertureRow(row));
  const actual = await source.acquire({ lat: 40, lng: 12 });
  await closed;
  assert.equal(actual.source_error, undefined);
  assert.equal(actual.length, 600);
  assert.deepEqual(actual, expected);
  assert.deepEqual(actual.source_receipt.assets, [{ path: asset, etag: '"fixture-v1"', length: f.bytes.length }]);
  assert.equal(source.validateReceipt(actual.source_receipt, source.cacheKeyFor({ lat: 40, lng: 12 })), true);
  const metadata = (await f.conn.runAndReadAll(`SELECT * FROM parquet_metadata('${f.file}')`)).getRowObjectsJson();
  const corner = metadata.find(row => row.row_group_id === '1' && row.path_in_schema === 'id');
  const start = Number(corner.dictionary_page_offset || corner.data_page_offset);
  assert.ok(!f.requests.some(range => range.start <= start && range.end >= start), 'the source opt-in must reach both native validation boundaries');
});

test('sample-radius metadata pruning retains uncertain statistics, world edges and every radius boundary', () => {
  const keep = (window, { x = [12, 12], y = [40, 40], type = 'DOUBLE' } = {}) => {
    const rows = [['bbox, xmin', x], ['bbox, ymin', y], ['id', [0, 0]]].map(([name, [min, max]], i) => ({
      row_group_id: '0', type, path_in_schema: name, stats_min_value: min, stats_max_value: max,
      data_page_offset: 20 + 20*i, total_compressed_size: 10,
    }));
    return native.selectOvertureChunkRanges(rows, window, 1000, { distanceFilter: 'sample-radius-v1' }).length > 0;
  };
  const window = { lat: 40, lng: 12, radiusKm: 5 };
  assert.equal(keep(window, { x: [12.049, 12.049], y: [40.038, 40.038], type: 'FLOAT' }), false);
  for (const x of [[null, null], ['', ''], ['NaN', 'NaN'], [12.05, 12.04], [-181, 181]]) {
    assert.equal(keep(window, { x }), true, 'unusable bounds cannot prove exclusion');
  }
  assert.equal(keep(window, { x: [12.049, 12.049], y: [40.038, 40.038], type: null }), true);
  assert.equal(keep(window, { x: [12.049, 12.049], y: [40.038, 40.038], type: 'BYTE_ARRAY' }), true);
  assert.equal(keep(window, { y: [40.045218222005174, 40.045218222005174] }), true, 'exact 5km latitude boundary');
  assert.equal(keep({ lat: 0, lng: 179.99, radiusKm: 5 }, { x: [-179.99, -179.99], y: [0, 0], type: 'FLOAT' }), true);
  assert.equal(keep({ lat: 0, lng: -179.99, radiusKm: 5 }, { x: [179.99, 179.99], y: [0, 0], type: 'FLOAT' }), true);
  assert.equal(keep({ lat: 90, lng: 180, radiusKm: 5 }, { x: [-180, -180], y: [90, 90], type: 'FLOAT' }), true);
  assert.equal(keep({ lat: -90, lng: -180, radiusKm: 5 }, { x: [180, 180], y: [-90, -90], type: 'FLOAT' }), true);
});

test('FLOAT radius boundary accepted by the real SQL is never excluded by an ideal DOUBLE distance', async t => {
  // Literal counterexample: ideal planar distance is1.000325km, but FLOAT
  // longitude arithmetic in the source SQL gives0.999738km, within1km.
  const f = await fixture(t, { x: '0.0017966222949326038::FLOAT', y: '0.008864::FLOAT' });
  const sql = buildOvertureQuery({ release: '2026-09-23.1', lat: 0, lng: 0, radiusKm: 1, parquetPaths: [asset] });
  const expected = (await f.conn.runAndReadAll(sql.replaceAll(`'${asset}'`, `'${f.file}'`))).getRowObjectsJson();
  assert.equal(expected.length, 600, 'the actual product SQL accepts this boundary');
  const tempDir = path.join(f.dir, 'float-boundary'); fs.mkdirSync(tempDir);
  const result = await native.prefetchOvertureParquet({ conn: f.conn, paths: [asset],
    window: { lat: 0, lng: 0, radiusKm: 1 }, distanceFilter: 'sample-radius-v1', tempDir, fetcher: f.fetcher });
  const actual = (await f.conn.runAndReadAll(native.localizeOvertureSql(sql, result.sqlPaths))).getRowObjectsJson();
  assert.deepEqual(actual, expected);
});

test('cancelling radius-filtered acquisition after a real HTTP chunk removes the partial materialization', async t => {
  const f = await fixture(t, { x: '(12.001)::FLOAT', y: '(40.001)::FLOAT' });
  const metadata = (await f.conn.runAndReadAll(`SELECT * FROM parquet_metadata('${f.file}')`)).getRowObjectsJson();
  const id = metadata.find(row => row.row_group_id === '0' && row.path_in_schema === 'id');
  const offset = Number(id.dictionary_page_offset || id.data_page_offset);
  const controller = new AbortController(); let readChunk = false;
  const tempDir = path.join(f.dir, 'cancel-radius'); fs.mkdirSync(tempDir);
  await assert.rejects(native.prefetchOvertureParquet({ conn: f.conn, paths: [asset], window: { lat: 40, lng: 12, radiusKm: 5 },
    distanceFilter: 'sample-radius-v1', tempDir, signal: controller.signal, fetcher: async (url, options) => {
      const response = await f.fetcher(url, options);
      const range = options.headers?.Range?.match(/^bytes=(\d+)-(\d+)$/);
      if (range && Number(range[1]) <= offset && Number(range[2]) >= offset) { readChunk = true; controller.abort(); }
      return response;
    } }), /cancelled|abort/i);
  assert.equal(readChunk, true, 'abort must occur after real data acquisition starts');
  assert.deepEqual(fs.readdirSync(tempDir), []);
});

test('invalid sample-radius contracts fail before any source traffic', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'parranda-radius-validation-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  let calls = 0;
  const plan = { paths: [asset], window: { lat: 40, lng: 12, radiusKm: 5 }, distanceFilter: 'unknown-metric' };
  assert.throws(() => native.validateOverturePrefetchPlan(plan), /invalid_overture/);
  await assert.rejects(native.prefetchOvertureParquet({ ...plan, conn: {}, tempDir: dir,
    fetcher: async () => { calls++; throw Error('unexpected_traffic'); } }), /invalid_overture/);
  assert.equal(calls, 0);
  assert.deepEqual(fs.readdirSync(dir), []);
});

test('native license projection preserves the complete ordered SQL result without transferring unused source fields', async t => {
  const f=await fixture(t),tempDir=path.join(f.dir,'license-only');fs.mkdirSync(tempDir);
  const result=await native.prefetchOvertureParquet({conn:f.conn,paths:[asset],window:{lat:40,lng:12,radiusKm:5},tempDir,fetcher:f.fetcher});
  const sql=buildOvertureQuery({release:'2026-09-23.1',lat:40,lng:12,parquetPaths:[asset]});
  const expected=(await f.conn.runAndReadAll(sql.replaceAll(`'${asset}'`,`'${f.file}'`))).getRowObjectsJson();
  const actual=(await f.conn.runAndReadAll(native.localizeOvertureSql(sql,result.sqlPaths))).getRowObjectsJson();
  assert.deepEqual(actual,expected);
  const metadata=(await f.conn.runAndReadAll(`SELECT * FROM parquet_metadata('${f.file}')`)).getRowObjectsJson();
  const unnecessary=metadata.find(row=>row.row_group_id==='0'&&row.path_in_schema==='sources, list, element, record_id');
  const start=Number(unnecessary.dictionary_page_offset||unnecessary.data_page_offset);
  assert.ok(!f.requests.some(range=>range.start<=start&&range.end>=start),'unused source fields must not consume the native acquisition budget');
});

test('DOUBLE and dateline windows retain the exact ordered sample, including groups without usable spatial statistics', async t => {
  for (const mode of ['double', 'dateline', 'unknown']) await t.test(mode, async t => {
    const dateline = mode !== 'double';
    const x = !dateline
      ? '(CASE WHEN i<2048 OR (i>=4096 AND i<6144) THEN 12.0+(i%20)*0.0001 ELSE 50.0 END)::DOUBLE'
      : `(CASE WHEN i<2048 THEN 179.99 WHEN i>=4096 AND i<6144 THEN -179.99 ELSE ${mode === 'unknown' ? "'NaN'::DOUBLE" : '0.0'} END)::DOUBLE`;
    const f = await fixture(t, { x, y: dateline ? '0.0::DOUBLE' : '(40.0+(i%10)*0.0001)::DOUBLE' });
    const tempDir = path.join(f.dir, 'sparse'); fs.mkdirSync(tempDir);
    const window = { lat: dateline ? 0 : 40, lng: dateline ? 179.99 : 12, radiusKm: 5 };
    const result = await native.prefetchOvertureParquet({ conn: f.conn, paths: [asset], window, distanceFilter: 'sample-radius-v1', tempDir, fetcher: f.fetcher });
    const sql = buildOvertureQuery({ release: '2026-09-23.1', ...window, parquetPaths: [asset] });
    const expected = (await f.conn.runAndReadAll(sql.replaceAll(`'${asset}'`, `'${f.file}'`))).getRowObjectsJson();
    const actual = (await f.conn.runAndReadAll(native.localizeOvertureSql(sql, result.sqlPaths))).getRowObjectsJson();
    assert.equal(actual.length, 600); assert.deepEqual(actual, expected);
    if (mode === 'unknown') {
      const metadata = (await f.conn.runAndReadAll(`SELECT * FROM parquet_metadata('${f.file}')`)).getRowObjectsJson();
      const uncertain = metadata.find(row => row.row_group_id === '1' && row.path_in_schema === 'bbox, xmin');
      assert.ok(!Number.isFinite(Number(uncertain.stats_min_value)) || uncertain.stats_min_value === null);
      const id = metadata.find(row => row.row_group_id === '1' && row.path_in_schema === 'id');
      const start = Number(id.dictionary_page_offset || id.data_page_offset);
      assert.ok(f.requests.some(range => range.start <= start && range.end >= start), 'unknown spatial statistics must retain the whole group');
    }
  });
});

test('metadata selects both sides of a dateline window and keeps every overlapping group', () => {
  assert.equal(typeof native.selectOvertureChunkRanges,'function');
  const row=(group,name,min,max,column)=>({ row_group_id:String(group),row_group_num_columns:'3',column_id:String(column),path_in_schema:name,stats_min_value:String(min),stats_max_value:String(max),data_page_offset:String(20+group*100+column*20),dictionary_page_offset:null,total_compressed_size:'10',bloom_filter_offset:null,bloom_filter_length:null });
  const metadata=[...[[179.98,179.99],[-179.99,-179.98],[0,1]].entries()].flatMap(([g,[lo,hi]])=>[row(g,'bbox, xmin',lo,hi,0),row(g,'bbox, ymin',0,0,1),row(g,'id',g,g,2)]);
  const ranges=native.selectOvertureChunkRanges(metadata,{lat:0,lng:179.99,radiusKm:5},1000);
  assert.ok(ranges.some(r=>r.start===20)); assert.ok(ranges.some(r=>r.start===120));
  assert.ok(!ranges.some(r=>r.start>=220));
});

test('legacy index pages are included at the exact chunk start used by the pinned DuckDB reader', () => {
  const rows = [
    { row_group_id: '0', path_in_schema: 'bbox, xmin', stats_min_value: '12', stats_max_value: '12', data_page_offset: '200', total_compressed_size: '10' },
    { row_group_id: '0', path_in_schema: 'bbox, ymin', stats_min_value: '40', stats_max_value: '40', data_page_offset: '220', total_compressed_size: '10' },
    { row_group_id: '0', path_in_schema: 'id', dictionary_page_offset: '80', data_page_offset: '100', index_page_offset: '60', total_compressed_size: '60' },
  ];
  const ranges = native.selectOvertureChunkRanges(rows, { lat: 40, lng: 12, radiusKm: 5 }, 1000);
  assert.deepEqual(ranges[0], { start: 60, end: 119 });
});

test('identity verification rejects weak validators, noncanonical assets and invalid lengths', async () => {
  assert.equal(typeof native.readOvertureAssetIdentity,'function');
  for(const headers of [{etag:'W/"weak"','content-length':'100'},{etag:'"has space"','content-length':'100'}, {etag:'"'+'a'.repeat(201)+'"','content-length':'100'}, {etag:'"ok"','content-length':'0'},{etag:'"ok"','content-length':'9007199254740992'}]) {
    await assert.rejects(native.readOvertureAssetIdentity(asset,{fetcher:async()=>new Response(null,{headers})}));
  }
  let calls=0;
  await assert.rejects(native.readOvertureAssetIdentity(asset+'?x=1',{fetcher:async()=>{calls++;}}));
  assert.equal(calls,0);
  await assert.rejects(native.readOvertureAssetIdentity(asset, { deadlineMs: Date.now() - 1, fetcher: async () => { calls++; } }));
  assert.equal(calls, 0, 'expired verification must not start traffic');
});

test('combined sparse allocation is refused before projected chunks are fetched across assets', async t => {
  const f = await fixture(t);
  const control = path.join(f.dir, 'control'); fs.mkdirSync(control);
  const first = await native.prefetchOvertureParquet({ conn: f.conn, paths: [asset], window: { lat: 40, lng: 12, radiusKm: 5 }, tempDir: control, fetcher: f.fetcher });
  const directory = path.join(f.dir, 'combined'); fs.mkdirSync(directory);
  const before = f.requests.length;
  const other = asset.replace('00001', '00002');
  await assert.rejects(native.prefetchOvertureParquet({ conn: f.conn, paths: [asset, other], window: { lat: 40, lng: 12, radiusKm: 5 }, tempDir: directory, fetcher: f.fetcher, maxPhysicalBytes: first.physicalBytes + 4096 }), /budget/);
  assert.deepEqual(fs.readdirSync(directory), []);
  const metadata = (await f.conn.runAndReadAll(`SELECT * FROM parquet_metadata('${f.file}')`)).getRowObjectsJson();
  const id = metadata.find(row => row.row_group_id === '0' && row.path_in_schema === 'id');
  const start = Number(id.dictionary_page_offset || id.data_page_offset);
  assert.ok(!f.requests.slice(before).some(range => range.start <= start && range.end >= start), 'aggregate overflow must fail before projected chunk acquisition');
});

test('changed source, whole-body response, wrong range, truncation and oversized body fail closed', async t => {
  assert.equal(typeof native.prefetchOvertureParquet,'function');
  const f=await fixture(t);
  for(const mode of ['changed','whole','wrong-range','truncated','oversized']) {
    const tempDir=path.join(f.dir,mode);fs.mkdirSync(tempDir);
    const fetcher=async(_url,init)=>{
      if(init.method==='HEAD')return new Response(null,{headers:{etag:'"fixture-v1"','content-length':String(f.bytes.length)}});
      const [,a,b]=init.headers.Range.match(/bytes=(\d+)-(\d+)/),start=Number(a),end=Number(b);
      let bytes=f.bytes.subarray(start,end+1);
      if(mode==='truncated')bytes=bytes.subarray(0,bytes.length-1);
      if(mode==='oversized')bytes=Buffer.concat([bytes,Buffer.from([0])]);
      return new Response(bytes,{status:mode==='whole'?200:206,headers:{etag:mode==='changed'?'"fixture-v2"':'"fixture-v1"','content-range':`bytes ${mode==='wrong-range'?start+1:start}-${end}/${f.bytes.length}`,'content-length':String(end-start+1)}});
    };
    await assert.rejects(native.prefetchOvertureParquet({conn:f.conn,paths:[asset],window:{lat:40,lng:12,radiusKm:5},tempDir,fetcher}),undefined,mode);
    assert.deepEqual(fs.readdirSync(tempDir),[],mode+' must remove partial materialization');
  }
});

test('physical block budget and cancellation stop prefetch without leaving partial source files', async t => {
  assert.equal(typeof native.prefetchOvertureParquet,'function');
  const f=await fixture(t);
  const tempDir=path.join(f.dir,'bounded');fs.mkdirSync(tempDir);
  await assert.rejects(native.prefetchOvertureParquet({conn:f.conn,paths:[asset],window:{lat:40,lng:12,radiusKm:5},tempDir,fetcher:f.fetcher,maxPhysicalBytes:4096}),/budget/);
  assert.deepEqual(fs.readdirSync(tempDir),[]);
  const controller=new AbortController();let began=false;
  const cancelled=native.prefetchOvertureParquet({conn:f.conn,paths:[asset],window:{lat:40,lng:12,radiusKm:5},tempDir,signal:controller.signal,fetcher:async(_url,{signal})=>{began=true;return new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(new Error('cancelled')),{once:true}));}});
  controller.abort();await assert.rejects(cancelled);assert.ok(began);assert.deepEqual(fs.readdirSync(tempDir),[]);
});

// Coalescing is an optional transport optimization. It must not spend sparse
// pages needed by another asset, or reject an exact original allocation.
test('tight aggregate allocation keeps both original asset plans and their exact SQL results', async t => {
  const f=await fixture(t),metadata=(await f.conn.runAndReadAll(`SELECT * FROM parquet_metadata('${f.file}')`)).getRowObjectsJson();
  const footerLength=f.bytes.readUInt32LE(f.bytes.length-8),footerStart=f.bytes.length-8-footerLength;
  const {projectSourcesLicense}=require('../server/place-candidates/overture-license-footer');
  const projection=projectSourcesLicense(f.bytes.subarray(footerStart,f.bytes.length-8));
  const required=native.selectOvertureChunkRanges(metadata.filter(row=>projection.keepLeaves[Number(row.column_id)]),{lat:40,lng:12,radiusKm:5},f.bytes.length);
  const blocks=new Set();
  for(const r of [{start:0,end:3},{start:footerStart,end:f.bytes.length-1},...required]){
    for(let block=Math.floor(r.start/4096);block<=Math.floor(r.end/4096);block++)blocks.add(block);
  }
  const exact=blocks.size*4096,other=asset.replace('00001','00002'),tempDir=path.join(f.dir,'exact-two-assets');fs.mkdirSync(tempDir);
  const result=await native.prefetchOvertureParquet({conn:f.conn,paths:[asset,other],window:{lat:40,lng:12,radiusKm:5},tempDir,fetcher:f.fetcher,maxPhysicalBytes:exact*2});
  assert.equal(result.sourceAssets.length,2);
  assert.equal(result.physicalBytes,exact*2,'transport cannot borrow the second asset reservation');
  const sql=buildOvertureQuery({release:'2026-09-23.1',lat:40,lng:12,parquetPaths:[asset]});
  const expected=(await f.conn.runAndReadAll(sql.replaceAll(`'${asset}'`,`'${f.file}'`))).getRowObjectsJson();
  for(const source of [asset,other]){
    const actual=(await f.conn.runAndReadAll(native.localizeOvertureSql(sql.replaceAll(asset,source),result.sqlPaths))).getRowObjectsJson();
    assert.deepEqual(actual,expected);
  }
  assert.ok(f.maxActive()<=4,'all segmented transfers retain the concurrency cap');
});

test('one rejected metadata piece promptly cancels sibling reads and never starts queued pieces', async t => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'parranda-footer-cancel-'));
  const identity=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/overture-dense-footer-20261021/identity.json')));
  const footer=require('node:zlib').gunzipSync(fs.readFileSync(path.join(__dirname,'fixtures/overture-dense-footer-20261021/footer.bin.gz')));
  const footerStart=identity.length-footer.length-8,tail=Buffer.alloc(8);tail.writeUInt32LE(footer.length);tail.write('PAR1',4);
  const controller=new AbortController();let pending=0,aborted=0,settled=false,failure;
  const operation=native.prefetchOvertureParquet({conn:{},paths:[identity.path],window:{lat:40,lng:12,radiusKm:5},tempDir:dir,signal:controller.signal,fetcher:async(_url,options)=>{
    if(options.method==='HEAD')return new Response(null,{headers:{etag:identity.etag,'content-length':String(identity.length)}});
    const [,a,b]=options.headers.Range.match(/bytes=(\d+)-(\d+)/),start=Number(a),end=Number(b);
    if(start===footerStart)throw Error('fixture_footer_piece_failed');
    if(start>footerStart&&start!==identity.length-8){pending++;return new Promise((_resolve,reject)=>options.signal.addEventListener('abort',()=>{aborted++;reject(Error('fixture_sibling_cancelled'));},{once:true}));}
    const bytes=start===0?Buffer.from('PAR1'):tail;
    return new Response(bytes,{status:206,headers:{etag:identity.etag,'content-range':`bytes ${start}-${end}/${identity.length}`,'content-length':String(end-start+1)}});
  }}).then(()=>{settled=true},error=>{settled=true;failure=error});
  t.after(async()=>{controller.abort();await operation;fs.rmSync(dir,{recursive:true,force:true});});
  await new Promise(setImmediate);
  assert.equal(settled,true,'metadata failure must not wait for other transfers to time out');
  assert.match(failure.message,/fixture_footer_piece_failed/);
  assert.equal(aborted,pending,'all in-flight siblings must be cancelled');
  assert.ok(pending<=3,'queued metadata chunks must not start after failure');
  assert.deepEqual(fs.readdirSync(dir),[]);
});
