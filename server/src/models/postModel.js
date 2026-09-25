import { Schema, model } from 'mongoose';

const PostSchema = new Schema(
  {
    creator: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },

    tourId: {
      type: Schema.Types.ObjectId,
      ref: 'Tour',
      required: true,
      index: true, // each chat room is efficiently searchable
    },

    text: {
      type: String,
      trim: true,
      default: '',
    },

    image: {
      type: String, // store URL or file path
      default: null,
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
