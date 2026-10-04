"use strict";

const { GENERIC_PROVIDER_CITY } = require("./provider-registry");
const { buildProviderCollectionOutcome } = require("./provider-collection-outcome");
const { normalizeIanaTimezone, datePartsInTimezone, normalizeSourceEventDate } = require("./source-event-time");
const { sameOriginUrl } = require("./scheduled-event-document");
const { extractScheduledEventCards, inspectScheduledEventContact, scheduledCardEvent } = require("./scheduled-event-card-normalizer");

const USER_AGENT = "Parranda-Source-Scout/1.0 (+https://github.com/fritjofherrstrom-png/parranda)";

function createScheduledEventCardProvider(options = {}) {
  const timezone = normalizeIanaTimezone(options.timezone);
  const language = /^[a-z]{2,3}(?:-[a-z0-9]+)?$/i.test(options.sourceLanguage || "") ? options.sourceLanguage : null;
  const descriptor = {
    id: options.id || "generic-scheduled-event-cards", label: options.label || "Public event calendar",
    city: GENERIC_PROVIDER_CITY, role: "official_live_baseline", sourceType: "official_website",
    status: options.status || "candidate", intendedUse: "pulse", timezone,
    sourceUrl: options.endpoint, supportedLanguages: language ? [language] : [],
    trust: { source_tier: options.sourceTier || "inferred", confidence: options.confidence || "low", human_verified: false, freshness: "fresh" },
    cachePolicy: { kind: "memory", ttlSeconds: 1200 },
    sourceOwnedFields: ["title", "starts_on", "ends_on", "time_window", "address", "city", "country", "place_context", "source_url"],
    parrandaOwnedFields: ["intents", "route_role_hint"],
  };
  return { descriptor, create(cityConfig, context = {}) {
    return { descriptor: { ...descriptor, city: cityConfig?.key || descriptor.city }, async collect(collectionContext = {}) {
      const endpoint = sameOriginUrl(options.endpoint, options.endpoint);
      if (!endpoint) return collection([], "unavailable", "source_endpoint_unavailable");
      if (!timezone) return collection([], "unavailable", "source_timezone_unavailable");
      if (!language) return collection([], "unavailable", "source_language_unavailable");
      const fetcher = options.fetcher || globalThis.fetch;
      if (typeof fetcher !== "function") return collection([], "unavailable", "source_fetch_unavailable");
      const dateOnly = normalizeSourceEventDate(collectionContext.date || context.date);
      const now = new Date(collectionContext.now || context.now || collectionContext.date || context.date);
      const local = datePartsInTimezone(now, timezone);
      const date = dateOnly || (local && `${local.year}-${String(local.month).padStart(2, "0")}-${String(local.day).padStart(2, "0")}`);
      if (!date) return collection([], "unavailable", "collection_context_unavailable");
      const controller = new AbortController();
      let timer;
      const deadline = new Promise((_, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(Object.assign(new Error("deadline"), { name: "AbortError" })); }, clamp(options.timeoutMs, 50, 15000, 10000));
      });
      try {
        return await Promise.race([collectBounded({ endpoint, fetcher, signal: controller.signal, date, timezone, language, options }), deadline]);
      } catch (error) {
        return collection([], "failed", error?.name === "AbortError" ? "source_timeout" : error?.reason || "source_fetch_failed");
      } finally { clearTimeout(timer); }
    } };
  } };
}

async function collectBounded({ endpoint, fetcher, signal, date, timezone, language, options }) {
  // Lazy import keeps the scout's provider-signature dependency acyclic.
  const { isScoutablePublicUrl, readBoundedText, parseRobotsGroups } = require("./local-event-source-scout");
  if (!isScoutablePublicUrl(endpoint)) return collection([], "unavailable", "source_endpoint_unavailable");
  const origin = new URL(endpoint).origin;
  let remaining = 8 * 1024 * 1024;
  let groups = null;
  function allowed(url) {
    if (!groups) return true; // Only robots.txt itself is fetched before policy.
    const exact = groups.filter((group) => group.agents.some((agent) => agent !== "*" && USER_AGENT.toLowerCase().includes(agent)));
    const selected = exact.length ? exact : groups.filter((group) => group.agents.includes("*"));
    if (!selected.length) return false;
    const target = new URL(url);
    const rules = selected.flatMap((group) => group.rules).filter((rule) => matchesRobotsPath(rule.path, target.pathname + target.search));
    rules.sort((a, b) => b.path.replace(/[*$]/g, "").length - a.path.replace(/[*$]/g, "").length || (a.type === "allow" ? -1 : 1));
    return rules[0]?.type !== "disallow";
  }
  async function request(url, robots = false) {
    let current = url;
    for (let redirects = 0; redirects <= 3; redirects++) {
      if (signal.aborted) throw Object.assign(new Error("aborted"), { name: "AbortError" });
      if (!sameOriginUrl(current, endpoint) || !isScoutablePublicUrl(current)) throw failure("source_redirect_cross_origin");
      if (!robots && !allowed(current)) throw failure("source_robots_disallowed");
      const response = await fetcher(current, { redirect: "manual", signal, headers: { "User-Agent": USER_AGENT, Accept: robots ? "text/plain" : "text/html, application/xhtml+xml" } });
      if (signal.aborted) throw Object.assign(new Error("aborted"), { name: "AbortError" });
      if (response?.url && sameOriginUrl(response.url, endpoint) !== current) throw failure("source_redirect_invalid");
      if (Number(response?.status) >= 300 && Number(response?.status) < 400) {
        if (redirects === 3) throw failure("source_redirect_limit");
        current = sameOriginUrl(response.headers?.get?.("location"), current);
        if (!current) throw failure("source_redirect_cross_origin");
        continue;
      }
      if (response?.ok !== true) throw failure(`source_http_${response?.status || "not_ok"}`);
      const maxBytes = Math.min(remaining, robots ? 128 * 1024 : 2 * 1024 * 1024);
      if (maxBytes < 1 || Number(response.headers?.get?.("content-length")) > maxBytes) throw failure("source_payload_invalid");
      const body = await readBoundedText(response, maxBytes);
      if (body == null) throw failure("source_payload_invalid");
      remaining -= Buffer.byteLength(body, "utf8");
      return { body, url: current };
    }
    throw failure("source_redirect_limit");
  }
  const robots = await request(`${origin}/robots.txt`, true);
  groups = parseRobotsGroups(robots.body);
  if (!groups.some((group) => group.agents.some((agent) => agent === "*" || USER_AGENT.toLowerCase().includes(agent)))) {
    throw failure("source_robots_unavailable");
  }
  const listing = await request(endpoint);
  const parsed = extractScheduledEventCards(listing.body, { sourceUrl: listing.url });
  if (!parsed.recognized) return collection([], "failed", "source_payload_invalid");
  const horizon = clamp(options.horizonDays, 1, 14, 7);
  const last = new Date(`${date}T00:00:00Z`);
  last.setUTCDate(last.getUTCDate() + horizon);
  const until = last.toISOString().slice(0, 10);
  const current = parsed.cards.filter((card) => card.date >= date && card.date <= until);
  if (!current.length) return collection([], "empty", "source_empty");
  const rows = [];
  // This is an explicitly bounded sample, not exhaustive calendar coverage.
  for (const card of current.slice(0, clamp(options.detailLimit, 1, 8, 4))) {
    const detail = await request(card.url);
    const inspection = inspectScheduledEventContact(detail.body, card);
    if (inspection.status === "failed") throw failure(inspection.reason);
    if (inspection.contact) rows.push(scheduledCardEvent(card, inspection.contact, { timezone, sourceLanguage: language, listingUrl: listing.url }));
  }
  return collection(rows, rows.length ? "ok" : "failed", rows.length ? null : "source_payload_invalid");
}

// Bounded glob matching without a backtracking regular expression. Robots
// wildcard/end rules must also protect followed and redirected detail paths.
function matchesRobotsPath(rule, path) {
  const end = rule.endsWith("$");
  const parts = (end ? rule.slice(0, -1) : rule).split("*");
  if (!path.startsWith(parts[0])) return false;
  let cursor = parts[0].length;
  for (let index = 1; index < parts.length; index++) {
    const part = parts[index];
    if (end && index === parts.length - 1) return path.endsWith(part) && path.length - part.length >= cursor;
    const found = path.indexOf(part, cursor);
    if (found < 0) return false;
    cursor = found + part.length;
  }
  return !end || cursor === path.length;
}

function failure(reason) { return Object.assign(new Error(reason), { reason }); }
function clamp(value, min, max, fallback) { return Number.isFinite(Number(value)) ? Math.max(min, Math.min(max, Math.floor(Number(value)))) : fallback; }
function collection(rows, status, reason) {
  return { events: [], signals: [], time_sensitive_events: rows, collection_status: buildProviderCollectionOutcome(status, { reason, eventRows: rows.length }) };
}

module.exports = { createScheduledEventCardProvider, matchesRobotsPath };
