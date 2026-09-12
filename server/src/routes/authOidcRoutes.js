import express from 'express';
import * as authOidcController from '../controllers/authOidcController.js';

const router = express.Router();

// Login redirect (PKCE + Authentik)
router.get('/login', authOidcController.login);

// Authentik callback (token exchange)
router.get('/callback', authOidcController.callback);

router.get('/logout', authOidcController.logout);

router.get('/me', authOidcController.me);

export default router;
