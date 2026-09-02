/**
 * Candidate pack parser + validator.
 *
 * Parses the markdown format defined in
 * docs/candidate-packs/CANDIDATE_PACK_FORMAT.md and runs the validation
 * rules listed there + in the brief for feat/candidate-pack-validator.
 *
 * This is an intake-layer safety gate. It does NOT promote candidates
 * into the runtime catalog — that remains a separate explicit step.
 *
 * Public API:
 *   parseCandidatePack(markdown)
 *     → { metadata, candidates, blockIndex }
 *
 *   validateCandidatePack(markdown, { sourcePath } = {})
 *     → { pack, candidates, errors, warnings, distributions, status }
 *
 *   status ∈ { "intake_only", "promotion_safe", "blocked" }
 *
 * The parser is deliberately small: it scans for fenced text blocks
 * (``` … ```), extracts key-value pairs with continuation support, and
 * classifies each block as metadata (contains pack_name) or candidate
 * (contains proposed_id). Other blocks are ignored.
 */

const { VALID_CANDIDATE_KINDS } = require("../place-candidates/contract");

// Canonical vocabularies for fields the PlaceCandidate contract does
// not own. These live in CANDIDATE_PACK_FORMAT.md §3 (Field rules) and
// §"Intake-only vocabulary"; mirrored here so drift is a single edit.
const VALID_SOURCE_KINDS = new Set([
  "city_catalog",
  "live_event_feed",
  "map_search",
  "open_data",
  "open_geo_source",
  "generated",
  "routing_config",
]);

const VALID_VIBES = new Set(["slow", "buzzy", "romantic", "curious"]);

const VALID_CONFIDENCE = new Set(["high", "medium", "needs_review"]);

const VALID_VERIFICATION_PRIORITY = new Set(["high", "medium", "low"]);

const VALID_PROMOTION_RECOMMENDATION = new Set([
  "promote_first",
  "keep_as_optional",
  "needs_research",
  "reject_for_now",
]);

const VALID_ROUTE_ROLES = new Set([
  "main_stop",
  "optional_detour",
  "neighborhood_anchor",
  "rainy_day",
  "shopping_cluster",
  "evening_anchor",
  "food_nearby",
]);

const REQUIRED_PACK_METADATA = [
  "pack_name",
  "city",
  "theme",
  "intended_use",
  "quality_bar",
  "promotion_criteria",
  "pack_version",
  "last_updated",
  "author",
];

const REQUIRED_CANDIDATE_FIELDS = [
  "proposed_id",
  "name",
  "city",
  "neighborhood",
  "category",
  "candidate_kind",
  "source_kind",
  "route_role",
  "vibes",
  "tags",
  "why_it_fits_parranda",
  "confidence",
  "source_notes",
  "verification_priority",
  "promotion_recommendation",
];

/* ============================================================ */
/* Parser                                                       */
/* ============================================================ */

function parseCandidatePack(markdown) {
  if (typeof markdown !== "string") {
    throw new TypeError("parseCandidatePack: markdown must be a string");
  }

  const blocks = extractFencedTextBlocks(markdown);
  let metadata = null;
  const candidates = [];
  const blockIndex = [];

  for (const block of blocks) {
    const fields = parseKeyValueBlock(block.body);
    if (!Object.keys(fields).length) continue;

    if (fields.pack_name && !metadata) {
      metadata = fields;
      blockIndex.push({ kind: "metadata", lineStart: block.lineStart });
    } else if (fields.proposed_id) {
      candidates.push({ ...fields, _lineStart: block.lineStart });
      blockIndex.push({ kind: "candidate", lineStart: block.lineStart, proposed_id: fields.proposed_id });
    } else {
      blockIndex.push({ kind: "unknown", lineStart: block.lineStart });
    }
  }

  return { metadata, candidates, blockIndex };
}

// Extract every fenced code block whose opening fence is either ``` or
// ```text. Returns an array of { body, lineStart } objects so error
// messages can cite line numbers.
function extractFencedTextBlocks(markdown) {
  const lines = markdown.split(/\r?\n/);
  const blocks = [];
  let inBlock = false;
  let bodyLines = [];
  let blockStart = 0;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!inBlock && /^```(text)?\s*$/i.test(line)) {
      inBlock = true;
      bodyLines = [];
      blockStart = i + 2; // 1-indexed, first body line
      continue;
    }
    if (inBlock && /^```\s*$/.test(line)) {
      inBlock = false;
      blocks.push({ body: bodyLines.join("\n"), lineStart: blockStart });
      continue;
    }
    if (inBlock) bodyLines.push(line);
  }

  return blocks;
}

// Parse a candidate-pack key/value block. Keys are lower_snake_case
// followed by a colon. Values continue across indented lines.
function parseKeyValueBlock(body) {
  const lines = body.split(/\r?\n/);
  const fields = {};
  let currentKey = null;

  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+$/, ""); // trim trailing whitespace
    if (!line.trim()) {
      // Blank line ends the current value.
      currentKey = null;
      continue;
    }

    const keyMatch = line.match(/^([a-z][a-z0-9_]*):\s*(.*)$/);
    if (keyMatch) {
      currentKey = keyMatch[1];
      const initialValue = keyMatch[2].trim();
      fields[currentKey] = initialValue;
      continue;
    }

    if (currentKey !== null) {
      // Continuation line — append with a single space.
      const continuation = line.trim();
      if (continuation) {
        fields[currentKey] = fields[currentKey]
          ? `${fields[currentKey]} ${continuation}`
          : continuation;
      }
    }
  }

  return fields;
}

// Parse a comma-separated list value like "[a, b, c]" → ["a", "b", "c"].
// Returns null if the value does not look like a list. An empty list
// "[]" returns [].
function parseListValue(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) return null;
  const inner = trimmed.slice(1, -1).trim();
  if (!inner) return [];
  return inner
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

/* ============================================================ */
/* Validator                                                    */
/* ============================================================ */

function validateCandidatePack(markdown, { sourcePath } = {}) {
  const { metadata, candidates } = parseCandidatePack(markdown);
  const errors = [];
  const warnings = [];

  // --- pack metadata ---
  if (!metadata) {
    errors.push({
      code: "missing_pack_metadata",
      message: "No pack metadata block found (expected a fenced ```text block containing pack_name + city + theme + …).",
    });
  } else {
    for (const key of REQUIRED_PACK_METADATA) {
      if (!metadata[key] || !String(metadata[key]).trim()) {
        errors.push({
          code: "missing_metadata_field",
          field: key,
          message: `Pack metadata is missing required field "${key}".`,
        });
      }
    }
  }

  // --- candidates ---
  if (!candidates.length) {
    errors.push({
      code: "no_candidates",
      message: "Pack contains no candidates (expected one or more fenced blocks with proposed_id:).",
    });
  }

  const distributions = {
    candidate_kind: {},
    source_kind: {},
    confidence: {},
    verification_priority: {},
    promotion_recommendation: {},
  };

  for (const candidate of candidates) {
    const id = candidate.proposed_id;

    // Required fields presence.
    for (const field of REQUIRED_CANDIDATE_FIELDS) {
      if (candidate[field] === undefined) {
        errors.push({
          code: "missing_candidate_field",
          candidate: id,
          field,
          message: `Candidate "${id}" is missing required field "${field}".`,
        });
      }
    }

    // Vocabulary checks.
    if (candidate.candidate_kind) {
      bump(distributions.candidate_kind, candidate.candidate_kind);
      if (!VALID_CANDIDATE_KINDS.has(candidate.candidate_kind)) {
        errors.push({
          code: "invalid_candidate_kind",
          candidate: id,
          value: candidate.candidate_kind,
          message: `Candidate "${id}" has invalid candidate_kind "${candidate.candidate_kind}". Expected one of: ${[...VALID_CANDIDATE_KINDS].join(", ")}.`,
        });
      }
    }

    if (candidate.source_kind) {
      bump(distributions.source_kind, candidate.source_kind);
      if (!VALID_SOURCE_KINDS.has(candidate.source_kind)) {
        errors.push({
          code: "invalid_source_kind",
          candidate: id,
          value: candidate.source_kind,
          message: `Candidate "${id}" has invalid source_kind "${candidate.source_kind}". Expected one of: ${[...VALID_SOURCE_KINDS].join(", ")}.`,
        });
      }
    }

    if (candidate.confidence) {
      bump(distributions.confidence, candidate.confidence);
      if (!VALID_CONFIDENCE.has(candidate.confidence)) {
        errors.push({
          code: "invalid_confidence",
          candidate: id,
          value: candidate.confidence,
          message: `Candidate "${id}" has invalid confidence "${candidate.confidence}". Expected one of: ${[...VALID_CONFIDENCE].join(", ")}.`,
        });
      }
    }

    if (candidate.verification_priority) {
      bump(distributions.verification_priority, candidate.verification_priority);
      if (!VALID_VERIFICATION_PRIORITY.has(candidate.verification_priority)) {
        errors.push({
          code: "invalid_verification_priority",
          candidate: id,
          value: candidate.verification_priority,
          message: `Candidate "${id}" has invalid verification_priority "${candidate.verification_priority}". Expected one of: ${[...VALID_VERIFICATION_PRIORITY].join(", ")}.`,
        });
      }
    }

    if (candidate.promotion_recommendation) {
      bump(distributions.promotion_recommendation, candidate.promotion_recommendation);
      if (!VALID_PROMOTION_RECOMMENDATION.has(candidate.promotion_recommendation)) {
        errors.push({
          code: "invalid_promotion_recommendation",
          candidate: id,
          value: candidate.promotion_recommendation,
          message: `Candidate "${id}" has invalid promotion_recommendation "${candidate.promotion_recommendation}". Expected one of: ${[...VALID_PROMOTION_RECOMMENDATION].join(", ")}.`,
        });
      }
    }

    if (candidate.vibes) {
      const vibes = parseListValue(candidate.vibes);
      if (vibes === null) {
        errors.push({
          code: "invalid_vibes_format",
          candidate: id,
          value: candidate.vibes,
          message: `Candidate "${id}" vibes must be a bracketed list like "[curious, slow]".`,
        });
      } else {
        for (const vibe of vibes) {
          if (!VALID_VIBES.has(vibe)) {
            errors.push({
              code: "invalid_vibe",
              candidate: id,
              value: vibe,
              message: `Candidate "${id}" has invalid vibe "${vibe}". Expected one of: ${[...VALID_VIBES].join(", ")}.`,
            });
          }
        }
      }
    }

    if (candidate.route_role) {
      const roles = parseListValue(candidate.route_role);
      if (roles === null) {
        errors.push({
          code: "invalid_route_role_format",
          candidate: id,
          value: candidate.route_role,
          message: `Candidate "${id}" route_role must be a bracketed list like "[main_stop, shopping_cluster]".`,
        });
      } else {
        for (const role of roles) {
          if (!VALID_ROUTE_ROLES.has(role)) {
            warnings.push({
              code: "non_canonical_route_role",
              candidate: id,
              value: role,
              message: `Candidate "${id}" uses route_role "${role}", which is not in the documented intake-only vocabulary. Allowed values: ${[...VALID_ROUTE_ROLES].join(", ")}.`,
            });
          }
        }
      }
    }

    // --- cross-field rules ---

    // Hard error: needs_review + promote_first must never coexist.
    if (
      candidate.confidence === "needs_review" &&
      candidate.promotion_recommendation === "promote_first"
    ) {
      errors.push({
        code: "needs_review_with_promote_first",
        candidate: id,
        message: `Candidate "${id}" combines confidence: needs_review with promotion_recommendation: promote_first. This pairing would tell a promotion PR that an unverified candidate is shippable. Use verification_priority: high + promotion_recommendation: needs_research instead.`,
      });
    }

    // Hard error: generated_place must never carry promote_first — a
    // generated cluster is intake-only and cannot become a runtime venue
    // without first being decomposed into real_place candidates.
    if (
      candidate.candidate_kind === "generated_place" &&
      candidate.promotion_recommendation === "promote_first"
    ) {
      errors.push({
        code: "generated_place_marked_promote_first",
        candidate: id,
        message: `Candidate "${id}" is a generated_place but is marked promotion_recommendation: promote_first. Generated route-themed clusters cannot be promoted as runtime venues; they must be decomposed into real_place candidates first.`,
      });
    }

    // Hard error: area_preset marked promote_first — an area cluster is
    // a structural anchor, not a venue. Promotion must decompose it
    // into named real_place candidates first.
    if (
      candidate.candidate_kind === "area_preset" &&
      candidate.promotion_recommendation === "promote_first"
    ) {
      errors.push({
        code: "area_preset_marked_promote_first",
        candidate: id,
        message: `Candidate "${id}" is an area_preset but is marked promotion_recommendation: promote_first. Area clusters cannot be promoted as fake shops; verification must identify named real_place candidates within the area before promotion.`,
      });
    }
  }

  // --- final status ---
  let status;
  if (errors.length > 0) {
    status = "blocked";
  } else {
    const hasVerifiedPromote =
      candidates.some(
        (candidate) =>
          candidate.promotion_recommendation === "promote_first" &&
          candidate.confidence === "high",
      );
    status = hasVerifiedPromote ? "promotion_safe" : "intake_only";
  }

  return {
    pack: metadata,
    candidates,
    errors,
    warnings,
    distributions,
    status,
    sourcePath: sourcePath || null,
  };
}

function bump(distribution, key) {
  distribution[key] = (distribution[key] || 0) + 1;
}

module.exports = {
  parseCandidatePack,
  validateCandidatePack,
  parseListValue,
  VALID_CANDIDATE_KINDS,
  VALID_SOURCE_KINDS,
  VALID_VIBES,
  VALID_CONFIDENCE,
  VALID_VERIFICATION_PRIORITY,
  VALID_PROMOTION_RECOMMENDATION,
  VALID_ROUTE_ROLES,
  REQUIRED_PACK_METADATA,
  REQUIRED_CANDIDATE_FIELDS,
};
