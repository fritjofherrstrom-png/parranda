export const landingHero = {
  eyebrow: 'Astro landing proof',
  title: 'Plan the city like tonight is already happening.',
  body:
    'A static migration proof for Parranda’s public landing page: city-first, mobile-first and still safely outside production routing.',
  primaryCta: 'Open Barcelona planner',
  secondaryCta: 'Open Rome planner',
} as const;

export const proofCards = [
  {
    kicker: 'City shell first',
    title: 'No detached planner world',
    body: 'The proof keeps /:city?planner=open as the canonical handoff so migration work does not revive a separate route-first product model.',
  },
  {
    kicker: 'Pulse as product surface',
    title: 'The city should feel awake',
    body: 'Landing copy frames Pulse, Blitz and route planning as one live city intelligence layer, not disconnected widgets.',
  },
  {
    kicker: 'Migration safe',
    title: 'Static Astro only',
    body: 'No Preact island, no runtime state, no production Express route takeover and no Planner/Pulse/Blitz rewrite in this step.',
  },
] as const;

export const routeProofs = [
  { label: 'Barcelona', href: '/barcelona?planner=open' },
  { label: 'Rome', href: '/rome?planner=open' },
] as const;
