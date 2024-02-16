import express from 'express';
import * as userController from '../user/user.controller.js';
import * as authController from '../user/auth.controller.js';

const router = express.Router();

router.post('/signup', authController.signup);
router.post('/login', authController.protect, authController.login);

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
