import logger from '../logger.js';

// Free, no API key needed, two endpoints from the same provider covering
// both halves of what we need: a forecast (up to 16 days ahead - a real
// meteorological limit, not a tier restriction, so nothing further out
// than that is fetchable from any free service) and a historical archive
// of what actually happened (ERA5 reanalysis data, not just an old
// forecast) for anything already in the past.
const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const HISTORICAL_URL = 'https://archive-api.open-meteo.com/v1/archive';

export const MAX_FORECAST_DAYS_AHEAD = 16;

// Maps Open-Meteo's WMO weather codes to our own small set of normalized
// conditions, each with a matching SVG icon on the client.
function mapWeatherCode(code) {
  if (code === 0) return 'clear';
  if (code === 1 || code === 2) return 'partly-cloudy';
  if (code === 3) return 'cloudy';
  if (code === 45 || code === 48) return 'fog';
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return 'rain';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
  if (code >= 95) return 'thunderstorm';
  return 'cloudy'; // sensible fallback for any unmapped/future code
}

async function fetchDailyWeather(baseUrl, lat, lng, dateStr) {
  const url = new URL(baseUrl);
  url.searchParams.set('latitude', lat);
  url.searchParams.set('longitude', lng);
  url.searchParams.set('start_date', dateStr);
  url.searchParams.set('end_date', dateStr);
  url.searchParams.set(
    'daily',
    'weathercode,temperature_2m_max,temperature_2m_min,windspeed_10m_max',
  );
  url.searchParams.set('timezone', 'auto');

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Open-Meteo request failed: ${res.status} ${await res.text()}`);
  }

  const data = await res.json();
  const daily = data.daily;
  if (!daily?.time?.length) {
    return null;
  }

  return {
    condition: mapWeatherCode(daily.weathercode[0]),
    tempDayC: Math.round(daily.temperature_2m_max[0]),
    tempNightC: Math.round(daily.temperature_2m_min[0]),
    windSpeedKmh: Math.round(daily.windspeed_10m_max[0]),
  };
}

export async function fetchForecast(lat, lng, dateStr) {
  try {
    return await fetchDailyWeather(FORECAST_URL, lat, lng, dateStr);
  } catch (err) {
    logger.error(`Weather forecast fetch failed for ${dateStr}: ${err.message}`);
    return null;
  }
}

export async function fetchHistorical(lat, lng, dateStr) {
  try {
    return await fetchDailyWeather(HISTORICAL_URL, lat, lng, dateStr);
  } catch (err) {
    logger.error(`Historical weather fetch failed for ${dateStr}: ${err.message}`);
    return null;
  }
}
