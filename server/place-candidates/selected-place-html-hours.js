"use strict";

const { parse } = require("parse5");

// A deliberately closed reader for an existing selected identity. It does not
// discover places, infer ownership from a hostname, or promote place trust.
const MAX_BYTES = 512 * 1024;
const MAX_NODES = 12000;
const MAX_DEPTH = 64;
const TEXT_BREAKS = new Set(['p', 'div', 'section', 'article', 'aside', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'ul', 'ol', 'li', 'dl', 'dt', 'dd', 'table', 'thead', 'tbody', 'tr', 'td', 'th', 'br', 'hr']);
const DAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
const DAY_NAMES = ["monday|mandag(?:ar)?", "tuesday|tisdag(?:ar)?", "wednesday|onsdag(?:ar)?", "thursday|torsdag(?:ar)?", "friday|fredag(?:ar)?", "saturday|lordag(?:ar)?", "sunday|sondag(?:ar)?"];
const DAY_PATTERN = DAY_NAMES.map(value => `(?:${value})`).join("|");
const MONTHS = ["january|januari", "february|februari", "march|mars", "april", "may|maj", "june|juni", "july|juli", "august|augusti", "september", "october|oktober", "november", "december"];
const MONTH_PATTERN = MONTHS.map(value => `(?:${value})`).join("|");
const fold = value => String(value || "").normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[–—−]/g, "-").replace(/\s+/g, " ").trim();
const name = value => fold(value).replace(/[^a-z0-9]+/g, " ").trim();
const hoursHeading = value => /^(?:oppettider|opening hours)$/.test(fold(value));
const exceptionText = value => /helgdag|avvikande|holiday|exception|special hours/.test(fold(value));
const serviceHeading = value => /\b(?:cafe(?:ets?|s)?|intake|inlamning|goods|guided tours?|visningar|member|medlem|meetings?)\b/.test(fold(value));
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
    const value = node.nodeName === "#text" ? node.value.slice(0, 8192) :
      (node.childNodes || []).map(child => texts.get(child) || "").join("").slice(0, 8192);
    // Inline markup does not insert a word boundary. Structural blocks do.
    texts.set(node, TEXT_BREAKS.has(node.tagName) ? ` ${value} ` : value);
  }
  const mains = nodes.filter(node => node.tagName === "main");
  return mains.length === 1 ? { nodes, identityNodes, main: mains[0], text: node =>
    (texts.get(node) || "").replace(/\s+/g, " ").trim() } : null;
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
  // The heading's descendants belong to the heading, not to the following
  // fact section. Retaining them would erase the block boundary at scope start.
  let contentStart = start + 1;
  while (contentStart < end && within(view.nodes[contentStart], general[0])) contentStart++;
  return { ...view, entry, source, scope: view.nodes.slice(contentStart, end) };
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
  const scope = new Set(view.scope), pieces = [];
  const stack = view.scope.filter(node => !scope.has(node.parentNode)).reverse().map(node => [node, false]);
  while (stack.length) {
    const [node, exit] = stack.pop();
    if (exit) { pieces.push(' '); continue; }
    if (assertions.has(node)) { pieces.push(' '); continue; }
    if (node.nodeName === '#text') { pieces.push(node.value); continue; }
    if (TEXT_BREAKS.has(node.tagName)) { pieces.push(' '); stack.push([node, true]); }
    const children = node.childNodes || [];
    for (let i = children.length - 1; i >= 0; i--) if (scope.has(children[i])) stack.push([children[i], false]);
  }
  const value = fold(pieces.join(''));
  if (serviceOnly) return serviceHeading(value);
  return /\b\d{4}\b/.test(value) || closureNotice(value) || exceptionText(value) || serviceHeading(value);
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

// The calendar content is acquired once. Date projection belongs to the shared
// day adapter, never to a cached weekly "off" string.
function parseSelectedPlaceHoursCalendar(html, record, { sourceUrl, entryHtml, entrySourceUrl } = {}) {
  const { parseSelectedPlaceContactHours } = require('./selected-place-contact-hours');
  const contact = parseSelectedPlaceContactHours(html, record, { sourceUrl });
  if (contact) return contact;
  const view = identifiedView(html, record, sourceUrl);
  if (!view || unscopedConditions(view)) return null;
  if (view.source.toString() !== view.entry.toString() &&
      (!descendant(view.source, view.entry) || safeUrl(entrySourceUrl)?.toString() !== view.entry.toString() ||
       selectedPlaceHtmlHoursLink(entryHtml, record, entrySourceUrl) !== view.source.toString())) return null;
  if (view.scope.some(node => node.tagName === 'a' && exceptionText(view.text(node)))) return null;
  const assertions = nodes => nodes.filter(node => /^(?:p|li|h[1-6])$/.test(node.tagName));
  // A peer exception section in the same identified main is still relevant.
  const scope = [...view.scope], included = new Set(scope);
  const outside = assertions(view.nodes).filter(node => within(node, view.main) && !included.has(node));
  let exceptions = false;
  for (const node of outside) {
    if (/^h[2-6]$/.test(node.tagName) && exceptionText(view.text(node))) exceptions = true;
    if (exceptions) { scope.push(node); continue; }
    if (exceptionText(view.text(node)) || closureNotice(view.text(node)) || /^20\d{2}$/.test(fold(view.text(node)))) return null;
  }
  if (assertions(scope).some(node => serviceLabel(view.text(node)) ||
    /\b(?:phone|telephone|telefon|booking|bokning)\b.*\b(?:hours|oppettider)\b/.test(fold(view.text(node))))) return null;
  const blocks = assertions(scope), blockSet = new Set(blocks);
  const rules = [], overrides = [], unresolved = [];
  let current = null, holiday = false, year = null;
  const md = value => `${String(Math.floor(value / 100)).padStart(2, '0')}-${String(value % 100).padStart(2, '0')}`;
  const begin = validity => { current = { week: {}, ...(validity ? { validity } : {}) }; rules.push(current); };
  for (const node of blocks) {
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
      // Closed row grammar: explicit date + optional supported holiday label
      // + a positive whole status/window. Arbitrary prose cannot gain fact
      // authority merely by ending in "closed" or a clock. This vocabulary
      // recognizes labels only; it never infers a holiday's calendar date.
      const prefix = value.match(/^\d{1,2}(?:\s*-\s*\d{1,2})?\/\d{1,2}(?:\s*-\s*\d{1,2}\/\d{1,2})?(?:\s|$)/);
      const tail = prefix ? value.slice(prefix[0].length).trim() : '';
      if (!range || /\b\d{4}\b/.test(tail)) { unresolved.push({ reason: 'unresolved_date_exception' }); continue; }
      const status = tail.match(/(?:stangt|closed|off)$/);
      const hours = tail.match(/(\d{1,2}(?:[.:]\d{2})?\s*(?:am|pm)?)\s*-\s*(\d{1,2}(?:[.:]\d{2})?\s*(?:am|pm)?)$/);
      const marker = status || hours;
      const label = marker ? tail.slice(0, marker.index).replace(/(?:kl\.?|hours:?)\s*$/, '').trim() : null;
      const holidayLabel = /^(?:jul(?:afton|dagen)?|christmas(?: eve| day)?|nyar(?:safton|sdagen)?|new year(?:'s)?(?: eve| day)?|alla helgons(?: helg| dag)?|all saints'?(?: day| weekend)?|pask(?:afton|dagen|helg)?|easter(?: sunday| monday| weekend)?|midsommar(?:afton|dagen)?|midsummer(?: eve| day)?|nationaldagen|national day)$/;
      if (label === null || (label && !holidayLabel.test(label))) { unresolved.push({ reason: 'unresolved_date_exception', ...range }); continue; }
      if (status) overrides.push({ ...range, status: 'closed', windows: [] });
      else if (hours && clock(hours[1]) && clock(hours[2]) && clock(hours[1]) < clock(hours[2])) {
        overrides.push({ ...range, status: 'known', windows: [{ opens: clock(hours[1]), closes: clock(hours[2]) }] });
      } else unresolved.push({ reason: 'unresolved_date_exception', ...range });
      continue;
    }
    const season = seasonRange(value);
    if (season) { begin({ kind: 'annual', from: md(season.start), through: md(season.end) }); continue; }
    const absolute = value.match(new RegExp(`^(\\d{1,2}) (${MONTH_PATTERN}) (20\\d{2})\\s*-\\s*(\\d{1,2}) (${MONTH_PATTERN}) (20\\d{2})$`));
    if (absolute) {
      const month = text => MONTHS.findIndex(pattern => new RegExp(`^(?:${pattern})$`).test(text)) + 1;
      const iso = (day, mon, yr) => `${yr}-${String(month(mon)).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const from = iso(absolute[1], absolute[2], absolute[3]), through = iso(absolute[4], absolute[5], absolute[6]);
      if (!validDate(from) || !validDate(through) || from > through) return null;
      begin({ kind: 'absolute', from, through }); continue;
    }
    if (/\b\d{4}\b/.test(value)) return null;
    if (/^(?:kvallsoppet|evening opening|late opening|late hours)$/.test(value)) {
      if (!current) return null;
      current.late = true; current.lateDays = new Set(); continue;
    }
    if (current?.late) {
      for (let day = 0; day < 7; day++) if (new RegExp(DAY_NAMES[day]).test(value)) current.lateDays.add((day + 1) % 7);
      continue;
    }
    const rule = weeklyRule(value);
    if (rule) {
      if (!current) begin();
      for (const day of rule.days) {
        if (Object.hasOwn(current.week, DAYS[day])) return null;
        current.week[DAYS[day]] = rule.rule === 'off' ? [] : [{ opens: rule.rule.slice(0, 5), closes: rule.rule.slice(6) }];
      }
    } else if (closureNotice(value) || exceptionText(value) ||
        new RegExp(`^(?:${DAY_PATTERN})\\b`).test(value) ||
        (new RegExp(MONTH_PATTERN).test(value) && /\d/.test(value))) {
      unresolved.push({ reason: 'unsupported_schedule_condition' });
    }
  }
  for (const rule of rules) {
    if (rule.late) unresolved.push({ reason: 'unresolved_late_hours', ...(rule.validity ? { validity: rule.validity } : {}),
      ...(rule.lateDays.size ? { weekdays: [...rule.lateDays] } : {}) });
    delete rule.late; delete rule.lateDays;
  }
  const usable = rules.filter(rule => Object.keys(rule.week).length);
  if (!(usable.length || overrides.length)) return null;
  return { entry_url: view.entry.toString(), source_url: view.source.toString(),
    source_relation: view.source.toString() === view.entry.toString() ? 'entry' : 'direct_hours_link',
    visit_function: 'general_visit', rules: usable, overrides, unresolved };
}

// Legacy call sites/tests retain their deliberately narrower complete-week
// contract. New selected-place acquisition consumes the calendar above.
function parseSelectedPlaceHtmlHours(html, record, options = {}) {
  const selected = validDate(options.date);
  if (!selected) return null;
  const content = parseSelectedPlaceHoursCalendar(html, record, options);
  if (!content) return null;
  const { CALENDAR_CONTRACT, selectedHoursCalendarKey, projectSelectedHoursCalendar } = require('./opening-hours-calendar');
  const result = projectSelectedHoursCalendar({ ...content, contract: CALENDAR_CONTRACT,
    identity_key: selectedHoursCalendarKey(record), observed_at: '2000-01-01T00:00:00.000Z' },
    { date: options.date, timezone: 'UTC' });
  if (result.status === 'unknown' || content.overrides.some(rule => options.date >= rule.from && options.date <= rule.through)) return null;
  const md = options.date.slice(5);
  const matching = content.rules.filter(rule => !rule.validity || (rule.validity.kind === 'absolute' ?
    options.date >= rule.validity.from && options.date <= rule.validity.through :
    rule.validity.from <= rule.validity.through ? md >= rule.validity.from && md <= rule.validity.through :
      md >= rule.validity.from || md <= rule.validity.through));
  if (matching.length !== 1 || Object.keys(matching[0].week).length !== 7) return null;
  return { opening_hours: DAYS.map(day => `${day} ${matching[0].week[day].length ?
    matching[0].week[day].map(window => `${window.opens}-${window.closes}`).join(',') : 'off'}`).join('; '),
    url: content.source_url, valid_for_date: options.date, entry_url: content.entry_url };
}
module.exports = { parseSelectedPlaceHtmlHours, parseSelectedPlaceHoursCalendar, selectedPlaceHtmlHoursLink };
