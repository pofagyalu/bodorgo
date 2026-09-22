import config from '../config.js';
import logger from '../logger.js';

// api.openrouteservice.org is deprecated in favor of api.heigit.org's
// unified path structure (api.heigit.org/<service>/<version>/...) - the old
// domain is down to 10% quota since 2026-08-27 and shuts down entirely on
// 2026-09-28. Everything else (api_key param, request/response shape) is
// unchanged, per the migration announcement.
const ORS_DIRECTIONS_URL =
  'https://api.heigit.org/openrouteservice/v2/directions/driving-car';

// Hungary's official "0 km stone" (Nulla kilométerkő) at Clark Ádám tér -
// the canonical point all Hungarian road distances are measured from.
// 47°29'53"N 19°2'24"E converted to decimal degrees.
// https://geohack.toolforge.org/geohack.php?language=hu&pagename=%E2%80%9E0%E2%80%9D_kilom%C3%A9terk%C5%91&params=47_29_53_N_19_2_24_E_type:landmark
export const BUDAPEST_CENTER = { lat: 47.4981, lng: 19.04 };

// Real road/highway distance and estimated driving time, not straight-
// line - requires a routing service. One request gives both (the ORS
// directions response's segment carries distance AND duration together),
// so there's no reason to call it twice. Returns
// {distanceKm (one decimal), durationMinutes (rounded)}, or undefined if
// no API key is configured or the request fails (logged, never thrown, so
// a bad tour save/update never gets blocked by a third-party API hiccup).
// "kb. 2 óra 45 perc" / "kb. 45 perc" / "kb. 2 óra" - "kb." (approx.) since
// this is a routing estimate, not a promise, and traffic/weather/actual
// driving style all vary.
export function formatDrivingDuration(minutes) {
  if (minutes == null) return null;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours === 0) return `kb. ${mins} perc`;
  if (mins === 0) return `kb. ${hours} óra`;
  return `kb. ${hours} óra ${mins} perc`;
}

export async function computeDrivingRoute(from, to) {
  const apiKey = config.openRouteService.apiKey;
  if (!apiKey) {
    logger.warn(
      'OPENROUTESERVICE_API_KEY not set - skipping driving distance/duration computation',
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
    const segment = data?.features?.[0]?.properties?.segments?.[0];
    const meters = segment?.distance;
    const seconds = segment?.duration;
    if (typeof meters !== 'number' || typeof seconds !== 'number') {
      logger.error(
        `OpenRouteService response missing distance/duration: ${JSON.stringify(data)}`,
      );
      return undefined;
    }

    return {
      distanceKm: Math.round((meters / 1000) * 10) / 10,
      durationMinutes: Math.round(seconds / 60),
    };
  } catch (err) {
    logger.error(`Failed to compute driving route: ${err.message}`);
    return undefined;
  }
}
