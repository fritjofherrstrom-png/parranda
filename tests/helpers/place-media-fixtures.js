'use strict';

// Shared fixtures for the place-media tests: real-shaped Wikidata, Commons and
// Wikipedia answers (tests/fixtures/place-media/wikimedia-samples.json) and a
// fake fetcher that answers the client's batched URLs from them.

const samples = require('../fixtures/place-media/wikimedia-samples.json');
const { parseEntity } = require('../../server/place-media/wikimedia-client');

const clone = value => JSON.parse(JSON.stringify(value));

/** A media record built from a real wbgetentities entity. */
function recordFromEntity(qid, extra = {}) {
  const facts = parseEntity(qid, samples.wbgetentities.entities[qid]);
  if (!facts) throw new Error(`no fixture entity ${qid}`);
  return { v: 1, qid, checked_on: '2026-11-24', entity: facts.entity, photo: null, subtitle: facts.subtitle, about: {}, ...extra };
}

function commonsPage(title) {
  const page = samples.commons_imageinfo.query.pages.find(row => row.title === title);
  if (!page) throw new Error(`no fixture page ${title}`);
  return clone(page);
}

function summary(lang, title) {
  const row = samples.wikipedia_summaries.find(item => item.lang === lang && item.title === title);
  if (!row) throw new Error(`no fixture summary ${lang}:${title}`);
  return row;
}

/** An extracts|pageprops|revisions page (formatversion=2) rebuilt from a captured REST summary. */
function extractPage(lang, title, overrides = {}) {
  const row = summary(lang, title);
  return {
    pageid: row.pageid, ns: 0, title: row.title, extract: row.extract,
    pageprops: { wikibase_item: row.wikibase_item }, revisions: [{ revid: row.revision, parentid: row.revision - 1 }],
    ...overrides,
  };
}

function jsonResponse(body, { status = 200, headers = {} } = {}) {
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), String(v)]));
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: name => lower[String(name).toLowerCase()] ?? null },
    text: async () => JSON.stringify(body),
  };
}

/**
 * Fake fetcher that answers wbgetentities / imageinfo / extracts from the
 * fixtures. `entities`, `files`, `extracts` override or add answers. Every
 * URL is recorded in `calls`.
 */
function createFixtureFetcher({ entities = {}, files = {}, extracts = {}, delayMs = 0, onCall } = {}) {
  const calls = [];
  const allEntities = { ...clone(samples.wbgetentities.entities), ...entities };
  const allFiles = Object.fromEntries(samples.commons_imageinfo.query.pages.map(page => [page.title, clone(page)]));
  Object.assign(allFiles, files);
  const fetcher = async (url, init) => {
    calls.push({ url, init });
    if (onCall) await onCall(url, init);
    if (delayMs) await new Promise(resolve => setTimeout(resolve, delayMs));
    const parsed = new URL(url);
    const params = parsed.searchParams;
    if (parsed.hostname === 'www.wikidata.org' && params.get('action') === 'wbgetentities') {
      const out = {};
      for (const id of params.get('ids').split('|')) out[id] = allEntities[id] ? clone(allEntities[id]) : { id, missing: '' };
      return jsonResponse({ entities: out, success: 1 });
    }
    if (parsed.hostname === 'commons.wikimedia.org') {
      const pages = params.get('titles').split('|').map(title => allFiles[title] ? clone(allFiles[title]) : { ns: 6, title, missing: true });
      return jsonResponse({ batchcomplete: true, query: { pages } });
    }
    const wiki = /^(sv|en)\.wikipedia\.org$/.exec(parsed.hostname);
    if (wiki) {
      const lang = wiki[1];
      const pages = params.get('titles').split('|').map(title => {
        if (extracts[`${lang}|${title}`]) return clone(extracts[`${lang}|${title}`]);
        const row = samples.wikipedia_summaries.find(item => item.lang === lang && item.title === title);
        return row ? extractPage(lang, title) : { ns: 0, title, missing: true };
      });
      return jsonResponse({ batchcomplete: true, query: { pages } });
    }
    return jsonResponse({ error: { code: 'unexpected' } }, { status: 404 });
  };
  return { fetcher, calls };
}

module.exports = { samples, clone, recordFromEntity, commonsPage, extractPage, jsonResponse, createFixtureFetcher };
