import mongoose from 'mongoose';
import config from '../config.js';
import PushSubscription from '../models/pushSubscriptionModel.js';
import AppError from '../utils/appError.js';
import { pushEnabled, sendPushToUsers } from '../utils/push.js';
import { isChatMuted, setChatMuted } from '../chat/chatNotifications.js';

// Push notifications, per device: Profilom turns them on/off for the
// browser it's opened in; the chat's bell mutes one tour's chat.

// GET /push/public-key - what the browser needs to subscribe (the
// server's public VAPID key); null when push isn't set up on this server.
export const getPublicKey = async (req, res) => {
  res
    .status(200)
    .json({ status: 'success', data: { publicKey: pushEnabled() ? config.push.publicKey : null } });
};

// POST /push/subscriptions - this device, from the browser's
// PushSubscription (endpoint + keys). Re-subscribing just refreshes it.
export const subscribe = async (req, res) => {
  const { endpoint, keys } = req.body ?? {};
  if (
    typeof endpoint !== 'string' ||
    !/^https:\/\//.test(endpoint) ||
    !keys?.p256dh ||
    !keys?.auth
  ) {
    throw new AppError('Hibás értesítési feliratkozás.', 400);
  }
  await PushSubscription.updateOne(
    { endpoint },
    {
      user: req.user._id,
      keys: { p256dh: String(keys.p256dh), auth: String(keys.auth) },
      userAgent: String(req.get('user-agent') ?? '').slice(0, 300),
    },
    { upsert: true },
  );
  res.status(201).json({ status: 'success' });
};

// DELETE /push/subscriptions - this device off (only one's own).
export const unsubscribe = async (req, res) => {
  const endpoint = req.body?.endpoint;
  if (endpoint) await PushSubscription.deleteOne({ endpoint, user: req.user._id });
  res.status(204).end();
};

// POST /push/test - a notification to all of one's own devices.
export const sendTest = async (req, res) => {
  const sent = await sendPushToUsers([req.user._id], {
    title: 'Bódorgó',
    body: 'Működnek az értesítések ezen az eszközön. 🎉',
    tag: 'test',
    url: '/klub/profilom',
  });
  if (!sent)
    throw new AppError('Nincs olyan eszközöd, ahol be vannak kapcsolva az értesítések.', 400);
  res.status(200).json({ status: 'success', data: { sent } });
};

const tourIdParam = (req) => {
  if (!mongoose.isValidObjectId(req.params.tourId)) throw new AppError('Nincs ilyen tábor.', 404);
  return req.params.tourId;
};

// GET/PUT /push/chat-mutes/:tourId - one tour's chat notifications off/on.
export const getChatMute = async (req, res) => {
  res.status(200).json({
    status: 'success',
    data: { muted: await isChatMuted(req.user._id, tourIdParam(req)) },
  });
};

export const putChatMute = async (req, res) => {
  const muted = !!req.body?.muted;
  await setChatMuted(req.user._id, tourIdParam(req), muted);
  res.status(200).json({ status: 'success', data: { muted } });
};
