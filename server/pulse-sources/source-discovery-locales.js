"use strict";

/**
 * Low-trust discovery vocabulary derived from resolver-attested country
 * context. These terms may find pages; they never attest a source or an event.
 * Unknown and multilingual contexts simply keep the English baseline.
 */

const COUNTRY_DISCOVERY_LOCALES = Object.freeze({
  cz: locale("cs", ["akce", "kalendář akcí", "bleší trh", "trhy", "koncert"]),
  de: locale("de", ["veranstaltungen", "veranstaltungskalender", "flohmarkt", "markt", "konzert"]),
  dk: locale("da", ["arrangementer", "kalender", "loppemarked", "marked", "koncert"]),
  // Spain-wide discovery includes high-value co-official-language programme
  // terms. Page language is still detected from the source itself.
  es: locale("es", ["eventos", "agenda", "festes", "programació", "mercadillo"]),
  fi: locale("fi", ["tapahtumat", "tapahtumakalenteri", "kirpputori", "markkinat", "konsertti"]),
  fr: locale("fr", ["événements", "agenda", "vide-greniers", "marché", "concert"]),
  gr: locale("el", ["εκδηλώσεις", "ημερολόγιο εκδηλώσεων", "υπαίθρια αγορά", "αγορά", "συναυλία"]),
  it: locale("it", ["eventi", "calendario eventi", "mercatino", "mercato", "concerto"]),
  nl: locale("nl", ["evenementen", "agenda", "rommelmarkt", "markt", "concert"]),
  no: locale("no", ["arrangementer", "kalender", "loppemarked", "marked", "konsert"]),
  pl: locale("pl", ["wydarzenia", "kalendarz wydarzeń", "pchli targ", "targ", "koncert"]),
  pt: locale("pt", ["eventos", "agenda", "feira", "mercado", "concerto"]),
  se: locale("sv", ["evenemang", "evenemangskalender", "loppis", "marknad", "konsert"]),
});

function locale(language, terms) {
  return Object.freeze({ language, terms: Object.freeze(terms) });
}

function discoveryLocaleForCountryCode(value) {
  const countryCode = typeof value === "string" ? value.trim().toLowerCase() : "";
  const found = COUNTRY_DISCOVERY_LOCALES[countryCode];
  return found
    ? { language_hints: [found.language], local_discovery_terms: [...found.terms] }
    : { language_hints: [], local_discovery_terms: [] };
}

module.exports = {
  COUNTRY_DISCOVERY_LOCALES,
  discoveryLocaleForCountryCode,
};
