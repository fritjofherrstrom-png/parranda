"use strict";

const { normalizeIanaTimezone } = require("./source-event-time");

function coordinateTimezone(lat, lng) {
  const zones = require("geo-tz/all").find(lat, lng);
  return zones.length === 1 && !zones[0].startsWith("Etc/") ? normalizeIanaTimezone(zones[0]) : null;
}

module.exports = { coordinateTimezone };
