import mongoose from 'mongoose';

const { Schema } = mongoose;

// Ócskapiac: something one of us doesn't need any more - left-over screws,
// outgrown kids' clothes, a few jars of home-made jam. Free, or for a few
// beers, or for real (cheap) money. Others press "Kérem!" (interested -
// anyone, any number) or "Stipistopi!" (dibs - one person, held for 7
// days, see marketplace/marketItems.js; then it's free for anyone again).

export const CATEGORIES = ['barkacs', 'gyerek', 'haztartas', 'kezmuves', 'egyeb'];

// What it costs: kind 'ingyen' (free) and 'joszo' (a kind word) have no
// amount; the rest are "amount of" - beers, chocolates... or forints.
export const PRICE_KINDS = [
  'ingyen',
  'joszo',
  'sor',
  'csoki',
  'palinka',
  'kave',
  'lekvar',
  'forint',
];

export const MAX_PHOTOS = 3;
export const MAX_NOTE_LENGTH = 100;

const photoSchema = new Schema({
  width: Number,
  height: Number,
  // Bytes on disk, the thumbnail included.
  size: Number,
});

const wantSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    at: { type: Date, default: Date.now },
  },
  { _id: false },
);

// A one-liner anyone may leave: "Hívlak!", "A szomszédnak kellhet".
const noteSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    text: { type: String, required: true, trim: true, maxlength: MAX_NOTE_LENGTH },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

const marketItemSchema = new Schema(
  {
    owner: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    title: {
      type: String,
      required: [true, 'Adj nevet a kacatnak.'],
      trim: true,
      maxlength: 80,
    },
    description: { type: String, trim: true, maxlength: 1000, default: '' },
    category: { type: String, enum: CATEGORIES, default: 'egyeb' },
    price: {
      kind: { type: String, enum: PRICE_KINDS, default: 'ingyen' },
      amount: { type: Number, default: null },
    },
    photos: {
      type: [photoSchema],
      validate: {
        validator: (arr) => arr.length <= MAX_PHOTOS,
        message: `Legfeljebb ${MAX_PHOTOS} fotó lehet.`,
      },
    },
    // "Kérem!" - in the order they asked.
    wanted: { type: [wantSchema], default: [] },
    // "Stipistopi!" - held for reservedAt + 7 days; after that it counts as
    // free again (worked out on every read, no background job).
    reservedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    reservedAt: { type: Date, default: null },
    notes: { type: [noteSchema], default: [] },
    // "Odaadtam": it's gone - kept, photos and all, stamped "Elvitték!".
    goneAt: { type: Date, default: null },
    // Its owner's Törlés: kept, photos and all, but shown to nobody (an
    // admin's Törlés deletes it for real).
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

marketItemSchema.index({ createdAt: -1 });

const MarketItem = mongoose.model('MarketItem', marketItemSchema);
export default MarketItem;
