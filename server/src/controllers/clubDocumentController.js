import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import multer from 'multer';
import ClubDocument, { DOCUMENT_CATEGORIES } from '../models/clubDocumentModel.js';
import AppError from '../utils/appError.js';
import { CLUB_DOCUMENTS_DIR } from '../utils/dataDirs.js';

// Same directory documentController.js's getDocument already serves from
// (outside public/, requireAuth-gated) - so an uploaded club document is
// reachable the exact same way the two original hand-placed PDFs already
// were, with no change needed to that route at all.
const DOCUMENTS_DIR = CLUB_DOCUMENTS_DIR;

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    fs.mkdirSync(DOCUMENTS_DIR, { recursive: true });
    cb(null, DOCUMENTS_DIR);
  },
  // Server-generated, not the original upload filename - guarantees no
  // collision and no unsafe characters, same reasoning as
  // tourDocumentController.js's own filename callback. Extension follows
  // the actual upload (PDF, or a phone photo/screenshot of a paper
  // document as JPEG/PNG), not hardcoded to .pdf - see fileFilter below
  // for the allowed types.
  filename: (req, file, cb) => {
    const unique = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    const ext = file.mimetype === 'image/jpeg' ? 'jpg' : file.mimetype === 'image/png' ? 'png' : 'pdf';
    cb(null, `klub-dok-${unique}.${ext}`);
  },
});

const ALLOWED_MIME_TYPES = ['application/pdf', 'image/jpeg', 'image/png'];

// .single('file') - the upload form sends one file plus name/category/year
// fields. PDF, JPEG or PNG (a phone photo or screenshot of a paper
// document is a common case here), 15MB cap - generous for a scanned/
// photographed document, not unbounded.
export const uploadMiddleware = multer({
  storage,
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      cb(new AppError('Csak PDF, JPG vagy PNG fájl tölthető fel.', 400));
      return;
    }
    cb(null, true);
  },
}).single('file');

// GET /documents - requireAuth (any logged-in member can view the list -
// see documentRoutes.js). Metadata only, not the file itself.
export const getClubDocuments = async (req, res) => {
  const documents = await ClubDocument.find().sort({ category: 1, year: -1, createdAt: -1 });
  res.status(200).json({ status: 'success', data: { documents } });
};

// POST /documents - requireAuth, restrictTo('admin').
export const uploadClubDocument = async (req, res) => {
  if (!req.file) {
    throw new AppError('Nincs feltöltött fájl.', 400);
  }

  const name = req.body.name?.trim();
  if (!name) {
    fs.unlink(req.file.path, () => {});
    throw new AppError('A dokumentumnak kell legyen neve.', 400);
  }

  const category = DOCUMENT_CATEGORIES.includes(req.body.category) ? req.body.category : 'Egyéb';
  const year = req.body.year ? Number(req.body.year) : undefined;

  const document = await ClubDocument.create({
    name,
    filename: req.file.filename,
    category,
    year,
    uploadedBy: req.user._id,
  });

  res.status(201).json({ status: 'success', data: { document } });
};

// DELETE /documents/:id - requireAuth, restrictTo('admin'). :id is the
// ClubDocument's own _id - a different id space from
// documentController.js's GET /documents/:filename, so the two routes'
// shared ":something" path shape never actually collides (different HTTP
// methods, and this only ever gets a real ObjectId).
export const deleteClubDocument = async (req, res) => {
  const document = await ClubDocument.findById(req.params.id);
  if (!document) {
    throw new AppError('Nincs ilyen dokumentum.', 404);
  }

  const filePath = path.join(DOCUMENTS_DIR, document.filename);
  fs.unlink(filePath, () => {}); // best-effort - a missing file shouldn't block removing the record

  await ClubDocument.deleteOne({ _id: document._id });

  res.status(204).json({ status: 'success', data: null });
};
