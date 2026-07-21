/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{ts,tsx}",
    "../node_modules/@nous-research/ui/dist/**/*.{js,ts,tsx}",
  ],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        // Shadcn-compat tokens mapped to Hermes CSS variables
        foreground: "var(--midground)",
        card: {
          DEFAULT: "color-mix(in srgb, var(--midground-base) 4%, var(--background-base))",
          foreground: "var(--midground)",
        },
        primary: {
          DEFAULT: "var(--midground)",
          foreground: "var(--background-base)",
        },
        secondary: {
          DEFAULT: "color-mix(in srgb, var(--midground-base) 6%, var(--background-base))",
          foreground: "var(--midground)",
        },
        muted: {
          DEFAULT: "color-mix(in srgb, var(--midground-base) 8%, var(--background-base))",
          foreground: "color-mix(in srgb, var(--midground-base) 60%, var(--background-base))",
        },
        accent: {
          DEFAULT: "color-mix(in srgb, var(--midground-base) 10%, var(--background-base))",
          foreground: "var(--midground)",
        },
        destructive: {
          DEFAULT: "#fb2c36",
          foreground: "#ffffff",
        },
        success: "#4ade80",
        warning: "#ffbd38",
        border: "color-mix(in srgb, var(--midground-base) 15%, transparent)",
        input: "color-mix(in srgb, var(--midground-base) 15%, transparent)",
        ring: "var(--midground)",
        popover: {
          DEFAULT: "color-mix(in srgb, var(--midground-base) 4%, var(--background-base))",
          foreground: "var(--midground)",
        },
        // Hermes palette tokens
        background: {
          DEFAULT: "var(--background)",
          base: "var(--background-base)",
        },
        midground: {
          DEFAULT: "var(--midground)",
          base: "var(--midground-base)",
        },
        // Data series
        "series-input": "var(--series-input-token)",
        "series-output": "var(--series-output-token)",
      },
      borderRadius: {
        sm: "calc(var(--theme-radius) - 4px)",
        md: "calc(var(--theme-radius) - 2px)",
        lg: "var(--theme-radius)",
        xl: "calc(var(--theme-radius) + 4px)",
      },
      fontFamily: {
        sans: "var(--theme-font-sans)",
        mono: "var(--theme-font-mono)",
        display: "var(--theme-font-display)",
      },
      spacing: {
        // Scaled by theme density multiplier
        0.5: "calc(0.125rem * var(--theme-spacing-mul, 1))",
        1: "calc(0.25rem * var(--theme-spacing-mul, 1))",
        1.5: "calc(0.375rem * var(--theme-spacing-mul, 1))",
        2: "calc(0.5rem * var(--theme-spacing-mul, 1))",
        2.5: "calc(0.625rem * var(--theme-spacing-mul, 1))",
        3: "calc(0.75rem * var(--theme-spacing-mul, 1))",
        3.5: "calc(0.875rem * var(--theme-spacing-mul, 1))",
        4: "calc(1rem * var(--theme-spacing-mul, 1))",
        5: "calc(1.25rem * var(--theme-spacing-mul, 1))",
        6: "calc(1.5rem * var(--theme-spacing-mul, 1))",
        7: "calc(1.75rem * var(--theme-spacing-mul, 1))",
        8: "calc(2rem * var(--theme-spacing-mul, 1))",
      },
      animation: {
        "sidebar-tooltip-in": "sidebar-tooltip-in 120ms ease-out",
        "toast-in": "toast-in 200ms ease-out",
        "toast-out": "toast-out 150ms ease-out",
        "fade-in": "fade-in 150ms ease-out",
        "dialog-in": "dialog-in 150ms ease-out",
      },
      keyframes: {
        "sidebar-tooltip-in": {
          from: { opacity: "0", transform: "translateY(-50%) translateX(-4px)" },
          to: { opacity: "1", transform: "translateY(-50%) translateX(0)" },
        },
        "toast-in": {
          from: { opacity: "0", transform: "translateX(16px)" },
          to: { opacity: "1", transform: "translateX(0)" },
        },
        "toast-out": {
          from: { opacity: "1", transform: "translateX(0)" },
          to: { opacity: "0", transform: "translateX(16px)" },
        },
        "fade-in": {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
        "dialog-in": {
          from: { opacity: "0", transform: "translateY(4px) scale(0.98)" },
          to: { opacity: "1", transform: "translateY(0) scale(1)" },
        },
      },
    },
  },
  plugins: [],
};
