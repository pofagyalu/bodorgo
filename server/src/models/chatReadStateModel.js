import mongoose from 'mongoose';

const { Schema } = mongoose;

// Per user, per chat room: when they last had it open (readAt) and when
// their phone last buzzed about it (notifiedAt) - what keeps chat
// notifications to one buzz until the chat is read (see
// chat/chatNotifications.js). muted: they switched this chat's
// notifications off.
const chatReadStateSchema = new Schema({
  user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  chatRoom: { type: Schema.Types.ObjectId, ref: 'ChatRoom', required: true },
  readAt: { type: Date, default: null },
  notifiedAt: { type: Date, default: null },
  muted: { type: Boolean, default: false },
});
chatReadStateSchema.index({ user: 1, chatRoom: 1 }, { unique: true });

const ChatReadState = mongoose.model('ChatReadState', chatReadStateSchema);

export default ChatReadState;
