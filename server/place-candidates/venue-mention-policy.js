'use strict';
const { isPublicSourceDestination } = require('../lib/public-source-destination');

// Independently reviewed exact PUBLIC article destinations for the bounded
// reference producer. Never derive this policy from candidate/published fields.
// This permits factual links only; it does not assert open licensing, image
// rights, sponsorship status or editorial recommendation.
const DESTINATIONS = new Set([
  'https://www.eater.com/maps/best-restaurants-rome-italy',
  'https://www.cntraveller.com/gallery/best-restaurants-in-rome',
]);
function isApprovedVenueArticleUrl(value) {
  return DESTINATIONS.has(value) && isPublicSourceDestination(value);
}
function publicVenueMentionUrls() {
  return new Set([...DESTINATIONS].filter(isPublicSourceDestination));
}
module.exports = { isApprovedVenueArticleUrl, publicVenueMentionUrls };
