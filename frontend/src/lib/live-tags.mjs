/**
 * A Live tag in the reader's language.
 *
 * Tags are the source's own category words, so a Swedish page showed "Eat &
 * Drink" and "Exhibitions" next to Swedish text, and an English page could
 * show "Musik". Common event categories are translated here; any other tag
 * stays exactly as the source wrote it rather than being guessed at.
 * Generic vocabulary only: no source, city or venue names.
 *
 * Catch-all placeholders that name no category ("Miscellaneous",
 * "Undefined") are not shown: they tell the reader nothing.
 */

const CATEGORIES = [
  { en: "Music", sv: "Musik", words: ["music", "musik", "musikk", "musiikki", "musique", "música", "musica"] },
  { en: "Concerts", sv: "Konserter", words: ["concert", "concerts", "konsert", "konserter", "koncert", "koncerter", "konsertti", "konsertit"] },
  { en: "Jazz", sv: "Jazz", words: ["jazz"] },
  { en: "Classical", sv: "Klassiskt", words: ["classical", "classical music", "klassisk", "klassisk musik", "klassiskt"] },
  { en: "Exhibitions", sv: "Utställningar", words: ["exhibition", "exhibitions", "utställning", "utställningar", "udstilling", "udstillinger", "utstilling", "utstillinger", "näyttely", "näyttelyt"] },
  { en: "Art", sv: "Konst", words: ["art", "konst", "kunst", "taide"] },
  { en: "Theatre", sv: "Teater", words: ["theatre", "theater", "teater", "teatteri"] },
  { en: "Dance", sv: "Dans", words: ["dance", "dans", "tanssi"] },
  { en: "Film", sv: "Film", words: ["film", "films", "cinema", "movies", "elokuva", "elokuvat"] },
  { en: "Food & drink", sv: "Mat & dryck", words: ["eat & drink", "food & drink", "food and drink", "food", "mat & dryck", "mat och dryck", "mad & drikke", "mat og drikke"] },
  { en: "Family", sv: "Familj", words: ["family", "families", "familj", "familjer", "familie", "familier", "perhe"] },
  { en: "Kids", sv: "Barn", words: ["kids", "children", "child", "barn", "børn", "lapset"] },
  { en: "Sports", sv: "Sport", words: ["sport", "sports", "idrott", "idræt", "idrett", "urheilu"] },
  { en: "Talks", sv: "Föredrag", words: ["talk", "talks", "lecture", "lectures", "föredrag", "föreläsning", "föreläsningar", "foredrag", "luento", "luennot"] },
  { en: "Literature", sv: "Litteratur", words: ["literature", "books", "litteratur", "böcker", "kirjallisuus"] },
  { en: "Festivals", sv: "Festivaler", words: ["festival", "festivals", "festivaler", "festivaali"] },
  { en: "Markets", sv: "Marknader", words: ["market", "markets", "marknad", "marknader", "marked", "markeder", "tori", "torit"] },
  { en: "Comedy", sv: "Humor", words: ["comedy", "stand-up", "standup", "humor", "komik"] },
  { en: "Guided tours", sv: "Visningar", words: ["guided tour", "guided tours", "visning", "visningar", "guidning", "guidad visning", "omvisning", "rundvisning"] },
  { en: "Workshops", sv: "Workshoppar", words: ["workshop", "workshops", "workshoppar", "verkstad"] },
  { en: "Nightlife", sv: "Nattliv", words: ["nightlife", "nattliv", "natteliv"] },
  { en: "Outdoors", sv: "Utomhus", words: ["outdoors", "outdoor", "nature", "natur", "friluftsliv", "utomhus", "luonto"] },
  { en: "History", sv: "Historia", words: ["history", "historia", "historie"] },
  { en: "Opera", sv: "Opera", words: ["opera", "ooppera"] },
  // Combined categories as calendars publish them.
  { en: "Clubs & parties", sv: "Klubbar & fester", words: ["clubs & parties", "clubs and parties", "klubbar & fester"] },
  { en: "Tours & talks", sv: "Visningar & föredrag", words: ["guided tours & lectures", "guided tours and lectures", "tours & talks", "visningar & föredrag"] },
  { en: "Networking & community", sv: "Nätverk & gemenskap", words: ["networking & community", "networking and community", "nätverk & gemenskap"] },
  { en: "Sports & wellbeing", sv: "Sport & hälsa", words: ["sports & wellbeing", "sports and wellbeing", "sport & hälsa"] },
  { en: "Stage & film", sv: "Scen & film", words: ["stage & film", "stage and film", "scen & film"] },
  { en: "Art & design", sv: "Konst & design", words: ["art & design", "art and design", "konst & design"] },
];

const BY_WORD = new Map();
for (const category of CATEGORIES) {
  for (const word of category.words) BY_WORD.set(word, category);
}

const PLACEHOLDERS = new Set(["miscellaneous", "misc", "misc.", "undefined", "other", "others", "övrigt", "övriga", "annat"]);

const normalized = (tag) => tag.trim().toLowerCase().replace(/\s+/g, " ");

/**
 * The tag in `lang`, or the source's own words when it is not a known
 * category. A catch-all placeholder becomes "" (not shown).
 */
export function liveTagLabel(tag, lang) {
  const key = normalized(String(tag));
  if (PLACEHOLDERS.has(key)) return "";
  const category = BY_WORD.get(key);
  return category ? category[lang === "sv" ? "sv" : "en"] : String(tag).trim();
}

/** Labels for a list of tags, translated and without repeats ("Music" and "musik" are one). */
export function liveTagLabels(tags, lang) {
  const labels = [];
  for (const tag of Array.isArray(tags) ? tags : []) {
    const label = liveTagLabel(tag, lang);
    if (label && !labels.some((existing) => existing.toLowerCase() === label.toLowerCase())) labels.push(label);
  }
  return labels;
}
