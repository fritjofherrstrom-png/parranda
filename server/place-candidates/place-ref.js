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

module.exports = { toPlaceRef, parsePlaceRef };
