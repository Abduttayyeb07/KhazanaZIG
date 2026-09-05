/** @type {import('tailwindcss').Config} */
module.exports = {
  content: { relative: true, files: ["./src/**/*.{ts,tsx}"] },
  theme: {
    extend: {
      fontFamily: {
        mono: ["ui-monospace", "SFMono-Regular", "monospace"],
        sans: ["DM Sans", "ui-sans-serif", "system-ui", "sans-serif"],
      },
      colors: {
        ink: "#EEF3FB",
        secondary: "#BDCADC",
        muted: "#97A9C2",
        cyan: "#58D8E8",
        canvas: "#0A1120",
        panel: "#111D30",
        raised: "#18263B",
        line: "#29394E",
        accent: {
          DEFAULT: "#F4BE62",
          soft: "#FFD697",
        },
        pos: "#59DDB0",
        neg: "#FF8B91",
        warn: "#F4BE62",
      },
      fontSize: {
        "2xs": ["12px", "18px"],
      },
      boxShadow: {
        card: "0 2px 8px rgba(25,45,35,0.025)",
      },
      animation: {
        "pulse-slow": "pulse 2.6s cubic-bezier(0.4, 0, 0.6, 1) infinite",
      },
    },
  },
  plugins: [],
};
