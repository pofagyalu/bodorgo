import express from 'express';
import {
  getLibraryBook,
  getLibraryPage,
  getLibraryPageOpening,
  getLibraryTocProposal,
  libraryOwnerOnly,
  listLibrary,
  scanLibrary,
  searchLibrary,
  updateLibraryBook,
  uploadLibraryBook,
} from '../controllers/libraryController.js';
import requireAuth from '../auth/requireAuth.js';

// Média → Könyvtár - the role manager's own books, nobody else's.
const router = express.Router();
router.use(requireAuth, libraryOwnerOnly);
// A long table of contents is more than the app's 10 kB for a JSON body
// (this router is mounted before that parser - see app.js).
router.use(express.json({ limit: '500kb' }));

router.get('/', listLibrary);
router.post('/scan', scanLibrary);
router.get('/search', searchLibrary);
router.get('/books/:id', getLibraryBook);
router.patch('/books/:id', updateLibraryBook);
router.get('/books/:id/toc-proposal', getLibraryTocProposal);
router.get('/books/:id/pages/:page', getLibraryPage);
router.get('/books/:id/pages/:page/opening', getLibraryPageOpening);
router.post('/shelves/:shelf/books', uploadLibraryBook);

export default router;
