/// <reference types="astro/client" />

// Side-effect CSS imports (e.g. maplibre-gl/dist/maplibre-gl.css) have no type declarations.
declare module "*.css";
