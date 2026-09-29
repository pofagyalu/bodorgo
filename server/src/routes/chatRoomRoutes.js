import express from 'express';
import {
  chatImageUpload,
  getChatImage,
  getChatImageThumb,
  getGeneralChatRoom,
  postChatImage,
} from '../controllers/chatImageController.js';
import requireAuth from '../auth/requireAuth.js';

// Kotyogó chat rooms (see chat/chatRooms.js) - the general one, and the
// photos sent in any room. A tour's own room: GET /tours/:tourId/chat-room.
// The messages themselves go over Socket.IO (chat/chatSocket.js).
const router = express.Router();
router.use(requireAuth);

router.get('/general', getGeneralChatRoom);
router.post('/:chatRoomId/images', chatImageUpload, postChatImage);
router.get('/:chatRoomId/images/:postId', getChatImage);
router.get('/:chatRoomId/images/:postId/thumb', getChatImageThumb);

export default router;
