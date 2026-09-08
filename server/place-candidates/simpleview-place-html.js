"use strict";

// HTML is parsed, never executed. Keep document ownership instead of joining
// regex matches across comments, raw-text elements or nested microdata items.
const { parse } = require("parse5");
const INERT = new Set(["script", "style", "template", "noscript", "iframe", "object"]);
const HTML_NAMESPACE = "http://www.w3.org/1999/xhtml";
const MAX_NODES = 20_000;
const MAX_DEPTH = 100;

function documentTree(html, maxBytes) {
  if (typeof html !== "string" || Buffer.byteLength(html, "utf8") > maxBytes) return null;
  let invalid = false;
  const root = parse(html, {
    sourceCodeLocationInfo: true,
    onParseError(error) {
      // A duplicate identity-bearing attribute is ambiguous even though a
      // browser would pick one. Other HTML repair is handled by DOM ownership.
      if (error.code === "duplicate-attribute") invalid = true;
    },
  });
  let count = 0;
  const pending = [[root, 0]];
  while (pending.length) {
    const [node, depth] = pending.pop();
    if (++count > MAX_NODES || depth > MAX_DEPTH) return null;
    for (const child of node.childNodes || []) pending.push([child, depth + 1]);
    if (node.content) pending.push([node.content, depth + 1]);
  }
  return invalid ? null : root;
}

function attr(node, name) {
  return node?.attrs?.find((item) => item.name === name)?.value ?? null;
}

function tokens(node, name) {
  return String(attr(node, name) || "").split(/\s+/).filter(Boolean);
}

function hasClass(node, name) { return tokens(node, "class").includes(name); }
function hasProp(node, name) { return tokens(node, "itemprop").includes(name); }
function isScope(node) { return attr(node, "itemscope") !== null; }

function elements(root, predicate = () => true) {
  const found = [];
  const pending = [...(root?.childNodes || [])].reverse();
  while (pending.length) {
    const node = pending.pop();
    if (node.namespaceURI !== HTML_NAMESPACE || INERT.has(node.tagName)) continue;
    if (predicate(node)) found.push(node);
    pending.push(...[...(node.childNodes || [])].reverse());
  }
  return found;
}

function nearest(node, predicate) {
  for (let parent = node?.parentNode; parent; parent = parent.parentNode) {
    if (predicate(parent)) return parent;
  }
  return null;
}

function text(node) {
  if (node?.nodeName === "#text") return node.value;
  if (!node || INERT.has(node.tagName) || isScope(node)) return "";
  return (node.childNodes || []).map(text).join(" ").replace(/\s+/g, " ").trim();
}

function ownProperties(scope, prop) {
  return elements(scope, (node) => hasProp(node, prop) && nearest(node, isScope) === scope);
}

function propertyValue(node) {
  if (isScope(node)) return null;
  if (node.tagName === "meta") return attr(node, "content");
  if (["a", "link", "area"].includes(node.tagName)) return attr(node, "href");
  return text(node);
}

function schemaType(node) {
  return String(attr(node, "itemtype") || "")
    .match(/^https?:\/\/schema\.org\/([A-Za-z]+)\/?$/i)?.[1]?.toLowerCase() || null;
}

function single(values) {
  const distinct = [...new Set(values.filter((value) => typeof value === "string" && value.trim()).map((value) => value.trim()))];
  return distinct.length === 1 ? distinct[0] : null;
}

function listFacts(html, { maxBytes, maxLinks, mapCategory, canonicalDetailUrl, productIdFromUrl, endpoint }) {
  const root = documentTree(html, maxBytes);
  if (!root) return [];
  const lists = elements(root, (node) => node.tagName === "ol" && hasClass(node, "productList"));
  if (lists.length !== 1) return [];
  const list = lists[0];
  const items = elements(list, (node) => node.tagName === "li" &&
    hasClass(node, "prodTypeATTR") && nearest(node, (parent) => parent.tagName === "ol" || parent.tagName === "ul") === list);
  const rows = [];
  const seen = new Set();
  for (const item of items) {
    const belongs = (node) => nearest(node, (parent) => parent.tagName === "li") === item;
    const headings = elements(item, (node) => node.tagName === "h2" && hasClass(node, "ProductName") && belongs(node));
    if (headings.length !== 1) continue;
    const links = elements(headings[0], (node) => node.tagName === "a" && hasClass(node, "ProductDetail") && node.parentNode === headings[0]);
    const types = elements(item, (node) => node.tagName === "div" && hasClass(node, "type") && belongs(node));
    if (links.length !== 1 || types.length !== 1) continue;
    const categories = elements(types[0], (node) => node.tagName === "p" && node.parentNode === types[0]);
    if (categories.length !== 1) continue;
    const category = text(categories[0]);
    const name = text(links[0]);
    const type = mapCategory(category);
    const url = canonicalDetailUrl(attr(links[0], "href"), endpoint, new URL(endpoint).origin);
    const id = url && productIdFromUrl(url);
    if (!id || !name || name.length > 160 || !category || category.length > 100 || !type || seen.has(id)) continue;
    seen.add(id);
    rows.push({ product_id: id, name, category, type, detail_url: url });
    if (rows.length >= maxLinks) break;
  }
  return rows;
}

function detailFacts(html, { maxBytes, listItem, schemaTypes, normalizeText, canonicalHttpsUrl, productIdFromUrl }) {
  const root = documentTree(html, maxBytes);
  if (!root) return null;
  const scopes = elements(root, (node) => isScope(node) && Object.hasOwn(schemaTypes, schemaType(node) || ""));
  if (scopes.length !== 1) return null;
  const scope = scopes[0];
  if (nearest(scope, isScope)) return null;
  const mapped = schemaTypes[schemaType(scope)];
  if (mapped && mapped !== listItem.type) return null;
  // Do not follow external microdata itemrefs or borrow another scope's atoms.
  if (attr(scope, "itemref") !== null) return null;
  const name = single(ownProperties(scope, "name").filter((node) => node.tagName === "h1").map(propertyValue));
  const urls = ownProperties(scope, "url").map(propertyValue).map(canonicalHttpsUrl)
    .filter((value) => value && productIdFromUrl(value));
  const url = single(urls);
  if (!name || name.length > 160 || normalizeText(name) !== normalizeText(listItem.name) || url !== listItem.detail_url) return null;
  const addresses = ownProperties(scope, "address").filter((node) => isScope(node) && schemaType(node) === "postaladdress");
  if (addresses.length !== 1 || attr(addresses[0], "itemref") !== null) return null;
  const address = {};
  for (const [key, prop] of Object.entries({ street: "streetAddress", locality: "addressLocality", region: "addressRegion", postal_code: "postalCode" })) {
    const value = single(ownProperties(addresses[0], prop).map(propertyValue));
    if (value && value.length <= 160) address[key] = value;
  }
  if (!address.street || !address.locality) return null;
  // The page-level OG pair is accepted only for a single place identity.
  // Comments, scripts, templates and nested items cannot supply coordinates.
  function coordinate(prop, min, max) {
    const metas = elements(root, (node) => node.tagName === "meta" && attr(node, "property") === prop);
    if (metas.length !== 1) return null;
    const owner = nearest(metas[0], isScope);
    if (owner && owner !== scope) return null;
    const raw = attr(metas[0], "content");
    if (!/^-?\d{1,3}\.\d{5,}$/.test(raw || "")) return null;
    const number = Number(raw);
    return Number.isFinite(number) && number >= min && number <= max ? number : null;
  }
  const lat = coordinate("og:latitude", -90, 90);
  const lng = coordinate("og:longitude", -180, 180);
  if (lat == null || lng == null) return null;
  // Scripts are never DOM fact sources or executed. Return only their text
  // for the bounded optional NewMind agreement check, not persistence.
  const scripts = [];
  const pending = [root];
  while (pending.length) {
    const node = pending.pop();
    if (node.tagName === "script" && node.namespaceURI === HTML_NAMESPACE) {
      scripts.push((node.childNodes || []).map((child) => child.value || "").join(""));
    } else if (!INERT.has(node.tagName)) pending.push(...(node.childNodes || []));
  }
  return { name, url, address, lat, lng, scripts };
}

module.exports = { listFacts, detailFacts };
