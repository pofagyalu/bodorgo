// Read-only diagnosis: why did (or didn't) the latest chat message send a
// push notification? For the newest post: its tour, and for every attendee
// the things notifyChatPost (src/chat/chatNotifications.js) checks - push
// subscriptions, mute, last read / last buzz.
//
// Usage: node scripts/checkChatPush.js
import 'dotenv/config';
import mongoose from 'mongoose';
import config from '../src/config.js';
import Post from '../src/models/postModel.js';
import Reservation from '../src/models/reservationModel.js';
import User from '../src/models/userModel.js';
import Tour from '../src/models/tourModel.js';
import PushSubscription from '../src/models/pushSubscriptionModel.js';
import ChatReadState from '../src/models/chatReadStateModel.js';

await mongoose.connect(config.db.testUri); // the same database the app uses (src/server.js)
const post = await Post.findOne({ deletedAt: null })
  .sort({ createdAt: -1 })
  .populate('creator', 'name username');
const tour = await Tour.findById(post.tourId).select('title order');
console.log(
  `Latest post ${post.createdAt.toISOString()} by ${post.creator?.name} in ${tour?.order}. ${tour?.title}`,
);
console.log(`  text: ${post.text.slice(0, 60)}`);

const reservations = await Reservation.find({ tour: post.tourId }).select('attendees.user');
const ids = [...new Set(reservations.flatMap((r) => r.attendees.map((a) => String(a.user))))];
const users = await User.find({ _id: { $in: ids } }).select('name username');
const subs = await PushSubscription.find({});
const states = await ChatReadState.find({ tour: post.tourId });

console.log(`\nAttendees (${ids.length}), those with push subscriptions:`);
for (const u of users) {
  const mine = subs.filter((s) => String(s.user) === String(u._id));
  if (!mine.length) continue;
  const st = states.find((s) => String(s.user) === String(u._id));
  console.log(`- ${u.name} (${u._id})`);
  for (const s of mine)
    console.log(
      `    sub: ${new URL(s.endpoint).host} created ${s.createdAt?.toISOString?.() ?? '?'}`,
    );
  console.log(
    `    muted=${!!st?.muted} readAt=${st?.readAt?.toISOString() ?? '-'} notifiedAt=${st?.notifiedAt?.toISOString() ?? '-'}`,
  );
}

console.log('\nAll push subscriptions (any user):');
const byUser = await User.find({ _id: { $in: subs.map((s) => s.user) } }).select('name');
for (const s of subs) {
  const u = byUser.find((x) => String(x._id) === String(s.user));
  const attendee = ids.includes(String(s.user));
  console.log(
    `- ${u?.name ?? s.user} ${new URL(s.endpoint).host} ${attendee ? '(attendee of this tour)' : '(NOT on this tour)'}`,
  );
}
await mongoose.disconnect();
