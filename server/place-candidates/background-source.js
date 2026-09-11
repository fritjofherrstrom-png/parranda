"use strict";

// Process-private completion evidence. A public JSON payload cannot create it.
const SOURCE_COMPLETION = Symbol('trustedSourceCompletion');

function createBackgroundSource({ cache, keyFor, load }) {
  const operations = new Map();
  const failedValue = () => {
    const failed = [];
    Object.defineProperty(failed, 'source_error', { value: 'fetch_error' });
    return failed;
  };
  const attachConsumer = (operation, signal) => {
    if (!signal) {
      operation.hasUnscopedConsumer = true;
      return;
    }
    if (operation.consumers.has(signal)) return;
    const release = () => {
      signal.removeEventListener('abort', release);
      operation.consumers.delete(signal);
      if (!operation.settled && !operation.hasUnscopedConsumer && operation.consumers.size === 0) {
        operation.controller.abort();
      }
    };
    operation.consumers.set(signal, release);
    if (signal.aborted) release();
    else signal.addEventListener('abort', release, { once: true });
  };
  const pendingValue = completion => {
    const pending = [];
    Object.defineProperty(pending, SOURCE_COMPLETION, { value: completion });
    return pending;
  };
  const source = {
    eager: true,
    readCached(anchor, request) { return cache.peek(keyFor(anchor, request)) || []; },
    load(anchor, request) {
      const key = keyFor(anchor, request);
      const cached = cache.peek(key);
      if (cached) return cached;
      let operation = operations.get(key);
      if (!operation || operation.controller.signal.aborted) {
        const controller = new AbortController();
        operation = {
          controller,
          consumers: new Map(),
          hasUnscopedConsumer: false,
          settled: false,
          completion: null,
        };
        operations.set(key, operation);
        attachConsumer(operation, request?.signal);
        const producerRequest = { ...(request || {}), signal: controller.signal };
        const producerAnchor = anchor && typeof anchor === 'object'
          ? { ...anchor, signal: controller.signal }
          : anchor;
        operation.completion = cache.get(key, () => load(producerAnchor, producerRequest), {
          shouldStore: value => !controller.signal.aborted && Array.isArray(value) && !value.source_error,
        }).catch(() => failedValue()).finally(() => {
          operation.settled = true;
          for (const [signal, release] of operation.consumers) {
            signal.removeEventListener('abort', release);
          }
          operation.consumers.clear();
          if (operations.get(key) === operation) operations.delete(key);
        });
      } else {
        attachConsumer(operation, request?.signal);
      }
      return pendingValue(operation.completion);
    },
  };
  return source;
}

module.exports = { SOURCE_COMPLETION, createBackgroundSource };
