'use strict';
// Offline reproduction: actual immutable metadata; controlled zero data pages.
// Tests memory/range planning, not live provider or valid data-page decoding.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { createHash } = require('node:crypto');
const root = process.env.PARRANDA_METADATA_REPLAY_ROOT || path.join(__dirname, '../..');
const fixture = process.env.PARRANDA_METADATA_REPLAY_FIXTURE || path.join(root, 'tests/fixtures/overture-metadata-20261021');
const { DuckDBInstance } = require(path.join(root, 'node_modules/@duckdb/node-api'));
const { prefetchOvertureParquet } = require(path.join(root, 'server/place-candidates/overture-parquet-prefetch'));
async function run() {
  const identity = JSON.parse(fs.readFileSync(path.join(fixture, 'identity.json')));
  const footer = zlib.gunzipSync(fs.readFileSync(path.join(fixture, 'footer.bin.gz')));
  if (createHash('sha256').update(footer).digest('hex') !== identity.footer_sha256) throw Error('fixture_hash_mismatch');
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'parranda-large-footer-'));
  const db = await DuckDBInstance.create(':memory:', { memory_limit: '128MB', threads: '1', autoload_known_extensions: 'false', autoinstall_known_extensions: 'false' });
  const conn = await db.connect();
  const ranges = [];
  const tail = Buffer.alloc(8); tail.writeUInt32LE(footer.length); tail.write('PAR1', 4);
  const footerStart = identity.length - 8 - footer.length;
  const fetcher = async (url, options) => {
    if (!url.endsWith(identity.path.split('/').at(-1))) throw Error('unexpected_asset');
    const headers = { etag: identity.etag, 'content-length': String(identity.length) };
    if (options.method === 'HEAD') return new Response(null, { status: 200, headers });
    if (options.headers['If-Match'] !== identity.etag && options.headers['if-match'] !== identity.etag) throw Error('unbound_range');
    const match = (options.headers.Range || options.headers.range).match(/^bytes=(\d+)-(\d+)$/);
    const start = Number(match[1]), end = Number(match[2]);
    ranges.push({ start, end });
    const body = Buffer.alloc(end - start + 1);
    const copy = (bytes, offset) => {
      const lo = Math.max(start, offset), hi = Math.min(end + 1, offset + bytes.length);
      if (hi > lo) bytes.copy(body, lo - start, lo - offset, hi - offset);
    };
    copy(Buffer.from('PAR1'), 0); copy(footer, footerStart); copy(tail, identity.length - 8);
    return new Response(body, { status: 206, headers: { ...headers, 'content-range': `bytes ${start}-${end}/${identity.length}`, 'content-length': String(body.length) } });
  };
  try {
    const result = await prefetchOvertureParquet({ conn, paths: [identity.path], window: identity.window, tempDir, fetcher });
    return { sourceAssets: result.sourceAssets, physicalBytes: result.physicalBytes, rangeCount: ranges.length,
      rangeDigest: createHash('sha256').update(JSON.stringify(ranges.slice(3))).digest('hex') };
  } finally { conn.closeSync(); db.closeSync(); fs.rmSync(tempDir, { recursive: true, force: true }); }
}
if (require.main === module) run().then(value => console.log(JSON.stringify(value))).catch(error => { console.error(error); process.exitCode = 1; });
