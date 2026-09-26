import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import Tour from '../models/tourModel.js';
import Reservation from '../models/reservationModel.js';
import AppError from '../utils/appError.js';
import config from '../config.js';
import sendResendEmail from '../utils/resendEmail.js';
import { partitionAttendeesByEmailEligibility } from './tourPdfController.js';
import logger from '../logger.js';
import { findSubtitlePath, resolveVideoPath, srtToVtt } from '../utils/videoFiles.js';
import { decodeVideoId, findVideoThumb, scanTourVideos, tourVideoList, tourVideosRoot } from '../utils/tourVideos.js';

// The tour recap videos - matched to tours by their file names (see
// utils/tourVideos.js), streamed straight from the NAS. Any logged-in
// user can watch (see tourRoutes.js).

// Resolves :tourId/:videoId to one of that tour's own video files - an id
// that isn't among the tour's versions is refused, whatever it decodes to.
async function tourVideoPath(req) {
  const tour = mongoose.isValidObjectId(req.params.tourId)
    ? await Tour.findById(req.params.tourId).select('order')
    : null;
  if (!tour) throw new AppError('No tour found with that ID!', 404);

  let relPath;
  try {
    relPath = decodeVideoId(req.params.videoId);
  } catch {
    relPath = null;
  }
  const versions = scanTourVideos().get(tour.order) ?? [];
  if (!relPath || !versions.some((v) => v.relPath === relPath)) {
    throw new AppError('Ehhez a táborhoz nincs ilyen videó.', 404);
  }

  const root = tourVideosRoot();
  const fullPath = resolveVideoPath(root, relPath);
  if (!fs.existsSync(fullPath)) throw new AppError('A videó nem található a lemezen.', 404);
  return { root, relPath, fullPath };
}

// GET /tours/:tourId/videos/:videoId/video - res.sendFile handles Range
// requests itself, so seeking in the <video> element just works.
export const getTourVideo = async (req, res) => {
  res.sendFile((await tourVideoPath(req)).fullPath);
};

// GET /tours/:tourId/videos/:videoId/cover - the video's "-thumb" image.
export const getTourVideoCover = async (req, res) => {
  const { root, relPath } = await tourVideoPath(req);
  const thumb = findVideoThumb(root, relPath);
  if (!thumb) throw new AppError('Ehhez a videóhoz nincs borítókép.', 404);
  const types = { '.png': 'image/png', '.webp': 'image/webp' };
  res.setHeader('Content-Type', types[path.extname(thumb).toLowerCase()] ?? 'image/jpeg');
  res.setHeader('Cache-Control', 'private, max-age=3600');
  res.sendFile(thumb);
};

// GET /tours/:tourId/videos/:videoId/subtitles.vtt - 404 when there's
// none; the page only asks when the tour said hasSubtitles.
export const getTourVideoSubtitles = async (req, res) => {
  const { root, relPath } = await tourVideoPath(req);
  const subtitlePath = findSubtitlePath(root, relPath);
  if (!subtitlePath) throw new AppError('Ehhez a videóhoz nincs felirat.', 404);
  res.setHeader('Content-Type', 'text/vtt; charset=utf-8');
  res.send(srtToVtt(fs.readFileSync(subtitlePath, 'utf8')));
};

// Same plain-text/basic-HTML minimal style as tourPdfController.js's
// programfuzetEmailBody - no separate branded template exists yet for any
// of this app's emails.
function videoReadyEmailBody(recipientName, tourTitle, videoPageUrl) {
  const noReplyNote = 'Erre az e-mailre kérjük, ne válaszolj - ez egy automatikusan generált üzenet.';
  return {
    subject: `Elkészült a videó - ${tourTitle}`,
    text: `Szia ${recipientName}!\n\nElkészült a(z) "${tourTitle}" tábor videója, itt nézheted meg: ${videoPageUrl}\n\nÜdvözlettel,\nBódorgó\n\n${noReplyNote}`,
    html: `<p>Szia ${recipientName}!</p><p>Elkészült a(z) "${tourTitle}" tábor videója, <a href="${videoPageUrl}">itt nézheted meg</a>.</p><p>Üdvözlettel,<br>Bódorgó</p><p style="color:#888;font-size:0.85em;">${noReplyNote}</p>`,
  };
}

// E-mails a tour's attendees that its video is ready. Same attendee query
// + eligibility rules (email on file, logged in at least once, hasn't
// turned off wantsEmailNotifications) as tourPdfController.js's
// emailTourPdfToAttendees.
export async function notifyAttendeesOfNewVideo(tour) {
  const reservations = await Reservation.find({ tour: tour._id }).populate({
    path: 'attendees.user',
    select: 'name email lastLoginAt wantsEmailNotifications',
  });

  const recipientsById = new Map();
  for (const reservation of reservations) {
    for (const attendee of reservation.attendees) {
      const user = attendee.user;
      if (user && !recipientsById.has(String(user._id))) {
        recipientsById.set(String(user._id), user);
      }
    }
  }

  const { eligible } = partitionAttendeesByEmailEligibility([...recipientsById.values()]);
  if (eligible.length === 0) return;

  const videoPageUrl = `${config.oridzs.clientBaseUrl.replace(/\/$/, '')}/taborok/${tour.slug || tour._id}`;

  // Per-recipient try/catch - one bad address/API hiccup shouldn't cost
  // every other attendee their notification too.
  for (const user of eligible) {
    try {
      const { subject, text, html } = videoReadyEmailBody(user.name, tour.title, videoPageUrl);
      await sendResendEmail({ to: user.email, subject, text, html });
    } catch (err) {
      logger.error(`Tour ${tour._id}: video-ready email to ${user.email} failed: ${err.message}`);
    }
  }
}

// Run every 12 hours (see server.js): e-mails the attendees of each tour
// that got its first video since the last check - once per tour, a later
// second version doesn't re-notify. The very first run ever (no tour
// marked yet) only marks the videos already there, so nobody gets an
// e-mail about years-old videos.
export async function checkForNewTourVideos() {
  const byOrder = scanTourVideos();
  const withVideo = [...byOrder.keys()];
  if (!withVideo.length) return { notified: [], seeded: 0 };

  const firstRun = !(await Tour.exists({ videoNotifiedAt: { $ne: null } }));
  const fresh = await Tour.find({ order: { $in: withVideo }, videoNotifiedAt: null }).select('order title slug');

  const notified = [];
  for (const tour of fresh) {
    // Marked first, so a crash halfway through can't e-mail twice.
    await Tour.updateOne({ _id: tour._id }, { videoNotifiedAt: new Date() });
    if (firstRun) continue;
    try {
      await notifyAttendeesOfNewVideo(tour);
      notified.push(tour.order);
    } catch (err) {
      logger.error(`Tour ${tour._id}: video-ready notification batch failed: ${err.message}`);
    }
  }
  if (firstRun) logger.info(`Tour videos: marked ${fresh.length} existing videos as already announced`);
  else if (notified.length) logger.info(`Tour videos: announced new videos for tours ${notified.join(', ')}`);
  return { notified, seeded: firstRun ? fresh.length : 0 };
}

export { tourVideoList };
