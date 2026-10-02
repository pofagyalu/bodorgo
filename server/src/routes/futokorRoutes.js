import express from 'express';
import * as futokor from '../controllers/futokorController.js';
import requireAuth, { restrictTo } from '../auth/requireAuth.js';
import rateLimit from 'express-rate-limit';
import { requireFutokor } from '../futokor/access.js';

const router = express.Router();

// Futókör: the running race - everything here is for whoever
// futokor/access.js lets in; the cards and the courses are the admins'.
const runner = [requireAuth, requireFutokor];
const admin = [requireAuth, requireFutokor, restrictTo('admin')];

router.route('/tags').get(admin, futokor.getTags).post(admin, futokor.createTags);
// Before /tags/:tagId, so "sheet" isn't taken for a card.
router.get('/tags/sheet', admin, futokor.getTagSheet);
router.patch('/tags/:tagId', admin, futokor.updateTag);

router.route('/courses').get(admin, futokor.getCourses).post(admin, futokor.createCourse);
router.route('/courses/:id').patch(admin, futokor.updateCourse).delete(admin, futokor.deleteCourse);
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
