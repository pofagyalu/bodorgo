import mongoose from 'mongoose';
import slugify from 'slugify';

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
