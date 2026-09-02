/**
 * Server-render an island the way Astro's static build does, then hydrate it
 * the way the browser does — and watch React for a mismatch.
 *
 * The planner harness mounts with createRoot, which CLIENT-renders: it never
 * looks at the server HTML, so no hydration mismatch can ever reach it. Every
 * island here ships `client:load`, so the real first paint is Astro's
 * build-time renderToString followed by hydrateRoot in the browser — two
 * renders that must agree. This harness is the only place that difference is
 * observable.
 *
 * The two phases run under DIFFERENT globals on purpose, because that is the
 * actual asymmetry:
 *   - build time runs in bare Node, where `window` does not exist;
 *   - the browser runs with `window` AND with whatever Express injected into
 *     the document before the island's module script executed.
 * A component that reads an injected global while rendering therefore renders
 * one tree at build time and a different one on hydration, which is exactly the
 * defect this exists to catch.
 *
 * React reports a mismatch through onRecoverableError (and, in production
 * builds, console.error). Both are collected: the test asserts on the API React
 * documents, and the console capture is there so a mismatch cannot slip past by
 * arriving on the other channel.
 */

import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { JSDOM } from "jsdom";
import * as esbuild from "esbuild";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, "../../src");

const bundles = new Map();

/** Bundle one island to a real ES module, React external so both phases share one copy. */
async function bundleIsland(entry) {
  if (bundles.has(entry)) return bundles.get(entry);
  const outfile = resolve(HERE, `.hydration-${entry.replace(/[^\w]/g, "_")}.mjs`);
  const stubLeaflet = {
    name: "stub-leaflet",
    setup(build) {
      build.onResolve({ filter: /^leaflet(\/.*)?$/ }, (args) => ({ path: args.path, namespace: "stub" }));
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
          export const circleMarker = chain;
          export const layerGroup = chain;
        `,
        loader: "js",
      }));
    },
  };
  await esbuild.build({
    entryPoints: [resolve(SRC, entry)],
    bundle: true,
    outfile,
    format: "esm",
    platform: "neutral",
    mainFields: ["module", "main"],
    conditions: ["import", "default"],
    jsx: "automatic",
    target: "es2022",
    external: ["react", "react-dom", "react-dom/client", "react-dom/server", "react/jsx-runtime"],
    plugins: [stubLeaflet],
    logLevel: "silent",
  });
  bundles.set(entry, outfile);
  return outfile;
}

/** Whatever this puts on globalThis is removed again, restoring any prior descriptor. */
function withGlobals(entries) {
  const prior = new Map();
  for (const [key, value] of Object.entries(entries)) {
    prior.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  }
  return () => {
    for (const [key, descriptor] of prior) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  };
}

let generation = 0;

/**
 * @param {object} params
 * @param {string} params.entry      island source path, relative to src/
 * @param {object} [params.props]    the props Astro passes (usually none)
 * @param {string} [params.url]      the URL the browser is on
 * @param {object} [params.injected] globals Express writes into the document
 *                                   BEFORE the island's module script runs
 * @param {(window: Window) => void} [params.setupBrowser]
 *        Browser state that exists BEFORE the island loads — stored days, an
 *        anchor handed over in sessionStorage. Runs after the document exists
 *        and before hydrateRoot, i.e. at the moment a returning visitor's
 *        browser is actually in when the island starts.
 * @returns {Promise<{serverHtml, clientHtml, recoverableErrors, consoleErrors, storageAtHydration, text, window, cleanup}>}
 */
export async function renderAndHydrate({
  entry,
  props = {},
  url = "http://localhost/",
  injected = {},
  setupBrowser = null,
} = {}) {
  const modulePath = await bundleIsland(entry);
  generation += 1;
  // Astro stamps one identifier prefix on the island and hands the same one to
  // both renders, so useId agrees across them. Matching that here keeps this a
  // test of the component rather than of a prefix mismatch we invented.
  const identifierPrefix = `r${generation}`;

  const React = (await import("react")).default;
  const { renderToString } = await import("react-dom/server");
  const { hydrateRoot } = await import("react-dom/client");
  const { act } = await import("react");

  // ---- Phase 1: the static build. Bare Node — no window, no document. ----
  const noBrowser = withGlobals({ window: undefined, document: undefined, localStorage: undefined, sessionStorage: undefined });
  let serverHtml;
  let Island;
  try {
    Island = (await import(`${modulePath}?ssr=${generation}`)).default;
    if (typeof Island !== "function") throw new Error(`${entry} did not evaluate to a component`);
    serverHtml = renderToString(React.createElement(Island, props), { identifierPrefix });
  } finally {
    noBrowser();
  }

  // ---- Phase 2: the browser. Server HTML in place, injected globals present. ----
  const dom = new JSDOM(`<!doctype html><html><body><div id="root">${serverHtml}</div></body></html>`, {
    url,
    pretendToBeVisual: false,
  });
  const { window } = dom;
  for (const [key, value] of Object.entries(injected)) window[key] = value;

  const consoleErrors = [];
  const realConsoleError = console.error;
  console.error = (...args) => {
    consoleErrors.push(args.map((a) => (a && a.stack ? String(a.message ?? a) : String(a))).join(" "));
  };

  const restoreGlobals = withGlobals({
    window,
    document: window.document,
    navigator: window.navigator,
    localStorage: window.localStorage,
    sessionStorage: window.sessionStorage,
    IS_REACT_ACT_ENVIRONMENT: true,
    requestAnimationFrame: (fn) => window.setTimeout(() => fn(0), 0),
    cancelAnimationFrame: (id) => window.clearTimeout(id),
    fetch: () => new Promise(() => {}),
    AbortController: window.AbortController,
  });

  setupBrowser?.(window);

  // Read back at the moment hydration starts, not when the test wrote it: a
  // test that seeds browser state has to be able to prove the state was
  // actually there, rather than that setItem was called somewhere.
  const snapshot = (store) => {
    const out = {};
    for (let i = 0; i < store.length; i += 1) {
      const key = store.key(i);
      out[key] = store.getItem(key);
    }
    return out;
  };
  const storageAtHydration = {
    local: snapshot(window.localStorage),
    session: snapshot(window.sessionStorage),
  };

  const recoverableErrors = [];
  const container = window.document.getElementById("root");
  let root;
  try {
    // Imported AFTER the browser globals exist, mirroring a module script that
    // only ever evaluates in a document.
    const ClientIsland = (await import(`${modulePath}?client=${generation}`)).default;
    await act(async () => {
      root = hydrateRoot(container, React.createElement(ClientIsland, props), {
        identifierPrefix,
        onRecoverableError: (error) => {
          recoverableErrors.push(String(error?.message ?? error));
        },
      });
    });
  } finally {
    console.error = realConsoleError;
  }

  return {
    serverHtml,
    clientHtml: container.innerHTML,
    recoverableErrors,
    consoleErrors,
    /** What the browser's stores held when hydrateRoot was called. */
    storageAtHydration,
    text: () => container.textContent || "",
    container,
    window,
    async cleanup() {
      await act(async () => {
        root?.unmount();
      });
      await new Promise((r) => setImmediate(r));
      restoreGlobals();
      dom.window.close();
    },
  };
}

/**
 * The islands the built pages actually hydrate.
 *
 * An island is not "a .tsx file under src/components" — that is a directory
 * listing, and it would start failing the day someone adds an ordinary leaf
 * component with required props, which is not an island and cannot be hydrated
 * standalone. An island is a component a PAGE mounts with a `client:*`
 * directive, so that is what is read: the directive in the page, resolved
 * through that page's own import.
 *
 * @returns {Promise<Array<{ name, entry, page, directive }>>} entries relative to src/
 */
export async function discoverIslands() {
  const { readdir, readFile } = await import("node:fs/promises");
  const pagesDir = resolve(SRC, "pages");
  const pages = (await readdir(pagesDir)).filter((name) => name.endsWith(".astro"));

  const found = new Map();
  for (const page of pages) {
    const source = await readFile(resolve(pagesDir, page), "utf8");
    const imports = new Map();
    for (const [, name, specifier] of source.matchAll(/import\s+(\w+)\s+from\s+["']([^"']+)["']/g)) {
      imports.set(name, specifier);
    }
    for (const [, name, directive] of source.matchAll(/<([A-Z]\w*)\b[^>]*\bclient:(load|idle|visible|media|only)/g)) {
      const specifier = imports.get(name);
      if (!specifier) {
        throw new Error(`${page} hydrates <${name}> but imports no such component`);
      }
      // "../components/LandingHero" -> "components/LandingHero.tsx"
      const entry = `${specifier.replace(/^\.\.\//, "").replace(/\.[jt]sx?$/, "")}.tsx`;
      found.set(entry, { name, entry, page, directive });
    }
  }
  return [...found.values()];
}

/** Every hydration complaint React made, on either channel. */
export function hydrationComplaints({ recoverableErrors, consoleErrors }) {
  const isHydration = (message) =>
    /Hydration failed|hydrat|did not match|error #418|error #423|error #425|errors\/418|errors\/423|errors\/425/i.test(message);
  return [...recoverableErrors, ...consoleErrors].filter(isHydration);
}
