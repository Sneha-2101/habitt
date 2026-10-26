import type { Config } from "tailwindcss";

// Tokens sourced from Design.md — keep this file in sync with that doc.
const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        paper: "#F6F4F1", // warm ivory / natural cream base background
        card: "#EDE7DB", // distinct product card background so tiles pop off the page
        ink: "#1D1B18",
        moss: "#545A3E",
        clay: "#A8492F",
        stone: "#DAD3C4",
        "stone-dark": "#B7AF9C",
        navy: "#072654", // Razorpay-adjacent pay button
        brand: "#CA3232", // logo wordmark accent red
      },
      fontFamily: {
        display: ["var(--font-fraunces)", "serif"],
        body: ["var(--font-inter)", "sans-serif"],
        mono: ["var(--font-jbmono)", "monospace"],
      },
      borderRadius: {
        none: "0px", // deliberate: sharp edges throughout, see Design.md
      },
    },
  },
  plugins: [],
};

export default config;
