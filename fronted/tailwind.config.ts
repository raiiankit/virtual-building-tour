import type { Config } from "tailwindcss";

/**
 * DESIGN SYSTEM — single source of truth.
 * All colors are CSS variables (see app/globals.css) so light/dark stay in sync.
 * Scales: color roles · typography · spacing (8pt) · radius · elevation · motion.
 */
const config: Config = {
  darkMode: "class",
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./features/**/*.{ts,tsx}",
  ],
  theme: {
    container: { center: true, padding: "1.5rem", screens: { "2xl": "1400px" } },
    extend: {
      fontFamily: {
        sans: ["var(--font-inter)", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      // typography scale
      fontSize: {
        xs: ["0.75rem", { lineHeight: "1rem" }],
        sm: ["0.8125rem", { lineHeight: "1.25rem" }],
        base: ["0.875rem", { lineHeight: "1.5rem" }],
        md: ["0.9375rem", { lineHeight: "1.5rem" }],
        lg: ["1.0625rem", { lineHeight: "1.6rem" }],
        xl: ["1.25rem", { lineHeight: "1.75rem", letterSpacing: "-0.01em" }],
        "2xl": ["1.5rem", { lineHeight: "2rem", letterSpacing: "-0.02em" }],
        "3xl": ["1.875rem", { lineHeight: "2.25rem", letterSpacing: "-0.02em" }],
        "4xl": ["2.5rem", { lineHeight: "1.1", letterSpacing: "-0.03em" }],
        "5xl": ["3.25rem", { lineHeight: "1.05", letterSpacing: "-0.03em" }],
      },
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        surface: "hsl(var(--surface))",
        "surface-2": "hsl(var(--surface-2))",
        primary: { DEFAULT: "hsl(var(--primary))", foreground: "hsl(var(--primary-foreground))" },
        secondary: { DEFAULT: "hsl(var(--secondary))", foreground: "hsl(var(--secondary-foreground))" },
        muted: { DEFAULT: "hsl(var(--muted))", foreground: "hsl(var(--muted-foreground))" },
        accent: { DEFAULT: "hsl(var(--accent))", foreground: "hsl(var(--accent-foreground))" },
        card: { DEFAULT: "hsl(var(--card))", foreground: "hsl(var(--card-foreground))" },
        popover: { DEFAULT: "hsl(var(--popover))", foreground: "hsl(var(--popover-foreground))" },
        // semantic roles
        success: { DEFAULT: "hsl(var(--success))", foreground: "hsl(var(--success-foreground))", soft: "hsl(var(--success-soft))" },
        warning: { DEFAULT: "hsl(var(--warning))", foreground: "hsl(var(--warning-foreground))", soft: "hsl(var(--warning-soft))" },
        danger: { DEFAULT: "hsl(var(--danger))", foreground: "hsl(var(--danger-foreground))", soft: "hsl(var(--danger-soft))" },
        destructive: { DEFAULT: "hsl(var(--danger))", foreground: "hsl(var(--danger-foreground))" },
        info: { DEFAULT: "hsl(var(--info))", foreground: "hsl(var(--info-foreground))", soft: "hsl(var(--info-soft))" },
      },
      // radius scale (18px default)
      borderRadius: {
        sm: "calc(var(--radius) - 8px)",
        md: "calc(var(--radius) - 4px)",
        lg: "var(--radius)",
        xl: "calc(var(--radius) + 4px)",
        "2xl": "calc(var(--radius) + 10px)",
      },
      // elevation scale (soft)
      boxShadow: {
        xs: "0 1px 2px 0 hsl(var(--shadow-color) / 0.05)",
        sm: "0 1px 2px 0 hsl(var(--shadow-color) / 0.06), 0 1px 3px 0 hsl(var(--shadow-color) / 0.05)",
        md: "0 2px 4px -2px hsl(var(--shadow-color) / 0.08), 0 8px 20px -8px hsl(var(--shadow-color) / 0.14)",
        lg: "0 8px 16px -8px hsl(var(--shadow-color) / 0.12), 0 20px 40px -16px hsl(var(--shadow-color) / 0.20)",
        xl: "0 24px 60px -24px hsl(var(--shadow-color) / 0.30)",
        glow: "0 0 0 1px hsl(var(--primary) / 0.12), 0 8px 30px -8px hsl(var(--primary) / 0.35)",
      },
      // spacing additions (8pt rhythm)
      spacing: { "18": "4.5rem", "22": "5.5rem", "112": "28rem", "128": "32rem" },
      // motion
      transitionTimingFunction: { premium: "cubic-bezier(0.16, 1, 0.3, 1)" },
      transitionDuration: { DEFAULT: "200ms" },
      keyframes: {
        "fade-in": { from: { opacity: "0" }, to: { opacity: "1" } },
        "fade-up": { from: { opacity: "0", transform: "translateY(8px)" }, to: { opacity: "1", transform: "translateY(0)" } },
        "scale-in": { from: { opacity: "0", transform: "scale(0.96)" }, to: { opacity: "1", transform: "scale(1)" } },
        shimmer: { "100%": { transform: "translateX(100%)" } },
        "accordion-down": { from: { height: "0" }, to: { height: "var(--radix-accordion-content-height)" } },
      },
      animation: {
        "fade-in": "fade-in 200ms ease",
        "fade-up": "fade-up 300ms cubic-bezier(0.16,1,0.3,1)",
        "scale-in": "scale-in 180ms cubic-bezier(0.16,1,0.3,1)",
        shimmer: "shimmer 1.6s infinite",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};

export default config;
