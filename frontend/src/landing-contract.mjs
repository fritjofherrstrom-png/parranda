export const supportedLandingLanguages = ['en', 'sv'];

export const featuredLandingCities = [
  {
    key: 'barcelona',
    label: 'Barcelona',
    status: 'beta',
    promise: 'Beta city with real route coverage and city pulse wiring.',
  },
  {
    key: 'rome',
    label: 'Rome',
    status: 'public',
    promise: 'Curated routes, local timing and the richest current citypack.',
  },
  {
    key: 'athens',
    label: 'Athens',
    status: 'preview',
    promise: 'Early preview city that proves thin-city honesty before full launch.',
  },
];

export const landingCityAliases = {
  roma: 'rome',
  rome: 'rome',
  barcelone: 'barcelona',
  barcelona: 'barcelona',
  athens: 'athens',
};

export function normalizeLandingLanguage(language = 'en') {
  const normalized = String(language || '').trim().toLowerCase().split('-')[0];
  return supportedLandingLanguages.includes(normalized) ? normalized : 'en';
}

export function buildPlannerHref(cityKey, language = 'en') {
  const normalizedCity = String(cityKey || '').trim().toLowerCase();
  const languageKey = normalizeLandingLanguage(language);
  const city = featuredLandingCities.find((entry) => entry.key === normalizedCity);
  const params = new URLSearchParams();
  params.set('city', normalizedCity);
  params.set('place', city?.label || normalizedCity);
  params.set('planner', 'open');
  params.set('lang', languageKey);
  return `/anywhere?${params.toString()}`;
}

export const landingProofCards = [
  {
    kicker: 'One modern planner',
    title: 'Citypack depth, modern surface',
    body: 'Registered cities enter the modern planner with their exact citypack identity; freeform places keep the agnostic intake.',
  },
  {
    kicker: 'Pulse as product surface',
    title: 'The city should feel awake',
    body: 'Landing copy frames Pulse, Blitz and route planning as one live city intelligence layer, not disconnected widgets.',
  },
  {
    kicker: 'Migration safe',
    title: 'Static Astro only',
    body: 'No production route takeover, no Preact island, no runtime state, no Express route takeover and no Planner/Pulse/Blitz rewrite in this step.',
  },
];
