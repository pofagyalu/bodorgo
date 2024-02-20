import mongoose from 'mongoose';
import slugify from 'slugify';

const tourSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'A tour must have a name'],
      unique: true,
      trim: true,
      minLength: [10, 'Tour name must have at least 10 characters'],
      maxLength: [40, 'Tour name must have less or equal then 40 characters'],
    },
    slug: String,
    summary: {
      type: String,
      required: [true, 'A tour must have a summary'],
    },
    description: {
      type: String,
      required: [true, 'A tour must have a description'],
    },
    startLocation: {
      type: {
        type: String,
        enum: ['Point'],
        default: 'Point',
      },
      coordinates: [Number],
      address: String,
      description: String,
    },
    locations: [
      {
        type: {
          type: String,
          enum: ['Point'],
          default: 'Point',
        },
        coordinates: [Number],
        address: String,
        description: String,
        day: Number,
      },
    ],
    startDate: {
      type: Date,
      required: [true, 'A tour must have a start date'],
      unique: true,
      validate: {
        validator: function (val) {
          return val > Date.now();
        },
        message: `Tour start date ({VALUE}) cannot be a past date!`,
      },
    },
    duration: {
      type: Number,
      required: [true, 'A tour must have a duration'],
      min: [1, 'Tour duration must be at least 1'],
      max: [14, 'Tour duration be less than or equal with 14'],
    },
    imageCover: {
      type: String,
      required: [true, 'A tour must have a cover image'],
    },
    images: [String],
    maxGroupSize: {
      type: Number,
      required: [true, 'A tour must have a group size'],
    },
    bookings: [{ type: mongoose.Schema.ObjectId, ref: 'Booking' }],
    events: [
      {
        type: mongoose.Schema.ObjectId,
        ref: 'Event',
      },
    ],
    initialPayment: { type: Number, default: 0 },
    price: { type: Number, default: 0 },
    ratingsAverage: {
      type: Number,
      default: 4.5,
      min: [1, 'Rating must be at least 1.0'],
      max: [5, 'Rating must be below or equal to 5.0'],
    },
    ratingsQuantity: { type: Number, default: 0 },
    privateTour: {
      type: Boolean,
      default: false,
    },
  },
  {
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
    timestamps: true,
  },
);

tourSchema.virtual('durationWeeks').get(function () {
  return this.duration / 7;
});

tourSchema.virtual('reviews', {
  ref: 'Review',
  foreignField: 'tour',
  localField: '_id',
});

tourSchema.pre('save', function (next) {
  this.slug = slugify(this.name, { lower: true });
  next();
});

tourSchema.pre('aggregate', function (next) {
  this.pipeline().unshift({ $match: { privateTour: { $ne: true } } });
  next();
});

const Tour = mongoose.model('Tour', tourSchema);

export default Tour;
