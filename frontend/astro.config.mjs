import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';

// The new frontend talks to the EXISTING Express API. In dev, /api is proxied to
// the running backend (PARRANDA_API_ORIGIN overrides for non-default ports).
const apiOrigin = process.env.PARRANDA_API_ORIGIN || 'http://127.0.0.1:8000';

export default defineConfig({
  output: 'static',
  site: 'https://parranda.app',
  integrations: [react()],
  vite: {
    // Tailwind 4 runs as a Vite plugin: no PostCSS step, no JS config. The
    // theme lives in src/styles/tailwind.css (@theme), the values in tokens.css.
    plugins: [tailwindcss()],
    // React 19's client entry is CJS; force pre-bundling so dev serves proper
    // ESM named exports (otherwise island hydration fails with "no export named
    // createRoot" when Vite serves the raw file).
    optimizeDeps: {
      include: ['react', 'react-dom', 'react-dom/client', 'react/jsx-runtime', 'react/jsx-dev-runtime', 'leaflet'],
    },
    server: {
      proxy: {
        '/api': { target: apiOrigin, changeOrigin: true },
      },
      fs: {
        // Allow importing the SHARED honesty module (anywhere-render-decision.js)
        // from the repo root — one honesty rule, zero duplication.
        allow: ['..'],
      },
    },
  },
});
