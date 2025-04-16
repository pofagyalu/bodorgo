/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{html,ts}"],
  theme: {
    extend: {
      colors: {
        primary: "hsl(121, 52%, 44%)",
        primaryLight: "hsl(119, 39%, 61%)",
        primaryDark: "hsl(123, 64%, 33%)",
        secondary: "	hsl(37, 100%, 45%)",
        secondaryLight: "	hsl(37, 82%, 61%)",
        secondaryDark: "	hsl(31, 100%, 43%)",

        bOrange: "hsl(16,100%,50%)",
        bBrown: "hsl(24,57%,41%)",
        bLightGreen: "hsl(106,48%,67%)",
        bDarkGreen: "hsl(156,73%,38%)",
        bBlue: "hsl(202,94%,39%)",
        bRed: "hsl(0,95%,52%)",
        bYellow: "hsl(41,84%,78%)",
      },
      fontFamily: {
        sans: ["Poppins", "sans-serif"],
        comic: ["Marhey", "sans-serif"],
        happy: ["Potland", "sans-serif"],
        rokkit: ["Rokkitt", "monospace"],
        mulish: ["Mulish", "sans-serif"],
      },
      spacing: {
        180: "32rem",
      },
      backgroundImage: {
        "hero-pattern-desktop": "url('/assets/images/bg-header-desktop.png')",
        "hero-pattern-mobile": "url('/assets/images/bg-header-mobile.png')",
        signup: "url('/assets/images/signup.jpg')",
        "gradient-105": "linear-gradient(105deg, var(--tw-gradient-stops))",
      },
    },
  },
  plugins: [],
};
