"use strict";

const {
  parseDateRange,
  parseTimeRange,
  stripDateAndTime,
} = require("./official-program-article-time");

const PROGRAM_MARKERS = [
  "program",
  "programme",
  "programa",
  "programacio",
  "programacion",
  "programacao",
  "programma",
  "programm",
  "festivalschema",
  "tidsschema",
  "timetable",
];

const STOP_MARKERS = [
  "biljetter",
  "biljettforsaljning",
  "billetter",
  "tickets",
  "ticketing",
  "venda d'entrades",
  "venta de entradas",
  "vente de billets",
  "biglietti",
  "karten",
  "kontakt",
  "contact",
  "accessibility",
  "tillganglighet",
  "parking",
  "parkering",
  "practical information",
  "praktisk information",
];

const ARCHIVE_MARKERS = [
  "archive",
  "archived",
  "history",
  "historical",
  "previous editions",
  "retrospective",
  "recap",
  "arkiv",
  "historik",
  "tidigare upplagor",
  "historia",
  "ediciones anteriores",
  "retrospectiva",
  "arxiu",
  "historia",
  "edicions anteriors",
  "archives",
  "histoire",
  "editions precedentes",
];

function extractContentBlocks(html) {
  const source = String(html || "")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|svg|form|nav|footer|header)\b[^>]*>[\s\S]*?<\/\1>/gi, " ");
  const blocks = [];
  const pattern = /<(h[1-4]|p|li)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
  let match;
  while ((match = pattern.exec(source))) {
    const text = htmlToText(match[3]);
    if (!text || text.length > 800) continue;
    const tag = match[1].toLowerCase();
    blocks.push({
      tag,
      text,
      heading: tag.startsWith("h"),
      strong: tag.startsWith("h") || /<(strong|b)\b/i.test(match[3]),
    });
  }
  return blocks.slice(0, 1200);
}

function findProgramSegments(blocks) {
  const documentTitle = blocks.find((block) => block.tag === "h1")?.text;
  if (isArchiveDocumentTitle(documentTitle)) return [];
  const markers = [];
  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index];
    // A page title may mention a programme without beginning the factual list.
    if (block.tag !== "h1" && (block.heading || block.strong) && isProgramMarker(block.text)) {
      markers.push(index);
    }
  }
  return markers.map((start, markerIndex) => {
    const nextMarker = markers[markerIndex + 1] ?? blocks.length;
    let end = Math.min(nextMarker, start + 180);
    for (let index = start + 1; index < end; index += 1) {
      if ((blocks[index].heading || blocks[index].strong) && isStopMarker(blocks[index].text)) {
        end = index;
        break;
      }
    }
    return { start, end };
  });
}

function isArchiveDocumentTitle(value) {
  const text = fold(value);
  return ARCHIVE_MARKERS.some((marker) => new RegExp(`(?:^|\\b)${marker}(?:\\b|$)`, "i").test(text));
}

function isProgramMarker(value) {
  const text = fold(value);
  return PROGRAM_MARKERS.some((marker) => new RegExp(`(?:^|\\b)${marker}(?:\\b|$)`, "i").test(text));
}

function isStopMarker(value) {
  const text = fold(value);
  return STOP_MARKERS.some((marker) => text === marker || text.startsWith(`${marker} `));
}

function venueFromProgramMarker(value) {
  const text = htmlToText(value);
  if (!text) return null;
  const folded = fold(text);
  const marker = PROGRAM_MARKERS.find((item) => new RegExp(`(?:^|\\b)${item}(?:\\b|$)`, "i").test(folded));
  if (!marker) return null;
  const markerIndex = folded.indexOf(marker);
  let remainder = text.slice(markerIndex + marker.length)
    .replace(/^\s*[:\-–—|]\s*/, "")
    .replace(/^\s*(?:at|on|in|a|al|als|a la|au|aux|sur|pa|på|ved|im|am|nel|nella|no|na)\s+/i, "")
    .trim();
  if (!remainder || remainder.length < 3 || remainder.length > 100) return null;
  remainder = remainder.replace(/[.:;\-–—]+$/, "").trim();
  return isGenericVenueLabel(remainder) ? null : remainder;
}

function nearestDateRange(blocks, index, year) {
  for (let offset = 1; offset <= 8 && index - offset >= 0; offset += 1) {
    const range = parseDateRange(blocks[index - offset].text, year);
    if (range) return range;
  }
  return null;
}

function venueFromDatedHeading(value) {
  const withoutDate = stripDateAndTime(value).replace(/[.:;\-–—]+$/g, "").trim();
  return isVenueHeading(withoutDate) ? withoutDate : null;
}

function isVenueHeading(value) {
  const text = htmlToText(value);
  if (!text || text.length < 3 || text.length > 100) return false;
  if (isProgramMarker(text) || isStopMarker(text) || parseTimeRange(text)) return false;
  if (isGenericVenueLabel(text)) return false;
  return text.split(/\s+/).length <= 12;
}

function isGenericVenueLabel(value) {
  const text = fold(value);
  return ["events", "event", "calendar", "festival", "activities", "agenda", "program"].includes(text);
}

function isEventRowBlock(block, pageYear) {
  if (!block || block.heading) return false;
  if (block.tag === "li") return true;
  return block.strong || Boolean(parseTimeRange(block.text)) || Boolean(parseDateRange(block.text, pageYear));
}

function htmlToText(value) {
  return decodeHtmlEntities(String(value || "").replace(/<br\s*\/?\s*>/gi, " ").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function decodeHtmlEntities(value) {
  const named = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
  return String(value || "").replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (_match, entity) => {
    if (entity[0] === "#") {
      const code = entity[1].toLowerCase() === "x"
        ? Number.parseInt(entity.slice(2), 16)
        : Number.parseInt(entity.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : " ";
    }
    return named[entity.toLowerCase()] || " ";
  });
}

function fold(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’']/g, "'")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

module.exports = {
  extractContentBlocks,
  findProgramSegments,
  fold,
  htmlToText,
  isEventRowBlock,
  isProgramMarker,
  isStopMarker,
  isVenueHeading,
  nearestDateRange,
  venueFromDatedHeading,
  venueFromProgramMarker,
};
