import logger from '../logger.js';

// Free, no API key needed, two endpoints from the same provider covering
// both halves of what we need: a forecast (16 days counting today, so up
// to 15 days ahead - a real meteorological limit, not a tier restriction,
// so nothing further out than that is fetchable from any free service -
// asking for the 16th day ahead is refused) and a historical archive
// of what actually happened (ERA5 reanalysis data, not just an old
// forecast) for anything already in the past.
const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const HISTORICAL_URL = 'https://archive-api.open-meteo.com/v1/archive';

export const MAX_FORECAST_DAYS_AHEAD = 15;
// A day's forecast is asked for again at most this often (see
// tourController.js's refreshTourWeather).
export const WEATHER_REFETCH_HOURS = 6;

// Thresholds for classifyDay below.
const RAIN_MM = 3; // this much rain in a day is a rainy day, however sunny
const SHOWER_MM = 1; // a smaller shower only counts on a mostly grey day
const SNOW_CM = 0.5;
const CLEAR_SUNSHINE = 0.75; // share of the daylight hours with sunshine
const PARTLY_SUNSHINE = 0.4;

// Our own small set of conditions (each with a matching SVG icon on the
// client) for a whole day - decided from what actually happened over the
// day, NOT from Open-Meteo's daily weather code alone: that code is "the
// most severe weather of the day", so one overcast hour (even at night)
// made an otherwise sunny day "cloudy", and a few drops of drizzle made it
// "rain" (which is why past tours looked far greyer than their photos).
// The code is still trusted for the rare, unmistakable cases: thunder,
// snow and fog.
//
// sunshineS/daylightS in seconds, precipitationMm/snowfallCm as daily sums.
export function classifyDay({ code, sunshineS, daylightS, precipitationMm, snowfallCm }) {
  if (code >= 95) return 'thunderstorm';

  const precip = precipitationMm ?? 0;
  const sunShare = daylightS > 0 && sunshineS != null ? sunshineS / daylightS : null;

  if ((snowfallCm ?? 0) >= SNOW_CM) return 'snow';
  if (
    precip >= RAIN_MM ||
    (precip >= SHOWER_MM && sunShare != null && sunShare < PARTLY_SUNSHINE)
  ) {
    return 'rain';
  }

  // No sunshine figure at all (shouldn't happen) - fall back to the code.
  if (sunShare == null) {
    if (code === 0) return 'clear';
    if (code === 1 || code === 2) return 'partly-cloudy';
    return 'cloudy';
  }

  if (sunShare >= CLEAR_SUNSHINE) return precip >= SHOWER_MM ? 'partly-cloudy' : 'clear';
  if (sunShare >= PARTLY_SUNSHINE) return 'partly-cloudy';
  if (code === 45 || code === 48) return 'fog';
  return 'cloudy';
}

// The chance of rain only exists in a forecast - the archive records what
// fell, and refuses the request outright if asked for it.
const FORECAST_ONLY = ',precipitation_probability_max';
// How much fell and for how many hours - kept of what happened only (a
// day's `condition` forgives a light shower on a sunny day, see
// classifyDay; the beszámoló's data says it rained all the same).
const RECORDED_ONLY = ',precipitation_hours';

async function fetchDailyWeather(baseUrl, lat, lng, dateStr, extraDaily = '') {
  const url = new URL(baseUrl);
  url.searchParams.set('latitude', lat);
  url.searchParams.set('longitude', lng);
  url.searchParams.set('start_date', dateStr);
  url.searchParams.set('end_date', dateStr);
  url.searchParams.set(
    'daily',
    'weathercode,temperature_2m_max,temperature_2m_min,windspeed_10m_max,' +
      'sunshine_duration,daylight_duration,precipitation_sum,snowfall_sum' +
      extraDaily,
  );
  url.searchParams.set('timezone', 'auto');

  const res = await fetch(url);
  if (!res.ok) {
    const err = new Error(`Open-Meteo request failed: ${res.status} ${await res.text()}`);
    err.status = res.status;
    throw err;
  }

  const data = await res.json();
  const daily = data.daily;
  if (!daily?.time?.length) {
    return null;
  }

  return {
    condition: classifyDay({
      code: daily.weathercode[0],
      sunshineS: daily.sunshine_duration?.[0],
      daylightS: daily.daylight_duration?.[0],
      precipitationMm: daily.precipitation_sum?.[0],
      snowfallCm: daily.snowfall_sum?.[0],
    }),
    tempDayC: Math.round(daily.temperature_2m_max[0]),
    tempNightC: Math.round(daily.temperature_2m_min[0]),
    windSpeedKmh: Math.round(daily.windspeed_10m_max[0]),
    // 0-100, forecast only (see FORECAST_ONLY) - null in the last days of
    // the 15, where the provider has no figure yet.
    ...(extraDaily === FORECAST_ONLY && {
      rainChance: daily.precipitation_probability_max?.[0] ?? null,
    }),
    ...(extraDaily === RECORDED_ONLY && {
      precipitationMm: Math.round((daily.precipitation_sum?.[0] ?? 0) * 10) / 10,
      precipitationHours: Math.round(daily.precipitation_hours?.[0] ?? 0),
    }),
  };
}

// Open-Meteo busy or out of reach (429, 5xx, no answer at all): it passes
// by itself, and the next page view asks again - a warning, not an error
// (errors are e-mailed to the role manager, see errorMail.js). A refused
// request (another 4xx) is our mistake: an error.
export const isPassingFailure = (err) =>
  err.status == null || err.status === 429 || err.status >= 500;

function logFailure(what, dateStr, err) {
  const message = `${what} fetch failed for ${dateStr}: ${err.message}`;
  if (isPassingFailure(err)) logger.warn(message);
  else logger.error(message);
}

export async function fetchForecast(lat, lng, dateStr) {
  try {
    return await fetchDailyWeather(FORECAST_URL, lat, lng, dateStr, FORECAST_ONLY);
  } catch (err) {
    logFailure('Weather forecast', dateStr, err);
    return null;
  }
}

export async function fetchHistorical(lat, lng, dateStr) {
  try {
    return await fetchDailyWeather(HISTORICAL_URL, lat, lng, dateStr, RECORDED_ONLY);
  } catch (err) {
    logFailure('Historical weather', dateStr, err);
    return null;
  }
}
