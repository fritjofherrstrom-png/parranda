/// <reference types="astro/client" />

// Side-effect CSS imports (e.g. leaflet/dist/leaflet.css) have no type declarations.
declare module "*.css";
