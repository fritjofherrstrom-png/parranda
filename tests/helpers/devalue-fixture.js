"use strict";

/**
 * Test helper: serialise a plain value the way Nuxt's devalue does, so
 * fixtures can describe page state as ordinary objects. The root is wrapped in
 * a ShallowReactive marker like a real Nuxt payload.
 */
function encodeDevalue(root) {
  const flat = [["ShallowReactive", 1]];
  const seen = new Map();
  function add(value) {
    if (value === undefined) return -1;
    if (value !== null && typeof value === "object") {
      if (seen.has(value)) return seen.get(value);
      const index = flat.push(null) - 1;
      seen.set(value, index);
      flat[index] = Array.isArray(value)
        ? value.map(add)
        : Object.fromEntries(Object.entries(value).map(([key, member]) => [key, add(member)]));
      return index;
    }
    return flat.push(value) - 1;
  }
  add(root);
  return flat;
}

function nuxtPage(state) {
  return `<!doctype html><html><body><div id="__nuxt"></div>` +
    `<script type="application/json" data-nuxt-data="nuxt-app" data-ssr="true" id="__NUXT_DATA__">${JSON.stringify(encodeDevalue(state))}</script>` +
    `</body></html>`;
}

module.exports = { encodeDevalue, nuxtPage };
