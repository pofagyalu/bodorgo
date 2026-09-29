import express from 'express';
import * as userController from '../controllers/userController.js';
import requireAuth, { restrictTo } from '../auth/requireAuth.js';
import {
  photoUploadMiddleware,
  getUserPhoto,
  setMyPhoto,
  deleteMyPhoto,
  setUserPhoto,
  deleteUserPhoto,
} from '../controllers/userPhotoController.js';
import {
  getInvitations,
  revokeInvitation,
  sendInvitations,
  sendTestInvitation,
  updateInvitationIntro,
} from '../controllers/invitationController.js';

const router = express.Router();

router.patch('/updateMe', requireAuth, userController.updateMe);
router.get('/me', requireAuth, userController.getMe);
router.get('/me/birthday', requireAuth, userController.getMyBirthday);
router.get('/me/rank', requireAuth, userController.getMyRank);
router.get('/me/attendance', requireAuth, userController.getMyAttendance);
router.get('/me/family', requireAuth, userController.getMyFamily);
router
  .route('/me/photo')
  .put(requireAuth, photoUploadMiddleware, setMyPhoto)
  .delete(requireAuth, deleteMyPhoto);
router
  .route('/:id/photo')
  .get(requireAuth, getUserPhoto)
  .put(requireAuth, restrictTo('admin'), photoUploadMiddleware, setUserPhoto)
  .delete(requireAuth, restrictTo('admin'), deleteUserPhoto);
router.post('/join-family', requireAuth, restrictTo('admin'), userController.joinFamily);
// Meghívók - Authentik invitations (invitationController.js), admins only.
router
  .route('/invitations')
  .get(requireAuth, restrictTo('admin'), getInvitations)
  .post(requireAuth, restrictTo('admin'), sendInvitations);
router.put('/invitations/intro', requireAuth, restrictTo('admin'), updateInvitationIntro);
router.post('/invitations/test', requireAuth, restrictTo('admin'), sendTestInvitation);
router.delete('/:id/invitation', requireAuth, restrictTo('admin'), revokeInvitation);
// Admins filling in everyone's usernames at once (Klub → Beállítások).
router
  .route('/usernames')
  .get(requireAuth, restrictTo('admin'), userController.getUsernames)
  .put(requireAuth, restrictTo('admin'), userController.updateUsernames);

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
