"use strict";

// Process-private completion evidence. A public JSON payload cannot create it.
const SOURCE_COMPLETION = Symbol('trustedSourceCompletion');

function createBackgroundSource({ cache, keyFor, load }) {
  const source = {
    eager: true,
    readCached(anchor, request) { return cache.peek(keyFor(anchor, request)) || []; },
    load(anchor, request) {
      const key = keyFor(anchor, request);
      const cached = cache.peek(key);
      if (cached) return cached;
      const completion = cache.get(key, () => load(anchor, request), {
        shouldStore: value => Array.isArray(value) && !value.source_error,
      }).catch(() => {
        const failed = [];
        Object.defineProperty(failed, 'source_error', { value: 'fetch_error' });
        return failed;
      });
      const pending = [];
      Object.defineProperty(pending, SOURCE_COMPLETION, { value: completion });
      return pending;
    },
  };
  return source;
}

module.exports = { SOURCE_COMPLETION, createBackgroundSource };
