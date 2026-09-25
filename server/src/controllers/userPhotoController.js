import multer from 'multer';
import User from '../models/userModel.js';
import UserPhoto from '../models/userPhotoModel.js';
import AppError from '../utils/appError.js';

// The client crops + resizes to a 320x320 JPEG before uploading (sharp
// isn't available on the production NAS, so no server-side resizing) -
// this limit is generous for that, but stops anyone posting a raw
// multi-megabyte camera photo straight at the API.
const MAX_PHOTO_BYTES = 512 * 1024;

export const photoUploadMiddleware = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_PHOTO_BYTES },
  fileFilter: (req, file, cb) => {
    if (file.mimetype !== 'image/jpeg') {
      cb(new AppError('Csak JPG kép tölthető fel.', 400));
      return;
    }
    cb(null, true);
  },
}).single('file');

// Checks the actual bytes, not just the client-declared mimetype.
function assertJpeg(file) {
  if (!file) {
    throw new AppError('Nincs feltöltött kép.', 400);
  }
  const b = file.buffer;
  if (b.length < 3 || b[0] !== 0xff || b[1] !== 0xd8 || b[2] !== 0xff) {
    throw new AppError('A feltöltött fájl nem JPG kép.', 400);
  }
}

async function savePhoto(user, file, setBy) {
  assertJpeg(file);
  await UserPhoto.findOneAndUpdate(
    { user: user._id },
    { data: file.buffer, contentType: 'image/jpeg' },
    { upsert: true },
  );
  user.photoUpdatedAt = new Date();
  user.photoSetBy = setBy;
  await user.save({ validateModifiedOnly: true });
}

async function removePhoto(user, setBy) {
  await UserPhoto.deleteOne({ user: user._id });
  user.photoUpdatedAt = undefined;
  user.photoSetBy = setBy;
  await user.save({ validateModifiedOnly: true });
}

function photoResponse(res, user) {
  res.status(200).json({
    status: 'success',
    data: {
      photoUpdatedAt: user.photoUpdatedAt ?? null,
      photoSetBy: user.photoSetBy ?? null,
    },
  });
}

// GET /users/:id/photo - any logged-in user (it's shown next to names all
// over the members-only app), never anonymous. The client always asks for
// it with ?v=<photoUpdatedAt>, so a given URL's bytes never change and it
// can be cached hard; a new upload simply means a new URL.
export const getUserPhoto = async (req, res) => {
  const photo = await UserPhoto.findOne({ user: req.params.id });
  if (!photo) {
    throw new AppError('Nincs profilkép.', 404);
  }
  res.set('Cache-Control', 'private, max-age=31536000, immutable');
  res.type(photo.contentType).send(photo.data);
};

// PUT/DELETE /users/me/photo - anyone, for their own photo. Marks it as
// set by the user themselves, which from then on locks the admin out of
// changing it (see loadTargetForAdmin) - removing their own photo counts
// too, so the admin can't just put one back.
export const setMyPhoto = async (req, res) => {
  await savePhoto(req.user, req.file, 'self');
  photoResponse(res, req.user);
};

export const deleteMyPhoto = async (req, res) => {
  await removePhoto(req.user, 'self');
  photoResponse(res, req.user);
};

// PUT/DELETE /users/:id/photo - admin-only, for someone else's photo, and
// only until that person has set (or removed) their own. An admin editing
// their own photo through here counts as setting it themselves.
async function loadTargetForAdmin(req) {
  const user = await User.findById(req.params.id);
  if (!user) {
    throw new AppError('No user found with that ID!', 404);
  }
  const isSelf = user._id.equals(req.user._id);
  if (!isSelf && user.photoSetBy === 'self') {
    throw new AppError(
      'A felhasználó a profilképét saját maga állította be - azt már nem lehet módosítani.',
      403,
    );
  }
  return { user, setBy: isSelf ? 'self' : 'admin' };
}

export const setUserPhoto = async (req, res) => {
  const { user, setBy } = await loadTargetForAdmin(req);
  await savePhoto(user, req.file, setBy);
  photoResponse(res, user);
};

export const deleteUserPhoto = async (req, res) => {
  const { user, setBy } = await loadTargetForAdmin(req);
  await removePhoto(user, setBy);
  photoResponse(res, user);
};
