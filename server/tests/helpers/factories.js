import mongoose from 'mongoose';
import User from '../../src/models/userModel.js';
import Tour from '../../src/models/tourModel.js';
import Reservation from '../../src/models/reservationModel.js';

// Small builders for valid test data - override any field as needed.

let counter = 0;
const next = () => {
  counter += 1;
  return counter;
};

export async function createUser(overrides = {}) {
  const n = next();
  return User.create({
    name: `Teszt Felhasználó ${n}`,
    email: `user${n}@test.local`,
    role: 'member',
    familyId: new mongoose.Types.ObjectId(),
    ...overrides,
  });
}

export const createAdmin = (overrides = {}) => createUser({ role: 'admin', ...overrides });
export const createMember = (overrides = {}) => createUser({ role: 'member', ...overrides });
export const createGuest = (overrides = {}) => createUser({ role: 'guest', ...overrides });

export async function createTour(overrides = {}) {
  const n = next();
  return Tour.create({
    order: 1000 + n,
    title: `Teszt tábor ${n}`,
    summary: 'Rövid leírás',
    description: 'Hosszabb leírás',
    startDate: new Date(Date.now() + 30 * 24 * 3600 * 1000),
    duration: 3,
    maxCapacity: 20,
    location: { description: 'Teszt hely', address: 'Teszt utca 1', coordinates: [19.04, 47.5] },
    ...overrides,
  });
}

// One reservation for these users on a tour (each becomes an attendee).
export async function createReservation(tour, users, overrides = {}) {
  return Reservation.create({
    tour: tour._id,
    bookedBy: users[0]._id,
    attendees: users.map((u) => ({ user: u._id, name: u.name, nights: tour.duration - 1 })),
    ...overrides,
  });
}
