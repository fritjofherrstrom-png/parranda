"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const plannerEntry = require("../planner-entry");
const reference = "0123456789abcdef".repeat(3);

test("explicit snapshot presence retains Planner shell intent", () => {
  assert.equal(plannerEntry.readPlannerEntry(`?snapshot=${reference}`).hasIntent, true);
});

test("CommonJS snapshot reader classifies absent intent without interpreting other keys", () => {
  assert.equal(typeof plannerEntry.readPublicDaySnapshotLink, "function");
  for (const query of ["", "?lang=sv", "place=Rome&lat=0&lng=0", "restore=last&lang=bad&lang=en", "unknown=1&snapshot_ref=ignored"]) {
    assert.deepEqual(plannerEntry.readPublicDaySnapshotLink(query), { kind: "absent" }, query);
    assert.deepEqual(plannerEntry.readPublicDaySnapshotLink(new URLSearchParams(query)), { kind: "absent" }, query);
  }
});

test("one lowercase 48-hex snapshot reference is ready with no implicit language", () => {
  for (const value of [reference, "0".repeat(48), "f".repeat(48)]) {
    const query = `?snapshot=${value}`;
    const expected = { kind: "ready", reference: value, lang: null };
    assert.deepEqual(plannerEntry.readPublicDaySnapshotLink(query), expected);
    assert.deepEqual(plannerEntry.readPublicDaySnapshotLink(new URLSearchParams(query)), expected);
  }
});

test("explicit en or sv language is preserved verbatim", () => {
  for (const lang of ["en", "sv"]) {
    for (const query of [`snapshot=${reference}&lang=${lang}`, `?lang=${lang}&snapshot=${reference}`]) {
      const expected = { kind: "ready", reference, lang };
      assert.deepEqual(plannerEntry.readPublicDaySnapshotLink(query), expected, query);
      assert.deepEqual(plannerEntry.readPublicDaySnapshotLink(new URLSearchParams(query)), expected, query);
    }
  }
});

test("present unsupported or malformed language is invalid rather than defaulted", () => {
  for (const lang of ["", "EN", "SV", "de", "en-US", "sv-SE", " sv", "en ", "en\n", "sv\u0000", "null", "%65n"]) {
    const params = new URLSearchParams({ snapshot: reference, lang });
    assert.deepEqual(plannerEntry.readPublicDaySnapshotLink(params), { kind: "invalid" }, JSON.stringify(lang));
    assert.deepEqual(plannerEntry.readPublicDaySnapshotLink(params.toString()), { kind: "invalid" }, JSON.stringify(lang));
  }
});

test("snapshot or lang duplicates are invalid even when values agree", () => {
  const queries = [
    `snapshot=${reference}&snapshot=${reference}`,
    `snapshot=${reference}&snapshot=${"f".repeat(48)}`,
    `snapshot=${reference}&snapshot=`, `snapshot=&snapshot=${reference}`,
    `snapshot=${reference}&lang=en&lang=en`, `snapshot=${reference}&lang=sv&lang=sv`,
    `snapshot=${reference}&lang=en&lang=sv`, `snapshot=${reference}&lang=sv&lang=`,
    `snapshot=${reference}&lang=&lang=sv`,
  ];
  for (const query of queries) {
    assert.deepEqual(plannerEntry.readPublicDaySnapshotLink(query), { kind: "invalid" }, query);
    assert.deepEqual(plannerEntry.readPublicDaySnapshotLink(new URLSearchParams(query)), { kind: "invalid" }, query);
  }
});

test("snapshot intent is closed to all query keys except snapshot and lang", () => {
  for (const [key, value] of [
    ["place", "Rome"], ["place_ref", "r41485"], ["lat", "0"], ["lng", "0"],
    ["anchor", "near"], ["preferences", "food"], ["prefs", "food"], ["edit", "1"],
    ["restore", "last"], ["view", "1"], ["city", "rome"], ["day", "1"],
    ["rhythm", "full"], ["planner", "open"], ["unknown", "1"], ["", ""],
    ["snapshot[]", reference], ["lang[]", "en"], ["LANG", "en"], ["__proto__", "1"],
  ]) {
    for (const supplied of [value, ""]) {
      const extra = new URLSearchParams([[key, supplied]]).toString();
      for (const query of [`snapshot=${reference}&lang=en&${extra}`, `${extra}&snapshot=${reference}`]) {
        assert.deepEqual(plannerEntry.readPublicDaySnapshotLink(query), { kind: "invalid" }, query);
        assert.deepEqual(plannerEntry.readPublicDaySnapshotLink(new URLSearchParams(query)), { kind: "invalid" }, query);
      }
    }
  }
});

test("snapshot references are exact rather than trimmed, case-folded or repaired", () => {
  const invalid = [
    "", "a".repeat(47), "a".repeat(49), reference.toUpperCase(), "g".repeat(48),
    ` ${reference}`, `${reference} `, `\t${reference}`, `${reference}\n`, `${reference}\r\n`,
    `${reference.slice(0, -1)}\u0000`, `${reference.slice(0, -1)}\u007f`,
    `${reference.slice(0, -1)}\ufffd`, `${reference.slice(0, -1)}\u2028`,
    `${reference.slice(0, -1)}\u2029`, `${reference.slice(0, -1)}\u00a0`,
    "null", "undefined", "{}", "%", "%30".repeat(48),
  ];
  for (const value of invalid) {
    const params = new URLSearchParams({ snapshot: value });
    assert.deepEqual(plannerEntry.readPublicDaySnapshotLink(params), { kind: "invalid" }, JSON.stringify(value));
    assert.deepEqual(plannerEntry.readPublicDaySnapshotLink(params.toString()), { kind: "invalid" }, JSON.stringify(value));
  }
  for (const query of ["snapshot", "snapshot=%", "snapshot=%E0%A4%A", `snapshot=${reference}%0A`]) {
    assert.deepEqual(plannerEntry.readPublicDaySnapshotLink(query), { kind: "invalid" }, query);
  }
});

test("ordinary URLSearchParams decoding is preserved without a raw-encoding policy", () => {
  for (const query of [
    `?%73napshot=${reference.replaceAll("0", "%30")}&l%61ng=%65n`,
    `snapshot=${reference}&lang=s%76`,
    `?&&snapshot=${reference}&&lang=en&`,
  ]) {
    const lang = new URLSearchParams(query).get("lang");
    assert.deepEqual(plannerEntry.readPublicDaySnapshotLink(query), { kind: "ready", reference, lang }, query);
    assert.deepEqual(plannerEntry.readPublicDaySnapshotLink(new URLSearchParams(query)), { kind: "ready", reference, lang }, query);
  }
  for (const query of [
    `snapshot=${reference}&%73napshot=${reference}`,
    `snapshot=${reference}&lang=en&l%61ng=en`,
    `snapshot=${reference}&pl%61ce=`,
  ]) {
    assert.deepEqual(plannerEntry.readPublicDaySnapshotLink(query), { kind: "invalid" }, query);
  }
});

test("all explicit snapshot values retain legacy entry shape for later intent handling", () => {
  for (const query of [
    "snapshot", "snapshot=", "snapshot=bad", `snapshot=${reference.toUpperCase()}`,
    `snapshot=${reference}%0A`, `snapshot=${reference}&snapshot=`,
    `snapshot=${reference}&lang=bad`, `snapshot=${reference}&restore=last`,
  ]) {
    for (const input of [query, new URLSearchParams(query)]) {
      assert.deepEqual(plannerEntry.readPlannerEntry(input), {
        place: "", coords: null, near: false, restore: query.endsWith("restore=last"), hasIntent: true,
      }, query);
    }
  }
});

test("ordinary entry values, first-value semantics and return fields stay unchanged", () => {
  const empty = { place: "", coords: null, near: false, restore: false, hasIntent: false };
  const cases = [
    ["", empty], ["planner=open&prefs=food&lang=sv&view=1", empty],
    ["place=+Rome+&place=", { ...empty, place: "Rome", hasIntent: true }],
    ["place=&place=Rome", empty], ["place=%00", empty], ["place=%EF%BF%BD", empty],
    ["lat=0&lng=0&place=Rome", { ...empty, place: "Rome", coords: { lat: 0, lng: 0 }, hasIntent: true }],
    ["lat=90&lng=-180", { ...empty, coords: { lat: 90, lng: -180 }, hasIntent: true }],
    ["lat=&lat=55&lng=13", empty], ["lat=91&lng=13", empty], ["lat=0&lng=", empty],
    ["anchor=near", { ...empty, near: true, hasIntent: true }], ["anchor=no&anchor=near", empty],
    ["restore=last", { ...empty, restore: true, hasIntent: true }], ["restore=no&restore=last", empty],
    ["place_ref=", { ...empty, hasIntent: true }], ["place_ref=broken", { ...empty, hasIntent: true }],
    ["place_ref=&place_ref=r41485", { ...empty, hasIntent: true }],
  ];
  for (const [query, expected] of cases) {
    assert.deepEqual(plannerEntry.readPlannerEntry(query), expected, query);
    assert.deepEqual(plannerEntry.readPlannerEntry(new URLSearchParams(query)), expected, query);
    assert.deepEqual(plannerEntry.readPublicDaySnapshotLink(query), { kind: "absent" }, query);
    assert.deepEqual(plannerEntry.readPlannerEntry(`${query}&snapshot=`), { ...expected, hasIntent: true }, query);
  }
});

test("both readers leave the supplied URLSearchParams unchanged", () => {
  for (const query of [
    `snapshot=${reference}&lang=sv`, `snapshot=${reference}&snapshot=`,
    `snapshot=${reference}&lang=en&place=`, "place=+Rome+&restore=last&lang=bad&lang=en",
  ]) {
    const params = new URLSearchParams(query);
    const before = [...params];
    plannerEntry.readPlannerEntry(params);
    plannerEntry.readPublicDaySnapshotLink(params);
    assert.deepEqual([...params], before, query);
  }
});

test("explicit valid or invalid snapshot URLs reach the real HTTP Planner shell", async (t) => {
  const { createServer } = require("node:http");
  const { buildApp } = require("../server/app");
  const app = buildApp({ openDataLoader: null, placeResolver: null, placeSuggestions: null, eventSupply: null, sourceCatalog: null, reviewedPlaceSource: null, placeSelectionStore: {} });
  const server = createServer(app);
  t.after(async () => {
    server.closeAllConnections();
    if (server.listening) {
      await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.removeListener("error", reject);
      resolve();
    });
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  for (const query of [
    `snapshot=${reference}`, "snapshot=", "snapshot=bad", `snapshot=${reference}%0A`,
    `snapshot=${reference}&lang=en&lang=en`, `snapshot=${reference}&restore=last`,
  ]) {
    const current = await fetch(`${origin}/anywhere?${query}`, { redirect: "manual" });
    assert.equal(current.status, 200, query);
    assert.equal(current.headers.get("location"), null, query);
    const body = await current.text();
    assert.match(body, /<astro-island/, query);
    assert.doesNotMatch(body, /Plan a day|Planera en dag|e.g. Lyon or Kyoto/, query);
    const legacy = await fetch(`${origin}/labs/anywhere?${query}`, { redirect: "manual" });
    assert.equal(legacy.status, 302, query);
    assert.equal(legacy.headers.get("location"), `/anywhere?${query}`, query);
    await legacy.text();
  }
});

test("TypeScript declaration exposes the exact closed snapshot union without changing legacy entry", () => {
  const path = require("node:path");
  const ts = require(require.resolve("typescript", { paths: [path.join(__dirname, "..", "frontend")] }));
  const fixturePath = path.join(__dirname, "public-day-link-typecheck.ts");
  const source = `
    import { readPlannerEntry, readPublicDaySnapshotLink } from "../planner-entry";
    type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends
      (<T>() => T extends B ? 1 : 2) ? true : false;
    type Expected = { kind: "absent" } | { kind: "invalid" } |
      { kind: "ready"; reference: string; lang: "en" | "sv" | null };
    const exactReturn: Equal<ReturnType<typeof readPublicDaySnapshotLink>, Expected> = true;
    const exactInput: Equal<Parameters<typeof readPublicDaySnapshotLink>, [string | URLSearchParams]> = true;
    const legacyReturn: Equal<ReturnType<typeof readPlannerEntry>, {
      place: string; coords: { lat: number; lng: number } | null;
      near: boolean; restore: boolean; hasIntent: boolean;
    }> = true;
    const link = readPublicDaySnapshotLink(new URLSearchParams());
    switch (link.kind) {
      case "ready": {
        const reference: string = link.reference;
        const lang: "en" | "sv" | null = link.lang;
        break;
      }
      case "absent":
      case "invalid":
        // @ts-expect-error Non-ready intent has no reference.
        link.reference;
        break;
      default: { const exhausted: never = link; }
    }
  `;
  const options = { noEmit: true, strict: true, types: [], target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS };
  const host = ts.createCompilerHost(options);
  const getSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (fileName, languageVersion, onError, shouldCreateNewSourceFile) => fileName === fixturePath
    ? ts.createSourceFile(fileName, source, languageVersion, true)
    : getSourceFile(fileName, languageVersion, onError, shouldCreateNewSourceFile);
  const program = ts.createProgram([fixturePath], options, host);
  const diagnostics = ts.getPreEmitDiagnostics(program).map(diagnostic =>
    `TS${diagnostic.code}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")}`);
  assert.deepEqual(diagnostics, []);
});
