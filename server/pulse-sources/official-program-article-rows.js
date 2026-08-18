"use strict";

const {
  extractContentBlocks,
  findProgramSegments,
  htmlToText,
  isEventRowBlock,
  isProgramMarker,
  isStopMarker,
  isVenueHeading,
  nearestDateRange,
  venueFromDatedHeading,
  venueFromProgramMarker,
} = require("./official-program-article-document");
const {
  parseDateRange,
  parseTimeRange,
  stripDateAndTime,
} = require("./official-program-article-time");

const MIN_TIMED_ROWS_FOR_SIGNATURE = 2;

function hasOfficialProgramArticleSignature(html) {
  const grouped = collectOfficialProgramRows(html);
  return grouped.timed_row_count >= MIN_TIMED_ROWS_FOR_SIGNATURE;
}

function collectOfficialProgramRows(html) {
  const blocks = extractContentBlocks(html);
  const pageYear = inferPageYear(blocks);
  const segments = findProgramSegments(blocks);
  if (!pageYear || !segments.length) return emptyRowCollection();

  const pageTitle = blocks.find((block) => block.tag === "h1")?.text || null;
  const rows = [];
  let candidateRowCount = 0;
  let timedRowCount = 0;
  let allDayRowCount = 0;

  for (const segment of segments) {
    const marker = blocks[segment.start];
    let currentDate = nearestDateRange(blocks, segment.start, pageYear);
    let currentVenue = venueFromProgramMarker(marker.text);

    for (let index = segment.start + 1; index < segment.end; index += 1) {
      const block = blocks[index];
      const explicitDate = parseDateRange(block.text, pageYear);
      if (explicitDate && block.heading) {
        currentDate = explicitDate;
        const headingVenue = venueFromDatedHeading(block.text);
        if (headingVenue) currentVenue = headingVenue;
      } else if (block.heading && isVenueHeading(block.text)) {
        currentVenue = block.text;
      }
      if (!isEventRowBlock(block, pageYear)) continue;

      const dateRange = explicitDate || currentDate;
      const title = eventTitleFromRow(block.text);
      const time = parseTimeRange(block.text);
      if (!dateRange || !title || !currentVenue) continue;

      candidateRowCount += 1;
      if (time) timedRowCount += 1;
      else allDayRowCount += 1;
      rows.push({
        title,
        date_range: dateRange,
        time,
        venue: currentVenue,
        program_marker: marker.text,
      });
    }
  }

  return {
    recognized: timedRowCount >= MIN_TIMED_ROWS_FOR_SIGNATURE,
    page_title: pageTitle,
    page_year: pageYear,
    program_section_count: segments.length,
    candidate_row_count: candidateRowCount,
    timed_row_count: timedRowCount,
    all_day_row_count: allDayRowCount,
    rows,
  };
}

function eventTitleFromRow(value) {
  let text = htmlToText(value);
  if (!text) return null;
  text = stripDateAndTime(text.replace(/^\s*[•·▪◦*-]+\s*/, ""))
    .replace(/^\s*(?:at|a les|a las|a|h|kl\.?|klo)\s*/i, "")
    .replace(/^\s*[:;,\-–—]+\s*/, "")
    .replace(/[\s:;,\-–—]+$/, "")
    .trim();
  if (isStopMarker(text)) return null;
  const headline = text.split(/\s*:\s*/, 1)[0].trim();
  if (headline.length >= 3 && headline.length <= 180) text = headline;
  if (text.length > 240) text = text.slice(0, 240).replace(/\s+\S*$/, "").trim();
  if (text.length < 3 || isProgramMarker(text) || isStopMarker(text)) return null;
  return text;
}

function inferPageYear(blocks) {
  for (const block of blocks.slice(0, 40)) {
    const year = inferYearFromText(block.text);
    if (year) return year;
  }
  return null;
}

function inferYearFromText(value) {
  const match = String(value || "").match(/\b(20\d{2})\b/);
  const year = Number(match?.[1]);
  return year >= 2000 && year <= 2100 ? year : null;
}

function emptyRowCollection() {
  return {
    recognized: false,
    page_title: null,
    page_year: null,
    program_section_count: 0,
    candidate_row_count: 0,
    timed_row_count: 0,
    all_day_row_count: 0,
    rows: [],
  };
}

module.exports = {
  MIN_TIMED_ROWS_FOR_SIGNATURE,
  collectOfficialProgramRows,
  hasOfficialProgramArticleSignature,
};
