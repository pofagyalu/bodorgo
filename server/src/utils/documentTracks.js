import fs from 'fs';
import mongoose from 'mongoose';
import Document, { documentFilePath } from '../models/documentModel.js';
import { measureTrack, parseGpx } from '../futokor/gpx.js';
import { budapestParts, huTime } from './huDate.js';
import { renderTrackMap } from './trackMap.js';
import logger from '../logger.js';

// A tour's Extrák GPX tracks (documentModel.js's `track`): what each one
// measures, whether it is a plan or a hike that happened - and, for the
// hikes that happened, the map and the numbers the beszámoló prints under
// their day (tourReportController.js).

export const isGpxDocument = (document) => /\.gpx$/i.test(document.filename);

// What a GPX file's track is, for the record: a recorded one (its points
// have times - a watch's) is taken as the hike that happened, one without
// as a plan; the admin can say otherwise. null when the file has no track.
export function trackOf(gpx) {
  const points = parseGpx(gpx);
  if (points.length < 2) return null;
  const { distanceM, elevationGainM, elevationLossM, startedAt, durationSec } =
    measureTrack(points);
  const hasHeights = points.some((p) => p.ele !== null);
  return {
    kind: startedAt && durationSec ? 'recorded' : 'planned',
    distanceM,
    elevationGainM: hasHeights ? elevationGainM : null,
    elevationLossM: hasHeights ? elevationLossM : null,
    startedAt,
    durationSec,
  };
}

// The track as the pages get it - null for anything but a GPX with one.
export const trackView = (document) =>
  document.track?.kind
    ? {
        kind: document.track.kind,
        distanceM: document.track.distanceM,
        elevationGainM: document.track.elevationGainM ?? null,
        elevationLossM: document.track.elevationLossM ?? null,
        startedAt: document.track.startedAt ?? null,
        durationSec: document.track.durationSec ?? null,
      }
    : null;

// The hike's map (utils/trackMap.js) is kept beside the GPX file.
export const trackMapPath = (document) => documentFilePath(document).replace(/\.gpx$/i, '-map.jpg');

export function deleteTrackMap(document) {
  if (isGpxDocument(document)) fs.rm(trackMapPath(document), { force: true }, () => {});
}

// Being made right now, by the file - asked twice, made once.
const making = new Map();

// The map's file - made now if it isn't there yet (a couple of dozen map
// tiles from OpenStreetMap, once). null when it can't be made; never throws.
export async function ensureTrackMap(document) {
  const file = trackMapPath(document);
  if (fs.existsSync(file)) return file;
  if (!making.has(file)) {
    making.set(
      file,
      (async () => {
        try {
          const points = parseGpx(fs.readFileSync(documentFilePath(document), 'utf8'));
          const map = await renderTrackMap(points);
          fs.writeFileSync(file, map);
          return file;
        } catch (err) {
          logger.error(`documents: no map for ${document.filename}: ${err.message}`);
          return null;
        } finally {
          making.delete(file);
        }
      })(),
    );
  }
  return making.get(file);
}

const hu = (n, digits = 0) =>
  n
    .toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })
    .replace(/,/g, ' ')
    .replace('.', ',');

// "4 ó 53 p", "38 p".
function huDuration(sec) {
  const minutes = Math.round(sec / 60);
  const [h, m] = [Math.floor(minutes / 60), minutes % 60];
  return h ? `${h} ó ${String(m).padStart(2, '0')} p` : `${m} p`;
}

// A hike's numbers as the beszámoló prints them, in order: [label, value]
// - only the ones the file can give (a plan marked as walked has no times).
export function trackStats(track) {
  const stats = [];
  if (track.startedAt) {
    stats.push(['Indulás', huTime(track.startedAt)]);
    if (track.durationSec) {
      stats.push([
        'Érkezés',
        huTime(new Date(new Date(track.startedAt).getTime() + track.durationSec * 1000)),
      ]);
    }
  }
  stats.push(['Táv', `${hu(track.distanceM / 1000, 1)} km`]);
  if (track.startedAt && track.durationSec) stats.push(['Idő', huDuration(track.durationSec)]);
  if (track.elevationGainM != null) stats.push(['Emelkedő', `${hu(track.elevationGainM)} m`]);
  if (track.elevationLossM != null) stats.push(['Lejtő', `${hu(track.elevationLossM)} m`]);
  return stats;
}

// A hike's numbers in one line, for the beszámoló's JSON: "12,4 km, 4 ó
// 45 p, +621 m / −619 m" - only the ones the file can give.
export function trackSummary(track) {
  const parts = [`${hu(track.distanceM / 1000, 1)} km`];
  if (track.startedAt && track.durationSec) parts.push(huDuration(track.durationSec));
  if (track.elevationGainM != null && track.elevationLossM != null) {
    parts.push(`+${hu(track.elevationGainM)} m / −${hu(track.elevationLossM)} m`);
  }
  return parts.join(', ');
}

// Which day of the tour a moment is on (0 = the first), in Budapest - null
// without a moment.
function dayIndex(tour, at) {
  if (!at) return null;
  const utcDay = (date) => {
    const { year, month, day } = budapestParts(date);
    return Date.UTC(year, month - 1, day);
  };
  return Math.round((utcDay(at) - utcDay(tour.startDate)) / 86400000);
}

// The map of a hike by its GPX document's id - made now if need be; null
// when the document is gone, or the map can't be made.
export async function hikeMap(id) {
  const document = mongoose.isValidObjectId(id) ? await Document.findById(id) : null;
  if (!document?.track || !fs.existsSync(documentFilePath(document))) return null;
  return ensureTrackMap(document);
}

// The tour's GPX documents of the hikes that happened, in the order they
// were walked.
async function recordedDocuments(tour) {
  const documents = (await Document.find({ tour: tour._id, 'track.kind': 'recorded' })).filter(
    (d) => fs.existsSync(documentFilePath(d)),
  );
  return documents.sort(
    (a, b) =>
      (a.track.startedAt?.getTime() ?? Infinity) - (b.track.startedAt?.getTime() ?? Infinity) ||
      a.createdAt - b.createdAt,
  );
}

// The same hikes as their bare numbers (the beszámoló's JSON, and what a
// piece of its text can be linked to): { id, name, day (null when the file
// doesn't say when), track (documentModel.js) } - no map is made.
export async function tourHikeNumbers(tour) {
  return (await recordedDocuments(tour)).map((document) => ({
    id: String(document._id),
    name: document.name,
    day: dayIndex(tour, document.track.startedAt),
    track: document.track,
  }));
}

// The tour's hikes that happened, for the beszámoló, in the order they
// were walked: { name, day (null when the file doesn't say when), stats,
// map (the picture's file, or null) }. The maps are made here if need be.
export async function tourHikes(tour) {
  const documents = await recordedDocuments(tour);
  return Promise.all(
    documents.map(async (document) => ({
      name: document.name,
      day: dayIndex(tour, document.track.startedAt),
      stats: trackStats(document.track),
      map: await ensureTrackMap(document),
    })),
  );
}

// At startup, in the background: a GPX uploaded before tracks were read
// (the first day of GPX uploads) gets its record now.
export async function ensureDocumentTracks() {
  const missing = await Document.find({
    tour: { $ne: null },
    filename: /\.gpx$/i,
    'track.kind': { $exists: false },
  });
  for (const document of missing) {
    const file = documentFilePath(document);
    if (!fs.existsSync(file)) continue;
    const track = trackOf(fs.readFileSync(file, 'utf8'));
    if (track) await Document.updateOne({ _id: document._id }, { track });
  }
  if (missing.length) logger.info(`documents: tracks read for ${missing.length} GPX file(s)`);
}
