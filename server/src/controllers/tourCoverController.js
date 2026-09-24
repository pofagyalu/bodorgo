import fs from 'fs';
import path from 'path';
import multer from 'multer';
import Tour from '../models/tourModel.js';
import AppError from '../utils/appError.js';

// The same flat public/img/tours/ directory (and tour-<order>-cover.<ext>
// naming) already used by hand until now (see e.g. scripts/addTour.js) -
// this just turns "copy a file onto the NAS and type its name into a text
// field" into an actual upload button. JPEG/PNG only (not .webp) so
// pdfkit can embed a freshly-uploaded cover directly, with no image
// library involved at all - see tourPdfController.js/
// convertCoverImagesToJpeg.js for why that matters in production.
const TOURS_IMG_DIR = path.join(path.resolve(), 'public', 'img', 'tours');

const ALLOWED_MIME_TYPES = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
};

// Loads the tour once, up front, so both multer's filename callback below
// (needs the tour's order for the on-disk filename) and the actual
// controller (needs the full document to update imageCover and save)
// share the same fetch instead of hitting the DB twice per upload - same
// pattern as tourDocumentController.js's loadTourForUpload.
export async function loadTourForCoverUpload(req, res, next) {
  const tour = await Tour.findById(req.params.id);
  if (!tour) {
    throw new AppError('No tour found with that ID!', 404);
  }
  req.tour = tour;
  next();
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    fs.mkdirSync(TOURS_IMG_DIR, { recursive: true });
    cb(null, TOURS_IMG_DIR);
  },
  // Deterministic, not a random/unique suffix like the extra-documents
  // upload - there's only ever one cover per tour, so a fresh upload
  // replaces it under the same tour-<order>-cover.<ext> convention this
  // project has always used, rather than piling up alongside it.
  filename: (req, file, cb) => {
    cb(null, `tour-${req.tour.order}-cover${ALLOWED_MIME_TYPES[file.mimetype]}`);
  },
});

export const uploadCoverMiddleware = multer({
  storage,
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_MIME_TYPES[file.mimetype]) {
      cb(new AppError('Csak JPG vagy PNG fájl tölthető fel.', 400));
      return;
    }
    cb(null, true);
  },
}).single('file');

export const uploadTourCover = async (req, res) => {
  const tour = req.tour;

  if (!req.file) {
    throw new AppError('Nincs feltöltött fájl.', 400);
  }

  // If the previous cover used a different extension (the old .webp
  // convention, or a png replaced with a jpg), that old file is now
  // orphaned - multer only overwrites when the filename is identical.
  const oldFilename = tour.imageCover;
  if (oldFilename && oldFilename !== req.file.filename) {
    fs.unlink(path.join(TOURS_IMG_DIR, oldFilename), () => {});
  }

  tour.imageCover = req.file.filename;
  await tour.save();

  res.status(200).json({ status: 'success', data: { tour } });
};

// POST /tours/cover/:order - used only while creating a brand new tour,
// which has no _id yet to upload against with uploadTourCover above. The
// filename convention (tour-<order>-cover.<ext>) only ever depended on
// order, which the admin has already typed into the create form well
// before hitting save - there's no real reason uploading a cover should
// have to wait for the tour to exist first. This never touches a Tour
// document at all; it just saves the file and reports back its
// deterministic name, which the client then sends along as imageCover in
// the same createTour request that actually creates the tour.
const orderCoverStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    fs.mkdirSync(TOURS_IMG_DIR, { recursive: true });
    cb(null, TOURS_IMG_DIR);
  },
  filename: (req, file, cb) => {
    cb(null, `tour-${req.params.order}-cover${ALLOWED_MIME_TYPES[file.mimetype]}`);
  },
});

// Runs before uploadCoverForOrderMiddleware below, so a duplicate order is
// rejected before multer ever writes anything to disk - without this, the
// file lands as tour-<order>-cover.<ext> regardless of whether that order
// is already taken by a real tour, and the actual createTour call that
// follows only fails afterward (own "sorszám már foglalt" check), leaving
// the just-written file permanently orphaned (or worse, silently
// clobbering that other tour's real cover file, since the filename is
// purely order-based). Real bug this closed: a create attempt reusing an
// already-taken order wrote a real cover file to disk with nothing ever
// pointing to it once creation itself was rejected.
export async function assertOrderAvailableForCover(req, res, next) {
  if (!/^\d+$/.test(req.params.order)) {
    throw new AppError('Érvénytelen sorszám.', 400);
  }
  const existing = await Tour.findOne({ order: Number(req.params.order) }).select('title');
  if (existing) {
    throw new AppError(
      `A ${req.params.order}. sorszám már foglalt ("${existing.title}") - borítókép csak még nem használt sorszámhoz tölthető fel így.`,
      400,
    );
  }
  next();
}

export const uploadCoverForOrderMiddleware = multer({
  storage: orderCoverStorage,
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_MIME_TYPES[file.mimetype]) {
      cb(new AppError('Csak JPG vagy PNG fájl tölthető fel.', 400));
      return;
    }
    cb(null, true);
  },
}).single('file');

export const uploadCoverForOrder = async (req, res) => {
  if (!req.file) {
    throw new AppError('Nincs feltöltött fájl.', 400);
  }

  res.status(200).json({ status: 'success', data: { filename: req.file.filename } });
};
