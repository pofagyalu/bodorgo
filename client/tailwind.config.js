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
        cyan: "hsl(180, 66%, 49%)",
        cyanLight: "hsl(180, 66%, 69%)",
        darkViolet: "hsl(257, 27%, 26%)",
        red: "hsl(0, 87%, 67%)",
        grayishViolet: "hsl(257, 7%, 63%)",
        veryDarkBlue: "hsl(255, 11%, 22%)",
        veryDarkViolet: "hsl(260, 8%, 14%)",
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
      },
      spacing: {
        180: "32rem",
      },
      backgroundImage: {
        "hero-pattern-desktop": "url('/assets/images/bg-header-desktop.png')",
        "hero-pattern-mobile": "url('/assets/images/bg-header-mobile.png')",
      },
    },
  },
  plugins: [],
};
