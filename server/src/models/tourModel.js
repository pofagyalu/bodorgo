import mongoose from 'mongoose';
import slugify from 'slugify';
import { computeDrivingRoute, BUDAPEST_CENTER } from '../utils/distance.js';
import logger from '../logger.js';

const { Schema } = mongoose;

// The tour's accommodation, set up by an admin (see
// accommodationController.js) - usually well after the tour itself, once
// the actual houses/rooms are known. Houses -> rooms -> number of places;
// the kind of bed ("franciaágy"...) just goes in a room's description.
// Every house and room keeps its own _id across edits, so the
// Szobabeosztás (who sleeps where) can point at a room by id and survive
// renames.
const roomSchema = new Schema({
  name: {
    type: String,
    required: [true, 'Minden szobának kell legyen neve'],
    trim: true,
  },
  description: {
    type: String,
    trim: true,
    default: '',
  },
  beds: {
    type: Number,
    required: [true, 'Minden szobának meg kell adni a férőhelyek számát'],
    min: [1, 'Egy szobában legalább 1 férőhely kell legyen'],
    max: [20, 'Egy szobában legfeljebb 20 férőhely lehet'],
  },
});

const houseSchema = new Schema({
  name: {
    type: String,
    required: [true, 'Minden háznak kell legyen neve'],
    trim: true,
  },
  description: {
    type: String,
    trim: true,
    default: '',
  },
  rooms: [roomSchema],
});

const tourSchema = new Schema(
  {
    order: {
      type: Number,
    },
    title: {
      type: String,
      required: [true, 'A tábornak nincs neve'],
      unique: true,
    },
    slug: {
      type: String,
    },
    location: {
      type: {
        type: String,
        default: 'Point',
        enum: ['Point'],
      },
      coordinates: {
        type: [Number],
      },
      address: String,
      description: String,
    },
    coordinates: {
      type: String,
    },
    // Real road/highway driving distance from Budapest's center, computed
    // once via OpenRouteService (see pre('save') below) and cached here -
    // never recomputed unless location.coordinates actually changes.
    distanceFromBudapestKm: {
      type: Number,
    },
    // Same OpenRouteService call as distanceFromBudapestKm above (one
    // request returns both), estimated real driving time rather than a
    // straight-line guess - see pre('save') below.
    drivingDurationFromBudapestMinutes: {
      type: Number,
    },
    startDate: {
      type: Date,
      required: [true, 'A tábornak nincs kezdőidőpontja'],
    },
    duration: {
      type: Number,
      required: [true, 'A tábornak nincs időtartama'],
      min: [1, 'Minimum időtartam 1 nap'],
      max: [10, 'Max időtartam 10 nap'],
    },
    maxCapacity: {
      type: Number,
      required: [true, 'A tábornak kell legyen mérete'],
    },
    // The admin-only inputs behind each attendee's accommodation
    // breakdown (Teljes ár/Előleg/Fizetendő) - see
    // reservationController.js's computeAttendeePayments. All optional:
    // a tour with none of these set simply shows no payment breakdown yet.
    //
    // 'perHouse' (the default, and the only mode that ever existed before
    // this field) - accommodationPricePerNight is what the whole HOUSE
    // costs per night, not a per-person rate; the club rents it for the
    // tour's standard duration regardless of headcount, and that fixed
    // total is split across attendees proportional to each one's own
    // nights (see computeAttendeePayments).
    //
    // 'perPerson' - some accommodation owners instead quote a rate per
    // person per night, with a separate (lower) child rate - and where
    // the age cutoff between "child" and "adult" differs from place to
    // place, so it has to be configured per tour, not hardcoded. In this
    // mode, accommodationPricePerNight is repurposed to mean the ADULT
    // per-night rate directly (see childPricePerNight/childAgeLimitYears
    // below) - there's no house total to split at all, each attendee's
    // own charge is just their own nights times their own (age-based) rate.
    pricingMode: {
      type: String,
      enum: ['perHouse', 'perPerson'],
      default: 'perHouse',
    },
    accommodationPricePerNight: {
      type: Number,
      min: [0, 'A szállásköltség nem lehet negatív'],
    },
    // Which currency accommodationPricePerNight/childPricePerNight are
    // actually quoted in - most accommodations are domestic and billed in
    // HUF, but some foreign trips are quoted in EUR by the venue. Every
    // downstream money figure (the advertised price, each attendee's
    // billed amount) is still always shown/charged in HUF regardless of
    // this - see eurHufExchangeRate and toHuf below.
    accommodationCurrency: {
      type: String,
      enum: ['HUF', 'EUR'],
      default: 'HUF',
    },
    // Required whenever accommodationCurrency is 'EUR' (see the validator
    // below) - the admin's own manually-entered EUR->HUF rate as of when
    // they configured this tour's pricing, used by toHuf to convert
    // accommodationPricePerNight/childPricePerNight into HUF. Deliberately
    // a fixed snapshot the admin sets once, not fetched live from an
    // exchange-rate API - same spirit as clubSubsidyAmount being a fixed
    // number rather than computed.
    eurHufExchangeRate: {
      type: Number,
      // A plain `validate` alone would NOT catch a genuinely missing value
      // - Mongoose only runs non-required custom validators when the path
      // actually has a value, so "left blank while EUR is selected" needs
      // its own conditional `required` (which Mongoose does special-case
      // to run even against undefined) - `validate` below only covers "a
      // value was given, but it's not usable" (zero/negative).
      required: [
        function () {
          return this.accommodationCurrency === 'EUR';
        },
        'EUR pénznem esetén meg kell adni egy árfolyamot.',
      ],
      validate: {
        validator: function (v) {
          return v == null || v > 0;
        },
        message: 'Az árfolyamnak pozitív számnak kell lennie.',
      },
    },
    // Only meaningful when pricingMode is 'perPerson' - left unset simply
    // means every attendee is billed at the adult
    // (accommodationPricePerNight) rate regardless of age, a perfectly
    // valid "per person, but no child discount" setup.
    childPricePerNight: {
      type: Number,
      min: [0, 'A gyermekár nem lehet negatív'],
    },
    // The oldest age (inclusive) still considered a child for pricing -
    // e.g. 12 means "12 and under pays the child rate, 13+ pays the adult
    // rate". Evaluated against the attendee's age on the tour's own
    // startDate, not today (see computeAttendeePayments) - a child who
    // turns over the limit shortly after the tour shouldn't retroactively
    // become adult-priced for a trip they took while still under it.
    childAgeLimitYears: {
      type: Number,
      min: [0, 'Az életkorhatár nem lehet negatív'],
    },
    advancePaymentPercentage: {
      type: Number,
      min: [0, 'Az előleg százaléka nem lehet negatív'],
      max: [100, 'Az előleg százaléka nem lehet 100-nál több'],
    },
    // The director's one-off lump-sum contribution toward this tour's
    // accommodation, split equally across club-member attendees and
    // deducted only from their Fizetendő (rest), never from Előleg
    // (advance) - see computeAttendeePayments. Defaults to 0 ("no club
    // money this time") rather than being left unset, since that's the
    // common case.
    clubSubsidyAmount: {
      type: Number,
      min: [0, 'A klub hozzájárulása nem lehet negatív'],
      default: 0,
    },
    // Real, computed from `reviews` below on every submit (see the
    // pre('save') hook) - the 4.5/0 defaults only ever apply to a tour
    // nobody has reviewed yet (a leftover from this codebase's
    // Natours-tutorial origins, kept as the placeholder for that case).
    ratingsAverage: { type: Number, default: 4.5 },
    ratingsQuantity: { type: Number, default: 0 },
    // One entry per attendee, upserted on each submit (see
    // reviewController.js's submitReview - "change it any time" means
    // replace, not append). select:false - who rated what is nobody
    // else's business, only the aggregate ratingsAverage/ratingsQuantity
    // above are public.
    reviews: {
      type: [
        {
          _id: false,
          user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
          rating: { type: Number, required: true, min: 1, max: 10 },
          updatedAt: { type: Date, default: Date.now },
        },
      ],
      select: false,
    },
    // No longer admin-entered - see the pre('save') hook below. Optional
    // rather than required, since it stays unset until an admin
    // configures accommodationPricePerNight for the tour; tour-card.html
    // shows "Nincs adat" for that gap.
    price: { type: Number },
    summary: {
      type: String,
      trim: true,
    },
    description: {
      type: String,
      required: [true, 'A tábornak kell legyen leírása'],
    },
    // Day-by-day agenda. day is 1-indexed (1 = startDate itself); time is a
    // plain "HH:mm" string rather than a Date, since it's the same every
    // year the tour repeats and doesn't need its own date component.
    // See houseSchema/roomSchema above. Empty until an admin sets it up.
    // finalized: the admin has marked the Szobabeosztás (who sleeps where -
    // see reservationModel.js's attendee room) as final; while set, nobody
    // can be moved until it's unlocked again (see roomAllocationController.js).
    accommodation: {
      houses: [houseSchema],
      finalized: {
        type: Boolean,
        default: false,
      },
    },
    schedule: [
      {
        day: {
          type: Number,
          required: [true, 'A program elemnek kell legyen napja'],
          min: 1,
        },
        time: {
          type: String,
          required: [true, 'A program elemnek kell legyen időpontja'],
        },
        description: {
          type: String,
          required: [true, 'A program elemnek kell legyen leírása'],
        },
        // Optional extra-cost events (e.g. a wine tasting) that not every
        // attendee necessarily wants - who's coming is tracked right here
        // on the event itself so headcounts for the venue/vendor are just
        // participants.length.
        isOptional: {
          type: Boolean,
          default: false,
        },
        extraCost: {
          type: Number, // only meaningful when isOptional is true
        },
        participants: [
          {
            user: { type: Schema.Types.ObjectId, ref: 'User' },
            // Denormalized, same pattern as Reservation.attendees - avoids
            // populating just to show a name list.
            name: String,
          },
        ],
      },
    ],
    // One entry per tour day (1-indexed, same numbering as schedule),
    // filled in and refreshed on-demand (see tourController.js's
    // refreshTourWeather) rather than on a schedule - a forecast while the
    // day is still upcoming, replaced by the real recorded weather once
    // the day has passed and then frozen (isFinal) forever, so a past
    // tour's page always shows what the weather actually was.
    dailyWeather: [
      {
        day: { type: Number, required: true, min: 1 },
        condition: {
          type: String,
          enum: ['clear', 'partly-cloudy', 'cloudy', 'fog', 'rain', 'snow', 'thunderstorm'],
        },
        tempDayC: Number,
        tempNightC: Number,
        windSpeedKmh: Number,
        isFinal: { type: Boolean, default: false },
        fetchedAt: Date,
      },
    ],
    attachments: [String],
    // Admin-uploaded extras shown in the tour-details page's "Extra
    // infók" section (a map, a beszámoló, places-to-visit notes, etc.) -
    // see tourDocumentController.js. Capped at 5: enough for the handful
    // of documents a tour realistically needs without this becoming a
    // general-purpose file store. filename is what's actually on disk
    // (server/public/documents/tours/<tourId>/<filename>, so gitignored/
    // per-environment like the cover images, not synced/committed) -
    // never the original upload name, which could collide or contain
    // unsafe characters.
    extraDocuments: {
      type: [
        {
          title: { type: String, required: true, trim: true },
          filename: { type: String, required: true },
          mimeType: {
            type: String,
            enum: ['application/pdf', 'image/jpeg'],
            required: true,
          },
          uploadedAt: { type: Date, default: Date.now },
        },
      ],
      default: [],
      validate: {
        validator: (docs) => docs.length <= 5,
        message: 'Legfeljebb 5 extra dokumentum tölthető fel egy táborhoz.',
      },
    },
    // No longer required at creation time - a brand new tour is created
    // first (needs a real _id/order before a cover can be named after
    // it), then its cover gets uploaded separately right after (see
    // tourCoverController.js) via the tour-edit page, not typed in by
    // hand alongside everything else.
    // Cover image - the JPEG itself lives in its own collection (see
    // tourCoverModel.js); this is when it last changed, doubling as the
    // client's cache-busting version (?v=...) and as "has a cover". (The
    // old imageCover filename field pointed at public/img/tours/, which is
    // no longer served at all - see scripts/migrateCoversToDb.js.)
    coverUpdatedAt: {
      type: Date,
    },
    // Gallery photos, synced from a NAS folder by scripts/syncTourImages.js
    // (append-only, so an already-recorded photo never shifts position on
    // re-sync). width/height are captured at sync time via sharp - the
    // frontend gallery (PhotoSwipe) needs them upfront for correct
    // sizing/zoom, not just as a nice-to-have. Both sourceFolder and
    // images are `select: false` - the raw NAS folder name and file list
    // must never appear on the public tour endpoints (GET /tours,
    // GET /tours/:id both work with no login), only through the dedicated
    // requireAuth-gated image routes (see tourImageController.js).
    sourceFolder: { type: String, select: false },
    images: {
      type: [
        {
          _id: false,
          filename: { type: String, required: true },
          width: Number,
          height: Number,
          // Bytes, from fs.statSync at sync time - lets the client show a
          // total zip size without statting every file on every request.
          size: Number,
          // Set by hand by an admin, after upload, for the rare sensitive
          // photo - true restricts it to that tour's own attendees (plus
          // any admin), everyone else can't see it at all (not even that
          // it exists - see tourImageController.js's canViewRestrictedImage).
          // Most photos never get touched, so this defaults to visible.
          restricted: { type: Boolean, default: false },
        },
      ],
      select: false,
    },
    secretTour: {
      type: Boolean,
      default: false,
    },
    // Path to the post-tour recap video, relative to config.videosRoot -
    // admin-picked from the actual files on disk (see
    // tourVideoController.js's listAvailableVideos), not typed by hand,
    // since one trip can have more than one cut (e.g. two alternate edits
    // of the same episode) with no naming convention that could resolve
    // that on its own. select:false for the same reason as sourceFolder
    // above - the raw NAS-relative path never appears on the public tour
    // endpoints, only derived into a plain `hasVideo` boolean (see
    // tourController.js's getTour) and the requireAuth-gated video route.
    videoFile: { type: String, select: false },
  },
  {
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
    timestamps: true,
    id: false, // <-- disable automatic id virtual
  },
);

// DOCUMENT Middleware, runs before .save() and .create(), .this points to document
tourSchema.pre('save', function (next) {
  this.slug = slugify(this.title, { lower: true });
  next();
});

// Covers Tour.create() and any explicit .save() call - tourController.js's
// updateTour loads and .save()s rather than using findByIdAndUpdate
// specifically so this (and the dailyWeather hook below) actually fire on
// an edit, not just on creation.
tourSchema.pre('save', async function (next) {
  if (
    this.isModified('location.coordinates') &&
    this.location?.coordinates?.length === 2
  ) {
    try {
      const route = await computeDrivingRoute(BUDAPEST_CENTER, {
        lat: this.location.coordinates[1],
        lng: this.location.coordinates[0],
      });
      this.distanceFromBudapestKm = route?.distanceKm;
      this.drivingDurationFromBudapestMinutes = route?.durationMinutes;
    } catch (err) {
      logger.error(`Failed to compute distance/duration from Budapest: ${err.message}`);
    }
  }
  next();
});

// tourController.js's refreshTourWeather caches weather per day number and
// freezes it (isFinal: true) forever once that day has passed - it never
// revisits a frozen entry, regardless of whether the tour's actual dates
// changed since. Without this, editing startDate/duration (a date shift)
// or location.coordinates (weather is fetched for a specific lat/lng)
// after a tour already has cached/frozen weather leaves the *old* dates'
// or *old* location's weather sitting there, silently wrong for the
// tour's new dates/place - this was a real reported bug (several tours
// quickly created with the same placeholder date+location all ended up
// showing identical weather that never updated once the real per-tour
// dates were edited in). Clearing it here forces a fresh fetch on the
// next view. A no-op on creation, since dailyWeather starts empty anyway.
tourSchema.pre('save', function (next) {
  if (
    this.isModified('startDate') ||
    this.isModified('duration') ||
    this.isModified('location.coordinates')
  ) {
    this.dailyWeather = [];
  }
  next();
});

// Recomputes the public ratingsAverage/ratingsQuantity from the real
// per-attendee reviews array whenever it changes (reviewController.js's
// submitReview upserts into it) - these two fields are what tour cards
// actually display, `reviews` itself is select:false and never exposed.
// Only recomputes once there's at least one real review; an unreviewed
// tour keeps the schema's 4.5/0 placeholder rather than dropping to 0.
tourSchema.pre('save', function (next) {
  if (this.isModified('reviews') && this.reviews.length > 0) {
    const sum = this.reviews.reduce((acc, r) => acc + r.rating, 0);
    this.ratingsAverage = Math.round((sum / this.reviews.length) * 10) / 10;
    this.ratingsQuantity = this.reviews.length;
  }
  next();
});

// Once an admin sets accommodationPricePerNight, the tour's advertised
// price is no longer something they maintain by hand - shown on
// tour-card.html as "Ft/fő/éj" (Ft per person per night). Recomputed
// whenever a relevant input changes. A tour that has never used the
// accommodation-pricing feature keeps its old plain manually-entered
// price untouched - this only ever takes over once accommodationPrice
// PerNight actually has a value.
//
// In 'perHouse' mode, accommodationPricePerNight is the whole house's
// nightly rate - there's no single real per-person total until people
// actually register and it gets split among however many show up, which
// isn't known yet for a tour being advertised, so this shows the average
// instead, assuming the tour fills to maxCapacity (nightlyRate /
// maxCapacity) - a duration-independent figure.
//
// In 'perPerson' mode, accommodationPricePerNight already directly IS the
// adult per-person-per-night rate (see the field's own comment) - nothing
// to average, it's shown as-is.
tourSchema.pre('save', function (next) {
  if (
    this.accommodationPricePerNight != null &&
    (this.isModified('accommodationPricePerNight') ||
      this.isModified('maxCapacity') ||
      this.isModified('pricingMode') ||
      this.isModified('accommodationCurrency') ||
      this.isModified('eurHufExchangeRate'))
  ) {
    const nightlyRateHuf = toHuf(this, this.accommodationPricePerNight);
    this.price =
      this.pricingMode === 'perPerson'
        ? nightlyRateHuf
        : Math.ceil(nightlyRateHuf / this.maxCapacity);
  }
  next();
});

// Converts a raw accommodationPricePerNight/childPricePerNight value into
// HUF - identity when the tour is quoted in HUF already (the common case),
// or multiplied by the admin's own manually-entered eurHufExchangeRate
// when it's EUR. Shared by this file's own pre('save') hook above (the
// publicly advertised price) and reservationController.js's
// computeAttendeePayments (real attendee billing), so both always agree on
// the exact same converted figure - "amount" is nullable so callers can
// pass tour.childPricePerNight straight through without a separate null
// check (unset simply stays unset either way).
export function toHuf(tour, amount) {
  if (amount == null) return amount;
  if (tour.accommodationCurrency !== 'EUR') return amount;
  return amount * (tour.eurHufExchangeRate ?? 0);
}

// QUERY Middleware (this points to query because of 'find' hook)
// Regular expression to hook all find methods such as findOne, findById, etc...
tourSchema.pre(/^find/, function (next) {
  this.find({ secretTour: { $ne: true } });
  // this.start = Date.now();
  next();
});

// Virtual populate: all reservations that belong to this tour
tourSchema.virtual('reservations', {
  ref: 'Reservation',
  localField: '_id',
  foreignField: 'tour',
});

// Virtual: number of participants calculated from Reservations
tourSchema.virtual('participantCount', {
  ref: 'Reservation',
  localField: '_id',
  foreignField: 'tour',
  justOne: false,
  options: {},
});

// Derived virtual: total attendees calculated from nested arrays
tourSchema.virtual('participants').get(function () {
  if (!this.reservations) return undefined;
  return this.reservations.reduce((sum, r) => sum + r.attendees.length, 0);
});

const Tour = mongoose.model('Tour', tourSchema);

export default Tour;
