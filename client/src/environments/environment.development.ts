export const environment = {
  production: false,
  // Absolute, not proxied: the server computes its OAuth redirect_uri from
  // the request's actual Host header, and a dev-server proxy would rewrite
  // that to the proxy target, breaking it. CORS on the server already
  // allows http://localhost:4200 with credentials, so calling the API
  // directly works fine without a proxy.
  apiBaseUrl: 'http://localhost:8235',
  // Tour images etc. are served statically by the same local API server
  assetUrl: 'http://localhost:8235',
  // TODO: fill in your OpenWeatherMap API key (used by ForecastService)
  openWeatherApi: 'your-openweather-api-key',
};
