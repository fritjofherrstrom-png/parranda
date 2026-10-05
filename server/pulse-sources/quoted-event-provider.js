"use strict";

const { extractPublicEventDocument, fetchPublicEventDocument } = require("./public-event-document");
const { normalizeSourceEventDateTime, normalizeIanaTimezone } = require("./source-event-time");
const { buildProviderCollectionOutcome } = require("./provider-collection-outcome");

function createQuotedEventProvider(options = {}) {
  return { descriptor: { id: options.id || "quoted-public-events", city: "generic", intendedUse: "pulse" },
    create() { return { async collect() {
      const empty = (status, reason) => ({ events: [], signals: [], time_sensitive_events: [],
        collection_status: buildProviderCollectionOutcome(status, { reason, eventRows: 0 }) });
      if (typeof options.eventReader !== "function") return empty("unavailable", "event_reader_unavailable");
      const timezone = normalizeIanaTimezone(options.timezone);
      if (!timezone) return empty("unavailable", "source_timezone_unavailable");
      // Reuse the existing bounded, same-origin scout fetcher. This descriptor
      // comes from the persisted machine qualification, never a public URL.
      const { fetchScoutPage } = require("./local-event-source-scout");
      const page = await fetchScoutPage({ url: options.endpoint, requiredOrigin: new URL(options.endpoint).origin,
        fetcher: options.fetcher || fetchPublicEventDocument, timeoutMs: options.timeoutMs });
      if (page.status !== "ok") return empty("failed", page.reason);
      let document;
      try { document = await extractPublicEventDocument(page, { language: options.sourceLanguage || "en" }); }
      catch (_error) { return empty("failed", "source_document_unreadable"); }
      const result = await options.eventReader({ text: document.text,
        sourceUrl: options.endpoint, language: options.sourceLanguage || "en" });
      if (result?.status !== "ok") return empty(result?.status === "unavailable" ? "unavailable" : "failed", "event_reader_failed");
      const rows = (result.events || []).map((event) => ({ ...event, timezone,
        ...(event.local_start ? { starts_at: normalizeSourceEventDateTime(event.local_start, { timezone }) } : {}),
      })).filter((event) => !event.local_start || event.starts_at);
      return { events: [], signals: [], time_sensitive_events: rows,
        collection_status: buildProviderCollectionOutcome(rows.length ? "ok" : "empty", { eventRows: rows.length }) };
    } }; },
  };
}
module.exports = { createQuotedEventProvider };
