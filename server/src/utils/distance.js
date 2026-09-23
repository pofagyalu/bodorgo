import config from '../config.js';
import logger from '../logger.js';
import { hungarianFromSuffix } from './hungarianGrammar.js';

// api.openrouteservice.org is deprecated in favor of api.heigit.org's
// unified path structure (api.heigit.org/<service>/<version>/...) - the old
// domain is down to 10% quota since 2026-08-27 and shuts down entirely on
// 2026-09-28. Everything else (api_key param, request/response shape) is
// unchanged, per the migration announcement.
const ORS_DIRECTIONS_URL =
  'https://api.heigit.org/openrouteservice/v2/directions/driving-car';

// Same api.openrouteservice.org -> api.heigit.org migration as the
// directions endpoint above, but geocoding moved under its own "pelias"
// service name rather than "openrouteservice" (it's a hosted Pelias
// instance, not ORS's own routing engine) - per HeiGIT's migration
// announcement's endpoint mapping table. Standard Pelias query params
// (text/api_key/boundary.country/focus.point.*) are otherwise unchanged.
const ORS_GEOCODE_URL = 'https://api.heigit.org/pelias/v1/search';

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

// Turns a free-text address into {lat, lng} via Pelias forward geocoding -
// used for a user's own home address (see userModel.js's pre('save')
// hook). Same "logged, never thrown" resilience as computeDrivingRoute
// above - a bad/unresolvable address just leaves the user's location
// unset (falls back to Budapest for distance purposes) rather than
// blocking their profile save.
//
// Biases toward Budapest (focus.point, a ranking preference, not a
// filter) rather than hard-restricting to Hungary via boundary.country -
// most members are Hungarian, so this helps disambiguate an ambiguous
// town name without ever excluding a real address elsewhere (e.g. a
// Romanian friend's). boundary.country would need a reliable free-text
// country name -> ISO code mapping to use safely, which isn't worth the
// fragility for what focus.point already mostly achieves.
export async function geocodeAddress(text) {
  const apiKey = config.openRouteService.apiKey;
  if (!apiKey) {
    logger.warn('OPENROUTESERVICE_API_KEY not set - skipping geocoding');
    return undefined;
  }
  if (!text?.trim()) return undefined;

  try {
    const url = new URL(ORS_GEOCODE_URL);
    url.searchParams.set('api_key', apiKey);
    url.searchParams.set('text', text);
    url.searchParams.set('focus.point.lat', String(BUDAPEST_CENTER.lat));
    url.searchParams.set('focus.point.lon', String(BUDAPEST_CENTER.lng));
    url.searchParams.set('size', '1');

    const res = await fetch(url);
    if (!res.ok) {
      logger.error(`OpenRouteService geocoding request failed: ${res.status} ${await res.text()}`);
      return undefined;
    }

    const data = await res.json();
    const coords = data?.features?.[0]?.geometry?.coordinates; // GeoJSON order: [lng, lat]
    if (!Array.isArray(coords) || coords.length !== 2) {
      logger.error(`OpenRouteService geocoding response had no match for "${text}": ${JSON.stringify(data)}`);
      return undefined;
    }

    return { lat: coords[1], lng: coords[0] };
  } catch (err) {
    logger.error(`Failed to geocode address "${text}": ${err.message}`);
    return undefined;
  }
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

// What every distance-showing surface (tour details page, Programfüzet
// PDF) actually needs: real distance/duration plus the correctly-
// suffixed Hungarian "from X" label - personalized to the given viewer's
// own geocoded home address when they have one (see userModel.js's
// location field), falling back to the tour's own cached Budapest-based
// figures (computed once at tour save time - see tourModel.js) for an
// anonymous visitor or a member who hasn't set an address yet. Computed
// live, not cached, since (unlike the Budapest figures) it depends on
// who's asking, not just the tour.
export async function resolveDistanceInfo(tour, viewer) {
  const fallback = {
    distanceKm: tour.distanceFromBudapestKm ?? null,
    durationMinutes: tour.drivingDurationFromBudapestMinutes ?? null,
    fromLabel: hungarianFromSuffix('Budapest'),
  };

  if (
    viewer?.location?.lat == null ||
    viewer?.location?.lng == null ||
    !viewer?.address?.city ||
    tour.location?.coordinates?.length !== 2
  ) {
    return fallback;
  }

  const route = await computeDrivingRoute(viewer.location, {
    lat: tour.location.coordinates[1],
    lng: tour.location.coordinates[0],
  });
  if (!route) return fallback;

  return {
    distanceKm: route.distanceKm,
    durationMinutes: route.durationMinutes,
    fromLabel: hungarianFromSuffix(viewer.address.city),
  };
}
