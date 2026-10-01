import mongoose from 'mongoose';

const { Schema } = mongoose;

// A game played in a chat - so far the one, played once: "the first three
// to write in Bódorgók" (see chat/firstWritersGame.js). One document per
// game (`key`); it exists from the moment the game starts, and stays as
// its record.
const chatGameSchema = new Schema({
  key: { type: String, required: true, unique: true },
  chatRoom: { type: Schema.Types.ObjectId, ref: 'ChatRoom', required: true },
  // Who started it (they can't win), and when.
  startedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  startedAt: { type: Date, required: true },
  // In order: 1st, 2nd, 3rd.
  winners: {
    type: [
      {
        _id: false,
        user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
        at: { type: Date, required: true },
      },
    ],
    default: [],
  },
  // Set when the last place was taken.
  finishedAt: { type: Date, default: null },
});

const ChatGame = mongoose.model('ChatGame', chatGameSchema);

export default ChatGame;
