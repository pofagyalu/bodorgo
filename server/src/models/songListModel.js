import mongoose from 'mongoose';

const { Schema } = mongoose;

// A playlist of the Daloskönyv: a user's own named list of songs, in the
// order they put them - "Szomorú dalok", "Tábortűz". Private: only its
// owner sees and changes it (songListController.js). A song deleted from
// the songbook leaves every list (songController.js's deleteSong).
const songListSchema = new Schema(
  {
    owner: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    name: {
      type: String,
      required: [true, 'A listának kell legyen neve.'],
      trim: true,
      maxlength: 60,
    },
    // The songs, in the list's order - each once.
    songs: { type: [{ type: Schema.Types.ObjectId, ref: 'Song' }], default: [] },
  },
  { timestamps: true },
);

const SongList = mongoose.model('SongList', songListSchema);

export default SongList;
