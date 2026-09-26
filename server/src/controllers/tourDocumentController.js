import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import multer from 'multer';
import Tour from '../models/tourModel.js';
import AppError from '../utils/appError.js';
import { TOUR_DOCUMENTS_DIR } from '../utils/dataDirs.js';

// Same "not committed, not synced, per-environment" storage as tour cover
// images (server/public/img/tours) - see server/.gitignore's bare
// `public` entry. One subfolder per tour (by _id, stable even if the
// slug changes later) so files never collide across tours.
const DOCS_ROOT = TOUR_DOCUMENTS_DIR;

const ALLOWED_MIME_TYPES = {
  'application/pdf': '.pdf',
  'image/jpeg': '.jpg',
};

// Loads the tour once, up front, so both multer's filename callback below
// (needs order/slug for the on-disk filename) and the actual controller
// (needs the full document to push into extraDocuments and save) share
// the same fetch instead of hitting the DB twice per upload.
export async function loadTourForUpload(req, res, next) {
  const tour = await Tour.findById(req.params.tourId);
  if (!tour) {
    throw new AppError('No tour found with that ID!', 404);
  }
  req.tour = tour;
  next();
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(DOCS_ROOT, String(req.tour._id));
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  // "tour-<order>-<slug>-..." so the file's own name identifies which
  // tour it belongs to at a glance, even outside its per-tour folder -
  // not the original upload filename, which could collide across
  // uploads or contain characters unsafe for a URL/filesystem path.
  filename: (req, file, cb) => {
    const ext = ALLOWED_MIME_TYPES[file.mimetype] ?? path.extname(file.originalname);
    const unique = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    cb(null, `tour-${req.tour.order}-${req.tour.slug}-${unique}${ext}`);
  },
});

// .single('file') - the upload form sends one file plus a `title` field.
export const uploadMiddleware = multer({
  storage,
  limits: { fileSize: 15 * 1024 * 1024 }, // 15 MB - generous for a scanned map/beszámoló, not unbounded
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_MIME_TYPES[file.mimetype]) {
      cb(new AppError('Csak PDF vagy JPG fájl tölthető fel.', 400));
      return;
    }
    cb(null, true);
  },
}).single('file');

export const uploadTourDocument = async (req, res) => {
  const tour = req.tour;

  if (!req.file) {
    throw new AppError('Nincs feltöltött fájl.', 400);
  }

  // Checked again here (not just relying on the schema validator) so the
  // orphaned file on disk gets cleaned up on rejection, not left behind.
  if (tour.extraDocuments.length >= 5) {
    fs.unlink(req.file.path, () => {});
    throw new AppError('Legfeljebb 5 extra dokumentum tölthető fel egy táborhoz.', 400);
  }

  const title = req.body.title?.trim();
  if (!title) {
    fs.unlink(req.file.path, () => {});
    throw new AppError('A dokumentumnak kell legyen címe.', 400);
  }

  tour.extraDocuments.push({
    title,
    filename: req.file.filename,
    mimeType: req.file.mimetype,
  });
  await tour.save();

  res.status(201).json({ status: 'success', data: { tour } });
};

export const deleteTourDocument = async (req, res) => {
  const tour = await Tour.findById(req.params.tourId);
  if (!tour) {
    throw new AppError('No tour found with that ID!', 404);
  }

  const document = tour.extraDocuments.id(req.params.documentId);
  if (!document) {
    throw new AppError('Nincs ilyen dokumentum.', 404);
  }

  const filePath = path.join(DOCS_ROOT, String(tour._id), document.filename);
  fs.unlink(filePath, () => {}); // best-effort - a missing file on disk shouldn't block removing the DB entry

  document.deleteOne();
  await tour.save();

  res.status(204).json({ status: 'success', data: null });
};
