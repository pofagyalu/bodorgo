import { afterEach, describe, expect, it, vi } from 'vitest';
import { classifyDay } from '../../src/utils/weather.js';
import { toDateStr } from '../../src/controllers/tourController.js';

// Real days from the Open-Meteo archive (tour locations), which the old
// code-only mapping got wrong.
const h = (hours) => hours * 3600;

describe('classifyDay', () => {
  it('a sunny day with one overcast hour is clear, not "cloudy"', () => {
    // Mohács, 2022-06-24: code 3 (overcast), 14.4 of 15.7 h sunshine, dry.
    expect(classifyDay({ code: 3, sunshineS: h(14.4), daylightS: h(15.7), precipitationMm: 0 })).toBe('clear');
    // Aggtelek, 2023-05-01: code 3, 13.8 of 14.5 h sunshine.
    expect(classifyDay({ code: 3, sunshineS: h(13.8), daylightS: h(14.5), precipitationMm: 0 })).toBe('clear');
  });

  it('a sunny day with a short shower is partly cloudy, not "rain"', () => {
    // Mohács, 2022-06-25: code 61, 14.8 of 15.7 h sunshine, 2.2 mm.
    expect(classifyDay({ code: 61, sunshineS: h(14.8), daylightS: h(15.7), precipitationMm: 2.2 })).toBe('partly-cloudy');
    // A few drops of drizzle on a sunny day don't count at all.
    expect(classifyDay({ code: 51, sunshineS: h(14.9), daylightS: h(15.7), precipitationMm: 0.1 })).toBe('clear');
  });

  it('real rain is rain; a grey day with a smaller shower too', () => {
    // Csöde, 2023-10-21: 3.0 of 10.6 h sunshine, 4.7 mm.
    expect(classifyDay({ code: 63, sunshineS: h(3), daylightS: h(10.6), precipitationMm: 4.7 })).toBe('rain');
    expect(classifyDay({ code: 61, sunshineS: h(9), daylightS: h(12), precipitationMm: 3 })).toBe('rain');
    // Aggtelek, 2023-04-29: 3.7 of 14.4 h sunshine, 1.6 mm.
    expect(classifyDay({ code: 51, sunshineS: h(3.7), daylightS: h(14.4), precipitationMm: 1.6 })).toBe('rain');
  });

  it('by the share of sunshine: partly cloudy and cloudy', () => {
    expect(classifyDay({ code: 3, sunshineS: h(9.7), daylightS: h(15.7), precipitationMm: 0 })).toBe('partly-cloudy');
    // Baksi, 2022-09-25: 3.8 of 12.0 h sunshine, dry.
    expect(classifyDay({ code: 3, sunshineS: h(3.8), daylightS: h(12), precipitationMm: 0 })).toBe('cloudy');
  });

  it('trusts the code for thunder, and uses it for fog on a grey day', () => {
    expect(classifyDay({ code: 95, sunshineS: h(12), daylightS: h(15), precipitationMm: 0.5 })).toBe('thunderstorm');
    expect(classifyDay({ code: 45, sunshineS: h(1), daylightS: h(10), precipitationMm: 0 })).toBe('fog');
    expect(classifyDay({ code: 45, sunshineS: h(9), daylightS: h(10), precipitationMm: 0 })).toBe('clear');
  });

  it('snow by the amount of snowfall', () => {
    expect(classifyDay({ code: 73, sunshineS: h(1), daylightS: h(9), precipitationMm: 2, snowfallCm: 3 })).toBe('snow');
  });

  it('falls back to the code when there is no sunshine figure', () => {
    expect(classifyDay({ code: 0 })).toBe('clear');
    expect(classifyDay({ code: 2 })).toBe('partly-cloudy');
    expect(classifyDay({ code: 3 })).toBe('cloudy');
  });
});

describe('toDateStr (Hungarian time, like the production server)', () => {
  it('gives the local calendar day, not the day before', () => {
    expect(toDateStr(new Date(2022, 5, 24))).toBe('2022-06-24'); // local midnight
    expect(toDateStr(new Date(2022, 0, 1))).toBe('2022-01-01');
  });
});

describe('fetching from Open-Meteo', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('asks for the sunshine/rain figures and classifies the day from them', async () => {
    const { fetchForecast, fetchHistorical } = await vi.importActual('../../src/utils/weather.js');
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        daily: {
          time: ['2022-06-24'],
          weathercode: [3],
          temperature_2m_max: [27.6],
          temperature_2m_min: [14.2],
          windspeed_10m_max: [11.4],
          sunshine_duration: [h(14.4)],
          daylight_duration: [h(15.7)],
          precipitation_sum: [0],
          snowfall_sum: [0],
        },
      }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const day = await fetchHistorical(46, 18.7, '2022-06-24');
    expect(day).toEqual({ condition: 'clear', tempDayC: 28, tempNightC: 14, windSpeedKmh: 11 });
    const url = new URL(fetchMock.mock.calls[0][0]);
    expect(url.hostname).toBe('archive-api.open-meteo.com');
    expect(url.searchParams.get('start_date')).toBe('2022-06-24');
    expect(url.searchParams.get('daily')).toContain('sunshine_duration');

    await fetchForecast(46, 18.7, '2026-10-01');
    expect(new URL(fetchMock.mock.calls[1][0]).hostname).toBe('api.open-meteo.com');
  });

  it('returns null on an error or an empty answer, never throws', async () => {
    const { fetchForecast, fetchHistorical } = await vi.importActual('../../src/utils/weather.js');
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500, text: async () => 'down' })));
    expect(await fetchHistorical(46, 18, '2022-01-01')).toBeNull();
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ daily: { time: [] } }) })));
    expect(await fetchForecast(46, 18, '2022-01-01')).toBeNull();
  });
});
