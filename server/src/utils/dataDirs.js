import path from 'path';

// Where the server keeps uploaded/generated files on disk (relative to the
// server's working directory, S:\bodorgo in production). Each can be
// pointed elsewhere by an environment variable - only the automated tests
// do that (tests/setup.js), so a test run never writes into the real
// folders.
const rootDir = path.resolve();

// Uploaded documents (not in git, never copied between machines): the
// club's own right here, each tour's Extrák in tours/<tourId>/ - see
// documentModel.js.
export const CLUB_DOCUMENTS_DIR = process.env.CLUB_DOCUMENTS_DIR || path.join(rootDir, 'documents');

// Payment receipt PDFs (never synced between machines).
export const RECEIPTS_DIR = process.env.RECEIPTS_DIR || path.join(CLUB_DOCUMENTS_DIR, 'payments');

// GPX tracks - every one the app is given, whatever it's for (a Futókör
// course's loop now; a tour's hike later): the files as they were
// uploaded, named by their record's id (see gpxTrackModel.js). Under
// documents/, so - like everything there - never synced between machines
// and not watched by pm2.
export const GPX_DIR = process.env.GPX_DIR || path.join(CLUB_DOCUMENTS_DIR, 'gpx');

// Photos sent in the tour chats (see chat/chatImages.js) - kept under a
// size quota, the oldest going first. Not in git, never synced; pm2 must
// not watch it (/volume2/server/ecosystem.config.js's ignore_watch).
export const CHAT_IMAGES_DIR = process.env.CHAT_IMAGES_DIR || path.join(rootDir, 'chat-images');
