import logger from '../logger.js';
import config from '../config.js';
import Tour from '../models/tourModel.js';
import { checkForNewTourVideos } from '../controllers/tourVideoController.js';
import { clearTourVideoCache } from '../utils/tourVideos.js';
import { loadSharp } from './imageFiles.js';
import { matchNewTourFolders, syncAllTourPhotos } from './tourPhotoSync.js';
import { syncMediaPhotos } from './mediaPhotoSync.js';

// "Új média felfedezése" - an admin's button, run only when pressed (no
// schedule, so the NAS does nothing extra otherwise): links new tour
// folders, syncs every tour album (with its "mobil" photos) and the Média
// photo categories, and announces newly added tour recap videos to their
// attendees by e-mail. Runs in the background - the page asks for its
// status until it's done; only one run at a time.
let status = { running: false };

export const discoveryStatus = () => status;

export function startDiscovery(byName) {
  if (status.running) return false;
  status = { running: true, startedAt: new Date(), by: byName };
  run().then(
    (report) => {
      status = { ...status, running: false, finishedAt: new Date(), report };
      logger.info(`Új média felfedezése kész (${byName})`);
    },
    (err) => {
      status = { ...status, running: false, finishedAt: new Date(), error: err.message };
      logger.error(`Új média felfedezése hiba: ${err.message}`);
    },
  );
  return true;
}

async function run() {
  let sharp;
  try {
    sharp = await loadSharp();
  } catch (err) {
    throw new Error(`a képfeldolgozó (sharp) nem tölthető be: ${err.message}`);
  }
  const matched = await matchNewTourFolders();
  const tours = await syncAllTourPhotos(sharp);
  const media = await syncMediaPhotos(sharp);
  return { matched, tours, media, videos: await announceNewTourVideos() };
}

// Tours whose recap video has just appeared get their attendees e-mailed
// (see tourVideoController.js) - only where TOUR_VIDEO_EMAILS=on (the live
// server); a dev server skips it.
async function announceNewTourVideos() {
  if (!config.tourVideoEmails) return [];
  clearTourVideoCache(); // read the video folders now, not a minute-old list
  const { notified } = await checkForNewTourVideos();
  const tours = await Tour.find({ order: { $in: notified } }).select('order title');
  return tours.sort((a, b) => a.order - b.order).map((t) => `${t.order}. ${t.title}`);
}
