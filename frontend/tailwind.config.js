/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      fontFamily: {
        // ── Electric Signal UI font ─────────────────────────────────
        sans: [
          "'Inter'", "-apple-system", "BlinkMacSystemFont", "SF Pro Display",
          "Segoe UI", "Roboto", "Helvetica Neue", "Arial", "sans-serif"
        ],
        inter: ["'Inter'", "system-ui", "sans-serif"],
        brand: ["'Inter'", "system-ui", "sans-serif"],
        // ── Editorial accent font (Playfair italic) ────────────────
        editorial: ["'Playfair Display'", "Georgia", "serif"],
        serif: ["Georgia", "New York", "Times New Roman", "serif"],
        mono: ["SF Mono", "Fira Code", "Monaco", "Consolas", "monospace"],
        display: ["'Bebas Neue'", "Impact", "system-ui"],
      },
      colors: {
        brand: {
          red: "#FF3B30",
          blue: "#007AFF",
          green: "#34C759",
          orange: "#FF9500",
          purple: "#AF52DE",
          teal: "#5AC8FA",
          pink: "#FF2D55",
          indigo: "#5856D6",
        },
        // ── Electric Signal palette ────────────────────────────────
        cobalt: {
          50:  "#eff6ff",
          100: "#dbeafe",
          200: "#bfdbfe",
          300: "#93c5fd",
          400: "#60a5fa",
          500: "#3b82f6",   // primary (Electric Blue)
          600: "#2563eb",
          700: "#1d4ed8",
          800: "#1e3a8a",   // secondary / Midnight Blue
          900: "#1e2d6e",
          950: "#0f172a",
        },
        // Vivid Orange accent
        scoop: {
          orange:      "#F97316",
          "orange-50": "#fff7ed",
          "orange-100":"#ffedd5",
          "orange-400":"#fb923c",
          "orange-500":"#f97316",
          "orange-600":"#ea580c",
        },
        apple: {
          gray1: "#8E8E93",
          gray2: "#636366",
          gray3: "#48484A",
          gray4: "#3A3A3C",
          gray5: "#2C2C2E",
          gray6: "#1C1C1E",
        },
      },
      animation: {
        "fade-in": "fadeIn 0.3s ease-out",
        "slide-up": "slideUp 0.4s cubic-bezier(0.16, 1, 0.3, 1)",
        "pulse-soft": "pulseSoft 2s ease-in-out infinite",
        "shimmer": "shimmer 1.5s infinite",
        "bounce-in": "bounceIn 0.6s cubic-bezier(0.68, -0.55, 0.265, 1.55)",
      },
      keyframes: {
        fadeIn: {
          from: { opacity: 0 },
          to: { opacity: 1 },
        },
        slideUp: {
          from: { opacity: 0, transform: "translateY(20px)" },
          to: { opacity: 1, transform: "translateY(0)" },
        },
        pulseSoft: {
          "0%, 100%": { opacity: 1 },
          "50%": { opacity: 0.6 },
        },
        shimmer: {
          "0%": { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
        bounceIn: {
          from: { opacity: 0, transform: "scale(0.3)" },
          "50%": { transform: "scale(1.05)" },
          "70%": { transform: "scale(0.9)" },
          to: { opacity: 1, transform: "scale(1)" },
        },
      },
      backdropBlur: {
        xs: "2px",
      },
      // ── Motion language (Electric Signal) ───────────────────────
      transitionDuration: {
        fast:   "150ms",
        normal: "250ms",
        slow:   "400ms",
      },
      transitionTimingFunction: {
        smooth: "cubic-bezier(0.16, 1, 0.3, 1)",
        spring: "cubic-bezier(0.68, -0.55, 0.27, 1.55)",
      },
    },
  },
  plugins: [],
};
