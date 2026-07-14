"use strict";

function normalizeUtcEventDateTime(value) {
  const raw = firstString(value);
  if (!raw) return null;
  if (hasExplicitOffset(raw)) return validDateTimeOrNull(raw);
  if (isDateOnly(raw)) return validDateOnlyOrNull(raw);
  const parts = parseFloatingDateTime(raw);
  return parts ? utcPartsToIso(parts) : null;
}

function normalizeSourceEventDateTime(value, { timezone } = {}) {
  const raw = firstString(value);
  if (!raw) return null;
  if (hasExplicitOffset(raw)) return validDateTimeOrNull(raw);
  if (isDateOnly(raw)) return validDateOnlyOrNull(raw);
  const parts = parseFloatingDateTime(raw);
  const trustedTimezone = normalizeIanaTimezone(timezone);
  if (!parts || !trustedTimezone) return null;
  return zonedPartsToUtcIso(parts, trustedTimezone);
}

function normalizeIanaTimezone(value) {
  const timezone = firstString(value);
  if (!timezone) return null;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(0);
    return timezone;
  } catch (_error) {
    return null;
  }
}

function datePartsInTimezone(value, timezone) {
  const trustedTimezone = normalizeIanaTimezone(timezone);
  const date = value instanceof Date ? value : new Date(value);
  if (!trustedTimezone || !Number.isFinite(date.getTime())) return null;
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: trustedTimezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).formatToParts(date);
    const values = Object.fromEntries(
      parts
        .filter((part) => part.type !== "literal")
        .map((part) => [part.type, Number(part.value)]),
    );
    return {
      year: values.year,
      month: values.month,
      day: values.day,
      hour: values.hour,
      minute: values.minute,
      second: values.second,
    };
  } catch (_error) {
    return null;
  }
}

function hasExplicitOffset(value) {
  return /(?:z|[+-]\d{2}:?\d{2})$/i.test(String(value || "").trim());
}

function isDateOnly(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || "").trim());
}

function validDateTimeOrNull(value) {
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? String(value).trim() : null;
}

function validDateOnlyOrNull(value) {
  const raw = String(value || "").trim();
  const parsed = new Date(raw + "T00:00:00.000Z");
  if (!Number.isFinite(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10) === raw ? raw : null;
}

function parseFloatingDateTime(value) {
  const match = String(value || "").trim().match(
    /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/,
  );
  if (!match) return null;
  const parts = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4]),
    minute: Number(match[5]),
    second: Number(match[6] || 0),
    millisecond: Number(String(match[7] || "0").padEnd(3, "0")),
  };
  const check = new Date(Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
    parts.millisecond,
  ));
  if (
    check.getUTCFullYear() !== parts.year ||
    check.getUTCMonth() + 1 !== parts.month ||
    check.getUTCDate() !== parts.day ||
    check.getUTCHours() !== parts.hour ||
    check.getUTCMinutes() !== parts.minute ||
    check.getUTCSeconds() !== parts.second
  ) {
    return null;
  }
  return parts;
}

function utcPartsToIso(parts) {
  return new Date(Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
    parts.millisecond,
  )).toISOString();
}

function zonedPartsToUtcIso(parts, timezone) {
  const target = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  let candidate = target;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const rendered = datePartsInTimezone(candidate, timezone);
    if (!rendered) return null;
    const delta = target - Date.UTC(
      rendered.year,
      rendered.month - 1,
      rendered.day,
      rendered.hour,
      rendered.minute,
      rendered.second,
    );
    candidate += delta;
    if (delta === 0) break;
  }
  const rendered = datePartsInTimezone(candidate, timezone);
  if (!rendered || !sameDateTimeParts(rendered, parts)) return null;
  return new Date(candidate + parts.millisecond).toISOString();
}

function sameDateTimeParts(left, right) {
  return ["year", "month", "day", "hour", "minute", "second"].every(
    (key) => left[key] === right[key],
  );
}

function firstString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

module.exports = {
  datePartsInTimezone,
  normalizeIanaTimezone,
  normalizeSourceEventDateTime,
  normalizeUtcEventDateTime,
};
