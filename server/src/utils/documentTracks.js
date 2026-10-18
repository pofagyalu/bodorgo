import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
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

// The hike's map (utils/trackMap.js) is kept beside the GPX file - one of
// several recordings (see outingsOf), beside its first one, named after
// all of them: another piece added or one gone, and it is made anew.
export const trackMapPath = (document) => documentFilePath(document).replace(/\.gpx$/i, '-map.jpg');
const OUTING_MAP = /-hike-[0-9a-f]{8}-map\.jpg$/;
function outingMapPath(documents) {
  const ids = documents.map((d) => String(d._id)).join(',');
  const hash = crypto.createHash('sha1').update(ids).digest('hex').slice(0, 8);
  return documentFilePath(documents[0]).replace(/\.gpx$/i, `-hike-${hash}-map.jpg`);
}

// A GPX gone: its map, and the joined maps of its tour (they are made anew
// when next asked for, of the pieces still there).
export function deleteTrackMap(document) {
  if (!isGpxDocument(document)) return;
  fs.rm(trackMapPath(document), { force: true }, () => {});
  const dir = path.dirname(documentFilePath(document));
  fs.readdir(dir, (err, names) => {
    if (err) return;
    for (const name of names.filter((n) => OUTING_MAP.test(n))) {
      fs.rm(path.join(dir, name), { force: true }, () => {});
    }
  });
}

// Being made right now, by the file - asked twice, made once.
const making = new Map();

// The map's file - made now if it isn't there yet (a couple of dozen map
// tiles from OpenStreetMap, once). null when it can't be made; never throws.
export const ensureTrackMap = (document) => ensureMap(trackMapPath(document), [document]);

// One map of the GPX documents given (several: the pieces of one hike, in
// the order they were walked), into `file`.
function ensureMap(file, documents) {
  if (fs.existsSync(file)) return Promise.resolve(file);
  if (!making.has(file)) {
    making.set(
      file,
      (async () => {
        try {
          const pieces = documents.map((d) =>
            parseGpx(fs.readFileSync(documentFilePath(d), 'utf8')),
          );
          const map = await renderTrackMap(pieces);
          fs.writeFileSync(file, map);
          return file;
        } catch (err) {
          logger.error(
            `documents: no map for ${documents.map((d) => d.filename).join(' + ')}: ${err.message}`,
          );
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
// A hike of several recordings (see outingsOf): its time is the time on
// the move, its stops apart.
export function trackStats(track) {
  const stats = [];
  if (track.startedAt) {
    stats.push(['Indulás', huTime(track.startedAt)]);
    if (track.durationSec) stats.push(['Érkezés', huTime(endOf(track))]);
  }
  stats.push(['Táv', `${hu(track.distanceM / 1000, 1)} km`]);
  if (track.startedAt && track.durationSec) {
    stats.push([track.stops ? 'Menetidő' : 'Idő', huDuration(track.durationSec)]);
  }
  if (track.stops) stats.push(['Megállók', `${track.stops} · ${huDuration(track.stopSec)}`]);
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
  if (track.stops) parts.push(`${track.stops} megálló (${huDuration(track.stopSec)})`);
  return parts.join(', ');
}

// When a hike ended: its recordings' last moment.
const endOf = (track) =>
  track.endedAt
    ? new Date(track.endedAt)
    : new Date(new Date(track.startedAt).getTime() + track.durationSec * 1000);

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

// The map of a hike by its GPX document's id - or by its recordings' ids
// (a hike of several, see outingsOf): one map of them all. Made now if
// need be; null when they are gone, or the map can't be made.
export async function hikeMap(ids) {
  const wanted = (Array.isArray(ids) ? ids : [ids]).filter((id) => mongoose.isValidObjectId(id));
  const documents = byStart(
    (await Document.find({ _id: { $in: wanted } })).filter(
      (d) => d.track && fs.existsSync(documentFilePath(d)),
    ),
  );
  if (!documents.length) return null;
  if (documents.length === 1) return ensureTrackMap(documents[0]);
  return ensureMap(outingMapPath(documents), documents);
}

// In the order they were walked.
const byStart = (documents) =>
  documents.sort(
    (a, b) =>
      (a.track.startedAt?.getTime() ?? Infinity) - (b.track.startedAt?.getTime() ?? Infinity) ||
      a.createdAt - b.createdAt,
  );

// A watch stops recording at a long lunch, and the way on is a new
// recording: the pieces of one day following each other within this are
// one hike - one map, one set of numbers in the beszámoló.
export const OUTING_GAP_SEC = 2 * 60 * 60;

// The hikes that happened, as the beszámoló tells them: the tour's
// recordings in the order they were walked, those of one day that follow
// each other within OUTING_GAP_SEC together - [[document, …], …].
export function outingsOf(tour, documents) {
  const outings = [];
  for (const document of documents) {
    const last = outings.at(-1)?.at(-1);
    const t = document.track;
    const joins =
      last?.track.startedAt &&
      last.track.durationSec &&
      t.startedAt &&
      dayIndex(tour, t.startedAt) === dayIndex(tour, last.track.startedAt) &&
      (new Date(t.startedAt) - endOf(last.track)) / 1000 <= OUTING_GAP_SEC;
    if (joins) outings.at(-1).push(document);
    else outings.push([document]);
  }
  return outings;
}

// A hike's numbers from its recordings: one's own - or, of several, from
// the first start to the last end, the distances and climbs added up, the
// time on the move, and the stops between them.
export function outingTrack(documents) {
  if (documents.length === 1) return documents[0].track;
  const tracks = documents.map((d) => d.track);
  const sum = (key) =>
    tracks.every((t) => t[key] != null) ? tracks.reduce((n, t) => n + t[key], 0) : null;
  const ends = tracks.map(endOf);
  return {
    kind: 'recorded',
    distanceM: sum('distanceM'),
    elevationGainM: sum('elevationGainM'),
    elevationLossM: sum('elevationLossM'),
    startedAt: tracks[0].startedAt,
    durationSec: sum('durationSec'),
    endedAt: ends.at(-1),
    stops: tracks.length - 1,
    stopSec: tracks
      .slice(1)
      .reduce((n, t, i) => n + Math.max(0, (new Date(t.startedAt) - ends[i]) / 1000), 0),
  };
}

// A hike's name from its recordings': the words they all start with
// ("velence 1"…"velence 4": "velence"; "Cuha szurdok oda" and "… vissza":
// "Cuha szurdok") - the first one's name when they share none.
export function outingName(documents) {
  const names = documents.map((d) => d.name.trim().split(/\s+/));
  const first = names[0];
  let n = 0;
  while (
    n < first.length &&
    names.every((words) => words[n]?.toLocaleLowerCase('hu') === first[n].toLocaleLowerCase('hu'))
  ) {
    n += 1;
  }
  return n ? first.slice(0, n).join(' ') : documents[0].name;
}

// The tour's GPX documents of the hikes that happened, in the order they
// were walked.
async function recordedDocuments(tour) {
  const documents = (await Document.find({ tour: tour._id, 'track.kind': 'recorded' })).filter(
    (d) => fs.existsSync(documentFilePath(d)),
  );
  return byStart(documents);
}

// The same hikes as their bare numbers (the beszámoló's JSON, and what a
// piece of its text can be linked to): { id (its first recording's), parts
// (all its recordings' ids), name, day (null when the file doesn't say
// when), track (documentModel.js's - of several, outingTrack's) } - no map
// is made.
export async function tourHikeNumbers(tour) {
  return outingsOf(tour, await recordedDocuments(tour)).map((documents) => ({
    id: String(documents[0]._id),
    parts: documents.map((d) => String(d._id)),
    name: outingName(documents),
    day: dayIndex(tour, documents[0].track.startedAt),
    track: outingTrack(documents),
  }));
}

// The tour's hikes that happened, for the beszámoló, in the order they
// were walked: { name, day (null when the file doesn't say when), stats,
// map (the picture's file, or null) }. The maps are made here if need be.
export async function tourHikes(tour) {
  return Promise.all(
    (await tourHikeNumbers(tour)).map(async (hike) => ({
      name: hike.name,
      day: hike.day,
      stats: trackStats(hike.track),
      map: await hikeMap(hike.parts),
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
