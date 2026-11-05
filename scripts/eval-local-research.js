"use strict";

// Offline only. No provider client, API key, production env or network fallback.
const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { documentText, verifyQuotedEvent } = require("../server/pulse-sources/quoted-event-reader");
const { scoutLocalEventSources } = require("../server/pulse-sources/local-event-source-scout");
const { feedsFromScout } = require("../server/pulse-sources/request-time-event-discovery");
const { createLocalEventProvider } = require("../server/place-candidates/agnostic-event-supply");
const hash = value => createHash("sha256").update(value).digest("hex");
const fold = value => String(value || "").normalize("NFC").replace(/\s+/g, " ").trim();
// Match the current quoted-event-reader response envelope, not just its atoms.
const CURRENT_READER_MAX_EVENTS = 24;

function loadCorpus(filename) {
  const corpus = JSON.parse(fs.readFileSync(filename, "utf8"));
  const ids = new Set();
  for (const doc of corpus.cases) {
    if (!doc.id || ids.has(doc.id)) throw Error("duplicate or missing corpus case ID");
    ids.add(doc.id);
    doc.body = doc.body_file ? fs.readFileSync(path.resolve(path.dirname(filename), doc.body_file), "utf8") : doc.body;
    if (typeof doc.body !== "string") throw Error(`missing document: ${doc.id}`);
    doc.text = documentText(doc.body, doc.content_type || "text/html");
  }
  return corpus;
}

function documentIdentity(doc) {
  return { document_sha256: hash(doc.body), reader_document_sha256: hash(doc.text) };
}

async function baselineRead(doc) {
  const calls = [];
  const fetcher = async input => {
    const url = String(input); calls.push(url);
    const robots = new URL(url).pathname === "/robots.txt";
    const body = robots ? "User-agent: *\nAllow: /" : url === doc.source_url ? doc.body : null;
    if (body == null) throw Error(`unrecorded offline URL: ${url}`);
    return { ok: true, status: 200, url, text: async () => body,
      headers: { get: name => name.toLowerCase() === "content-type" ? robots ? "text/plain" : doc.content_type || "text/html" : null } };
  };
  const scouted = await scoutLocalEventSources({ seeds: [{ url: doc.source_url,
    source_language: doc.language, timezone: doc.timezone }], anchor: { lat: 55.46, lng: 14.18 },
    fetcher, eventReader: null, maxLinkedPages: 0 });
  const feeds = feedsFromScout(scouted, { timezone: doc.timezone });
  const events = [], outcomes = [];
  for (const feed of feeds) {
    const provider = createLocalEventProvider(feed, { fetcher, eventReader: null });
    if (!provider) continue;
    const collected = await provider.create({ key: "offline" }).collect({ date: doc.as_of, now: `${doc.as_of}T10:00:00Z` });
    events.push(...(collected.time_sensitive_events || []));
    outcomes.push({ adapter: feed.adapter, ...collected.collection_status });
  }
  return { events: events.map(row => eventAtom(row, doc.timezone)), outcomes, fixture_fetch_count: calls.length };
}

function eventAtom(row, timezone) {
  let date = row.starts_on, time = row.local_start?.slice(11, 16) || row.time_window?.local_start || "";
  if (row.starts_at) {
    const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: timezone,
      year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(new Date(row.starts_at)).map(part => [part.type, part.value]));
    date = `${parts.year}-${parts.month}-${parts.day}`; time = `${parts.hour}:${parts.minute}`;
  }
  return { title: fold(row.title || row.name), date, time, place: fold(row.place_context),
    ...(row.programme ? { programme: row.programme.title } : {}) };
}

function factKey(row) { return JSON.stringify([row.title, row.date, row.time || "", row.place].map(fold)); }

function scoreEvents(events, expected) {
  const gold = new Map(expected.map(row => [factKey(row), row]));
  const found = new Map(events.map(row => [factKey(row), row]));
  let tp = 0, useful = 0;
  for (const key of found.keys()) if (gold.has(key)) { tp++; if (gold.get(key).useful) useful++; }
  return { true_positive: tp, false_positive: found.size - tp, false_negative: gold.size - tp,
    useful_events: useful, duplicate_rows: events.length - found.size };
}

function aggregate(rows) {
  const result = { true_positive: 0, false_positive: 0, false_negative: 0, useful_events: 0, duplicate_rows: 0 };
  for (const row of rows) for (const key of Object.keys(result)) result[key] += row[key];
  result.precision = divide(result.true_positive, result.true_positive + result.false_positive);
  result.recall = divide(result.true_positive, result.true_positive + result.false_negative);
  result.correct_source_count = rows.filter(row => row.true_positive > 0).length;
  return result;
}

function divide(a, b) { return b ? a / b : null; }
function round(value) { return Math.round(value * 1e10) / 1e10; }
function recordedCost(run) {
  if (Number.isFinite(run.billed_usd) && run.billed_usd >= 0) return run.billed_usd;
  const usage = run.usage, rates = run.rates_usd_per_million;
  if (!usage || !rates || ![usage.input_tokens, usage.output_tokens, rates.input, rates.output]
    .every(value => Number.isFinite(value) && value >= 0)) return null;
  // Use explicit billed_usd for caching, tools, OCR or nonstandard tiers.
  return (usage.input_tokens * rates.input + usage.output_tokens * rates.output) / 1e6;
}

async function evaluate(corpus, responses = null) {
  if (responses && !["recorded_provider_response", "handwritten_contract_example"].includes(responses.kind)) {
    throw Error("response evidence kind must distinguish provider recordings from handwritten examples");
  }
  const cases = [], baselineScores = [], candidateScores = [], paired = [], costs = [];
  const runs = responses?.runs || [];
  for (const run of runs) {
    const doc = corpus.cases.find(doc => doc.id === run.case_id);
    if (!doc) throw Error(`unknown response case: ${run.case_id}`);
    const identity = documentIdentity(doc);
    if (run.document_sha256 !== identity.document_sha256 || run.reader_document_sha256 !== identity.reader_document_sha256) {
      throw Error(`document hash mismatch: ${doc.id}`);
    }
    if (!run.model || !run.prompt_version) throw Error(`missing model/prompt identity: ${doc.id}`);
    costs.push(recordedCost(run));
  }
  let rejected = 0, invalidResponses = 0;
  for (const doc of corpus.cases) {
    const baseline = await baselineRead(doc);
    const score = scoreEvents(baseline.events, doc.expected);
    baselineScores.push(score);
    const result = { id: doc.id, origin: doc.origin, ...documentIdentity(doc), baseline: { ...baseline, ...score } };
    const attempt = runs.filter(run => run.case_id === doc.id).at(-1);
    if (attempt) {
      const validEnvelope = Array.isArray(attempt.events) && attempt.events.length <= CURRENT_READER_MAX_EVENTS;
      if (attempt.status === "ok" && !validEnvelope) invalidResponses++;
      const proposed = attempt.status === "ok" && validEnvelope ? attempt.events : [];
      const verified = proposed.map(row => verifyQuotedEvent(row, { document: doc.text,
        sourceUrl: doc.source_url, language: doc.language, model: attempt.model })).filter(Boolean);
      const events = verified.map(row => eventAtom(row, doc.timezone));
      rejected += proposed.length - verified.length;
      const candidate = scoreEvents(events, doc.expected);
      candidateScores.push(candidate); paired.push(score);
      result.candidate = { status: attempt.status === "ok" && !validEnvelope ? "failed_invalid_envelope" : attempt.status, events, ...candidate,
        rejected_quote_rows: proposed.length - verified.length,
        reading_key: hash(JSON.stringify([doc.source_url, documentIdentity(doc).reader_document_sha256,
          doc.language, attempt.model, attempt.prompt_version])) };
    }
    cases.push(result);
  }
  const knownCost = costs.every(value => value != null);
  const totalCost = knownCost ? round(costs.reduce((sum, value) => sum + value, 0)) : null;
  const candidate = responses ? { evidence_kind: responses.kind, ...aggregate(candidateScores),
    paired_baseline: aggregate(paired), evaluated_case_count: candidateScores.length,
    recorded_attempt_count: runs.length, rejected_quote_rows: rejected,
    invalid_response_case_count: invalidResponses,
    recorded_cost_usd: totalCost,
    cost_per_verified_source_usd: totalCost == null ? null : divide(totalCost, candidateScores.filter(row => row.true_positive > 0).length),
    cost_per_useful_event_usd: totalCost == null ? null : divide(totalCost, candidateScores.reduce((sum, row) => sum + row.useful_events, 0)),
  } : null;
  return { schema_version: 1, evaluation_scope: "offline_source_reading_only", new_api_calls: 0,
    new_api_cost_usd: 0, corpus_case_count: cases.length, baseline: aggregate(baselineScores), candidate, cases };
}

if (require.main === module) {
  const [corpusFile = path.join(__dirname, "../tests/fixtures/local-research-pilot.json"), responseFile] = process.argv.slice(2);
  evaluate(loadCorpus(corpusFile), responseFile ? JSON.parse(fs.readFileSync(responseFile, "utf8")) : null)
    .then(result => process.stdout.write(`${JSON.stringify(result, null, 2)}\n`))
    .catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
module.exports = { loadCorpus, documentIdentity, evaluate, scoreEvents };
