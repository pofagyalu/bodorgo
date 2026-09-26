import webpush from 'web-push';
import config from '../config.js';
import PushSubscription from '../models/pushSubscriptionModel.js';
import logger from '../logger.js';

// Web push: a user turns notifications on in a browser (Profilom), the
// browser hands over an address at its push service (Google, Mozilla,
// Apple), and the server posts short encrypted messages there - shown by
// the site's service worker (client/src/sw.js) even with the page closed.
// Signed with the server's own key pair (VAPID, see config.push) - no
// account at any of those services needed.

let configured = false;
export function pushEnabled() {
  if (!configured && config.push.publicKey && config.push.privateKey) {
    webpush.setVapidDetails(config.push.subject, config.push.publicKey, config.push.privateKey);
    configured = true;
  }
  return configured;
}

// Sends one notification to every device of these users. payload: { title,
// body, tag, url, silent, renotify } - see sw.js for how it's shown. A
// device the push service no longer knows (404/410) is forgotten.
export async function sendPushToUsers(userIds, payload) {
  if (!pushEnabled() || !userIds.length) return 0;
  const subscriptions = await PushSubscription.find({ user: { $in: userIds } });
  const body = JSON.stringify(payload);
  let sent = 0;
  await Promise.all(
    subscriptions.map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, body, {
          TTL: 6 * 60 * 60,
        });
        sent++;
      } catch (err) {
        if (err.statusCode === 404 || err.statusCode === 410) {
          await PushSubscription.deleteOne({ _id: s._id });
        } else {
          logger.warn(`push to ${s._id} failed: ${err.statusCode ?? ''} ${err.message}`);
        }
      }
    }),
  );
  return sent;
}
