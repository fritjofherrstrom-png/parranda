const assert = require("node:assert/strict");
const test = require("node:test");
const { EventEmitter } = require("node:events");

const {
  DEFAULT_POLL_MS,
  applyLatestMain,
  classifyLatestState,
  inspectLatestMain,
  normalizePollMs,
  runShareLatest,
} = require("../scripts/share-latest");

test("latest sharing only accepts a clean main fast-forward", () => {
  assert.deepEqual(
    classifyLatestState({ branch: "main", dirty: false, head: "a", remote: "b", remoteIsDescendant: true }),
    { status: "update_ready", reason: "new_origin_main", from: "a", to: "b" },
  );
  assert.deepEqual(
    classifyLatestState({ branch: "main", dirty: false, head: "b", remote: "b", remoteIsDescendant: true }),
    { status: "up_to_date", reason: "origin_main_current" },
  );
});

test("latest sharing refuses branch drift, dirty files and diverged history", () => {
  assert.equal(
    classifyLatestState({ branch: "feature", dirty: false, head: "a", remote: "b", remoteIsDescendant: true }).reason,
    "share_checkout_not_main",
  );
  assert.equal(
    classifyLatestState({ branch: "main", dirty: true, head: "a", remote: "b", remoteIsDescendant: true }).reason,
    "share_checkout_dirty",
  );
  assert.equal(
    classifyLatestState({ branch: "main", dirty: false, head: "a", remote: "b", remoteIsDescendant: false }).reason,
    "share_checkout_diverged",
  );
});

test("poll cadence is bounded instead of allowing a GitHub fetch loop", () => {
  assert.equal(normalizePollMs(undefined), DEFAULT_POLL_MS);
  assert.equal(normalizePollMs(1), 15_000);
  assert.equal(normalizePollMs(20 * 60_000), 15 * 60_000);
});

test("inspection fetches origin/main and records the bounded update surface", async () => {
  const calls = [];
  const responses = new Map([
    ["git branch --show-current", { code: 0, stdout: "main\n" }],
    ["git status --porcelain", { code: 0, stdout: "" }],
    ["git rev-parse HEAD", { code: 0, stdout: "aaa\n" }],
    ["git fetch --quiet origin main", { code: 0, stdout: "" }],
    ["git rev-parse origin/main", { code: 0, stdout: "bbb\n" }],
    ["git merge-base --is-ancestor aaa bbb", { code: 0, stdout: "" }],
    ["git diff --name-only aaa bbb", { code: 0, stdout: "server/app.js\nfrontend/dist/anywhere/index.html\n" }],
  ]);
  const run = async (command, args) => {
    const key = `${command} ${args.join(" ")}`;
    calls.push(key);
    const response = responses.get(key);
    assert.ok(response, `unexpected command: ${key}`);
    return response;
  };

  const state = await inspectLatestMain({ run, cwd: "/deploy" });
  assert.equal(state.status, "update_ready");
  assert.deepEqual(state.changed_files, ["server/app.js", "frontend/dist/anywhere/index.html"]);
  assert.ok(calls.includes("git fetch --quiet origin main"));
});

test("dirty inspection refuses before any network or mutation", async () => {
  const calls = [];
  const run = async (command, args) => {
    const key = `${command} ${args.join(" ")}`;
    calls.push(key);
    if (key === "git branch --show-current") return { code: 0, stdout: "main\n" };
    if (key === "git status --porcelain") return { code: 0, stdout: " M server/app.js\n" };
    throw new Error(`unexpected command: ${key}`);
  };

  const state = await inspectLatestMain({ run, cwd: "/deploy" });
  assert.equal(state.reason, "share_checkout_dirty");
  assert.deepEqual(calls, ["git branch --show-current", "git status --porcelain"]);
});

test("apply uses ff-only and refreshes dependencies only when the root manifest changed", async () => {
  const calls = [];
  const run = async (command, args) => {
    calls.push(`${command} ${args.join(" ")}`);
    return { code: 0, stdout: "" };
  };
  const ordinary = await applyLatestMain(
    { status: "update_ready", from: "a", to: "b", changed_files: ["server/app.js"] },
    { run, cwd: "/deploy" },
  );
  assert.equal(ordinary.updated, true);
  assert.deepEqual(calls, ["git merge --ff-only origin/main"]);

  calls.length = 0;
  const dependencies = await applyLatestMain(
    { status: "update_ready", from: "b", to: "c", changed_files: ["package-lock.json"] },
    { run, cwd: "/deploy" },
  );
  assert.equal(dependencies.dependencies_refreshed, true);
  assert.deepEqual(calls, ["git merge --ff-only origin/main", "npm ci --omit=dev"]);
});

test("a new main stops one app and starts one replacement behind the same tunnel port", async () => {
  const states = [
    { status: "up_to_date", reason: "origin_main_current" },
    { status: "update_ready", reason: "new_origin_main", from: "aaa", to: "bbb", changed_files: [] },
  ];
  const applied = [];
  const children = [];
  const spawnImpl = () => {
    const child = new EventEmitter();
    child.exitCode = null;
    child.signalCode = null;
    child.kill = (signal) => {
      child.signalCode = signal;
      queueMicrotask(() => child.emit("exit", 0, signal));
      return true;
    };
    children.push(child);
    return child;
  };
  const controller = await runShareLatest({
    cwd: "/deploy",
    pollMs: 15_000,
    registerSignals: false,
    setExitCode: false,
    inspect: async () => states.shift() || { status: "up_to_date", reason: "origin_main_current" },
    apply: async (state) => { applied.push(state.to); },
    spawnImpl,
    env: {},
  });

  assert.equal(children.length, 1, "initial clean main starts once");
  await controller.check();
  assert.deepEqual(applied, ["bbb"]);
  assert.equal(children.length, 2, "the updated build replaces, rather than duplicates, the app");
  assert.equal(children[0].signalCode, "SIGTERM");

  await controller.shutdown("SIGTERM");
});

test("an app crash during a no-op fetch still restarts the current build", async () => {
  const children = [];
  let inspections = 0;
  const spawnImpl = () => {
    const child = new EventEmitter();
    child.exitCode = null;
    child.signalCode = null;
    child.kill = (signal) => {
      child.signalCode = signal;
      queueMicrotask(() => child.emit("exit", 0, signal));
      return true;
    };
    children.push(child);
    return child;
  };
  const inspect = async () => {
    inspections += 1;
    if (inspections === 2) {
      children[0].exitCode = 1;
      children[0].emit("exit", 1, null);
    }
    return { status: "up_to_date", reason: "origin_main_current" };
  };
  const controller = await runShareLatest({
    cwd: "/deploy",
    pollMs: 15_000,
    restartDelayMs: 0,
    registerSignals: false,
    setExitCode: false,
    inspect,
    spawnImpl,
    env: {},
  });

  await controller.check();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(children.length, 2, "fetch activity must not suppress crash recovery");
  await controller.shutdown("SIGTERM");
});
