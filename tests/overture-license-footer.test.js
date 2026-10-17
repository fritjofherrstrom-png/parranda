'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path'), Module = require('node:module'), crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const { DuckDBInstance } = require(path.join(root, 'node_modules/@duckdb/node-api'));
const { buildOvertureQuery, mapOvertureRow } = require(path.join(root, 'server/place-candidates/overture-source'));
const { projectSourcesLicense } = require('../server/place-candidates/overture-license-footer');
const original = path.join(root, 'server/place-candidates/overture-parquet-prefetch.js'), m = new Module(original, module);
m.filename = original;
m.paths = module.paths;
m._compile(fs.readFileSync(original, 'utf8') + '\nmodule.exports._pruneFooter=pruneFooter;module.exports._overlappingGroups=overlappingGroups;', original);
const native = m.exports;
const compact = require('./helpers/parquet-compact-fixture');
const fields = b => compact.parser(b).fields(), list = f => compact.parser(f.v).list().items, find = (a, id) => a.find(f => f.id === id);
const iv = n => compact.vint(BigInt(n) * 2n), str = s => { const b = Buffer.from(s); return Buffer.concat([compact.vint(b.length), b]); };
const footerOf = b => b.subarray(b.length - 8 - b.readUInt32LE(b.length - 8), b.length - 8);
const rewrite = (raw, footer) => { const end = raw.length - 8 - raw.readUInt32LE(raw.length - 8), base = Buffer.alloc(end + footer.length + 8); raw.copy(base, 0, 0, end); footer.copy(base, end); base.writeUInt32LE(footer.length, base.length - 8); base.write('PAR1', base.length - 4); return base; };
function enrich(footer, metadata) {
    const f = fields(footer), schemas = list(find(f, 2));
    let licenseNode;
    for (let i = 0; i < schemas.length; i++) {
        const s = fields(schemas[i]);
        if (compact.parser(find(s, 4).v).string() === 'license') {
            s.push({ id: 9, t: 5, v: iv(31431) }, { id: 27, t: 8, v: str('unknown-license-schema-field') });
            s.sort((a, b) => a.id - b.id);
            schemas[i] = compact.struct(s);
            licenseNode = schemas[i];
        }
    }
    find(f, 2).v = compact.list(schemas);
    let kv = find(f, 5);
    if (!kv) {
        kv = { id: 5, t: 9, v: compact.list([]) };
        f.push(kv);
    }
    const entries = list(kv);
    entries.push(compact.struct([{ id: 1, t: 8, v: str('ARROW:schema') }, { id: 2, t: 8, v: str('stale-schema-must-be-removed') }]), compact.struct([{ id: 1, t: 8, v: str('review.keep') }, { id: 2, t: 8, v: str('unknown-kv-must-survive') }]));
    kv.v = compact.list(entries);
    const rg = list(find(f, 4)).map((raw, index) => { const g = fields(raw); if (!find(g, 7))
        g.push({ id: 7, t: 4, v: iv(index) }); if (!find(g, 4))
        g.push({ id: 4, t: 9, v: compact.list([compact.struct([{ id: 1, t: 5, v: iv(1) }, { id: 2, t: 2, v: Buffer.alloc(0) }, { id: 3, t: 2, v: Buffer.alloc(0) }])]) }); if (!find(g, 5))
        g.push({ id: 5, t: 6, v: iv(4) }); g.sort((a, b) => a.id - b.id); return compact.struct(g); });
    find(f, 4).v = compact.list(rg);
    if (!find(f, 7)) {
        const count = metadata.filter(r => r.row_group_id === '0').length;
        f.push({ id: 7, t: 9, v: compact.list(Array.from({ length: count }, () => compact.struct([{ id: 1, t: 12, v: Buffer.from([0]) }]))) });
    }
    f.push({ id: 99, t: 8, v: str('opaque-unknown-root') });
    f.sort((a, b) => a.id - b.id);
    return { footer: compact.struct(f), licenseNode };
}
async function fixture(t, mode = 'double') {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'parranda-license-footer-test-')), db = await DuckDBInstance.create(':memory:', { memory_limit: '128MB', threads: '1', autoload_known_extensions: 'false', autoinstall_known_extensions: 'false' }), conn = await db.connect();
    t.after(() => { conn.closeSync(); db.closeSync(); fs.rmSync(dir, { recursive: true, force: true }); });
    await conn.run(`SET temp_directory='${dir}';SET max_temp_directory_size='32MiB'`);
    const a = path.join(dir, 'generated.parquet'), file = path.join(dir, 'original.parquet'), w = mode === 'dateline' ? { lat: 0, lng: 179.99, radiusKm: 5 } : { lat: 40, lng: 12, radiusKm: 5 }, type = mode === 'decimal' ? 'DECIMAL(18,7)' : 'DOUBLE';
    await conn.run(`COPY(WITH r AS(SELECT i,md5(i::VARCHAR)h,CASE i%6 WHEN 0 THEN 'cafe' WHEN 1 THEN 'garden' WHEN 2 THEN 'museum' WHEN 3 THEN 'bar' WHEN 4 THEN 'restaurant' ELSE 'art_gallery' END category FROM range(8192)t(i)),s AS(SELECT *,list_transform([0,1],n->{'property':'name','dataset':'fixture','license':CASE WHEN i%11=3 THEN NULL WHEN n=0 THEN 'CC0-1.0' WHEN i%5=0 THEN 'future-unreviewed-license' ELSE 'Apache-2.0' END,'record_id':md5((i+n)::VARCHAR),'update_time':'2026','confidence':.99::DOUBLE,'between':[.1,.2],'provider':'fixture','resource':'fixture','version':'v1','future':{'license':'NOT_THE_APPLICABLE_LICENSE','payload':['opaque',h]}})base FROM r)
 SELECT substr(h,1,8)||'-'||substr(h,9,4)||'-'||substr(h,13,4)||'-'||substr(h,17,4)||'-'||substr(h,21,12)id,{'primary':'Place '||h}AS "names",{'primary':category,'hierarchy':['root',category],'alternates':['unsupported']}taxonomy,.99::DOUBLE confidence,CASE WHEN i%31=0 THEN 'closed' ELSE 'open' END operating_status,['https://example.test/'||h]websites,{'names':{'primary':CASE WHEN i%7=0 THEN 'Chain' END}}brand,
 CASE i%11 WHEN 0 THEN NULL WHEN 1 THEN [] WHEN 2 THEN list_prepend(NULL,base) WHEN 4 THEN [NULL] ELSE base END sources,
 {'xmin':(CASE WHEN i<2048 THEN 50.0 ELSE ${mode === 'dateline' ? "CASE WHEN i%2=0 THEN 179.99 ELSE -179.99 END" : '12.0+(i%200)*.0001'} END)::${type},'ymin':(${w.lat}+(i%100)*.0001)::${type}}bbox FROM s)TO '${a}'(FORMAT PARQUET,COMPRESSION ZSTD,ROW_GROUP_SIZE 2048)`);
    const data = fs.readFileSync(a), meta = (await conn.runAndReadAll(`SELECT * FROM parquet_metadata('${a}')`)).getRowObjectsJson(), injected = enrich(footerOf(data), meta), raw = rewrite(data, injected.footer);
    fs.writeFileSync(file, raw);
    const metadata = (await conn.runAndReadAll(`SELECT * FROM parquet_metadata('${file}')`)).getRowObjectsJson(), { groups, selected } = native._overlappingGroups(metadata, w), rows = [...selected].reduce((n, g) => n + Number(groups.get(g)[0].row_group_num_rows), 0), coarse = native._pruneFooter(injected.footer, selected, rows);
    return { dir, conn, w, file, raw, metadata, selected, coarse, licenseNode: injected.licenseNode };
}
for (const mode of ['double', 'decimal', 'dateline'])
    test('original ordered SQL and raw source-list semantics survive source-only footer projection: ' + mode, async (t) => {
        const f = await fixture(t, mode), p = projectSourcesLicense(f.coarse), file = path.join(f.dir, 'projected.parquet'), fd = fs.openSync(file, 'wx');
        fs.ftruncateSync(fd, f.raw.length);
        fs.writeSync(fd, Buffer.from('PAR1'), 0, 4, 0);
        fs.writeSync(fd, p.footer, 0, p.footer.length, f.raw.length - 8 - p.footer.length);
        const tail = Buffer.from(f.raw.subarray(f.raw.length - 8));
        tail.writeUInt32LE(p.footer.length, 0);
        fs.writeSync(fd, tail, 0, 8, f.raw.length - 8);
        const keptMeta = f.metadata.filter(r => f.selected.has(r.row_group_id) && (!r.path_in_schema.startsWith('sources,') || r.path_in_schema === 'sources, list, element, license')), ranges = native.selectOvertureChunkRanges(keptMeta, f.w, f.raw.length);
        for (const r of ranges) {
            const b = f.raw.subarray(r.start, r.end + 1);
            fs.writeSync(fd, b, 0, b.length, r.start);
        }
        fs.closeSync(fd);
        const sql = buildOvertureQuery({ release: '2026-09-23.1', ...f.w, parquetPaths: ['s3://overturemaps-us-west-2/release/2026-09-23.1/theme=places/type=place/part-00001-fixture.zstd.parquet'] }), local = file => sql.replace(/'s3:\/\/[^']+'/g, `'${file}'`), a = (await f.conn.runAndReadAll(local(f.file))).getRowObjectsJson(), b = (await f.conn.runAndReadAll(local(file))).getRowObjectsJson();
        assert.equal(a.length, 600);
        assert.deepEqual(b, a);
        assert.deepEqual(b.map(mapOvertureRow), a.map(mapOvertureRow));
        const rawQuery = file => `SELECT id,len(sources)n,list_transform(sources,s->s.license)raw_licenses FROM read_parquet('${file}')WHERE bbox.xmin<>50 ORDER BY id`;
        assert.deepEqual((await f.conn.runAndReadAll(rawQuery(file))).getRowObjectsJson(), (await f.conn.runAndReadAll(rawQuery(f.file))).getRowObjectsJson());
        const derived = (await f.conn.runAndReadAll(`SELECT * FROM parquet_metadata('${file}')`)).getRowObjectsJson();
        assert.deepEqual([...new Set(derived.filter(r => r.path_in_schema.startsWith('sources,')).map(r => r.path_in_schema))], ['sources, list, element, license']);
        const before = fields(f.coarse), after = fields(p.footer), oldGroups = list(find(before, 4)), newGroups = list(find(after, 4));
        assert.equal(newGroups.length, 3);
        for (let g = 0; g < newGroups.length; g++) {
            const old = fields(oldGroups[g]), now = fields(newGroups[g]), oldColumns = list(find(old, 1));
            assert.equal(find(now, 4), undefined);
            assert.equal(Number(compact.parser(find(now, 7).v).integer()), g, 'private row-group ordinals follow the pruned order');
            assert.deepEqual(list(find(now, 1)), oldColumns.filter((_x, i) => p.keepLeaves[i]));
            const rows = derived.filter(r => Number(r.row_group_id) === g), bytes = rows.reduce((n, r) => n + Number(r.total_uncompressed_size), 0), compressed = rows.reduce((n, r) => n + Number(r.total_compressed_size), 0);
            assert.equal(Number(compact.parser(find(now, 2).v).integer()), bytes);
            assert.equal(Number(compact.parser(find(now, 6).v).integer()), compressed);
        }
        assert.deepEqual(find(before, 99).v, find(after, 99).v);
        const keys = list(find(after, 5)).map(x => compact.parser(find(fields(x), 1).v).string());
        assert.ok(keys.includes('review.keep'));
        assert.ok(!keys.includes('ARROW:schema'));
        assert.equal(list(find(after, 7)).length, p.keepLeaves.filter(Boolean).length);
        assert.ok(!derived.some(row => row.path_in_schema === 'sources, list, element, future, license'));
        const schemas = list(find(after, 2));
        assert.ok(schemas.some(raw => raw.equals(f.licenseNode)), 'license physical/logical type, field ID and unknown field copied byte-for-byte');
        t.diagnostic(JSON.stringify({ mode, sqlRows: b.length, resultHash: crypto.createHash('sha256').update(JSON.stringify(b)).digest('hex'), rawListsEqual: true }));
    });
test('empty row-group list remains schema-valid after projection', async (t) => { const f = await fixture(t), empty = native._pruneFooter(footerOf(f.raw), new Set(), 0), p = projectSourcesLicense(empty), file = path.join(f.dir, 'empty.parquet'), b = rewrite(f.raw, p.footer); fs.writeFileSync(file, b); assert.deepEqual((await f.conn.runAndReadAll(`SELECT id,list_transform(sources,s->s.license)licenses FROM read_parquet('${file}')`)).getRowObjectsJson(), []); assert.equal(list(find(fields(p.footer), 4)).length, 0); });
test('malformed, deep, encrypted, signed and noncanonical source footers fail within bounded work', async (t) => {
    const f = await fixture(t);
    for (let i = 0; i < 40; i++) {
        const n = Math.floor(f.coarse.length * i / 40);
        assert.throws(() => projectSourcesLicense(f.coarse.subarray(0, n)));
    }
    assert.throws(() => projectSourcesLicense(Buffer.alloc(8 * 1024 * 1024 + 1)));
    assert.throws(() => projectSourcesLicense(Buffer.from([0x1d, 0])));
    const nest = Buffer.concat([Buffer.alloc(66, 0x1c), Buffer.alloc(67)]);
    assert.throws(() => projectSourcesLicense(nest), /deep_footer/);
    for (const id of [8, 9]) {
        const r = fields(f.coarse);
        r.push({ id, t: id === 8 ? 12 : 8, v: id === 8 ? Buffer.from([0]) : str('signature') });
        r.sort((a, b) => a.id - b.id);
        assert.throws(() => projectSourcesLicense(compact.struct(r)), /encrypted_or_signed/);
    }
    const rootFields = fields(f.coarse), schemas = list(find(rootFields, 2));
    const index = schemas.findIndex(raw => { const s = fields(raw); return compact.parser(find(s, 4).v).string() === 'element' && find(s, 5) && Number(compact.parser(find(s, 5).v).integer()) > 5; });
    assert.ok(index > 0);
    const element = fields(schemas[index]);
    find(element, 4).v = str('legacy_tuple');
    schemas[index] = compact.struct(element);
    find(rootFields, 2).v = compact.list(schemas);
    assert.throws(() => projectSourcesLicense(compact.struct(rootFields)), /source_license_schema/);
});
test('flat schema trees are bounded even when Compact structs are shallow', async (t) => { const f = await fixture(t), root = fields(f.coarse), nodes = list(find(root, 2)); const wrapper = compact.struct([{ id: 3, t: 5, v: iv(1) }, { id: 4, t: 8, v: str('deep') }, { id: 5, t: 5, v: iv(1) }]); find(root, 2).v = compact.list([nodes[0], ...Array.from({ length: 70 }, () => wrapper), ...nodes.slice(1)]); assert.throws(() => projectSourcesLicense(compact.struct(root)), /deep_footer/); });
test('row-group file offsets refer to data or dictionary pages, not earlier index pages', async (t) => {
    const f = await fixture(t), root = fields(f.coarse), groups = list(find(root, 4)), rg = fields(groups[0]), columns = list(find(rg, 1)), chunk = fields(columns[0]), md = find(chunk, 3), column = fields(md.v);
    column.push({ id: 10, t: 6, v: iv(0) });
    column.sort((a, b) => a.id - b.id);
    md.v = compact.struct(column);
    columns[0] = compact.struct(chunk);
    find(rg, 1).v = compact.list(columns);
    groups[0] = compact.struct(rg);
    find(root, 4).v = compact.list(groups);
    const p = projectSourcesLicense(compact.struct(root)), projected = fields(list(find(fields(p.footer), 4))[0]), kept = list(find(projected, 1));
    let first = null;
    for (const raw of kept) {
        const c = fields(find(fields(raw), 3).v);
        for (const id of [9, 11]) {
            const field = find(c, id);
            if (field) {
                const n = compact.parser(field.v).integer();
                if (first === null || n < first)
                    first = n;
            }
        }
    }
    assert.ok(first > 0n);
    assert.equal(compact.parser(find(projected, 5).v).integer(), first);
    assert.equal(compact.parser(find(fields(find(fields(kept[0]), 3).v), 10).v).integer(), 0, 'index metadata is retained verbatim');
});
