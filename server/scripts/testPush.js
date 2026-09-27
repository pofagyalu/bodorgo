// Sends one test notification to every push subscription of a user and
// prints what the push service answered - to tell "the server can't
// deliver" apart from "the browser/OS doesn't show it".
//
// Usage: node scripts/testPush.js <userId>
import 'dotenv/config';
import mongoose from 'mongoose';
import webpush from 'web-push';
import config from '../src/config.js';
import PushSubscription from '../src/models/pushSubscriptionModel.js';

const [, , userId] = process.argv;
if (!userId) {
  console.error('Usage: node scripts/testPush.js <userId>');
  process.exit(1);
}

await mongoose.connect(config.db.testUri); // the same database the app uses (src/server.js)
webpush.setVapidDetails(config.push.subject, config.push.publicKey, config.push.privateKey);

const subs = await PushSubscription.find({ user: userId });
console.log(`${subs.length} subscription(s)`);
for (const s of subs) {
  try {
    const res = await webpush.sendNotification(
      { endpoint: s.endpoint, keys: s.keys },
      // A fresh tag each time: a repeated tag would only replace the previous
      // test notification silently, without popping up.
      JSON.stringify({
        title: 'Bódorgó teszt',
        body: `Ha ezt látod, a push működik. (${new Date().toLocaleTimeString('hu-HU')})`,
        tag: `test-${Date.now()}`,
        url: '/',
      }),
      { TTL: 600 },
    );
    console.log(`- ${new URL(s.endpoint).host}: HTTP ${res.statusCode}`);
  } catch (err) {
    console.log(
      `- ${new URL(s.endpoint).host}: FAILED ${err.statusCode ?? ''} ${err.body ?? err.message}`,
    );
  }
}
await mongoose.disconnect();
