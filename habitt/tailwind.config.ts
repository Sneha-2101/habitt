import type { Config } from "tailwindcss";

// Tokens sourced from Design.md — keep this file in sync with that doc.
const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        paper: "#F5F2EC",
        card: "#FBF9F5",
        ink: "#1D1B18",
        moss: "#545A3E",
        clay: "#A8492F",
        stone: "#DAD3C4",
        "stone-dark": "#B7AF9C",
        navy: "#072654", // Razorpay-adjacent pay button
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
