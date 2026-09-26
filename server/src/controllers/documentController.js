import fs from 'fs';
import path from 'path';
import AppError from '../utils/appError.js';
import { CLUB_DOCUMENTS_DIR } from '../utils/dataDirs.js';

// Deliberately outside public/ (see app.js's express.static) - these files
// are only ever reachable through this requireAuth-gated route, not as a
// plain unauthenticated static asset like tour images are.
const DOCUMENTS_DIR = CLUB_DOCUMENTS_DIR;

// Any logged-in user (guest/bodorgo/admin alike) can fetch a document -
// see documentRoutes.js, this is the "bare minimum" protection asked for,
// not restricted by role.
export const getDocument = (req, res) => {
  const { filename } = req.params;

  // Only a plain "name.pdf"/"name.jpg"/"name.png" shape is ever legitimate
  // here - rejects anything trying to escape DOCUMENTS_DIR (../, absolute
  // paths, etc.) since this reads straight off disk from a client-supplied
  // name. jpe?g/png cover clubDocumentController.js's own club-document
  // uploads (a photographed/screenshotted paper document), alongside the
  // original PDF-only case.
  if (!/^[\w.-]+\.(pdf|jpe?g|png)$/i.test(filename)) {
    throw new AppError('Invalid document name', 400);
  }

  const filePath = path.join(DOCUMENTS_DIR, filename);
  if (!fs.existsSync(filePath)) {
    throw new AppError('Document not found', 404);
  }

  // ?download=1 forces a save-as via Content-Disposition: attachment -
  // the HTML <a download> attribute alone doesn't reliably work for a
  // cross-origin URL (client and API are on different subdomains in
  // production), so the server has to set this header itself instead.
  // Without it, sendFile serves the PDF inline for the browser's own viewer.
  if (req.query.download) {
    return res.download(filePath, filename);
  }

  res.sendFile(filePath);
};
