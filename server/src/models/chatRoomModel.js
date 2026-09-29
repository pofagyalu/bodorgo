import mongoose from 'mongoose';

const { Schema } = mongoose;

// A Kotyogó conversation. Every chat message (Post) belongs to exactly one
// room - never to a tour directly:
// - 'general': the one club-wide chat, not about any tour (tourId null);
// - 'tour': one per tour, for its own conversation (tourId set).
// Rooms are made on first use (see chat/chatRooms.js), so a new tour needs
// no extra step.
const chatRoomSchema = new Schema(
  {
    type: { type: String, enum: ['general', 'tour'], required: true },
    tourId: {
      type: Schema.Types.ObjectId,
      ref: 'Tour',
      default: null,
      required: [
        function () {
          return this.type === 'tour';
        },
        'Egy tábor Kotyogójához tartoznia kell egy tábornak.',
      ],
    },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

// One room per tour, and a single general room.
chatRoomSchema.index({ tourId: 1 }, { unique: true, partialFilterExpression: { type: 'tour' } });
chatRoomSchema.index({ type: 1 }, { unique: true, partialFilterExpression: { type: 'general' } });

const ChatRoom = mongoose.model('ChatRoom', chatRoomSchema);

export default ChatRoom;
