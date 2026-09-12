// jsdom (used by the Vitest-based test runner) doesn't implement the
// Geolocation API. Stub it as a no-op so ForecastService's
// getCurrentPosition() call doesn't throw during component construction.
Object.defineProperty(window.navigator, 'geolocation', {
  value: {
    getCurrentPosition: () => {},
  },
  writable: true,
});
