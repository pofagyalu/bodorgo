export const environment = {
  production: true,
  // Client and server live on different subdomains in production
  // (bodorgo.hu vs api.bodorgo.hu), so this must be an absolute origin.
  apiBaseUrl: 'https://api.bodorgo.hu',
  // Base URL for static assets (tour images etc.) served by the API
  assetUrl: 'https://api.bodorgo.hu',
  // TODO: fill in your OpenWeatherMap API key (used by ForecastService)
  openWeatherApi: 'your-openweather-api-key',
};
