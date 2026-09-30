"use strict";

/**
 * Low-trust discovery vocabulary derived from resolver-attested country
 * context. These terms may find pages; they never attest a source or an event.
 * Unknown and multilingual contexts simply keep the English baseline.
 */

const COUNTRY_DISCOVERY_LOCALES = Object.freeze({
  ad: locale("ca", ["esdeveniments", "agenda", "mercat", "festes", "concert"], ["què visitar", "llocs d'interès"], ["festes populars", "festes locals"]),
  al: locale("sq", ["aktivitete", "kalendar", "treg", "festival", "koncert"], ["vende për të vizituar", "atraksione"], ["festa lokale", "festa zyrtare"]),
  at: locale("de", ["veranstaltungen", "veranstaltungskalender", "flohmarkt", "markt", "konzert"], ["sehenswürdigkeiten", "ausflugsziele"], ["dorffest", "feiertage"]),
  ba: locale("bs", ["događaji", "kalendar", "buvljak", "sajam", "koncert"], ["znamenitosti", "izleti"], ["lokalne manifestacije", "praznici"]),
  be: locale("nl", ["evenementen", "agenda", "brocante", "rommelmarkt", "concert"], ["bezienswaardigheden", "lieux à visiter"], ["kermis", "fête locale"]),
  bg: locale("bg", ["събития", "календар", "битпазар", "пазар", "концерт"], ["забележителности", "места за посещение"], ["събор", "местни празници"]),
  by: locale("be", ["падзеі", "афіша", "кірмаш", "фестываль", "канцэрт"], ["славутасці", "месцы для наведвання"], ["мясцовыя святы", "святы"]),
  ch: locale("de", ["veranstaltungen", "agenda", "brocante", "mercato", "konzert"], ["sehenswürdigkeiten", "lieux à visiter"], ["dorffest", "fête locale"]),
  cy: locale("el", ["εκδηλώσεις", "ημερολόγιο", "υπαίθρια αγορά", "αγορά", "συναυλία"], ["αξιοθέατα", "μέρη για επίσκεψη"], ["πανηγύρι", "τοπικές γιορτές"]),
  cz: locale("cs", ["akce", "kalendář akcí", "bleší trh", "trhy", "koncert"], ["památky", "co navštívit"]),
  de: locale("de", ["veranstaltungen", "veranstaltungskalender", "flohmarkt", "markt", "konzert"], ["sehenswürdigkeiten", "ausflugsziele"]),
  dk: locale("da", ["arrangementer", "kalender", "loppemarked", "marked", "koncert"], ["seværdigheder", "oplevelser"]),
  ee: locale("et", ["sündmused", "kalender", "kirbuturg", "laat", "kontsert"], ["vaatamisväärsused", "külastuskohad"], ["külapäev", "pühad"]),
  // Spain-wide discovery includes high-value co-official-language programme
  // terms. Page language is still detected from the source itself.
  es: locale("es", ["eventos", "agenda", "festes", "programació", "mercadillo"], ["lugares que visitar", "qué ver"], ["fiestas patronales", "festivos"]),
  fi: locale("fi", ["tapahtumat", "tapahtumakalenteri", "kirpputori", "markkinat", "konsertti"], ["nähtävyydet", "vierailukohteet"]),
  fr: locale("fr", ["événements", "agenda", "vide-greniers", "marché", "concert"], ["sites à visiter", "incontournables"]),
  gr: locale("el", ["εκδηλώσεις", "ημερολόγιο εκδηλώσεων", "υπαίθρια αγορά", "αγορά", "συναυλία"], ["αξιοθέατα", "μέρη για επίσκεψη"]),
  gb: locale("en", ["what's on", "events calendar", "car boot sale", "market", "concert"], ["places to visit", "local attractions"], ["village fete", "local holidays"]),
  hr: locale("hr", ["događanja", "kalendar događanja", "buvljak", "sajam", "koncert"], ["znamenitosti", "izleti"], ["pučka fešta", "blagdani"]),
  hu: locale("hu", ["programok", "programnaptár", "bolhapiac", "vásár", "koncert"], ["látnivalók", "kirándulás"], ["falunap", "ünnepnapok"]),
  ie: locale("en", ["what's on", "events calendar", "car boot sale", "market", "concert"], ["places to visit", "local attractions"], ["community festival", "local holidays"]),
  is: locale("is", ["viðburðir", "viðburðadagatal", "flóamarkaður", "markaður", "tónleikar"], ["áhugaverðir staðir", "skoðunarferðir"], ["bæjarhátíð", "frídagar"]),
  it: locale("it", ["eventi", "calendario eventi", "mercatino", "mercato", "concerto"], ["cosa vedere", "luoghi da visitare"]),
  li: locale("de", ["veranstaltungen", "kalender", "flohmarkt", "markt", "konzert"], ["sehenswürdigkeiten", "ausflugsziele"], ["dorffest", "feiertage"]),
  lt: locale("lt", ["renginiai", "renginių kalendorius", "blusų turgus", "mugė", "koncertas"], ["lankytinos vietos", "ką pamatyti"], ["miesto šventė", "šventinės dienos"]),
  lu: locale("fr", ["événements", "agenda", "brocante", "marché", "concert"], ["sites à visiter", "incontournables"], ["fête locale", "jours fériés"]),
  lv: locale("lv", ["pasākumi", "pasākumu kalendārs", "krāmu tirgus", "tirdziņš", "koncerts"], ["apskates objekti", "ko redzēt"], ["pilsētas svētki", "svētku dienas"]),
  mc: locale("fr", ["événements", "agenda", "brocante", "marché", "concert"], ["sites à visiter", "incontournables"], ["fête locale", "jours fériés"]),
  md: locale("ro", ["evenimente", "calendar", "târg", "piață", "concert"], ["obiective turistice", "locuri de vizitat"], ["sărbători locale", "zile libere"]),
  me: locale("sr", ["događaji", "kalendar", "buvljak", "sajam", "koncert"], ["znamenitosti", "izleti"], ["lokalne manifestacije", "praznici"]),
  mk: locale("mk", ["настани", "календар", "базар", "пазар", "концерт"], ["знаменитости", "места за посета"], ["локални празници", "празници"]),
  mt: locale("en", ["events", "calendar", "flea market", "market", "concert"], ["places to visit", "local attractions"], ["village festa", "public holidays"]),
  nl: locale("nl", ["evenementen", "agenda", "rommelmarkt", "markt", "concert"], ["bezienswaardigheden", "uitstapjes"]),
  no: locale("no", ["arrangementer", "kalender", "loppemarked", "marked", "konsert"], ["severdigheter", "opplevelser"]),
  pl: locale("pl", ["wydarzenia", "kalendarz wydarzeń", "pchli targ", "targ", "koncert"], ["atrakcje", "miejsca do odwiedzenia"]),
  pt: locale("pt", ["eventos", "agenda", "feira", "mercado", "concerto"], ["o que visitar", "atrações"]),
  se: locale("sv", ["evenemang", "evenemangskalender", "loppis", "marknad", "konsert"], ["sevärdheter", "besöksmål", "utflyktsmål"]),
  ro: locale("ro", ["evenimente", "calendar evenimente", "târg de vechituri", "târg", "concert"], ["obiective turistice", "locuri de vizitat"], ["sărbători locale", "zile libere"]),
  rs: locale("sr", ["događaji", "kalendar", "buvljak", "sajam", "koncert"], ["znamenitosti", "izleti"], ["lokalne manifestacije", "praznici"]),
  ru: locale("ru", ["события", "афиша", "блошиный рынок", "ярмарка", "концерт"], ["достопримечательности", "что посмотреть"], ["местные праздники", "праздничные дни"]),
  si: locale("sl", ["dogodki", "koledar dogodkov", "bolšji sejem", "tržnica", "koncert"], ["znamenitosti", "izleti"], ["krajevni praznik", "prazniki"]),
  sk: locale("sk", ["podujatia", "kalendár podujatí", "blší trh", "trhy", "koncert"], ["pamiatky", "čo navštíviť"], ["hody", "sviatky"]),
  sm: locale("it", ["eventi", "calendario eventi", "mercatino", "mercato", "concerto"], ["cosa vedere", "luoghi da visitare"], ["festa di paese", "festività"]),
  tr: locale("tr", ["etkinlikler", "etkinlik takvimi", "bit pazarı", "pazar", "konser"], ["gezilecek yerler", "yerel mekanlar"], ["yerel şenlikler", "resmi tatiller"]),
  ua: locale("uk", ["події", "афіша", "блошиний ринок", "ярмарок", "концерт"], ["пам'ятки", "що подивитися"], ["місцеві свята", "святкові дні"]),
  va: locale("it", ["eventi", "calendario eventi", "mercatino", "mercato", "concerto"], ["cosa vedere", "luoghi da visitare"], ["feste locali", "festività"]),
  xk: locale("sq", ["aktivitete", "kalendar", "treg", "festival", "koncert"], ["vende për të vizituar", "atraksione"], ["festa lokale", "festa zyrtare"]),
});

const LOCAL_RHYTHM_TERMS = Object.freeze({
  cs: ["pouť", "místní svátky"], de: ["dorffest", "feiertage"], da: ["byfest", "helligdage"],
  fi: ["kyläjuhla", "pyhäpäivät"], fr: ["fête de village", "jours fériés"], el: ["πανηγύρι", "τοπικές γιορτές"],
  it: ["sagra", "feste patronali"], nl: ["buurtfeest", "feestdagen"], no: ["bygdefest", "helligdager"],
  pl: ["festyn", "święta lokalne"], pt: ["festas populares", "feriados"], sv: ["bygdefest", "helgdagar"],
});

function locale(language, terms, placeTerms, rhythmTerms = null) {
  return Object.freeze({
    language,
    terms: Object.freeze(terms),
    placeTerms: Object.freeze(placeTerms),
    // Separate lane so small local celebrations cannot be cut off by the
    // ordinary calendar vocabulary's budget. Terms are discovery hints only.
    rhythmTerms: rhythmTerms && Object.freeze(rhythmTerms),
  });
}

function discoveryLocaleForCountryCode(value) {
  const countryCode = typeof value === "string" ? value.trim().toLowerCase() : "";
  const found = COUNTRY_DISCOVERY_LOCALES[countryCode];
  return found
    ? {
        language_hints: [found.language],
        local_discovery_terms: [...found.terms],
        local_place_discovery_terms: [...found.placeTerms],
        local_rhythm_discovery_terms: [...(found.rhythmTerms || LOCAL_RHYTHM_TERMS[found.language] || [])],
      }
    : { language_hints: [], local_discovery_terms: [], local_place_discovery_terms: [], local_rhythm_discovery_terms: [] };
}

module.exports = {
  COUNTRY_DISCOVERY_LOCALES,
  discoveryLocaleForCountryCode,
};
