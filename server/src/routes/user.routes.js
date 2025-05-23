import express from 'express';
import * as userController from '../user/user.controller';
import * as authController from '../auth/auth.controller';

const router = express.Router();

router.post('/signup', authController.signup);
router.get('/signedin', authController.signedin);
router.post('/login', authController.login);
router.post('/forgotPassword', authController.forgotPassword);
router.patch('/resetPassword/:token', authController.resetPassword);
router.patch('/verify-email', authController.verifyEmail);

router.use(authController.authUser);

router.delete('/logout', authController.logout);
router.patch('/updateMyPassword', authController.updatePassword);
router.get('/me', userController.getMe, userController.getUser);
router.patch('/updateMe', userController.updateMe);
router.delete('/deleteMe', userController.deleteMe);

router.use(authController.restrictTo('admin'));

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
