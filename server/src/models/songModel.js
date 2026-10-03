import mongoose from 'mongoose';
import slugify from 'slugify';

const { Schema } = mongoose;

// One song of the Daloskönyv (the club's songbook). The lyrics and chords
// are one ChordPro text (chords in [brackets] before their syllable) - the
// client parses it (pages/daloskonyv/chordpro.ts). The book is in the
// order of the titles; the songs have no numbers.
const songSchema = new Schema(
  {
    title: {
      type: String,
      required: [true, 'A dalnak kell legyen címe.'],
      trim: true,
      maxlength: 150,
    },
    artist: { type: String, trim: true, maxlength: 150, default: '' },
    // From the title (accents folded: "Eső után" → eso-utan) - the song's
    // address. A new title gets a new one.
    slug: { type: String, unique: true },
    chordpro: { type: String, default: '', maxlength: 20000 },
    tags: { type: [String], default: [] },
    // The song's first chord as it was first written here ("am") - kept
    // when the song is saved in another key, so its old key can be told
    // (and gone back to). Empty: never moved.
    originalKey: { type: String, trim: true, maxlength: 12, default: '' },
    // The song's key set by hand, as its home chord ("C", "am") - when the
    // one worked out from the chords (songController.js's detectedKey) is
    // wrong. Empty: the chords say. Dropped when the chords are changed.
    key: { type: String, trim: true, maxlength: 12, default: '' },
    // The song's tempo in beats a minute, set by hand (typed, or tapped in
    // the editor) - a marker like a printed songbook's "♩ = 96". null:
    // none given.
    tempo: { type: Number, min: 30, max: 300, default: null },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true },
);

songSchema.index({ title: 1 });

// A free slug for this title: eso-utan, then eso-utan-2, eso-utan-3...
songSchema.statics.freeSlug = async function freeSlug(title, exceptId = null) {
  const base = slugify(title, { lower: true, strict: true, locale: 'hu' }) || 'dal';
  for (let n = 1; ; n += 1) {
    const slug = n === 1 ? base : `${base}-${n}`;
    const taken = await this.exists({ slug, _id: { $ne: exceptId } });
    if (!taken) return slug;
  }
};

const Song = mongoose.model('Song', songSchema);

export default Song;
