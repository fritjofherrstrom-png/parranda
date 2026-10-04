"use strict";

const { createHash } = require("node:crypto");
const { normalizeSourceEventDate } = require("./source-event-time");
const { parseDateRange } = require("./official-program-article-time");
const { boundedDocument, attribute, hasClass, ownedBy, within, cleanText, sameOriginUrl } = require("./scheduled-event-document");

function explicitSingleDate(value) {
  const text = cleanText(value);
  const iso = normalizeSourceEventDate(text);
  if (iso) return iso;
  // Exact single date grammar: no inferred year, weekday expansion, time,
  // period, prose, or numeric date whose month/day order is ambiguous.
  const match = text.match(/^\d{1,2} [\p{L}]+ (20\d{2})$/u);
  if (!match) return null;
  const range = parseDateRange(text, Number(match[1]));
  if (!range || JSON.stringify(range.start) !== JSON.stringify(range.end)) return null;
  return `${range.start.year}-${String(range.start.month).padStart(2, "0")}-${String(range.start.day).padStart(2, "0")}`;
}

function extractScheduledEventCards(html, { sourceUrl } = {}) {
  if (!/\bnode--type-event\b/.test(String(html || ""))) return { recognized: false, cards: [] };
  if (!sameOriginUrl(sourceUrl, sourceUrl)) return { recognized: false, cards: [] };
  const doc = boundedDocument(html);
  if (!doc) return { recognized: false, cards: [] };
  const articles = doc.nodes.filter((node) => node.tagName === "article" && hasClass(node, "node--type-event"));
  if (articles.length > 200) return { recognized: false, cards: [] };
  const cards = [];
  for (const article of articles) {
    const own = doc.nodes.filter((node) => doc.articleOwners.get(node) === article);
    const headings = own.filter((node) => /^h[1-6]$/.test(node.tagName) && hasClass(node, "node--title"));
    if (!headings.length || headings.length > 2) continue;
    const links = own.filter((node) => node.tagName === "a" && headings.some((heading) => within(node, heading)));
    const identities = links.map((node) => ({
      url: sameOriginUrl(attribute(node, "href"), sourceUrl),
      title: doc.texts.get(node),
    }));
    if (!identities.length || identities.length > 4 || identities.some((item) => !item.url || item.url === sourceUrl || !item.title || item.title.length > 200)) continue;
    const unique = [...new Set(identities.map((item) => `${item.url}|${item.title}`))];
    if (unique.length !== 1) continue;
    const schedules = own.filter((node) => hasClass(node, "field--name-field-schedule"));
    if (schedules.length !== 1) continue;
    const date = explicitSingleDate(doc.texts.get(schedules[0]));
    if (!date) continue;
    cards.push({ ...identities[0], date });
  }
  // Conflicting dates/titles for a detail identity fail closed. This adapter
  // currently supports one explicit occurrence per identity, not recurrence.
  const grouped = new Map();
  for (const card of cards) {
    const values = grouped.get(card.url) || [];
    values.push(card);
    grouped.set(card.url, values);
  }
  const unique = [...grouped.values()].filter((values) =>
    new Set(values.map((card) => `${card.title}|${card.date}`)).size === 1,
  ).map((values) => values[0]);
  return { recognized: unique.length >= 2, cards: unique };
}

function extractScheduledEventContact(html, card) {
  const doc = boundedDocument(html);
  if (!doc) return null;
  const canonical = doc.nodes.filter((node) => node.tagName === "link" && attribute(node, "rel").split(/\s+/).includes("canonical"));
  if (canonical.length !== 1 || sameOriginUrl(attribute(canonical[0], "href"), card.url) !== card.url) return null;
  const titles = doc.nodes.filter((node) => node.tagName === "h1");
  if (titles.length !== 1 || doc.texts.get(titles[0]) !== card.title) return null;
  const events = doc.nodes.filter((node) => node.tagName === "article" && hasClass(node, "node--type-event") && hasClass(node, "node--view-mode-full"));
  if (events.length !== 1) return null;
  const fields = doc.nodes.filter((node) => hasClass(node, "field--name-field-contact") && ownedBy(node, events[0]));
  if (fields.length !== 1) return null;
  const contacts = doc.nodes.filter((node) => node.tagName === "article" && hasClass(node, "node--type-contact") && ownedBy(node, fields[0]));
  if (contacts.length !== 1) return null;
  const addresses = doc.nodes.filter((node) => attribute(node, "typeof") === "PostalAddress" && attribute(node, "property") === "address" && ownedBy(node, contacts[0]));
  if (addresses.length !== 1) return null;
  const own = doc.nodes.filter((node) => ownedBy(node, contacts[0]) && within(node, addresses[0]));
  const part = (name) => {
    const nodes = own.filter((node) => attribute(node, "property") === name);
    return nodes.length === 1 ? doc.texts.get(nodes[0]) : null;
  };
  const street = part("streetAddress");
  const city = part("addressLocality");
  const postalCode = part("postalCode");
  if (!street || !city || street.length > 120 || city.length > 80 || (postalCode && postalCode.length > 20)) return null;
  // A contact can be a publisher's office. Require the event's own geographic
  // field to explicitly route to this exact postal address before calling it
  // an event venue. Map centers and other contact-entity markers never join.
  const locations = doc.nodes.filter((node) => hasClass(node, "field--name-field-geofield") && ownedBy(node, events[0]));
  if (locations.length !== 1) return null;
  const routes = doc.nodes.filter((node) => node.tagName === "a" && hasClass(node, "button--map-route-link") && ownedBy(node, events[0]) && within(node, locations[0]));
  if (routes.length !== 1 || !routeMatchesAddress(attribute(routes[0], "href"), { street, postalCode, city })) return null;
  const address = [street, postalCode, city].filter(Boolean).join(", ");
  if (address.length > 200) return null;
  const headings = doc.nodes.filter((node) => /^h[1-6]$/.test(node.tagName) && ownedBy(node, contacts[0]));
  const venue = headings.length === 1 ? doc.texts.get(headings[0]) : null;
  return { address, city, place_context: venue && venue.length <= 120 ? venue : street };
}

function routeMatchesAddress(href, { street, postalCode, city }) {
  try {
    const url = new URL(href);
    if (url.protocol !== "https:" || url.hostname !== "www.google.com" || url.pathname !== "/maps/dir/" || url.username || url.password || url.searchParams.get("api") !== "1") return false;
    if (url.searchParams.getAll("destination").length !== 1) return false;
    const normalize = (value) => cleanText(value).normalize("NFC").toLowerCase().replace(/,\s*/g, " ");
    const expected = normalize([street, postalCode, city].filter(Boolean).join(" "));
    const destination = normalize(url.searchParams.get("destination"));
    return destination === expected || (destination.startsWith(`${expected} `) && /^[a-z]{2}$/.test(destination.slice(expected.length + 1)));
  } catch (_) { return false; }
}

function scheduledCardEvent(card, contact, { timezone, sourceLanguage, listingUrl }) {
  const id = createHash("sha256").update(`${card.url}|${card.date}`).digest("hex").slice(0, 24);
  return {
    id, title: card.title, ...contact,
    starts_on: card.date, ends_on: card.date,
    // Listed date with unknown hours must not become a midnight instant or
    // an assertion that a market is open all day / currently open.
    time_window: { kind: "occurrences", dates: [card.date], starts_on: card.date, ends_on: card.date, timezone },
    source_url: card.url, source_language: sourceLanguage, event_language: sourceLanguage,
    provenance: { source_url: card.url, source_page: listingUrl, source_record_id: id },
  };
}

module.exports = { extractScheduledEventCards, extractScheduledEventContact, scheduledCardEvent };
