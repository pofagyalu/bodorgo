import fs from 'fs';
import path from 'path';
import { ZipArchive } from 'archiver';
import Tour from '../models/tourModel.js';
import Reservation from '../models/reservationModel.js';
import AppError from '../utils/appError.js';
import config from '../config.js';
import logger from '../logger.js';

// A restricted photo (see tourModel.js's images.restricted) is visible to
// an admin, or to anyone who actually attended *this* tour - same
// attendee check as getMyAttendance/reservationController.js, just phrased
// as "did this user show up on this tour" rather than "which tours did
// this user attend". Not cached - restricted photos are meant to be rare
// ("not too many"), so one extra query per request is a non-issue.
async function canViewRestrictedImages(user, tourId) {
  if (user.role === 'admin') return true;
  const attended = await Reservation.exists({ tour: tourId, 'attendees.user': user._id });
  return !!attended;
}

// Loads a tour with its gallery fields (select:false by default - see
// tourModel.js - so every handler here has to opt back in explicitly),
// validates filename against its recorded image list, and enforces the
// restricted-image check above. This is the only thing standing between a
// client-supplied filename and a raw filesystem read, so every image
// route funnels through it - never trust the filename alone, even though
// the sync script only ever writes plain, already-sanitized names into
// `images`.
//
// A restricted photo a viewer isn't allowed to see gets the exact same
// "not found" error as a filename that was never recorded at all -
// deliberately indistinguishable, so nobody outside the allowed set can
// even tell a restricted photo exists in the gallery.
async function loadTourImage(tourId, filename, user) {
  const tour = await Tour.findById(tourId).select('+images +sourceFolder title slug');
  if (!tour) {
    throw new AppError('No tour found with that ID!', 404);
  }
  const image = tour.images.find((i) => i.filename === filename);
  if (!image || (image.restricted && !(await canViewRestrictedImages(user, tourId)))) {
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
// tourId + filename itself. A restricted photo is simply left out entirely
// for anyone who isn't allowed to see it - not marked/greyed-out, omitted,
// so its existence isn't revealed either.
export const getTourImages = async (req, res) => {
  const tour = await Tour.findById(req.params.tourId).select('+images');
  if (!tour) {
    throw new AppError('No tour found with that ID!', 404);
  }

  const canSeeRestricted = await canViewRestrictedImages(req.user, req.params.tourId);
  const images = tour.images.filter((i) => !i.restricted || canSeeRestricted);

  res.status(200).json({ status: 'success', data: { images } });
};

// GET /tours/:tourId/images/:filename/thumb - the pre-generated .webp from
// THUMBNAILS_ROOT (see scripts/syncTourImages.js). Falls back to the full
// original if no thumbnail exists yet (a sync that failed partway, or a
// photo added to the folder by hand) rather than 404ing the whole gallery
// grid over one missing thumbnail.
export const getTourImageThumb = async (req, res) => {
  const tour = await loadTourImage(req.params.tourId, req.params.filename, req.user);

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
  const tour = await loadTourImage(req.params.tourId, req.params.filename, req.user);
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
  const tour = await loadTourImage(req.params.tourId, req.params.filename, req.user);
  const fullPath = resolveImagePath(config.photosRoot, tour, req.params.filename);
  if (!fs.existsSync(fullPath)) {
    throw new AppError('A fénykép nem található a lemezen.', 404);
  }
  res.download(fullPath, req.params.filename);
};

// PATCH /tours/:tourId/images/:filename - admin-only. Marks/unmarks one
// photo as restricted to that tour's own attendees (see
// canViewRestrictedImages above) - a rare, hand-picked action for the
// occasional sensitive photo, not a bulk operation.
export const setImageRestricted = async (req, res) => {
  const tour = await Tour.findById(req.params.tourId).select('+images');
  if (!tour) {
    throw new AppError('No tour found with that ID!', 404);
  }

  const image = tour.images.find((i) => i.filename === req.params.filename);
  if (!image) {
    throw new AppError('Nincs ilyen fénykép ehhez a táborhoz.', 404);
  }

  image.restricted = !!req.body.restricted;
  await tour.save();

  res.status(200).json({ status: 'success', data: { image } });
};

// GET /tours/:tourId/images/download-zip - every recorded image the
// requester is allowed to see, zipped and streamed straight to the
// response via archiver - never written to a temp file on disk. A
// restricted photo the requester can't view is simply left out, same as
// the list endpoint.
export const downloadTourImagesZip = async (req, res) => {
  const tour = await Tour.findById(req.params.tourId).select('+images +sourceFolder title slug');
  if (!tour) {
    throw new AppError('No tour found with that ID!', 404);
  }

  const canSeeRestricted = await canViewRestrictedImages(req.user, req.params.tourId);
  const images = tour.images.filter((i) => !i.restricted || canSeeRestricted);

  if (!tour.sourceFolder || images.length === 0) {
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

  for (const { filename } of images) {
    archive.file(path.join(baseDir, filename), { name: filename });
  }

  await archive.finalize();
};
