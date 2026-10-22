"use strict";

const { classifyEventSourceLink } = require("../pulse-sources/event-source-link");

// A display group is not a publisher-declared recurrence and supplies no new
// event facts. Every member remains an individually accepted source occurrence.
function groupLiveProgramViews(views) {
  const groups = new Map();
  for (const view of views) {
    const key = programKey(view) || view;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(view);
  }
  return [...groups.values()].map(rows => {
    if (rows.length === 1) return rows[0];
    const occurrences = [...rows].sort((a, b) => a.starts_at.localeCompare(b.starts_at));
    return { ...occurrences[0], display_group_kind: "source_program", occurrences };
  });
}

function programKey(view) {
  if (!view?.id || !view.source_provider_id || view.source_series_id || view.occurrences?.length ||
      !view.title || !view.place || !view.timezone ||
      !Number.isFinite(view.lat) || !Number.isFinite(view.lng) ||
      typeof view.starts_at !== "string" || !/(?:Z|[+-]\d{2}:\d{2})$/.test(view.starts_at) ||
      !Number.isFinite(Date.parse(view.starts_at)) ||
      classifyEventSourceLink(view.source_url).source_link_kind !== "page") return null;
  return JSON.stringify([view.source_provider_id, view.source_url, view.title, view.place, view.lat, view.lng, view.timezone,
    view.preference_match, view.preference_score, view.matched_preferences, view.partial_preferences]);
}

// Reserve room for another answering publisher only among equally relevant
// accepted programs. This never brings an unaccepted row into Live, upgrades
// partial preference fit, or displaces the existing local-discovery slot.
function diversifyLiveHighlights(ranked, initial) {
  const highlights = [...initial];
  for (const candidate of ranked) {
    if (highlights.includes(candidate)) continue;
    const publishers = publisherKeys(candidate);
    const represented = new Set(highlights.flatMap(publisherKeys));
    if (!publishers.length || publishers.every(key => represented.has(key))) continue;
    const replace = highlights.findLastIndex((current, index) => {
      if (current.highlight_reason === "local_serendipity" || !samePreferenceFit(current, candidate)) return false;
      const others = new Set(highlights.filter((_, i) => i !== index).flatMap(publisherKeys));
      const currentPublishers = publisherKeys(current);
      return currentPublishers.length > 0 && currentPublishers.every(key => others.has(key));
    });
    if (replace >= 0) highlights[replace] = candidate;
  }
  return highlights;
}

function samePreferenceFit(left, right) {
  return (left.preference_match || "unrequested") === (right.preference_match || "unrequested") &&
    Number(left.preference_score || 0) === Number(right.preference_score || 0);
}

function publisherKeys(view) {
  const identities = (Array.isArray(view.sources) ? view.sources : [])
    .map(source => source?.identity).filter(value => typeof value === "string" && value);
  return identities.length ? [...new Set(identities)] : view.source_provider_id ? [view.source_provider_id] : [];
}

module.exports = { groupLiveProgramViews, diversifyLiveHighlights };
