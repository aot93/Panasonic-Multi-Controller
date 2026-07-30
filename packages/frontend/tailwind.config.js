/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Status palette for the grid cards (spec §5). Named by meaning
        // rather than hue so the mapping stays honest if the colours change.
        status: {
          ok: '#16a34a',
          warning: '#d97706',
          error: '#dc2626',
          unreachable: '#64748b',
          unknown: '#475569',
        },
      },
    },
  },
  plugins: [],
};
