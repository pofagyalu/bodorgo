import { Schema, model, Types } from 'mongoose';

const PostSchema = new Schema(
  {
    creator: {
      type: Types.ObjectId,
      ref: 'User',
      required: true,
    },

    tourId: {
      type: Types.ObjectId,
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
  },
  {
    timestamps: true, // creates createdAt + updatedAt
  },
);

const Post = model('Post', PostSchema);

export default Post;
