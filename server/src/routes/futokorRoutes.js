import express from 'express';
import rateLimit from 'express-rate-limit';
import * as futokor from '../controllers/futokorController.js';
import requireAuth, { restrictTo } from '../auth/requireAuth.js';
import { requireFutokor } from '../futokor/access.js';

const router = express.Router();

// Futókör: the running race - everything here is for whoever
// futokor/access.js lets in. The club's cards are the admins'; a course is
// whoever may change it's (a tour's: the admins'; a user's own track: its
// maker's - checked in futokorController.js).
const runner = [requireAuth, requireFutokor];
const admin = [requireAuth, requireFutokor, restrictTo('admin')];

router.route('/tags').get(admin, futokor.getTags).post(admin, futokor.createTags);
// Before /tags/:tagId, so "sheet" isn't taken for a card.
router.get('/tags/sheet', admin, futokor.getTagSheet);
router.patch('/tags/:tagId', admin, futokor.updateTag);

router.route('/courses').get(runner, futokor.getCourses).post(runner, futokor.createCourse);
router
  .route('/courses/:id')
  .patch(runner, futokor.updateCourse)
  .delete(runner, futokor.deleteCourse);
router
  .route('/courses/:id/track')
  .put(runner, futokor.receiveGpx, futokor.putTrack)
  .delete(runner, futokor.deleteTrack);
router.get('/courses/:id/track.gpx', runner, futokor.getTrackFile);
router.get('/courses/:id/sheet', runner, futokor.getCourseSheet);
router.get('/courses/:id/leaderboard', runner, futokor.getLeaderboard);
router.get('/courses/:id/results', runner, futokor.getCourseResults);
router.get('/results', runner, futokor.getResults);

router.get('/active', runner, futokor.getActive);

// Running with a futókód, on a phone nobody is logged in on: these three
// are public. A wrong code counts against the phone's address - after
// thirty in ten minutes it has to wait (nobody guesses others' codes).
const codeLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 30,
  skipSuccessfulRequests: true,
  handler: (req, res) =>
    res.status(429).json({ status: 'fail', message: 'Túl sok próbálkozás – várj pár percet.' }),
});
router.get('/course', futokor.getCourse);
router.post('/runner', codeLimiter, futokor.getRunner);
// (With a code in it; otherwise it's the logged-in user's - see scanRunner.)
router.post('/scans', codeLimiter, futokor.scanRunner, futokor.postScans);

export default router;
