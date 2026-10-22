"use strict";

/**
 * Read the data a server-rendered page embeds for its own client.
 *
 * Many public calendars render their event list from a JSON state the server
 * puts in the page: Nuxt serialises it into `__NUXT_DATA__` (devalue format),
 * Next.js into `__NEXT_DATA__`. Reading that state is reading what the page
 * already publishes, without running its scripts or calling hidden endpoints.
 *
 * Every reader is bounded: oversized or malformed state returns null.
 */

const MAX_STATE_BYTES = 8 * 1024 * 1024;
const MAX_DEVALUE_NODES = 400000;
const MAX_DEPTH = 64;

// devalue reserves these negative indices for values JSON cannot express.
const DEVALUE_CONSTANTS = new Map([
  [-1, undefined],
  [-2, undefined],
  [-3, Number.NaN],
  [-4, Number.POSITIVE_INFINITY],
  [-5, Number.NEGATIVE_INFINITY],
  [-6, -0],
]);
// Vue reactivity wrappers Nuxt serialises around plain values.
const DEVALUE_WRAPPERS = new Set(["Reactive", "ShallowReactive", "Ref", "ShallowRef"]);

function extractScriptJson(html, id) {
  const source = String(html || "");
  const pattern = new RegExp(`<script\\b[^>]*\\bid=["']${id}["'][^>]*>([\\s\\S]*?)</script>`, "i");
  const match = source.match(pattern);
  if (!match) return null;
  const text = match[1].trim();
  if (!text || Buffer.byteLength(text, "utf8") > MAX_STATE_BYTES) return null;
  try {
    return JSON.parse(text);
  } catch (_error) {
    return null;
  }
}

/** Next.js page state: plain JSON under `__NEXT_DATA__`. */
function extractNextData(html) {
  const state = extractScriptJson(html, "__NEXT_DATA__");
  return state && typeof state === "object" ? state : null;
}

/** Nuxt 3 page state: devalue-serialised JSON under `__NUXT_DATA__`. */
function extractNuxtData(html) {
  const flat = extractScriptJson(html, "__NUXT_DATA__");
  return Array.isArray(flat) ? hydrateDevalue(flat) : null;
}

/**
 * Rebuild a devalue payload. The payload is a flat array; index 0 is the root
 * and every object or array refers to its members by index. Shared and cyclic
 * references resolve to the same object.
 */
function hydrateDevalue(flat) {
  if (!Array.isArray(flat) || flat.length === 0 || flat.length > MAX_DEVALUE_NODES) return null;
  const hydrated = new Map();

  function resolve(index, depth) {
    if (DEVALUE_CONSTANTS.has(index)) return DEVALUE_CONSTANTS.get(index);
    if (!Number.isInteger(index) || index < 0 || index >= flat.length) throw new Error("devalue_index_invalid");
    if (hydrated.has(index)) return hydrated.get(index);
    if (depth > MAX_DEPTH) throw new Error("devalue_too_deep");
    const value = flat[index];
    if (value === null || typeof value !== "object") {
      hydrated.set(index, value);
      return value;
    }
    if (Array.isArray(value)) {
      if (typeof value[0] === "string") return resolveTagged(index, value, depth);
      const out = [];
      hydrated.set(index, out);
      for (const member of value) out.push(resolve(member, depth + 1));
      return out;
    }
    const out = {};
    hydrated.set(index, out);
    for (const [key, member] of Object.entries(value)) out[key] = resolve(member, depth + 1);
    return out;
  }

  function resolveTagged(index, value, depth) {
    const [tag, ...members] = value;
    if (DEVALUE_WRAPPERS.has(tag)) {
      const inner = resolve(members[0], depth + 1);
      hydrated.set(index, inner);
      return inner;
    }
    if (tag === "EmptyRef" || tag === "EmptyShallowRef") {
      hydrated.set(index, undefined);
      return undefined;
    }
    if (tag === "Date") {
      const date = typeof members[0] === "string" ? members[0] : null;
      hydrated.set(index, date);
      return date;
    }
    if (tag === "Set") {
      const out = [];
      hydrated.set(index, out);
      for (const member of members) out.push(resolve(member, depth + 1));
      return out;
    }
    if (tag === "Map") {
      const out = {};
      hydrated.set(index, out);
      for (let i = 0; i + 1 < members.length; i += 2) {
        const key = resolve(members[i], depth + 1);
        if (typeof key === "string" || typeof key === "number") out[key] = resolve(members[i + 1], depth + 1);
      }
      return out;
    }
    // Unknown tags (BigInt, RegExp, custom reducers) carry no event data.
    hydrated.set(index, null);
    return null;
  }

  try {
    return resolve(0, 0);
  } catch (_error) {
    return null;
  }
}

/**
 * Collect every object in a state tree that satisfies `predicate`, visiting
 * each object once. Bounded by node count so a hostile state cannot spin.
 */
function findStateObjects(root, predicate, { maxNodes = MAX_DEVALUE_NODES } = {}) {
  const found = [];
  const seen = new Set();
  const stack = [root];
  let visited = 0;
  while (stack.length) {
    const node = stack.pop();
    if (!node || typeof node !== "object" || seen.has(node)) continue;
    seen.add(node);
    if (++visited > maxNodes) break;
    if (!Array.isArray(node) && predicate(node)) found.push(node);
    const children = Array.isArray(node) ? node : Object.values(node);
    for (let i = children.length - 1; i >= 0; i -= 1) {
      if (children[i] && typeof children[i] === "object") stack.push(children[i]);
    }
  }
  return found;
}

module.exports = {
  extractNextData,
  extractNuxtData,
  findStateObjects,
  hydrateDevalue,
};
