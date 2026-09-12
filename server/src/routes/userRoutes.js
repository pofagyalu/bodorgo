import express from 'express';
import * as userController from '../controllers/userController.js';
import requireAuth from '../auth/requireAuth.js';

const router = express.Router();

router.patch('/updateMe', requireAuth, userController.updateMe);
router.delete('/deleteMe', requireAuth, userController.deleteMe);

router
  .route('/')
  .get(userController.getAllUsers)
  .post(userController.createUser);
router
  .route('/:id')
  .get(userController.getUser)
  .patch(userController.updateUser)
  .delete(userController.deleteUser);

export default router;
