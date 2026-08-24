/**
 * Mount the real AnywherePlanner in jsdom and drive its clock.
 *
 * Every commitment bug found after Slice 04 shipped was a RACE — a click, a
 * 400ms debounce, an in-flight request, a restore, a silent follow-up — and
 * every one of them passed the source-text wiring tests that were supposed to
 * cover this surface. Regexes can prove a line exists; they cannot prove what
 * happens when two of those lines run in the wrong order. This harness exists
 * so those orderings can be asserted directly.
 *
 * The clock is controlled, not real: tests advance time explicitly, so a race
 * that depends on 400ms is exercised deterministically rather than slept
 * through.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { JSDOM } from "jsdom";
import * as esbuild from "esbuild";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, "../../src");

/** A controllable clock, so debounce windows are stepped rather than waited on. */
function createClock(window) {
  let now = 0;
  let seq = 0;
  const pending = new Map();
  // Replacing the global timers leaks into every later test file in the same
  // process, so the originals are handed back on teardown.
  const realGlobals = {
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
    setInterval: globalThis.setInterval,
    clearInterval: globalThis.clearInterval,
  };

  window.setTimeout = (fn, delay = 0) => {
    const id = ++seq;
    pending.set(id, { fn, at: now + Math.max(0, delay) });
    return id;
  };
  window.clearTimeout = (id) => pending.delete(id);
  window.setInterval = window.setTimeout;
  window.clearInterval = window.clearTimeout;
  globalThis.setTimeout = window.setTimeout;
  globalThis.clearTimeout = window.clearTimeout;

  return {
    get now() {
      return now;
    },
    /** Run every timer due within `ms`, in due order, including ones they schedule. */
    async advance(ms) {
      const target = now + ms;
      for (;;) {
        const due = [...pending.entries()]
          .filter(([, t]) => t.at <= target)
          .sort((a, b) => a[1].at - b[1].at || a[0] - b[0]);
        if (!due.length) break;
        const [id, timer] = due[0];
        pending.delete(id);
        now = Math.max(now, timer.at);
        timer.fn();
        await flushMicrotasks();
      }
      now = target;
      await flushMicrotasks();
    },
    pendingCount: () => pending.size,
    restore() {
      for (const [key, value] of Object.entries(realGlobals)) globalThis[key] = value;
      pending.clear();
    },
  };
}

export function flushMicrotasks() {
  return new Promise((r) => queueMicrotask(() => queueMicrotask(r)));
}

/**
 * A fetch stand-in whose responses are released by the test, so "in flight"
 * is a state the test can hold a request in rather than a moment it has to
 * catch.
 */
export function createDeferredFetch() {
  const calls = [];
  const queue = [];
  const fetch = (url, init) => {
    let settle;
    const promise = new Promise((resolveResponse, rejectResponse) => {
      settle = { resolveResponse, rejectResponse };
    });
    const body = init?.body ? JSON.parse(init.body) : null;
    const call = { url: String(url), body, ...settle, aborted: false };
    if (init?.signal) {
      init.signal.addEventListener("abort", () => {
        call.aborted = true;
        settle.rejectResponse(Object.assign(new Error("aborted"), { name: "AbortError" }));
      });
    }
    calls.push(call);
    queue.push(call);
    return promise;
  };
  return {
    fetch,
    calls,
    /** The most recent request that has not been answered yet. */
    pending: () => queue.filter((c) => !c.answered && !c.aborted),
    /**
     * Resolve the fetch. `json()` is deferred separately, because the component
     * awaits the headers and the body at two different moments and a race can
     * live in the gap between them.
     */
    respond(call, payload, status = 200, { deferBody = false } = {}) {
      call.answered = true;
      let releaseBody = null;
      const bodyPromise = deferBody
        ? new Promise((resolveBody) => {
            releaseBody = () => resolveBody(payload);
          })
        : Promise.resolve(payload);
      call.releaseBody = releaseBody;
      call.resolveResponse({
        ok: status >= 200 && status < 300,
        status,
        json: () => bodyPromise,
      });
      return flushMicrotasks();
    },
  };
}

let cachedModulePath = null;
let bundleGeneration = 0;

/**
 * Bundle the component once into a real ES module on disk, so the test imports
 * it the way the browser would. React stays external so the component and the
 * test renderer share one instance; leaflet is stubbed because the map effect
 * needs a real container it will never have here.
 */
async function buildComponent() {
  if (cachedModulePath) return cachedModulePath;
  const outfile = resolve(HERE, ".planner-harness-bundle.mjs");
  const stubLeaflet = {
    name: "stub-leaflet",
    setup(build) {
      build.onResolve({ filter: /^leaflet(\/.*)?$/ }, (args) => ({ path: args.path, namespace: "stub" }));
      // A self-returning proxy: leaflet's API is chainable and the map effect
      // walks a lot of it. Nothing here is asserted on — the map is simply not
      // what these tests are about, and a real one needs layout jsdom has not
      // got.
      build.onLoad({ filter: /.*/, namespace: "stub" }, () => ({
        contents: `
          const chain = new Proxy(function () {}, {
            get: (_t, prop) => (prop === "then" ? undefined : chain),
            apply: () => chain,
            construct: () => chain,
          });
          export default chain;
          export const map = chain;
          export const tileLayer = chain;
          export const marker = chain;
          export const polyline = chain;
          export const divIcon = chain;
          export const latLngBounds = chain;
        `,
        loader: "js",
      }));
    },
  };
  await esbuild.build({
    entryPoints: [resolve(SRC, "components/AnywherePlanner.tsx")],
    bundle: true,
    outfile,
    format: "esm",
    platform: "browser",
    jsx: "automatic",
    target: "es2022",
    external: ["react", "react-dom", "react-dom/client", "react/jsx-runtime"],
    plugins: [stubLeaflet],
    logLevel: "silent",
  });
  cachedModulePath = outfile;
  return outfile;
}

/**
 * @returns {Promise<{ window, document, clock, fetchMock, container, unmount, act }>}
 */
export async function mountPlanner({ url = "http://localhost/anywhere?lang=en", storage = {} } = {}) {
  const code = await buildComponent();
  bundleGeneration += 1;

  const dom = new JSDOM("<!doctype html><html><body><div id=\"root\"></div></body></html>", {
    url,
    pretendToBeVisual: false,
  });
  const { window } = dom;

  for (const [key, value] of Object.entries(storage)) {
    window.localStorage.setItem(key, JSON.stringify(value));
  }

  // The decision module is a global side-effect script in the server bundle.
  const decisionSource = readFileSync(resolve(SRC, "../../anywhere-render-decision.js"), "utf8");
  const decisionModule = { exports: {} };
  new Function("module", "exports", "globalThis", "window", decisionSource)(
    decisionModule,
    decisionModule.exports,
    window,
    window,
  );
  window.AnywhereRenderDecision = decisionModule.exports;

  const clock = createClock(window);
  const fetchMock = createDeferredFetch();
  window.fetch = fetchMock.fetch;

  // Node 24 defines some of these as getter-only on globalThis, so install by
  // descriptor and restore the originals on unmount.
  const priorGlobals = new Map();
  const install = (key, value) => {
    priorGlobals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  };
  install("window", window);
  install("document", window.document);
  install("navigator", window.navigator);
  install("localStorage", window.localStorage);
  install("fetch", window.fetch);
  install("AbortController", window.AbortController);
  install("AnywhereRenderDecision", decisionModule.exports);
  install("IS_REACT_ACT_ENVIRONMENT", true);

  const React = (await import("react")).default;
  const { createRoot } = await import("react-dom/client");
  const { act } = await import("react");

  // Imported AFTER the globals are installed: the module body reads window at
  // evaluation time, exactly as it does in a browser.
  const mod = await import(`${code}?v=${bundleGeneration}`);
  const AnywherePlanner = mod.default;
  if (typeof AnywherePlanner !== "function") {
    throw new Error("AnywherePlanner did not evaluate to a component");
  }

  const container = window.document.getElementById("root");
  const root = createRoot(container);

  const run = async (fn) => {
    await act(async () => {
      await fn?.();
    });
  };

  await run(() => {
    root.render(React.createElement(AnywherePlanner, { lang: "en" }));
  });

  return {
    window,
    document: window.document,
    clock: {
      advance: (ms) => run(() => clock.advance(ms)),
      pendingCount: clock.pendingCount,
    },
    fetchMock: {
      ...fetchMock,
      respond: (call, payload, status, opts) =>
        run(() => fetchMock.respond(call, payload, status, opts)),
      /** Release a body held back by respond(..., { deferBody: true }). */
      releaseBody: (call) => run(() => { call.releaseBody?.(); }),
    },
    container,
    act: run,
    text: () => container.textContent || "",
    /** Read what the component has written to localStorage. */
    readStorage(key) {
      const raw = window.localStorage.getItem(key);
      try {
        return raw ? JSON.parse(raw) : null;
      } catch {
        return null;
      }
    },
    async unmount() {
      await run(() => {
        root.unmount();
      });
      // React's scheduler drains through setImmediate, which runs AFTER this
      // frame. Restoring globals before it does would pull window out from
      // under work already queued.
      await new Promise((r) => setImmediate(r));
      clock.restore();
      for (const [key, descriptor] of priorGlobals) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else delete globalThis[key];
      }
      dom.window.close();
    },
  };
}

