import path from 'path';

// Where the server keeps uploaded/generated files on disk (relative to the
// server's working directory, S:\bodorgo in production). Each can be
// pointed elsewhere by an environment variable - only the automated tests
// do that (tests/setup.js), so a test run never writes into the real
// folders.
const rootDir = path.resolve();

// Klub -> Dokumentumok uploads (not in git - copied to the NAS by sync.js).
export const CLUB_DOCUMENTS_DIR = process.env.CLUB_DOCUMENTS_DIR || path.join(rootDir, 'documents');

// Payment receipt PDFs (never synced between machines).
export const RECEIPTS_DIR = process.env.RECEIPTS_DIR || path.join(CLUB_DOCUMENTS_DIR, 'payments');

// Each tour's "Extra infók" uploads, one subfolder per tour id.
export const TOUR_DOCUMENTS_DIR =
  process.env.TOUR_DOCUMENTS_DIR || path.join(rootDir, 'public', 'documents', 'tours');
