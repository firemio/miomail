/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/renderer/**/*.{js,ts,jsx,tsx,html}'],
  theme: {
    extend: {
      colors: {
        sumi: {
          bg: 'rgb(var(--sumi-bg) / <alpha-value>)',
          surface: 'rgb(var(--sumi-surface) / <alpha-value>)',
          'surface-2': 'rgb(var(--sumi-surface-2) / <alpha-value>)',
          text: 'rgb(var(--sumi-text) / <alpha-value>)',
          'text-muted': 'rgb(var(--sumi-text-muted) / <alpha-value>)',
          accent: 'rgb(var(--sumi-accent) / <alpha-value>)',
          'accent-strong': 'rgb(var(--sumi-accent-strong) / <alpha-value>)',
          unread: 'rgb(var(--sumi-unread) / <alpha-value>)',
          border: 'rgb(var(--sumi-border) / <alpha-value>)',
        }
      },
      fontFamily: {
        sans: ['"Meiryo"', '"Yu Gothic UI"', '"Noto Sans JP"', 'sans-serif'],
        display: ['"Yu Gothic UI"', '"Meiryo"', '"Noto Sans JP"', 'sans-serif'],
      }
    }
  },
  plugins: []
}
