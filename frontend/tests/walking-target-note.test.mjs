import assert from "node:assert/strict";
import test from "node:test";

import { walkingTargetLabel, walkingTargetNotes } from "../src/lib/walking-target-note.mjs";

// The server's own verdict shapes (describeAgnosticWalkingTarget), as published
// on primary_route.walking_target_fit.
const fit = (status, estimated_km, target_km = 6) => ({ status, target_km, estimated_km });

const SUGGESTED_BEYOND_TARGET = {
  contract: "pulse_route_interrupt_v1",
  status: "suggested",
  route_mutation: false,
  reasons: ["exceeds_requested_walking_target"],
  event: { id: "ev-tonight", title: "Jazz by the quay" },
  walking_impact: {
    leg_km: 2.4,
    auto_weave_limit_km: 2.5,
    base_estimated_km: 6.3,
    removed_closing_leg_km: 1.4,
    estimated_km: 7.3,
    walking_target_km: 6,
    walking_target_status: "longer_than_requested_band",
  },
};

test("the target reads as the preset the user picked, in the page's language", () => {
  assert.equal(walkingTargetLabel(6, "en"), "Balanced (~6 km)");
  assert.equal(walkingTargetLabel(6, "sv"), "Lagom (~6 km)");
  assert.equal(walkingTargetLabel(4, "sv"), "Kort (~4 km)");
  assert.equal(walkingTargetLabel(9, "en"), "Long (~9 km)");
  // A target no preset sends (the API default) is named as a target, not a preset.
  assert.equal(walkingTargetLabel(8, "en"), "your walking target (~8 km)");
  assert.equal(walkingTargetLabel(8, "sv"), "ditt gångmål (~8 km)");
});

test("a day outside the requested band says so beside its distance", () => {
  assert.deepEqual(
    walkingTargetNotes({ route: { walking_target_fit: fit("longer_than_requested_band", 8.1) }, lang: "en" }),
    ["≈ 8.1 km — longer than Balanced (~6 km)."],
  );
  assert.deepEqual(
    walkingTargetNotes({ route: { walking_target_fit: fit("longer_than_requested_band", 8.1) }, lang: "sv" }),
    ["≈ 8,1 km — längre än Lagom (~6 km)."],
  );
  assert.deepEqual(
    walkingTargetNotes({ route: { walking_target_fit: fit("shorter_than_requested_band", 2.9) }, lang: "sv" }),
    ["≈ 2,9 km — kortare än Lagom (~6 km)."],
  );
  assert.deepEqual(
    walkingTargetNotes({ route: { walking_target_fit: fit("shorter_than_requested_band", 1.9, 4) }, lang: "en" }),
    ["≈ 1.9 km — shorter than Short (~4 km)."],
  );
});

test("a day inside the band, or without a verdict, gets no sentence", () => {
  assert.deepEqual(walkingTargetNotes({ route: { walking_target_fit: fit("within_requested_band", 6.3) } }), []);
  assert.deepEqual(walkingTargetNotes({ route: { walking_target_fit: { status: "not_requested", target_km: null, estimated_km: 9.2 } } }), []);
  assert.deepEqual(walkingTargetNotes({ route: { walking_target_fit: fit("unavailable", null) } }), []);
  assert.deepEqual(walkingTargetNotes({ route: { estimated_km: 10.1 } }), [], "no verdict is never guessed from the distance");
  assert.deepEqual(walkingTargetNotes(), []);
});

test("a woven event is named only for the distance it actually added", () => {
  const longWithEvent = {
    estimated_km: 10.1,
    walking_target_fit: fit("longer_than_requested_band", 10.1),
    live_event_stop: { event_id: "ev", leg_km: 2.4, base_estimated_km: 7.7, removed_closing_leg_km: 0 },
  };
  assert.deepEqual(walkingTargetNotes({ route: longWithEvent, lang: "sv" }), [
    "≈ 10,1 km — längre än Lagom (~6 km); kvällens evenemang lägger till 2,4 km.",
  ]);
  assert.deepEqual(walkingTargetNotes({ route: longWithEvent, lang: "en" }), [
    "≈ 10.1 km — longer than Balanced (~6 km); the evening event adds 2.4 km.",
  ]);
  // Ending at the event shortened a day that was already long: the event is
  // not why it is long, so it is not named.
  const shortened = {
    walking_target_fit: fit("longer_than_requested_band", 5.8, 4),
    live_event_stop: { event_id: "ev", leg_km: 2.4, base_estimated_km: 6.8, removed_closing_leg_km: 3.4 },
  };
  assert.deepEqual(walkingTargetNotes({ route: shortened, lang: "en" }), ["≈ 5.8 km — longer than Short (~4 km)."]);
  // No recorded day-before (an older payload): nothing is attributed.
  const unattributed = { walking_target_fit: fit("longer_than_requested_band", 10.1), live_event_stop: { event_id: "ev", leg_km: 2.4 } };
  assert.deepEqual(walkingTargetNotes({ route: unattributed, lang: "en" }), ["≈ 10.1 km — longer than Balanced (~6 km)."]);
});

test("an evening event the route did not take says what taking it would cost", () => {
  const route = { walking_target_fit: fit("within_requested_band", 6.3) };
  assert.deepEqual(walkingTargetNotes({ route, interrupt: SUGGESTED_BEYOND_TARGET, lang: "en" }), [
    "The evening event isn't in the route: Jazz by the quay is 2.4 km from the last stop and would make the day ≈ 7.3 km, longer than Balanced (~6 km).",
  ]);
  assert.deepEqual(walkingTargetNotes({ route, interrupt: SUGGESTED_BEYOND_TARGET, lang: "sv" }), [
    "Kvällens evenemang ingår inte i rutten: Jazz by the quay ligger 2,4 km från sista stoppet och skulle göra dagen ≈ 7,3 km, längre än Lagom (~6 km).",
  ]);

  const beyondHop = {
    ...SUGGESTED_BEYOND_TARGET,
    reasons: ["outside_auto_weave_limit"],
    walking_impact: { ...SUGGESTED_BEYOND_TARGET.walking_impact, leg_km: 3.6 },
  };
  assert.deepEqual(walkingTargetNotes({ route, interrupt: beyondHop, lang: "en" }), [
    "The evening event isn't in the route: Jazz by the quay is 3.6 km from the last stop, more than the 2.5 km Parranda adds on its own.",
  ]);
  assert.deepEqual(walkingTargetNotes({ route, interrupt: beyondHop, lang: "sv" }), [
    "Kvällens evenemang ingår inte i rutten: Jazz by the quay ligger 3,6 km från sista stoppet, längre än de 2,5 km som Parranda lägger till av sig själv.",
  ]);
});

test("only a server suggestion with a measured walk produces an event sentence", () => {
  const route = { walking_target_fit: fit("within_requested_band", 6.3) };
  const applied = { ...SUGGESTED_BEYOND_TARGET, status: "applied", route_mutation: true, reasons: ["walking_validated_evening_extension"] };
  assert.deepEqual(walkingTargetNotes({ route, interrupt: applied }), [], "a woven event is already on the route");
  const unmeasured = { ...SUGGESTED_BEYOND_TARGET, walking_impact: { ...SUGGESTED_BEYOND_TARGET.walking_impact, leg_km: null } };
  assert.deepEqual(walkingTargetNotes({ route, interrupt: unmeasured }), []);
  const untitled = { ...SUGGESTED_BEYOND_TARGET, event: { id: "ev" } };
  assert.deepEqual(walkingTargetNotes({ route, interrupt: untitled }), []);
  const unknownReason = { ...SUGGESTED_BEYOND_TARGET, reasons: ["something_new"] };
  assert.deepEqual(walkingTargetNotes({ route, interrupt: unknownReason }), [], "raw reason tokens never become copy");
});

test("both sentences can apply, band first", () => {
  const route = { walking_target_fit: fit("shorter_than_requested_band", 2.3, 4) };
  const interrupt = {
    ...SUGGESTED_BEYOND_TARGET,
    walking_impact: { ...SUGGESTED_BEYOND_TARGET.walking_impact, leg_km: 2.5, estimated_km: 4.8, walking_target_km: 4 },
  };
  assert.deepEqual(walkingTargetNotes({ route, interrupt, lang: "en" }), [
    "≈ 2.3 km — shorter than Short (~4 km).",
    "The evening event isn't in the route: Jazz by the quay is 2.5 km from the last stop and would make the day ≈ 4.8 km, longer than Short (~4 km).",
  ]);
});
