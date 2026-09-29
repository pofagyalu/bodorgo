import Tour, { toHuf } from '../models/tourModel.js';
import Reservation from '../models/reservationModel.js';
import User from '../models/userModel.js';
import AppError from '../utils/appError.js';
import { computeAge } from './userController.js';
import { partitionAttendeesByEmailEligibility } from './tourPdfController.js';
import sendResendEmail from '../utils/resendEmail.js';
import logger from '../logger.js';
import Cancellation from '../models/cancellationModel.js';
import { emitToTour } from '../chat/tourEvents.js';

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

// Three variants: the registrant registering themselves (+ maybe family),
// the registrant registering only other people (e.g. an admin signing up
// a member who called in - not attending themselves, so no "you secured
// your own spot" framing), and a family member who got signed up
// alongside them but didn't do it themselves. otherNames is who else is
// on the same reservation, from the recipient's own point of view.
function registrationConfirmationEmailBody(
  recipientName,
  { registrantIsRecipient, registrantIsAttendee, registrantName, tourTitle, otherNames },
) {
  const noReplyNote =
    'Erre az e-mailre kérjük, ne válaszolj - ez egy automatikusan generált üzenet.';
  const signature = 'Üdvözlettel,\nA Bódorgó csapat 🏕️';
  const signatureHtml = 'Üdvözlettel,<br>A Bódorgó csapat 🏕️';
  const nextSteps = 'Hamarosan véglegesedik a szállás ára, és jöhet az előlegbefizetés.';

  let intro;
  let introHtml;
  if (registrantIsRecipient && registrantIsAttendee && otherNames.length > 0) {
    intro = `Gratulálunk, ${recipientName}!\n\nBebiztosítottad a helyet a magad és az alábbi családtagok számára a(z) "${tourTitle}" táborra:\n\n${otherNames.map((n) => `- ${n}`).join('\n')}`;
    introHtml = `<p>Gratulálunk, ${recipientName}!</p><p>Bebiztosítottad a helyet a magad és az alábbi családtagok számára a(z) "${tourTitle}" táborra:</p><ul>${otherNames.map((n) => `<li>${n}</li>`).join('')}</ul>`;
  } else if (registrantIsRecipient && registrantIsAttendee) {
    intro = `Gratulálunk, ${recipientName}!\n\nBebiztosítottad a helyet magadnak a(z) "${tourTitle}" táborra.`;
    introHtml = `<p>Gratulálunk, ${recipientName}!</p><p>Bebiztosítottad a helyet magadnak a(z) "${tourTitle}" táborra.</p>`;
  } else if (registrantIsRecipient) {
    // Registered only other people (e.g. an admin signing up a member who
    // called in) - not attending themselves, so no "gratulálunk" framing
    // implying they secured their own spot too.
    intro = `Sikeresen jelentkeztetted az alábbi résztvevőket a(z) "${tourTitle}" táborra:\n\n${otherNames.map((n) => `- ${n}`).join('\n')}`;
    introHtml = `<p>Sikeresen jelentkeztetted az alábbi résztvevőket a(z) "${tourTitle}" táborra:</p><ul>${otherNames.map((n) => `<li>${n}</li>`).join('')}</ul>`;
  } else {
    // A family member signed up by someone else - still a "gratulálunk"
    // (they're getting a spot too, they just didn't click the button
    // themselves), but framed around who did it. remainingNames excludes
    // both the recipient (already addressed as "téged") and the
    // registrant (already named directly) - "és még ezeket a
    // családtagokat is" only appears when there's genuinely someone left
    // over (e.g. kids), not for a plain two-person registrant+recipient
    // reservation.
    const remainingNames = otherNames.filter((n) => n !== registrantName);
    const verb = registrantIsAttendee ? 'benevezett magán kívül' : 'jelentkeztetett';
    if (remainingNames.length > 0) {
      intro = `Gratulálunk, ${recipientName}!\n\n${registrantName} ${verb} téged és még az alábbi családtagokat is a(z) "${tourTitle}" táborra:\n\n${remainingNames.map((n) => `- ${n}`).join('\n')}`;
      introHtml = `<p>Gratulálunk, ${recipientName}!</p><p>${registrantName} ${verb} téged és még az alábbi családtagokat is a(z) "${tourTitle}" táborra:</p><ul>${remainingNames.map((n) => `<li>${n}</li>`).join('')}</ul>`;
    } else {
      intro = `Gratulálunk, ${recipientName}!\n\n${registrantName} ${verb} téged is a(z) "${tourTitle}" táborra.`;
      introHtml = `<p>Gratulálunk, ${recipientName}!</p><p>${registrantName} ${verb} téged is a(z) "${tourTitle}" táborra.</p>`;
    }
  }

  return {
    subject: `Sikeres jelentkezés - ${tourTitle}`,
    text: `${intro}\n\n${nextSteps}\n\n${signature}\n\n${noReplyNote}`,
    html: `${introHtml}<p>${nextSteps}</p><p>${signatureHtml}</p><p style="color:#888;font-size:0.85em;">${noReplyNote}</p>`,
  };
}

// Pure (no DB/network) so it's directly unit-testable, same reasoning as
// partitionAttendeesByEmailEligibility - given who registered, who they
// registered (attendeeUsers, name/email/lastLoginAt/wantsEmailNotifications
// already populated), and the tour's title, returns the exact list of
// {to, subject, text, html} emails signUpForTour should send: the
// registrant is always a candidate (even if only registering other
// people), every attendee is too, eligibility-filtered, deduped by user
// id, each with the wording variant that fits their own role in this
// particular reservation (see registrationConfirmationEmailBody above).
export function buildRegistrationEmails({ registrant, tourTitle, attendeeUsers }) {
  const candidatesById = new Map();
  candidatesById.set(String(registrant._id), registrant);
  for (const u of attendeeUsers) candidatesById.set(String(u._id), u);

  const { eligible } = partitionAttendeesByEmailEligibility([...candidatesById.values()]);
  const attendeeNamesById = new Map(attendeeUsers.map((u) => [String(u._id), u.name]));
  const registrantIsAttendee = attendeeNamesById.has(String(registrant._id));

  return eligible.map((recipient) => {
    const registrantIsRecipient = String(recipient._id) === String(registrant._id);
    const otherNames = [...attendeeNamesById.entries()]
      .filter(([id]) => id !== String(recipient._id))
      .map(([, name]) => name);
    const { subject, text, html } = registrationConfirmationEmailBody(recipient.name, {
      registrantIsRecipient,
      registrantIsAttendee,
      registrantName: registrant.name,
      tourTitle,
      otherNames,
    });
    return { to: recipient.email, subject, text, html };
  });
}

// Registers one or more people for a tour in a single reservation -
// exactly who is allowed depends on the caller's role, see
// assertCanRegister above. bookedBy is always the logged-in caller, even
// when they're registering only other people (e.g. an admin signing up a
// member who called in), so it's always clear who to contact about a
// reservation.
// Sign-up closes when the tour starts - for everyone but an admin, who can
// still register people afterwards (backfilling past tours' attendance).
export function tourHasStarted(tour, now = new Date()) {
  return now >= new Date(tour.startDate);
}

export const signUpForTour = async (req, res) => {
  const tour = await Tour.findById(req.params.tourId);
  if (!tour) {
    throw new AppError('No tour found with that ID!', 404);
  }
  if (req.user.role !== 'admin' && tourHasStarted(tour)) {
    throw new AppError('Erre a táborra már nem lehet jelentkezni - elkezdődött.', 400);
  }

  const attendeeIds = [
    ...new Set(
      Array.isArray(req.body.attendeeIds) && req.body.attendeeIds.length
        ? req.body.attendeeIds.map(String)
        : [req.user._id.toString()],
    ),
  ];

  await assertCanRegister(req.user, attendeeIds);

  const attendeeUsers = await User.find({ _id: { $in: attendeeIds } }).select(
    'name email lastLoginAt wantsEmailNotifications',
  );
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

  // A nice-to-have on top of the registration having already succeeded
  // (the reservation above is real regardless of what happens next) - a
  // failure here (e.g. the email provider being briefly down) shouldn't
  // fail the sign-up itself, just gets logged for follow-up. The
  // registrant (req.user) is always considered even if they registered
  // only other people (e.g. an admin signing up a member who called in) -
  // they're the one who'd want to know it went through.
  try {
    const emails = buildRegistrationEmails({
      registrant: req.user,
      tourTitle: tour.title,
      attendeeUsers,
    });
    for (const email of emails) await sendResendEmail(email);
  } catch (err) {
    logger.error(
      `Reservation ${reservation._id}: registration confirmation email failed: ${err.message}`,
    );
  }

  res.status(201).json({ status: 'success', data: { reservation } });
};

// Called whenever a tour's advancePaymentPercentage is set to exactly 0
// (see tourController.js's updateTour) - that's a real, deliberate
// configuration (a rare accommodation that genuinely needs no advance at
// all), not "not yet configured" (which is null/undefined, not 0 - see
// computeAttendeePayments' own pricingConfigured check). With nothing
// actually owed upfront, every current attendee is automatically marked
// as having paid their (non-existent) advance, rather than leaving them
// all incorrectly showing as unpaid/pending forever with no way to
// "pay" a real amount of zero.
export async function markAllAttendeesPaidForTour(tourId) {
  await Reservation.updateMany({ tour: tourId }, { $set: { 'attendees.$[].paid': true } });
}

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
      // Lets the client group/stripe the attendee list by family (see
      // attendee-list.ts), and (together with userId below) identify
      // "which rows are me / my family" on the advance-payment page - not
      // used in any pricing math here, just carried through to the
      // output rows below.
      familyId: a.user?.familyId ? String(a.user.familyId) : null,
      // The linked User's own id (distinct from attendeeId, which is
      // this attendee *subdocument's* own id) - lets the client match "is
      // this row literally me", which familyId alone can't do for
      // someone with no family on record.
      userId: a.user?._id ? String(a.user._id) : null,
      // Per-person, not the whole reservation's own paid flag (see
      // reservationModel.js's attendeeSchema.paid) - drives both the
      // attendee list's paid/unpaid icon and the advance-payment page
      // excluding whoever's already settled up.
      paid: a.paid ?? false,
      // Admin-only override (see reservationModel.js's own comment) -
      // still counted toward nights/capacity below, just excluded from
      // what's actually owed.
      feeExempt: a.feeExempt ?? false,
    })),
  );

  // Worked out in the tour's own currency (accommodationCurrency): a tour
  // quoted in EUR is paid on site in EUR, so its Teljes ár/Fizetendő are
  // whole euros (rounded up, like forints). Only the advance - always
  // paid to the club, in HUF - is converted, once per person, at the
  // tour's own rate (see advanceHufOf): `advance` is that HUF amount,
  // `advanceInCurrency` the same advance in the tour's currency.
  const isEur = tour.accommodationCurrency === 'EUR';
  const advanceHufOf = (amount) => (isEur ? Math.ceil(toHuf(tour, amount)) : amount);
  const nightlyRate = tour.accommodationPricePerNight;
  const childPricePerNight = tour.childPricePerNight;
  const advancePct = tour.advancePaymentPercentage;
  const pricingConfigured = nightlyRate != null && advancePct != null;

  if (!pricingConfigured) {
    return {
      attendeePayments: rows.map(
        ({ reservationId, attendeeId, name, nights, familyId, userId, paid, feeExempt }) => ({
          reservationId,
          attendeeId,
          name,
          nights,
          familyId,
          userId,
          paid,
          feeExempt,
          totalPrice: null,
          advance: null,
          advanceInCurrency: null,
          rest: null,
        }),
      ),
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
  // feeExempt attendees' nights are excluded from the split - the house's
  // fixed cost is already committed regardless of who's comped, so it
  // still has to be fully covered by whoever IS paying, at a
  // correspondingly higher per-person-night rate, rather than quietly
  // undercollecting by exactly the exempt person's share.
  const totalPersonNights = rows.reduce((sum, r) => sum + (r.feeExempt ? 0 : r.nights), 0);
  const pricePerPersonNight = totalPersonNights > 0 ? totalHouseFee / totalPersonNights : 0;

  function nightlyRateFor(row) {
    if (!perPerson) return pricePerPersonNight;
    const age = computeAge(row.birthday, tour.startDate);
    const isChild =
      age != null && tour.childAgeLimitYears != null && age <= tour.childAgeLimitYears;
    return isChild && childPricePerNight != null ? childPricePerNight : nightlyRate;
  }

  // The director's lump-sum contribution is split equally across
  // club-member attendees and only ever reduces their Fizetendő (rest),
  // never their Előleg (advance) - see tourModel.js's clubSubsidyAmount.
  // Floored, not ceiled: unlike totalPrice/advance below (money owed TO
  // the club, rounded in the club's favor), this is money the club GIVES
  // AWAY, so it must never round up past what was actually budgeted - the
  // sum of N floored equal shares can never exceed the original total.
  // Ignored entirely for a tour that predates the club's founding - it
  // couldn't have contributed money to something before it existed - and
  // for a tour quoted in EUR: the club doesn't subsidize those.
  const subsidyEligible = new Date(tour.startDate) >= CLUB_FOUNDING_DATE && !isEur;
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
  let summedAdvanceHuf = 0;
  const attendeePayments = rows.map((r) => {
    // feeExempt bypasses the pricing formula entirely rather than
    // computing normally and zeroing after - this person contributes
    // nothing to summedTotalPrice/summedAdvance (perPerson's totals ARE
    // that sum, so a comped person genuinely reduces what's actually
    // expected) and consumes no club subsidy (leaving the whole subsidy
    // pool available for attendees who do owe something). Their nights
    // still counted toward totalPersonNights above though - they really
    // are occupying the house for perHouse's own fixed-cost split, same
    // as anyone else, just personally billed nothing for it.
    if (r.feeExempt) {
      return {
        reservationId: r.reservationId,
        attendeeId: r.attendeeId,
        name: r.name,
        nights: r.nights,
        familyId: r.familyId,
        userId: r.userId,
        // Nothing left to collect, so treated as settled regardless of
        // the stored paid flag - kept in sync with it by
        // updateAttendeeFeeExempt itself, this is just defensive.
        paid: true,
        feeExempt: true,
        totalPrice: 0,
        advance: 0,
        advanceInCurrency: 0,
        rest: 0,
      };
    }

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

    const advanceHuf = advanceHufOf(advance);

    totalSubsidyApplied += appliedSubsidy;
    summedTotalPrice += totalPrice;
    summedAdvance += advance;
    summedAdvanceHuf += advanceHuf;

    return {
      reservationId: r.reservationId,
      attendeeId: r.attendeeId,
      name: r.name,
      nights: r.nights,
      familyId: r.familyId,
      userId: r.userId,
      paid: r.paid,
      feeExempt: false,
      totalPrice,
      advance: advanceHuf,
      advanceInCurrency: advance,
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
  // Always in HUF - it's the tour card's "Ft/fő/éj".
  const averagePricePerPersonPerNight =
    totalPersonNights > 0
      ? Math.ceil(toHuf(tour, (perPerson ? summedTotalPrice : totalHouseFee) / totalPersonNights))
      : null;

  return {
    attendeePayments,
    totals: perPerson
      ? {
          totalPrice: summedTotalPrice,
          advance: summedAdvanceHuf,
          advanceInCurrency: summedAdvance,
          rest: summedTotalPrice - summedAdvance - totalSubsidyApplied,
          averagePricePerPersonPerNight,
        }
      : {
          totalPrice: totalHouseFee,
          advance: advanceHufOf(totalAdvance),
          advanceInCurrency: totalAdvance,
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

// Admin-only - marks one specific attendee as owing nothing at all for
// this tour, regardless of the pricing formula (see reservationModel.js's
// feeExempt field and computeAttendeePayments above for the real, rare
// cases this covers - an infant, a last-minute guest joining for free
// since the whole house is already paid for, an invited guest the club
// is comping). Also flips their own paid flag to match - "exempt" means
// there's nothing left to collect, and the profile page's own Fizetve/
// Nincs kifizetve reads this field directly, not
// computeAttendeePayments' derived value, so the two would otherwise
// disagree. Turning it back off (correcting a mistake) reverts paid to
// false too - a deliberate simple default for what's expected to be a
// rare correction, not an attempt to reconstruct any real payment
// history that might have existed before the exemption was set.
export const updateAttendeeFeeExempt = async (req, res) => {
  const { reservationId, attendeeId } = req.params;
  const { feeExempt } = req.body;

  if (typeof feeExempt !== 'boolean') {
    throw new AppError('A feeExempt mezőnek logikai értéknek kell lennie.', 400);
  }

  const reservation = await Reservation.findById(reservationId);
  if (!reservation) {
    throw new AppError('Nincs ilyen foglalás.', 404);
  }

  const attendee = reservation.attendees.id(attendeeId);
  if (!attendee) {
    throw new AppError('Nincs ilyen résztvevő ebben a foglalásban.', 404);
  }

  attendee.feeExempt = feeExempt;
  attendee.paid = feeExempt;
  await reservation.save();

  res.status(200).json({ status: 'success', data: { attendee } });
};

// The short "Lemondás" confirmation - to the withdrawn person and to
// whoever signed them up (see withdrawAttendee).
function withdrawalEmailBody(
  recipientName,
  { attendeeName, tourTitle, recipientIsAttendee, cancelledByName },
) {
  const noReplyNote =
    'Erre az e-mailre kérjük, ne válaszolj - ez egy automatikusan generált üzenet.';
  const what = recipientIsAttendee
    ? `a(z) "${tourTitle}" táborra szóló jelentkezésedet visszavontuk`
    : `${attendeeName} jelentkezését a(z) "${tourTitle}" táborra visszavontuk`;
  const by = cancelledByName ? ` (${cancelledByName} intézte)` : '';
  return {
    subject: `Lemondás - ${tourTitle}`,
    text: `Szia ${recipientName}!\n\nTájékoztatunk, hogy ${what}${by}.\n\nÜdvözlettel,\nBódorgó\n\n${noReplyNote}`,
    html: `<p>Szia ${recipientName}!</p><p>Tájékoztatunk, hogy ${what}${by}.</p><p>Üdvözlettel,<br>Bódorgó</p><p style="color:#888;font-size:0.85em;">${noReplyNote}</p>`,
  };
}

// DELETE /tours/:tourId/reservations/:reservationId/attendees/:attendeeId
// - "Lemondás": takes one person off a tour, any time. Whoever could sign
// them up may withdraw them (admin: anyone; member: themselves and their
// family; guest: only themselves - see assertCanRegister). Their room and
// optional-program sign-ups are freed; a finalized Szobabeosztás becomes
// editable again, since it now has a gap. An advance they already paid is
// simply left as it is - no automatic refund, settled in-house - and the
// withdrawal is logged for the admins' "Lemondások" list.
export const withdrawAttendee = async (req, res) => {
  const { tourId, reservationId, attendeeId } = req.params;
  const reservation = await Reservation.findById(reservationId);
  if (!reservation || String(reservation.tour) !== String(tourId)) {
    throw new AppError('Nincs ilyen foglalás.', 404);
  }
  const attendee = reservation.attendees.id(attendeeId);
  if (!attendee) {
    throw new AppError('Nincs ilyen résztvevő ebben a foglalásban.', 404);
  }

  try {
    await assertCanRegister(req.user, [String(attendee.user)]);
  } catch (err) {
    throw new AppError('Csak saját magadat és a hozzátartozóidat jelentheted le.', 403);
  }

  const tour = await Tour.findById(tourId);
  if (!tour) throw new AppError('No tour found with that ID!', 404);

  const reason = String(req.body?.reason ?? '')
    .trim()
    .slice(0, 300);
  const { user: userId, name, paid } = attendee;

  // Off the reservation - and the reservation itself goes when it was the
  // last person on it.
  if (reservation.attendees.length === 1) {
    await reservation.deleteOne();
  } else {
    attendee.deleteOne();
    await reservation.save();
  }

  // Off any optional program they had signed up for, and a finalized room
  // allocation opens up again for the admin to fill the gap.
  let tourChanged = false;
  for (const event of tour.schedule ?? []) {
    const before = event.participants?.length ?? 0;
    event.participants = (event.participants ?? []).filter(
      (p) => String(p.user) !== String(userId),
    );
    if (event.participants.length !== before) tourChanged = true;
  }
  const roomsReopened = !!tour.accommodation?.finalized;
  if (roomsReopened) {
    tour.accommodation.finalized = false;
    tourChanged = true;
  }
  if (tourChanged) {
    await Tour.updateOne(
      { _id: tour._id },
      {
        schedule: tour.schedule,
        'accommodation.finalized': tour.accommodation?.finalized ?? false,
      },
    );
  }
  emitToTour(tour._id, 'rooms-changed', { tourId: String(tour._id) });

  const bookedBy = await User.findById(reservation.bookedBy).select(
    'name email lastLoginAt wantsEmailNotifications',
  );
  const cancellation = await Cancellation.create({
    tour: tour._id,
    user: userId,
    name,
    bookedByName: bookedBy?.name,
    cancelledBy: req.user._id,
    cancelledByName: req.user.name,
    reason,
    wasPaid: !!paid,
  });

  // Same "only people who can get e-mail" rules as the sign-up confirmation.
  try {
    const attendeeUser = await User.findById(userId).select(
      'name email lastLoginAt wantsEmailNotifications',
    );
    const candidates = new Map();
    if (attendeeUser) candidates.set(String(attendeeUser._id), attendeeUser);
    if (bookedBy) candidates.set(String(bookedBy._id), bookedBy);
    const { eligible } = partitionAttendeesByEmailEligibility([...candidates.values()]);
    for (const recipient of eligible) {
      const { subject, text, html } = withdrawalEmailBody(recipient.name, {
        attendeeName: name,
        tourTitle: tour.title,
        recipientIsAttendee: String(recipient._id) === String(userId),
        cancelledByName: String(req.user._id) === String(recipient._id) ? null : req.user.name,
      });
      await sendResendEmail({ to: recipient.email, subject, text, html });
    }
  } catch (err) {
    logger.error(`Tour ${tour._id}: withdrawal email for ${name} failed: ${err.message}`);
  }

  res
    .status(200)
    .json({ status: 'success', data: { cancellation, wasPaid: !!paid, roomsReopened } });
};

// GET /tours/:tourId/cancellations - admin-only "Lemondások" list, newest first.
export const getCancellations = async (req, res) => {
  const cancellations = await Cancellation.find({ tour: req.params.tourId }).sort('-cancelledAt');
  res.status(200).json({ status: 'success', data: { cancellations } });
};
