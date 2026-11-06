"use strict";

const { attribute, hasClass, cleanText, sameOriginUrl, within, recordCardClaim } = require("./scheduled-event-document");
const { normalizeSourceEventDate } = require("./source-event-time");

// Closed SSR card/data grammar, never publisher JavaScript execution or an
// anchor fallback. Both visible fields AND the exact state identity must agree.
function extractTransferStateEventCards(doc, { sourceUrl, explicitSingleDate, claims }) {
  const owners = new Map();
  const groups = new Map();
  const foreignText = new Set();
  for (const node of doc.nodes) {
    let owner = owners.get(node.parentNode) || null;
    const boundary = node.tagName === "article" || hasClass(node, "flip-container") || isTransferOwner(node);
    if (boundary && owner) {
      for (let parent = node.parentNode; parent; parent = parent.parentNode) {
        foreignText.add(parent);
        if (parent === owner) break;
      }
    }
    if (boundary) owner = null;
    if (isTransferOwner(node)) {
      owner = node;
      groups.set(owner, []);
      if (groups.size > 200) return [];
    }
    owners.set(node, owner);
    if (owner) groups.get(owner).push(node);
  }
  if (!groups.size) return [];
  const records = readStateRecords(doc.scripts, sourceUrl);
  const cards = [];
  const text = node => node && !foreignText.has(node) ? doc.texts.get(node) : null;
  for (const own of groups.values()) {
    const components = own.filter(node => node.tagName === "app-card");
    const links = own.filter(node => node.tagName === "a");
    const titles = own.filter(node => node.tagName === "span" && hasClass(node, "title"));
    const dates = own.filter(node => node.tagName === "span" && hasClass(node, "meta"));
    const title = titles.length === 1 ? text(titles[0]) : null;
    const date = dates.length === 1 ? explicitSingleDate(text(dates[0])) : null;
    const coherent = components.length === 1 && links.length === 1 && titles.length === 1 && dates.length === 1 &&
      within(links[0], components[0]) && within(titles[0], links[0]) && within(dates[0], links[0]);
    // Negative claims survive positive filtering, including duplicate cards
    // whose date, title, state record or geometry cannot be supported.
    for (const link of links) {
      const url = sameOriginUrl(attribute(link, "href"), sourceUrl);
      if (!url || url === sourceUrl) continue;
      const record = records?.get(url);
      const matched = coherent && title && title.length <= 200 && date && record && record.title === title && record.date === date &&
        (!attribute(link, "title") || cleanText(attribute(link, "title")) === title);
      recordCardClaim(claims, url, title || "", matched ? date : null, dates.length);
      if (matched) cards.push({ url, title, date, contact: { lat: record.lat, lng: record.lng } });
    }
  }
  return cards;
}

function isTransferOwner(node) {
  return node.tagName === "div" && hasClass(node, "card") && hasClass(node, "event-card");
}

function readStateRecords(scripts, sourceUrl) {
  if (scripts.length > 32) return null;
  const states = scripts.filter(node => /^[A-Za-z][\w-]{0,63}-state$/.test(attribute(node, "id")));
  if (states.length !== 1) return null;
  const script = states[0];
  if (attribute(script, "src") || attribute(script, "type") !== "application/json") return null;
  const raw = (script.childNodes || []).map(node => node.value || "").join("");
  if (Buffer.byteLength(raw, "utf8") > 512 * 1024) return null;
  let root;
  try {
    // Single pass matters: &a;q; is literal &q;, not an escaped quote.
    const escapes = { a: "&", q: '"', s: "'", l: "<", g: ">" };
    root = JSON.parse(raw.replace(/&([aqslg]);/g, (_, key) => escapes[key]));
  } catch (_) { return null; }
  if (!root || typeof root !== "object" || Array.isArray(root)) return null;
  const records = new Map();
  const stack = [{ value: root, keys: Object.keys(root), next: 0, depth: 0 }];
  let inspected = 0;
  let recordCount = 0;
  while (stack.length) {
    const frame = stack[stack.length - 1];
    if (frame.next === 0) {
      if (++inspected > 20000 || frame.depth > 256) return null;
      const value = frame.value;
      if (!Array.isArray(value) && typeof value.url === "string" &&
          ["titolo", "dtInizioValidita", "dtFineValidita", "latitudine", "longitudine"].some(key => Object.hasOwn(value, key))) {
        if (++recordCount > 200) return null;
        const url = sameOriginUrl(value.url, sourceUrl);
        if (url) {
          const title = typeof value.titolo === "string" ? cleanText(value.titolo) : null;
          const date = normalizeSourceEventDate(value.dtInizioValidita);
          const end = normalizeSourceEventDate(value.dtFineValidita);
          const lat = coordinate(value.latitudine, 90);
          const lng = coordinate(value.longitudine, 180);
          const record = title && title.length <= 200 && date && end === date && lat !== null && lng !== null ? { title, date, lat, lng } : null;
          const previous = records.get(url);
          records.set(url, previous === undefined ? record : JSON.stringify(previous) === JSON.stringify(record) ? previous : null);
        }
      }
    }
    if (frame.next >= frame.keys.length) { stack.pop(); continue; }
    if (++inspected > 20000) return null;
    const value = frame.value[frame.keys[frame.next++]];
    if (value && typeof value === "object") stack.push({ value, keys: Object.keys(value), next: 0, depth: frame.depth + 1 });
  }
  return records;
}

function coordinate(value, limit) {
  if (typeof value !== "number" && !(typeof value === "string" && value.trim())) return null;
  const number = Number(value);
  return Number.isFinite(number) && Math.abs(number) <= limit ? number : null;
}

module.exports = { extractTransferStateEventCards };
