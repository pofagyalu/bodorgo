import express from 'express';
import {
  chatImageUpload,
  getChatImage,
  getChatImageThumb,
  getChatOverview,
  getGeneralChatRoom,
  getGeneralGame,
  getGeneralPeople,
  postChatImage,
} from '../controllers/chatImageController.js';
import { createGeneralPoll } from '../controllers/pollController.js';
import requireAuth from '../auth/requireAuth.js';

// Kotyogó chat rooms (see chat/chatRooms.js) - the general one (its people
// for "@", its polls), and the photos sent in any room. A tour's own room:
// GET /tours/:tourId/chat-room. The messages themselves go over Socket.IO
// (chat/chatSocket.js).
const router = express.Router();
router.use(requireAuth);

// The list of Kotyogós, each with its last message and unread count.
router.get('/overview', getChatOverview);
router.get('/general', getGeneralChatRoom);
router.get('/general/people', getGeneralPeople);
// The launch game's podium (chat/firstWritersGame.js).
router.get('/general/game', getGeneralGame);
// A poll from the general room - anyone logged in (see pollController.js).
router.post('/general/polls', createGeneralPoll);
router.post('/:chatRoomId/images', chatImageUpload, postChatImage);
router.get('/:chatRoomId/images/:postId', getChatImage);
router.get('/:chatRoomId/images/:postId/thumb', getChatImageThumb);

export default router;
