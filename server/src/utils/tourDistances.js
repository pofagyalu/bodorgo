import TourDistance from '../models/tourDistanceModel.js';
import logger from '../logger.js';
import { computeDrivingRoute } from './distance.js';
import { hungarianFromSuffix } from './hungarianGrammar.js';

// What every distance-showing surface (tour details page, Programfüzet
// PDF, a tour's letter) needs: real distance/duration plus the correctly-
// suffixed Hungarian "from X" label - from the viewer's own geocoded home
// address when they have one (see userModel.js's location field), falling
// back to the tour's own Budapest-based figures (computed once at tour save
// time - see tourModel.js) for a member who hasn't set an address yet.
//
// The route from their home is worked out once and kept (TourDistance): it
// only changes when their home or the tour's place does - then it's worked
// out again. Not on every page view: that was a request to OpenRouteService
// each time, and the slowest part of the tour's page. The route service
// down or slow: the Budapest figures, nothing kept, asked again next time.
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

  const from = { lat: viewer.location.lat, lng: viewer.location.lng };
  const to = { lat: tour.location.coordinates[1], lng: tour.location.coordinates[0] };
  const label = hungarianFromSuffix(viewer.address.city);

  const kept = viewer._id
    ? await TourDistance.findOne({ user: viewer._id, tour: tour._id }).lean()
    : null;
  if (kept && samePlace(kept.from, from) && samePlace(kept.to, to)) {
    return { distanceKm: kept.distanceKm, durationMinutes: kept.durationMinutes, fromLabel: label };
  }

  const route = await computeDrivingRoute(from, to);
  if (!route) return fallback;

  if (viewer._id) {
    await TourDistance.updateOne(
      { user: viewer._id, tour: tour._id },
      { $set: { from, to, ...route, computedAt: new Date() } },
      { upsert: true },
    ).catch((err) => logger.warn(`Driving route not kept: ${err.message}`));
  }
  return { distanceKm: route.distanceKm, durationMinutes: route.durationMinutes, fromLabel: label };
}

// The same place - a geocoded address comes back the same to the digit.
const samePlace = (a, b) =>
  a != null && Math.abs(a.lat - b.lat) < 1e-6 && Math.abs(a.lng - b.lng) < 1e-6;
