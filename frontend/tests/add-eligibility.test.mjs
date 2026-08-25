/**
 * Add is offered only where the SERVER says the exact candidate identity can be
 * committed to.
 *
 * The Add lists render from place-structure candidates, which the composer
 * documents as display-only: "These facts never promote a candidate into the
 * route." The verb was nonetheless offered on all of them, so a user could
 * commit to a place the routing path had no way to accept — and the only
 * feedback was a refusal sentence after the round trip.
 *
 * The client cannot tell those apart. It can see coordinates, an id, a label,
 * and whether a stop is in the route; none of that is routability. So the rule
 * is: the server declares `commitment_eligible` on the exact identity, the
 * client reads it, and anything else means no Add.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { mountPlanner } from "./helpers/planner-harness.mjs";

const ADD = /Add to my day/;

function stop(id) {
  return {
    id,
    label: `Place ${id}`,
    lat: 41.9,
    lng: 12.49,
    type: "restaurant",
    tags: [],
    trust: { source_tier: "inferred", confidence: "low" },
    provenance: { attribution: [{ provider_id: "osm", label: "osm" }] },
  };
}

/**
 * A composed day plus nearby ideas. `nearby` entries are written exactly as the
 * server projects them, so a test can say what the server declared and nothing
 * more.
 */
function composedDay(stopIds, nearby = []) {
  return {
    days: [
      {
        date: "2026-08-23",
        experimental_agnostic_route_applied: true,
        primary_route: {
          id: "__agnostic_compose__",
          title: "Plan",
          summary: "s",
          estimated_km: 1.2,
          main_stops: stopIds.map(stop),
          map_route_points: [],
          map_path_points: [],
          legs: [],
          confidence: "low",
          trust_summary: { source_tiers: ["inferred"], confidence: "low" },
        },
        alternatives: [],
      },
    ],
    place_structure: {
      provenance: "agnostic_anchor",
      area_count: 1,
      areas: [],
      district_day: {
        areas: [
          {
            center: { lat: 41.9, lng: 12.49 },
            covers: ["food"],
            size: nearby.length,
            stop_ids: nearby.map((n) => n.id),
            stop_names: nearby.map((n) => n.name),
            stops: nearby.map((n) => ({
              id: n.id,
              name: n.name,
              lat: 41.9002,
              lng: 12.49,
              type: "cafe",
              tags: [],
              ...(n.eligible === undefined ? {} : { commitment_eligible: n.eligible }),
            })),
          },
        ],
      },
    },
    agnostic_route_output_experiment: { promotion: { promote: true } },
  };
}

async function plannerWith(nearby, stopIds = ["a", "b", "c"]) {
  const h = await mountPlanner({ url: "http://localhost/anywhere?place=Testville&lang=en" });
  await h.clock.advance(500);
  const first = h.fetchMock.pending()[0];
  assert.ok(first, "the planner composes on arrival with ?place=");
  await h.fetchMock.respond(first, composedDay(stopIds, nearby));
  await h.clock.advance(50);
  return h;
}

const buttonMatching = (h, pattern) =>
  [...h.container.querySelectorAll("button")].find((b) => pattern.test(b.textContent || ""));

async function click(h, button) {
  assert.ok(button, "the control under test exists");
  await h.act(() => {
    button.dispatchEvent(new h.window.Event("click", { bubbles: true }));
  });
}

/**
 * Open the detour disclosure and the named idea's panel.
 *
 * Idempotent: committing closes the open panel, so a second call must not
 * toggle the disclosure shut again.
 */
async function openIdea(h, name) {
  const disclosure = buttonMatching(h, /detour ideas? near your route/);
  if (disclosure && disclosure.getAttribute("aria-expanded") !== "true") {
    await click(h, disclosure);
  }
  await click(h, buttonMatching(h, new RegExp(`^${name}`)));
}

// --------------------------------------------------------------------------

test("a candidate the server declares eligible can be added", async (t) => {
  const h = await plannerWith([{ id: "routable", name: "Routable Place", eligible: true }]);
  t.after(() => h.unmount());

  await openIdea(h, "Routable Place");
  assert.ok(buttonMatching(h, ADD), "an eligible identity offers the verb");
});

test("a display-only candidate stays visible but offers no Add", async (t) => {
  // The idea is still useful — it is a real nearby place. What it is not is
  // something the routing path can accept a commitment to.
  const h = await plannerWith([{ id: "display-only", name: "Display Only", eligible: false }]);
  t.after(() => h.unmount());

  await openIdea(h, "Display Only");
  assert.match(h.text(), /Display Only/, "still shown as an idea");
  assert.ok(!buttonMatching(h, ADD), "but never as something to commit to");
});

test("a missing eligibility field means no Add", async (t) => {
  // An older server, a path that does not declare it, or a projection that
  // failed. Silence is not permission.
  const h = await plannerWith([{ id: "unspecified", name: "Unspecified Place" }]);
  t.after(() => h.unmount());

  await openIdea(h, "Unspecified Place");
  assert.match(h.text(), /Unspecified Place/);
  assert.ok(!buttonMatching(h, ADD), "absent eligibility must fail closed");
});

test("eligibility is read, never inferred from anything the client can see", async (t) => {
  // Everything a client might mistake for routability — real coordinates, a
  // real id, a real label, absence from the route — is present here, and the
  // server said no.
  const h = await plannerWith([{ id: "osm-node-12345", name: "Looks Real", eligible: false }]);
  t.after(() => h.unmount());

  await openIdea(h, "Looks Real");
  assert.ok(!buttonMatching(h, ADD), "shape is not a substitute for a declaration");
});

test("an unrecognised eligibility value is not treated as permission", async (t) => {
  // A newer server, or a corrupted payload. Only an explicit true is a yes.
  for (const value of ["true", 1, {}, null]) {
    const h = await mountPlanner({ url: "http://localhost/anywhere?place=Testville&lang=en" });
    await h.clock.advance(500);
    await h.fetchMock.respond(
      h.fetchMock.pending()[0],
      composedDay(["a", "b", "c"], [{ id: "odd", name: "Odd Value", eligible: value }]),
    );
    await h.clock.advance(50);
    await openIdea(h, "Odd Value");
    assert.ok(
      !buttonMatching(h, ADD),
      `commitment_eligible: ${JSON.stringify(value)} must not read as permission`,
    );
    assert.ok(!/commitment_eligible/.test(h.text()), "and the raw field never renders");
    await h.unmount();
  }
});

test("an eligible candidate reaches the existing request contract when added", async (t) => {
  const h = await plannerWith([{ id: "routable", name: "Routable Place", eligible: true }]);
  t.after(() => h.unmount());

  await openIdea(h, "Routable Place");
  await click(h, buttonMatching(h, ADD));
  await h.clock.advance(500);

  const sent = h.fetchMock.pending()[0];
  assert.ok(sent, "adding recomposes");
  assert.deepEqual(
    sent.body.pinned_candidate_ids,
    ["routable"],
    "the commitment travels as the same pin contract as before",
  );
});

test("Keep on a stop already in the published route is untouched", async (t) => {
  // Eligibility governs ADD, which commits to something the day does not have.
  // A stop the published route already contains is self-evidently routable —
  // gating Keep on a separate declaration would break a working verb for no
  // gain in honesty.
  const h = await plannerWith([{ id: "display-only", name: "Display Only", eligible: false }]);
  t.after(() => h.unmount());

  await click(h, [...h.container.querySelectorAll("button")].find((b) => /Place a/.test(b.textContent || "")));
  assert.ok(buttonMatching(h, /Keep this one/), "Keep still works on a route stop");
});

// --------------------------------------------------------------------------
// The structural invariant the behavioural tests cannot see.
// --------------------------------------------------------------------------

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const component = readFileSync(
  fileURLToPath(new URL("../src/components/AnywherePlanner.tsx", import.meta.url)),
  "utf8",
);

test("the client reads the server field and derives nothing of its own", () => {
  // Only an explicit true is permission — not truthiness, which would let a
  // string, a number or an object read as a yes.
  assert.match(component, /stop\?\.commitment_eligible === true/);

  // EVERY surface that can mint a new commitment is gated. Counting gates alone
  // would stay green if a fourth Add control were added ungated, so the two
  // counts are compared instead: one gate per Add control.
  const addControls = (component.match(/Add to my day/g) || []).length;
  const gates = (component.match(/canCommitTo\(stop\)/g) || []).length;
  assert.equal(
    gates,
    addControls,
    `${addControls} Add control(s) but ${gates} gate(s) — a new surface was added without one`,
  );
  assert.ok(addControls >= 2, "the detour list and the cluster list are both covered");
});

test("a commitment already held keeps its way out", async (t) => {
  // A place can become ineligible after it was added — a different walking
  // target, a changed reservoir. Withdrawing it must not require guessing where
  // the control went.
  const h = await plannerWith([{ id: "routable", name: "Routable Place", eligible: true }]);
  t.after(() => h.unmount());

  await openIdea(h, "Routable Place");
  await click(h, buttonMatching(h, ADD));
  await h.clock.advance(500);

  // The recompose comes back with the same place now declared ineligible.
  await h.fetchMock.respond(
    h.fetchMock.pending()[0],
    composedDay(["a", "b", "c"], [{ id: "routable", name: "Routable Place", eligible: false }]),
  );
  await h.clock.advance(50);

  await openIdea(h, "Routable Place");
  assert.ok(!buttonMatching(h, ADD), "it can no longer be committed to afresh");
  assert.ok(
    buttonMatching(h, /In my day — release|Med i dagen — släpp/),
    "but the commitment already made can still be withdrawn",
  );
});
