import express from 'express';
import * as bookingController from '../booking/booking.controller';
import * as authController from '../auth/auth.controller';

const router = express.Router();

router.get(
  '/create-checkout-session/:tourId',
  authController.authUser,
  bookingController.getCheckoutSession,
);
export default router;
