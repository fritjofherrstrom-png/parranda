"use strict";
// Offline child for real-process gate tests; provider responses never use network.
const fs = require("node:fs/promises");
const { createSharedRateGate } = require("../../server/place-candidates/shared-rate-gate");
const { createNominatimPlaceResolver } = require("../../server/place-candidates/place-resolver");
const [mode, dir] = process.argv.slice(2);
(async () => {
  if (mode === "paused-owner") {
    const read = fs.readFile;
    fs.readFile = async (...args) => {
      const value = await read(...args);
      process.send({ held: true });
      await new Promise(resolve => process.once("message", resolve));
      return value;
    };
  }
  if (mode === "resolver") {
    let clock = 0;
    const resolver = createNominatimPlaceResolver({
      sharedGateDir: dir, minIntervalMs: 1100, now: () => clock,
      sleep: async delay => {
        process.send({ waiting: delay });
        const message = await new Promise(resolve => process.once("message", resolve));
        clock = message.now;
      },
      fetcher: async () => {
        process.send({ sent: clock });
        return { ok: true, status: 200, json: async () => [] };
      },
    });
    await resolver("Fixture venue");
    process.send({ done: true });
  } else {
    const gate = createSharedRateGate({ dir, name: "nominatim", intervalMs: 1100,
      now: () => 0, maxLockWaitMs: mode === "contender" ? 60 : 3000 });
    process.send({ slot: await gate.reserve() });
  }
  process.disconnect();
})().catch(error => {
  process.send({ error: error.message });
  process.disconnect();
});
