import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import multer from 'multer';
import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import Tour from '../models/tourModel.js';
import {
  FutokorCourse,
  FutokorPosition,
  FutokorRun,
  FutokorScan,
  FutokorTag,
} from '../models/futokorModels.js';
import GpxTrack from '../models/gpxTrackModel.js';
import AppError from '../utils/appError.js';
import requireAuth from '../auth/requireAuth.js';
import { requireFutokor } from '../futokor/access.js';
import { isExpired, replayScans } from '../futokor/runRules.js';
import { tagUrl, verifyTagToken } from '../futokor/tags.js';
import { gpxName, measureTrack, parseGpx, placeCheckpoints, thinTrack } from '../futokor/gpx.js';
import { GPX_DIR } from '../utils/dataDirs.js';
import { userOfFutokod } from '../utils/futokod.js';
import { computeAge } from './userController.js';

// Futókör: the checkpoint running race (Móka → Futókörök). A course is a
// loop with cards to scan: a tour's (the admins', with the club's cards),
// or a user's own track (anyone's, with its own cards). The runners' phones
// scan the cards and send their scans here whenever they have a
// connection; a runner's runs are worked out from all of their scans by
// the rules in futokor/runRules.js - the same rules the phone applies on
// its own in the meantime.

const MAX_NEW_TAGS = 30;
// A user's own track: how many checkpoints it may have.
const MAX_OWN_POINTS = 20;
// How long a user's own track is open if they don't say: a year.
const OWN_OPEN_MS = 365 * 24 * 3600 * 1000;
// (The request body is small - see app.js: the phone sends more in turns.)
const MAX_SCANS_AT_ONCE = 40;
// A phone's clock may be a little ahead of the server's - not more.
const CLOCK_AHEAD_MS = 5 * 60 * 1000;
const MAX_GPX_BYTES = 10 * 1024 * 1024;
// A runner's live position is shown while it's fresh - the phones send one
// every ten seconds or so.
const POSITION_FRESH_MS = 60 * 1000;

const rootDir = path.resolve();
const FONT_REGULAR = path.join(rootDir, 'assets', 'fonts', 'Mulish-Regular.ttf');
const FONT_BOLD = path.join(rootDir, 'assets', 'fonts', 'Mulish-Bold.ttf');

const shownName = (user) => user?.username || user?.name || 'Ismeretlen';
const validId = (id) => typeof id === 'string' && mongoose.isValidObjectId(id);
const refId = (ref) => String(ref?._id ?? ref);
const isAdmin = (user) => user?.role === 'admin';

// --- A course, the way the rules and the phones need it ---

const isOwnTrack = (course) => !course.tour;

// A tour's course is the admins'; a user's own track is its maker's (and
// the admins' too).
const canManage = (course, user) =>
  !!user && (isAdmin(user) || (isOwnTrack(course) && refId(course.createdBy) === refId(user)));

// For runRules.js: a checkpoint is known by its card.
const courseRules = (course) => ({
  distanceM: course.distanceM,
  flagSpeedMps: course.flagSpeedMps,
  duplicateScanWindowSec: course.duplicateScanWindowSec,
  maxRunDurationMin: course.maxRunDurationMin,
  checkpoints: course.checkpoints.map((c) => ({
    id: c.tagId,
    tagId: c.tagId,
    kind: c.kind,
    label: c.label,
    order: c.order,
    distanceAlongM: c.distanceAlongM,
    lat: c.lat,
    lng: c.lng,
  })),
});

// Everything a phone keeps to run the course without a connection - and
// what the course's own pages show.
const courseView = (course, user) => ({
  _id: course._id,
  // 'tour': a tour's course; 'own': a user's own track.
  kind: isOwnTrack(course) ? 'own' : 'tour',
  tour: course.tour ? { _id: refId(course.tour), title: course.tour.title } : null,
  // Whoever made it - a user's own track is theirs.
  owner: { _id: refId(course.createdBy), name: shownName(course.createdBy) },
  canManage: canManage(course, user),
  name: course.name,
  opensAt: course.opensAt,
  closesAt: course.closesAt,
  // The loop to draw on the map ([lat, lng] pairs) - empty if none yet.
  track: course.track ?? [],
  elevationGainM: course.elevationGainM ?? null,
  hasGpx: !!course.gpx,
  ...courseRules(course),
});

const withPeople = (query) =>
  query.populate({ path: 'tour', select: 'title' }).populate({
    path: 'createdBy',
    select: 'name username',
  });

const runView = (course, run) => ({
  // A run nobody finished or gave up is over once its time is up, even if
  // no scan has said so yet.
  status: isExpired(courseRules(course), run, Date.now()) ? 'expired' : run.status,
  startedAt: run.startedAt,
  finishedAt: run.finishedAt,
  passed: run.passed,
  splits: run.splits,
  totalMs: run.totalMs,
  paceSecPerKm: run.paceSecPerKm,
  flagged: run.flagged,
});

// isExpired wants times as numbers, like the phone's.
const asRulesRun = (run) => ({ ...run, startedAt: new Date(run.startedAt).getTime() });

async function myRuns(course, user) {
  const runs = await FutokorRun.find({ course: course._id, user: user._id })
    .sort('startedAt')
    .lean();
  return runs.map((r) => runView(course, asRulesRun(r)));
}

// A runner's runs on a course, worked out again from all of their scans
// and stored in place of what was there. Answers what came of each scan.
async function replayRunner(course, userId) {
  const scans = await FutokorScan.find({ user: userId, course: course._id }).lean();
  const { runs, results } = replayScans(
    courseRules(course),
    scans.map((s) => ({
      clientScanId: s.clientScanId,
      tagId: s.tagId,
      action: s.action,
      time: s.deviceTime.getTime(),
      lat: s.lat,
      lng: s.lng,
      accuracyM: s.accuracyM,
    })),
  );
  await FutokorRun.deleteMany({ course: course._id, user: userId });
  await FutokorRun.insertMany(
    runs.map((r) => ({
      course: course._id,
      user: userId,
      status: r.status,
      startedAt: new Date(r.startedAt),
      finishedAt: r.finishedAt ? new Date(r.finishedAt) : null,
      passed: r.passed,
      splits: r.splits,
      totalMs: r.totalMs ?? null,
      paceSecPerKm: r.paceSecPerKm ?? null,
      flagged: r.flagged,
    })),
  );
  return results;
}

// Everyone's runs on a course worked out again - after the course changed.
async function replayCourse(course) {
  for (const userId of await FutokorScan.distinct('user', { course: course._id })) {
    await replayRunner(course, userId);
  }
}

const openAt = (time) => ({ opensAt: { $lte: time }, closesAt: { $gte: time } });

// --- The club's cards (the tours') ---

const tagView = (tag) => ({
  tagId: tag.tagId,
  kind: tag.kind,
  retired: tag.retired,
  // What its QR code says.
  url: tagUrl(tag.tagId),
  createdAt: tag.createdAt,
});

// GET /futokor/tags - the club's cards (the ones the tours' courses use);
// admins. A user's own track's cards are with the track.
export const getTags = async (req, res) => {
  const tags = await FutokorTag.find({ course: null }).sort('kind tagId');
  res.status(200).json({ status: 'success', data: { tags: tags.map(tagView) } });
};

// POST /futokor/tags - new cards: { count } checkpoint cards (T01, T02...
// from the next free number), or { kind: 'startFinish' } one START/FINISH
// card (S1, S2...).
export const createTags = async (req, res) => {
  const startFinish = req.body?.kind === 'startFinish';
  const count = startFinish ? 1 : Number(req.body?.count);
  if (!Number.isInteger(count) || count < 1 || count > MAX_NEW_TAGS) {
    throw new AppError(`Egyszerre 1-${MAX_NEW_TAGS} kártya készíthető.`, 400);
  }
  const prefix = startFinish ? 'S' : 'T';
  const existing = await FutokorTag.find({ tagId: new RegExp(`^${prefix}\\d+$`) }).select('tagId');
  const last = Math.max(0, ...existing.map((t) => Number(t.tagId.slice(1))));
  const tags = await FutokorTag.insertMany(
    Array.from({ length: count }, (_, i) => ({
      tagId: `${prefix}${startFinish ? last + i + 1 : String(last + i + 1).padStart(2, '0')}`,
      kind: startFinish ? 'startFinish' : 'checkpoint',
    })),
  );
  res.status(201).json({ status: 'success', data: { tags: tags.map(tagView) } });
};

// PATCH /futokor/tags/:tagId - { retired }: a lost or damaged card no
// longer counts (and can be taken back into use).
export const updateTag = async (req, res) => {
  if (typeof req.body?.retired !== 'boolean') throw new AppError('Hiányzó adat.', 400);
  const tag = await FutokorTag.findOneAndUpdate(
    { tagId: String(req.params.tagId), course: null },
    { retired: req.body.retired },
    { returnDocument: 'after' },
  );
  if (!tag) throw new AppError('Nincs ilyen kártya.', 404);
  res.status(200).json({ status: 'success', data: { tag: tagView(tag) } });
};

// The cards to print, cut and laminate, as a PDF: six to an A4 page, each
// with its QR code as big as a card allows (the bigger, the further a
// phone reads it from), its number in big letters and a small caption.
async function sendSheet(res, cards, fileName) {
  const doc = new PDFDocument({ size: 'A4', margin: 0 });
  doc.registerFont('Body', FONT_REGULAR);
  doc.registerFont('Heading', FONT_BOLD);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${fileName}"`);
  doc.pipe(res);

  const [cols, rows, margin] = [2, 3, 12];
  const cellW = (doc.page.width - margin * 2) / cols;
  const cellH = (doc.page.height - margin * 2) / rows;
  const [numberSize, captionSize] = [32, 8];
  const qrSize = Math.min(cellW - 16, cellH - numberSize * 1.3 - captionSize * 1.6 - 10);

  for (const [i, card] of cards.entries()) {
    const slot = i % (cols * rows);
    if (i > 0 && slot === 0) doc.addPage();
    const x = margin + (slot % cols) * cellW;
    const y = margin + Math.floor(slot / cols) * cellH;

    // Where to cut.
    doc
      .rect(x + 2, y + 2, cellW - 4, cellH - 4)
      .dash(4, { space: 4 })
      .lineWidth(0.7)
      .stroke(card.startFinish ? '#f07827' : '#9aa5ab')
      .undash();
    const qr = await QRCode.toBuffer(tagUrl(card.tagId), { width: 800, margin: 1 });
    doc.image(qr, x + (cellW - qrSize) / 2, y + 6, { width: qrSize });
    doc
      .font('Heading')
      .fontSize(card.startFinish ? 26 : numberSize)
      .fillColor(card.startFinish ? '#f07827' : '#1b6548')
      .text(card.startFinish ? 'RAJT / CÉL' : card.number, x, y + 6 + qrSize, {
        width: cellW,
        align: 'center',
        lineBreak: false,
      });
    doc
      .font('Body')
      .fontSize(captionSize)
      .fillColor('#56666e')
      .text(card.caption, x, y + cellH - captionSize * 1.6 - 4, {
        width: cellW,
        align: 'center',
        lineBreak: false,
      });
  }
  doc.end();
}

// A card's number as printed on it: "T05" → "05", "P3-02" → "02".
const cardNumber = (tagId) => tagId.split('-').at(-1).replace(/^\D+/, '');

// GET /futokor/tags/sheet - the club's cards to print.
export const getTagSheet = async (req, res) => {
  const tags = await FutokorTag.find({ course: null, retired: false }).sort('kind tagId');
  if (!tags.length) throw new AppError('Még nincs egy kártya sem.', 404);
  await sendSheet(
    res,
    tags.map((t) => ({
      tagId: t.tagId,
      startFinish: t.kind === 'startFinish',
      number: cardNumber(t.tagId),
      caption: `Bódorgó Futókör · ${t.tagId}`,
    })),
    'futokor-kartyak.pdf',
  );
};

// --- Courses ---

// No two tours' courses are open at the same time. (A user's own track can
// be open whenever: its cards are only its own.)
async function overlappingTourCourse(opensAt, closesAt, exceptId) {
  return FutokorCourse.exists({
    _id: { $ne: exceptId },
    tour: { $exists: true },
    opensAt: { $lte: closesAt },
    closesAt: { $gte: opensAt },
  });
}

function parseWindow(body, current = {}) {
  const opensAt = body.opensAt !== undefined ? new Date(body.opensAt) : current.opensAt;
  const closesAt = body.closesAt !== undefined ? new Date(body.closesAt) : current.closesAt;
  if (!opensAt || !closesAt || Number.isNaN(+opensAt) || Number.isNaN(+closesAt)) {
    throw new AppError('A pálya nyitása és zárása kell.', 400);
  }
  if (closesAt <= opensAt) throw new AppError('A pálya zárása a nyitása után legyen.', 400);
  return { opensAt, closesAt };
}

const positiveOrNull = (value, what) => {
  if (value === null || value === '' || value === undefined) return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) throw new AppError(`${what}: pozitív szám kell.`, 400);
  return n;
};

// A place on the map, if both of its numbers are real ones.
const placeOrNull = (p) =>
  [p?.lat, p?.lng].every((v) => typeof v === 'number' && Number.isFinite(v)) &&
  Math.abs(p.lat) <= 90 &&
  Math.abs(p.lng) <= 180
    ? { lat: p.lat, lng: p.lng }
    : { lat: null, lng: null };

// The course, if it's this user's to change - the error why not otherwise.
async function courseToManage(req) {
  const course = validId(req.params.id) ? await FutokorCourse.findById(req.params.id) : null;
  if (!course) throw new AppError('Nincs ilyen pálya.', 404);
  if (!canManage(course, req.user)) {
    throw new AppError('Ezt a pályát csak a készítője szerkesztheti.', 403);
  }
  return course;
}

// A course with its cards (a user's own track has its own; a tour's
// course uses the club's - none here).
async function manageView(course, user) {
  const cards = await FutokorTag.find({ course: course._id }).sort('tagId');
  return { ...courseView(course, user), cards: cards.map(tagView) };
}

const sendCourse = async (res, course, user, code = 200) => {
  const fresh = await withPeople(FutokorCourse.findById(course._id));
  res.status(code).json({ status: 'success', data: { course: await manageView(fresh, user) } });
};

// A user's own track's cards: P<n>-S (START/FINISH) and P<n>-01, -02...
// The track's number <n> is in every one of its cards' names.
const ownCode = (course) => course.checkpoints[0]?.tagId.split('-')[0];

async function nextOwnCode() {
  const starts = await FutokorTag.find({ tagId: /^P\d+-S$/ }).select('tagId');
  return `P${Math.max(0, ...starts.map((t) => Number(t.tagId.slice(1, -2)))) + 1}`;
}

// A user's own track's checkpoints set to `points` of them (the cards made
// or removed to match): what each point already was - where it is, how far
// along - stays, unless `stops` says otherwise.
async function setOwnPoints(course, points, stops) {
  const code = ownCode(course) ?? (await nextOwnCode());
  const was = (order) => course.checkpoints.find((c) => c.order === order);
  const given = (i) => (Array.isArray(stops) ? stops[i] : undefined);
  const ids = [
    `${code}-S`,
    ...Array.from({ length: points }, (_, i) => `${code}-${String(i + 1).padStart(2, '0')}`),
  ];

  course.checkpoints = ids.map((tagId, order) => {
    const stop = order > 0 ? given(order - 1) : undefined;
    const old = was(order);
    const place = stop && ('lat' in stop || 'lng' in stop) ? placeOrNull(stop) : placeOrNull(old);
    const distanceAlongM =
      order === 0
        ? 0
        : stop && 'distanceAlongM' in stop
          ? positiveOrNull(stop.distanceAlongM, `${order}. pont távolsága`)
          : (old?.distanceAlongM ?? null);
    return {
      tagId,
      kind: order === 0 ? 'startFinish' : 'checkpoint',
      label: order === 0 ? 'RAJT / CÉL' : `${order}. pont`,
      order,
      distanceAlongM,
      ...place,
    };
  });

  const have = new Set(
    (await FutokorTag.find({ course: course._id }).select('tagId')).map((t) => t.tagId),
  );
  const missing = ids.filter((id) => !have.has(id));
  if (missing.length) {
    await FutokorTag.insertMany(
      missing.map((tagId) => ({
        tagId,
        kind: tagId.endsWith('-S') ? 'startFinish' : 'checkpoint',
        course: course._id,
      })),
    );
  }
  await FutokorTag.deleteMany({ course: course._id, tagId: { $nin: ids } });
}

// With a track on the course, the points that have a place get their
// distance along the loop from it (futokor/gpx.js) - and the START its
// place: the track's first point. A point that isn't on the track after
// the one before it is an error.
function placeOnTrack(course) {
  if ((course.track?.length ?? 0) < 2) return;
  const points = course.track.map(([lat, lng]) => ({ lat, lng }));
  const stops = course.checkpoints.filter((c) => c.kind === 'checkpoint');
  const start = course.checkpoints.find((c) => c.kind === 'startFinish');
  if (start && start.lat === null) Object.assign(start, points[0]);

  // Only once every point has a place: the distances must follow one
  // another along the loop.
  const placed = stops.filter((c) => c.lat !== null && c.lng !== null);
  if (!placed.length || placed.length !== stops.length) return;
  const found = placeCheckpoints(points, placed);
  for (const [i, c] of placed.entries()) {
    if (found[i].distanceAlongM === null) {
      throw new AppError(`A(z) ${c.label} nincs a nyomvonalon az előző pont után.`, 400);
    }
    c.distanceAlongM = found[i].distanceAlongM;
  }
}

function checkDistances(course) {
  let previous = 0;
  for (const c of course.checkpoints.filter((cp) => cp.kind === 'checkpoint')) {
    if (c.distanceAlongM === null) continue;
    if (c.distanceAlongM <= previous) {
      throw new AppError('A pontok távolsága a rajttól sorban nőjön.', 400);
    }
    previous = c.distanceAlongM;
  }
  if (course.distanceM !== null && course.distanceM <= previous) {
    throw new AppError('A kör hossza legyen nagyobb az utolsó pont távolságánál.', 400);
  }
}

// GET /futokor/courses - the courses I can change, the newest first: my
// own tracks - for an admin every course, the tours' too. Each own track
// with its cards.
export const getCourses = async (req, res) => {
  const filter = isAdmin(req.user) ? {} : { tour: { $exists: false }, createdBy: req.user._id };
  const courses = await withPeople(FutokorCourse.find(filter).sort('-createdAt'));
  const cards = await FutokorTag.find({ course: { $in: courses.map((c) => c._id) } }).sort('tagId');
  res.status(200).json({
    status: 'success',
    data: {
      courses: courses.map((c) => ({
        ...courseView(c, req.user),
        cards: cards.filter((t) => refId(t.course) === refId(c)).map(tagView),
      })),
    },
  });
};

// POST /futokor/courses - a new course.
// - A tour's (admins): { tourId, name?, opensAt, closesAt } - its cards
//   are chosen afterwards, from the club's.
// - My own track (anyone): { name, points, opensAt?, closesAt? } - open
//   from now for a year unless said otherwise; its cards (a START/FINISH
//   and one per point) are made with it.
export const createCourse = async (req, res) => {
  const { tourId, name } = req.body ?? {};

  if (tourId !== undefined) {
    if (!isAdmin(req.user)) throw new AppError('Tábori pályát csak admin készíthet.', 403);
    const tour = validId(tourId) ? await Tour.findById(tourId).select('title') : null;
    if (!tour) throw new AppError('Nincs ilyen tábor.', 400);
    if (await FutokorCourse.exists({ tour: tour._id })) {
      throw new AppError('Ennek a tábornak már van pályája.', 400);
    }
    const window = parseWindow(req.body);
    if (await overlappingTourCourse(window.opensAt, window.closesAt, null)) {
      throw new AppError('Ebben az időszakban már nyitva van egy másik tábori pálya.', 400);
    }
    const course = await FutokorCourse.create({
      tour: tour._id,
      name: (typeof name === 'string' && name.trim()) || `${tour.title} futókör`,
      createdBy: req.user._id,
      ...window,
    });
    return sendCourse(res, course, req.user, 201);
  }

  const cleanName = typeof name === 'string' ? name.trim() : '';
  if (!cleanName || cleanName.length > 60) {
    throw new AppError('A pályának 1-60 karakteres név kell.', 400);
  }
  const points = Number(req.body?.points);
  if (!Number.isInteger(points) || points < 1 || points > MAX_OWN_POINTS) {
    throw new AppError(`Egy pályán 1-${MAX_OWN_POINTS} ellenőrzőpont lehet.`, 400);
  }
  const now = new Date();
  const window = parseWindow({
    opensAt: req.body.opensAt ?? now,
    closesAt: req.body.closesAt ?? new Date(+now + OWN_OPEN_MS),
  });
  const course = new FutokorCourse({ name: cleanName, createdBy: req.user._id, ...window });
  await setOwnPoints(course, points);
  await course.save();
  return sendCourse(res, course, req.user, 201);
};

// PATCH /futokor/courses/:id - whoever may change it: its name, when it's
// open, the longest a run may take, how long the loop is, and its points.
// - A tour's course: { startTagId, stops: [{ tagId, distanceAlongM?, lat?,
//   lng? }] } - the club's cards, in the order they're passed.
// - A user's own track: { points } (how many - the cards follow) and/or
//   { stops: [{ distanceAlongM?, lat?, lng? }] } for the points in order.
// A point's place on the map (lat, lng) puts it on the course's track: its
// distance is then measured along the loop. Every runner's runs are worked
// out again afterwards.
export const updateCourse = async (req, res) => {
  const course = await courseToManage(req);
  const body = req.body ?? {};

  if (typeof body.name === 'string' && body.name.trim()) {
    course.name = body.name.trim().slice(0, 60);
  }
  if (body.opensAt !== undefined || body.closesAt !== undefined) {
    const window = parseWindow(body, course);
    if (
      !isOwnTrack(course) &&
      (await overlappingTourCourse(window.opensAt, window.closesAt, course._id))
    ) {
      throw new AppError('Ebben az időszakban már nyitva van egy másik tábori pálya.', 400);
    }
    Object.assign(course, window);
  }
  if (body.maxRunDurationMin !== undefined) {
    course.maxRunDurationMin =
      positiveOrNull(body.maxRunDurationMin, 'Leghosszabb futás') ?? course.maxRunDurationMin;
  }
  if (body.distanceM !== undefined) {
    course.distanceM = positiveOrNull(body.distanceM, 'A kör hossza');
  }

  if (isOwnTrack(course)) {
    if (body.points !== undefined || body.stops !== undefined) {
      const points =
        body.points !== undefined ? Number(body.points) : course.checkpoints.length - 1;
      if (!Number.isInteger(points) || points < 1 || points > MAX_OWN_POINTS) {
        throw new AppError(`Egy pályán 1-${MAX_OWN_POINTS} ellenőrzőpont lehet.`, 400);
      }
      await setOwnPoints(course, points, body.stops);
    }
  } else if (body.startTagId !== undefined || body.stops !== undefined) {
    const stops = Array.isArray(body.stops) ? body.stops : [];
    const ids = [body.startTagId, ...stops.map((s) => s?.tagId)].map(String);
    if (new Set(ids).size !== ids.length) {
      throw new AppError('Egy kártya csak egyszer szerepelhet a pályán.', 400);
    }
    const tags = await FutokorTag.find({ tagId: { $in: ids }, course: null, retired: false });
    const kindOf = Object.fromEntries(tags.map((t) => [t.tagId, t.kind]));
    if (kindOf[ids[0]] !== 'startFinish') {
      throw new AppError('A pályához egy RAJT / CÉL kártya kell.', 400);
    }
    if (ids.slice(1).some((id) => kindOf[id] !== 'checkpoint')) {
      throw new AppError('Ismeretlen vagy letiltott kártya van a pontok között.', 400);
    }
    // Where each point is on the map stays with the point - the 2nd point
    // is where it was, whichever card hangs there now - unless said.
    const placeOf = (order, stop) => {
      if (stop && ('lat' in stop || 'lng' in stop)) return placeOrNull(stop);
      return placeOrNull(course.checkpoints.find((c) => c.order === order));
    };
    course.checkpoints = [
      {
        tagId: ids[0],
        kind: 'startFinish',
        label: 'RAJT / CÉL',
        order: 0,
        distanceAlongM: 0,
        ...placeOf(0),
      },
      ...stops.map((s, i) => ({
        tagId: ids[i + 1],
        kind: 'checkpoint',
        label: `${i + 1}. pont`,
        order: i + 1,
        distanceAlongM: positiveOrNull(s.distanceAlongM, `${i + 1}. pont távolsága`),
        ...placeOf(i + 1, s),
      })),
    ];
  }

  placeOnTrack(course);
  checkDistances(course);
  await course.save();
  await replayCourse(course);
  return sendCourse(res, course, req.user);
};

// The GPX file of the upload ("gpx"), in memory.
const gpxUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_GPX_BYTES },
}).single('gpx');

export function receiveGpx(req, res, next) {
  gpxUpload(req, res, (err) => {
    if (err) return next(new AppError('A GPX fájl legfeljebb 10 MB lehet.', 400));
    return next();
  });
}

const gpxPath = (id) => path.join(GPX_DIR, `${id}.gpx`);

// The file and the record of a course's GPX gone.
async function removeGpx(course) {
  if (!course.gpx) return;
  await fs.promises.rm(gpxPath(course.gpx), { force: true });
  await GpxTrack.deleteOne({ _id: course.gpx });
  course.gpx = null;
}

// PUT /futokor/courses/:id/track - the course's loop from a GPX file (a
// watch's recording, or a planned route): multipart, the file as "gpx".
// The file is kept (in the app's GPX store - gpxTrackModel.js), the course
// gets the track to draw (a lighter copy), the loop's length and climb -
// and the points that have a place get their distance along it.
export const putTrack = async (req, res) => {
  const course = await courseToManage(req);
  if (!req.file) throw new AppError('Válassz egy GPX fájlt.', 400);
  const text = req.file.buffer.toString('utf8');
  const points = parseGpx(text);
  if (points.length < 2) throw new AppError('Ebben a fájlban nincs nyomvonal.', 400);
  const measured = measureTrack(points);
  if (measured.distanceM < 20) throw new AppError('Ez a nyomvonal túl rövid.', 400);

  await removeGpx(course);
  const record = await GpxTrack.create({
    fileName: path.basename(req.file.originalname || 'track.gpx').slice(0, 120),
    name: gpxName(text).slice(0, 120),
    uploadedBy: req.user._id,
    sizeBytes: req.file.size,
    points: points.length,
    ...measured,
    course: course._id,
  });
  await fs.promises.mkdir(GPX_DIR, { recursive: true });
  await fs.promises.writeFile(gpxPath(record._id), req.file.buffer);

  course.gpx = record._id;
  course.track = thinTrack(points).map((p) => [p.lat, p.lng]);
  course.distanceM = measured.distanceM;
  course.elevationGainM = measured.elevationGainM;
  // The START is where the new loop begins.
  const start = course.checkpoints.find((c) => c.kind === 'startFinish');
  if (start) Object.assign(start, { lat: points[0].lat, lng: points[0].lng });
  placeOnTrack(course);
  checkDistances(course);
  await course.save();
  await replayCourse(course);
  return sendCourse(res, course, req.user);
};

// DELETE /futokor/courses/:id/track - the loop taken off the course (the
// file too): the points keep their places and distances.
export const deleteTrack = async (req, res) => {
  const course = await courseToManage(req);
  await removeGpx(course);
  course.track = [];
  course.elevationGainM = null;
  await course.save();
  return sendCourse(res, course, req.user);
};

// GET /futokor/courses/:id/track.gpx - the course's GPX file, as it was
// uploaded, to download.
export const getTrackFile = async (req, res) => {
  const course = validId(req.params.id) ? await FutokorCourse.findById(req.params.id) : null;
  const record = course?.gpx ? await GpxTrack.findById(course.gpx) : null;
  if (!record || !fs.existsSync(gpxPath(record._id))) {
    throw new AppError('Ehhez a pályához nincs GPX fájl.', 404);
  }
  res.download(gpxPath(record._id), record.fileName);
};

// GET /futokor/courses/:id/sheet - a user's own track's cards to print.
export const getCourseSheet = async (req, res) => {
  const course = await courseToManage(req);
  if (!isOwnTrack(course)) {
    throw new AppError('A tábori pályák kártyái a Kártyák oldalon nyomtathatók.', 400);
  }
  await sendSheet(
    res,
    course.checkpoints.map((c) => ({
      tagId: c.tagId,
      startFinish: c.kind === 'startFinish',
      number: cardNumber(c.tagId),
      caption: `${course.name} · ${c.tagId}`,
    })),
    'futokor-kartyak.pdf',
  );
};

// DELETE /futokor/courses/:id - the course with everything run on it: its
// scans and its runs go too, and its GPX file. A user's own track takes
// its cards with it; the club's cards stay.
export const deleteCourse = async (req, res) => {
  const course = await courseToManage(req);
  await FutokorRun.deleteMany({ course: course._id });
  await FutokorScan.deleteMany({ course: course._id });
  await FutokorPosition.deleteMany({ course: course._id });
  await FutokorTag.deleteMany({ course: course._id });
  await removeGpx(course);
  await course.deleteOne();
  res.status(204).json({ status: 'success', data: null });
};

// --- Running ---

// The courses to run now: every one that's open - a tour's (at most one)
// first, then the users' own tracks, the newest first.
async function openCourses(now) {
  const courses = await withPeople(FutokorCourse.find(openAt(now)).sort('-createdAt'));
  return [...courses.filter((c) => c.tour), ...courses.filter((c) => !c.tour)];
}

// The tour's course to show when none is open: the next one to open (so a
// phone can get ready for it on Wi-Fi).
const nextTourCourse = (now) =>
  withPeople(
    FutokorCourse.findOne({ tour: { $exists: true }, opensAt: { $gt: now } }).sort('opensAt'),
  );

// GET /futokor/course - the courses for a phone nobody is logged in on
// (someone running with their futókód): public, and without any runs.
export const getCourse = async (req, res) => {
  const now = new Date();
  const courses = await openCourses(now);
  const course = courses.find((c) => c.tour) ?? (await nextTourCourse(now));
  res.status(200).json({
    status: 'success',
    data: {
      course: course ? courseView(course, null) : null,
      courses: courses.map((c) => courseView(c, null)),
      serverTime: now,
    },
  });
};

// POST /futokor/runner - { code }: whose futókód it is, so the phone can
// ask "Indulhat a futás, Peti?" before the start. Public (see the routes
// for how guessing is slowed down); only the name is told.
export const getRunner = async (req, res) => {
  const user = await userOfFutokod(req.body?.code);
  if (!user) throw new AppError('Nincs ilyen futókód.', 404);
  res.status(200).json({ status: 'success', data: { name: shownName(user) } });
};

// GET /futokor/active - what a phone needs to run: every course that's
// open now (`courses` - the tour's first), each with all it takes to run
// it offline, and my runs on each (`allRuns`, by course id). `course` is
// the tour's course - the open one, or else the next to open; null if
// there's neither - with my runs on it (`runs`).
export const getActive = async (req, res) => {
  const now = new Date();
  const courses = await openCourses(now);
  const course = courses.find((c) => c.tour) ?? (await nextTourCourse(now));
  const allRuns = {};
  for (const c of courses) allRuns[refId(c)] = await myRuns(c, req.user);
  res.status(200).json({
    status: 'success',
    data: {
      course: course ? courseView(course, req.user) : null,
      runs: course ? (allRuns[refId(course)] ?? (await myRuns(course, req.user))) : [],
      courses: courses.map((c) => courseView(c, req.user)),
      allRuns,
      // Who this phone runs as: kept on it, for where there's no signal.
      runner: { id: req.user._id, name: shownName(req.user) },
      // For the phone to notice a clock that's off.
      serverTime: now,
    },
  });
};

// Who a request to /futokor/scans runs as: whoever the futókód in it
// belongs to (`runnerCode` - a phone nobody is logged in on, or one lent
// to someone else), otherwise whoever is logged in.
export async function scanRunner(req, res, next) {
  const code = req.body?.runnerCode;
  if (code !== undefined && code !== null && code !== '') {
    const user = await userOfFutokod(String(code));
    if (!user) return next(new AppError('Nincs ilyen futókód.', 404));
    req.user = user;
    return next();
  }
  return requireAuth(req, res, (err) => (err ? next(err) : requireFutokor(req, res, next)));
}

// The course a scan belongs to: the one the phone names (`courseId`), if
// it was open at the scan's time. A phone that doesn't say (an older
// version of the app) gets the course open then that has the card - and,
// giving up, the tour's course open then.
async function courseOfScan(s, tagId, deviceTime) {
  if (s.courseId !== undefined && s.courseId !== null) {
    if (!validId(s.courseId)) return null;
    return FutokorCourse.findOne({ _id: s.courseId, ...openAt(deviceTime) });
  }
  return FutokorCourse.findOne({
    ...openAt(deviceTime),
    ...(tagId ? { 'checkpoints.tagId': tagId } : { tour: { $exists: true } }),
  });
}

// POST /futokor/scans - { runnerCode?, scans: [{ clientScanId, courseId,
// token, deviceTime, action?, lat?, lng?, accuracyM? }] }: what the phone
// has collected, in any order, any time later; sending one again changes
// nothing. A scan belongs to the course the phone names, if that was open
// at the scan's own time. Answers what came of each, and my runs on the
// courses they touched.
export const postScans = async (req, res) => {
  const incoming = req.body?.scans;
  if (!Array.isArray(incoming) || incoming.length > MAX_SCANS_AT_ONCE) {
    throw new AppError(`Egyszerre legfeljebb ${MAX_SCANS_AT_ONCE} leolvasás küldhető.`, 400);
  }

  const results = new Map();
  const courses = new Map();
  for (const s of incoming) {
    const clientScanId = typeof s?.clientScanId === 'string' ? s.clientScanId.slice(0, 64) : '';
    if (!clientScanId) continue;
    const refuse = (result) => results.set(clientScanId, result);

    const stored = await FutokorScan.findOne({ clientScanId });
    if (stored) {
      // Sent before: its course is replayed below, to answer it again.
      if (String(stored.user) !== String(req.user._id)) refuse('invalid');
      else if (!courses.has(String(stored.course))) {
        courses.set(String(stored.course), await FutokorCourse.findById(stored.course));
      }
      continue;
    }

    const deviceTime = new Date(s.deviceTime);
    if (Number.isNaN(+deviceTime) || +deviceTime > Date.now() + CLOCK_AHEAD_MS) {
      refuse('invalid');
      continue;
    }
    const action = ['restart', 'giveUp'].includes(s.action) ? s.action : null;
    const tagId = action === 'giveUp' ? null : verifyTagToken(s.token);
    if (action !== 'giveUp') {
      if (!tagId || !(await FutokorTag.exists({ tagId, retired: false }))) {
        refuse('unknownTag');
        continue;
      }
    }
    const course = await courseOfScan(s, tagId, deviceTime);
    if (!course) {
      refuse('noCourse');
      continue;
    }
    courses.set(String(course._id), course);
    const number = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
    await FutokorScan.create({
      clientScanId,
      user: req.user._id,
      course: course._id,
      tagId,
      action,
      deviceTime,
      lat: number(s.lat),
      lng: number(s.lng),
      accuracyM: number(s.accuracyM),
    });
  }

  const runs = [];
  for (const course of courses.values()) {
    if (!course) continue;
    for (const r of await replayRunner(course, req.user._id)) {
      if (!results.has(r.clientScanId)) results.set(r.clientScanId, r.result);
    }
    // In, or given up: where they were is nobody's business any more.
    if (!(await isRunningNow(course, req.user._id))) {
      await FutokorPosition.deleteOne({ course: course._id, user: req.user._id });
    }
    runs.push({ courseId: course._id, runs: await myRuns(course, req.user) });
  }

  res.status(200).json({
    status: 'success',
    data: {
      results: incoming
        .filter((s) => typeof s?.clientScanId === 'string' && s.clientScanId)
        .map((s) => ({
          clientScanId: s.clientScanId.slice(0, 64),
          result: results.get(s.clientScanId.slice(0, 64)) ?? 'invalid',
        })),
      runs,
    },
  });
};

// --- Live: where the runners are ---

// Has this runner a run on the course right now?
async function isRunningNow(course, userId) {
  const runs = await FutokorRun.find({
    course: course._id,
    user: userId,
    status: 'running',
  }).lean();
  const rules = courseRules(course);
  return runs.some((run) => !isExpired(rules, asRulesRun(run), Date.now()));
}

// PUT /futokor/courses/:id/position - { lat, lng, accuracyM? }: where I am,
// for the others to watch ("Élő követés" - the runner's own choice, the
// phone sends it every ten seconds or so). Only while I have a run on the
// course (409 otherwise). It takes the place of my last one: no trail is
// kept.
export const putPosition = async (req, res) => {
  const course = validId(req.params.id) ? await FutokorCourse.findById(req.params.id) : null;
  if (!course) throw new AppError('Nincs ilyen pálya.', 404);
  const { lat, lng, accuracyM } = req.body ?? {};
  const within = (v, max) => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= max;
  if (!within(lat, 90) || !within(lng, 180)) throw new AppError('Hibás helyzet.', 400);

  const mine = { course: course._id, user: req.user._id };
  if (!(await isRunningNow(course, req.user._id))) {
    await FutokorPosition.deleteOne(mine);
    throw new AppError('Nincs folyamatban lévő futásod ezen a pályán.', 409);
  }
  await FutokorPosition.findOneAndUpdate(
    mine,
    {
      lat,
      lng,
      accuracyM: typeof accuracyM === 'number' && accuracyM >= 0 ? Math.round(accuracyM) : null,
      at: new Date(),
    },
    { upsert: true },
  );
  res.status(204).json({ status: 'success', data: null });
};

// DELETE /futokor/courses/:id/position - I'm not to be seen any more (the
// run is over, or "Élő követés" was switched off).
export const deletePosition = async (req, res) => {
  if (validId(req.params.id)) {
    await FutokorPosition.deleteOne({ course: req.params.id, user: req.user._id });
  }
  res.status(204).json({ status: 'success', data: null });
};

// Where the runners of a course are right now: those with a run on, who
// let themselves be seen, and whose phone has just said where it is.
async function livePositions(course, runners) {
  const running = new Map(
    runners
      .filter((r) => r.runs.some((run) => run.status === 'running'))
      .map((r) => [String(r.userId), r]),
  );
  if (!running.size) return [];
  const fresh = await FutokorPosition.find({
    course: course._id,
    at: { $gte: new Date(Date.now() - POSITION_FRESH_MS) },
  }).lean();
  return fresh
    .filter((p) => running.has(String(p.user)))
    .map((p) => ({
      userId: p.user,
      name: running.get(String(p.user)).name,
      lat: p.lat,
      lng: p.lng,
      accuracyM: p.accuracyM,
      at: p.at,
    }));
}

// --- Results ---

// A runner's age group at the time of the course: ten years wide ("30-39")
// - null without a birthday. The results can be narrowed by it; the age
// itself stays the admins' to see (it never leaves the server here).
function ageGroup(birthday, at) {
  const age = computeAge(birthday, at);
  if (age === null || age < 0) return null;
  const from = Math.floor(age / 10) * 10;
  return `${from}-${from + 9}`;
}

// Every runner of a course by their best finished time (the earlier one
// first if two are the same); those who never finished come after, by
// name. Each with all their runs, the latest first - and their gender and
// age group, to narrow the list by.
async function courseRunners(course) {
  const runs = await FutokorRun.find({ course: course._id })
    .sort('-startedAt')
    .populate({ path: 'user', select: 'name username photoUpdatedAt gender birthday' })
    .lean();
  const runners = new Map();
  for (const run of runs) {
    if (!run.user) continue;
    const key = String(run.user._id);
    if (!runners.has(key)) {
      runners.set(key, {
        userId: run.user._id,
        name: shownName(run.user),
        photoUpdatedAt: run.user.photoUpdatedAt ?? null,
        gender: run.user.gender ?? null,
        ageGroup: ageGroup(run.user.birthday, course.opensAt),
        best: null,
        finishedRuns: 0,
        runs: [],
      });
    }
    const runner = runners.get(key);
    const view = runView(course, asRulesRun(run));
    runner.runs.push(view);
    if (view.status !== 'finished') continue;
    runner.finishedRuns += 1;
    const better =
      !runner.best ||
      view.totalMs < runner.best.totalMs ||
      (view.totalMs === runner.best.totalMs && view.finishedAt < runner.best.finishedAt);
    if (better) runner.best = view;
  }
  return [...runners.values()].sort((a, b) => {
    if (!a.best || !b.best) return a.best ? -1 : b.best ? 1 : a.name.localeCompare(b.name, 'hu');
    return a.best.totalMs - b.best.totalMs || a.best.finishedAt - b.best.finishedAt;
  });
}

// GET /futokor/results - every futókör there has been - the tours' and the
// users' own tracks - the newest first: each with how many ran it and who
// was the fastest. (Each stands alone: they're never compared.)
export const getResults = async (req, res) => {
  const courses = await withPeople(FutokorCourse.find().sort('-opensAt'));
  const results = [];
  for (const course of courses) {
    const runners = await courseRunners(course);
    const winner = runners[0]?.best ? runners[0] : null;
    const view = courseView(course, req.user);
    results.push({
      _id: course._id,
      kind: view.kind,
      name: course.name,
      tour: view.tour,
      owner: view.owner,
      opensAt: course.opensAt,
      closesAt: course.closesAt,
      distanceM: course.distanceM,
      runners: runners.length,
      finishedRuns: runners.reduce((sum, r) => sum + r.finishedRuns, 0),
      // On the course right now: started, not yet finished or given up.
      runningNow: runners.filter((r) => r.runs.some((run) => run.status === 'running')).length,
      winner: winner && { name: winner.name, totalMs: winner.best.totalMs },
    });
  }
  res.status(200).json({ status: 'success', data: { courses: results } });
};

// GET /futokor/courses/:id/results - one futókör's results: the course
// (with its checkpoints, to name the splits by) and every runner in the
// order of their best time, each with all their runs and the runs' splits.
// And `positions`: where those running right now are - the ones who let
// themselves be watched.
export const getCourseResults = async (req, res) => {
  const course = validId(req.params.id)
    ? await withPeople(FutokorCourse.findById(req.params.id))
    : null;
  if (!course) throw new AppError('Nincs ilyen pálya.', 404);
  const runners = await courseRunners(course);
  res.status(200).json({
    status: 'success',
    data: {
      course: courseView(course, req.user),
      runners,
      positions: await livePositions(course, runners),
    },
  });
};

// GET /futokor/courses/:id/leaderboard - every runner by their best
// finished time (the earlier one first if two are the same), with how many
// times they finished.
export const getLeaderboard = async (req, res) => {
  const course = validId(req.params.id) ? await FutokorCourse.findById(req.params.id) : null;
  if (!course) throw new AppError('Nincs ilyen pálya.', 404);
  const runs = await FutokorRun.find({ course: course._id, status: 'finished' })
    .sort('totalMs finishedAt')
    .populate({ path: 'user', select: 'name username photoUpdatedAt' });

  const best = new Map();
  for (const run of runs) {
    if (!run.user) continue;
    const key = String(run.user._id);
    if (best.has(key)) {
      best.get(key).finishedRuns += 1;
      continue;
    }
    best.set(key, {
      userId: run.user._id,
      name: shownName(run.user),
      photoUpdatedAt: run.user.photoUpdatedAt ?? null,
      totalMs: run.totalMs,
      paceSecPerKm: run.paceSecPerKm,
      finishedAt: run.finishedAt,
      flagged: run.flagged,
      finishedRuns: 1,
    });
  }
  res.status(200).json({ status: 'success', data: { runners: [...best.values()] } });
};
