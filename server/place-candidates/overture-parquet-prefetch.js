'use strict';

// Materialize only the projected chunks of every spatially overlapping group.
// Strong, pinned validators prevent combining a footer with another object
// generation. The original SQL, ranking, filters and final sample stay intact.
const fs = require('node:fs');
const path = require('node:path');
const { windowBboxes } = require('./overture-stac-assets');
const { projectSourcesLicense } = require('./overture-license-footer');
const ASSET = /^s3:\/\/overturemaps-us-west-2\/release\/\d{4}-\d{2}-\d{2}\.\d+\/theme=places\/type=place\/part-[A-Za-z0-9_-]+\.zstd\.parquet$/;
const MAX_PHYSICAL_BYTES = 32 * 1024 * 1024;
const MAX_FOOTER_BYTES = 8 * 1024 * 1024;
// Bound each10s transfer, rather than spending it on a multi-MiB footer.
const MAX_RANGE_BYTES = 512 * 1024;
const MAX_RANGE_CONCURRENCY = 4;
// Bridge at most a small fraction of one bounded body. Dense release files
// otherwise spend their45s child budget on hundreds of ~0.65s round trips.
// Every bridged page is still charged to the same32MiB aggregate allowance.
const MAX_RANGE_GAP_BYTES = 64 * 1024;
const PROJECTED = new Set(['id', 'confidence', 'operating_status', 'websites', 'sources']);
const LEAVES = new Set(['names.primary', 'taxonomy.primary', 'taxonomy.hierarchy', 'brand.names.primary', 'bbox.xmin', 'bbox.ymin']);
// Materialize only range-planning fields in the bounded JS child. A release
// can have tens of thousands of metadata rows: SELECT * duplicates unrelated
// statistics/schema fields into JS and exhausts the child's 64MiB heap.
const METADATA_COLUMNS = `row_group_id, row_group_num_rows, column_id, path_in_schema, type,
  CASE WHEN path_in_schema IN ('bbox, xmin', 'bbox, ymin') THEN stats_min_value END AS stats_min_value,
  CASE WHEN path_in_schema IN ('bbox, xmin', 'bbox, ymin') THEN stats_max_value END AS stats_max_value,
  dictionary_page_offset, index_page_offset, data_page_offset, total_compressed_size,
  bloom_filter_offset, bloom_filter_length`;
const METADATA_PATHS = [...PROJECTED, ...LEAVES].map(value => value.replaceAll('.', ', '));
const METADATA_FILTER = METADATA_PATHS.map(value => `(path_in_schema = '${value}' OR starts_with(path_in_schema, '${value}, '))`).join(' OR ');

function assetUrl(value) {
  if (typeof value !== 'string' || !ASSET.test(value)) throw new Error('invalid_overture_asset');
  return value.replace('s3://overturemaps-us-west-2/', 'https://overturemaps-us-west-2.s3.us-west-2.amazonaws.com/');
}
function integer(value, minimum = 0) {
  if (typeof value !== 'number' && (typeof value !== 'string' || !/^\d+$/.test(value))) throw new Error('invalid_overture_metadata');
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < minimum) throw new Error('invalid_overture_metadata');
  return number;
}
function abortCheck(signal) { if (signal?.aborted) throw new Error('overture_cancelled'); }
function operationSignal(signal, deadlineMs) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) controller.abort();
  const timer = setTimeout(abort, Math.min(10000, Number.isFinite(deadlineMs) ? Math.max(1, deadlineMs - Date.now()) : 10000));
  return { signal: controller.signal, close() { clearTimeout(timer); signal?.removeEventListener('abort', abort); controller.abort(); } };
}
async function readOvertureAssetIdentity(assetPath, { fetcher = globalThis.fetch, signal, deadlineMs } = {}) {
  const url = assetUrl(assetPath);
  abortCheck(signal);
  if (Number.isFinite(deadlineMs) && deadlineMs <= Date.now()) throw new Error('overture_cancelled');
  const operation = operationSignal(signal, deadlineMs);
  try {
    const response = await fetcher(url, { method: 'HEAD', redirect: 'error', signal: operation.signal });
    abortCheck(operation.signal);
    if (!response?.ok) throw new Error('overture_identity_failed');
    const etag = response.headers.get('etag');
    if (typeof etag !== 'string' || !/^"[\x21\x23-\x7e]{1,200}"$/.test(etag)) throw new Error('overture_identity_failed');
    const length = integer(response.headers.get('content-length'), 12);
    return { path: assetPath, etag, length };
  } finally { operation.close(); }
}
async function parallel(items, concurrency, action) {
  const results = new Array(items.length); let cursor = 0, failed = false, failure;
  await Promise.allSettled(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    for (;;) {
      const index = cursor++; if (index >= items.length) return;
      try { results[index] = await action(items[index], index); }
      catch (error) { if (!failed) { failed = true; failure = error; } throw error; }
    }
  }));
  if (failed) throw failure;
  return results;
}
async function inspectOvertureAssets(paths, options = {}) {
  if (!Array.isArray(paths) || !paths.length || paths.length > 64 || new Set(paths).size !== paths.length) throw new Error('invalid_overture_assets');
  paths.forEach(assetUrl);
  return parallel(paths, 4, assetPath => readOvertureAssetIdentity(assetPath, options));
}
function validateOverturePrefetchPlan(plan) {
  if (!plan || !Array.isArray(plan.paths) || !plan.paths.length || plan.paths.length > 64 || new Set(plan.paths).size !== plan.paths.length) throw new Error('invalid_overture_assets');
  plan.paths.forEach(assetUrl); windowBboxes(plan.window);
  if (new Set(plan.paths.map(value => value.split('/')[4])).size !== 1) throw new Error('invalid_overture_release');
  validateDistanceFilter(plan.distanceFilter);
  return { paths: [...plan.paths], window: { lat: plan.window.lat, lng: plan.window.lng, radiusKm: plan.window.radiusKm },
    ...(plan.distanceFilter ? { distanceFilter: plan.distanceFilter } : {}) };
}
// Private opt-in from buildOvertureQuery's owner, never an assumption about
// arbitrary SQL passed to the generic rectangular sparse reader.
function validateDistanceFilter(value) {
  if (value !== undefined && value !== 'sample-radius-v1') throw new Error('invalid_overture_distance_filter');
}
function projected(name) {
  const parts = name.split(',').map(part => part.trim());
  // LIST physical wrappers are not part of the logical field projection.
  const logical = parts.filter(part => part !== 'list' && part !== 'element').join('.');
  return PROJECTED.has(parts[0]) || [...LEAVES].some(leaf => logical === leaf || logical.startsWith(leaf + '.'));
}
function numericStat(row, field) {
  const raw = row?.[field];
  return raw === null || raw === undefined || raw === '' || !Number.isFinite(Number(raw)) ? null : Number(raw);
}
// Lower bound for the sample SQL's actual arithmetic, including FLOAT
// subtraction/modulo before DOUBLE pow/sqrt. A DOUBLE-only geometric bound
// can wrongly exclude a FLOAT row accepted by that unchanged SQL.
function sampleAxisMinimum(row, min, max, anchor, scale, wrap) {
  if (min === null || max === null || min > max || min < (wrap ? -180 : -90) || max > (wrap ? 180 : 90)
    || !['FLOAT', 'DOUBLE'].includes(row?.type)) return null;
  const round = row.type === 'FLOAT' ? Math.fround : value => value;
  const epsilon = row.type === 'FLOAT' ? 2 ** -23 : Number.EPSILON;
  // DuckDB exposes shortest round-trip numeric statistics. Expand outwards
  // by at least one physical ULP so conversion cannot tighten their bounds.
  const lo = round(min - epsilon * Math.max(1, Math.abs(min)));
  const hi = round(max + epsilon * Math.max(1, Math.abs(max)));
  const a = round(Number(anchor.toFixed(7))), k = round(scale);
  let low = round(lo - a), high = round(hi - a);
  if (wrap) {
    low = round(low + 540); high = round(high + 540);
    // The interval is within [180,900] (plus outward ULPs). Modulo seams
    // at360k maximize |delta|; only180+360k can introduce a new minimum.
    if ([180, 540, 900].some(zero => low <= zero && high >= zero)) return 0;
    const delta = value => round(round(value % 360) - 180);
    return round(Math.min(Math.abs(delta(low)), Math.abs(delta(high))) * k);
  }
  if (low <= 0 && high >= 0) return 0;
  return Math.min(Math.abs(round(low * k)), Math.abs(round(high * k)));
}
function outsideSampleRadius(x, y, xmin, xmax, ymin, ymax, window) {
  const lngScale = Number((111.32 * Math.max(0.01, Math.abs(Math.cos(window.lat * Math.PI / 180)))).toFixed(7));
  const dx = sampleAxisMinimum(x, xmin, xmax, window.lng, lngScale, true);
  const dy = sampleAxisMinimum(y, ymin, ymax, window.lat, 110.574, false);
  // Missing/invalid/unsupported statistics cannot prove exclusion. Numeric
  // min/max need only enclose values; optional exactness flags are not needed.
  return dx !== null && dy !== null
    && Math.hypot(dx, dy) > Number(window.radiusKm.toFixed(3)) + 1e-7;
}
function overlappingGroups(metadata, window, distanceFilter) {
  const windows = windowBboxes(window), groups = new Map();
  for (const row of metadata) {
    const group = String(row.row_group_id);
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(row);
  }
  const selected = new Set();
  for (const [group, rows] of groups) {
    const find = name => rows.find(row => row.path_in_schema.split(',').map(s => s.trim()).join('.') === name);
    const x = find('bbox.xmin'), y = find('bbox.ymin');
    const xmin = numericStat(x, 'stats_min_value'), xmax = numericStat(x, 'stats_max_value');
    const ymin = numericStat(y, 'stats_min_value'), ymax = numericStat(y, 'stats_max_value');
    if (windows.some(([west, south, east, north]) =>
      (xmin === null || xmax === null || (xmin <= east && xmax >= west))
      && (ymin === null || ymax === null || (ymin <= north && ymax >= south)))
      && (!distanceFilter || !outsideSampleRadius(x, y, xmin, xmax, ymin, ymax, window))) selected.add(group);
  }
  return { groups, selected };
}
function selectOvertureChunkRanges(metadata, window, fileLength, { distanceFilter } = {}) {
  integer(fileLength, 12);
  validateDistanceFilter(distanceFilter);
  const { groups, selected } = overlappingGroups(metadata, window, distanceFilter);
  const ranges = [];
  const add = (offset, length) => {
    const start = integer(offset), size = integer(length, 1), end = start + size - 1;
    if (!Number.isSafeInteger(end) || end >= fileLength) throw new Error('invalid_overture_metadata');
    ranges.push({ start, end });
  };
  for (const [group, rows] of groups) {
    if (!selected.has(group)) continue;
    for (const row of rows) {
      if (!projected(row.path_in_schema)) continue;
      const offsets = [row.dictionary_page_offset, row.index_page_offset, row.data_page_offset].filter(value => value !== null && value !== undefined).map(value => integer(value));
      if (!offsets.length) throw new Error('invalid_overture_metadata');
      add(Math.min(...offsets), row.total_compressed_size);
      for (const [offsetField, sizeField] of [['bloom_filter_offset', 'bloom_filter_length'], ['column_index_offset', 'column_index_length'], ['offset_index_offset', 'offset_index_length']]) {
        if (row[offsetField] !== null && row[offsetField] !== undefined) {
          if (row[sizeField] === null || row[sizeField] === undefined) throw new Error('invalid_overture_metadata');
          add(row[offsetField], row[sizeField]);
        }
      }
    }
  }
  ranges.sort((a, b) => a.start - b.start);
  return ranges.reduce((merged, range) => {
    const last = merged[merged.length - 1];
    if (last && range.start <= last.end + 1) last.end = Math.max(last.end, range.end);
    else merged.push({ ...range });
    return merged;
  }, []);
}
function varint(value) {
  let remaining = BigInt(value); const bytes = [];
  do { let byte = Number(remaining & 127n); remaining >>= 7n; if (remaining) byte |= 128; bytes.push(byte); } while (remaining);
  return Buffer.from(bytes);
}
// Parquet footers use Thrift Compact Protocol. Copy every unknown field and
// selected RowGroup byte-for-byte; change only the root row count and list.
// This makes optimizer pruning order irrelevant, including decimal cast paths.
function pruneFooter(footer, selected, rowCount) {
  let offset = 0, operations = 0;
  // Every byte read advances the cursor; a zero-length binary adds at most
  // one extra check after its length byte. Keep work linear in the already
  // byte-capped footer rather than rejecting a valid >2M-operation footer.
  const maxOperations = Math.max(2000000, footer.length * 2 + 1);
  const ensure = size => { if (++operations > maxOperations || size < 0 || offset + size > footer.length) throw new Error('invalid_overture_footer'); };
  const byte = () => { ensure(1); return footer[offset++]; };
  const readVarint = () => {
    let result = 0n, shift = 0n;
    for (let n = 0; n < 10; n++) { const value = byte(); result |= BigInt(value & 127) << shift; if (!(value & 128)) return result; shift += 7n; }
    throw new Error('invalid_overture_footer');
  };
  const count = () => { const value = readVarint(); if (value > BigInt(footer.length)) throw new Error('invalid_overture_footer'); return Number(value); };
  const listHeader = () => { const header = byte(); return { type: header & 15, length: header >> 4 === 15 ? count() : header >> 4 }; };
  function skip(type, depth, collection = false) {
    if (depth > 64) throw new Error('invalid_overture_footer');
    if (type === 1 || type === 2) { if (collection) byte(); }
    else if (type === 3) byte();
    else if (type >= 4 && type <= 6) readVarint();
    else if (type === 7) { ensure(8); offset += 8; }
    else if (type === 8) { const size = count(); ensure(size); offset += size; }
    else if (type === 9 || type === 10) { const list = listHeader(); for (let i = 0; i < list.length; i++) skip(list.type, depth + 1, true); }
    else if (type === 11) { const size = count(); if (size) { const types = byte(); for (let i = 0; i < size; i++) { skip(types >> 4, depth + 1, true); skip(types & 15, depth + 1, true); } } }
    else if (type === 12) { for (;;) { const field = byte(); if (!field) break; if (!(field >> 4)) readVarint(); skip(field & 15, depth + 1); } }
    else throw new Error('invalid_overture_footer');
  }
  const output = []; let lastField = 0, sawRows = false, sawGroups = false;
  for (;;) {
    const start = offset, header = byte();
    if (!header) { output.push(footer.subarray(start, offset)); break; }
    const type = header & 15;
    let field;
    if (header >> 4) field = lastField + (header >> 4);
    else { const encoded = readVarint(); field = Number((encoded >> 1n) ^ -(encoded & 1n)); }
    lastField = field;
    const valueStart = offset;
    if (field === 3) {
      if (type !== 6) throw new Error('invalid_overture_footer');
      readVarint(); output.push(footer.subarray(start, valueStart), varint(BigInt(rowCount) * 2n)); sawRows = true;
    } else if (field === 4) {
      if (type !== 9) throw new Error('invalid_overture_footer');
      const list = listHeader(); if (list.type !== 12) throw new Error('invalid_overture_footer');
      const kept = [];
      for (let group = 0; group < list.length; group++) { const groupStart = offset; skip(12, 1); if (selected.has(String(group))) kept.push(footer.subarray(groupStart, offset)); }
      if (kept.length !== selected.size) throw new Error('invalid_overture_footer');
      const listBytes = kept.length < 15 ? Buffer.from([(kept.length << 4) | 12]) : Buffer.concat([Buffer.from([252]), varint(kept.length)]);
      output.push(footer.subarray(start, valueStart), listBytes, ...kept); sawGroups = true;
    } else { skip(type, 0); output.push(footer.subarray(start, offset)); }
  }
  if (offset !== footer.length || !sawRows || !sawGroups) throw new Error('invalid_overture_footer');
  return Buffer.concat(output);
}
async function fetchRange(identity, start, end, fetcher, signal) {
  abortCheck(signal);
  const operation = operationSignal(signal);
  try {
    const expected = end - start + 1;
    const response = await fetcher(assetUrl(identity.path), { signal: operation.signal, redirect: 'error', headers: { Range: `bytes=${start}-${end}`, 'If-Match': identity.etag } });
    if (response?.status !== 206 || response.headers.get('etag') !== identity.etag
      || response.headers.get('content-range') !== `bytes ${start}-${end}/${identity.length}`
      || integer(response.headers.get('content-length'), 1) !== expected) throw new Error('overture_range_failed');
    const reader = response.body?.getReader();
    if (!reader) throw new Error('overture_range_failed');
    const chunks = []; let size = 0;
    try {
      for (;;) {
        abortCheck(operation.signal);
        const { value, done } = await reader.read(); if (done) break;
        size += value.byteLength; if (size > expected) throw new Error('overture_range_failed');
        chunks.push(Buffer.from(value));
      }
    } finally { await reader.cancel().catch(() => {}); }
    abortCheck(operation.signal);
    if (size !== expected) throw new Error('overture_range_failed');
    return Buffer.concat(chunks, size);
  } finally { operation.close(); }
}
function allocatedBytes(files) { return files.reduce((sum, file) => sum + fs.statSync(file).blocks * 512, 0); }
function allocationBytes(ranges) {
  const blocks = ranges.map(({ start, end }) => ({ start: Math.floor(start / 4096), end: Math.floor(end / 4096) })).sort((a, b) => a.start - b.start);
  let total = 0, lastEnd = -1;
  for (const block of blocks) { if (block.end > lastEnd) total += block.end - Math.max(block.start - 1, lastEnd); lastEnd = Math.max(lastEnd, block.end); }
  return total * 4096;
}
function splitRanges(ranges) {
  return ranges.flatMap(({ start, end }) => {
    const pieces = [];
    for (let offset = start; offset <= end; offset += MAX_RANGE_BYTES) {
      pieces.push({ start: offset, end: Math.min(end, offset + MAX_RANGE_BYTES - 1) });
    }
    return pieces;
  });
}
function coalesceRanges(ranges) {
  const merged = [];
  for (const range of ranges) {
    const last = merged[merged.length - 1];
    if (last && range.start - last.end - 1 <= MAX_RANGE_GAP_BYTES
      && range.end - last.start + 1 <= MAX_RANGE_BYTES) last.end = range.end;
    else merged.push({ ...range });
  }
  return merged;
}
function localizeOvertureSql(sql, paths) {
  let localized = sql;
  for (const [assetPath, localPath] of paths) localized = localized.replaceAll(`'${assetPath}'`, `'${localPath.replace(/'/g, "''")}'`);
  return localized;
}
async function prefetchOvertureParquet({ conn, paths, window, distanceFilter, tempDir, fetcher = globalThis.fetch, signal, maxPhysicalBytes = MAX_PHYSICAL_BYTES, concurrency = MAX_RANGE_CONCURRENCY }) {
  validateDistanceFilter(distanceFilter);
  windowBboxes(window);
  const budget = Math.min(MAX_PHYSICAL_BYTES, integer(maxPhysicalBytes, 1));
  const controller = new AbortController(), abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true }); if (signal?.aborted) abort();
  const files = [], descriptors = [], sqlPaths = new Map();
  const checkBudget = () => { if (allocatedBytes(files) > budget) throw new Error('overture_prefetch_budget'); };
  try {
    const sourceAssets = await inspectOvertureAssets(paths, { fetcher, signal: controller.signal });
    const tasks = [], plans = []; let plannedBytes = 0;
    for (const [index, identity] of sourceAssets.entries()) {
      abortCheck(controller.signal);
      const file = path.join(tempDir, `overture-${index}-metadata.parquet`), fd = fs.openSync(file, 'wx');
      files.push(file); descriptors.push(fd); fs.ftruncateSync(fd, identity.length);
      const tail = await fetchRange(identity, identity.length - 8, identity.length - 1, fetcher, controller.signal);
      if (tail.subarray(4).toString('ascii') !== 'PAR1') throw new Error('invalid_overture_parquet');
      const footerLength = tail.readUInt32LE(0);
      if (!footerLength || footerLength > MAX_FOOTER_BYTES || footerLength + 12 > identity.length) throw new Error('overture_prefetch_budget');
      const footerStart = identity.length - 8 - footerLength;
      const metadataRanges = [{ start: 0, end: 3 }, { start: footerStart, end: identity.length - 1 }];
      if (plannedBytes + allocationBytes(metadataRanges) > budget) throw new Error('overture_prefetch_budget');
      const metadataPieces = await parallel([{ start: 0, end: 3 }, ...splitRanges([{ start: footerStart, end: identity.length - 9 }])],
        Math.min(MAX_RANGE_CONCURRENCY, integer(concurrency, 1)), async range => {
          try { return await fetchRange(identity, range.start, range.end, fetcher, controller.signal); }
          catch (error) { controller.abort(); throw error; }
        });
      const header = metadataPieces.shift(), footer = Buffer.concat(metadataPieces, footerLength);
      if (header.toString('ascii') !== 'PAR1') throw new Error('invalid_overture_parquet');
      fs.writeSync(fd, header, 0, header.length, 0); fs.writeSync(fd, footer, 0, footer.length, footerStart); fs.writeSync(fd, tail, 0, tail.length, identity.length - 8); checkBudget();
      const escaped = file.replace(/'/g, "''");
      const metadata = (await conn.runAndReadAll(`SELECT ${METADATA_COLUMNS} FROM parquet_metadata('${escaped}') WHERE ${METADATA_FILTER}`)).getRowObjectsJson();
      const { groups, selected } = overlappingGroups(metadata, window, distanceFilter);
      let localFooter = footer, projectedMetadata = metadata;
      if (selected.size !== groups.size) {
        const rowCount = integer([...selected].reduce((sum, group) => sum + integer(groups.get(group)[0].row_group_num_rows), 0));
        localFooter = pruneFooter(footer, selected, rowCount);
      }
      // DuckDB reads every leaf of a LIST-of-STRUCT lambda even though the
      // published query uses only licenses. Narrow the private schema, never
      // the original object or the source facts returned by the query.
      if (metadata.some(row => row.path_in_schema.startsWith('sources,')
        && row.path_in_schema !== 'sources, list, element, license')) {
        const projection = projectSourcesLicense(localFooter);
        localFooter = projection.footer;
        projectedMetadata = metadata.filter(row => projection.keepLeaves[integer(row.column_id)]);
      }
      if (localFooter !== footer) {
        if (localFooter.length > footer.length) throw new Error('invalid_overture_footer');
        const localTail = Buffer.from(tail); localTail.writeUInt32LE(localFooter.length, 0);
        fs.writeSync(fd, localFooter, 0, localFooter.length, identity.length - 8 - localFooter.length);
        fs.writeSync(fd, localTail, 0, localTail.length, identity.length - 8);
      }
      const ranges = selectOvertureChunkRanges(projectedMetadata, window, identity.length, { distanceFilter });
      // Page allocation rather than transfer length is the shared disk budget.
      plannedBytes += allocationBytes([...metadataRanges, ...ranges]);
      if (plannedBytes > budget) throw new Error('overture_prefetch_budget');
      plans.push({ identity, ranges, metadataRanges, fd });
      // DuckDB's external-file cache may retain the original footer. Publish
      // the derived file under a new private name that it has never inspected.
      const finalFile = path.join(tempDir, `overture-${index}.parquet`);
      fs.renameSync(file, finalFile); files[files.indexOf(file)] = finalFile;
      sqlPaths.set(identity.path, finalFile);
    }
    // Reserve the exact original plan for EVERY asset before spending spare
    // allocation on short gaps. Optimization cannot starve a later asset or
    // turn an otherwise admissible query into a disk-budget failure.
    for (const plan of plans) {
      const merged = coalesceRanges(plan.ranges);
      const extra = allocationBytes([...plan.metadataRanges, ...merged])
        - allocationBytes([...plan.metadataRanges, ...plan.ranges]);
      const ranges = extra <= budget - plannedBytes ? merged : plan.ranges;
      if (ranges === merged) plannedBytes += extra;
      for (const range of splitRanges(ranges)) tasks.push({ identity: plan.identity, range, fd: plan.fd });
    }
    await parallel(tasks, Math.min(MAX_RANGE_CONCURRENCY, integer(concurrency, 1)), async ({ identity, range, fd }) => {
      try {
        const bytes = await fetchRange(identity, range.start, range.end, fetcher, controller.signal);
        abortCheck(controller.signal); fs.writeSync(fd, bytes, 0, bytes.length, range.start); checkBudget();
      } catch (error) { controller.abort(); throw error; }
    });
    abortCheck(controller.signal); checkBudget();
    return { sqlPaths, sourceAssets, physicalBytes: allocatedBytes(files) };
  } catch (error) {
    controller.abort();
    for (const file of files) { try { fs.unlinkSync(file); } catch (_) {} }
    throw error;
  } finally {
    signal?.removeEventListener('abort', abort);
    for (const fd of descriptors) { try { fs.closeSync(fd); } catch (_) {} }
  }
}
module.exports = { prefetchOvertureParquet, readOvertureAssetIdentity, inspectOvertureAssets, localizeOvertureSql, selectOvertureChunkRanges, validateOverturePrefetchPlan };
