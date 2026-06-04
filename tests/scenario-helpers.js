/**
 * Deterministic scenario-evaluation helpers (#240). No live network: external
 * records are supplied through injected loaders / the trusted external_provider
 * channel exactly as production does after a real fetch.
 */

const http = require("node:http");
const { buildApp } = require("../server/app");

const DATE = "2026-06-03";

// An open-data record as the loader/provider expects it. Adds OSM (map) and,
// when a wikidata id is given, a second open_knowledge source so the record is
// corroborated (diversity 2 → eligible). Omit wikidata to get a single-family
// record (should be gated out).
function osmRecord(id, name, type, lat, lng, { tags = [], wikidata = "Q-auto", popularity = null } = {}) {
  const sources = [
    { provider: "osm", family: "map", tier: "inferred", url: `https://www.openstreetmap.org/node/${id}` },
  ];
  if (wikidata) {
    const q = wikidata === "Q-auto" ? `Q${Math.abs(hashId(id))}` : wikidata;
    sources.push({ provider: "wikidata", family: "open_knowledge", tier: "inferred", url: `https://www.wikidata.org/wiki/${q}` });
  }
  const record = { id, name, type, lat, lng, tags, sources };
  if (popularity) record.popularity = popularity;
  return record;
}

function hashId(value) {
  let h = 0;
  const s = String(value);
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h || 1;
}

// A deterministic loader: returns the same records regardless of coordinates.
function makeLoader(records) {
  return async () => records.map((r) => ({ ...r }));
}

async function postBlitz(server, query, body) {
  const { port } = server.address();
  const path = `/api/blitz${query ? `?${query}` : ""}`;
  const payload = JSON.stringify(body || {});
  return new Promise((resolve, reject) => {
    const req = http.request(
      { hostname: "127.0.0.1", port, path, method: "POST", headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) } },
      (response) => {
        let data = "";
        response.on("data", (c) => (data += c));
        response.on("end", () => resolve({ status: response.statusCode, body: data ? JSON.parse(data) : null }));
      },
    );
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

async function withScenarioServer(records, run) {
  const loader = records ? makeLoader(records) : null;
  const server = buildApp({ openDataLoader: loader }).listen(0);
  try {
    return await run(server);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

module.exports = { DATE, osmRecord, makeLoader, postBlitz, withScenarioServer };
