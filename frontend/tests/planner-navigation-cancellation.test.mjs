import assert from "node:assert/strict";
import test from "node:test";

import { mountPlanner } from "./helpers/planner-harness.mjs";

const pendingLifecycle = (token) => ({
  planner_lifecycle: {
    version: 1,
    state: "warm_pending",
    token,
    retry_after_ms: 3000,
    remaining_ms: 50000,
    max_polls: 20,
  },
});

async function plannerWaitingOnColdSupply(t, token) {
  const h = await mountPlanner({
    url: "http://localhost/anywhere?place=Testville&lang=en",
  });
  t.after(() => h.unmount());
  await h.clock.advance(500);
  const initial = h.fetchMock.pending()[0];
  assert.ok(initial, "the initial Planner request exists");
  await h.fetchMock.respond(initial, pendingLifecycle(token), 202);
  assert.match(h.text(), /plan will continue automatically/i);
  return h;
}

function lifecycleDeletes(h) {
  return h.fetchMock.calls.filter(
    (call) => call.url === "/api/planner-status" && call.method === "DELETE",
  );
}

test("Change place synchronously sends one keepalive cancellation before navigation", async (t) => {
  const token = "e".repeat(48);
  const h = await plannerWaitingOnColdSupply(t, token);
  const link = h.container.querySelector('a[aria-label="Change place"]');
  assert.ok(link, "Change place remains available while supply is pending");

  // Keep jsdom on this document after the real target handler has run.
  h.document.addEventListener("click", (event) => event.preventDefault());
  await h.act(() => {
    link.dispatchEvent(new h.window.MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      button: 0,
    }));
  });

  assert.deepEqual(lifecycleDeletes(h).map(({ body, keepalive }) => ({ body, keepalive })), [
    { body: { token }, keepalive: true },
  ]);
});

test("pagehide sends one keepalive cancellation for direct or history navigation", async (t) => {
  const token = "f".repeat(48);
  const h = await plannerWaitingOnColdSupply(t, token);

  await h.act(() => {
    h.window.dispatchEvent(new h.window.Event("pagehide"));
    h.window.dispatchEvent(new h.window.Event("pagehide"));
  });

  assert.deepEqual(lifecycleDeletes(h).map(({ body, keepalive }) => ({ body, keepalive })), [
    { body: { token }, keepalive: true },
  ]);
});