import config from '../config.js';
import logger from '../logger.js';

// api.openrouteservice.org is deprecated in favor of api.heigit.org's
// unified path structure (api.heigit.org/<service>/<version>/...) - the old
// domain is down to 10% quota since 2026-08-27 and shuts down entirely on
// 2026-09-28. Everything else (api_key param, request/response shape) is
// unchanged, per the migration announcement.
const ORS_DIRECTIONS_URL =
  'https://api.heigit.org/openrouteservice/v2/directions/driving-car';

// Deák Ferenc tér - an unambiguous, well-known reference point for
// "Budapest city center" (Basilica/Astoria area, metro interchange).
export const BUDAPEST_CENTER = { lat: 47.4979, lng: 19.0537 };

// Real road/highway distance, not straight-line - requires a routing
// service. Returns kilometers (one decimal), or undefined if no API key is
// configured or the request fails (logged, never thrown, so a bad tour
// save/update never gets blocked by a third-party API hiccup).
export async function computeDrivingDistanceKm(from, to) {
  const apiKey = config.openRouteService.apiKey;
  if (!apiKey) {
    logger.warn(
      'OPENROUTESERVICE_API_KEY not set - skipping driving distance computation',
    );
    return undefined;
  }

  try {
    const url = new URL(ORS_DIRECTIONS_URL);
    url.searchParams.set('api_key', apiKey);
    url.searchParams.set('start', `${from.lng},${from.lat}`);
    url.searchParams.set('end', `${to.lng},${to.lat}`);

    const res = await fetch(url);
    if (!res.ok) {
      logger.error(
        `OpenRouteService request failed: ${res.status} ${await res.text()}`,
      );
      return undefined;
    }

    const data = await res.json();
    const meters = data?.features?.[0]?.properties?.segments?.[0]?.distance;
    if (typeof meters !== 'number') {
      logger.error(
        `OpenRouteService response missing distance: ${JSON.stringify(data)}`,
      );
      return undefined;
    }

    return Math.round((meters / 1000) * 10) / 10;
  } catch (err) {
    logger.error(`Failed to compute driving distance: ${err.message}`);
    return undefined;
  }
}
