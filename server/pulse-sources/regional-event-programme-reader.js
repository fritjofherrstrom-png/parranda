"use strict";

const { parse } = require("parse5");
const { fold, isProgramMarker, isStopMarker } = require("./official-program-article-document");
const { parseDateRange, parseTimeRange } = require("./official-program-article-time");

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
const COMPLETE_CLOCK = /^(?:[01]?\d|2[0-3])[:.][0-5]\d(?:\s*h(?=\s|$))?(?![:.]\d)(?=\s|[-–—:;,]|$)/i;

// Own the closed h1/h2 programme -> h2 numeric day -> h3 area -> timed p/BR
// grammar. Null preserves the older article grammar; an empty result owns a
// malformed numeric programme and forbids fallback to deadlines or body years.
function collectRegionalEventProgramme(html) {
  const blocks = [];
  function visit(node) {
    if (excludedNode(node)) return;
    if (/^h[1-4]$/.test(node.tagName) || node.tagName === "p") {
      blocks.push({ tag: node.tagName, text: textOf(node), node });
      return;
    }
    for (const child of node.childNodes || []) visit(child);
  }
  visit(parse(String(html || "")));
  const firstDay = blocks.findIndex((block, index) => {
    if (block.tag !== "h2" || !/\d{1,2}\s*\/\s*\d{1,2}/.test(block.text)) return false;
    // A numeric heading owns this grammar only within a programme title's
    // section and followed by an area. Office/deadline headings elsewhere
    // must leave the established month-name article reader in control.
    const previousIndex = blocks.slice(0, index).findLastIndex((prior) => /^h[12]$/.test(prior.tag));
    const previousSection = blocks[previousIndex];
    const nextHeading = blocks.slice(index + 1).find((next) => /^h[123]$/.test(next.tag));
    // The legacy reader already owns a programme with dated subheadings.
    // 2000 is solely a leap-safe syntax probe here, never an event year.
    const legacyDates = blocks.slice(previousIndex + 1, index).some((prior) => /^h[34]$/.test(prior.tag) && parseDateRange(prior.text, 2000));
    return previousSection && programmeTitle(previousSection.text) && !legacyDates && (/\b20\d{2}\b/.test(previousSection.text) || nextHeading?.tag === "h3");
  });
  // Missing-date ownership uses the regional paragraph/area shape, even
  // without a title year; body dates must never repair missing programme facts.
  // Named-month date subheadings are evidence for the existing article
  // grammar, including when its programme title itself contains a year.
  const missingRegionalDay = firstDay < 0 && blocks.some((block, index) => {
    if (block.tag !== "h2" || !programmeTitle(block.text)) return false;
    // The legacy reader also inherits its nearest date from the preceding
    // eight blocks. Release only an explicitly dated/year-bearing heading;
    // nearer booking prose must not become an inherited event date.
    const precedingDate = blocks.slice(Math.max(0, index - 8), index)
      .findLast((prior) => parseDateRange(prior.text, 2000));
    if (precedingDate && /^h[1-4]$/.test(precedingDate.tag) &&
      (precedingDate.text.match(/\b20\d{2}\b/g) || []).length === 1) return false;
    const following = blocks.slice(index + 1);
    const nextProgramme = following.findIndex((next) => /^h[12]$/.test(next.tag) && programmeTitle(next.text));
    const section = nextProgramme < 0 ? following : following.slice(0, nextProgramme);
    if (section.some((next) => /^h[34]$/.test(next.tag) && parseDateRange(next.text, 2000))) return false;
    return section.some((next) => next.tag === "h3" && validArea(next.text)) &&
      section.some((next) => next.tag === "p" && timedParagraphHeadline(next.node, { shapeOnly: true }));
  });
  if (firstDay < 0 && !missingRegionalDay) return null;
  const result = { recognized: false, page_title: null, page_year: null, program_section_count: 0, candidate_row_count: 0, timed_row_count: 0, all_day_row_count: 0, rows: [] };
  const pageHeading = blocks.find((block) => block.tag === "h1");
  if (/\b(?:archives?|archived|history|historical|previous editions|retrospective|recap|arkiv|historik|tidigare upplagor|historia|ediciones anteriores|retrospectiva|arxiu|edicions anteriors|histoire|editions precedentes)\b/.test(fold(pageHeading?.text))) return result;
  if (firstDay < 0) return result;
  const title = blocks.slice(0, firstDay).find((block) => /^h[12]$/.test(block.tag) && programmeTitle(block.text) && (block.text.match(/\b20\d{2}\b/g) || []).length === 1);
  if (!title) return result;
  const year = Number(title.text.match(/\b(20\d{2})\b/)[1]);
  result.page_title = title.text;
  result.page_year = year;
  result.programme_title = title.text;
  result.program_section_count = 1;
  const following = blocks.slice(blocks.indexOf(title) + 1);
  // Stop sections bound both date-order evidence and event rows; office dates
  // after Contact cannot establish a programme's otherwise ambiguous order.
  const sectionEnd = following.findIndex((block) =>
    (/^h[12]$/.test(block.tag) && programmeTitle(block.text)) ||
    (/^h[1-4]$/.test(block.tag) && isStopMarker(block.text)));
  const programmeBlocks = sectionEnd < 0 ? following : following.slice(0, sectionEnd);
  const ordering = programmeBlocks.filter((block) => block.tag === "h2").map((block) => numericDayAlternatives(block.text, year)).filter(Boolean);
  const dayMonthEstablished = ordering.some((option) => option.dayMonth && !option.monthDay) && !ordering.some((option) => option.monthDay && !option.dayMonth);
  let day = null;
  let area = null;
  for (const block of programmeBlocks) {
    // Unsupported subheadings require a fresh area within the current day.
    if (block.tag === "h4") {
      area = null;
      continue;
    }
    if (/^h[12]$/.test(block.tag)) {
      day = block.tag === "h2" ? parseProgrammeDayHeading(block.text, year, dayMonthEstablished) : null;
      area = null;
      continue;
    }
    if (block.tag === "h3") {
      area = day && validArea(block.text) ? block.text : null;
      continue;
    }
    if (block.tag !== "p" || !day || !area) continue;
    const headline = timedParagraphHeadline(block.node);
    if (!headline) continue;
    result.rows.push({ title: headline.title, date_range: day, time: headline.time, states_daily: false, venue: `${headline.title}, ${area}`, area, program_marker: title.text });
  }
  result.candidate_row_count = result.rows.length;
  result.timed_row_count = result.rows.length;
  result.recognized = result.timed_row_count >= 2;
  return result;
}

function parseProgrammeDayHeading(value, year, dayMonthEstablished) {
  const options = numericDayAlternatives(value, year);
  if (!options?.dayMonth) return null;
  // An equally plausible month/day reading cannot be selected by locale or
  // language. A distinct, unambiguous heading in this programme proves order.
  if (!dayMonthEstablished && options.monthDay && options.dayMonth.start.day !== options.dayMonth.start.month) return null;
  return options.dayMonth;
}

function numericDayAlternatives(value, year) {
  const match = fold(value).match(/^(?:([\p{L}]+)\s+)?(\d{1,2})\s*\/\s*(\d{1,2})$/u);
  if (!match || !Number.isInteger(year)) return null;
  return {
    dayMonth: checkedDate(year, Number(match[3]), Number(match[2]), match[1]),
    monthDay: checkedDate(year, Number(match[2]), Number(match[3]), match[1]),
  };
}

function checkedDate(year, month, day, weekday) {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day) return null;
  if (weekday && !WEEKDAYS[date.getUTCDay()].has(weekday)) return null;
  const parts = { year, month, day };
  return { start: parts, end: { ...parts } };
}

function timedParagraphHeadline(node, { shapeOnly = false } = {}) {
  const tokens = [];
  let foundBreak = false;
  function firstLine(current, strong = false) {
    if (foundBreak || excludedNode(current)) return;
    if (current.tagName === "br") { foundBreak = true; return; }
    if (current.nodeName === "#text") tokens.push({ text: current.value, strong });
    for (const child of current.childNodes || []) firstLine(child, strong || current.tagName === "strong" || current.tagName === "b");
  }
  firstLine(node);
  if (!foundBreak) return null;
  const first = tokens.find((token) => token.text.trim());
  // A leading bold name delimits it from unbolded descriptive prose even when
  // the publisher puts that prose before the first line break.
  const selected = [];
  for (const token of tokens) {
    if (first?.strong && !token.strong && token.text.trim()) break;
    selected.push(token.text);
  }
  const line = selected.join("").replace(/\s+/g, " ").trim();
  // A malformed time still identifies this closed document shape. Without
  // a day heading it must fail here, rather than let the prose reader turn
  // a later booking deadline into the event date. This yields no event fact.
  if (shapeOnly) return /^\d{1,2}[:.]\d/.test(line) ? { recognized: true } : null;
  const clock = line.match(COMPLETE_CLOCK);
  if (!clock) return null;
  let clockEnd = clock[0].length;
  const connector = line.slice(clockEnd).match(/^\s*(?:[-–—]|(?:to|till|a|al|au|until)\b)\s*/i);
  if (connector) {
    const rangeEnd = line.slice(clockEnd + connector[0].length).match(COMPLETE_CLOCK);
    if (rangeEnd) clockEnd += connector[0].length + rangeEnd[0].length;
    // Short connectors also begin ordinary source names. They are a range
    // only when a complete second clock follows; explicit dash/to/till/until
    // attempts still fail closed without that clock.
    else if (/^\s*(?:[-–—]|(?:to|till|until)\b)/i.test(connector[0])) return null;
  }
  // Give the shared timing builder only fully validated clocks; otherwise
  // its permissive extractor can consume a partial clock or a title's h.
  const time = parseTimeRange(line.slice(0, clockEnd));
  const remainder = line.slice(clockEnd);
  const title = remainder.replace(/^[\s:;,\-–—]+/, "").trim();
  if (title.length < 3 || title.length > 140 || title.split(/\s+/).length > 18 || isStopMarker(title) || parseTimeRange(title) || /^\d{1,2}[:.]\d{2}\b/.test(title) || /[.!?](?:\s|$)/.test(title)) return null;
  return { title, time };
}

function validArea(text) {
  return text.length >= 2 && text.length <= 100 && text.split(/\s+/).length <= 12 && !isStopMarker(text) && !isProgramMarker(text) && !parseTimeRange(text) && !/\d{1,2}\s*\/\s*\d{1,2}/.test(text);
}

function programmeTitle(text) {
  return text.length <= 160 && (isProgramMarker(text) || /^programmet\b/.test(fold(text)));
}

function textOf(node) {
  const content = (current) => excludedNode(current) ? "" : current.nodeName === "#text" ? current.value : (current.childNodes || []).map(content).join("");
  return content(node).replace(/\s+/g, " ").trim();
}

function excludedNode(node) {
  return IGNORED.has(node.tagName) || node.attrs?.some((attr) => attr.name === "hidden" || (attr.name === "aria-hidden" && attr.value.trim().toLowerCase() === "true"));
}

module.exports = { collectRegionalEventProgramme };
