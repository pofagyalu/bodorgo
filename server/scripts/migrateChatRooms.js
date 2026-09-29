// One-off migration to chat rooms (see src/models/chatRoomModel.js): every
// chat message used to point at a tour (post.tourId); now it points at a
// chat room (post.chatRoomId), and the "seen"/mute state is per room too.
//
// - makes the general room (if there's none yet);
// - makes a room for every tour that has messages, points those messages at
//   it and drops their tourId;
// - moves each ChatReadState from its tour to that tour's room - merged
//   into the one already there, if the new app made one meanwhile (a
//   running server writes per-room states at once): the later read/notified
//   times, and muted if either was;
// - drops the old indexes that were built on the tour fields (the unique
//   user+tour one would otherwise reject the moved read states).
//
// Reads with the raw collections: the models no longer know `tourId`/
// `tour`. Safe to re-run - what's already moved is skipped.
//
// Usage (the database in DB_URI - dev by default, the local .env):
//   node scripts/migrateChatRooms.js
//   DB_URI="<live, from S:/bodorgo/.env>" node scripts/migrateChatRooms.js

import 'dotenv/config';
import mongoose from 'mongoose';
import config from '../src/config.js';
import ChatRoom from '../src/models/chatRoomModel.js';
import { generalChatRoom } from '../src/chat/chatRooms.js';

// Any failure: say so and stop (the app's logger would otherwise keep the
// process hanging after an error).
const fail = (err) => {
  console.error(`FAILED: ${err?.message ?? err}`);
  process.exit(1);
};
process.on('unhandledRejection', fail);
process.on('uncaughtException', fail);

await mongoose.connect(config.db.uri);
const db = mongoose.connection.db;
console.log(`Database: ${db.databaseName}`);

async function dropIndexIfThere(collection, name) {
  const indexes = await db.collection(collection).indexes();
  if (indexes.some((i) => i.name === name)) {
    await db.collection(collection).dropIndex(name);
    console.log(`Dropped index ${collection}.${name}`);
  }
}

// The unique user+tour index first - moved read states would clash on it.
await dropIndexIfThere('chatreadstates', 'user_1_tour_1');
await dropIndexIfThere('posts', 'tourId_1');
await ChatRoom.syncIndexes();

const general = await generalChatRoom();
console.log(`General room: ${general._id}`);

// A tour's room - made here directly (the tour may since have been
// deleted; its messages still get a room).
async function roomOfTour(tourId) {
  return ChatRoom.findOneAndUpdate(
    { type: 'tour', tourId },
    { $setOnInsert: { type: 'tour', tourId } },
    { upsert: true, returnDocument: 'after' },
  );
}

const posts = db.collection('posts');
const tourIds = await posts.distinct('tourId', { tourId: { $exists: true } });
let movedPosts = 0;
for (const tourId of tourIds) {
  const room = await roomOfTour(tourId);
  const { modifiedCount } = await posts.updateMany(
    { tourId },
    { $set: { chatRoomId: room._id }, $unset: { tourId: '' } },
  );
  movedPosts += modifiedCount;
  console.log(`Tour ${tourId} -> room ${room._id}: ${modifiedCount} messages`);
}

const states = db.collection('chatreadstates');
const oldStates = await states.find({ tour: { $exists: true } }).toArray();
const later = (a, b) => (!a ? (b ?? null) : !b ? a : a > b ? a : b);
let movedStates = 0;
let mergedStates = 0;
for (const state of oldStates) {
  const room = await roomOfTour(state.tour);
  const existing = await states.findOne({ user: state.user, chatRoom: room._id });
  if (existing) {
    await states.updateOne(
      { _id: existing._id },
      {
        $set: {
          readAt: later(existing.readAt, state.readAt),
          notifiedAt: later(existing.notifiedAt, state.notifiedAt),
          muted: !!(existing.muted || state.muted),
        },
      },
    );
    await states.deleteOne({ _id: state._id });
    mergedStates++;
  } else {
    await states.updateOne(
      { _id: state._id },
      { $set: { chatRoom: room._id }, $unset: { tour: '' } },
    );
    movedStates++;
  }
}

// Two states for the same person and room (e.g. from an interrupted
// earlier run, or the app writing meanwhile): merged into one.
const dupes = await states
  .aggregate([
    { $match: { chatRoom: { $exists: true } } },
    { $sort: { _id: 1 } },
    { $group: { _id: { user: '$user', chatRoom: '$chatRoom' }, docs: { $push: '$$ROOT' } } },
    { $match: { 'docs.1': { $exists: true } } },
  ])
  .toArray();
for (const { docs } of dupes) {
  const [keep, ...rest] = docs;
  await states.updateOne(
    { _id: keep._id },
    {
      $set: {
        readAt: docs.reduce((t, d) => later(t, d.readAt), null),
        notifiedAt: docs.reduce((t, d) => later(t, d.notifiedAt), null),
        muted: docs.some((d) => d.muted),
      },
    },
  );
  await states.deleteMany({ _id: { $in: rest.map((d) => d._id) } });
  mergedStates += rest.length;
}

// The new unique user+room index (the app would make it too, at start).
await db
  .collection('chatreadstates')
  .createIndex({ user: 1, chatRoom: 1 }, { unique: true, name: 'user_1_chatRoom_1' });

const left = await posts.countDocuments({ chatRoomId: { $exists: false } });
console.log(
  `Done: ${movedPosts} messages and ${movedStates} read states moved ` +
    `(${mergedStates} merged into the new ones); ` +
    `${await ChatRoom.countDocuments()} rooms; messages without a room: ${left}.`,
);
await mongoose.disconnect();
// The app's logger keeps the process alive - end it here.
process.exit(0);
