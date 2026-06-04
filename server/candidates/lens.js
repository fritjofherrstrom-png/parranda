const LENS_VALUES = ["first_time", "balanced", "local", "rediscover", "surprise"];

const LENS_ALIASES = {
  tourist: "first_time",
};

function normalizeLens(value) {
  if (typeof value !== "string") return null;
  const raw = value.trim().toLowerCase();
  if (!raw) return null;
  const canonical = LENS_ALIASES[raw] || raw;
  return LENS_VALUES.includes(canonical) ? canonical : null;
}

module.exports = {
  LENS_VALUES,
  LENS_ALIASES,
  normalizeLens,
};
