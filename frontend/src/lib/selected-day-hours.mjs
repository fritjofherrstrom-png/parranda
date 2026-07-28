const LOCAL_CLOCK = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const LOCAL_END_CLOCK = /^(?:(?:[01]\d|2[0-3]):[0-5]\d|24:00)$/;

/**
 * Render the server-owned selected-day schedule fact. This never interprets a
 * raw opening-hours expression and never claims that a venue is open now.
 */
export function selectedDayHoursLabel(value, lang = "en") {
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
