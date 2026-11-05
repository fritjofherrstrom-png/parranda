"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { loadCorpus, evaluate, documentIdentity, scoreEvents } = require("../scripts/eval-local-research");
const CORPUS = path.join(__dirname, "fixtures/local-research-pilot.json");

test("offline pilot runs the current scout and providers without paid readers or live transport", async () => {
  const corpus = loadCorpus(CORPUS);
  const result = await evaluate(corpus);
  assert.equal(result.baseline.true_positive, 5);
  assert.equal(result.baseline.false_positive, 0);
  assert.equal(result.baseline.false_negative, 3);
  assert.equal(result.baseline.useful_events, 3);
  assert.equal(result.candidate, null, "no model result is fabricated when none was recorded");
  assert.equal(result.new_api_calls, 0);
  assert.equal(result.cases[0].baseline.events.length, 4, "the real reduced festival fixture is replayed");
});

test("stored responses are quote-verified, scored on the paired subset and costed including rejected attempts", async () => {
  const corpus = loadCorpus(CORPUS);
  const doc = corpus.cases.find(row => row.id === "sv-notice");
  const event = { title: { value: "Lokal konsert", quote: "Lokal konsert" },
    date: { value: "2026-10-30", quote: "30 oktober 2026" },
    time: { value: "19:30", quote: "19.30" },
    place: { value: "Föreningshuset", quote: "Föreningshuset" }, excerpt: doc.text };
  const base = { case_id: doc.id, ...documentIdentity(doc), provider: "handwritten-control", model: "contract-example",
    prompt_version: "quoted-reader-v1", usage: { input_tokens: 1000, output_tokens: 100 },
    rates_usd_per_million: { input: 0.1, output: 0.5 } };
  const record = { kind: "handwritten_contract_example", runs: [
    { ...base, status: "failed", events: [] },
    { ...base, status: "ok", events: [event, { ...event, title: { value: "Invented", quote: "Invented" } }] },
  ] };
  const result = await evaluate(corpus, record);
  assert.equal(result.candidate.evidence_kind, "handwritten_contract_example");
  assert.equal(result.candidate.evaluated_case_count, 1);
  assert.equal(result.candidate.paired_baseline.true_positive, 0);
  assert.equal(result.candidate.true_positive, 1);
  assert.equal(result.candidate.rejected_quote_rows, 1);
  assert.equal(result.candidate.useful_events, 1);
  assert.equal(result.candidate.recorded_cost_usd, 0.0003);
  assert.equal(result.candidate.cost_per_verified_source_usd, 0.0003);
  assert.equal(result.candidate.cost_per_useful_event_usd, 0.0003);
  assert.equal(result.new_api_calls, 0);
});

test("a changed document cannot reuse a stored reading and zero yield cannot hide behind zero cost", async () => {
  const corpus = loadCorpus(CORPUS), doc = corpus.cases[1];
  await assert.rejects(evaluate(corpus, { kind: "recorded_provider_response", runs: [{ case_id: doc.id,
    document_sha256: "stale", status: "ok", events: [] }] }), /document hash/);
  const result = await evaluate(corpus, { kind: "recorded_provider_response", runs: [{ case_id: doc.id,
    ...documentIdentity(doc), status: "failed", model: "fixture", prompt_version: "v1", billed_usd: 0.01, events: [] }] });
  assert.equal(result.candidate.recorded_cost_usd, 0.01);
  assert.equal(result.candidate.cost_per_verified_source_usd, null);
  assert.equal(result.candidate.cost_per_useful_event_usd, null);
});

test("duplicate facts never inflate yield, and wrong date/time/place count as false findings", () => {
  const atom = { title: "Concert", date: "2026-10-30", time: "19:00", place: "Hall", useful: true };
  const score = scoreEvents([atom, atom, { ...atom, date: "2026-10-31" }], [atom]);
  assert.equal(score.true_positive, 1);
  assert.equal(score.false_positive, 1);
  assert.equal(score.duplicate_rows, 1);
  assert.equal(score.useful_events, 1);
});

test("a stored response exceeding the current reader's 24-event envelope is rejected as a whole", async () => {
  const corpus = loadCorpus(CORPUS), doc = corpus.cases.find(row => row.id === "sv-notice");
  const row = { title: { value: "Lokal konsert", quote: "Lokal konsert" },
    date: { value: "2026-10-30", quote: "30 oktober 2026" }, time: { value: "19:30", quote: "19.30" },
    place: { value: "Föreningshuset", quote: "Föreningshuset" }, excerpt: doc.text };
  const result = await evaluate(corpus, { kind: "handwritten_contract_example", runs: [{ case_id: doc.id,
    ...documentIdentity(doc), model: "contract", prompt_version: "v1", status: "ok", billed_usd: 0.01,
    events: Array.from({ length: 25 }, () => row) }] });
  assert.equal(result.candidate.true_positive, 0);
  assert.equal(result.candidate.invalid_response_case_count, 1);
  assert.equal(result.candidate.recorded_cost_usd, 0.01);
});
