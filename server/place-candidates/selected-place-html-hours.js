"use strict";

const { parse } = require("parse5");

// A deliberately closed reader for an existing selected identity. It does not
// discover places, infer ownership from a hostname, or promote place trust.
const MAX_BYTES = 512 * 1024;
const MAX_NODES = 12000;
const MAX_DEPTH = 64;
const DAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
const DAY_NAMES = ["monday|mandag(?:ar)?", "tuesday|tisdag(?:ar)?", "wednesday|onsdag(?:ar)?", "thursday|torsdag(?:ar)?", "friday|fredag(?:ar)?", "saturday|lordag(?:ar)?", "sunday|sondag(?:ar)?"];
const DAY_PATTERN = DAY_NAMES.map(value => `(?:${value})`).join("|");
const MONTHS = ["january|januari", "february|februari", "march|mars", "april", "may|maj", "june|juni", "july|juli", "august|augusti", "september", "october|oktober", "november", "december"];
const MONTH_PATTERN = MONTHS.map(value => `(?:${value})`).join("|");
const fold = value => String(value || "").normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[–—−]/g, "-").replace(/\s+/g, " ").trim();
const name = value => fold(value).replace(/[^a-z0-9]+/g, " ").trim();
const hoursHeading = value => /^(?:oppettider|opening hours)$/.test(fold(value));
const exceptionText = value => /helgdag|avvikande|holiday|exception|special hours/.test(fold(value));
const serviceHeading = value => /\b(?:cafe|intake|inlamning|goods|guided tours?|visningar|member|medlem|meetings?)\b/.test(fold(value));
const serviceLabel = value => serviceHeading(value) && (/\b(?:hours|oppettider)\b/.test(fold(value)) || /^(?:cafe|guided tours?|visningar|goods intake|member meetings?)$/.test(fold(value)));
const closureNotice = value => /\b(?:closed|stangt|stangning|renovat\w*)\b/.test(fold(value));
const attr = (node, key) => node.attrs?.find(value => value.name === key)?.value || "";

function safeUrl(value, base) {
  try {
    if (typeof value !== "string" || value.length > 2048) return null;
    const authority = value.match(/^(?:https?:)?\/\/([^/?#]+)/i)?.[1];
    if (authority?.includes(":")) return null; // No explicit ports or IPv6 literals.
    const url = new URL(value, base);
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.port || url.search || url.hash) return null;
    url.protocol = "https:";
    return url;
  } catch { return null; }
}

function documentView(html) {
  if (typeof html !== "string" || Buffer.byteLength(html) > MAX_BYTES) return null;
  const root = parse(html), nodes = [], identityNodes = [], stack = [[root, 0, false]];
  while (stack.length) {
    const [node, depth, chrome] = stack.pop();
    if (depth > MAX_DEPTH || identityNodes.length >= MAX_NODES) return null;
    if (["script", "style", "form", "noscript", "template"].includes(node.tagName) ||
        node.attrs?.some(value => value.name === "hidden" || (value.name === "aria-hidden" && value.value === "true"))) continue;
    identityNodes.push(node);
    const excluded = chrome || ["nav", "header", "footer"].includes(node.tagName);
    if (!excluded) nodes.push(node);
    const children = node.childNodes || [];
    for (let i = children.length - 1; i >= 0; i--) stack.push([children[i], depth + 1, excluded]);
  }
  // Bottom-up bounded text avoids recursion and unbounded ancestor strings.
  const texts = new Map();
  for (let i = identityNodes.length - 1; i >= 0; i--) {
    const node = identityNodes[i];
    texts.set(node, node.nodeName === "#text" ? node.value.slice(0, 8192) :
      (node.childNodes || []).map(child => texts.get(child) || "").join(" ").replace(/\s+/g, " ").trim().slice(0, 8192));
  }
  const mains = nodes.filter(node => node.tagName === "main");
  return mains.length === 1 ? { nodes, identityNodes, main: mains[0], text: node => texts.get(node) || "" } : null;
}

function within(node, parent) {
  for (let depth = 0; node && depth <= MAX_DEPTH; depth++, node = node.parentNode) if (node === parent) return true;
  return false;
}

function identifiedView(html, record, sourceUrl) {
  const entry = safeUrl(record?.website), source = safeUrl(sourceUrl), view = documentView(html);
  if (!entry || !source || !view || source.origin !== entry.origin || !name(record?.name)) return null;
  const title = view.nodes.filter(node => node.tagName === "title");
  if (title.length !== 1 || !view.text(title[0]).split(/\s+[–—|\-]\s+/).some(segment => name(segment) === name(record.name))) return null;
  // A document's single visible hero h1 may sit before main. Only the fact
  // section itself must be inside main.
  const headings = view.nodes.filter(node => node.tagName === "h1");
  if (headings.length !== 1) return null;
  const h1 = view.text(headings[0]), h1Name = name(h1), wanted = name(record.name);
  // Navigation remains excluded from schedule facts. Its exact named link to
  // this candidate can still establish the document's parent identity.
  const breadcrumb = view.identityNodes.some(node => node.tagName === "a" && !within(node, view.main) && name(view.text(node)) === wanted &&
    safeUrl(attr(node, "href"), source)?.toString() === entry.toString());
  // An institutional type description is narrower than an arbitrary name
  // suffix: Cafe, Annex and other branch/service qualifiers are not aliases.
  const museumDescription = record.type === "museum" && source.toString() === entry.toString() &&
    name(h1.slice(0, record.name.length)) === wanted &&
    /^(?:[\p{Lu}][\p{L}]* ){0,2}(?:universitetsmuseum|University Museum|university museum)$/u.test(h1.slice(record.name.length).trim());
  if (h1Name !== wanted && !(breadcrumb && (hoursHeading(h1) || museumDescription))) return null;
  const general = view.nodes.filter(node => /^h[1-6]$/.test(node.tagName) && within(node, view.main) && hoursHeading(view.text(node)));
  if (general.length !== 1) return null;
  const start = view.nodes.indexOf(general[0]), rank = Number(general[0].tagName[1]);
  let end = view.nodes.length;
  for (let i = start + 1; i < view.nodes.length; i++) {
    const node = view.nodes[i];
    if (!within(node, view.main)) { end = i; break; }
    if (/^h[1-6]$/.test(node.tagName) && Number(node.tagName[1]) <= rank) { end = i; break; }
  }
  return { ...view, entry, source, scope: view.nodes.slice(start + 1, end) };
}

function descendant(url, entry) {
  const prefix = entry.pathname.replace(/\/$/, "") + "/";
  return url.origin === entry.origin && url.pathname.startsWith(prefix) && url.pathname !== prefix;
}

function unscopedConditions(view, { serviceOnly = false } = {}) {
  const assertions = new Set(view.scope.filter(node => /^(?:p|li|h[1-6])$/.test(node.tagName)));
  // Only paragraph/list/heading assertions have supported grammar. A visible
  // condition in another container must remain unknown, not disappear merely
  // because a complete week elsewhere was readable. Navigation is excluded
  // by documentView; normal weekly closures inside assertions are parsed below.
  return view.scope.some(node => {
    if (node.nodeName !== '#text') return false;
    for (let parent = node.parentNode, depth = 0; parent && depth <= MAX_DEPTH; parent = parent.parentNode, depth++) {
      if (assertions.has(parent)) return false;
    }
    const value = fold(view.text(node));
    if (serviceOnly) return serviceLabel(value);
    return /\b\d{4}\b/.test(value) || closureNotice(value) || exceptionText(value) || serviceLabel(value);
  });
}

function selectedPlaceHtmlHoursLink(html, record, sourceUrl) {
  const view = identifiedView(html, record, sourceUrl);
  if (!view || view.source.toString() !== view.entry.toString()) return null;
  // A current-status badge or an entry's unresolved date condition cannot
  // supply the selected-day fact. The actual linked document is read instead;
  // a service label must still prevent borrowing another service's hours.
  if (unscopedConditions(view, { serviceOnly: true })) return null;
  if (view.scope.some(node => /^(?:p|li|h[1-6])$/.test(node.tagName) && serviceLabel(view.text(node)))) return null;
  const links = new Set();
  let invalid = false;
  for (const node of view.scope) {
    if (node.tagName !== "a") continue;
    const label = fold(view.text(node));
    if (!/(?:oppettider|opening hours|exceptional hours|special hours)/.test(label) || serviceHeading(label) || /\b(?:pris|price|ticket|biljett|contact|kontakt)\b/.test(label)) continue;
    const url = safeUrl(attr(node, "href"), view.source);
    if (!url || !descendant(url, view.entry)) { invalid = true; continue; }
    links.add(url.toString());
  }
  return !invalid && links.size === 1 ? [...links][0] : null;
}

function validDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(value + "T12:00:00Z");
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? date : null;
}

function monthDay(day, month) {
  const date = new Date(Date.UTC(2000, month - 1, day));
  return date.getUTCMonth() + 1 === month && date.getUTCDate() === day ? month * 100 + day : null;
}

function seasonRange(value) {
  const match = fold(value).match(new RegExp(`^(\\d{1,2}) (${MONTH_PATTERN})\\s*-\\s*(\\d{1,2}) (${MONTH_PATTERN})$`));
  if (!match) return null;
  const month = value => MONTHS.findIndex(pattern => new RegExp(`^(?:${pattern})$`).test(value)) + 1;
  const start = monthDay(Number(match[1]), month(match[2])), end = monthDay(Number(match[3]), month(match[4]));
  return start && end ? { start, end, week: new Map(), invalid: false, lateDays: new Set(), late: false } : null;
}

function clock(value) {
  const match = value.trim().match(/^(\d{1,2})(?:[.:](\d{2}))?\s*(am|pm)?$/);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2] || 0);
  if (minute > 59 || hour > 24 || (hour === 24 && minute) || (match[3] && (hour < 1 || hour > 12))) return null;
  if (match[3]) hour = hour % 12 + (match[3] === "pm" ? 12 : 0);
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function weeklyRule(value) {
  const match = fold(value).match(new RegExp(`^(${DAY_PATTERN})(?:\\s*-\\s*(${DAY_PATTERN}))?\\s*(?::|kl\\.?)?\\s*(.+)$`));
  if (!match) return null;
  const index = day => DAY_NAMES.findIndex(pattern => new RegExp(`^(?:${pattern})$`).test(day));
  const first = index(match[1]), last = index(match[2] || match[1]), days = [];
  for (let i = first; days.length < 7; i = (i + 1) % 7) { days.push(i); if (i === last) break; }
  let rule;
  if (/^(?:stangt|closed|off)$/.test(match[3])) rule = "off";
  else {
    const times = match[3].split(/\s*-\s*/);
    if (times.length !== 2) return null;
    const opens = clock(times[0]), closes = clock(times[1]);
    if (!opens || !closes || opens >= closes || opens === "24:00") return null;
    rule = `${opens}-${closes}`;
  }
  return { days, rule };
}

function holidayRange(value, year) {
  const match = fold(value).match(/^(\d{1,2})(?:\s*-\s*(\d{1,2}))?\/(\d{1,2})(?:\s*-\s*(\d{1,2})\/(\d{1,2}))?(?:\s|$)/);
  if (!match || !year) return null;
  const startDay = Number(match[1]), startMonth = Number(match[3]);
  const endDay = Number(match[4] || match[2] || match[1]), endMonth = Number(match[5] || match[3]);
  const start = monthDay(startDay, startMonth), end = monthDay(endDay, endMonth);
  if (!start || !end || (match[2] && match[4])) return null;
  const iso = (y, m, d) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const from = iso(year, startMonth, startDay), through = iso(year + (end < start ? 1 : 0), endMonth, endDay);
  return validDate(from) && validDate(through) ? { from, through } : null;
}

function parseSelectedPlaceHtmlHours(html, record, { date, sourceUrl, entryHtml, entrySourceUrl } = {}) {
  const selected = validDate(date), view = identifiedView(html, record, sourceUrl);
  if (!selected || !view) return null;
  if (unscopedConditions(view)) return null;
  if (view.source.toString() !== view.entry.toString()) {
    if (!descendant(view.source, view.entry) || safeUrl(entrySourceUrl)?.toString() !== view.entry.toString() ||
        selectedPlaceHtmlHoursLink(entryHtml, record, entrySourceUrl) !== view.source.toString()) return null;
  }
  // An advertised exception page is read before accepting the shortened week.
  if (view.scope.some(node => node.tagName === "a" && exceptionText(view.text(node)))) return null;
  if (view.scope.some(node => /^h[1-6]$/.test(node.tagName) && serviceHeading(view.text(node)))) return null;
  // A sibling exception section belongs to the same identified document, even
  // when the general hours h2 ends before it. Its grammar is not merged here.
  const scopeSet = new Set(view.scope);
  if (view.nodes.some(node => within(node, view.main) && !scopeSet.has(node) && /^(?:p|li|h[1-6])$/.test(node.tagName) &&
      (exceptionText(view.text(node)) || closureNotice(view.text(node)) || /^\d{4}$/.test(fold(view.text(node)))))) return null;
  const blocks = view.scope.filter(node => ["p", "li", "h2", "h3", "h4", "h5", "h6"].includes(node.tagName));
  const blockSet = new Set(blocks);
  const seasons = [], holidays = [];
  let current = null, holiday = false, year = null, invalidHoliday = false;
  for (const node of blocks) {
    // Nested paragraphs/list items are one semantic assertion, never two.
    let nested = false;
    for (let parent = node.parentNode, depth = 0; parent && depth <= MAX_DEPTH; parent = parent.parentNode, depth++) {
      if (blockSet.has(parent)) { nested = true; break; }
    }
    if (nested) continue;
    const value = fold(view.text(node));
    if (!value) continue;
    if (/^h[1-6]$/.test(node.tagName) && exceptionText(value)) { holiday = true; current = null; continue; }
    if (holiday) {
      if (/^20\d{2}$/.test(value)) { year = Number(value); continue; }
      const range = holidayRange(value, year);
      if (range) holidays.push(range); else invalidHoliday = true;
      continue;
    }
    // Explicit years and unscoped exception notices are outside this annual
    // grammar. Ignoring them would turn old or qualified hours into a fact.
    if (/\b\d{4}\b/.test(value) || serviceLabel(value)) return null;
    const season = seasonRange(value);
    if (season) { current = season; seasons.push(current); continue; }
    const rule = weeklyRule(value);
    if (!rule && (closureNotice(value) || exceptionText(value))) return null;
    if (!current) continue;
    if (/^(?:kvallsoppet|evening opening|late opening|late hours)$/.test(value)) { current.late = true; continue; }
    if (current.late) {
      for (let day = 0; day < 7; day++) if (new RegExp(DAY_NAMES[day]).test(value)) current.lateDays.add(day);
      continue;
    }
    if (rule) for (const day of rule.days) {
      if (current.week.has(day)) current.invalid = true;
      current.week.set(day, rule.rule);
    }
    else if (new RegExp(`^(?:${DAY_PATTERN})\\b`).test(value)) current.invalid = true;
  }
  if (invalidHoliday || holidays.some(range => date >= range.from && date <= range.through)) return null;
  const md = (selected.getUTCMonth() + 1) * 100 + selected.getUTCDate();
  const matches = seasons.filter(season => season.start <= season.end ? md >= season.start && md <= season.end : md >= season.start || md <= season.end);
  if (matches.length !== 1) return null;
  const chosen = matches[0], weekday = (selected.getUTCDay() + 6) % 7;
  if (chosen.invalid || chosen.week.size !== 7 || (chosen.late && (!chosen.lateDays.size || chosen.lateDays.has(weekday)))) return null;
  return { opening_hours: DAYS.map((day, i) => `${day} ${chosen.week.get(i)}`).join("; "), url: view.source.toString(), valid_for_date: date, entry_url: view.entry.toString() };
}

module.exports = { parseSelectedPlaceHtmlHours, selectedPlaceHtmlHoursLink };
