import express from 'express';
import * as futokor from '../controllers/futokorController.js';
import requireAuth, { restrictTo } from '../auth/requireAuth.js';
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

router.get('/active', runner, futokor.getActive);
router.post('/scans', runner, futokor.postScans);

export default router;
