import express from 'express';
import * as dartsController from '../controllers/dartsController.js';
import * as quizController from '../controllers/quizController.js';
import requireAuth from '../auth/requireAuth.js';
import { requireMoka } from '../jatekok/access.js';

const router = express.Router();

// Móka: the games - Darts is for whoever jatekok/access.js lets in. Who
// may throw in or correct a particular game is checked in
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

// Kvíz: open to everyone logged in (a game needs its players) - whose a
// quiz is, and who leads or plays a game, is checked in quizController.js.
router
  .route('/quiz/quizzes')
  .get(requireAuth, quizController.getQuizzes)
  .post(requireAuth, quizController.createQuiz);
router
  .route('/quiz/quizzes/:id')
  .get(requireAuth, quizController.getQuiz)
  .put(requireAuth, quizController.updateQuiz)
  .delete(requireAuth, quizController.deleteQuiz);
router.post('/quiz/quizzes/:id/games', requireAuth, quizController.startGame);

// A picture question's picture: one's own, or a copy of a tour's photo.
router.post(
  '/quiz/images',
  requireAuth,
  quizController.quizImageUpload,
  quizController.uploadImage,
);
router.post('/quiz/images/from-tour', requireAuth, quizController.imageFromTour);
router.get('/quiz/images/:name', requireAuth, quizController.getImage);

router.get('/quiz/games', requireAuth, quizController.getGames);
router.get('/quiz/leaderboard', requireAuth, quizController.getLeaderboard);
// Before games/:id, so "pin" isn't taken for a game's id.
router.get('/quiz/games/pin/:pin', requireAuth, quizController.findByPin);
router.get('/quiz/games/:id', requireAuth, quizController.getGame);
router.get('/quiz/games/:id/qr', requireAuth, quizController.getGameQr);
router.post('/quiz/games/:id/join', requireAuth, quizController.joinGame);
router.post('/quiz/games/:id/next', requireAuth, quizController.nextStep);
router.post('/quiz/games/:id/answers', requireAuth, quizController.answerQuestion);
router.post('/quiz/games/:id/abandon', requireAuth, quizController.abandonGame);

export default router;
