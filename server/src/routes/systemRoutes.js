import express from 'express';
import getSystemStatus from '../controllers/heartbeatController.js';
import requireAuth from '../auth/requireAuth.js';
import build from '../utils/version.js';

const router = express.Router();

router.get('/', getSystemStatus);

// Which version of the server is running (utils/version.js) - for anyone
// logged in; the client shows it beside its own.
router.get('/version', requireAuth, (req, res) => {
  res.status(200).json({ status: 'success', data: build });
});

export default router;
