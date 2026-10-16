import express from 'express';
import { getPopular, postViews } from '../controllers/viewController.js';
import requireAuth from '../auth/requireAuth.js';

// Megtekintések (see viewController.js) - anyone logged in, guests too:
// each of them only ever counts what they may see.
const router = express.Router();
router.use(requireAuth);

// A closing page's last batch comes as text/plain (navigator.sendBeacon).
router.post('/', express.text({ type: 'text/plain', limit: '10kb' }), postViews);
router.get('/popular', getPopular);

export default router;
