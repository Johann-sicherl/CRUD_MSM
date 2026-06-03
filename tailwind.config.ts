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
        'primary':                   'rgb(var(--c-primary) / <alpha-value>)',
        'on-primary':                'rgb(var(--c-on-primary) / <alpha-value>)',
        'primary-container':         'rgb(var(--c-primary-container) / <alpha-value>)',
        'secondary':                 'rgb(var(--c-secondary) / <alpha-value>)',
        'on-secondary':              'rgb(var(--c-on-secondary) / <alpha-value>)',
        'secondary-container':       'rgb(var(--c-secondary-container) / <alpha-value>)',
        'surface':                   'rgb(var(--c-surface) / <alpha-value>)',
        'on-surface':                'rgb(var(--c-on-surface) / <alpha-value>)',
        'surface-variant':           'rgb(var(--c-surface-variant) / <alpha-value>)',
        'on-surface-variant':        'rgb(var(--c-on-surface-variant) / <alpha-value>)',
        'outline':                   'rgb(var(--c-outline) / <alpha-value>)',
        'outline-variant':           'rgb(var(--c-outline-variant) / <alpha-value>)',
        'background':                'rgb(var(--c-background) / <alpha-value>)',
        'surface-container-lowest':  'rgb(var(--c-surface-container-lowest) / <alpha-value>)',
        'surface-container-low':     'rgb(var(--c-surface-container-low) / <alpha-value>)',
        'surface-container':         'rgb(var(--c-surface-container) / <alpha-value>)',
        'surface-container-high':    'rgb(var(--c-surface-container-high) / <alpha-value>)',
        'surface-container-highest': 'rgb(var(--c-surface-container-highest) / <alpha-value>)',
        'error':                     'rgb(var(--c-error) / <alpha-value>)',
        'error-container':           'rgb(var(--c-error-container) / <alpha-value>)',
        'on-error-container':        'rgb(var(--c-on-error-container) / <alpha-value>)',
      },
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'monospace'],
      },
      // Shift all font weights heavier so text is noticeably bolder everywhere
      fontWeight: {
        thin:      '300',
        light:     '400',
        normal:    '600',
        medium:    '700',
        semibold:  '800',
        bold:      '900',
        extrabold: '900',
      },
      spacing: {
        'margin-desktop': '64px',
        xs: '4px', sm: '8px', md: '16px', lg: '24px', xl: '32px',
      },
      boxShadow: {
        'neon':      '0 0 15px rgb(var(--c-primary) / 0.25)',
        'neon-lg':   '0 0 25px rgb(var(--c-primary) / 0.35)',
        'neon-text': '0 0 10px rgb(var(--c-primary) / 0.5)',
      },
    },
  },
  plugins: [],
}
export default config
