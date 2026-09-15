import express from 'express';
import * as userController from '../controllers/userController.js';
import requireAuth, { restrictTo } from '../auth/requireAuth.js';

const router = express.Router();

router.patch('/updateMe', requireAuth, userController.updateMe);
router.delete('/deleteMe', requireAuth, userController.deleteMe);
router.get('/me/attendance', requireAuth, userController.getMyAttendance);
router.get('/me/family', requireAuth, userController.getMyFamily);
router.get('/members', requireAuth, userController.getClubMembers);

router
  .route('/')
  .get(requireAuth, restrictTo('admin'), userController.getAllUsers)
  .post(userController.createUser);
router
  .route('/:id')
  .get(userController.getUser)
  .patch(userController.updateUser)
  .delete(userController.deleteUser);

export default router;
