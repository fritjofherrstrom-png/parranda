'use strict';

// A receipt for resolver-owned identity, not a client assertion of geography.
// Stateless and bounded: one persistent secret, no per-user token database.
const { randomBytes, createHmac, timingSafeEqual } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { sanitizeTrustedSpatialScope } = require('./spatial-scope');
const { isValidCoordinate, isStrongConfidence } = require('../planner/agnostic-place-intake');
const TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_TOKEN_LENGTH = 8192;
const normalizeQuery = value => typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').toLowerCase() : '';

function selectionSecret(cacheDir) {
  if (cacheDir) {
    try {
      fs.mkdirSync(cacheDir, { recursive: true });
      const file = path.join(cacheDir, '.place-selection-key');
      try { fs.writeFileSync(file, randomBytes(32), { flag: 'wx', mode: 0o600 }); }
      catch (error) { if (error.code !== 'EEXIST') throw error; }
      const key = fs.readFileSync(file);
      if (key.length === 32) return key;
    } catch (_) { /* No durable cache: fail closed across process restarts. */ }
  }
  return randomBytes(32);
}

function snapshot(candidate) {
  if (!candidate || !isValidCoordinate(candidate.lat, candidate.lng) || !isStrongConfidence(candidate.confidence)) return null;
  const out = { lat: candidate.lat, lng: candidate.lng, confidence: candidate.confidence };
  for (const field of ['label', 'provenance', 'attribution', 'license', 'timezone', 'osm_ref', 'wikidata_ref', 'source_tier']) {
    if (typeof candidate[field] === 'string') out[field] = candidate[field].slice(0, field === 'label' ? 600 : 160);
  }
  if (candidate.admin_context && typeof candidate.admin_context === 'object') {
    const admin = {};
    for (const field of ['locality', 'municipality', 'county', 'region', 'country', 'country_code']) {
      if (typeof candidate.admin_context[field] === 'string') admin[field] = candidate.admin_context[field].slice(0, 160);
    }
    out.admin_context = admin;
  }
  const scope = sanitizeTrustedSpatialScope(candidate.spatial_scope);
  if (scope) out.spatial_scope = scope;
  if (candidate.spatial_scope_invalid === true || (candidate.spatial_scope != null && !scope)) out.spatial_scope_invalid = true;
  if (candidate.discovery_aperture_unavailable === true) out.discovery_aperture_unavailable = true;
  return out;
}

function createPlaceSelectionStore({ cacheDir = null, secret, now = () => Date.now() } = {}) {
  const key = secret || selectionSecret(cacheDir);
  const sign = data => createHmac('sha256', key).update(data).digest('base64url');
  function issue(candidate, query) {
    const selected = snapshot(candidate);
    const q = normalizeQuery(query);
    if (!selected || !q || q.length > 200) return null;
    const data = Buffer.from(JSON.stringify({ v: 2, q, exp: now() + TTL_MS, selected })).toString('base64url');
    const token = `${data}.${sign(data)}`;
    return token.length <= MAX_TOKEN_LENGTH ? token : null;
  }
  function read(token, query) {
    if (typeof token !== 'string' || token.length > MAX_TOKEN_LENGTH || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(token)) return null;
    const [data, signature] = token.split('.');
    const expected = Buffer.from(sign(data));
    const supplied = Buffer.from(signature);
    if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return null;
    try {
      const receipt = JSON.parse(Buffer.from(data, 'base64url').toString('utf8'));
      if (![1, 2].includes(receipt.v) || !Number.isFinite(receipt.exp) || receipt.exp <= now() || receipt.exp > now() + TTL_MS || !receipt.q || (query !== undefined && receipt.q !== normalizeQuery(query))) return null;
      const selected = snapshot(receipt.selected);
      // v1 dropped malformed bounds. Preserve its destination and ordinary Live,
      // but only a freshly issued receipt can attest genuinely absent bounds.
      if (selected && receipt.v === 1 && !selected.spatial_scope) selected.discovery_aperture_unavailable = true;
      return selected;
    } catch (_) { return null; }
  }
  return { issue, read };
}

function placeResolutionInputs(body = {}) {
  return {
    placeSelection: body.place_selection,
    placeContextSelection: body.place_context_selection,
    placeBias: body.place_bias,
  };
}

module.exports = { createPlaceSelectionStore, placeResolutionInputs };
