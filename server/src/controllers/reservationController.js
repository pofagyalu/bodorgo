import Tour from '../models/tourModel.js';
import Reservation from '../models/reservationModel.js';
import User from '../models/userModel.js';
import AppError from '../utils/appError.js';
import { computeAge } from './userController.js';

// The club didn't exist before this date, so it can't have contributed
// money toward a tour's accommodation before it either - see
// computeAttendeePayments below. Guarded here (not just disabled in the
// tour-edit form) so a stale/manually-set clubSubsidyAmount on an old
// tour can never actually get applied.
const CLUB_FOUNDING_DATE = new Date('2019-01-01T00:00:00.000Z');

// Who a given caller is allowed to register depends on their role:
// - guest: only themselves.
// - member: themselves and anyone sharing their familyId (see
//   userModel.js) - a member can book for their whole family in one go.
// - admin: anyone at all (registering people on their behalf, e.g. from
//   phone/in-person sign-ups).
// Throws if any requested id falls outside what the caller is allowed to
// pick - never trusts the client beyond what this check allows, same
// principle as the old self-only version this replaces.
async function assertCanRegister(user, attendeeIds) {
  if (user.role === 'admin') return;

  if (user.role === 'guest') {
    if (attendeeIds.length !== 1 || attendeeIds[0] !== user._id.toString()) {
      throw new AppError('Vendégként csak saját magadat jelentkeztetheted.', 403);
    }
    return;
  }

  // member
  const allowedIds = new Set([user._id.toString()]);
  if (user.familyId) {
    const familyMembers = await User.find({ familyId: user.familyId }).select('_id');
    familyMembers.forEach((m) => allowedIds.add(m._id.toString()));
  }
  const disallowed = attendeeIds.filter((id) => !allowedIds.has(id));
  if (disallowed.length) {
    throw new AppError('Csak saját magadat és a hozzátartozóidat jelentkeztetheted.', 403);
  }
}

// Registers one or more people for a tour in a single reservation -
// exactly who is allowed depends on the caller's role, see
// assertCanRegister above. bookedBy is always the logged-in caller, even
// when they're registering only other people (e.g. an admin signing up a
// member who called in), so it's always clear who to contact about a
// reservation.
export const signUpForTour = async (req, res) => {
  const tour = await Tour.findById(req.params.tourId);
  if (!tour) {
    throw new AppError('No tour found with that ID!', 404);
  }

  const attendeeIds = [
    ...new Set(
      Array.isArray(req.body.attendeeIds) && req.body.attendeeIds.length
        ? req.body.attendeeIds.map(String)
        : [req.user._id.toString()],
    ),
  ];

  await assertCanRegister(req.user, attendeeIds);

  const attendeeUsers = await User.find({ _id: { $in: attendeeIds } }).select('name');
  if (attendeeUsers.length !== attendeeIds.length) {
    throw new AppError('Néhány kiválasztott résztvevő nem található.', 404);
  }

  const existingReservations = await Reservation.find({ tour: tour._id }).select('attendees.user');
  const alreadyRegisteredIds = new Set(
    existingReservations.flatMap((r) => r.attendees.map((a) => a.user.toString())),
  );
  const duplicates = attendeeUsers.filter((u) => alreadyRegisteredIds.has(u._id.toString()));
  if (duplicates.length) {
    throw new AppError(
      `${duplicates.map((u) => u.name).join(', ')} már jelentkezett erre a táborra.`,
      400,
    );
  }

  const currentCount = existingReservations.reduce((sum, r) => sum + r.attendees.length, 0);
  if (currentCount + attendeeUsers.length > tour.maxCapacity) {
    throw new AppError('Ez a tábor sajnos megtelt.', 400);
  }

  const reservation = await Reservation.create({
    tour: tour._id,
    bookedBy: req.user._id,
    // Nights owed defaults to the tour's own (duration - 1) - never
    // chosen by the person registering, only ever adjusted afterward by
    // an admin (see updateAttendeeNights below) for the rare early
    // departure.
    attendees: attendeeUsers.map((u) => ({ user: u._id, name: u.name, nights: tour.duration - 1 })),
  });
  await reservation.populate('bookedBy', 'name email');

  res.status(201).json({ status: 'success', data: { reservation } });
};

// Each attendee's accommodation share, computed fresh from the tour's own
// per-night rate/advance-%/subsidy rather than stored - editing any of
// those on the tour immediately recalculates everyone rather than going
// stale. Returns a payment row for every attendee even when the tour has
// no accommodation pricing configured yet (totalPrice/advance/rest all
// null in that case), since the row also carries name/nights - useful for
// the plain "who's registered" view regardless of billing setup.
export function computeAttendeePayments(tour, reservations) {
  const rows = reservations.flatMap((r) =>
    r.attendees.map((a) => ({
      reservationId: String(r._id),
      attendeeId: String(a._id),
      name: a.name,
      // Older attendees created before this field existed simply don't
      // have it - same (duration - 1) default a brand-new signup gets.
      nights: a.nights ?? tour.duration - 1,
      isClubMember: a.user?.role !== 'guest',
      birthday: a.user?.birthday ?? null,
    })),
  );

  const nightlyRate = tour.accommodationPricePerNight;
  const advancePct = tour.advancePaymentPercentage;
  const pricingConfigured = nightlyRate != null && advancePct != null;

  if (!pricingConfigured) {
    return {
      attendeePayments: rows.map(({ reservationId, attendeeId, name, nights }) => ({
        reservationId,
        attendeeId,
        name,
        nights,
        totalPrice: null,
        advance: null,
        rest: null,
      })),
      totals: null,
    };
  }

  const perPerson = tour.pricingMode === 'perPerson';

  // perHouse: accommodationPricePerNight is what the whole HOUSE costs
  // per night - the club rents it for the tour's standard duration
  // regardless of who actually shows up. That fixed total is then split
  // across attendees proportional to each one's own nights, so someone
  // doing the rare early-departure pays less, but the amounts collected
  // from everyone still add up to exactly the real cost of the house.
  //
  // perPerson: accommodationPricePerNight is already the adult per-night
  // rate directly - each attendee's own nightly rate depends only on
  // whether they're a child on the tour's own startDate (not their
  // current age - see computeAge's own comment), with childPricePerNight
  // unset simply meaning nobody gets a discount. There's no shared pot to
  // split at all, so no proportional-split step here.
  const totalHouseFee = nightlyRate * (tour.duration - 1);
  const totalPersonNights = rows.reduce((sum, r) => sum + r.nights, 0);
  const pricePerPersonNight = totalPersonNights > 0 ? totalHouseFee / totalPersonNights : 0;

  function nightlyRateFor(row) {
    if (!perPerson) return pricePerPersonNight;
    const age = computeAge(row.birthday, tour.startDate);
    const isChild = age != null && tour.childAgeLimitYears != null && age <= tour.childAgeLimitYears;
    return isChild && tour.childPricePerNight != null ? tour.childPricePerNight : nightlyRate;
  }

  // The director's lump-sum contribution is split equally across
  // club-member attendees and only ever reduces their Maradék (rest),
  // never their Foglaló (advance) - see tourModel.js's clubSubsidyAmount.
  // Floored, not ceiled: unlike totalPrice/advance below (money owed TO
  // the club, rounded in the club's favor), this is money the club GIVES
  // AWAY, so it must never round up past what was actually budgeted - the
  // sum of N floored equal shares can never exceed the original total.
  // Ignored entirely for a tour that predates the club's founding - it
  // couldn't have contributed money to something before it existed.
  const subsidyEligible = new Date(tour.startDate) >= CLUB_FOUNDING_DATE;
  const subsidyTotal = subsidyEligible ? tour.clubSubsidyAmount || 0 : 0;
  const clubMemberCount = rows.filter((r) => r.isClubMember).length;
  const subsidyShare = clubMemberCount > 0 ? Math.floor(subsidyTotal / clubMemberCount) : 0;

  // perHouse's declared totals are the tour's own configured numbers
  // (e.g. 39000/night * 2 nights = 78000, 20% of that = 15600), not the
  // sum of each attendee's individually rounded-up share - splitting a
  // fixed amount into whole-forint per-person shares unavoidably rounds
  // every share up a little, so summing them would overstate the true
  // total by a few forints (17 people each rounded up ~0.9 Ft adds up).
  // perPerson has no such fixed pot to drift from - each attendee's
  // charge is already their own exact nights * rate, so summing the
  // individually-computed (still ceiled, for the same rounding-in-the-
  // club's-favor reasoning) amounts below IS the true total.
  const totalAdvance = perPerson ? null : Math.ceil((totalHouseFee * advancePct) / 100);

  let totalSubsidyApplied = 0;
  let summedTotalPrice = 0;
  let summedAdvance = 0;
  const attendeePayments = rows.map((r) => {
    // Rounded up rather than to the nearest forint - a fractional split
    // should never leave the club collecting less than the real cost,
    // even by a few forints, so every attendee's share rounds in the
    // club's favor.
    const totalPrice = Math.ceil(r.nights * nightlyRateFor(r));
    const advance = Math.ceil((totalPrice * advancePct) / 100);
    const restBeforeSubsidy = totalPrice - advance;
    // Capped at this person's own rest rather than floored at 0 after
    // subtracting - the difference matters for totalSubsidyApplied below,
    // which needs to reflect subsidy actually used, not nominally assigned.
    const appliedSubsidy = r.isClubMember ? Math.min(subsidyShare, restBeforeSubsidy) : 0;
    const rest = restBeforeSubsidy - appliedSubsidy;

    totalSubsidyApplied += appliedSubsidy;
    summedTotalPrice += totalPrice;
    summedAdvance += advance;

    return {
      reservationId: r.reservationId,
      attendeeId: r.attendeeId,
      name: r.name,
      nights: r.nights,
      totalPrice,
      advance,
      rest,
    };
  });

  // The real, currently-known average per person per night - used to
  // correct the tour list's advertised "Ft/fő/éj" card price once actual
  // attendees exist (see getAlltours/getTour), instead of leaving it at
  // the pre-registration assumption (perHouse: split across a full
  // house; perPerson: the flat adult rate) once reality is known to
  // differ - e.g. fewer than maxCapacity actually attending (perHouse:
  // true average is higher), or some attendees being children at a
  // discount (perPerson: true average is lower). Null with nobody
  // registered yet - nothing real to average.
  const averagePricePerPersonPerNight =
    totalPersonNights > 0 ? Math.ceil((perPerson ? summedTotalPrice : totalHouseFee) / totalPersonNights) : null;

  return {
    attendeePayments,
    totals: perPerson
      ? {
          totalPrice: summedTotalPrice,
          advance: summedAdvance,
          rest: summedTotalPrice - summedAdvance - totalSubsidyApplied,
          averagePricePerPersonPerNight,
        }
      : {
          totalPrice: totalHouseFee,
          advance: totalAdvance,
          rest: totalHouseFee - totalAdvance - totalSubsidyApplied,
          averagePricePerPersonPerNight,
        },
  };
}

// Admin-only - lets an admin shave a night off (or otherwise correct) one
// specific attendee's billed nights, for the rare case someone can't join
// for the tour's full duration. Never touched by the attendee themselves;
// see signUpForTour's comment for why the default isn't a registration-time
// choice.
export const updateAttendeeNights = async (req, res) => {
  const { reservationId, attendeeId } = req.params;
  const { nights } = req.body;

  if (typeof nights !== 'number' || !Number.isInteger(nights) || nights < 0) {
    throw new AppError('Az éjszakák száma nem lehet negatív egész szám.', 400);
  }

  const reservation = await Reservation.findById(reservationId);
  if (!reservation) {
    throw new AppError('Nincs ilyen foglalás.', 404);
  }

  const attendee = reservation.attendees.id(attendeeId);
  if (!attendee) {
    throw new AppError('Nincs ilyen résztvevő ebben a foglalásban.', 404);
  }

  const tour = await Tour.findById(reservation.tour).select('duration');
  const maxNights = tour.duration - 1;
  if (nights > maxNights) {
    throw new AppError(`Az éjszakák száma legfeljebb ${maxNights} lehet ennél a tábornál.`, 400);
  }

  attendee.nights = nights;
  await reservation.save();

  res.status(200).json({ status: 'success', data: { attendee } });
};
