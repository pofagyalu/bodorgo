import { Schema, model } from 'mongoose';

// The reactions a chat message can get: tetszik, nevetés, meglepődés,
// szomorú, sírás.
export const REACTIONS = ['👍', '😂', '😮', '😢', '😭'];

// What a message goes out with, wherever it's sent: its author's and
// every reacting person's name/username.
export const POST_POPULATE = [
  { path: 'creator', select: 'name username' },
  { path: 'reactions.user', select: 'name username' },
];

const PostSchema = new Schema(
  {
    creator: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },

    // The chat room it was written in (see chatRoomModel.js) - the general
    // one or a tour's; never a tour directly.
    chatRoomId: {
      type: Schema.Types.ObjectId,
      ref: 'ChatRoom',
      required: true,
      index: true, // each chat room is efficiently searchable
    },

    text: {
      type: String,
      trim: true,
      default: '',
    },

    // A photo sent with the message (see chat/chatImages.js): the files are
    // <post id>.webp and <post id>.thumb.webp in CHAT_IMAGES_DIR. expired:
    // removed by the size quota (oldest first) - the message stays, the
    // photo shows as "no longer available".
    image: {
      type: new Schema(
        {
          width: Number,
          height: Number,
          size: Number, // bytes, both files together
          expired: { type: Boolean, default: false },
        },
        { _id: false },
      ),
      default: null,
    },

    // A poll started from the chat - the message shows its live card
    // instead of plain text (text holds the question, for notifications).
    poll: {
      type: Schema.Types.ObjectId,
      ref: 'Poll',
      default: null,
    },

    // Hangulatjelek - one per person (picking another replaces it, the same
    // one again removes it; see chatSocket.js's react-post).
    reactions: {
      type: [
        {
          _id: false,
          user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
          emoji: { type: String, enum: REACTIONS, required: true },
        },
      ],
      default: [],
    },

    // Set when the author edits the text afterwards - shown as
    // "(szerkesztve)" next to the time (see chatSocket.js's edit-post).
    editedAt: {
      type: Date,
    },

    // Set when the author deletes it: the post stays in the conversation as
    // a "Hozzászólás törölve" placeholder, but its text is wiped, not just
    // hidden (see chatSocket.js's delete-post).
    deletedAt: {
      type: Date,
    },
  },
  {
    timestamps: true, // creates createdAt + updatedAt
  },
);

const Post = model('Post', PostSchema);

export default Post;
