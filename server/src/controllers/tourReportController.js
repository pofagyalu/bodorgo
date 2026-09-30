import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import PDFDocument from 'pdfkit';
import sharp from 'sharp';
import Tour from '../models/tourModel.js';
import Reservation from '../models/reservationModel.js';
import TourReport from '../models/tourReportModel.js';
import AppError from '../utils/appError.js';
import config from '../config.js';
import { getClubSettings } from '../utils/clubSettings.js';
import { huDate, huDateRange, huDayLabel } from '../utils/huDate.js';
import { waxSealPng } from '../utils/waxSeal.js';

// A tour's beszámoló - what happened there, day by day. An admin writes it
// on the tour page (one editor per day, saved as they type, for as many
// days as it takes), then says Kész: from then on the tour's attendees can
// download it as a PDF - a photo from the tour's album, the tour's place,
// dates and headcount, the days as bullet points, and at the end the club's
// name, the elnök, and a red wax seal (utils/waxSeal.js).

const CLUB_NAME = 'Bódorgó Szabadidős, Kulturális és Fogyasztóvédelmi Klub';

const rootDir = path.resolve();
const LOGO_PATH = path.join(rootDir, 'assets', 'img', 'logo.png');
const FONT_REGULAR = path.join(rootDir, 'assets', 'fonts', 'Mulish-Regular.ttf');
const FONT_BOLD = path.join(rootDir, 'assets', 'fonts', 'Mulish-Bold.ttf');
const FONT_ITALIC = path.join(rootDir, 'assets', 'fonts', 'Mulish-Italic.ttf');

const FACT_KEYS = ['place', 'dates', 'headcount'];
const MAX_DAYS = 10; // tourModel's duration max
const MAX_DAY_CHARS = 50000;
const MAX_FACT_CHARS = 300;

async function findTour(idParam) {
  const query = mongoose.isValidObjectId(idParam) ? { _id: idParam } : { slug: idParam };
  const tour = await Tour.findOne(query);
  if (!tour) throw new AppError('No tour found with that ID!', 404);
  return tour;
}

const isAdmin = (user) => user?.role === 'admin';

async function isAttendee(userId, tourId) {
  return !!(await Reservation.exists({ tour: tourId, 'attendees.user': userId }));
}

// --- The header facts ---

// What each header line says when the admin leaves it empty: from the tour
// itself, and the number of people signed up for it.
async function autoFacts(tour) {
  const place = [tour.location?.description, tour.location?.address]
    .map((s) => (s ?? '').trim())
    .filter(Boolean)
    .filter((s, i, all) => i === 0 || !all[0].includes(s))
    .join(', ');
  const attendees = await Reservation.distinct('attendees.user', { tour: tour._id });
  const headcount = attendees.filter(Boolean).length;
  return {
    place,
    dates: huDateRange(tour.startDate, tour.duration),
    headcount: headcount ? `${headcount} fő` : '',
  };
}

const effectiveFacts = (facts, auto) =>
  Object.fromEntries(FACT_KEYS.map((k) => [k, (facts?.[k] ?? '').trim() || auto[k]]));

// --- The day texts (Quill deltas) ---

// Keeps only what the editor's toolbar offers - text, bold/italic/
// underline, bullet and numbered lists and their levels - and drops the
// rest (pictures, links, colors…).
function cleanDelta(delta) {
  const ops = Array.isArray(delta?.ops) ? delta.ops : [];
  const out = [];
  let chars = 0;
  for (const op of ops) {
    if (typeof op?.insert !== 'string' || !op.insert) continue;
    chars += op.insert.length;
    if (chars > MAX_DAY_CHARS) throw new AppError('Egy nap szövege túl hosszú.', 400);
    const a = op.attributes ?? {};
    const attributes = {};
    if (a.bold === true) attributes.bold = true;
    if (a.italic === true) attributes.italic = true;
    if (a.underline === true) attributes.underline = true;
    if (['bullet', 'checked', 'unchecked'].includes(a.list)) attributes.list = 'bullet';
    if (a.list === 'ordered') attributes.list = 'ordered';
    if (Number.isInteger(a.indent) && a.indent > 0) attributes.indent = Math.min(a.indent, 4);
    out.push(
      Object.keys(attributes).length ? { insert: op.insert, attributes } : { insert: op.insert },
    );
  }
  return { ops: out };
}

const hasText = (delta) => (delta?.ops ?? []).some((op) => op.insert?.trim?.());

// A delta as lines: [{ runs: [{ text, bold, italic, underline }], list,
// indent }] - in a delta a line's own format (list, indent) sits on the
// newline that ends it.
function deltaLines(delta) {
  const lines = [];
  let runs = [];
  for (const op of delta?.ops ?? []) {
    if (typeof op.insert !== 'string') continue;
    const a = op.attributes ?? {};
    op.insert.split('\n').forEach((part, i, parts) => {
      if (part)
        runs.push({ text: part, bold: !!a.bold, italic: !!a.italic, underline: !!a.underline });
      if (i < parts.length - 1) {
        lines.push({ runs, list: a.list ?? null, indent: a.indent ?? 0 });
        runs = [];
      }
    });
  }
  if (runs.length) lines.push({ runs, list: null, indent: 0 });
  // No empty lines at the start or the end.
  while (lines.length && !lines[0].runs.length) lines.shift();
  while (lines.length && !lines.at(-1).runs.length) lines.pop();
  return lines;
}

// --- The views ---

function dayCount(tour, report) {
  return Math.min(MAX_DAYS, Math.max(tour.duration ?? 1, report?.days?.length ?? 0));
}

async function adminView(tour, report) {
  const count = dayCount(tour, report);
  return {
    status: report?.status ?? 'draft',
    days: Array.from({ length: count }, (_, i) => report?.days?.[i] ?? null),
    dayLabels: Array.from({ length: count }, (_, i) => huDayLabel(tour.startDate, i)),
    facts: Object.fromEntries(FACT_KEYS.map((k) => [k, report?.facts?.[k] ?? ''])),
    photo: report?.photo ?? null,
    auto: await autoFacts(tour),
    updatedAt: report?.updatedAt ?? null,
    updatedByName: report?.updatedByName ?? null,
    published: report?.published?.at
      ? { at: report.published.at, byName: report.published.byName }
      : null,
  };
}

// GET /tours/:id/report - whether this viewer can download the beszámoló
// (it's finished, and they were on the tour - or they're an admin); an
// admin also gets the whole working copy to edit.
export const getReport = async (req, res) => {
  const tour = await findTour(req.params.id);
  const report = await TourReport.findOne({ tour: tour._id });
  const publishedAt = report?.published?.at ?? null;
  const admin = isAdmin(req.user);
  const canDownload = !!publishedAt && (admin || (await isAttendee(req.user._id, tour._id)));
  res.status(200).json({
    status: 'success',
    data: {
      canDownload,
      publishedAt: canDownload ? publishedAt : null,
      ...(admin ? { report: await adminView(tour, report) } : {}),
    },
  });
};

// PUT /tours/:id/report (admin) - { days: [delta], facts, photo } - the
// working copy, saved as the admin types. Not while it's Kész. photo: the
// file name of one of the tour's album photos (or null).
export const saveReport = async (req, res) => {
  const tour = await findTour(req.params.id);
  const days = Array.isArray(req.body?.days) ? req.body.days : [];
  if (days.length > MAX_DAYS) throw new AppError('Túl sok nap.', 400);
  const facts = {};
  for (const k of FACT_KEYS) {
    const value = String(req.body?.facts?.[k] ?? '').trim();
    if (value.length > MAX_FACT_CHARS) throw new AppError('Túl hosszú fejléc sor.', 400);
    facts[k] = value;
  }

  const photo = req.body?.photo ? String(req.body.photo) : null;
  if (photo) {
    const withImages = await Tour.findById(tour._id).select('+images');
    if (!withImages.images.some((i) => i.filename === photo)) {
      throw new AppError('Nincs ilyen fénykép ennek a tábornak az albumában.', 400);
    }
  }

  const existing = await TourReport.findOne({ tour: tour._id });
  if (existing?.status === 'final') {
    throw new AppError('A beszámoló már kész - a szerkesztéshez előbb nyisd vissza.', 409);
  }
  const report = existing ?? new TourReport({ tour: tour._id });
  report.days = days.map((d) => (d ? cleanDelta(d) : null));
  report.facts = facts;
  report.photo = photo;
  report.updatedByName = req.user.name;
  report.markModified('days');
  await report.save();
  res.status(200).json({ status: 'success', data: { updatedAt: report.updatedAt } });
};

// POST /tours/:id/report/finish (admin) - Kész: locks the working copy and
// makes it the one the attendees download.
export const finishReport = async (req, res) => {
  const tour = await findTour(req.params.id);
  const report = await TourReport.findOne({ tour: tour._id });
  if (!report || !(report.days ?? []).some(hasText)) {
    throw new AppError('Még egy napról sincs szöveg a beszámolóban.', 400);
  }
  report.status = 'final';
  report.published = {
    days: report.days,
    facts: report.facts,
    photo: report.photo,
    at: new Date(),
    byName: req.user.name,
  };
  await report.save();
  res.status(200).json({ status: 'success', data: { report: await adminView(tour, report) } });
};

// POST /tours/:id/report/reopen (admin) - Visszanyitás: editable again;
// the attendees keep downloading the last finished one meanwhile.
export const reopenReport = async (req, res) => {
  const tour = await findTour(req.params.id);
  const report = await TourReport.findOne({ tour: tour._id });
  if (!report) throw new AppError('Ehhez a táborhoz még nincs beszámoló.', 404);
  report.status = 'draft';
  await report.save();
  res.status(200).json({ status: 'success', data: { report: await adminView(tour, report) } });
};

// --- The PDF ---

const INK = '#1f2a26';
const GREEN = '#1b6548';
const GREY = '#7a8580';
const CARD = '#f1f6f3';
const LINE = '#d5dfda';
// The logo's colors (tourPdfController.js's COLORS) - one per day label.
const DAY_COLORS = ['#1b6548', '#f07827', '#096396', '#835638', '#72b45d', '#f40e0d', '#f6b528'];
const MARGIN = 60;
const MARGINS = { top: 78, bottom: 70, left: MARGIN, right: MARGIN };
const BODY_SIZE = 11;
const LEVEL_STEP = 18;
const SEAL_SIZE = 108;
const PHOTO_MAX_HEIGHT = 250;

const tourHeading = (tour) =>
  tour.order === 1
    ? 'Első bódorgó tábor'
    : tour.order
      ? `${tour.order}. bódorgó tábor`
      : 'Bódorgó tábor';

const bottomOf = (doc) => doc.page.height - doc.page.margins.bottom;

// A new page unless `height` still fits on this one.
function ensureRoom(doc, height) {
  if (doc.y + height > bottomOf(doc)) doc.addPage();
}

// The bullet of a list level: •, ◦, ▪ (as drawn shapes - the font has no
// ◦/▪), then a dash.
function drawBullet(doc, level, x, y, color = INK) {
  doc.save().fillColor(color).strokeColor(color).lineWidth(0.8);
  if (level === 0) doc.circle(x, y, 2.2).fill();
  else if (level === 1) doc.circle(x, y, 2).stroke();
  else if (level === 2) doc.rect(x - 1.8, y - 1.8, 3.6, 3.6).fill();
  else
    doc
      .moveTo(x - 2.2, y)
      .lineTo(x + 2.2, y)
      .stroke();
  doc.restore();
}

function fontFor(run) {
  if (run.bold) return 'Heading';
  if (run.italic) return 'Italic';
  return 'Body';
}

// One line of text, its runs in their own fonts, at x, wrapping within the
// page - a new page first if not even its first line would fit. marker
// (the bullet or number) is drawn first, beside the first line - before a
// long text can run over onto the next page.
function textLine(doc, runs, x, marker) {
  const width = doc.page.width - MARGIN - x;
  const lineHeight = doc.font('Body').fontSize(BODY_SIZE).currentLineHeight(true);
  ensureRoom(doc, lineHeight);
  const top = doc.y;
  marker?.(top, lineHeight);
  const parts = runs.length ? runs : [{ text: ' ' }];
  parts.forEach((run, i) => {
    doc.font(fontFor(run)).fontSize(BODY_SIZE).fillColor(INK);
    const options = {
      width,
      continued: i < parts.length - 1,
      underline: !!run.underline,
      lineGap: 1.5,
    };
    if (i === 0) doc.text(run.text, x, top, options);
    else doc.text(run.text, options);
  });
}

// A day: a colored "1. nap" label with its date, and what the admin wrote
// below it - bullets •, sub-bullets ◦, then ▪ - the first level in the
// day's color.
function drawDay(doc, index, label, delta) {
  const color = DAY_COLORS[index % DAY_COLORS.length];
  const base = MARGIN + 6;
  const bulletAt = (level) => base + level * LEVEL_STEP;
  const textAt = (level) => bulletAt(level) + 11;

  doc.moveDown(0.9);
  ensureRoom(doc, 60); // the label and a line or two with it
  const top = doc.y;
  const title = `${index + 1}. nap`;
  doc.font('Heading').fontSize(11);
  const pillWidth = doc.widthOfString(title) + 18;
  doc.roundedRect(MARGIN, top, pillWidth, 19, 9.5).fill(color);
  doc.fillColor('#fff').text(title, MARGIN + 9, top + 3.5, { lineBreak: false });
  if (label) {
    doc
      .font('Italic')
      .fontSize(10)
      .fillColor(GREY)
      .text(label, MARGIN + pillWidth + 8, top + 4, { lineBreak: false });
  }
  doc.y = top + 19 + 6;

  const bullet = (level) => (at, lineHeight) =>
    drawBullet(doc, level, bulletAt(level), at + lineHeight * 0.5, level === 0 ? color : INK);
  const counters = [];
  for (const line of deltaLines(delta)) {
    if (!line.runs.length) {
      doc.moveDown(0.4);
      continue;
    }
    const level = line.list ? line.indent : 0;
    doc.moveDown(0.15);
    if (line.list === 'ordered') {
      counters.length = level + 1;
      counters[level] = (counters[level] ?? 0) + 1;
      const number = `${counters[level]}.`;
      textLine(doc, line.runs, textAt(level), (at) => {
        doc
          .font('Heading')
          .fontSize(BODY_SIZE)
          .fillColor(level === 0 ? color : INK);
        doc.text(number, bulletAt(level) - 10, at, { width: 18, align: 'right', lineBreak: false });
      });
    } else if (line.list) {
      counters.length = level;
      textLine(doc, line.runs, textAt(level), bullet(level));
    } else {
      // A plain paragraph starts where the bullets' text does.
      counters.length = 0;
      textLine(doc, line.runs, textAt(0));
    }
  }
}

// The header facts in a light card: Helyszín across the top (a link to
// the map), then Időpont and Létszám side by side.
function drawFacts(doc, facts, mapUrl) {
  const pad = 14;
  const width = doc.page.width - MARGIN * 2;
  const inner = width - pad * 2;
  const rows = [
    [{ label: 'Helyszín', value: facts.place, link: mapUrl }],
    [
      { label: 'Időpont', value: facts.dates, weight: 0.6 },
      { label: 'Létszám', value: facts.headcount, weight: 0.4 },
    ],
  ]
    .map((row) => row.filter((c) => c.value))
    .filter((row) => row.length);
  if (!rows.length) return;

  const labelHeight = 12;
  const rowGap = 10;
  // Each cell's share of the row.
  const share = (row, c) => (c.weight ?? 1) / row.reduce((sum, x) => sum + (x.weight ?? 1), 0);
  const cellWidth = (row, c) => inner * share(row, c) - (row.length > 1 ? 10 : 0);
  const rowHeights = rows.map((row) =>
    Math.max(
      ...row.map(
        (c) =>
          labelHeight +
          doc
            .font('Body')
            .fontSize(BODY_SIZE)
            .heightOfString(c.value, { width: cellWidth(row, c) }),
      ),
    ),
  );
  const height = pad * 2 + rowHeights.reduce((a, b) => a + b, 0) + rowGap * (rows.length - 1);
  ensureRoom(doc, height);
  const top = doc.y;
  doc.roundedRect(MARGIN, top, width, height, 8).fill(CARD);
  doc.rect(MARGIN, top + 8, 3, height - 16).fill(GREEN);

  let y = top + pad;
  rows.forEach((row, r) => {
    row.forEach((c, i) => {
      const x = MARGIN + pad + inner * row.slice(0, i).reduce((sum, x) => sum + share(row, x), 0);
      doc
        .font('Heading')
        .fontSize(7.5)
        .fillColor(GREY)
        .text(c.label.toLocaleUpperCase('hu'), x, y, {
          width: cellWidth(row, c),
          characterSpacing: 0.8,
        });
      doc
        .font('Body')
        .fontSize(BODY_SIZE)
        .fillColor(c.link ? '#096396' : INK)
        .text(c.value, x, y + labelHeight, {
          width: cellWidth(row, c),
          ...(c.link ? { link: c.link } : {}),
        });
    });
    y += rowHeights[r] + rowGap;
  });
  doc.y = top + height;
  doc.x = MARGIN;
}

// The picked album photo, whole (not cropped - nobody loses their head),
// as wide as the page allows up to PHOTO_MAX_HEIGHT, centered, with round
// corners.
function drawPhoto(doc, photo) {
  if (!photo) return;
  const top = doc.y;
  try {
    const image = doc.openImage(photo);
    const maxWidth = doc.page.width - MARGIN * 2;
    const scale = Math.min(maxWidth / image.width, PHOTO_MAX_HEIGHT / image.height);
    const width = image.width * scale;
    const height = image.height * scale;
    const x = MARGIN + (maxWidth - width) / 2;
    doc.save();
    doc.roundedRect(x, top, width, height, 10).clip();
    doc.image(image, x, top, { width, height });
    doc.restore();
    doc.x = MARGIN;
    doc.y = top + height + 16;
  } catch {
    // Not a picture pdfkit can read - the beszámoló goes without it.
    doc.y = top;
  }
}

// The end: the seal pressed on slightly askew, and beside it the club,
// the elnök, and the day it was signed off (Kész).
async function drawSignature(doc, presidentName, signedAt) {
  const seal = await waxSealPng(presidentName);
  doc.moveDown(1.5);
  ensureRoom(doc, SEAL_SIZE + 10);
  const top = doc.y;
  const right = doc.page.width - MARGIN;

  const lines = [
    { text: CLUB_NAME, font: 'Heading', size: 11, color: INK },
    presidentName && { label: 'Elnök: ', text: presidentName, size: 11, color: INK },
    { label: 'Kelt: ', text: huDate(signedAt), size: 9.5, color: GREY },
  ].filter(Boolean);
  const widthOf = (l) => {
    let w = doc
      .font(l.font ?? 'Body')
      .fontSize(l.size)
      .widthOfString(l.text);
    if (l.label) w += doc.font('Heading').fontSize(l.size).widthOfString(l.label);
    return w;
  };
  const textWidth = Math.max(...lines.map(widthOf));
  const lineStep = 17;
  let y = top + (SEAL_SIZE - lines.length * lineStep) / 2;
  for (const l of lines) {
    let x = right - widthOf(l);
    if (l.label) {
      doc
        .font('Heading')
        .fontSize(l.size)
        .fillColor(l.color)
        .text(l.label, x, y, { lineBreak: false });
      x += doc.widthOfString(l.label);
    }
    doc
      .font(l.font ?? 'Body')
      .fontSize(l.size)
      .fillColor(l.color)
      .text(l.text, x, y, { lineBreak: false });
    y += lineStep;
  }

  const sealX = right - textWidth - SEAL_SIZE - 6;
  doc.save();
  doc.rotate(-9, { origin: [sealX + SEAL_SIZE / 2, top + SEAL_SIZE / 2] });
  doc.image(seal, sealX, top, { width: SEAL_SIZE, height: SEAL_SIZE });
  doc.restore();
  doc.x = MARGIN;
  doc.y = top + SEAL_SIZE;
}

// Every page: the logo and the tour at the top, the club and the page
// number at the bottom - and across a preview, PISZKOZAT.
function drawPageFrames(doc, tour, draft) {
  const range = doc.bufferedPageRange();
  const width = doc.page.width;
  const height = doc.page.height;
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const bottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;

    if (fs.existsSync(LOGO_PATH)) doc.image(LOGO_PATH, MARGIN, 28, { height: 24 });
    doc
      .font('Body')
      .fontSize(9)
      .fillColor(GREY)
      .text(`${tourHeading(tour)} · ${tour.title} · beszámoló`, MARGIN, 36, {
        width: width - MARGIN * 2,
        align: 'right',
        lineBreak: false,
      });
    doc
      .moveTo(MARGIN, 60)
      .lineTo(width - MARGIN, 60)
      .lineWidth(0.6)
      .strokeColor(LINE)
      .stroke();

    const footerY = height - 45;
    doc
      .moveTo(MARGIN, footerY - 8)
      .lineTo(width - MARGIN, footerY - 8)
      .lineWidth(0.6)
      .strokeColor(LINE)
      .stroke();
    doc
      .font('Body')
      .fontSize(8)
      .fillColor(GREY)
      .text(CLUB_NAME, MARGIN, footerY, {
        width: (width - MARGIN * 2) * 0.75,
        lineBreak: false,
      });
    doc.text(`${i - range.start + 1} / ${range.count}`, MARGIN, footerY, {
      width: width - MARGIN * 2,
      align: 'right',
      lineBreak: false,
    });

    if (draft) {
      doc.save();
      doc.rotate(-35, { origin: [width / 2, height / 2] });
      doc
        .font('Heading')
        .fontSize(90)
        .fillColor('#e53935')
        .fillOpacity(0.08)
        .text('PISZKOZAT', 0, height / 2 - 50, { width, align: 'center', lineBreak: false });
      doc.restore();
    }
    doc.page.margins.bottom = bottom;
  }
}

// The whole beszámoló onto a pdfkit document (A4, MARGINS, bufferPages),
// and ends it. Exported for trying the layout from a script.
export async function renderReport(
  doc,
  { tour, facts, days, dayLabels = [], photo, mapUrl, presidentName, signedAt, draft },
) {
  doc.registerFont('Body', FONT_REGULAR);
  doc.registerFont('Heading', FONT_BOLD);
  doc.registerFont('Italic', FONT_ITALIC);
  const contentWidth = doc.page.width - MARGIN * 2;

  doc
    .font('Heading')
    .fontSize(22)
    .fillColor(GREEN)
    .text(tourHeading(tour), MARGIN, doc.y, { width: contentWidth, align: 'center' });
  doc
    .font('Italic')
    .fontSize(13)
    .fillColor(INK)
    .text('beszámoló', { width: contentWidth, align: 'center' });
  doc
    .font('Body')
    .fontSize(10)
    .fillColor(GREY)
    .text(tour.title, { width: contentWidth, align: 'center' });
  doc.moveDown(1.2);

  drawPhoto(doc, photo);
  drawFacts(doc, facts, mapUrl);

  doc.moveDown(1.2);
  doc.font('Heading').fontSize(13).fillColor(GREEN).text('Tevékenységek', MARGIN, doc.y);
  days.forEach((delta, i) => {
    if (hasText(delta)) drawDay(doc, i, dayLabels[i], delta);
  });

  await drawSignature(doc, presidentName, signedAt ?? new Date());
  drawPageFrames(doc, tour, draft);
  doc.end();
}

// The album photo picked for the beszámoló (its file under PHOTOS_ROOT/
// the tour's folder), made small enough to keep the PDF light - null if
// none is picked, or it's gone from the album or the disk.
async function reportPhoto(tour, filename) {
  if (!filename || !config.photosRoot) return null;
  const withImages = await Tour.findById(tour._id).select('+images +sourceFolder');
  if (!withImages?.sourceFolder || !withImages.images.some((i) => i.filename === filename)) {
    return null;
  }
  const baseDir = path.resolve(config.photosRoot, withImages.sourceFolder);
  const fullPath = path.resolve(baseDir, filename);
  if (!fullPath.startsWith(baseDir + path.sep)) return null;
  try {
    return await sharp(fullPath)
      .rotate()
      .resize(1500, 1500, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 82 })
      .toBuffer();
  } catch {
    return null;
  }
}

// GET /tours/:id/report/pdf - the finished beszámoló, for the tour's
// attendees and the admins. ?draft=1 (admin): the working copy as it is
// now, marked PISZKOZAT - to see it before saying Kész.
export const downloadReportPdf = async (req, res) => {
  const tour = await findTour(req.params.id);
  const report = await TourReport.findOne({ tour: tour._id });
  const admin = isAdmin(req.user);
  const draft = admin && req.query.draft === '1';

  let days;
  let facts;
  let photoName;
  let signedAt;
  if (draft) {
    days = report?.days ?? [];
    facts = report?.facts;
    photoName = report?.photo;
  } else {
    if (!report?.published?.at) {
      throw new AppError('Ehhez a táborhoz még nincs kész beszámoló.', 404);
    }
    if (!admin && !(await isAttendee(req.user._id, tour._id))) {
      throw new AppError('A beszámolót csak a tábor résztvevői tölthetik le.', 403);
    }
    days = report.published.days ?? [];
    facts = report.published.facts;
    photoName = report.published.photo;
    signedAt = report.published.at;
  }

  const [lng, lat] = tour.location?.coordinates ?? [];
  const { presidentName } = await getClubSettings();
  const photo = await reportPhoto(tour, photoName);
  const doc = new PDFDocument({ size: 'A4', margins: MARGINS, bufferPages: true });
  const filename = `${tour.order ? tour.order + '-' : ''}beszamolo-${tour.slug || 'tabor'}.pdf`;
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  doc.pipe(res);
  await renderReport(doc, {
    tour,
    facts: effectiveFacts(facts, await autoFacts(tour)),
    days,
    dayLabels: days.map((_, i) => huDayLabel(tour.startDate, i)),
    photo,
    mapUrl:
      Number.isFinite(lat) && Number.isFinite(lng)
        ? `https://www.google.com/maps?q=${lat},${lng}`
        : null,
    presidentName,
    signedAt,
    draft,
  });
};
