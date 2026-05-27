import type { Config } from 'tailwindcss'

const config: Config = {
  darkMode: 'class',
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        'primary':                  '#fabd00',
        'on-primary':               '#3f2e00',
        'primary-container':        '#ffc107',
        'secondary':                '#c9c6c5',
        'on-secondary':             '#313030',
        'secondary-container':      '#4a4949',
        'surface':                  '#121317',
        'on-surface':               '#e3e2e7',
        'surface-variant':          '#343539',
        'on-surface-variant':       '#d4c5ab',
        'outline':                  '#9c8f78',
        'outline-variant':          '#4f4632',
        'background':               '#0d0e12',
        'surface-container-lowest': '#0d0e12',
        'surface-container-low':    '#1a1b1f',
        'surface-container':        '#1e1f23',
        'surface-container-high':   '#292a2e',
        'surface-container-highest':'#343539',
        'error':                    '#ffb4ab',
        'error-container':          '#93000a',
        'on-error-container':       '#ffdad6',
      },
      fontFamily: {
        sans:  ['Inter', 'sans-serif'],
        mono:  ['"JetBrains Mono"', 'monospace'],
      },
      spacing: {
        'margin-desktop': '64px',
        xs: '4px', sm: '8px', md: '16px', lg: '24px', xl: '32px',
      },
      boxShadow: {
        'neon':      '0 0 15px rgba(250,189,0,0.15)',
        'neon-lg':   '0 0 25px rgba(250,189,0,0.25)',
        'neon-text': '0 0 10px rgba(250,189,0,0.5)',
      },
    },
  },
  plugins: [],
}
export default config
