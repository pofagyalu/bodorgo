import fs from 'fs';
import path from 'path';
import { ZipArchive } from 'archiver';
import Tour from '../models/tourModel.js';
import AppError from '../utils/appError.js';
import config from '../config.js';
import logger from '../logger.js';

// Loads a tour with its gallery fields (select:false by default - see
// tourModel.js - so every handler here has to opt back in explicitly)
// and validates filename against its recorded image list. This is the
// only thing standing between a client-supplied filename and a raw
// filesystem read, so every image route funnels through it - never trust
// the filename alone, even though the sync script only ever writes plain,
// already-sanitized names into `images`.
async function loadTourImage(tourId, filename) {
  const tour = await Tour.findById(tourId).select('+images +sourceFolder title slug');
  if (!tour) {
    throw new AppError('No tour found with that ID!', 404);
  }
  if (!tour.images.some((i) => i.filename === filename)) {
    throw new AppError('Nincs ilyen fénykép ehhez a táborhoz.', 404);
  }
  return tour;
}

// Resolves to an absolute path under `root/tour.sourceFolder/`, rejecting
// anything that would escape it - defense in depth alongside the
// `images.includes(filename)` check above, in case that array is ever
// hand-edited to something unexpected.
function resolveImagePath(root, tour, filename) {
  const baseDir = path.resolve(root, tour.sourceFolder);
  const fullPath = path.resolve(baseDir, filename);
  if (fullPath !== baseDir && !fullPath.startsWith(baseDir + path.sep)) {
    throw new AppError('Invalid image path', 400);
  }
  return fullPath;
}

// GET /tours/:tourId/images - the ordered list of { filename, width,
// height } - width/height are what PhotoSwipe needs upfront for correct
// sizing/zoom; the client builds the thumb/full/download URLs below from
// tourId + filename itself.
export const getTourImages = async (req, res) => {
  const tour = await Tour.findById(req.params.tourId).select('+images');
  if (!tour) {
    throw new AppError('No tour found with that ID!', 404);
  }
  res.status(200).json({ status: 'success', data: { images: tour.images } });
};

// GET /tours/:tourId/images/:filename/thumb - the pre-generated .webp from
// THUMBNAILS_ROOT (see scripts/syncTourImages.js). Falls back to the full
// original if no thumbnail exists yet (a sync that failed partway, or a
// photo added to the folder by hand) rather than 404ing the whole gallery
// grid over one missing thumbnail.
export const getTourImageThumb = async (req, res) => {
  const tour = await loadTourImage(req.params.tourId, req.params.filename);

  const thumbPath = resolveImagePath(
    config.thumbnailsRoot,
    tour,
    `${path.parse(req.params.filename).name}.webp`,
  );

  if (fs.existsSync(thumbPath)) {
    return res.sendFile(thumbPath);
  }

  const fullPath = resolveImagePath(config.photosRoot, tour, req.params.filename);
  if (!fs.existsSync(fullPath)) {
    throw new AppError('A fénykép nem található a lemezen.', 404);
  }
  res.sendFile(fullPath);
};

// GET /tours/:tourId/images/:filename - the full-resolution original,
// streamed straight from PHOTOS_ROOT.
export const getTourImage = async (req, res) => {
  const tour = await loadTourImage(req.params.tourId, req.params.filename);
  const fullPath = resolveImagePath(config.photosRoot, tour, req.params.filename);
  if (!fs.existsSync(fullPath)) {
    throw new AppError('A fénykép nem található a lemezen.', 404);
  }
  res.sendFile(fullPath);
};

// GET /tours/:tourId/images/:filename/download - same original, forced as
// an attachment (same res.download() pattern documentController.js uses
// for the homepage PDFs).
export const downloadTourImage = async (req, res) => {
  const tour = await loadTourImage(req.params.tourId, req.params.filename);
  const fullPath = resolveImagePath(config.photosRoot, tour, req.params.filename);
  if (!fs.existsSync(fullPath)) {
    throw new AppError('A fénykép nem található a lemezen.', 404);
  }
  res.download(fullPath, req.params.filename);
};

// GET /tours/:tourId/images/download-zip - every recorded image, zipped
// and streamed straight to the response via archiver - never written to a
// temp file on disk.
export const downloadTourImagesZip = async (req, res) => {
  const tour = await Tour.findById(req.params.tourId).select('+images +sourceFolder title slug');
  if (!tour) {
    throw new AppError('No tour found with that ID!', 404);
  }
  if (!tour.sourceFolder || tour.images.length === 0) {
    throw new AppError('Ehhez a táborhoz még nincsenek fényképek feltöltve.', 404);
  }

  const baseDir = path.resolve(config.photosRoot, tour.sourceFolder);

  res.attachment(`${tour.slug || tour.title}-fenykepek.zip`);

  const archive = new ZipArchive();
  archive.on('error', (err) => {
    logger.error(`Zip download failed for tour ${tour._id}: ${err.message}`);
    if (!res.headersSent) {
      res.status(500).json({ status: 'error', message: 'Hiba történt a zip letöltése közben.' });
    } else {
      res.destroy();
    }
  });
  archive.pipe(res);

  for (const { filename } of tour.images) {
    archive.file(path.join(baseDir, filename), { name: filename });
  }

  await archive.finalize();
};
