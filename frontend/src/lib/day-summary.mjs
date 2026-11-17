/**
 * The day's facts said as one sentence (Linje 2): "Five stops and a live
 * event, about 2.1 km on foot." It states exactly what the facts row did —
 * how many published stops, a woven live event, the estimated walk — and
 * nothing more. Counts above twelve stay digits.
 */
const EN = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];
// "stopp" is neuter: ett stopp, två stopp.
const SV = ["noll", "ett", "två", "tre", "fyra", "fem", "sex", "sju", "åtta", "nio", "tio", "elva", "tolv"];

const capital = (text) => text.charAt(0).toUpperCase() + text.slice(1);

export function countWord(n, lang = "en") {
  const words = lang === "sv" ? SV : EN;
  return Number.isInteger(n) && n >= 0 && n < words.length ? words[n] : String(n);
}

/**
 * @param {{ stops: number, live?: number, distance?: string | null, lang?: "sv" | "en" }} input
 *   distance: an already formatted walk ("2.1 km", "< 0.1 km"), or null when unknown.
 */
export function daySummary({ stops, live = 0, distance = null, lang = "en" }) {
  if (!Number.isInteger(stops) || stops < 0) return "";
  const sv = lang === "sv";
  const count = capital(countWord(stops, lang));
  let text = sv ? `${count} stopp` : `${count} ${stops === 1 ? "stop" : "stops"}`;
  if (live > 0) {
    text += sv
      ? live === 1 ? " och ett liveevent" : ` och ${countWord(live, lang)} liveevent`
      : live === 1 ? " and a live event" : ` and ${countWord(live, lang)} live events`;
  }
  if (distance) {
    const approx = distance.startsWith("<") ? "" : sv ? "cirka " : "about ";
    text += sv ? `, ${approx}${distance} till fots` : `, ${approx}${distance} on foot`;
  }
  return `${text}.`;
}

/**
 * A day as a station on the landing (Linje 2): "Tonight, five stops and a
 * live event" for the day in hand, "Saved Thursday 8 October, three stops"
 * for a saved one. Counted from the stored answer's own stops, never guessed;
 * an entry without stops gets only its day.
 *
 * @param {{ dateIso?: string | null, safeResponse?: any }} entry
 * @param {{ lang?: "sv" | "en", now?: Date, saved?: boolean }} options
 */
export function dayStationLine(entry, { lang = "en", now = new Date(), saved = false } = {}) {
  const sv = lang === "sv";
  const locale = sv ? "sv-SE" : "en-GB";
  const iso = typeof entry?.dateIso === "string" && /^\d{4}-\d{2}-\d{2}$/.test(entry.dateIso) ? entry.dateIso : null;
  const date = iso ? new Date(`${iso}T00:00:00Z`) : null;
  const long = date ? date.toLocaleDateString(locale, { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }) : "";
  const localIso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const today = localIso(now);
  const tomorrow = localIso(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1));
  let when = "";
  if (saved) when = long ? (sv ? `Sparad ${long}` : `Saved ${long}`) : (sv ? "Sparad" : "Saved");
  else if (iso === today) when = now.getHours() >= 17 ? (sv ? "I kväll" : "Tonight") : (sv ? "Idag" : "Today");
  else if (iso === tomorrow) when = sv ? "Imorgon" : "Tomorrow";
  else when = long ? capital(long) : "";
  const stops = entry?.safeResponse?.days?.[0]?.primary_route?.main_stops;
  if (!Array.isArray(stops) || stops.length === 0) return when;
  const live = stops.filter((stop) => stop && stop.is_live_event === true).length;
  const sentence = daySummary({ stops: stops.length - live, live, lang });
  const phrase = sentence.replace(/\.$/, "");
  const lower = phrase.charAt(0).toLowerCase() + phrase.slice(1);
  return when ? `${when}, ${lower}` : phrase;
}
