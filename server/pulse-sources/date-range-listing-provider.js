'use strict';

// Reviewed source schemas, selected only by trusted geographic feed metadata.
// Reuse their factual parsers without the old city planner's ranking, three-row
// cap, prose/images or first-result geocoding. Shared Live owns all final gates.
const { shimFlatRecord, normalizeOpenDataAgendaRecord } = require('../cities/barcelona/live');
const { parseLiveEventBlocks } = require('../live-events');
const { normalizeSourceEventDate, datePartsInTimezone } = require('./source-event-time');
const { buildProviderCollectionOutcome } = require('./provider-collection-outcome');
const MAX_BYTES = 1024 * 1024;

function createDateRangeListingProvider(options = {}) {
  return {
    create() {
      return {
        async collect({ date } = {}) {
          // Pagination shares one deadline and byte budget; another page never
          // receives a new collection window.
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), options.timeoutMs || 12000);
          try {
            return await collectDateRange(date, {
              ...options, signal: controller.signal, budget: { remaining: MAX_BYTES },
            });
          } finally {
            clearTimeout(timer);
          }
        },
      };
    },
  };
}

async function collectDateRange(date, options) {
  // Generic acquisition may pass the selected day's source-local midnight as
  // an instant. UTC string slicing would query the previous calendar day.
  const localParts = datePartsInTimezone(date, options.timezone);
  const start = normalizeSourceEventDate(date) || (localParts
    ? `${localParts.year}-${String(localParts.month).padStart(2, '0')}-${String(localParts.day).padStart(2, '0')}`
    : null);
  if (!start) return collection([], 'unavailable', 'collection_context_unavailable');
  const end = new Date(Date.parse(`${start}T00:00:00Z`) + 7 * 86400000).toISOString().slice(0, 10);
  let rows;
  if (options.adapter === 'ckan_agenda') {
    // Resource IDs are server-owned config; never interpolate public input.
    if (!/^[a-zA-Z0-9-]+$/.test(options.resourceId || '')) throw new Error('source_payload_invalid');
    const url = new URL(options.endpoint);
    url.searchParams.set('sql', `SELECT * FROM "${options.resourceId}" WHERE end_date >= '${start}' AND start_date <= '${end}' LIMIT 300`);
    const body = JSON.parse(await fetchBounded(url.href, options));
    if (body?.success !== true || !Array.isArray(body?.result?.records)) throw new Error('source_payload_invalid');
    rows = body.result.records.slice(0, 300)
      .map(row => normalizeOpenDataAgendaRecord(shimFlatRecord(row))).filter(Boolean);
  } else {
    const html = await fetchBounded(options.endpoint, options);
    rows = parseLiveEventBlocks(html);
    const pageNumbers = [...html.matchAll(/href="\/en\/romalive\?page=(\d+)"/g)].map(match => Number(match[1]));
    const pages = Math.min(options.maxPages || 3, Math.max(1, ...pageNumbers.map(page => page + 1)));
    for (let page = 1; page < pages; page++) {
      const url = new URL(options.endpoint);
      url.searchParams.set('page', String(page));
      rows.push(...parseLiveEventBlocks(await fetchBounded(url.href, options)));
    }
  }
  const seen = new Set();
  const events = rows.filter(row => row.start_date <= end && (row.end_date || row.start_date) >= start)
    .map(row => toDateRangeEvent(row, options)).filter(event => {
      if (!event || seen.has(event.id)) return false;
      seen.add(event.id);
      return true;
    }).slice(0, options.limit || 40);
  return collection(events, events.length ? 'ok' : 'empty', events.length ? null : 'source_empty');
}

function toDateRangeEvent(row, options) {
  const start = normalizeSourceEventDate(row.start_date);
  const end = normalizeSourceEventDate(row.end_date || row.start_date);
  if (!row.title || !start || !end || end < start || !row.url) return null;
  return {
    id: row.id,
    title: row.title,
    starts_on: start,
    ends_on: end,
    // A single stated date is occurrence evidence, without invented hours.
    // A range does not assert attendance on every day between its endpoints.
    time_window: start === end
      ? { kind: 'occurrences', dates: [start], timezone: options.timezone }
      : { kind: 'period', starts_on: start, ends_on: end, timezone: options.timezone },
    source_url: row.url,
    source_label: options.label,
    source_language: row.source_language || options.sourceLanguage,
    place_context: row.venue === 'Event venue' || row.venue === 'Barcelona venue' ? null : row.venue,
    address: row.address || null,
    ...(Number.isFinite(row.lat) && Number.isFinite(row.lng) ? { lat: row.lat, lng: row.lng } : {}),
    tags: row.type ? [row.type] : [],
  };
}

function collection(events, status, reason) {
  return {
    events: [], signals: [], time_sensitive_events: events,
    collection_status: buildProviderCollectionOutcome(status, { reason, eventRows: events.length }),
  };
}

async function fetchBounded(url, options) {
  const fetcher = options.fetcher || globalThis.fetch;
  options.signal.throwIfAborted();
  const response = await fetcher(url, {
    redirect: 'error', signal: options.signal,
    headers: {
      Accept: 'application/json, text/html',
      'User-Agent': 'Parranda/1.0 (+https://github.com/fritjofherrstrom-png/parranda)',
    },
  });
  if (!response?.ok) throw new Error(`source_http_${response?.status || 'not_ok'}`);
  // Production fetch streams enforce the byte bound before materializing;
  // lightweight injected responses use the same bound after text acquisition.
  let text = '';
  if (response.body?.getReader) {
    const reader = response.body.getReader();
    let bytes = 0;
    const chunks = [];
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > options.budget.remaining) {
          await reader.cancel();
          throw new Error('source_payload_invalid');
        }
        chunks.push(Buffer.from(value));
      }
      text = Buffer.concat(chunks).toString('utf8');
    } finally {
      reader.releaseLock();
    }
  } else text = await response.text();
  const bytes = Buffer.byteLength(text);
  if (bytes > options.budget.remaining) throw new Error('source_payload_invalid');
  options.budget.remaining -= bytes;
  options.signal.throwIfAborted();
  return text;
}
module.exports = { createDateRangeListingProvider };
