import mongoose from 'mongoose';
import slugify from 'slugify';
import { computeDrivingDistanceKm, BUDAPEST_CENTER } from '../utils/distance.js';
import logger from '../logger.js';

const { Schema } = mongoose;

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
    // The three admin-only inputs behind each attendee's accommodation
    // breakdown (Teljes ár/Foglaló/Maradék) - see
    // reservationController.js's computeAttendeePayments. All optional:
    // a tour with none of these set simply shows no payment breakdown yet.
    // What the HOUSE costs per night (not a per-person rate) - the club
    // rents it for the tour's standard duration regardless of headcount,
    // and that fixed total is split across attendees proportional to each
    // one's own nights (see computeAttendeePayments).
    accommodationPricePerNight: {
      type: Number,
      min: [0, 'A szállásköltség nem lehet negatív'],
    },
    advancePaymentPercentage: {
      type: Number,
      min: [0, 'Az előleg százaléka nem lehet negatív'],
      max: [100, 'Az előleg százaléka nem lehet 100-nál több'],
    },
    // The director's one-off lump-sum contribution toward this tour's
    // accommodation, split equally across club-member attendees and
    // deducted only from their Maradék (rest), never from Foglaló
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
    imageCover: {
      type: String,
      required: [true, 'A tábornak kell legyen fotója'],
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
      this.distanceFromBudapestKm = await computeDrivingDistanceKm(
        BUDAPEST_CENTER,
        { lat: this.location.coordinates[1], lng: this.location.coordinates[0] },
      );
    } catch (err) {
      logger.error(`Failed to compute distance from Budapest: ${err.message}`);
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
// price is no longer something they maintain by hand. accommodationPrice
// PerNight is what the whole HOUSE costs per night, not a per-person
// rate (see computeAttendeePayments) - there's no single real per-person
// total until people actually register and it gets split among however
// many show up, which isn't known yet for a tour being advertised. This
// shows the average price per person per night instead, assuming the
// tour fills to maxCapacity (nightlyRate / maxCapacity) - a duration-
// independent figure, shown on tour-card.html as "Ft/fő/éj". Recomputed
// whenever either input changes. A tour that has never used the
// accommodation-pricing feature keeps its old plain manually-entered
// price untouched - this only ever takes over once accommodationPrice
// PerNight actually has a value.
tourSchema.pre('save', function (next) {
  if (
    this.accommodationPricePerNight != null &&
    (this.isModified('accommodationPricePerNight') || this.isModified('maxCapacity'))
  ) {
    this.price = Math.ceil(this.accommodationPricePerNight / this.maxCapacity);
  }
  next();
});

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
