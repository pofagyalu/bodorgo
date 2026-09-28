import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import mongoose from 'mongoose';
import multer from 'multer';
import Document, { DOCUMENT_CATEGORIES, documentFilePath } from '../models/documentModel.js';
import Tour from '../models/tourModel.js';
import AppError from '../utils/appError.js';
import {
  deleteDocumentPreview,
  previewPath,
  tryMakeDocumentPreview,
} from '../utils/documentPreviews.js';

// Klub → Dokumentumok and every tour's Extrák, one mechanism (see
// documentModel.js): the same upload rules, storage, login-gated file
// route and delete - whether a document belongs to the club or to a tour.

const EXTENSIONS = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png' };
const MAX_PER_TOUR = 5;

// .single('file') - one file plus name/category/year (club) or name/tour
// (tour). Kept in memory until the fields are checked, then written where
// it belongs (a tour's folder is only known from the tour field). PDF, JPG
// or PNG, 15 MB - generous for a scanned or photographed paper.
export const uploadMiddleware = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!EXTENSIONS[file.mimetype]) {
      cb(new AppError('Csak PDF, JPG vagy PNG fájl tölthető fel.', 400));
      return;
    }
    cb(null, true);
  },
}).single('file');

// The card fields the pages need - the same shape for both kinds.
const view = (d) => ({
  _id: d._id,
  name: d.name,
  filename: d.filename,
  mimeType: d.mimeType,
  tour: d.tour ?? null,
  category: d.category ?? null,
  year: d.year ?? null,
  preview: !!d.preview,
  createdAt: d.createdAt,
});

// A tour's Extrák, for the tour page and its PDF (tourController.js,
// tourPdfController.js).
export async function tourDocuments(tourId) {
  return (await Document.find({ tour: tourId }).sort('createdAt')).map(view);
}

// GET /documents - the club's documents; ?tour=<id>: that tour's Extrák.
export const getDocuments = async (req, res) => {
  const { tour } = req.query;
  if (tour && !mongoose.isValidObjectId(tour)) throw new AppError('Nincs ilyen tábor.', 404);
  const documents = tour
    ? await Document.find({ tour }).sort('createdAt')
    : await Document.find({ tour: null }).sort({ category: 1, year: -1, createdAt: -1 });
  res.status(200).json({ status: 'success', data: { documents: documents.map(view) } });
};

// POST /documents - admin: { file, name, category?, year? } for the club,
// { file, name, tour } for a tour's Extrák.
export const uploadDocument = async (req, res) => {
  if (!req.file) throw new AppError('Nincs feltöltött fájl.', 400);
  const name = req.body.name?.trim();
  if (!name) throw new AppError('A dokumentumnak kell legyen neve.', 400);

  let tour = null;
  if (req.body.tour) {
    tour = mongoose.isValidObjectId(req.body.tour)
      ? await Tour.findById(req.body.tour).select('order slug')
      : null;
    if (!tour) throw new AppError('Nincs ilyen tábor.', 404);
    if ((await Document.countDocuments({ tour: tour._id })) >= MAX_PER_TOUR) {
      throw new AppError(
        `Legfeljebb ${MAX_PER_TOUR} extra dokumentum tölthető fel egy táborhoz.`,
        400,
      );
    }
  }

  // "klub-dok-…" / "tour-<order>-<slug>-…": recognizable on disk, unique,
  // and never the uploaded file's own (possibly unsafe) name.
  const unique = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const filename = `${tour ? `tour-${tour.order}-${tour.slug}` : 'klub-dok'}-${unique}.${EXTENSIONS[req.file.mimetype]}`;
  const document = new Document({
    name,
    filename,
    tour: tour?._id,
    ...(!tour && {
      category: DOCUMENT_CATEGORIES.includes(req.body.category) ? req.body.category : 'Egyéb',
      year: req.body.year ? Number(req.body.year) : undefined,
    }),
    uploadedBy: req.user._id,
  });
  const file = documentFilePath(document);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, req.file.buffer);
  await document.save();

  // A club document's card picture - a moment for a PDF page; if it fails,
  // the card shows an icon and the next server start tries again.
  if (!tour) await tryMakeDocumentPreview(document);

  res.status(201).json({ status: 'success', data: { document: view(document) } });
};

async function findDocument(id) {
  const document = mongoose.isValidObjectId(id) ? await Document.findById(id) : null;
  if (!document) throw new AppError('Nincs ilyen dokumentum.', 404);
  return document;
}

// Sends the file - inline for the browser's own viewer, or with
// ?download=1 as an attachment named after the document ("Alapító
// okirat.pdf"). A plain <a download> doesn't work across the client's and
// the API's subdomains, so the server sets it.
function sendDocument(req, res, document) {
  const file = documentFilePath(document);
  if (!fs.existsSync(file)) throw new AppError('A dokumentum fájlja nem található.', 404);
  if (req.query.download) {
    const safeName = document.name.replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'dokumentum';
    return res.download(file, `${safeName}${path.extname(document.filename)}`);
  }
  res.sendFile(file);
}

// GET /documents/:id/file - any logged-in user.
export const getDocumentFile = async (req, res) => {
  sendDocument(req, res, await findDocument(req.params.id));
};

// GET /documents/tours/:tourId/:filename - the address tour documents had
// before they moved here; kept so links already sent out still work.
export const getLegacyTourDocument = async (req, res) => {
  const { tourId, filename } = req.params;
  const document =
    mongoose.isValidObjectId(tourId) && (await Document.findOne({ tour: tourId, filename }));
  if (!document) throw new AppError('Nincs ilyen dokumentum.', 404);
  sendDocument(req, res, document);
};

// GET /documents/:id/preview - any logged-in user: a club document card's
// small picture (a PDF's first page, or the photo).
export const getDocumentPreview = async (req, res) => {
  const document = await findDocument(req.params.id);
  const file = document.preview && previewPath(document.filename);
  if (!file || !fs.existsSync(file)) throw new AppError('Nincs előnézet.', 404);
  res.setHeader('Cache-Control', 'private, max-age=86400');
  res.sendFile(file);
};

// DELETE /documents/:id - admin; the file and its preview go too.
export const deleteDocument = async (req, res) => {
  const document = await findDocument(req.params.id);
  fs.rm(documentFilePath(document), { force: true }, () => {}); // a missing file mustn't block it
  deleteDocumentPreview(document.filename);
  await Document.deleteOne({ _id: document._id });
  res.status(204).json({ status: 'success', data: null });
};
