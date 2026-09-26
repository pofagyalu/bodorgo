import express from 'express';
import {
  getChatMute,
  getPublicKey,
  putChatMute,
  sendTest,
  subscribe,
  unsubscribe,
} from '../controllers/pushController.js';
import requireAuth from '../auth/requireAuth.js';

// Push notifications (see pushController.js) - any logged-in user, for
// their own devices and chats.
const router = express.Router();
router.use(requireAuth);

router.get('/public-key', getPublicKey);
router.route('/subscriptions').post(subscribe).delete(unsubscribe);
router.post('/test', sendTest);
router.route('/chat-mutes/:tourId').get(getChatMute).put(putChatMute);

export default router;
