import path from 'path';
import mongoose from 'mongoose';
import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import Tour from '../models/tourModel.js';
import { FutokorCourse, FutokorRun, FutokorScan, FutokorTag } from '../models/futokorModels.js';
import AppError from '../utils/appError.js';
import requireAuth from '../auth/requireAuth.js';
import { requireFutokor } from '../futokor/access.js';
import { isExpired, replayScans } from '../futokor/runRules.js';
import { tagUrl, verifyTagToken } from '../futokor/tags.js';
import { userOfFutokod } from '../utils/futokod.js';

// Futókör: the checkpoint running race of a tour (Móka → Futókörök).
// Cards (tags) are scanned by the runners' phones; the phones send their
// scans here whenever they have a connection, and a runner's runs are
// worked out from all of their scans by the rules in futokor/runRules.js -
// the same rules the phone applies on its own in the meantime.

const MAX_NEW_TAGS = 30;
// (The request body is small - see app.js: the phone sends more in turns.)
const MAX_SCANS_AT_ONCE = 40;
// A phone's clock may be a little ahead of the server's - not more.
const CLOCK_AHEAD_MS = 5 * 60 * 1000;

const rootDir = path.resolve();
const FONT_REGULAR = path.join(rootDir, 'assets', 'fonts', 'Mulish-Regular.ttf');
const FONT_BOLD = path.join(rootDir, 'assets', 'fonts', 'Mulish-Bold.ttf');

const shownName = (user) => user?.username || user?.name || 'Ismeretlen';
const validId = (id) => typeof id === 'string' && mongoose.isValidObjectId(id);

// --- A course, the way the rules and the phones need it ---

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
const courseView = (course) => ({
  _id: course._id,
  tour: course.tour?._id
    ? { _id: course.tour._id, title: course.tour.title }
    : { _id: course.tour },
  name: course.name,
  opensAt: course.opensAt,
  closesAt: course.closesAt,
  // The loop to draw on the map ([lat, lng] pairs) - empty if none yet.
  track: course.track ?? [],
  elevationGainM: course.elevationGainM ?? null,
  ...courseRules(course),
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

// The course open at that moment - at most one (see overlapping below).
const courseOpenAt = (time) =>
  FutokorCourse.findOne({ opensAt: { $lte: time }, closesAt: { $gte: time } });

// --- Cards ---

const tagView = (tag) => ({
  tagId: tag.tagId,
  kind: tag.kind,
  retired: tag.retired,
  // What its QR code says.
  url: tagUrl(tag.tagId),
  createdAt: tag.createdAt,
});

// GET /futokor/tags - every card, admins.
export const getTags = async (req, res) => {
  const tags = await FutokorTag.find().sort('kind tagId');
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
    { tagId: String(req.params.tagId) },
    { retired: req.body.retired },
    { returnDocument: 'after' },
  );
  if (!tag) throw new AppError('Nincs ilyen kártya.', 404);
  res.status(200).json({ status: 'success', data: { tag: tagView(tag) } });
};

// GET /futokor/tags/sheet - the cards to print, cut and laminate: six to
// an A4 page, each with its QR code and its name in big letters.
export const getTagSheet = async (req, res) => {
  const tags = await FutokorTag.find({ retired: false }).sort('kind tagId');
  if (!tags.length) throw new AppError('Még nincs egy kártya sem.', 404);

  const doc = new PDFDocument({ size: 'A4', margin: 0 });
  doc.registerFont('Body', FONT_REGULAR);
  doc.registerFont('Heading', FONT_BOLD);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'inline; filename="futokor-kartyak.pdf"');
  doc.pipe(res);

  // Six cards fill the page: the QR code as big as a card allows (the
  // bigger, the further a phone reads it from), its number and a small
  // caption right under it.
  const [cols, rows, margin] = [2, 3, 12];
  const cellW = (doc.page.width - margin * 2) / cols;
  const cellH = (doc.page.height - margin * 2) / rows;
  const [numberSize, captionSize] = [32, 8];
  const qrSize = Math.min(cellW - 16, cellH - numberSize * 1.3 - captionSize * 1.6 - 10);

  for (const [i, tag] of tags.entries()) {
    const slot = i % (cols * rows);
    if (i > 0 && slot === 0) doc.addPage();
    const x = margin + (slot % cols) * cellW;
    const y = margin + Math.floor(slot / cols) * cellH;
    const startFinish = tag.kind === 'startFinish';

    // Where to cut.
    doc
      .rect(x + 2, y + 2, cellW - 4, cellH - 4)
      .dash(4, { space: 4 })
      .lineWidth(0.7)
      .stroke(startFinish ? '#f07827' : '#9aa5ab')
      .undash();
    const qr = await QRCode.toBuffer(tagUrl(tag.tagId), { width: 800, margin: 1 });
    doc.image(qr, x + (cellW - qrSize) / 2, y + 6, { width: qrSize });
    doc
      .font('Heading')
      .fontSize(startFinish ? 26 : numberSize)
      .fillColor(startFinish ? '#f07827' : '#1b6548')
      .text(startFinish ? 'RAJT / CÉL' : tag.tagId.slice(1), x, y + 6 + qrSize, {
        width: cellW,
        align: 'center',
        lineBreak: false,
      });
    doc
      .font('Body')
      .fontSize(captionSize)
      .fillColor('#56666e')
      .text(`Bódorgó Futókör · ${tag.tagId}`, x, y + cellH - captionSize * 1.6 - 4, {
        width: cellW,
        align: 'center',
        lineBreak: false,
      });
  }
  doc.end();
};

// --- Courses ---

const withTour = (query) => query.populate({ path: 'tour', select: 'title' });

// No two courses are open at the same time: a card scanned at any moment
// must belong to one course only.
async function overlapping(opensAt, closesAt, exceptId) {
  return FutokorCourse.exists({
    _id: { $ne: exceptId },
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

// GET /futokor/courses - every course, the newest first; admins.
export const getCourses = async (req, res) => {
  const courses = await withTour(FutokorCourse.find().sort('-opensAt'));
  res.status(200).json({ status: 'success', data: { courses: courses.map(courseView) } });
};

// POST /futokor/courses - a tour's course: { tourId, name?, opensAt, closesAt }.
export const createCourse = async (req, res) => {
  const { tourId, name } = req.body ?? {};
  const tour = validId(tourId) ? await Tour.findById(tourId).select('title') : null;
  if (!tour) throw new AppError('Nincs ilyen tábor.', 400);
  if (await FutokorCourse.exists({ tour: tour._id })) {
    throw new AppError('Ennek a tábornak már van pályája.', 400);
  }
  const window = parseWindow(req.body);
  if (await overlapping(window.opensAt, window.closesAt, null)) {
    throw new AppError('Ebben az időszakban már nyitva van egy másik pálya.', 400);
  }
  const course = await FutokorCourse.create({
    tour: tour._id,
    name: (typeof name === 'string' && name.trim()) || `${tour.title} futókör`,
    createdBy: req.user._id,
    ...window,
  });
  res.status(201).json({
    status: 'success',
    data: { course: courseView(await withTour(FutokorCourse.findById(course._id))) },
  });
};

const positiveOrNull = (value, what) => {
  if (value === null || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) throw new AppError(`${what}: pozitív szám kell.`, 400);
  return n;
};

// PATCH /futokor/courses/:id - its name, when it's open, its limits, how
// long the loop is, and its cards: { startTagId, stops: [{ tagId,
// distanceAlongM? }] } - the checkpoints in the order they're passed.
// Every runner's runs are worked out again afterwards (their splits and
// paces follow the distances).
export const updateCourse = async (req, res) => {
  const course = validId(req.params.id) ? await FutokorCourse.findById(req.params.id) : null;
  if (!course) throw new AppError('Nincs ilyen pálya.', 404);
  const body = req.body ?? {};

  if (typeof body.name === 'string' && body.name.trim()) course.name = body.name.trim();
  if (body.opensAt !== undefined || body.closesAt !== undefined) {
    const window = parseWindow(body, course);
    if (await overlapping(window.opensAt, window.closesAt, course._id)) {
      throw new AppError('Ebben az időszakban már nyitva van egy másik pálya.', 400);
    }
    Object.assign(course, window);
  }
  if (body.maxRunDurationMin !== undefined) {
    course.maxRunDurationMin =
      positiveOrNull(body.maxRunDurationMin, 'Leghosszabb futás') ?? course.maxRunDurationMin;
  }
  if (body.distanceM !== undefined)
    course.distanceM = positiveOrNull(body.distanceM, 'A kör hossza');

  if (body.startTagId !== undefined || body.stops !== undefined) {
    const stops = Array.isArray(body.stops) ? body.stops : [];
    const ids = [body.startTagId, ...stops.map((s) => s?.tagId)].map(String);
    if (new Set(ids).size !== ids.length) {
      throw new AppError('Egy kártya csak egyszer szerepelhet a pályán.', 400);
    }
    const tags = await FutokorTag.find({ tagId: { $in: ids }, retired: false });
    const kindOf = Object.fromEntries(tags.map((t) => [t.tagId, t.kind]));
    if (kindOf[ids[0]] !== 'startFinish') {
      throw new AppError('A pályához egy RAJT / CÉL kártya kell.', 400);
    }
    if (ids.slice(1).some((id) => kindOf[id] !== 'checkpoint')) {
      throw new AppError('Ismeretlen vagy letiltott kártya van a pontok között.', 400);
    }
    let previous = 0;
    // Where each point is on the map (from the course's track, see
    // scripts/attachFutokorTrack.mjs) stays with the point - the 2nd point
    // is where it was, whichever card hangs there now.
    const placeOf = (order) => {
      const was = course.checkpoints.find((c) => c.order === order);
      return { lat: was?.lat ?? null, lng: was?.lng ?? null };
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
      ...stops.map((s, i) => {
        const distanceAlongM = positiveOrNull(s.distanceAlongM ?? null, `${i + 1}. pont távolsága`);
        if (distanceAlongM !== null) {
          if (distanceAlongM <= previous) {
            throw new AppError('A pontok távolsága a rajttól sorban nőjön.', 400);
          }
          previous = distanceAlongM;
        }
        return {
          tagId: ids[i + 1],
          kind: 'checkpoint',
          label: `${i + 1}. pont`,
          order: i + 1,
          distanceAlongM,
          ...placeOf(i + 1),
        };
      }),
    ];
  }
  const lastStop = course.checkpoints.at(-1)?.distanceAlongM ?? 0;
  if (course.distanceM !== null && course.distanceM <= lastStop) {
    throw new AppError('A kör hossza legyen nagyobb az utolsó pont távolságánál.', 400);
  }
  await course.save();

  for (const userId of await FutokorScan.distinct('user', { course: course._id })) {
    await replayRunner(course, userId);
  }
  res.status(200).json({
    status: 'success',
    data: { course: courseView(await withTour(FutokorCourse.findById(course._id))) },
  });
};

// DELETE /futokor/courses/:id - the course with everything run on it: its
// scans and its runs go too (a trial course, say). The cards stay.
export const deleteCourse = async (req, res) => {
  const course = validId(req.params.id) ? await FutokorCourse.findById(req.params.id) : null;
  if (!course) throw new AppError('Nincs ilyen pálya.', 404);
  await FutokorRun.deleteMany({ course: course._id });
  await FutokorScan.deleteMany({ course: course._id });
  await course.deleteOne();
  res.status(204).json({ status: 'success', data: null });
};

// --- Running ---

// The course to run now: the one that's open, or else the next to open.
async function currentCourse(now) {
  return (
    (await withTour(courseOpenAt(now))) ??
    (await withTour(FutokorCourse.findOne({ opensAt: { $gt: now } }).sort('opensAt')))
  );
}

// GET /futokor/course - the same course for a phone nobody is logged in
// on (someone running with their futókód): public, and without any runs.
export const getCourse = async (req, res) => {
  const now = new Date();
  const course = await currentCourse(now);
  res.status(200).json({
    status: 'success',
    data: { course: course ? courseView(course) : null, serverTime: now },
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

// GET /futokor/active - the course to run now: the one that's open, or
// else the next one to open (so a phone can get ready for it on Wi-Fi) -
// with my runs on it. `course` is null if there's neither.
export const getActive = async (req, res) => {
  const now = new Date();
  const course = await currentCourse(now);
  res.status(200).json({
    status: 'success',
    data: {
      course: course ? courseView(course) : null,
      runs: course ? await myRuns(course, req.user) : [],
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

// POST /futokor/scans - { runnerCode?, scans: [{ clientScanId, token,
// deviceTime, action?, lat?, lng?, accuracyM? }] }: what the phone has collected, in
// any order, any time later; sending one again changes nothing. A scan
// belongs to the course that was open at its own time. Answers what came
// of each, and my runs on the courses they touched.
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
    const course = await courseOpenAt(deviceTime);
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

// Every runner of a course by their best finished time (the earlier one
// first if two are the same); those who never finished come after, by
// name. Each with all their runs, the latest first.
async function courseRunners(course) {
  const runs = await FutokorRun.find({ course: course._id })
    .sort('-startedAt')
    .populate({ path: 'user', select: 'name username photoUpdatedAt' })
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

// GET /futokor/results - every futókör there has been, the newest first:
// each with how many ran it and who was the fastest.
export const getResults = async (req, res) => {
  const courses = await withTour(FutokorCourse.find().sort('-opensAt'));
  const results = [];
  for (const course of courses) {
    const runners = await courseRunners(course);
    const winner = runners[0]?.best ? runners[0] : null;
    results.push({
      _id: course._id,
      name: course.name,
      tour: { _id: course.tour?._id ?? course.tour, title: course.tour?.title },
      opensAt: course.opensAt,
      closesAt: course.closesAt,
      distanceM: course.distanceM,
      runners: runners.length,
      finishedRuns: runners.reduce((sum, r) => sum + r.finishedRuns, 0),
      winner: winner && { name: winner.name, totalMs: winner.best.totalMs },
    });
  }
  res.status(200).json({ status: 'success', data: { courses: results } });
};

// GET /futokor/courses/:id/results - one futókör's results: the course
// (with its checkpoints, to name the splits by) and every runner in the
// order of their best time, each with all their runs and the runs' splits.
export const getCourseResults = async (req, res) => {
  const course = validId(req.params.id)
    ? await withTour(FutokorCourse.findById(req.params.id))
    : null;
  if (!course) throw new AppError('Nincs ilyen pálya.', 404);
  res.status(200).json({
    status: 'success',
    data: { course: courseView(course), runners: await courseRunners(course) },
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
