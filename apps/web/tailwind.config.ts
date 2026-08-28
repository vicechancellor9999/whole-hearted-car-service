import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: [
    "./src/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        page: "var(--wh-background)",
        shell: "var(--wh-shell)",
        card: "var(--wh-layer-1)",
        "layer-2": "var(--wh-layer-2)",
        "layer-3": "var(--wh-layer-3)",
        accent: {
          DEFAULT: "var(--wh-accent)",
          solid: "var(--wh-accent-solid)",
          foreground: "var(--wh-accent-on-solid)",
        },
        primary: {
          DEFAULT: "#3d6fae",
          50: "#eef4fb",
          100: "#dce8f6",
          200: "#bcd3ea",
          300: "#90b5d8",
          400: "#6294c2",
          500: "#3d6fae",
          600: "#2f5a92",
          700: "#274a78",
          800: "#1f3b5f",
          900: "#162b46",
        },
        line: "var(--wh-border-subtle)",
        "line-strong": "var(--wh-border-strong)",
        surface: "var(--wh-layer-2)",
        ink: {
          DEFAULT: "var(--wh-text)",
          soft: "var(--wh-text-soft)",
          faint: "var(--wh-text-faint)",
        },
        success: "#10b981",
        warning: "#f59e0b",
        danger: "#ef4444",
        state: {
          "success-subtle": "var(--wh-success-subtle)",
          "success-border": "var(--wh-success-border)",
          "success-text": "var(--wh-success-text)",
          "warning-subtle": "var(--wh-warning-subtle)",
          "warning-border": "var(--wh-warning-border)",
          "warning-text": "var(--wh-warning-text)",
          "danger-subtle": "var(--wh-danger-subtle)",
          "danger-border": "var(--wh-danger-border)",
          "danger-text": "var(--wh-danger-text)",
          "info-subtle": "var(--wh-info-subtle)",
          "info-border": "var(--wh-info-border)",
          "info-text": "var(--wh-info-text)",
        },
        purple: {
          500: "#7a5af8",
          50: "#f4f0ff",
        },
        amber: {
          500: "#f59e0b",
          50: "#fffbeb",
        },
        emerald: {
          500: "#10b981",
          50: "#ecfdf5",
        },
        rose: {
          500: "#ef4444",
          50: "#fef2f2",
        },
      },
      boxShadow: {
        card: "0 1px 3px rgba(0,0,0,0.05), 0 1px 2px rgba(0,0,0,0.03)",
        "card-hover": "0 8px 20px rgba(0,0,0,0.06), 0 2px 6px rgba(0,0,0,0.03)",
        "card-lift": "0 10px 24px rgba(70,95,255,0.08), 0 4px 10px rgba(0,0,0,0.04)",
      },
      borderRadius: {
        xl: "10px",
      },
    },
  },
  plugins: [],
};

export default config;
