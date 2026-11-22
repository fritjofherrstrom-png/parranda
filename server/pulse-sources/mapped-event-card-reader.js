"use strict";

const { parse } = require("acorn");
const { attribute, hasClass, within, cleanText, sameOriginUrl, recordCardClaim } = require("./scheduled-event-document");
const { normalizeSourceEventDate } = require("./source-event-time");

// A closed SSR template family, not a city/domain or arbitrary map-centre
// fallback. Each card owns its heading, date, repeated title and address;
// geometry additionally needs an exact detail-URL AND title match.
function extractMappedEventCards(doc, { sourceUrl, explicitSingleDate, claims = new Map() }) {
  const owners = new Map();
  const groups = new Map();
  for (const node of doc.nodes) {
    let owner = owners.get(node.parentNode) || null;
    if (node.tagName === "article" || (node.tagName === "div" && hasClass(node, "card") && hasClass(node, "event-card"))) owner = null;
    if (node.tagName === "div" && hasClass(node, "flip-container")) {
      owner = node;
      groups.set(owner, []);
      if (groups.size > 200) return [];
    }
    owners.set(node, owner);
    if (owner) groups.get(owner).push(node);
  }
  if (!groups.size) return [];
  const markers = readMarkers(doc.scripts || [], sourceUrl);

  const language = attribute(doc.nodes.find(node => node.tagName === "html"), "lang");
  const cards = [];

  for (const own of groups.values()) {
    const fronts = own.filter(node => hasClass(node, "front"));
    const backs = own.filter(node => hasClass(node, "back"));
    const headings = own.filter(node => /^h[1-6]$/.test(node.tagName) && fronts.some(front => within(node, front)));
    const links = own.filter(node => node.tagName === "a" && headings.some(heading => within(node, heading)));
    const dates = own.filter(node => node.tagName === "p" && hasClass(node, "text-sm") && fronts.some(front => within(node, front)));
    const date = dates.length === 1 ? mappedDate(doc.texts.get(dates[0]), language, explicitSingleDate) : null;
    // Negative-only identity claims precede every positive card/date/contact
    // filter. An unsupported sibling must not erase its conflicting heading.
    for (const link of links) {
      const url = sameOriginUrl(attribute(link, "href"), sourceUrl);
      const title = doc.texts.get(link);
      if (!url || url === sourceUrl || !title || title.length > 200) continue;
      recordCardClaim(claims, url, title, date, dates.length);
    }
    if (fronts.length !== 1 || backs.length !== 1 || headings.length !== 1 || links.length !== 1 || dates.length !== 1) continue;
    const url = sameOriginUrl(attribute(links[0], "href"), sourceUrl);
    const title = doc.texts.get(links[0]);
    if (!url || url === sourceUrl || !title || title.length > 200) continue;
    if (!date) continue;
    const repeated = own.filter(node => node.tagName === "p" && within(node, backs[0]) && doc.texts.get(node) === title);
    const addresses = own.filter(node => node.tagName === "address" && within(node, backs[0]));
    const details = own.filter(node => node.tagName === "a" && within(node, backs[0]) && sameOriginUrl(attribute(node, "href"), sourceUrl) === url);
    if (repeated.length !== 1 || addresses.length !== 1 || details.length !== 1) continue;
    const address = doc.texts.get(addresses[0]);
    const marker = markers?.get(url);
    if (!address || address.length > 200 || !marker || marker.title !== title) continue;
    cards.push({ url, title, date, contact: { address, place_context: address, lat: marker.lat, lng: marker.lng } });
  }
  return cards.filter(card => claims.get(card.url) !== null);
}

function mappedDate(label, language, explicitSingleDate) {
  const date = explicitSingleDate(label);
  if (date) return date;
  // Numeric order comes only from explicit French language and this exact
  // grammar, never from a hostname, an anchor or the current clock.
  const french = /^fr(?:-|$)/i.test(language) && String(label || "").match(/^Le (\d{2})\/(\d{2})\/(20\d{2})$/);
  return french ? normalizeSourceEventDate(`${french[3]}-${french[2]}-${french[1]}`) : null;
}

function readMarkers(scripts, sourceUrl) {
  const configs = [];
  if (scripts.length > 32) return null;
  for (const node of scripts) {
    if (attribute(node, "src") || !["", "text/javascript", "application/javascript"].includes(attribute(node, "type"))) continue;
    const text = (node.childNodes || []).map(child => child.value || "").join("");
    if (!text.includes("mapConfig")) continue;
    if (text.length > 128 * 1024) return null;
    const values = staticMapConfigs(text);
    if (!values) return null;
    configs.push(...values);
    if (configs.length > 1) return null;
  }
  if (configs.length !== 1 || !Array.isArray(configs[0]?.markers) || configs[0].markers.length > 200) return null;
  const grouped = new Map();
  for (const item of configs[0].markers) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const url = typeof item.url === "string" ? sameOriginUrl(item.url, sourceUrl) : null;
    if (!url) continue;
    const lat = coordinate(item.lat, 90);
    const lng = coordinate(item.lng, 180);
    const title = typeof item.name === "string" ? cleanText(item.name) : null;
    const value = title && title.length <= 200 && lat !== null && lng !== null ? { title, lat, lng } : null;
    const existing = grouped.get(url);
    // Invalid or conflicting duplicates withdraw this URL's geometry; they
    // cannot disappear before joining with a valid-looking sibling marker.
    grouped.set(url, existing === undefined ? value : JSON.stringify(existing) === JSON.stringify(value) ? existing : null);
  }
  return grouped;
}

function coordinate(value, limit) {
  if (typeof value !== "number" && !(typeof value === "string" && value.trim())) return null;
  const number = Number(value);
  return Number.isFinite(number) && Math.abs(number) <= limit ? number : null;
}

// Parse syntax, never execute publisher JS or guess slash/regexp state.
// Only a complete, noncomputed JSON object property supplies marker facts.
function staticMapConfigs(source) {
  let root;
  try { root = parse(source, { ecmaVersion: "latest", sourceType: "script", preserveParens: true }); }
  catch (_) { return null; }
  const values = [];
  const stack = [{ node: root, depth: 0 }];
  let inspected = 0;
  while (stack.length) {
    const { node, depth } = stack.pop();
    if (++inspected > 20000 || depth > 256) return null;
    // Quoted/regexp/template examples cannot lend executable object fields.
    if (["Literal", "TemplateLiteral", "TaggedTemplateExpression"].includes(node.type)) continue;
    if (node.type === "ObjectExpression") {
      const configs = node.properties.filter(property => {
        const key = property.key;
        return key?.type === "Identifier" ? key.name === "mapConfig" : key?.type === "Literal" && key.value === "mapConfig";
      });
      if (configs.length) {
        // A spread/computed sibling could replace this field under another
        // runtime key. Unsupported ambiguity is never positive map evidence.
        if (configs.length !== 1 || node.properties.some(property => property.type !== "Property" || property.computed)) return null;
        const property = configs[0];
        if (property.kind !== "init" || property.method || property.shorthand || property.value.type !== "ObjectExpression") return null;
        try { values.push(JSON.parse(source.slice(property.value.start, property.value.end))); }
        catch (_) { return null; }
        if (values.length > 1) return null;
      }
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) {
        for (const child of value) if (child && typeof child.type === "string") stack.push({ node: child, depth: depth + 1 });
      } else if (value && typeof value.type === "string") stack.push({ node: value, depth: depth + 1 });
    }
  }
  return values;
}

module.exports = { extractMappedEventCards };
