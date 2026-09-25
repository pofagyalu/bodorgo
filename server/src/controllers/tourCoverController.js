import multer from 'multer';
import Tour from '../models/tourModel.js';
import TourCover from '../models/tourCoverModel.js';
import AppError from '../utils/appError.js';

// The client already crops a picked cover to 3:2 and exports it as a JPEG
// at most 1000x667 before uploading (see tour-edit.ts / the crop dialog),
// typically 100-150KB - this limit is generous for that, but stops a raw
// multi-megabyte camera photo being posted straight at the API. JPEG
// only: the tour PDF (tourPdfController.js) embeds the cover directly,
// and pdfkit reads JPEG/PNG but not WebP.
const MAX_COVER_BYTES = 1024 * 1024;

export const uploadCoverMiddleware = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_COVER_BYTES },
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
    throw new AppError('Nincs feltöltött fájl.', 400);
  }
  const b = file.buffer;
  if (b.length < 3 || b[0] !== 0xff || b[1] !== 0xd8 || b[2] !== 0xff) {
    throw new AppError('A feltöltött fájl nem JPG kép.', 400);
  }
}

// POST /tours/:id/cover - admin-only. A brand new tour gets its cover the
// same way, right after it's been created (see tour-edit.ts's save), so
// there's no separate "upload before the tour exists" route any more.
export const uploadTourCover = async (req, res) => {
  const tour = await Tour.findById(req.params.id);
  if (!tour) {
    throw new AppError('No tour found with that ID!', 404);
  }
  assertJpeg(req.file);

  await TourCover.findOneAndUpdate(
    { tour: tour._id },
    { data: req.file.buffer, contentType: 'image/jpeg' },
    { upsert: true },
  );
  tour.coverUpdatedAt = new Date();
  await tour.save({ validateModifiedOnly: true });

  res.status(200).json({ status: 'success', data: { tour } });
};

// GET /tours/:id/cover - any logged-in user, never anonymous. The client
// always asks for it with ?v=<coverUpdatedAt>, so a given URL's bytes
// never change and it can be cached hard; a new upload means a new URL.
export const getTourCover = async (req, res) => {
  const cover = await TourCover.findOne({ tour: req.params.id });
  if (!cover) {
    throw new AppError('Nincs borítókép.', 404);
  }
  res.set('Cache-Control', 'private, max-age=31536000, immutable');
  res.type(cover.contentType).send(cover.data);
};

// The cover's raw bytes for server-side use (the tour PDF), or null.
export async function loadTourCoverBuffer(tourId) {
  const cover = await TourCover.findOne({ tour: tourId });
  return cover ? cover.data : null;
}
