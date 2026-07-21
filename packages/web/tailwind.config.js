/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        bg: {
          DEFAULT: "#0b0d10",
          surface: "#161b22",
          elevated: "#1c2330",
          input: "#0d1117",
        },
        border: {
          DEFAULT: "#30363d",
          subtle: "#21262d",
        },
        fg: {
          DEFAULT: "#e6edf3",
          muted: "#8b949e",
          subtle: "#6e7681",
        },
        accent: {
          DEFAULT: "#58a6ff",
          hover: "#79b8ff",
        },
        success: "#238636",
        warning: "#d29922",
        danger: "#da3633",
        purple: "#a371f7",
        orange: "#f0883e",
      },
      fontFamily: {
        sans: ["-apple-system", "BlinkMacSystemFont", "system-ui", "sans-serif"],
        mono: ["ui-monospace", "SF Mono", "Cascadia Mono", "Menlo", "monospace"],
      },
      animation: {
        "pulse-slow": "pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite",
        blink: "blink 0.8s steps(2) infinite",
      },
      keyframes: {
        blink: {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0" },
        },
      },
    },
  },
  plugins: [],
};
