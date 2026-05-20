const { CuratedCatalogProvider } = require("./curated-catalog-provider");
const { validatePlaceCandidate } = require("./contract");

const DEFAULT_PROVIDER_SPECS = [
  {
    id: "curated-catalog",
    create(cityConfig) {
      return new CuratedCatalogProvider(cityConfig);
    },
  },
];

function createDefaultCandidateProviderRegistry(providerSpecs = DEFAULT_PROVIDER_SPECS) {
  return new CandidateProviderRegistry(providerSpecs);
}

class CandidateProviderRegistry {
  constructor(providerSpecs = []) {
    this.providerSpecs = providerSpecs.map((spec) => validateProviderSpec(spec));
  }

  listProviderIds() {
    return this.providerSpecs.map((spec) => spec.id);
  }

  collectCandidates(cityConfig, options = {}) {
    return collectPlaceCandidatesForCity(cityConfig, {
      ...options,
      providerSpecs: this.providerSpecs,
    });
  }
}

function collectPlaceCandidatesForCity(cityConfig, options = {}) {
  if (!cityConfig || typeof cityConfig !== "object") {
    throw new Error("collectPlaceCandidatesForCity requires a city config");
  }

  const providerSpecs = (options.providerSpecs || DEFAULT_PROVIDER_SPECS).map((spec) =>
    validateProviderSpec(spec),
  );
  const enabledProviderIds =
    Array.isArray(options.enabledProviderIds) && options.enabledProviderIds.length
      ? new Set(options.enabledProviderIds)
      : null;

  const providerReports = [];
  const candidates = [];

  for (const spec of providerSpecs) {
    if (enabledProviderIds && !enabledProviderIds.has(spec.id)) {
      continue;
    }

    const provider = spec.create(cityConfig);
    if (!provider || typeof provider.listCandidates !== "function") {
      throw new Error(`Candidate provider ${spec.id} must expose listCandidates()`);
    }

    const providerCandidates = provider
      .listCandidates(options)
      .map((candidate, index) =>
        validatePlaceCandidate(candidate, `${spec.id}.candidates[${index}]`),
      );

    candidates.push(...providerCandidates);
    providerReports.push({
      id: spec.id,
      count: providerCandidates.length,
      summary: summarizeCandidates(providerCandidates),
    });
  }

  return {
    city: cityConfig.key,
    candidates,
    summary: summarizeCandidateCollection(candidates, providerReports),
  };
}

function summarizeCandidateCollection(candidates = [], providerReports = []) {
  const summary = summarizeCandidates(candidates);
  return {
    total: candidates.length,
    real_place_count: candidates.filter((candidate) => !candidate.is_structural).length,
    structural_count: candidates.filter((candidate) => candidate.is_structural).length,
    by_candidate_kind: summary.by_candidate_kind,
    by_trust_tier: summary.by_trust_tier,
    by_provider: providerReports.reduce((accumulator, report) => {
      accumulator[report.id] = {
        count: report.count,
        by_candidate_kind: report.summary.by_candidate_kind,
        by_trust_tier: report.summary.by_trust_tier,
      };
      return accumulator;
    }, {}),
  };
}

function summarizeCandidates(candidates = []) {
  return candidates.reduce(
    (summary, candidate) => {
      increment(summary.by_candidate_kind, candidate.candidate_kind);
      increment(summary.by_trust_tier, candidate.trust?.source_tier);
      return summary;
    },
    {
      by_candidate_kind: {},
      by_trust_tier: {},
    },
  );
}

function increment(counts, key) {
  const normalized = key || "unknown";
  counts[normalized] = (counts[normalized] || 0) + 1;
}

function validateProviderSpec(spec) {
  if (!spec || typeof spec !== "object" || Array.isArray(spec)) {
    throw new Error("Candidate provider spec must be an object");
  }
  if (typeof spec.id !== "string" || !spec.id.trim()) {
    throw new Error("Candidate provider spec id must be a non-empty string");
  }
  if (typeof spec.create !== "function") {
    throw new Error(`Candidate provider ${spec.id} must expose create()`);
  }
  return {
    id: spec.id.trim(),
    create: spec.create,
  };
}

module.exports = {
  DEFAULT_PROVIDER_SPECS,
  CandidateProviderRegistry,
  createDefaultCandidateProviderRegistry,
  collectPlaceCandidatesForCity,
  summarizeCandidateCollection,
};
