/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Driven by CSS variables (see globals.css) so the active theme
        // recolours the entire app. Channel format enables /opacity modifiers.
        ink: "rgb(var(--c-ink) / <alpha-value>)",
        void: "rgb(var(--c-void) / <alpha-value>)",
        plasma: "rgb(var(--c-plasma) / <alpha-value>)",
        cyan: "rgb(var(--c-cyan) / <alpha-value>)",
        violet: "rgb(var(--c-violet) / <alpha-value>)",
        lime: "rgb(var(--c-lime) / <alpha-value>)",
        amber: "rgb(var(--c-amber) / <alpha-value>)",
        glass: "rgba(255,255,255,0.04)",
        glassStroke: "rgba(255,255,255,0.08)",
      },
      fontFamily: {
        display: [
          "Space Grotesk",
          "Inter",
          "system-ui",
          "Segoe UI",
          "sans-serif",
        ],
        mono: ["JetBrains Mono", "Consolas", "ui-monospace", "monospace"],
      },
      boxShadow: {
        neon: "0 0 24px rgba(34,232,255,0.35), 0 0 64px rgba(122,59,255,0.25)",
        plasma: "0 0 28px rgba(255,43,214,0.45)",
        innerGlass:
          "inset 0 1px 0 rgba(255,255,255,0.08), inset 0 0 0 1px rgba(255,255,255,0.04)",
      },
      backgroundImage: {
        gridFade:
          "linear-gradient(180deg, rgba(255,255,255,0.04), rgba(0,0,0,0)) , radial-gradient(1200px 600px at 20% -10%, rgba(122,59,255,0.18), transparent 60%), radial-gradient(900px 500px at 100% 0%, rgba(34,232,255,0.12), transparent 60%)",
        neonGradient:
          "linear-gradient(120deg, #22e8ff 0%, #7a3bff 45%, #ff2bd6 100%)",
      },
      keyframes: {
        floaty: {
          "0%,100%": { transform: "translateY(0px)" },
          "50%": { transform: "translateY(-6px)" },
        },
        scan: {
          "0%": { backgroundPositionY: "0%" },
          "100%": { backgroundPositionY: "200%" },
        },
        shimmer: {
          "0%": { transform: "translateX(-100%)" },
          "100%": { transform: "translateX(100%)" },
        },
      },
      animation: {
        floaty: "floaty 6s ease-in-out infinite",
        scan: "scan 8s linear infinite",
        shimmer: "shimmer 2.5s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};
