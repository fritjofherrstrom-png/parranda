import test from "node:test";
import assert from "node:assert/strict";
import { buildAnywherePayload } from "../src/lib/anywhere-payload.mjs";
import { buildSavedEntry, savedEntryId, upsertSaved } from "../src/lib/anywhere-storage.mjs";
import { encodeShareParams, decodeShareParams } from "../src/lib/anywhere-share.mjs";
import { buildCommitmentSnapshot, readCommitmentSnapshot } from "../src/lib/commitment-snapshot.mjs";
import { urlEntryCommitments } from "../src/lib/url-entry-commitments.mjs";

const selected = ["food", "culture", "views"];
const base = { place: "Testville", dateIso: "2026-10-16", selected, walkKey: "balanced" };
const priority = ["views", "food", "culture"];

function saved(inputs) {
  return buildSavedEntry({
    place: base.place, dateIso: base.dateIso,
    classification: { status: "composed" },
    safeResponse: { days: [{ date: base.dateIso }] },
    inputs: { mode: "typed", ...base, ...inputs },
  });
}

test("explicit priority survives the real payload builder without reordering selected interests", () => {
  const payload = buildAnywherePayload({ place: base.place, preferences: selected, preferencePriority: priority });
  assert.deepEqual(payload.preference_priority, priority);
  assert.deepEqual(payload.preferences, selected, "dominance is not selection order or route order");
});

test("opposite priority gives the same place/date/interests distinct durable identities", () => {
  const a = saved({ preferencePriority: priority });
  const b = saved({ preferencePriority: [...priority].reverse() });
  assert.notEqual(a.id, b.id, "different dominance must not overwrite a saved day");
  assert.equal(a.id, savedEntryId({ ...base, preferencePriority: priority }));
  assert.equal(upsertSaved([a], b).length, 2);
});

test("saved priority is canonical and detached from later caller changes", () => {
  const raw = ["views", "views", "food", "unknown"];
  const entry = saved({ preferencePriority: raw });
  assert.deepEqual(entry.inputs.preferencePriority, priority);
  raw[0] = "culture";
  assert.deepEqual(entry.inputs.preferencePriority, priority);
  assert.equal(entry.id, savedEntryId({ ...base, preferencePriority: priority }));
});

test("explicit priority survives the real share encoder and decoder", () => {
  const query = encodeShareParams({ place: base.place, preferences: selected, preferencePriority: priority });
  assert.equal(new URLSearchParams(query).get("prio"), priority.join(","));
  assert.deepEqual(decodeShareParams(query).preferencePriority, priority);
  assert.deepEqual(decodeShareParams(query).preferences, selected);
});

test("legacy neutral priority adds no payload, storage, URL or identity fields", () => {
  const payload = buildAnywherePayload({ place: base.place, preferences: selected });
  assert.equal(Object.hasOwn(payload, "preference_priority"), false);
  const entry = saved({});
  assert.equal(entry.id, "Testville::2026-10-16::culture,food,views::rhythm=balanced");
  assert.equal(Object.hasOwn(entry.inputs, "preferencePriority"), false);
  const query = encodeShareParams({ place: base.place, preferences: selected });
  assert.equal(new URLSearchParams(query).has("prio"), false);
  assert.equal(Object.hasOwn(decodeShareParams(query), "preferencePriority"), false);
  assert.equal(savedEntryId({ ...base, preferencePriority: [] }), entry.id);
});

const edit = (overrides = {}) => ({
  version: 1, action: "remove", candidate_id: "poi:old",
  retained_candidate_ids: ["poi:z", "poi:a"], target_stop_count: 2, slot_index: 1,
  replacement_preference: null, removed_candidate_ids: ["poi:old"], ...overrides,
});

test("manual day edit survives payload without being confused with preference deselection", () => {
  const dayEdit = edit();
  const payload = buildAnywherePayload({ place: base.place, preferences: selected, dayEdit });
  assert.deepEqual(payload.day_edit, dayEdit);
  assert.deepEqual(payload.preferences, selected);
  assert.equal(Object.hasOwn(payload, "excluded_candidate_ids"), false, "routed removal is a separate intent");
});

test("manual count and retained slot order both participate in durable saved identity", () => {
  const two = saved({ dayEdit: edit() });
  const one = saved({ dayEdit: edit({ retained_candidate_ids: ["poi:z"], target_stop_count: 1 }) });
  const reversed = saved({ dayEdit: edit({ retained_candidate_ids: ["poi:a", "poi:z"] }) });
  const replacement = saved({ dayEdit: edit({ action: "replace", target_stop_count: 3, replacement_preference: "culture" }) });
  assert.notEqual(two.id, one.id, "manual count variants cannot overwrite each other");
  assert.notEqual(two.id, reversed.id, "retained route order is not a sortable set");
  assert.notEqual(two.id, replacement.id, "replace is not remove");
  assert.equal(two.id, savedEntryId({ ...base, dayEdit: edit() }));
});

test("saved day edit is a bounded canonical copy rather than caller provenance", () => {
  const raw = edit({ source: "forged", lat: 59.3, selection_receipt: "secret", removed_candidate_ids: ["poi:other", "poi:old"] });
  const entry = saved({ dayEdit: raw });
  assert.deepEqual(entry.inputs.dayEdit, edit({ removed_candidate_ids: ["poi:old", "poi:other"] }));
  raw.retained_candidate_ids.reverse();
  raw.removed_candidate_ids.push("later");
  assert.deepEqual(entry.inputs.dayEdit.retained_candidate_ids, ["poi:z", "poi:a"]);
  assert.equal(entry.id, savedEntryId({ ...base, dayEdit: entry.inputs.dayEdit }));
});

test("share links carry canonical manual edit and priority but no positions or capabilities", () => {
  const query = encodeShareParams({ place: base.place, placeRef: "r1234", preferences: selected,
    preferencePriority: priority, dayEdit: edit({ token: "secret-token", coords: { lat: 59, lng: 18 } }),
    coords: { lat: 59, lng: 18 }, placeSelection: "secret-receipt", completion: "secret-capability" });
  const params = new URLSearchParams(query);
  assert.deepEqual(JSON.parse(params.get("edit")), edit());
  assert.doesNotMatch(query, /secret|coords|receipt|capability|token/);
  const decoded = decodeShareParams(query);
  assert.deepEqual(decoded.dayEdit, edit());
  assert.equal(decoded.invalidDayEdit, false);
  assert.deepEqual(decoded.preferencePriority, priority);
  assert.equal(decoded.placeRef, "r1234");
});

test("an explicit malformed shared edit is detectable instead of becoming an unedited day", () => {
  for (const raw of ["", "null", "{", "{}", JSON.stringify(edit({ target_stop_count: 6 })), "x".repeat(40_000)]) {
    const decoded = decodeShareParams(`place=Testville&edit=${encodeURIComponent(raw)}`);
    assert.equal(decoded.dayEdit, null);
    assert.equal(decoded.invalidDayEdit, true);
  }
  assert.equal(decodeShareParams(`edit=${encodeURIComponent(JSON.stringify(edit()))}&edit=null`).invalidDayEdit, true);
  const invalid = decodeShareParams(encodeShareParams({ place: base.place, dayEdit: { action: "remove" } }));
  assert.equal(invalid.invalidDayEdit, true, "the encoder cannot silently erase an invalid explicit edit");
  assert.equal(decodeShareParams(encodeShareParams({ place: base.place, invalidDayEdit: true })).invalidDayEdit, true);
});

test("absent manual edit leaves legacy payload, saved inputs and share decoder unchanged", () => {
  assert.equal(Object.hasOwn(buildAnywherePayload({ preferences: selected }), "day_edit"), false);
  assert.equal(Object.hasOwn(saved({}).inputs, "dayEdit"), false);
  const decoded = decodeShareParams(encodeShareParams({ place: base.place, preferences: selected }));
  assert.equal(Object.hasOwn(decoded, "dayEdit"), false);
  assert.equal(Object.hasOwn(decoded, "invalidDayEdit"), false);
});

test("later Adjust preserves manual count/removals without permanently pinning old content", () => {
  const dayEdit = edit({ preserve_retained: false });
  const payload = buildAnywherePayload({ preferences: selected, dayEdit });
  assert.deepEqual(payload.day_edit, dayEdit);
  const entry = saved({ dayEdit });
  assert.deepEqual(entry.inputs.dayEdit, dayEdit);
  assert.notEqual(entry.id, saved({ dayEdit: edit() }).id);
  assert.deepEqual(decodeShareParams(encodeShareParams({ preferences: selected, dayEdit })).dayEdit, dayEdit);
  assert.equal(saved({ dayEdit: edit({ preserve_retained: true }) }).id, saved({ dayEdit: edit() }).id);
});

function committed(inputs) {
  const entry = saved(inputs);
  entry.commitments = buildCommitmentSnapshot({ anchorKey: "place:testville", dayKey: entry.id,
    entries: { cafe: { kind: "pin", label: "Cafe" } } });
  return entry;
}
const reloadContext = { navigationType: "reload", anchor: { place: base.place },
  dateIso: base.dateIso, selected, walkKey: base.walkKey };

test("a matching URL reload reuses choices bound to the full canonical priority/edit identity", () => {
  const inputs = { preferencePriority: priority, dayEdit: edit({ preserve_retained: false }) };
  const entry = committed(inputs);
  assert.deepEqual(urlEntryCommitments(entry, { ...reloadContext, ...inputs }), {
    applies: true, entries: { cafe: { kind: "pin", label: "Cafe" } },
  });
});

test("same-place reload cannot borrow neutral commitments for explicit priority or a manual edit", () => {
  const entry = committed({});
  for (const variant of [{ preferencePriority: priority }, { dayEdit: edit() }, { invalidDayEdit: true }]) {
    assert.deepEqual(urlEntryCommitments(entry, { ...reloadContext, ...variant }), { applies: false, entries: {} });
  }
});

test("a snapshot cannot cross opposite dominance or same-place manual-count variants", () => {
  const entry = committed({ preferencePriority: priority, dayEdit: edit() });
  for (const variant of [
    { preferencePriority: [...priority].reverse(), dayEdit: edit() },
    { preferencePriority: priority, dayEdit: edit({ retained_candidate_ids: ["poi:z"], target_stop_count: 1 }) },
    { preferencePriority: priority, dayEdit: edit({ preserve_retained: false }) },
  ]) {
    const other = saved(variant);
    assert.equal(readCommitmentSnapshot(entry.commitments, { anchorKey: "place:testville", dayKey: other.id }).reason, "day_changed");
    assert.deepEqual(urlEntryCommitments(entry, { ...reloadContext, ...variant }), { applies: false, entries: {} });
  }
});

test("malformed explicit edits stay fail-closed through payload, saved identity and URL reload", () => {
  const malformed = { action: "remove" };
  const payload = buildAnywherePayload({ preferences: selected, dayEdit: malformed });
  assert.equal(Object.hasOwn(payload, "day_edit"), true);
  assert.equal(payload.day_edit, null, "backend can refuse explicit invalid input rather than compose a fresh day");
  assert.equal(buildAnywherePayload({ invalidDayEdit: true }).day_edit, null);
  const entry = committed({ dayEdit: malformed });
  assert.equal(entry.inputs.dayEdit, null);
  assert.equal(entry.inputs.invalidDayEdit, true);
  assert.notEqual(entry.id, saved({}).id);
  assert.equal(entry.id, savedEntryId({ ...base, dayEdit: malformed }));
  assert.equal(entry.id, savedEntryId({ ...base, dayEdit: null, invalidDayEdit: true }));
  assert.deepEqual(urlEntryCommitments(entry, { ...reloadContext, dayEdit: malformed }), { applies: false, entries: {} });
  assert.equal(decodeShareParams(encodeShareParams(entry.inputs)).invalidDayEdit, true);
});

test("null edit without an invalid-presence flag is omitted for ordinary UI state", () => {
  assert.equal(Object.hasOwn(buildAnywherePayload({ dayEdit: null }), "day_edit"), false);
  assert.equal(saved({ dayEdit: null }).id, saved({}).id);
  assert.equal(new URLSearchParams(encodeShareParams({ dayEdit: null })).has("edit"), false);
});

test("two-interest priority is independent of URL preference order and rejects unknown or unselected ranks", () => {
  const decoded = decodeShareParams("prefs=food,views&prio=views,views,scenic,fika,food", ["food", "views"]);
  assert.deepEqual(decoded.preferences, ["food", "views"]);
  assert.deepEqual(decoded.preferencePriority, ["views", "food"]);
  const same = decodeShareParams("prefs=views,food&prio=views,food", ["food", "views"]);
  assert.equal(savedEntryId({ ...base, selected: decoded.preferences, preferencePriority: decoded.preferencePriority }),
    savedEntryId({ ...base, selected: same.preferences, preferencePriority: same.preferencePriority }));
  for (const raw of ["unknown", "fika", "", "views%0A"]) {
    const neutral = decodeShareParams(`prefs=food,views&prio=${raw}`);
    assert.equal(Object.hasOwn(neutral, "preferencePriority"), false);
  }
});

test("maximum escaped bounded edit still round-trips without changing retained route order", () => {
  const id = prefix => prefix + '"'.repeat(199);
  const dayEdit = edit({ candidate_id: id("x"), action: "remove", slot_index: 5, target_stop_count: 6,
    retained_candidate_ids: ["a", "b", "c", "d", "e", "f"].map(id),
    removed_candidate_ids: "ghijklmnopqr".split("").map(id), preserve_retained: false });
  const decoded = decodeShareParams(encodeShareParams({ preferences: selected, dayEdit }));
  assert.equal(decoded.invalidDayEdit, false);
  assert.deepEqual(decoded.dayEdit, dayEdit);
});

test("reordered edit fields and removed sets have one identity and no raw metadata", () => {
  const first = edit({ removed_candidate_ids: ["poi:old", "poi:other"] });
  const reordered = Object.fromEntries(Object.entries({ ...first, removed_candidate_ids: ["poi:other", "poi:old"] }).reverse());
  assert.equal(savedEntryId({ ...base, dayEdit: first }), savedEntryId({ ...base, dayEdit: reordered }));
  assert.equal(savedEntryId({ ...base, dayEdit: { ...first, provenance: "forged" } }), savedEntryId({ ...base, dayEdit: first }));
});

test("saving detaches the correlated selected set so later chip edits cannot drift its identity", () => {
  const liveSelected = [...selected];
  const entry = saved({ selected: liveSelected, preferencePriority: priority, dayEdit: edit() });
  const originalId = entry.id;
  liveSelected.push("fika");
  assert.deepEqual(entry.inputs.selected, selected);
  assert.equal(savedEntryId({ ...base, ...entry.inputs }), originalId);
});

test("malformed edit presence does not erase invalid-place-reference or GPS privacy handling", () => {
  const decoded = decodeShareParams("place_ref=R1234&edit=null&lat=59&lng=18&place_selection=secret");
  assert.equal(decoded.invalidPlaceRef, true);
  assert.equal(decoded.invalidDayEdit, true);
  assert.equal(decoded.dayEdit, null);
  for (const key of ["lat", "lng", "coords", "placeSelection"]) assert.equal(Object.hasOwn(decoded, key), false);
});
