/** @type {import('tailwindcss').Config} */
// HoldFast "trust / fintech" theme: warm paper background, deep pine accent, serif display type.
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "Roboto", "sans-serif"],
        serif: ["Fraunces", "ui-serif", "Georgia", "Cambria", "serif"],
        mono: ["JetBrains Mono", "ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      colors: {
        // Page + surfaces
        paper: { DEFAULT: "#F6F4EE", 2: "#EFECE3" },
        // Text / neutrals (warm)
        ink: {
          50: "#F7F6F2",
          100: "#ECEAE3",
          200: "#DDD9CE",
          300: "#C4BFB1",
          400: "#9A9585",
          500: "#736F62",
          600: "#57544A",
          700: "#3D3B34",
          800: "#26251F",
          900: "#161613",
        },
        // Brand accent: pine green (kept under the old `accent` key so existing classes still work)
        accent: {
          50: "#ECF5F1",
          100: "#D3E9DF",
          200: "#A9D2C0",
          300: "#76B59C",
          400: "#3F8F73",
          500: "#1F7458",
          600: "#125E47",
          700: "#0E4B39",
          800: "#0B3A2D",
          900: "#082A21",
        },
        gold: { 50: "#FBF5E6", 100: "#F4E6BF", 500: "#B8892B", 600: "#96701F", 700: "#755616" },
      },
      boxShadow: {
        soft: "0 1px 2px rgba(22,22,19,0.04), 0 4px 16px -4px rgba(22,22,19,0.06)",
        lift: "0 2px 4px rgba(22,22,19,0.05), 0 12px 32px -8px rgba(22,22,19,0.12)",
      },
      keyframes: {
        "fade-up": { "0%": { opacity: "0", transform: "translateY(6px)" }, "100%": { opacity: "1", transform: "none" } },
      },
      animation: { "fade-up": "fade-up 320ms cubic-bezier(0.22, 1, 0.36, 1) both" },
    },
  },
  plugins: [],
};
