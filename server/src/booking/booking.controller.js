import Stripe from 'stripe';

import config from '../config';
// import Tour from './tour.model';
import catchAsync from '../utils/catch-async';
// import factory from '../middlewares/handler-factory';
// import AppError from '../utils/app-error';

export const getCheckoutSession = catchAsync(async (req, res, next) => {
  //get tour
  const tour = await Tour.findById(req.params.tourId);

  //cretea checkout session
  const stripe = new Stripe(config.stripe.secretKey);

  // const customer = await stripe.customers.create({
  //   payment_method_types: ['card'],
  //   success_url: baseUrl,
  //   cancel_url: `${baseUrl}/appointments`,
  //   customer_email: userEmail,
  //   client_reference_id: appointmentId,
  //   line_items: [
  //     {
  //       name: `${appointment.name} doctor`,
  //       description: Appointment.summary,
  //       amount: appointment.price * 100,
  //       currency: 'huf',
  //     },
  //   ],
  // });

  return customer;
});
