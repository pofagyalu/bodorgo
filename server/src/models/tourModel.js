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
    ratingsAverage: { type: Number, default: 4.5 },
    ratingsQuantity: { type: Number, default: 0 },
    price: { type: Number, required: [true, 'A tábornak kell legyen ára'] },
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
    attachments: [String],
    imageCover: {
      type: String,
      required: [true, 'A tábornak kell legyen fotója'],
    },
    images: [String],
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

// Covers Tour.create() and any explicit .save() call. PATCH updates go
// through findByIdAndUpdate instead, which bypasses this hook - that path
// is handled explicitly in tourController.js's updateTour.
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
