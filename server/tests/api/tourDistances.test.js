import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { app, asUser } from '../helpers/app.js';
import { createMember, createTour } from '../helpers/factories.js';
import User from '../../src/models/userModel.js';
import Tour from '../../src/models/tourModel.js';
import TourDistance from '../../src/models/tourDistanceModel.js';
import { computeDrivingRoute } from '../../src/utils/distance.js';

// The driving route from someone's home to a tour (utils/tourDistances.js):
// worked out once and kept - asked for again only when one of the two
// places moves, not on every page view.

const HOME = { lat: 47.68, lng: 17.63 }; // Győr
const MOVED = { lat: 46.25, lng: 20.15 }; // Szeged

describe('the driving distance from home', () => {
  let member;
  let tour;
  const page = async (who = member) =>
    (await request(app).get(`/tours/${tour._id}`).set(asUser(who))).body.data.distanceInfo;

  beforeEach(async () => {
    vi.mocked(computeDrivingRoute)
      .mockReset()
      .mockResolvedValue({ distanceKm: 210.5, durationMinutes: 150 });
    member = await createMember();
    // Straight in the database: saving would look the address up again.
    await User.updateOne(
      { _id: member._id },
      { $set: { location: HOME, address: { city: 'Győr', zipCode: '9021', street: 'Fő u. 1' } } },
    );
    tour = await createTour({
      location: { type: 'Point', coordinates: [21.6, 47.95], description: 'Tokaj', address: 'x' },
      distanceFromBudapestKm: 230,
      drivingDurationFromBudapestMinutes: 160,
    });
    // Saving a tour works out its own Budapest route - not what's counted here.
    vi.mocked(computeDrivingRoute).mockClear();
  });

  it('worked out once - the next page view reads it, without asking', async () => {
    expect(await page()).toEqual({ distanceKm: 210.5, durationMinutes: 150, fromLabel: 'Győrtől' });
    expect(await page()).toEqual({ distanceKm: 210.5, durationMinutes: 150, fromLabel: 'Győrtől' });
    expect(computeDrivingRoute).toHaveBeenCalledTimes(1);
    expect(computeDrivingRoute).toHaveBeenCalledWith(HOME, { lat: 47.95, lng: 21.6 });
    expect(await TourDistance.countDocuments()).toBe(1);
  });

  it('worked out again when their home or the tour’s place moves', async () => {
    await page();
    await User.updateOne(
      { _id: member._id },
      { $set: { location: MOVED, 'address.city': 'Szeged' } },
    );
    vi.mocked(computeDrivingRoute).mockResolvedValue({ distanceKm: 250, durationMinutes: 170 });
    expect(await page()).toEqual({ distanceKm: 250, durationMinutes: 170, fromLabel: 'Szegedtől' });
    expect(computeDrivingRoute).toHaveBeenCalledTimes(2);

    await Tour.updateOne({ _id: tour._id }, { $set: { 'location.coordinates': [21.7, 48.0] } });
    await page();
    expect(computeDrivingRoute).toHaveBeenCalledTimes(3);
    expect(computeDrivingRoute).toHaveBeenLastCalledWith(MOVED, { lat: 48.0, lng: 21.7 });
    // Still one row: the old route replaced.
    expect(await TourDistance.countDocuments()).toBe(1);
  });

  it('the route service down or slow: the Budapest figures, nothing kept, asked again next time', async () => {
    vi.mocked(computeDrivingRoute).mockResolvedValue(undefined);
    const saved = await Tour.findById(tour._id);
    expect(await page()).toEqual({
      distanceKm: saved.distanceFromBudapestKm,
      durationMinutes: saved.drivingDurationFromBudapestMinutes,
      fromLabel: 'Budapesttől',
    });
    expect(await TourDistance.countDocuments()).toBe(0);
    await page();
    expect(computeDrivingRoute).toHaveBeenCalledTimes(2);
  });

  it('everyone’s own: someone else from elsewhere gets theirs', async () => {
    await page();
    const other = await createMember();
    await User.updateOne(
      { _id: other._id },
      {
        $set: { location: MOVED, address: { city: 'Szeged', zipCode: '6720', street: 'Tisza 2' } },
      },
    );
    vi.mocked(computeDrivingRoute).mockResolvedValue({ distanceKm: 250, durationMinutes: 170 });
    expect((await page(other)).fromLabel).toBe('Szegedtől');
    expect((await page()).fromLabel).toBe('Győrtől');
    expect(await TourDistance.countDocuments()).toBe(2);
  });
});
