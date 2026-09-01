"use strict";

/**
 * Low-trust discovery vocabulary derived from resolver-attested country
 * context. These terms may find pages; they never attest a source or an event.
 * Unknown and multilingual contexts simply keep the English baseline.
 */

const COUNTRY_DISCOVERY_LOCALES = Object.freeze({
  cz: locale("cs", ["akce", "kalendář akcí", "bleší trh", "trhy", "koncert"], ["památky", "co navštívit"]),
  de: locale("de", ["veranstaltungen", "veranstaltungskalender", "flohmarkt", "markt", "konzert"], ["sehenswürdigkeiten", "ausflugsziele"]),
  dk: locale("da", ["arrangementer", "kalender", "loppemarked", "marked", "koncert"], ["seværdigheder", "oplevelser"]),
  // Spain-wide discovery includes high-value co-official-language programme
  // terms. Page language is still detected from the source itself.
  es: locale("es", ["eventos", "agenda", "festes", "programació", "mercadillo"], ["lugares que visitar", "qué ver"]),
  fi: locale("fi", ["tapahtumat", "tapahtumakalenteri", "kirpputori", "markkinat", "konsertti"], ["nähtävyydet", "vierailukohteet"]),
  fr: locale("fr", ["événements", "agenda", "vide-greniers", "marché", "concert"], ["sites à visiter", "incontournables"]),
  gr: locale("el", ["εκδηλώσεις", "ημερολόγιο εκδηλώσεων", "υπαίθρια αγορά", "αγορά", "συναυλία"], ["αξιοθέατα", "μέρη για επίσκεψη"]),
  it: locale("it", ["eventi", "calendario eventi", "mercatino", "mercato", "concerto"], ["cosa vedere", "luoghi da visitare"]),
  nl: locale("nl", ["evenementen", "agenda", "rommelmarkt", "markt", "concert"], ["bezienswaardigheden", "uitstapjes"]),
  no: locale("no", ["arrangementer", "kalender", "loppemarked", "marked", "konsert"], ["severdigheter", "opplevelser"]),
  pl: locale("pl", ["wydarzenia", "kalendarz wydarzeń", "pchli targ", "targ", "koncert"], ["atrakcje", "miejsca do odwiedzenia"]),
  pt: locale("pt", ["eventos", "agenda", "feira", "mercado", "concerto"], ["o que visitar", "atrações"]),
  se: locale("sv", ["evenemang", "evenemangskalender", "loppis", "marknad", "konsert"], ["sevärdheter", "besöksmål", "utflyktsmål"]),
});

function locale(language, terms, placeTerms) {
  return Object.freeze({
    language,
    terms: Object.freeze(terms),
    placeTerms: Object.freeze(placeTerms),
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
      }
    : { language_hints: [], local_discovery_terms: [], local_place_discovery_terms: [] };
}

module.exports = {
  COUNTRY_DISCOVERY_LOCALES,
  discoveryLocaleForCountryCode,
};
