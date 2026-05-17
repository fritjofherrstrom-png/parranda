const VALID_SOURCE_STATUSES = new Set(["candidate", "active", "disabled", "review-needed"]);
const VALID_SOURCE_USES = new Set(["live", "pulse", "both"]);
const VALID_PARSING_RISKS = new Set(["low", "medium", "high", "review-needed"]);

function assertNonEmptyString(value, label) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} must be a non-empty string`);
  }
}

function assertStringArray(value, label, { allowEmpty = false } = {}) {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array`);
  }

  if (!allowEmpty && value.length === 0) {
    throw new Error(`${label} must include at least one value`);
  }

  value.forEach((entry, index) => {
    assertNonEmptyString(entry, `${label}[${index}]`);
  });
}

function assertHttpUrl(value, label) {
  assertNonEmptyString(value, label);

  let parsed;
  try {
    parsed = new URL(value);
  } catch (_error) {
    throw new Error(`${label} must be a valid URL`);
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error(`${label} must use http or https`);
  }
}

function assertValidChoice(value, label, choices) {
  if (!choices.has(value)) {
    throw new Error(`${label} has unsupported value ${value}`);
  }
}

function validateSourceDescriptor(source, label = "source") {
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    throw new Error(`${label} must be an object`);
  }

  assertNonEmptyString(source.id, `${label}.id`);
  assertNonEmptyString(source.sourceType, `${label}.sourceType`);
  assertHttpUrl(source.sourceUrl, `${label}.sourceUrl`);
  assertValidChoice(source.status, `${label}.status`, VALID_SOURCE_STATUSES);
  assertStringArray(source.supportedLanguages, `${label}.supportedLanguages`);
  assertNonEmptyString(source.updateCadence, `${label}.updateCadence`);
  assertStringArray(source.sourceOwnedFields, `${label}.sourceOwnedFields`);
  assertStringArray(source.parrandaOwnedFields, `${label}.parrandaOwnedFields`, {
    allowEmpty: true,
  });
  assertStringArray(source.qualityFlags, `${label}.qualityFlags`, { allowEmpty: true });
  assertValidChoice(source.parsingRisk, `${label}.parsingRisk`, VALID_PARSING_RISKS);
  assertValidChoice(source.intendedUse, `${label}.intendedUse`, VALID_SOURCE_USES);

  return source;
}

function validateCitySourceConfig(sources, label = "sources") {
  if (!sources || typeof sources !== "object" || Array.isArray(sources)) {
    throw new Error(`${label} must be an object`);
  }

  const liveSources = sources.liveSources || [];
  const pulseSources = sources.pulseSources || [];

  if (!Array.isArray(liveSources)) {
    throw new Error(`${label}.liveSources must be an array`);
  }

  if (!Array.isArray(pulseSources)) {
    throw new Error(`${label}.pulseSources must be an array`);
  }

  const seenIds = new Set();

  [...liveSources, ...pulseSources].forEach((source, index) => {
    validateSourceDescriptor(source, `${label}[${index}]`);

    if (seenIds.has(source.id)) {
      throw new Error(`${label} contains duplicate source id ${source.id}`);
    }
    seenIds.add(source.id);
  });

  return sources;
}

module.exports = {
  validateCitySourceConfig,
  validateSourceDescriptor,
};
