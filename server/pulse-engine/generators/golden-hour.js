/**
 * Golden hour generator — city-agnostic, selective.
 *
 * Emits a `golden_hour` signal only when sunset is meaningfully relevant
 * to the request moment. Three valid windows:
 *
 *   1. ACTIVE       — sunset is within ±25 minutes of `now`
 *   2. UPCOMING     — sunset is later today, within the next 3 hours
 *   3. TONIGHT      — `now` is daytime (>= 12:00 city-local) and sunset
 *                     is later the same day (used as a "tonight's window"
 *                     framing, never as background noise)
 *
 * Outside the eligible months (roughly Apr–Oct), the generator stays silent.
 * Outside the three windows above, it stays silent. There is no generic
 * "sunset exists today" emission.
 *
 * Sunset is approximated with the standard NOAA formula. We don't need
 * minute-precision — the windows are intentionally generous.
 */

const ELIGIBLE_MONTHS = new Set([3, 4, 5, 6, 7, 8, 9, 10]); // March → October
const ACTIVE_TOLERANCE_MIN = 25;
const UPCOMING_HORIZON_MIN = 180;
const TONIGHT_MIN_HOUR = 12;

function goldenHourGenerator(context) {
  if (!context?.center || typeof context.center.lat !== "number") return [];
  if (!context.cityNow) return [];

  const { month, hour, minute, totalMinutes } = context.cityNow;
  if (!ELIGIBLE_MONTHS.has(month)) return [];
  if (hour === undefined || minute === undefined) return [];

  const sunsetMinutes = computeSunsetMinutes(context);
  if (sunsetMinutes === null) return [];

  const distance = sunsetMinutes - totalMinutes;

  let window = null;
  if (Math.abs(distance) <= ACTIVE_TOLERANCE_MIN) {
    window = "active";
  } else if (distance > 0 && distance <= UPCOMING_HORIZON_MIN) {
    window = "upcoming";
  } else if (distance > UPCOMING_HORIZON_MIN && hour >= TONIGHT_MIN_HOUR) {
    window = "tonight";
  }

  if (!window) return [];

  return [buildGoldenHourSignal({ window, distance, sunsetMinutes, context })];
}

goldenHourGenerator.generatorId = "golden-hour";

function buildGoldenHourSignal({ window, distance, sunsetMinutes, context }) {
  const isEnglish = String(context.lang).toLowerCase() === "en";
  const sunsetLabel = formatClock(sunsetMinutes);
  const cityLabel = context.city?.label || "";

  const title = buildTitle(window, isEnglish, sunsetLabel);
  const blurb = buildBlurb(window, isEnglish, sunsetLabel, distance);
  const reason = isEnglish
    ? "Sunset reshapes the city. When the window lines up, lean evening views and warm-light stops into the plan."
    : "Solnedgången förändrar staden. När fönstret stämmer vinner kvällsutsikter och varmt ljus över att forcera planen.";

  return {
    id: `golden-hour-${context.date}-${window}`,
    type: "golden_hour",
    level: "venue",
    title,
    area: cityLabel,
    where: cityLabel,
    when: sunsetLabel,
    blurb,
    reason,
    why_it_matters: reason,
    kind: isEnglish ? "Sunset window" : "Solnedgångsfönster",
    kindLabel: isEnglish ? "Sunset" : "Solnedgång",
    time_window: {
      hours: [
        Math.max(0, Math.floor((sunsetMinutes - 30) / 60)),
        Math.min(23, Math.ceil((sunsetMinutes + 30) / 60)),
      ],
    },
    matches_vibes: ["romantic"],
    score: window === "active" ? 7 : window === "upcoming" ? 5 : 3,
    source: { kind: "computed", label: isEnglish ? "sunset" : "solnedgång" },
    trust_level: "verified",
    freshness: window === "tonight" ? "today" : "live",
  };
}

function buildTitle(window, isEnglish, sunsetLabel) {
  if (window === "active") {
    return isEnglish
      ? `Golden hour is happening now — sunset around ${sunsetLabel}`
      : `Golden hour pågår just nu – solnedgång ca ${sunsetLabel}`;
  }
  if (window === "upcoming") {
    return isEnglish
      ? `Golden hour is coming up at ${sunsetLabel}`
      : `Golden hour närmar sig kl ${sunsetLabel}`;
  }
  return isEnglish
    ? `Tonight's golden hour lands around ${sunsetLabel}`
    : `Kvällens golden hour landar runt ${sunsetLabel}`;
}

function buildBlurb(window, isEnglish, sunsetLabel, distance) {
  if (window === "active") {
    return isEnglish
      ? "If you're heading out, this is the half-hour where rooftops, terraces, and west-facing streets carry the most."
      : "Är du på väg ut är det här halvtimmen då tak, terrasser och västvända gator bär mest.";
  }
  if (window === "upcoming") {
    const minutes = Math.max(5, Math.round(distance / 5) * 5);
    return isEnglish
      ? `About ${minutes} minutes until sunset at ${sunsetLabel}. A view stop or a high terrace right now pays off.`
      : `Cirka ${minutes} minuter till solnedgång kl ${sunsetLabel}. Ett utsiktsstopp eller en hög terrass nu lönar sig.`;
  }
  return isEnglish
    ? `Plan one stop for the ${sunsetLabel} window — let the late afternoon set up an outdoor evening rather than a packed daytime.`
    : `Lägg ett stopp i ${sunsetLabel}-fönstret – låt eftermiddagen bygga upp en utomhuskväll i stället för ett tätt dagsprogram.`;
}

function formatClock(minutes) {
  const hh = Math.floor(minutes / 60);
  const mm = Math.round(minutes % 60);
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

/**
 * Approximate sunset for (lat, lng, date) in city-local minutes since
 * midnight. Standard NOAA solar position algorithm at solar zenith 90.833°
 * (accounts for atmospheric refraction at the horizon).
 *
 * Returns null on edge cases (poles, polar night/day) where sunset is
 * undefined for that date — generator silently skips emission then.
 */
function computeSunsetMinutes(context) {
  const { lat, lng } = context.center;
  const { year, month, day } = context.cityNow;
  if (lat === undefined || lng === undefined) return null;

  const dayOfYear = isoDayOfYear(year, month, day);
  if (dayOfYear === null) return null;

  const lngHour = lng / 15;
  const t = dayOfYear + (18 - lngHour) / 24; // sunset approx

  const meanAnomaly = (0.9856 * t) - 3.289;
  const trueLongitude = wrap360(
    meanAnomaly +
      1.916 * sinDeg(meanAnomaly) +
      0.020 * sinDeg(2 * meanAnomaly) +
      282.634,
  );

  const rightAscension = wrap360(
    Math.atan(0.91764 * tanDeg(trueLongitude)) * (180 / Math.PI),
  );
  const trueLongQuadrant = Math.floor(trueLongitude / 90) * 90;
  const rightAscQuadrant = Math.floor(rightAscension / 90) * 90;
  const adjustedRA = (rightAscension + (trueLongQuadrant - rightAscQuadrant)) / 15;

  const sinDec = 0.39782 * sinDeg(trueLongitude);
  const cosDec = Math.cos(Math.asin(sinDec));

  const zenith = 90.833;
  const cosH =
    (cosDeg(zenith) - sinDec * sinDeg(lat)) /
    (cosDec * cosDeg(lat));

  if (cosH > 1 || cosH < -1) return null; // polar edge — silent

  const H = (Math.acos(cosH) * (180 / Math.PI)) / 15; // sunset hour angle in hours
  const localMeanTime = H + adjustedRA - (0.06571 * t) - 6.622;
  const utcHours = wrap24(localMeanTime - lngHour);

  // Offset between UTC and city-local. context.cityNow is local; context.now
  // is UTC instant. Compute offset by comparing.
  const offsetMinutes = cityLocalOffsetMinutes(context);
  const localMinutes = wrap1440(Math.round(utcHours * 60) + offsetMinutes);

  return localMinutes;
}

function cityLocalOffsetMinutes(context) {
  const { year, month, day, hour, minute } = context.cityNow;
  if (
    year === undefined ||
    month === undefined ||
    day === undefined ||
    hour === undefined ||
    minute === undefined
  ) {
    return 0;
  }
  const localAsUtc = Date.UTC(year, month - 1, day, hour, minute, 0);
  const actualUtc = context.now.getTime();
  return Math.round((localAsUtc - actualUtc) / 60000);
}

function isoDayOfYear(year, month, day) {
  if (!year || !month || !day) return null;
  const daysInMonth = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (isLeapYear(year)) daysInMonth[1] = 29;
  let total = 0;
  for (let m = 0; m < month - 1; m += 1) total += daysInMonth[m];
  return total + day;
}

function isLeapYear(year) {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function sinDeg(deg) {
  return Math.sin((deg * Math.PI) / 180);
}
function cosDeg(deg) {
  return Math.cos((deg * Math.PI) / 180);
}
function tanDeg(deg) {
  return Math.tan((deg * Math.PI) / 180);
}
function wrap360(value) {
  const v = value % 360;
  return v < 0 ? v + 360 : v;
}
function wrap24(value) {
  const v = value % 24;
  return v < 0 ? v + 24 : v;
}
function wrap1440(value) {
  const v = value % 1440;
  return v < 0 ? v + 1440 : v;
}

module.exports = goldenHourGenerator;
module.exports._internal = {
  computeSunsetMinutes,
  ELIGIBLE_MONTHS,
  ACTIVE_TOLERANCE_MIN,
  UPCOMING_HORIZON_MIN,
  TONIGHT_MIN_HOUR,
};
