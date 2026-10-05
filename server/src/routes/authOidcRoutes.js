import express from 'express';
import rateLimit from 'express-rate-limit';
import * as authOidcController from '../controllers/authOidcController.js';

const router = express.Router();

// Which login the page shows: the provider's, or e-mail and password
// (LOCAL_LOGIN in .env).
router.get('/mode', authOidcController.mode);

// Password login - ten wrong tries from an address in a quarter of an hour,
// then it has to wait.
const passwordLimiter = rateLimit({
  windowMs: 15 * 60000,
  limit: 10,
  skipSuccessfulRequests: true,
  // The automated tests try more wrong ones than that.
  skip: () => process.env.NODE_ENV === 'test',
  handler: (req, res) =>
    res.status(429).json({
      status: 'fail',
      message: 'Túl sok sikertelen próbálkozás - próbáld újra negyed óra múlva.',
    }),
});
router.post('/local-login', passwordLimiter, authOidcController.localLogin);

// Login redirect (PKCE + Authentik)
router.get('/login', authOidcController.login);

// Authentik callback (token exchange)
router.get('/callback', authOidcController.callback);

router.get('/logout', authOidcController.logout);

router.get('/me', authOidcController.me);

export default router;
