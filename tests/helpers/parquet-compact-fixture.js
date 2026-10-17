'use strict';
// Independent Compact Protocol fixture inspector/writer; trusted generated inputs only.
function vint(n) { n = BigInt(n); const a = []; do {
    let b = Number(n & 127n);
    n >>= 7n;
    if (n)
        b |= 128;
    a.push(b);
} while (n); return Buffer.from(a); }
const zig = n => (BigInt(n) << 1n) ^ (BigInt(n) >> 63n);
function parser(buf) { let p = 0; const byte = () => { if (p >= buf.length)
    throw Error('bounds'); return buf[p++]; }, rv = () => { let n = 0n, s = 0n; for (let i = 0; i < 10; i++) {
    const b = byte();
    n |= BigInt(b & 127) << s;
    if (!(b & 128))
        return n;
    s += 7n;
} throw Error('varint'); }; const lh = () => { const h = byte(); return { type: h & 15, n: h >> 4 === 15 ? Number(rv()) : h >> 4 }; }; function skip(t, list = false) { if (t === 1 || t === 2) {
    if (list)
        byte();
}
else if (t === 3)
    byte();
else if (t >= 4 && t <= 6)
    rv();
else if (t === 7)
    p += 8;
else if (t === 8) {
    const n = Number(rv());
    p += n;
}
else if (t === 9 || t === 10) {
    const h = lh();
    for (let i = 0; i < h.n; i++)
        skip(h.type, true);
}
else if (t === 11) {
    const n = Number(rv());
    if (n) {
        const h = byte();
        for (let i = 0; i < n; i++) {
            skip(h >> 4, true);
            skip(h & 15, true);
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
        skip(h & 15);
    }
}
else
    throw Error('type'); if (p > buf.length)
    throw Error('bounds'); } return { fields() { const a = []; let last = 0; for (;;) {
        const h = byte();
        if (!h)
            break;
        const t = h & 15;
        let id;
        if (h >> 4)
            id = last + (h >> 4);
        else {
            const n = rv();
            id = Number((n >> 1n) ^ -(n & 1n));
        }
        last = id;
        const s = p;
        skip(t);
        a.push({ id, t, v: buf.subarray(s, p) });
    } if (p !== buf.length)
        throw Error('trailing'); return a; }, list() { const h = lh(), a = []; for (let i = 0; i < h.n; i++) {
        const s = p;
        skip(h.type, true);
        a.push(buf.subarray(s, p));
    } if (p !== buf.length)
        throw Error('trailing list'); return { type: h.type, items: a }; }, integer() { const n = rv(); return Number((n >> 1n) ^ -(n & 1n)); }, string() { const n = Number(rv()); return buf.subarray(p, p + n).toString('utf8'); } }; }
function struct(fields) { const a = []; let last = 0; for (const f of fields) {
    const d = f.id - last;
    a.push(d > 0 && d < 16 ? Buffer.from([(d << 4) | f.t]) : Buffer.concat([Buffer.from([f.t]), vint(zig(f.id))]), f.v);
    last = f.id;
} a.push(Buffer.from([0])); return Buffer.concat(a); }
function list(items, type = 12) { return Buffer.concat([items.length < 15 ? Buffer.from([(items.length << 4) | type]) : Buffer.concat([Buffer.from([240 | type]), vint(items.length)]), ...items]); }
module.exports = { parser, struct, list, vint };
