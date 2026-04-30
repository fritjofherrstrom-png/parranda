function parseIsoDateParts(dateString) {
  const match = String(dateString || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);

  if (!match) {
    return null;
  }

  const [, year, month, day] = match;
  return {
    year: Number(year),
    month: Number(month),
    day: Number(day),
  };
}

function isoDateToUtcNoon(dateString) {
  const parts = parseIsoDateParts(dateString);

  if (!parts) {
    return null;
  }

  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day, 12));
}

function getIsoWeekday(dateString) {
  const date = isoDateToUtcNoon(dateString);
  return date ? date.getUTCDay() : null;
}

function getIsoMonthDay(dateString) {
  const date = isoDateToUtcNoon(dateString);

  if (!date) {
    return {
      month: null,
      day: null,
      weekday: null,
    };
  }

  return {
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    weekday: date.getUTCDay(),
  };
}

function formatIsoDatePart(dateString, locale, options = {}) {
  const date = isoDateToUtcNoon(dateString);

  if (!date) {
    return "";
  }

  const formatted = new Intl.DateTimeFormat(locale, {
    timeZone: "UTC",
    ...options,
  }).format(date);

  return formatted.charAt(0).toUpperCase() + formatted.slice(1);
}

function diffIsoDatesInDays(leftDateString, rightDateString) {
  const left = isoDateToUtcNoon(leftDateString);
  const right = isoDateToUtcNoon(rightDateString);

  if (!left || !right) {
    return null;
  }

  return Math.round((right.getTime() - left.getTime()) / (24 * 60 * 60 * 1000));
}

module.exports = {
  parseIsoDateParts,
  isoDateToUtcNoon,
  getIsoWeekday,
  getIsoMonthDay,
  formatIsoDatePart,
  diffIsoDatesInDays,
};
