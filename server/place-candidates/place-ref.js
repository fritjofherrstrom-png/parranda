'use strict';

// A link carries an OSM identity, never geography: "r5400890" is relation
// 5400890. Unlike a selection receipt it does not expire and does not depend
// on the language a query was typed in; the server looks the object up itself.
const PLACE_REF_TYPES = { n: 'node', w: 'way', r: 'relation' };

function toPlaceRef(osmRef) {
  const match = /^(node|way|relation)\/([1-9]\d{0,11})$/.exec(typeof osmRef === 'string' ? osmRef : '');
  return match ? `${match[1][0]}${match[2]}` : null;
}

function parsePlaceRef(value) {
  const match = typeof value === 'string' ? /^([nwr])([1-9]\d{0,11})$/.exec(value) : null;
  return match ? { ref: value, osmRef: `${PLACE_REF_TYPES[match[1]]}/${match[2]}`, lookupId: `${match[1].toUpperCase()}${match[2]}` } : null;
}

// Only a geographic place can be named by a link: an area (OSM class
// `boundary`) or a settlement/district/locality (class `place`). A venue or a
// street found by free text still anchors a day, but a link does not carry it.
const LINKABLE_CLASSES = new Set(['place', 'boundary']);
function isLinkablePlace(candidate) {
  return LINKABLE_CLASSES.has(candidate?.osm_class) && Boolean(toPlaceRef(candidate?.osm_ref));
}
function linkRefFor(candidate) {
  return isLinkablePlace(candidate) ? toPlaceRef(candidate.osm_ref) : null;
}

module.exports = { toPlaceRef, parsePlaceRef, isLinkablePlace, linkRefFor };
