import { describe, expect, it } from 'vitest';
import { hungarianFromSuffix } from '../../src/utils/hungarianGrammar.js';
import { formatDrivingDuration } from '../../src/utils/distance.js';
import { createTour } from '../helpers/factories.js';

describe('hungarianFromSuffix ("-tól/-től", as in "Táv Budapesttől")', () => {
  it.each([
    ['Pápa', 'Pápától'],
    ['Nyíregyháza', 'Nyíregyházától'],
    ['Vecse', 'Vecsétől'],
    ['Leányfalu', 'Leányfalutól'],
    ['Vác', 'Váctól'],
    ['Miskolc', 'Miskolctól'],
    ['Sopron', 'Soprontól'],
    ['Székesfehérvár', 'Székesfehérvártól'],
    ['Győr', 'Győrtől'],
    ['Budapest', 'Budapesttől'],
    ['Debrecen', 'Debrecentől'],
    ['Pécs', 'Pécstől'],
    ['Eger', 'Egertől'],
    ['Kecskemét', 'Kecskeméttől'],
    ['Oradea', 'Oradeától'],
    ['Kolozsvár', 'Kolozsvártól'],
  ])('%s -> %s', (place, expected) => {
    expect(hungarianFromSuffix(place)).toBe(expected);
  });
});

describe('formatDrivingDuration', () => {
  it('shows hours and minutes', () => {
    expect(formatDrivingDuration(45)).toMatch(/45/);
    expect(formatDrivingDuration(95)).toMatch(/1/);
  });
});

describe('derived per-person price (price = house rate per night / max capacity, rounded up)', () => {
  it('stays unset until a rate is given, then follows rate and capacity', async () => {
    const plain = await createTour({ price: 12345 });
    expect(plain.price).toBe(12345);

    const tour = await createTour({ accommodationPricePerNight: 3000, maxCapacity: 10 });
    expect(tour.price).toBe(300);
    tour.duration = 7; // doesn't depend on the duration
    await tour.save();
    expect(tour.price).toBe(300);
    tour.maxCapacity = 20;
    await tour.save();
    expect(tour.price).toBe(150);
    tour.accommodationPricePerNight = 3530;
    await tour.save();
    expect(tour.price).toBe(177); // 176.5 rounded up
  });
});
