import express from 'express';
import * as userController from '../controllers/userController.js';
import requireAuth, { restrictTo } from '../auth/requireAuth.js';

const router = express.Router();

router.patch('/updateMe', requireAuth, userController.updateMe);
router.get('/me', requireAuth, userController.getMe);
router.get('/me/attendance', requireAuth, userController.getMyAttendance);
router.get('/me/family', requireAuth, userController.getMyFamily);
router.post('/join-family', requireAuth, restrictTo('admin'), userController.joinFamily);

router
  .route('/')
  .get(requireAuth, restrictTo('admin', 'member'), userController.getAllUsers)
  .post(requireAuth, restrictTo('admin'), userController.createUser);
router
  .route('/:id')
  .get(requireAuth, restrictTo('admin'), userController.getUser)
  .patch(requireAuth, restrictTo('admin'), userController.updateUser)
  .delete(requireAuth, restrictTo('admin'), userController.archiveUser);
router.patch('/:id/restore', requireAuth, restrictTo('admin'), userController.restoreUser);

export default router;
