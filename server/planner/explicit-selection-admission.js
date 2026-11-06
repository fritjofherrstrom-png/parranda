'use strict';

const { plannerUsableOptionsForRole } = require('./candidate-combination');

// Automatic choice compares peers. An explicit choice asks whether this one
// already-assessed candidate is admitted, preserving unknown availability.
function isIndividuallyAdmitted(candidate) {
  return Boolean(candidate) &&
    plannerUsableOptionsForRole({ candidates: [candidate] }).length > 0;
}

// No direct assessment differs from all direct assessments rejecting. A
// rejected direct match may use a partial role only if another direct match
// individually passes. Supply the complete assessed universe for these ids.
function explicitAdmissionByIdentity(roles = []) {
  const admitted = new Map();
  const coveredAdmission = new Map();
  for (const role of Array.isArray(roles) ? roles : []) {
    for (const candidate of Array.isArray(role?.candidates) ? role.candidates : []) {
      const id = candidate?.candidate_id;
      if (id == null || id === '') continue;
      const key = String(id);
      const allowed = isIndividuallyAdmitted(candidate);
      admitted.set(key, admitted.get(key) === true || allowed);
      if (Array.isArray(candidate.covered_preferences) && candidate.covered_preferences.length > 0) {
        coveredAdmission.set(key, coveredAdmission.get(key) === true || allowed);
      }
    }
  }
  for (const [id, allowed] of coveredAdmission) {
    if (!allowed) admitted.set(id, false);
  }
  return admitted;
}

module.exports = { isIndividuallyAdmitted, explicitAdmissionByIdentity };
