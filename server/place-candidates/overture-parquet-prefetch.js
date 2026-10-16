'use strict';

// Materialize only the projected chunks of every spatially overlapping group.
// Strong, pinned validators prevent combining a footer with another object
// generation. The original SQL, ranking, filters and final sample stay intact.
const fs = require('node:fs');
const path = require('node:path');
const { windowBboxes } = require('./overture-stac-assets');
const ASSET = /^s3:\/\/overturemaps-us-west-2\/release\/\d{4}-\d{2}-\d{2}\.\d+\/theme=places\/type=place\/part-[A-Za-z0-9_-]+\.zstd\.parquet$/;
const MAX_PHYSICAL_BYTES = 32 * 1024 * 1024;
const MAX_FOOTER_BYTES = 8 * 1024 * 1024;
const PROJECTED = new Set(['id', 'confidence', 'operating_status', 'websites', 'sources']);
const LEAVES = new Set(['names.primary', 'taxonomy.primary', 'taxonomy.hierarchy', 'brand.names.primary', 'bbox.xmin', 'bbox.ymin']);

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
  const results = new Array(items.length); let cursor = 0;
  const settled = await Promise.allSettled(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    for (;;) { const index = cursor++; if (index >= items.length) return; results[index] = await action(items[index], index); }
  }));
  const failure = settled.find(result => result.status === 'rejected');
  if (failure) throw failure.reason;
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
  return { paths: [...plan.paths], window: { lat: plan.window.lat, lng: plan.window.lng, radiusKm: plan.window.radiusKm } };
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
function overlappingGroups(metadata, window) {
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
      && (ymin === null || ymax === null || (ymin <= north && ymax >= south)))) selected.add(group);
  }
  return { groups, selected };
}
function selectOvertureChunkRanges(metadata, window, fileLength) {
  integer(fileLength, 12);
  const { groups, selected } = overlappingGroups(metadata, window);
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
  const ensure = size => { if (++operations > 2000000 || size < 0 || offset + size > footer.length) throw new Error('invalid_overture_footer'); };
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
function localizeOvertureSql(sql, paths) {
  let localized = sql;
  for (const [assetPath, localPath] of paths) localized = localized.replaceAll(`'${assetPath}'`, `'${localPath.replace(/'/g, "''")}'`);
  return localized;
}
async function prefetchOvertureParquet({ conn, paths, window, tempDir, fetcher = globalThis.fetch, signal, maxPhysicalBytes = MAX_PHYSICAL_BYTES, concurrency = 4 }) {
  windowBboxes(window);
  const budget = Math.min(MAX_PHYSICAL_BYTES, integer(maxPhysicalBytes, 1));
  const controller = new AbortController(), abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true }); if (signal?.aborted) abort();
  const files = [], descriptors = [], sqlPaths = new Map();
  const checkBudget = () => { if (allocatedBytes(files) > budget) throw new Error('overture_prefetch_budget'); };
  try {
    const sourceAssets = await inspectOvertureAssets(paths, { fetcher, signal: controller.signal });
    const tasks = []; let plannedBytes = 0;
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
      const [header, footer] = await Promise.all([fetchRange(identity, 0, 3, fetcher, controller.signal), fetchRange(identity, footerStart, identity.length - 9, fetcher, controller.signal)]);
      if (header.toString('ascii') !== 'PAR1') throw new Error('invalid_overture_parquet');
      fs.writeSync(fd, header, 0, header.length, 0); fs.writeSync(fd, footer, 0, footer.length, footerStart); fs.writeSync(fd, tail, 0, tail.length, identity.length - 8); checkBudget();
      const escaped = file.replace(/'/g, "''");
      const metadata = (await conn.runAndReadAll(`SELECT * FROM parquet_metadata('${escaped}')`)).getRowObjectsJson();
      const { groups, selected } = overlappingGroups(metadata, window);
      if (selected.size !== groups.size) {
        const rowCount = integer([...selected].reduce((sum, group) => sum + integer(groups.get(group)[0].row_group_num_rows), 0));
        const localFooter = pruneFooter(footer, selected, rowCount);
        if (localFooter.length > footer.length) throw new Error('invalid_overture_footer');
        const localTail = Buffer.from(tail); localTail.writeUInt32LE(localFooter.length, 0);
        fs.writeSync(fd, localFooter, 0, localFooter.length, identity.length - 8 - localFooter.length);
        fs.writeSync(fd, localTail, 0, localTail.length, identity.length - 8);
      }
      const ranges = selectOvertureChunkRanges(metadata, window, identity.length);
      // Page allocation rather than transfer length is the shared disk budget.
      plannedBytes += allocationBytes([...metadataRanges, ...ranges]);
      if (plannedBytes > budget) throw new Error('overture_prefetch_budget');
      for (const range of ranges) tasks.push({ identity, range, fd });
      // DuckDB's external-file cache may retain the original footer. Publish
      // the derived file under a new private name that it has never inspected.
      const finalFile = path.join(tempDir, `overture-${index}.parquet`);
      fs.renameSync(file, finalFile); files[files.indexOf(file)] = finalFile;
      sqlPaths.set(identity.path, finalFile);
    }
    await parallel(tasks, Math.min(4, integer(concurrency, 1)), async ({ identity, range, fd }) => {
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
