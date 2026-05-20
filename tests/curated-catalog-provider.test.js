const assert = require("node:assert/strict");
const test = require("node:test");

const rome = require("../server/cities/rome");
const barcelona = require("../server/cities/barcelona");
const {
  CuratedCatalogProvider,
  buildCuratedCatalogPlaceCandidates,
} = require("../server/place-candidates/curated-catalog-provider");
const { validatePlaceCandidate } = require("../server/place-candidates/contract");

test("CuratedCatalogProvider wraps Rome catalog items as valid PlaceCandidates", () => {
  const provider = new CuratedCatalogProvider(rome);
  const candidates = provider.listCandidates();

  assert.equal(candidates.length, rome.catalog.allItems.length);
  assert.ok(candidates.length > 0);
  for (const candidate of candidates) {
    assert.doesNotThrow(() => validatePlaceCandidate(candidate));
    assert.equal(candidate.city, "rome");
    assert.equal(candidate.source.kind, "city_catalog");
    assert.equal(candidate.source.id, "rome-catalog");
    assert.equal(candidate.trust.source_tier, "curated");
    assert.equal(candidate.trust.confidence, "high");
    assert.equal(candidate.trust.human_verified, true);
    assert.equal(candidate.city_pack_owned, true);
  }

  const trastevere = candidates.find((candidate) => candidate.id === "trastevere");
  assert.ok(trastevere);
  assert.equal(trastevere.candidate_kind, "area_preset");
  assert.equal(trastevere.is_structural, true);
  assert.equal(trastevere.area, "trastevere");
  assert.equal(trastevere.macro, "west");

  const sanClemente = candidates.find((candidate) => candidate.id === "san-clemente");
  assert.ok(sanClemente);
  assert.equal(sanClemente.candidate_kind, "real_place");
  assert.equal(sanClemente.is_structural, false);
  assert.ok(sanClemente.route_roles.includes("catalog_stop"));
});

test("CuratedCatalogProvider wraps Barcelona catalog items and preserves structural anchors", () => {
  const candidates = buildCuratedCatalogPlaceCandidates(barcelona);

  assert.equal(candidates.length, barcelona.catalog.allItems.length);

  const anchors = candidates.filter((candidate) => candidate.candidate_kind === "structural_anchor");
  const realPlaces = candidates.filter((candidate) => candidate.candidate_kind === "real_place");

  assert.equal(anchors.length, 5);
  assert.equal(realPlaces.length, 56);
  assert.ok(anchors.every((candidate) => candidate.is_structural));
  assert.ok(realPlaces.every((candidate) => !candidate.is_structural));
  assert.ok(anchors.every((candidate) => candidate.route_roles.includes("structural_anchor")));
  assert.ok(realPlaces.every((candidate) => candidate.route_roles.includes("catalog_stop")));

  const bandinis = candidates.find((candidate) => candidate.id === "bandinis-barcelona");
  assert.ok(bandinis);
  assert.equal(bandinis.candidate_kind, "real_place");
  assert.equal(bandinis.area, "sant-antoni");
  assert.equal(bandinis.macro, "central-grid");
  assert.equal(bandinis.source.id, "barcelona-catalog");

  const graciaAnchor = candidates.find((candidate) => candidate.id === "gracia-route-anchor");
  assert.ok(graciaAnchor);
  assert.equal(graciaAnchor.candidate_kind, "structural_anchor");
  assert.equal(graciaAnchor.is_structural, true);
  assert.equal(graciaAnchor.area, "gracia");
  assert.equal(graciaAnchor.macro, "northwest-local");
});

test("CuratedCatalogProvider can exclude structural candidates for user-facing place lists", () => {
  const visibleCandidates = buildCuratedCatalogPlaceCandidates(barcelona, {
    includeStructural: false,
  });

  assert.equal(visibleCandidates.length, 56);
  assert.ok(visibleCandidates.every((candidate) => candidate.candidate_kind === "real_place"));
  assert.ok(visibleCandidates.every((candidate) => !candidate.is_structural));
  assert.equal(
    visibleCandidates.some((candidate) => candidate.id === "gracia-route-anchor"),
    false,
  );
});

test("CuratedCatalogProvider requires a city config", () => {
  assert.throws(() => new CuratedCatalogProvider(null), /requires a city config/);
});
