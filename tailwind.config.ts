import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
    // booking-status.ts などステータス系の集約クラス文字列を purge から守るため lib も走査対象に含める
    "./src/lib/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-noto-sans-jp)", "-apple-system", "BlinkMacSystemFont", "Hiragino Sans", "Hiragino Kaku Gothic ProN", "Meiryo", "Yu Gothic", "sans-serif"],
      },
      colors: {
        primary: "var(--primary)",
        "primary-dark": "var(--primary-dark)",
        accent: "var(--accent)",
        background: "var(--background)",
        foreground: "var(--foreground)",
      },
      fontSize: {
        micro: ["0.625rem", { lineHeight: "0.875rem" }],
        tiny: ["0.6875rem", { lineHeight: "1rem" }],
      },
      boxShadow: {
        sticky: "0 -4px 20px rgba(0,0,0,0.1)",
      },
    },
  },
  plugins: [],
};
export default config;
