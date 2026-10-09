import type { Config } from 'tailwindcss';
import animate from 'tailwindcss-animate';

// Tokens no mesmo padrão do site Alu.GO (shadcn/ui + HSL em CSS vars).
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    container: { center: true, padding: '1rem', screens: { '2xl': '1280px' } },
    extend: {
      fontFamily: { sans: ['Montserrat', 'sans-serif'] },
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
          glow: 'hsl(var(--primary-glow))',
        },
        secondary: { DEFAULT: 'hsl(var(--secondary))', foreground: 'hsl(var(--secondary-foreground))' },
        muted: { DEFAULT: 'hsl(var(--muted))', foreground: 'hsl(var(--muted-foreground))' },
        accent: { DEFAULT: 'hsl(var(--accent))', foreground: 'hsl(var(--accent-foreground))' },
        destructive: { DEFAULT: 'hsl(var(--destructive))', foreground: 'hsl(var(--destructive-foreground))' },
        card: { DEFAULT: 'hsl(var(--card))', foreground: 'hsl(var(--card-foreground))' },
        success: { DEFAULT: 'hsl(var(--success))', foreground: 'hsl(var(--success-foreground))' },
        warning: { DEFAULT: 'hsl(var(--warning))', foreground: 'hsl(var(--warning-foreground))' },
        azul: 'hsl(var(--azul))',
        'azul-claro': 'hsl(var(--azul-claro))',
        'azul-escuro': 'hsl(var(--azul-escuro))',
        'azul-marinho': 'hsl(var(--azul-marinho))',
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      backgroundImage: {
        'gradient-primary': 'var(--gradient-primary)',
        'gradient-dark': 'var(--gradient-dark)',
      },
      boxShadow: {
        elegant: 'var(--shadow-elegant)',
        glow: 'var(--shadow-glow)',
      },
      keyframes: {
        'flash-pago': {
          '0%': { backgroundColor: 'hsl(var(--success) / 0.25)' },
          '100%': { backgroundColor: 'transparent' },
        },
        'pop': {
          '0%': { transform: 'scale(0.6)', opacity: '0' },
          '60%': { transform: 'scale(1.12)', opacity: '1' },
          '100%': { transform: 'scale(1)' },
        },
      },
      animation: {
        'flash-pago': 'flash-pago 1.8s ease-out',
        pop: 'pop 0.45s cubic-bezier(.4,0,.2,1)',
      },
    },
  },
  plugins: [animate],
} satisfies Config;
