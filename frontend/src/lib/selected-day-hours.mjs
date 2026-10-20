const LOCAL_CLOCK = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const LOCAL_END_CLOCK = /^(?:(?:[01]\d|2[0-3]):[0-5]\d|24:00)$/;

/**
 * Render the server-owned selected-day schedule fact. This never interprets a
 * raw opening-hours expression and never claims that a venue is open now.
 */
export function selectedDayHoursLabel(value, lang = "en") {
  if (value?.status === "unknown") {
    if (!validConditionalFact(value)) return null;
    const prefix = lang === "sv" ? "Ordinarie tider" : "Regular hours";
    const schedule = value.ordinary_status === "closed"
      ? (lang === "sv" ? "stängt" : "closed")
      : value.ordinary_windows.map((window) => `${window.opens}–${window.closes}`).join(", ");
    const uncertainty = value.uncertainty === "holiday_exceptions"
      ? (lang === "sv" ? "Helgdagstider ej bekräftade" : "Holiday hours unconfirmed")
      : (lang === "sv" ? "Vald dag ej bekräftad" : "Selected day unconfirmed");
    return `${prefix}: ${schedule} · ${uncertainty}`;
  }
  if (value?.status === "closed") {
    return lang === "sv" ? "Källan anger stängt för vald dag" : "Source reports closed for selected day";
  }
  if (!value || value.status !== "known") return null;
  const prefix = lang === "sv" ? "Källans tider för vald dag" : "Source hours for selected day";
  if (value.all_day === true) {
    return `${prefix}: ${lang === "sv" ? "hela dygnet" : "all day"}`;
  }

  const windows = Array.isArray(value.windows)
    ? value.windows
        .filter((window) => LOCAL_CLOCK.test(String(window?.opens || "")) && LOCAL_END_CLOCK.test(String(window?.closes || "")))
        .slice(0, 4)
        .map((window) => `${window.opens}–${window.closes}`)
    : [];
  return windows.length ? `${prefix}: ${windows.join(", ")}` : null;
}

function validConditionalFact(value) {
  if (value.all_day !== false || !Array.isArray(value.windows) || value.windows.length ||
    !["known", "closed"].includes(value.ordinary_status) || !Array.isArray(value.ordinary_windows) ||
    !["holiday_exceptions", "unresolved_conditions"].includes(value.uncertainty)) return false;
  const windows = value.ordinary_windows;
  if (value.ordinary_status === "closed" ? windows.length !== 0 :
    !windows.length || windows.length > 4 || windows.some((window) =>
      typeof window?.opens !== "string" || typeof window?.closes !== "string" ||
      !LOCAL_CLOCK.test(window.opens) || !LOCAL_END_CLOCK.test(window.closes) || window.opens >= window.closes)) return false;
  if (typeof value.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value.date) ||
    !Number.isFinite(Date.parse(`${value.date}T12:00:00Z`)) ||
    new Date(`${value.date}T12:00:00Z`).toISOString().slice(0, 10) !== value.date ||
    typeof value.timezone !== "string" || !value.timezone || value.timezone.length > 80 ||
    typeof value.observed_at !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value.observed_at) ||
    !Number.isFinite(Date.parse(value.observed_at)) ||
    new Date(value.observed_at).toISOString().slice(0, 10) !== value.observed_at.slice(0, 10)) return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: value.timezone });
    if (typeof value.source_url !== "string" || value.source_url.length > 2048 ||
      !/^https?:\/\//i.test(value.source_url) || /[\u0000-\u0020\u007f\\]/.test(value.source_url)) return false;
    const url = new URL(value.source_url);
    return Boolean(url.hostname && !url.username && !url.password && url.href.length <= 2048);
  } catch {
    return false;
  }
}
