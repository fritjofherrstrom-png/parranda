/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}'],
  theme: {
    extend: {
      colors: {
        parranda: {
          ink: 'rgb(var(--p-color-ink) / <alpha-value>)',
          paper: 'rgb(var(--p-color-paper) / <alpha-value>)',
          accent: 'rgb(var(--p-color-accent) / <alpha-value>)',
          glow: 'rgb(var(--p-color-glow) / <alpha-value>)'
        }
      },
      borderRadius: {
        parranda: 'var(--p-radius-card)'
      },
      fontFamily: {
        display: ['var(--p-font-display)', 'system-ui', 'sans-serif'],
        body: ['var(--p-font-body)', 'system-ui', 'sans-serif']
      }
    }
  },
  plugins: []
};
