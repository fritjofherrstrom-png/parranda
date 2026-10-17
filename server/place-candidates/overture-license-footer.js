'use strict';
// Project the canonical sources LIST struct to its license leaf in a private
// derivative. Retained data pages, offsets and logical/repetition types stay
// unchanged. Unknown value bodies are copied; schema-bearing indices are rebuilt.
// Format: https://github.com/apache/parquet-format/blob/master/src/main/thrift/parquet.thrift
function varint(value) {
    let n = BigInt(value);
    if (n < 0n)
        throw Error('negative_varint');
    const a = [];
    do {
        let b = Number(n & 127n);
        n >>= 7n;
        if (n)
            b |= 128;
        a.push(b);
    } while (n);
    return Buffer.from(a);
}
const zig = n => {
    n = BigInt(n);
    return n >= 0n ? n * 2n : -n * 2n - 1n;
};
function projectSourcesLicense(footer) {
    if (!Buffer.isBuffer(footer) || !footer.length || footer.length > 8 * 1024 * 1024)
        throw Error('invalid_footer_size');
    const work = { count: 0, limit: footer.length * 32 + 1024 };
    function Reader(buf) {
        let p = 0;
        const ensure = n => {
            if (++work.count > work.limit || n < 0 || !Number.isSafeInteger(n) || p + n > buf.length)
                throw Error('invalid_footer');
        };
        const byte = () => {
            ensure(1);
            return buf[p++];
        };
        const rv = () => {
            let n = 0, wide = null, shift = 0;
            for (let i = 0; i < 10; i++) {
                const b = byte(), part = b & 127, term = part * 2 ** shift;
                if (wide === null && Number.isSafeInteger(term) && Number.isSafeInteger(n + term))
                    n += term;
                else
                    wide = (wide === null ? BigInt(n) : wide) + (BigInt(part) << BigInt(shift));
                if (!(b & 128)) {
                    if (i === 9 && b > 1)
                        throw Error('invalid_varint');
                    return wide === null ? n : wide;
                }
                shift += 7;
            }
            throw Error('invalid_varint');
        };
        const count = () => {
            const n = rv();
            if (n > BigInt(buf.length))
                throw Error('invalid_count');
            return Number(n);
        };
        const lh = () => {
            const h = byte();
            return { t: h & 15, n: h >> 4 === 15 ? count() : h >> 4 };
        };
        function skip(t, depth = 0, collection = false) {
            if (depth > 64)
                throw Error('deep_footer');
            if (t === 1 || t === 2) {
                if (collection) {
                    const b = byte();
                    if (b !== 1 && b !== 2)
                        throw Error('invalid_boolean');
                }
            }
            else if (t === 3)
                byte();
            else if (t >= 4 && t <= 6)
                rv();
            else if (t === 7) {
                ensure(8);
                p += 8;
            }
            else if (t === 8) {
                const n = count();
                ensure(n);
                p += n;
            }
            else if (t === 9 || t === 10) {
                const h = lh();
                for (let i = 0; i < h.n; i++)
                    skip(h.t, depth + 1, true);
            }
            else if (t === 11) {
                const n = count();
                if (n) {
                    const h = byte();
                    for (let i = 0; i < n; i++) {
                        skip(h >> 4, depth + 1, true);
                        skip(h & 15, depth + 1, true);
                    }
                }
            }
            else if (t === 12) {
                for (;;) {
                    const h = byte();
                    if (!h)
                        break;
                    if (!(h >> 4))
                        rv();
                    skip(h & 15, depth + 1);
                }
            }
            else
                throw Error('unknown_compact_type');
        }
        const end = () => {
            if (p !== buf.length)
                throw Error('trailing_footer_bytes');
        };
        return { fields() {
                const out = [];
                let last = 0;
                const seen = new Set();
                for (;;) {
                    const h = byte();
                    if (!h)
                        break;
                    const t = h & 15;
                    let id;
                    if (h >> 4)
                        id = last + (h >> 4);
                    else {
                        const v = rv();
                        id = typeof v === 'number' ? (v % 2 ? -(v + 1) / 2 : v / 2) : Number((v >> 1n) ^ -(v & 1n));
                    }
                    if (!Number.isSafeInteger(id) || id < 1 || seen.has(id))
                        throw Error('invalid_field');
                    seen.add(id);
                    last = id;
                    const start = p;
                    skip(t);
                    out.push({ id, t, v: buf.subarray(start, p) });
                }
                end();
                return out;
            }, list() {
                const h = lh(), items = [];
                for (let i = 0; i < h.n; i++) {
                    const start = p;
                    skip(h.t, 0, true);
                    items.push(buf.subarray(start, p));
                }
                end();
                return { t: h.t, items };
            }, integer() {
                const v = rv(), n = typeof v === 'bigint' ? v : BigInt(v);
                end();
                return (n >> 1n) ^ -(n & 1n);
            }, string() {
                const n = count();
                ensure(n);
                const s = buf.subarray(p, p + n).toString('utf8');
                p += n;
                end();
                return s;
            } };
    }
    const struct = fields => {
        const out = [];
        let last = 0;
        for (const f of fields) {
            const d = f.id - last;
            out.push(d > 0 && d < 16 ? Buffer.from([(d << 4) | f.t]) : Buffer.concat([Buffer.from([f.t]), varint(zig(f.id))]), f.v);
            last = f.id;
        }
        out.push(Buffer.from([0]));
        return Buffer.concat(out);
    };
    const list = (items, t = 12) => Buffer.concat([items.length < 15 ? Buffer.from([(items.length << 4) | t]) : Buffer.concat([Buffer.from([240 | t]), varint(items.length)]), ...items]);
    const fields = b => Reader(b).fields(), listValue = (f, t) => {
        if (!f || f.t !== 9)
            throw Error('missing_list');
        const l = Reader(f.v).list();
        if (l.t !== t)
            throw Error('wrong_list_type');
        return l.items;
    };
    const integer = f => {
        if (!f || f.t < 4 || f.t > 6)
            throw Error('missing_integer');
        return Reader(f.v).integer();
    };
    const text = f => {
        if (!f || f.t !== 8)
            throw Error('missing_string');
        return Reader(f.v).string();
    };
    const find = (a, id) => a.find(f => f.id === id), putInt = (a, id, n) => {
        const f = find(a, id);
        if (!f)
            throw Error('missing_integer');
        f.v = varint(zig(n));
    };
    const root = fields(footer);
    if (find(root, 8) || find(root, 9))
        throw Error('encrypted_or_signed_footer');
    const schemaRaw = listValue(find(root, 2), 12), schema = schemaRaw.map(raw => ({ raw, fields: fields(raw) }));
    const keepNodes = new Set(), keepLeaves = [], leafPaths = [], records = new Map();
    let cursor = 0, licenseLeaves = 0;
    const nonnegative = f => {
        const n = integer(f);
        if (n < 0n || n > BigInt(Number.MAX_SAFE_INTEGER))
            throw Error('invalid_integer');
        return Number(n);
    };
    function walk(parents) {
        if (parents.length > 64)
            throw Error('deep_footer');
        const i = cursor++, node = schema[i];
        if (!node)
            throw Error('incomplete_schema');
        const name = text(find(node.fields, 4)), parts = [...parents, name], logical = parts.slice(1), children = find(node.fields, 5);
        records.set(logical.join('.'), node);
        const n = children ? nonnegative(children) : 0;
        node.originalChildren = n;
        if (!children) {
            if (!find(node.fields, 1))
                throw Error('missing_leaf_type');
            const source = logical[0] === 'sources', keep = !source || logical.join('.') === 'sources.list.element.license';
            keepLeaves.push(keep);
            leafPaths.push(logical);
            if (keep) {
                keepNodes.add(i);
                if (source)
                    licenseLeaves++;
            }
            return keep;
        }
        if (!n)
            throw Error('empty_schema_group');
        let retained = 0;
        for (let c = 0; c < n; c++)
            if (walk(parts))
                retained++;
        if (retained) {
            keepNodes.add(i);
            if (retained !== n)
                putInt(node.fields, 5, retained);
            node.raw = struct(node.fields);
        }
        return retained > 0;
    }
    walk([]);
    if (cursor !== schema.length || licenseLeaves !== 1)
        throw Error('invalid_source_license_schema');
    const src = records.get('sources'), wrapper = records.get('sources.list'), element = records.get('sources.list.element'), license = records.get('sources.list.element.license');
    const isLogical = (node, id) => {
        const f = find(node.fields, 10);
        return !!f && f.t === 12 && !!find(fields(f.v), id);
    };
    const rep = node => nonnegative(find(node.fields, 3));
    if (!src || !wrapper || !element || !license || src.originalChildren !== 1 || wrapper.originalChildren !== 1 || find(src.fields, 1) || rep(src) > 1 || !(find(src.fields, 6) && integer(find(src.fields, 6)) === 3n || isLogical(src, 3)) || rep(wrapper) !== 2 || nonnegative(find(wrapper.fields, 5)) !== 1 || rep(element) > 1 || find(element.fields, 1) || nonnegative(find(element.fields, 5)) !== 1 || rep(license) > 1 || integer(find(license.fields, 1)) !== 6n || !(find(license.fields, 6) && integer(find(license.fields, 6)) === 0n || isLogical(license, 1)))
        throw Error('unsupported_source_list_shape');
    find(root, 2).v = list(schema.filter((_n, i) => keepNodes.has(i)).map(n => n.raw));
    const rowGroups = listValue(find(root, 4), 12).map((raw, ordinal) => {
        let rg = fields(raw);
        const columns = listValue(find(rg, 1), 12);
        if (columns.length !== keepLeaves.length)
            throw Error('column_count_mismatch');
        let compressed = 0n, uncompressed = 0n, first = null;
        const kept = [];
        columns.forEach((rawChunk, i) => {
            const chunk = fields(rawChunk);
            if (find(chunk, 8) || find(chunk, 9))
                throw Error('encrypted_column');
            if (find(chunk, 1) && text(find(chunk, 1)))
                throw Error('external_column_file');
            const md = find(chunk, 3);
            if (!md || md.t !== 12)
                throw Error('missing_column_metadata');
            const column = fields(md.v), path = listValue(find(column, 3), 8).map(v => Reader(v).string());
            if (JSON.stringify(path) !== JSON.stringify(leafPaths[i]))
                throw Error('column_path_mismatch');
            if (!keepLeaves[i])
                return;
            const uc = integer(find(column, 6)), cc = integer(find(column, 7));
            if (uc < 0n || cc < 0n)
                throw Error('negative_column_size');
            uncompressed += uc;
            compressed += cc;
            for (const id of [9, 11]) {
                const f = find(column, id);
                if (f) {
                    const n = integer(f);
                    if (n < 0n)
                        throw Error('negative_page_offset');
                    if (first === null || n < first)
                        first = n;
                }
            }
            kept.push(rawChunk);
        });
        find(rg, 1).v = list(kept);
        putInt(rg, 2, uncompressed);
        if (find(rg, 6))
            putInt(rg, 6, compressed);
        if (find(rg, 5) && first !== null)
            putInt(rg, 5, first);
        if (find(rg, 7))
            putInt(rg, 7, ordinal);
        if (find(rg, 4)) {
            rg = rg.filter(f => f.id !== 4);
        }
        return struct(rg);
    });
    find(root, 4).v = list(rowGroups);
    const orders = find(root, 7);
    if (orders) {
        const entries = listValue(orders, 12);
        if (entries.length !== keepLeaves.length)
            throw Error('column_orders_mismatch');
        orders.v = list(entries.filter((_v, i) => keepLeaves[i]));
    }
    const kv = find(root, 5);
    if (kv) {
        const entries = listValue(kv, 12);
        kv.v = list(entries.filter(v => {
            const keep = text(find(fields(v), 1)) !== 'ARROW:schema';
            return keep;
        }));
    }
    const result = struct(root);
    return { footer: result, keepLeaves };
}
module.exports = { projectSourcesLicense };
