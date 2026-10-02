"use strict";
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { createOvertureQueryRows, generatePlaces } = require("./helpers/dense-centre-fixture");

test("local Parquet fixture uses one native worker and a bounded memory budget", async () => {
  const fixture = await createOvertureQueryRows(generatePlaces());
  try {
    const [settings] = await fixture.queryRows("SELECT current_setting('threads') AS threads, current_setting('memory_limit') AS memory_limit");
    assert.equal(Number(settings.threads), 1, "small parallel test fixtures must not each allocate a host-wide native worker pool");
    const memory = /^(\d+(?:\.\d+)?) (KiB|MiB|GiB)$/.exec(settings.memory_limit);
    assert.ok(memory, "DuckDB reports a measurable memory ceiling");
    const bytes = Number(memory[1]) * { KiB: 1024, MiB: 1024 ** 2, GiB: 1024 ** 3 }[memory[2]];
    assert.ok(bytes > 0 && bytes <= 128 * 1024 ** 2, "fixture memory is bounded, not most of the host RAM");
  } finally {
    await fixture.close();
  }
});

test("fixture close drains accepted queries and refuses new work", async () => {
  const fixture = await createOvertureQueryRows(generatePlaces());
  const accepted = Array.from({ length: 8 }, (_, i) => fixture.queryRows(`SELECT ${i} AS value`));
  const closing = fixture.close();
  assert.equal(fixture.close(), closing, "concurrent close calls share one drain");
  await assert.rejects(() => fixture.queryRows("SELECT 9 AS value"), /closed/);
  await closing;
  const results = await Promise.all(accepted);
  assert.deepEqual(results.map(rows => rows[0].value), [0,1,2,3,4,5,6,7]);
  await assert.rejects(() => fixture.queryRows("SELECT 9 AS value"), /closed/);
});

test("one rejected fixture query does not poison later accepted work or cleanup", async () => {
  const fixture = await createOvertureQueryRows(generatePlaces());
  try {
    const broken = fixture.queryRows("SELECT missing_column FROM missing_table");
    const healthy = fixture.queryRows("SELECT 42 AS value");
    await assert.rejects(broken, /missing_table/);
    assert.equal((await healthy)[0].value, 42);
  } finally {
    await fixture.close();
  }
});
