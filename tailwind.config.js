/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        display: ['"Exo 2"', 'Inter', 'system-ui', 'sans-serif'],
        title: ['Orbitron', '"Exo 2"', 'system-ui', 'sans-serif'],
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      colors: {
        ink: '#0b0d14',
        cyan: { glow: '#38d8ff' },
        neon: '#ff3fb0',
      },
      keyframes: {
        pop: {
          '0%': { transform: 'scale(1.6)', opacity: '0' },
          '60%': { transform: 'scale(0.95)', opacity: '1' },
          '100%': { transform: 'scale(1)', opacity: '1' },
        },
        callout: {
          '0%': { transform: 'translate(-50%, -50%) scale(1.5)', opacity: '0' },
          '15%': { transform: 'translate(-50%, -50%) scale(1)', opacity: '1' },
          '75%': { opacity: '1' },
          '100%': { transform: 'translate(-50%, -60%) scale(0.95)', opacity: '0' },
        },
        rise: {
          '0%': { transform: 'translateY(8px)', opacity: '0' },
          '15%': { transform: 'translateY(0)', opacity: '1' },
          '80%': { opacity: '1' },
          '100%': { transform: 'translateY(-14px)', opacity: '0' },
        },
        fadeup: {
          '0%': { transform: 'translateY(12px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
      },
      animation: {
        pop: 'pop 0.45s ease-out',
        callout: 'callout 1.4s ease-out forwards',
        rise: 'rise 1.6s ease-out forwards',
        fadeup: 'fadeup 0.5s ease-out both',
      },
    },
  },
  plugins: [],
};
