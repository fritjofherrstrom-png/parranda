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
