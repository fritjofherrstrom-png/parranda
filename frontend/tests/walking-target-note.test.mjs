import test from "node:test";
import assert from "node:assert/strict";
import { walkingTargetNote } from "../src/lib/walking-target-note.mjs";

test("a published short 9 km day states the actual walk and uncertainty", () => {
  const negotiation = {
    route_present: true,
    walking: {
      status: "shorter_than_requested_band",
      target_km: 9,
      estimated_km: 4.5,
      target_floor_km: 5.4,
    },
  };
  assert.match(walkingTargetNote(negotiation, "sv"), /9 km.*4,5 km.*5,4 km/);
  assert.match(walkingTargetNote(negotiation, "sv"), /inte bekräftad/);
  assert.match(walkingTargetNote(negotiation, "en"), /9 km.*4\.5 km.*5\.4 km/);
});

test("no route or no server walking verdict does not fabricate a limitation", () => {
  assert.equal(walkingTargetNote(null), "");
  assert.equal(walkingTargetNote({ route_present: false, walking: { status: "shorter_than_requested_band", target_km: 9, estimated_km: 4, target_floor_km: 5.4 } }), "");
  assert.equal(walkingTargetNote({ route_present: true, walking: { status: "within_requested_band", target_km: 9, estimated_km: 7, target_floor_km: 5.4 } }), "");
});
