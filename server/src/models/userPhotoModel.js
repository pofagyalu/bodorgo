import mongoose from 'mongoose';

const { Schema } = mongoose;

// A user's profile photo, stored in the database itself rather than as a
// file on disk. The browser already crops and shrinks it to a small
// square JPEG before uploading (see the client's photo-editor), so each
// one is only ~30KB. The local dev app and production share one database,
// so a photo uploaded from either shows up in both right away - no
// per-machine files to copy around the way server/documents/ needs
// sync.js for. Kept out of the User document itself so the (frequent)
// user list queries never drag image bytes along.
const userPhotoSchema = new Schema(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
    },
    data: {
      type: Buffer,
      required: true,
    },
    contentType: {
      type: String,
      required: true,
    },
  },
  { timestamps: true },
);

const UserPhoto = mongoose.model('UserPhoto', userPhotoSchema);

export default UserPhoto;
