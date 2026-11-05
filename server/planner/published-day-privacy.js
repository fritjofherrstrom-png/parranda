'use strict';

// Private server evidence, captured before a parser can erase field presence.
// This tuple is not a public request flag or a portable projection.
function isRecord(value) {
  if (value === null || typeof value !== 'object') return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isDefaultEndpoint(value) {
  return isRecord(value) && Object.hasOwn(value, 'type') && value.type === 'auto' &&
    Reflect.ownKeys(value).every(key => key === 'type' || key === 'label') &&
    (!Object.hasOwn(value, 'label') || value.label === 'Parranda väljer');
}

function capturePublishedDayPrivacy(request) {
  if (request === null || typeof request !== 'object' || Array.isArray(request)) return null;
  const body = request.body === undefined ? {} : request.body;
  const query = request.query === undefined ? {} : request.query;
  if (!isRecord(body) || !isRecord(query)) return null;
  const owns = (value, key) => Object.prototype.hasOwnProperty.call(value || {}, key);
  return Object.freeze({
    explicitCoordinatesPresent: [body, query, body.origin].some(value => owns(value, 'lat') || owns(value, 'lng')),
    customEndpointPresent: ['home_base', 'start', 'end'].some(key => owns(body, key) && !isDefaultEndpoint(body[key])),
    biasPresent: owns(body, 'place_bias'),
    contextSelectionPresent: owns(body, 'place_context_selection'),
    selectionPresent: owns(body, 'place_selection'),
    requestedPlaceRefPresent: owns(body, 'place_ref'),
  });
}

module.exports = { capturePublishedDayPrivacy };
