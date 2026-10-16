import express from 'express';
import {
  getPopular,
  getStats,
  postInstalledApp,
  postViews,
} from '../controllers/viewController.js';
import requireAuth, { restrictTo } from '../auth/requireAuth.js';

// Megtekintések (see viewController.js) - anyone logged in, guests too:
// each of them only ever counts what they may see.
const router = express.Router();
router.use(requireAuth);

// A closing page's last batch comes as text/plain (navigator.sendBeacon).
router.post('/', express.text({ type: 'text/plain', limit: '10kb' }), postViews);
router.get('/popular', getPopular);
router.post('/app', postInstalledApp);
// Klub → Statisztika.
router.get('/stats', restrictTo('admin'), getStats);

export default router;
