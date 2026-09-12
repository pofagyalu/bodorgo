import express from 'express';
import getSystemStatus from '../controllers/heartbeatController.js';

const router = express.Router();

router.get('/', getSystemStatus);

export default router;
