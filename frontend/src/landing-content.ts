import {
  buildPlannerHref,
  featuredLandingCities,
  landingProofCards,
} from './landing-contract.mjs';

export const landingHero = {
  eyebrow: 'Astro landing proof',
  title: 'Plan the city like tonight is already happening.',
  body:
    'A static migration proof for Parranda’s public landing page: city-first, mobile-first and still safely outside production routing.',
  primaryCta: 'Open Barcelona planner',
  secondaryCta: 'Open Rome planner',
} as const;

export const proofCards = landingProofCards;

export const routeProofs = featuredLandingCities.map((city) => ({
  label: city.label,
  href: buildPlannerHref(city.key),
  status: city.status,
  promise: city.promise,
})) as readonly {
  label: string;
  href: string;
  status: string;
  promise: string;
}[];
