import express from 'express';
import * as dartsController from '../controllers/dartsController.js';
import requireAuth from '../auth/requireAuth.js';
import { requireMoka } from '../jatekok/access.js';

const router = express.Router();

// Móka: the games - everything here is for whoever jatekok/access.js lets
// in. Who may throw in or correct a particular game is checked in
// dartsController.js.
const moka = [requireAuth, requireMoka];

// The people to pick a game's players from.
router.get('/players', moka, dartsController.getPlayers);

router
  .route('/darts/games')
  .get(moka, dartsController.getGames)
  .post(moka, dartsController.createGame);

router.get('/darts/leaderboard', moka, dartsController.getLeaderboard);

router.get('/darts/games/:id', moka, dartsController.getGame);
router.post('/darts/games/:id/throws', moka, dartsController.addThrow);
router.delete('/darts/games/:id/throws/last', moka, dartsController.undoThrow);
router.patch('/darts/games/:id/turns/:turnIdx', moka, dartsController.editTurn);
router.post('/darts/games/:id/finish', moka, dartsController.finishGame);
router.post('/darts/games/:id/abandon', moka, dartsController.abandonGame);

export default router;
