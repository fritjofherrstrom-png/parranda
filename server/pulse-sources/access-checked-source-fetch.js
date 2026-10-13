"use strict";

const CHECKED = Symbol("accessCheckedSourceFetch");
const REDIRECTS = new Set([301, 302, 303, 307, 308]);
const MAX_REDIRECTS = 3;

// A bound publisher's origin cannot be expanded by a Location header. Each
// same-origin destination needs its own robots verdict BEFORE an outbound read.
// Preserve manual callers' redirect handling and their stricter source rules.
function createAccessCheckedSourceFetch(fetcher, { checkRedirectAccess = null } = {}) {
  if (typeof fetcher !== "function" || fetcher[CHECKED]) return fetcher;
  const policies = new Map();
  async function permission(url, options) {
    if (checkRedirectAccess) return checkRedirectAccess(url);
    const { applyRobotsPolicy, readBoundedText } = require("./local-event-source-scout");
    const origin = new URL(url).origin;
    const userAgent = new Headers(options.headers).get("user-agent");
    const policyKey = JSON.stringify([origin, userAgent]);
    let raw = policies.get(policyKey);
    if (raw === undefined) {
      // Policy retrieval itself never follows a redirect: an unavailable,
      // redirected or oversized policy cannot authorize an event destination.
      const response = await fetcher(new URL("/robots.txt", origin).href, {
        redirect: "manual", signal: options.signal,
        headers: { "User-Agent": userAgent, Accept: "text/plain" },
      });
      if (response?.ok !== true || response.redirected ||
          (response.url && new URL(response.url).origin !== origin)) return { status: "unknown" };
      const length = Number(response.headers?.get?.("content-length"));
      if (Number.isFinite(length) && length > 128 * 1024) return { status: "unknown" };
      raw = await readBoundedText(response, 128 * 1024);
      if (raw === null) return { status: "unknown" };
      policies.set(policyKey, raw);
    }
    const parsed = new URL(url);
    return applyRobotsPolicy(raw, parsed.pathname + parsed.search, userAgent);
  }
  const checkedFetch = async (input, options = {}) => {
    const { isScoutablePublicUrl, DEFAULT_USER_AGENT } = require("./local-event-source-scout");
    if (!new Headers(options.headers).has("user-agent")) {
      const headers = options.headers instanceof Headers ? new Headers(options.headers) : { ...options.headers };
      if (headers instanceof Headers) headers.set("User-Agent", DEFAULT_USER_AGENT);
      else headers["User-Agent"] = DEFAULT_USER_AGENT;
      options = { ...options, headers };
    }
    let url = String(input);
    const origin = new URL(url).origin;
    const visited = new Set([url]);
    for (let hops = 0; ; hops++) {
      options.signal?.throwIfAborted();
      const response = await fetcher(url, { ...options, redirect: "manual" });
      if (response?.redirected || (response?.url && new URL(response.url).origin !== origin)) {
        throw failure("source_redirect_unchecked");
      }
      if (!REDIRECTS.has(response?.status)) return response;
      await response.body?.cancel?.();
      if (options.redirect === "error") throw failure("source_redirect_disallowed");
      if (hops >= MAX_REDIRECTS) throw failure("source_redirect_limit");
      const location = response.headers?.get?.("location");
      if (typeof location !== "string" || !location.trim()) throw failure("source_redirect_invalid");
      let next;
      try { next = new URL(location, url); }
      catch { throw failure("source_redirect_invalid"); }
      next.hash = "";
      if (!isScoutablePublicUrl(next.href)) throw failure("unsafe_source_redirect");
      if (next.origin !== origin) throw failure("source_redirect_cross_origin");
      if (visited.has(next.href)) throw failure("source_redirect_loop");
      const verdict = await permission(next.href, options);
      options.signal?.throwIfAborted();
      if (verdict?.status !== "allowed") throw failure(verdict?.status === "disallowed"
        ? "source_redirect_robots_disallowed" : "source_redirect_robots_unknown");
      if (options.redirect === "manual") return response;
      // Feed reads are GETs. Do not implicitly replay a body-bearing operation.
      if (options.method && options.method.toUpperCase() !== "GET") throw failure("source_redirect_method_disallowed");
      visited.add(next.href);
      url = next.href;
    }
  };
  checkedFetch[CHECKED] = true;
  return checkedFetch;
}

function failure(reason) {
  return Object.assign(new Error(reason), { code: reason });
}

module.exports = { createAccessCheckedSourceFetch };
