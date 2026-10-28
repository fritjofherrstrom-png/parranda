"use strict";

const { parse } = require("parse5");
const { fold, isProgramMarker, isStopMarker } = require("./official-program-article-document");
const { parseTimeRange } = require("./official-program-article-time");

const IGNORED = new Set(["script", "style", "svg", "form", "nav", "footer", "header", "template"]);
const WEEKDAYS = [
  "sunday sondag domingo diumenge dimanche domenica sonntag zondag",
  "monday mandag lunes dilluns lundi lunedi montag maandag",
  "tuesday tisdag martes dimarts mardi martedi dienstag dinsdag",
  "wednesday onsdag miercoles dimecres mercredi mercoledi mittwoch woensdag",
  "thursday torsdag jueves dijous jeudi giovedi donnerstag donderdag",
  "friday fredag viernes divendres vendredi venerdi freitag vrijdag",
  "saturday lordag sabado dissabte samedi sabato samstag zaterdag",
].map((words) => new Set(words.split(" ")));
const ARCHIVE = /\b(?:archives?|archived|history|historical|previous editions|retrospective|recap|arkiv|historik|tidigare upplagor|historia|ediciones anteriores|retrospectiva|arxiu|edicions anteriors|histoire|editions precedentes)\b/;

// Closed grammar: a named semantic programme region, its h2 locality, h3
// numeric days, and h4 cards with their own address and separate clock fields.
// Null releases unrelated legacy grammars. An owned but malformed card region
// returns an empty collection, never falling back to booking prose or years.
function collectCardEventProgramme(html) {
  const document = parse(String(html || ""));
  const raw = descendants(document, { raw: true });
  const candidates = raw.filter((node) => semanticRegion(node) && cardShape(node));
  const container = candidates.find((node) => !candidates.some((other) => other !== node && within(other, node)));
  if (!container) return null;
  const result = emptyCollection();
  // Template fragments have no parent link to their owning <template> in
  // parse5. Membership in the visible traversal also closes that boundary.
  if (!descendants(document).includes(container)) return result;
  for (let branch = container, parent = branch.parentNode; parent; branch = parent, parent = parent.parentNode) {
    if (semanticRegion(parent) && ARCHIVE.test(fold(attribute(parent, "aria-label")))) return result;
    const preceding = (parent.childNodes || []).slice(0, (parent.childNodes || []).indexOf(branch));
    const ownerHeading = preceding.filter(node => /^h[1-6]$/.test(node.tagName) && !excludedNode(node)).at(-1);
    if (ARCHIVE.test(fold(textOf(ownerHeading)))) return result;
  }
  const nodes = descendants(container, { scoped: true });
  const title = attribute(container, "aria-label").replace(/\s+/g, " ").trim();
  const years = title.match(/\b20\d{2}\b/g) || [];
  const namedTitle = title.split(/\s+/).slice(1).join(" ").replace(/\b20\d{2}\b/g, "").trim();
  const documentTitle = descendants(document).find((node) => node.tagName === "h1");
  if (!isProgramMarker(title.split(/\s+/)[0]) || title.length > 160 || years.length !== 1 || namedTitle.length < 2 || ARCHIVE.test(fold(title)) || ARCHIVE.test(fold(textOf(documentTitle)))) return result;
  const year = Number(years[0]);
  const firstDay = nodes.findIndex((node) => node.tagName === "h3");
  if (firstDay < 0) return result;
  const localities = nodes.slice(0, firstDay).filter((node) => node.tagName === "h2");
  if (localities.length !== 1 || !validName(textOf(localities[0]))) return result;
  const locality = textOf(localities[0]);
  // A later locality heading closes this single-locality grammar. Raw scope
  // supplies barriers only: a hidden h2 must not lend the first locality to a
  // later visible day, but it can never establish positive factual evidence.
  const rawScope = descendants(container, { raw: true, scoped: true });
  const stop = rawScope.findIndex((node) =>
    (node.tagName === "h2" && node !== localities[0]) ||
    (/^h[1-6]$/.test(node.tagName) && (isStopMarker(textOf(node)) || ARCHIVE.test(fold(textOf(node))))));
  const beforeStop = new Set(stop < 0 ? rawScope : rawScope.slice(0, stop));
  const programmeNodes = nodes.filter(node => beforeStop.has(node));
  const days = programmeNodes.filter((node) => node.tagName === "h3");
  const alternatives = days.map((node) => dayAlternatives(textOf(node), year)).filter(Boolean);
  const dayMonthEstablished = alternatives.some((day) => day.dayMonth && !day.monthDay) && !alternatives.some((day) => day.monthDay && !day.dayMonth);
  result.page_title = title;
  result.programme_title = title;
  result.page_year = year;
  result.program_section_count = 1;
  const allowed = new Set(programmeNodes);
  for (const heading of days) {
    const options = dayAlternatives(textOf(heading), year);
    const date = options?.dayMonth;
    if (!date || (!dayMonthEstablished && options.monthDay && date.start.day !== date.start.month)) continue;
    // Only following sibling branches of this h3 can supply its venue cards.
    // A day in another column or below an unsupported heading cannot inherit it.
    const siblings = heading.parentNode.childNodes || [];
    for (const branch of siblings.slice(siblings.indexOf(heading) + 1)) {
      // An invisible heading cannot supply a date, but still separates cards
      // from the preceding day. It must not disappear into date inheritance.
      if ([branch, ...descendants(branch, { raw: true })].some((node) => /^h[1-35-6]$/.test(node.tagName))) break;
      if (excludedNode(branch)) continue;
      if (semanticRegion(branch)) break;
      for (const venueHeading of [branch, ...descendants(branch, { scoped: true })].filter((node) => node.tagName === "h4" && allowed.has(node))) {
        const card = readCard(venueHeading);
        if (!card) continue;
        for (const time of card.times) {
          result.rows.push({ title: card.name, date_range: date, time, states_daily: false, venue: `${card.name}, ${card.address}, ${locality}`, area: locality, program_marker: title });
        }
      }
    }
  }
  result.candidate_row_count = result.rows.length;
  result.timed_row_count = result.rows.length;
  result.recognized = result.timed_row_count >= 2;
  return result;
}

function readCard(heading) {
  const name = textOf(heading);
  if (!validName(name)) return null;
  const header = heading.parentNode;
  const headerChildren = elements(header);
  const afterHeading = headerChildren.slice(headerChildren.indexOf(heading) + 1);
  const addresses = afterHeading.filter(leafSpan);
  if (addresses.length !== 1 || !validName(textOf(addresses[0]))) return null;
  const address = textOf(addresses[0]);
  const preceding = headerChildren.slice(0, headerChildren.indexOf(heading));
  const featuredTimes = preceding.filter(leafSpan).map((node) => clockField(textOf(node))).filter(Boolean);
  if (featuredTimes.length) {
    if (preceding.some(node => !rowKeepsCardVenue(textOf(node), name, address))) return null;
    if (featuredTimes.length !== 1 || descendants(header).filter((node) => /^h[1-6]$/.test(node.tagName)).length !== 1) return null;
    return { name, address, times: featuredTimes };
  }
  if (preceding.length) return null;
  const card = header.parentNode;
  if (!card || descendants(card).filter((node) => /^h[1-6]$/.test(node.tagName)).length !== 1) return null;
  const children = elements(card);
  const times = children.slice(children.indexOf(header) + 1).filter((node) => node.tagName === "div").map((row) => {
    const fields = elements(row);
    if (fields.length !== 2 || !fields.every(leafSpan) || !textOf(fields[1]) || hasOwnText(row)) return null;
    if (!rowKeepsCardVenue(textOf(fields[1]), name, address)) return null;
    return clockField(textOf(fields[0]));
  }).filter(Boolean);
  return times.length ? { name, address, times } : null;
}

// We do not interpret arbitrary activity prose as another venue. When it
// explicitly points somewhere, the card address is safe only if that target
// still names this same venue/address; otherwise leave the row unread.
function rowKeepsCardVenue(activity, name, address) {
  const ownName = fold(name);
  const ownAddress = fold(address);
  // Keep original case: a lowercase activity object ("prova på minigolf")
  // is not a named location. Weak i/in/en/im also occur inside work titles
  // and language labels; only an explicit street-number clause closes them.
  const locations = activity.matchAll(/(?:^|[\s,;])(på|pa|vid|hos|i|at|in|au|aux|chez|im|bei|presso|en|al)\s+([^;.!?]+)/giu);
  for (const match of locations) {
    const originalTarget = match[2].trim().replace(/^["'«“”‘’]+/, "");
    const hasAddress = /\p{L}[\p{L}.]*\s+\d+[a-z]?(?:$|[\s,])/iu.test(originalTarget);
    if (!hasAddress && (/^(?:i|in|en|im)$/i.test(match[1]) || !/^\p{Lu}/u.test(originalTarget))) continue;
    const target = fold(originalTarget);
    const startsWith = (value) => target === value || target.startsWith(value + " ") || target.startsWith(value + ",");
    if (!startsWith(ownName) && !startsWith(ownAddress)) return false;
    if (hasAddress && !target.includes(ownAddress)) return false;
  }
  return true;
}

// Whole hours are accepted ONLY here, in an isolated publisher-owned field,
// and only as an explicit interval. Never send arbitrary prose to the shared
// permissive clock extractor, or turn an unknown end into a fabricated one.
function clockField(value) {
  const match = value.match(/^([01]?\d|2[0-3])(?:[:.]([0-5]\d))?(?:\s*[-–—]\s*([01]?\d|2[0-3])(?:[:.]([0-5]\d))?)?$/);
  if (!match || (!match[3] && match[2] === undefined)) return null;
  const start = Number(match[1]) * 60 + Number(match[2] || 0);
  const end = match[3] === undefined ? null : Number(match[3]) * 60 + Number(match[4] || 0);
  if (end !== null && end <= start) return null;
  const clock = (hour, minute) => `${String(hour).padStart(2, "0")}:${String(minute || 0).padStart(2, "0")}`;
  return parseTimeRange(clock(match[1], match[2]) + (end === null ? "" : `–${clock(match[3], match[4])}`));
}

function dayAlternatives(value, year) {
  // Inline spans may visually adjoin the weekday and date without whitespace.
  const match = fold(value).match(/^(?:([\p{L}]+)\s*)?(\d{1,2})\s*\/\s*(\d{1,2})$/u);
  if (!match) return null;
  const checked = (month, day) => {
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day || (match[1] && !WEEKDAYS[date.getUTCDay()].has(match[1]))) return null;
    const parts = { year, month, day };
    return { start: parts, end: { ...parts } };
  };
  return { dayMonth: checked(Number(match[3]), Number(match[2])), monthDay: checked(Number(match[2]), Number(match[3])) };
}

function cardShape(node) {
  const nodes = descendants(node, { raw: true });
  const labelledProgramme = isProgramMarker(attribute(node, "aria-label"));
  // Raw structure owns malformed/hidden cards too, but supplies no facts.
  const fields = nodes.some((child) => child.tagName === "div" && (child.childNodes || []).filter((field) => field.tagName === "span").length >= 2);
  return fields && nodes.some((child) => child.tagName === "h4") && (labelledProgramme || nodes.some((child) => child.tagName === "h3"));
}

function semanticRegion(node) {
  return node.tagName === "section" || node.tagName === "article" || attribute(node, "role").toLowerCase() === "region";
}

function validName(value) {
  return value.length >= 2 && value.length <= 140 && value.split(/\s+/).length <= 18 && /\p{L}/u.test(value) && !isStopMarker(value) && !isProgramMarker(value) && !ARCHIVE.test(fold(value)) && !/\d{1,2}\s*\/\s*\d{1,2}/.test(value) && !parseTimeRange(value);
}

function attribute(node, name) {
  return node?.attrs?.find((attr) => attr.name === name)?.value || "";
}

function excludedNode(node) {
  return IGNORED.has(node?.tagName) || node?.attrs?.some((attr) => attr.name === "hidden" || attr.name === "inert" || (attr.name === "aria-hidden" && attr.value.trim().toLowerCase() === "true")) || /(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*(?:hidden|collapse))\s*(?:!important\s*)?(?:;|$)/i.test(attribute(node, "style"));
}

function within(node, ancestor) {
  for (let current = node.parentNode; current; current = current.parentNode) if (current === ancestor) return true;
  return false;
}

function descendants(node, { raw = false, scoped = false } = {}) {
  const nodes = [];
  function visit(current) {
    for (const child of current?.childNodes || []) {
      if ((!raw && excludedNode(child)) || (scoped && semanticRegion(child))) continue;
      nodes.push(child);
      visit(child);
    }
    if (raw && current?.content) visit(current.content);
  }
  visit(node);
  return nodes;
}

function textOf(node) {
  if (!node || excludedNode(node)) return "";
  if (node.nodeName === "#text") return node.value;
  return (node.childNodes || []).map(textOf).join("").replace(/\s+/g, " ").trim();
}

function elements(node) {
  return (node?.childNodes || []).filter((child) => child.tagName && !excludedNode(child));
}

function leafSpan(node) {
  return node.tagName === "span" && !elements(node).length && !excludedNode(node);
}

function hasOwnText(node) {
  return (node.childNodes || []).some((child) => child.nodeName === "#text" && child.value.trim());
}

function emptyCollection() {
  return { recognized: false, page_title: null, page_year: null, program_section_count: 0, candidate_row_count: 0, timed_row_count: 0, all_day_row_count: 0, rows: [] };
}

module.exports = { collectCardEventProgramme };
