"use strict";

const { parse } = require("parse5");

const INERT = new Set(["script", "style", "template", "noscript", "svg"]);

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
  let characters = 0;
  while (stack.length) {
    const frame = stack[stack.length - 1];
    const node = frame.node;
    if (frame.next === 0) {
      if (nodes.length >= 20000 || frame.depth > 256) return null;
      nodes.push(node);
      articleOwners.set(node, frame.articleOwner || null);
      characters += (node.value || node.data || "").length;
      for (const attr of node.attrs || []) characters += attr.name.length + attr.value.length;
      if (characters > 1000000) return null;
      frame.text = node.nodeName === "#text" ? node.value : "";
    }
    const inert = INERT.has(node.tagName) || (node.attrs || []).some((attr) =>
      attr.name === "hidden" || (attr.name === "aria-hidden" && attr.value === "true"),
    );
    const children = inert ? [] : node.childNodes || [];
    if (frame.next < children.length) {
      stack.push({ node: children[frame.next++], depth: frame.depth + 1, next: 0,
        articleOwner: node.tagName === "article" ? node : frame.articleOwner });
      continue;
    }
    texts.set(node, frame.overflow ? null : cleanText(frame.text));
    stack.pop();
    // An article never lends its facts to a containing article or field.
    if (stack.length && node.tagName !== "article" && !inert) {
      const parent = stack[stack.length - 1];
      parent.overflow ||= frame.overflow || parent.text.length + frame.text.length > 4096;
      parent.text = (parent.text + frame.text).slice(0, 4096);
    }
  }
  return { root, nodes, texts, articleOwners };
}

function attribute(node, name) {
  return node?.attrs?.find((attr) => attr.name === name)?.value || "";
}

function hasClass(node, value) {
  return attribute(node, "class").split(/\s+/).includes(value);
}

function ownedBy(node, owner) {
  for (let parent = node.parentNode; parent; parent = parent.parentNode) {
    if (parent === owner) return true;
    if (parent.tagName === "article") return false;
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

module.exports = { boundedDocument, attribute, hasClass, ownedBy, within, cleanText, sameOriginUrl };
