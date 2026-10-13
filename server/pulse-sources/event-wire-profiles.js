"use strict";

/**
 * Wire profiles: how a publishing platform shapes its public event records.
 *
 * A profile describes a platform, not a city. Every library on the Danish
 * DPL CMS publishes the same `/api/v1/events` shape; every headless WordPress
 * site with the same ACF event fields embeds the same Nuxt state. A reviewed
 * manifest row binds one endpoint, its geography and its timezone to a
 * profile; the mapped provider does the rest.
 *
 * Paths are dot-separated property names; a numeric segment indexes an array.
 */

const WIRE_PROFILES = Object.freeze({
  // Danish public libraries (DPL CMS). One JSON array of upcoming events;
  // instants carry their UTC offset. Venues are library branches with a
  // street address but no coordinates.
  dpl_cms_events_v1: Object.freeze({
    payload: "json",
    records: Object.freeze({ path: "" }),
    fields: Object.freeze({
      id: "uuid",
      series: "series.uuid",
      title: "title",
      url: "url",
      start: "date_time.start",
      end: "date_time.end",
      all_day: "all_day",
      venue: "branches.0",
      street: "address.street",
      postal_code: "address.zip_code",
      locality: "address.city",
      country: "address.country",
      location_type: "address.locationType",
      status: "state",
      updated_at: "updated_at",
      tags: Object.freeze(["categories", "tags"]),
    }),
    skip_statuses: Object.freeze(["cancelled", "canceled"]),
    online_location_types: Object.freeze(["online", "virtual", "digital"]),
  }),

  // Headless WordPress event posts with an ACF `information` group, embedded
  // by a Nuxt front end. Each post lists its occurrences as floating local
  // clocks; the contact map pin is the publisher's own venue geometry.
  nuxt_wordpress_acf_events_v1: Object.freeze({
    payload: "nuxt_data",
    records: Object.freeze({ match: Object.freeze({ type: "event" }), require: "information.dates" }),
    fields: Object.freeze({
      id: "id",
      title: "title.rendered",
      url: "link",
      venue: "information.place.title",
      lat: "information.contact.location.lat",
      lng: "information.contact.location.lng",
      street_name: "information.contact.location.street_name",
      street_number: "information.contact.location.street_number",
      postal_code: "information.contact.location.post_code",
      locality: "information.contact.location.city",
      updated_at: "modified",
    }),
    occurrences: Object.freeze({ path: "information.dates", start: "start", end: "end" }),
    // A pin without a street is a city or area marker, not a venue.
    geometry_requires_any: Object.freeze(["street_name", "street_number"]),
  }),
});

function resolveWireProfile(name) {
  const key = typeof name === "string" ? name.trim().toLowerCase() : "";
  return Object.prototype.hasOwnProperty.call(WIRE_PROFILES, key) ? WIRE_PROFILES[key] : null;
}

module.exports = {
  WIRE_PROFILES,
  resolveWireProfile,
};
