import mongoose from 'mongoose';

const tourSchema = new mongoose.Schema(
  {
    startDate: {
      type: Date,
      required: [true, 'A tour must have a start date'],
      unique: true,
    },
    duration: {
      type: Number,
      required: [true, 'A tour must have a duration'],
    },
    startLocation: {
      type: {
        type: String,
        enum: ['Point'],
        required: true,
      },
      coordinates: { type: [Number], required: true },
      city: String,
      description: String,
      address: String,
    },
    summary: {
      type: String,
      required: [true, 'A tour must have a summary'],
    },
    description: {
      type: String,
      required: [true, 'A tour must have a description'],
    },
    maxGroupSize: {
      type: Number,
      required: [true, 'A tour must have a group size'],
    },
    locations: [
      {
        type: {
          type: String,
          enum: ['Point'],
          required: true,
        },
        coordinates: { type: [Number], required: true },
        description: String,
        address: String,
        day: Number,
      },
    ],
    imageCover: {
      type: String,
      required: [true, 'A tour must have a cover image'],
    },
    images: [String],
    initialPayment: { type: Number, default: 0 },
    price: { type: Number, default: 0 },
    noOfAttendants: { type: Number, default: 0 },
    ratingsAverage: { type: Number, default: 4.5 },
    ratingsQuantity: { type: Number, default: 0 },
  },
  { timestamps: true },
);

const Tour = mongoose.model('Tour', tourSchema);

export default Tour;
