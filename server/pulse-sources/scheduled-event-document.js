"use strict";

const { parse } = require("parse5");

const INERT = new Set(["script", "style", "template", "noscript", "svg"]);
// Only supported textual inline elements can continue an adjacent token.
// Block, line-break, replaced and unknown elements delimit text by default;
// a partial block list would silently join years across omitted containers.
const INLINE_TEXT = new Set(["a", "abbr", "b", "bdi", "bdo", "cite", "code", "data", "del", "dfn", "em", "i",
  "ins", "kbd", "label", "mark", "q", "ruby", "rp", "rt", "rtc", "s", "samp", "small", "span", "strong",
  "sub", "sup", "time", "u", "var"]);

// Reject the whole document on exhaustion, including valid cards before the
// oversized tail. Iterative inspection avoids recursive subtree rescans.
function boundedDocument(html) {
  const source = String(html || "");
  if (Buffer.byteLength(source, "utf8") > 2 * 1024 * 1024) return null;
  const root = parse(source);
  const stack = [{ node: root, depth: 0, next: 0 }];
  const nodes = [];
  const texts = new Map();
  const articleOwners = new Map();
  const scripts = [];
  let characters = 0;
  let inspected = 0;
  while (stack.length) {
    const frame = stack[stack.length - 1];
    const node = frame.node;
    const inert = INERT.has(node.tagName) || (node.attrs || []).some((attr) =>
      attr.name === "hidden" || (attr.name === "aria-hidden" && attr.value.toLowerCase() === "true"),
    );
    if (frame.next === 0) {
      if (++inspected > 20000 || frame.depth > 256) return null;
      // Separate, non-executed data lane. Hidden/inert ancestors are never
      // traversed, and script text still cannot lend ordinary DOM facts.
      if (node.tagName === "script" && !(node.attrs || []).some((attr) =>
        attr.name === "hidden" || (attr.name === "aria-hidden" && attr.value.toLowerCase() === "true"),
      )) scripts.push(node);
      // Inert nodes themselves cannot supply attributes/links as evidence.
      // They still consume the inspection budget even without descendants.
      if (!inert) {
        nodes.push(node);
        articleOwners.set(node, isMappedOwner(node) ? null : frame.articleOwner || null);
      }
      characters += (node.value || node.data || "").length;
      for (const attr of node.attrs || []) characters += attr.name.length + attr.value.length;
      if (characters > 1000000) return null;
      frame.text = node.nodeName === "#text" ? node.value : "";
    }
    const children = inert ? [] : node.childNodes || [];
    if (frame.next < children.length) {
      stack.push({ node: children[frame.next++], depth: frame.depth + 1, next: 0,
        articleOwner: node.tagName === "article" ? node : isMappedOwner(node) ? null : frame.articleOwner });
      continue;
    }
    texts.set(node, frame.overflow || frame.foreignOwner ? null : cleanText(frame.text));
    stack.pop();
    // A mapped owner cannot lend text or join fragments inside another
    // entity's field. Reject that containing text, not its independent siblings.
    if (stack.length && isMappedOwner(node) && !inert) {
      stack[stack.length - 1].foreignOwner = true;
    } else if (stack.length && node.tagName !== "article" && !inert) {
      const parent = stack[stack.length - 1];
      parent.foreignOwner ||= frame.foreignOwner;
      // Keep line/block token boundaries without splitting legitimate inline
      // emphasis. In particular, 20<br>26 must never become the year 2026.
      const text = node.tagName && !INLINE_TEXT.has(node.tagName) ? ` ${frame.text} ` : frame.text;
      parent.overflow ||= frame.overflow || parent.text.length + text.length > 4096;
      parent.text = (parent.text + text).slice(0, 4096);
    }
  }
  return { root, nodes, texts, articleOwners, scripts };
}

function attribute(node, name) {
  return node?.attrs?.find((attr) => attr.name === name)?.value || "";
}

function hasClass(node, value) {
  return attribute(node, "class").split(/\s+/).includes(value);
}

function isMappedOwner(node) {
  return node?.tagName === "div" && (hasClass(node, "flip-container") || (hasClass(node, "card") && hasClass(node, "event-card")));
}

// One negative-only carrier survives all supported positive reader lanes.
// Canonical single dates agree across formats; unsupported cardinality never
// grants a positive occurrence, and a discovered conflict stays withdrawn.
function recordCardClaim(claims, url, title, date, dateCount) {
  const identity = JSON.stringify([title, date, dateCount]);
  const previous = claims.get(url);
  claims.set(url, previous === undefined ? identity : previous === identity ? previous : null);
}

function ownedBy(node, owner) {
  if (isMappedOwner(node)) return false;
  for (let parent = node.parentNode; parent; parent = parent.parentNode) {
    if (parent === owner) return true;
    if (parent.tagName === "article" || isMappedOwner(parent)) return false;
  }
  return false;
}

function within(node, ancestor) {
  for (let parent = node.parentNode; parent; parent = parent.parentNode) {
    if (parent === ancestor) return true;
  }
  return false;
}

function cleanText(value) {
  return String(value || "").replace(/\u00ad/g, "").replace(/\s+/g, " ").trim();
}

function sameOriginUrl(value, base) {
  try {
    const url = new URL(value, base);
    if (url.protocol !== "https:" || url.username || url.password || url.origin !== new URL(base).origin) return null;
    // Fragments identify document regions, not event detail identities.
    if (url.hash) return null;
    return url.href;
  } catch (_) {
    return null;
  }
}

module.exports = { boundedDocument, attribute, hasClass, ownedBy, within, cleanText, sameOriginUrl, recordCardClaim };
