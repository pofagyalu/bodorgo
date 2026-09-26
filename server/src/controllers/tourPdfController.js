import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import PDFDocument from 'pdfkit';
import Tour from '../models/tourModel.js';
import Reservation from '../models/reservationModel.js';
import AppError from '../utils/appError.js';
import sendResendEmail from '../utils/resendEmail.js';
import { formatDrivingDuration, resolveDistanceInfo } from '../utils/distance.js';
import logger from '../logger.js';
import { loadTourCoverBuffer } from './tourCoverController.js';

// Same root-resolution as app.js's express.static(path.join(rootDir, 'public'))
// - the cover image lives under there; the logo/fonts live under
// server/assets instead (see sync.js) since they're code-adjacent assets,
// not user-managed media.
const rootDir = path.resolve();

// The real Bódorgó wordmark (the same file client/header.html uses) -
// pre-converted from its source SVG to a PNG once (pdfkit can't embed SVG
// directly), not the crown-only icon PNGs under public/img/, which turned
// out to be inherited, unbranded placeholders from this codebase's
// Natours-tutorial origins.
const LOGO_PATH = path.join(rootDir, 'assets', 'img', 'logo.png');

// Real app icons (provided directly, 300x300) for the tap-to-navigate
// links next to the Helyszín line - not converted from anything, unlike
// the other image assets here.
const WAZE_ICON_PATH = path.join(rootDir, 'assets', 'img', 'waze.png');
const GOOGLE_MAPS_ICON_PATH = path.join(rootDir, 'assets', 'img', 'google-maps.png');

// pdfkit's built-in standard-14 fonts (Helvetica etc.) use WinAnsiEncoding,
// which is missing ő/ű (U+0151/U+0171) entirely - they'd silently render
// as garbage. Mulish is the same font the site's own body text uses
// (client/src/assets/fonts/Mulish), copied into server/assets/fonts (see
// sync.js) purely so this file can embed it - full Unicode coverage, so
// Hungarian text renders correctly.
const FONT_REGULAR = path.join(rootDir, 'assets', 'fonts', 'Mulish-Regular.ttf');
const FONT_BOLD = path.join(rootDir, 'assets', 'fonts', 'Mulish-Bold.ttf');
const FONT_ITALIC = path.join(rootDir, 'assets', 'fonts', 'Mulish-Italic.ttf');

// The classic Material Icons glyph font, same one client/index.html loads
// for <mat-icon> ligatures (e.g. "location_on") - but pdfkit's text layout
// doesn't perform OpenType ligature substitution, so ligature names never
// resolve to a glyph here. Each glyph instead lives at a fixed Private Use
// Area codepoint (see ICON_CODEPOINTS below, from node_modules/
// material-icons/css/_codepoints.scss) that renders correctly regardless.
// The npm package only ships WOFF/WOFF2 (pdfkit/fontkit needs TTF/OTF,
// and this particular WOFF2's CFF outlines hit a pdfkit embedding bug
// besides) - server/assets/fonts/material-icons.ttf is a one-time decode
// of material-icons.woff2 to raw TTF (via the wawoff2 package, not a
// runtime dependency - only needed for that one conversion).
const FONT_ICONS = path.join(rootDir, 'assets', 'fonts', 'material-icons.ttf');
const ICON_CODEPOINTS = {
  location_on: 0xe0c8,
  home: 0xe88a,
  directions_car: 0xe531,
  event: 0xe878,
};

// Same 7 colors as src/styles.scss's :root logo-* custom properties -
// duplicated here since this is a completely different runtime (no CSS),
// same "small values copied per-context" pattern the client itself uses
// (see client/src/app/shared/logo-colors.ts).
const COLORS = {
  darkGreen: '#1b6548',
  green: '#72b45d',
  orange: '#f07827',
  brown: '#835638',
  red: '#f40e0d',
  blue: '#096396',
  yellow: '#f6b528',
};

// Marks the viewer's own name and room in the Szobabeosztás.
const HIGHLIGHT = COLORS.orange;

function formatHu(date, options) {
  return new Intl.DateTimeFormat('hu-HU', options).format(date);
}

// Mirrors pdfkit's own `fit` image option (scale down to fit inside a
// box, preserving aspect ratio) but returns the actual resulting
// dimensions instead of just drawing - needed to know how much vertical
// space an image really occupies (a landscape photo fit into a
// width-constrained box is usually much shorter than the box's max
// height), rather than assuming it always fills the full box.
function fitDims(origWidth, origHeight, boxWidth, boxHeight) {
  const scale = Math.min(boxWidth / origWidth, boxHeight / origHeight);
  return { width: origWidth * scale, height: origHeight * scale };
}

const LONG_DATE = { year: 'numeric', month: 'long', day: 'numeric' };
const LONG_DATE_WEEKDAY = { weekday: 'long', ...LONG_DATE };

const PAGE_MARGIN = 50;

// Same condition set as tour-details.ts's WEATHER_ICONS map, pre-converted
// to PNG (client/src/assets/images/weather/*.svg, pdfkit can't embed SVG
// directly) into server/assets/img/weather so the day heading can show
// which icon a day's °day/°night figures actually belong to, same as the
// page's own day-heading weather chip.
const WEATHER_ICON_DIR = path.join(rootDir, 'assets', 'img', 'weather');
function weatherIconPath(condition) {
  return path.join(WEATHER_ICON_DIR, `${condition}.png`);
}

// One colored icon + label:value line, e.g. "📍 Helyszín: X" - the same
// icon/color pairing as the tour-details page's own info-line icons.
function infoLine(doc, x, width, color, iconName, text) {
  const startY = doc.y;
  doc
    .font('Icons')
    .fontSize(14)
    .fillColor(color)
    .text(String.fromCodePoint(ICON_CODEPOINTS[iconName]), x, startY - 2);
  doc
    .font('Body')
    .fontSize(11)
    .fillColor('#000')
    .text(text, x + 18, startY, { width: width - 18 });
}

// Lays out the houses and their rooms: rooms as pale boxes in `columns`
// masonry columns (each goes under the shortest column), people inside a
// room in two columns of their own. Everything is sized by `scale`.
// With draw = false nothing is drawn and no page is added - it just
// returns the total height, so the caller can pick a scale that fits.
function layoutRoomAllocation(doc, tour, namesByRoom, contentWidth, startY, pageBottom, { columns, scale }, draw) {
  const s = (n) => n * scale;
  const GAP = s(10);
  const PAD = s(7);
  const NAME_GAP = s(8); // between the two name columns
  const INDENT = s(6);
  // Each house is a box of its own, its rooms inside it.
  const HOUSE_PAD = s(8);
  const HOUSE_GAP = s(12);
  const roomsX = PAGE_MARGIN + HOUSE_PAD;
  const roomsWidth = contentWidth - HOUSE_PAD * 2;
  const boxWidth = (roomsWidth - GAP * (columns - 1)) / columns;
  const inner = boxWidth - PAD * 2;
  const COUNT_WIDTH = s(40); // the "3/4 fő" at the right of the room name
  const nameColWidth = (inner - INDENT - NAME_GAP) / 2;
  const topY = doc.page.margins.top;
  let y = startY;

  const heightOf = (font, size, text, width) => doc.font(font).fontSize(size).heightOfString(text, { width });

  // The viewer's own name stands out: bold, in the highlight color.
  const nameFont = (n) => (n.me ? 'Heading' : 'Body');

  // Names down the left column first, then the right - still alphabetical
  // when read top to bottom. A single name keeps the whole width.
  const nameRows = (names) => {
    if (names.length < 2) return names.map((n) => [n]);
    const half = Math.ceil(names.length / 2);
    return names.slice(0, half).map((n, i) => [n, names[half + i]].filter(Boolean));
  };
  const roomHeight = (room) => {
    const names = namesByRoom.get(String(room._id)) ?? [];
    let h = PAD * 2 + heightOf('Heading', s(10.5), room.name, inner - COUNT_WIDTH);
    if (room.description) h += heightOf('Italic', s(8.5), room.description, inner);
    h += s(3);
    if (!names.length) return h + heightOf('Body', s(9.5), '(üres)', inner);
    for (const row of nameRows(names)) {
      const w = row.length === 1 && names.length === 1 ? inner - INDENT : nameColWidth;
      h += Math.max(...row.map((n) => heightOf(nameFont(n), s(9.5), n.name, w)));
    }
    return h;
  };
  const drawRoom = (room, x, top, height) => {
    const names = namesByRoom.get(String(room._id)) ?? [];
    // White on the house's green, so the rooms read as inside it. The
    // viewer's own room gets a thicker outline in the highlight color.
    const mine = names.some((n) => n.me);
    doc
      .lineWidth(mine ? 1.8 : 1)
      .roundedRect(x, top, boxWidth, height, s(6))
      .fillAndStroke('#ffffff', mine ? HIGHLIGHT : '#d3e0d7');
    doc.lineWidth(1);
    doc
      .font('Body')
      .fontSize(s(8.5))
      .fillColor('#666')
      .text(`${names.length}/${room.beds} fő`, x + PAD, top + PAD + s(1), { width: inner, align: 'right' });
    doc.font('Heading').fontSize(s(10.5)).fillColor('#333').text(room.name, x + PAD, top + PAD, { width: inner - COUNT_WIDTH });
    let ly = top + PAD + heightOf('Heading', s(10.5), room.name, inner - COUNT_WIDTH);
    if (room.description) {
      doc.font('Italic').fontSize(s(8.5)).fillColor('#666').text(room.description, x + PAD, ly, { width: inner });
      ly += heightOf('Italic', s(8.5), room.description, inner);
    }
    ly += s(3);
    if (!names.length) {
      doc.font('Body').fontSize(s(9.5)).fillColor('#999').text('(üres)', x + PAD + INDENT, ly, { width: inner - INDENT });
      return;
    }
    for (const row of nameRows(names)) {
      const w = row.length === 1 && names.length === 1 ? inner - INDENT : nameColWidth;
      row.forEach((n, j) => {
        doc
          .font(nameFont(n))
          .fontSize(s(9.5))
          .fillColor(n.me ? HIGHLIGHT : '#000')
          .text(n.name, x + PAD + INDENT + j * (nameColWidth + NAME_GAP), ly, { width: w });
      });
      ly += Math.max(...row.map((n) => heightOf(nameFont(n), s(9.5), n.name, w)));
    }
  };

  const newPage = () => {
    doc.addPage();
    y = topY;
  };

  for (const house of tour.accommodation.houses) {
    let headH = heightOf('Heading', s(12.5), house.name, roomsWidth);
    if (house.description) headH += heightOf('Body', s(9.5), house.description, roomsWidth);
    headH += s(5);

    // Masonry: each room under whichever column is shortest so far -
    // placed up front, so the house's own box (drawn first, underneath)
    // knows its height.
    const cols = Array(columns).fill(0);
    const placed = house.rooms.map((room) => {
      const h = roomHeight(room);
      const c = cols.indexOf(Math.min(...cols));
      const spot = { room, c, top: cols[c], h };
      cols[c] += h + GAP;
      return spot;
    });
    const roomsH = placed.length ? Math.max(...cols) - GAP : 0;
    const houseH = HOUSE_PAD * 2 + headH + roomsH;

    // A house that doesn't fit the rest of the page starts on a new one,
    // unless it's too big even for a whole page - then it goes without
    // its box and its rooms just flow on.
    if (draw && y + houseH > pageBottom && houseH <= pageBottom - topY) newPage();
    const boxed = y + houseH <= pageBottom;
    if (draw) {
      if (boxed) {
        doc.roundedRect(PAGE_MARGIN, y, contentWidth, houseH, s(8)).fillAndStroke('#eaf2ed', '#c9d9ce');
      }
      // Measured before setting the description's font - heightOf switches fonts.
      const descY = y + HOUSE_PAD + heightOf('Heading', s(12.5), house.name, roomsWidth);
      doc
        .font('Heading')
        .fontSize(s(12.5))
        .fillColor('#333')
        .text(house.name, roomsX, y + HOUSE_PAD, { width: roomsWidth });
      if (house.description) {
        doc.font('Body').fontSize(s(9.5)).fillColor('#666').text(house.description, roomsX, descY, { width: roomsWidth });
      }
    }
    const roomsTop = y + HOUSE_PAD + headH;

    if (!draw || boxed) {
      if (draw) {
        for (const { room, c, top, h } of placed) drawRoom(room, roomsX + c * (boxWidth + GAP), roomsTop + top, h);
      }
      y += houseH + HOUSE_GAP;
      continue;
    }
    // Oversized house: rooms flow on, onto new pages as needed.
    const flow = Array(columns).fill(roomsTop);
    for (const { room, h } of placed) {
      let c = flow.indexOf(Math.min(...flow));
      if (flow[c] + h > pageBottom) {
        newPage();
        flow.fill(y);
        c = 0;
      }
      drawRoom(room, roomsX + c * (boxWidth + GAP), flow[c], h);
      flow[c] += h + GAP;
    }
    y = Math.max(...flow) + HOUSE_GAP;
  }
  if (draw) doc.y = y;
  return y - startY;
}

// The finalized Szobabeosztás on a page of its own: per house, its rooms
// with who sleeps where (see layoutRoomAllocation), shrunk to fit one page.
async function renderRoomAllocationPage(doc, tour, contentWidth, viewer) {
  const reservations = await Reservation.find({ tour: tour._id }).select('attendees.name attendees.room attendees.user');
  const viewerId = viewer?._id ? String(viewer._id) : null;
  // Per room id: { name, me } - `me` marks the person this copy is for.
  const namesByRoom = new Map();
  for (const a of reservations.flatMap((r) => r.attendees)) {
    const key = a.room ? String(a.room) : null;
    if (!namesByRoom.has(key)) namesByRoom.set(key, []);
    namesByRoom.get(key).push({ name: a.name, me: !!viewerId && String(a.user) === viewerId });
  }
  const collator = new Intl.Collator('hu');
  for (const names of namesByRoom.values()) names.sort((a, b) => collator.compare(a.name, b.name));

  doc.addPage();
  doc.font('Heading').fontSize(16).fillColor(COLORS.darkGreen).text('Tervezett szobabeosztás', PAGE_MARGIN, doc.y, {
    width: contentWidth,
  });
  doc.moveDown(0.3);
  doc
    .font('Italic')
    .fontSize(10)
    .fillColor('#666')
    .text(
      'Amennyire a buli után a józanságod engedi, próbálj meg a saját szobádban, a saját párod mellé ' +
        'feküdni. Ha reggel mégis máshol ébredsz, az nem a szobabeosztás hibája.',
      PAGE_MARGIN,
      doc.y,
      { width: contentWidth },
    );
  doc.y += 12;

  const pageBottom = doc.page.height - PAGE_MARGIN - 40; // clear of the footer
  const startY = doc.y;
  const layout = (option, draw) => layoutRoomAllocation(doc, tour, namesByRoom, contentWidth, startY, pageBottom, option, draw);
  // Measured first (nothing drawn): the roomiest layout that fits the
  // whole Szobabeosztás on this one page - two rooms side by side, then
  // three, then shrinking. Only a really big accommodation still runs
  // onto a next page at the smallest size.
  const options = [
    { columns: 2, scale: 1 },
    { columns: 3, scale: 1 },
    { columns: 3, scale: 0.92 },
    { columns: 3, scale: 0.85 },
    { columns: 3, scale: 0.8 },
  ];
  const chosen = options.find((o) => startY + layout(o, false) + 20 <= pageBottom) ?? options.at(-1);
  layout(chosen, true);
  doc.x = PAGE_MARGIN;

  // Anyone registered but left out of every room (or in a since-deleted one).
  const validRooms = new Set(tour.accommodation.houses.flatMap((h) => h.rooms.map((r) => String(r._id))));
  const unplaced = [...namesByRoom.entries()]
    .filter(([roomId]) => !roomId || !validRooms.has(roomId))
    .flatMap(([, names]) => names.map((n) => n.name))
    .sort(collator.compare);
  if (unplaced.length) {
    if (doc.y > pageBottom - 40) doc.addPage();
    doc
      .font('Heading')
      .fontSize(11)
      .fillColor(COLORS.orange)
      .text('Még nincs szobája: ', PAGE_MARGIN, doc.y, { width: contentWidth, continued: true })
      .font('Body')
      .fillColor('#000')
      .text(unplaced.join(', '));
  }
}

// Footer "Ez a dokumentum … tulajdona." - the username, falling back to
// the full name for someone who hasn't set one.
function ownerLabel(user) {
  return user.username || user.name;
}

async function findTourByIdParam(idParam) {
  const query = mongoose.isValidObjectId(idParam) ? { _id: idParam } : { slug: idParam };
  const tour = await Tour.findOne(query);
  if (!tour) {
    throw new AppError('No tour found with that ID!', 404);
  }
  return tour;
}

// Draws the entire Programfüzet onto an already-configured PDFDocument and
// ends it - shared by the direct-download route and the email-attachment
// route below, which differ only in what happens to the resulting bytes
// (piped straight to the HTTP response vs. collected into a Buffer).
// The viewer (whose copy this is - named in the footer, highlighted in the
// Szobabeosztás) is passed in rather than read off req directly so this
// function has no dependency on the request/response objects at all.
async function renderTourPdfDocument(doc, tour, viewer, distanceInfo) {
  const ownerName = ownerLabel(viewer);
  doc.registerFont('Body', FONT_REGULAR);
  doc.registerFont('Heading', FONT_BOLD);
  doc.registerFont('Italic', FONT_ITALIC);

  // Room at the bottom of the first page for the navigation footnote
  // (drawn with the footer at the end) - content breaks to page 2 above it.
  const hasNavLinks = tour.location?.coordinates?.length === 2;
  if (hasNavLinks) doc.page.margins.bottom = PAGE_MARGIN + 45;
  doc.registerFont('Icons', FONT_ICONS);
  doc.font('Body');

  const contentWidth = doc.page.width - PAGE_MARGIN * 2;

  // Logo top-left (half the size of the first version of this layout),
  // continued with "- Programfüzet" so it reads as a masthead/title
  // rather than a bare brand mark.
  if (fs.existsSync(LOGO_PATH)) {
    // pdfkit reads PNG/JPEG dimensions itself (openImage) - no need for
    // sharp just to measure a file we already know is a plain PNG. Kept
    // separate from the cover-image conversion below, which genuinely
    // needs sharp (source is .webp, which pdfkit can't decode at all).
    const logoImage = doc.openImage(LOGO_PATH);
    const logo = fitDims(logoImage.width, logoImage.height, 140, 30);
    const logoTop = doc.y;
    doc.image(LOGO_PATH, PAGE_MARGIN, logoTop, logo);
    doc
      .font('Heading')
      .fontSize(16)
      .fillColor(COLORS.darkGreen)
      .text('- Programfüzet', PAGE_MARGIN + logo.width + 10, logoTop + logo.height / 2 - 8);
    doc.y = logoTop + logo.height + 15;
    doc.x = PAGE_MARGIN;
  }

  // Two-column hero row: cover image left (roughly half width, capped in
  // height so a tall photo can't push the info column down awkwardly),
  // title + info lines right - same arrangement as tour-details.html's
  // .hero-row, just without the review widget.
  const imageColWidth = contentWidth * 0.45;
  const infoColX = PAGE_MARGIN + imageColWidth + 20;
  const infoColWidth = contentWidth - imageColWidth - 20;
  const heroTop = doc.y;

  // The cover's JPEG bytes straight from the database (see
  // tourCoverModel.js) - pdfkit reads JPEG (and its real dimensions)
  // itself, no image library needed.
  const coverBuffer = tour.coverUpdatedAt ? await loadTourCoverBuffer(tour._id) : null;
  // Actual rendered height of the cover image, once known below - a
  // landscape photo fit into imageColWidth is usually much shorter than
  // the 220pt cap, so the space reserved for it (and where content
  // resumes below the hero row) has to reflect that real height, not
  // just assume the cap - otherwise a short image leaves a large blank
  // gap before the description starts.
  let coverHeight = 0;
  if (coverBuffer) {
    try {
      const coverImage = doc.openImage(coverBuffer);
      const cover = fitDims(coverImage.width, coverImage.height, imageColWidth, 220);
      coverHeight = cover.height;
      doc.image(coverBuffer, PAGE_MARGIN, heroTop, cover);
    } catch (err) {
      logger.warn(`Tour PDF: cover image skipped: ${err.message}`);
    }
  }

  doc.y = heroTop;
  doc.x = infoColX;
  doc.font('Heading').fontSize(20).fillColor(COLORS.darkGreen).text(tour.title, infoColX, heroTop, {
    width: infoColWidth,
  });
  doc
    .font('Body')
    .fontSize(10)
    .fillColor('#666')
    .text(`${tour.order === 1 ? 'Első' : `${tour.order}.`} bódorgó tábor`, infoColX, doc.y, {
      width: infoColWidth,
    });
  doc.y += 10;

  // The Helyszín row, with short tap-to-navigate links appended right
  // after the place name on the same line (not the generic infoLine()
  // helper, since this one line needs that extra inline content) - each
  // app's own deep link handles the handoff itself (opens the installed
  // app with a confirmation prompt on mobile, falls back to its own web
  // app on desktop), so there's nothing platform-specific to detect here.
  {
    const startY = doc.y;
    doc
      .font('Icons')
      .fontSize(14)
      .fillColor(COLORS.darkGreen)
      .text(String.fromCodePoint(ICON_CODEPOINTS.location_on), infoColX, startY - 2);
    const placeText = `Helyszín: ${tour.location?.description || '-'}`;
    doc.font('Body').fontSize(11).fillColor('#000');
    const placeWidth = doc.widthOfString(placeText);
    doc.text(placeText, infoColX + 18, startY, { lineBreak: false });

    if (tour.location?.coordinates?.length === 2) {
      const [lng, lat] = tour.location.coordinates;
      const wazeUrl = `https://waze.com/ul?ll=${lat},${lng}&navigate=yes`;
      const googleUrl = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;

      // Real app icons, each with a click-through link annotation over
      // it - pdfkit's .image() has no `link` option of its own, unlike
      // .text(), so the clickable area is added separately via .link().
      const iconSize = 16;
      let navX = infoColX + 18 + placeWidth + 10;
      const iconY = startY - 1;
      if (fs.existsSync(WAZE_ICON_PATH)) {
        doc.image(WAZE_ICON_PATH, navX, iconY, { width: iconSize, height: iconSize });
        doc.link(navX, iconY, iconSize, iconSize, wazeUrl);
        navX += iconSize + 6;
      }
      if (fs.existsSync(GOOGLE_MAPS_ICON_PATH)) {
        doc.image(GOOGLE_MAPS_ICON_PATH, navX, iconY, { width: iconSize, height: iconSize });
        doc.link(navX, iconY, iconSize, iconSize, googleUrl);
        navX += iconSize + 2;
      }
      // Points to the footnote at the bottom of this page.
      doc.font('Body').fontSize(11).fillColor('#666').text('*', navX, startY - 2, { lineBreak: false });
    }

    doc.x = infoColX;
    doc.y = startY + 16;
  }
  infoLine(doc, infoColX, infoColWidth, COLORS.orange, 'home', `Cím: ${tour.location?.address || 'nincs megadva'}`);
  doc.y += 6;
  infoLine(
    doc,
    infoColX,
    infoColWidth,
    COLORS.blue,
    'directions_car',
    distanceInfo.distanceKm != null
      ? `Táv ${distanceInfo.fromLabel}: ${distanceInfo.distanceKm} km${
          distanceInfo.durationMinutes != null ? ` (${formatDrivingDuration(distanceInfo.durationMinutes)})` : ''
        }`
      : `Táv ${distanceInfo.fromLabel}: nincs kiszámítva`,
  );
  doc.y += 6;
  infoLine(
    doc,
    infoColX,
    infoColWidth,
    COLORS.brown,
    'event',
    `Időpont: ${formatHu(tour.startDate, LONG_DATE)} · ${tour.duration} nap / ${tour.duration - 1} éjszaka`,
  );

  // Whichever column ended up taller (image or the text beside it)
  // decides where full-width content resumes.
  doc.y = Math.max(doc.y + 20, heroTop + coverHeight + 20);
  doc.x = PAGE_MARGIN;

  // Long description - full width, below both columns.
  doc.font('Body').fontSize(11).fillColor('#000').text(tour.description, PAGE_MARGIN, doc.y, {
    width: contentWidth,
    align: 'justify',
  });
  doc.x = PAGE_MARGIN;
  doc.moveDown();

  // Programterv - same day-by-day grouping (and per-day weather, with its
  // condition icon) as tour-details.ts's dayGroups, reimplemented here
  // since the PDF is generated server-side with no access to that
  // client-side computed signal.
  doc.font('Heading').fontSize(16).fillColor(COLORS.darkGreen).text('Programterv', PAGE_MARGIN, doc.y, {
    width: contentWidth,
  });
  doc.x = PAGE_MARGIN;
  doc.moveDown(0.5);

  const start = new Date(tour.startDate);
  for (let day = 1; day <= tour.duration; day++) {
    const date = new Date(start);
    date.setDate(date.getDate() + (day - 1));
    const label = formatHu(date, LONG_DATE_WEEKDAY);
    const weather = (tour.dailyWeather || []).find((w) => w.day === day);

    const events = (tour.schedule || [])
      .filter((e) => e.day === day)
      .slice()
      .sort((a, b) => a.time.localeCompare(b.time));

    const headingText = `${day}. nap – ${label}`;
    const extraOf = (e) => (e.isOptional && e.extraCost != null ? ` (+${e.extraCost} Ft)` : '');
    const lines = events.length
      ? events.map((e) => ({ text: `${e.time} – ${e.description}${extraOf(e)}`, color: '#000' }))
      : [{ text: 'Erre a napra még nincs program megadva.', color: '#999' }];

    // Measured up front, so the day's pale background box can be drawn
    // BEFORE its text - pdfkit has no z-order, anything drawn later
    // covers what's already there.
    const headingHeight = Math.max(
      doc.font('Heading').fontSize(13).heightOfString(headingText, { width: contentWidth }),
      16,
    );
    const HEADING_GAP = 4;
    doc.font('Body').fontSize(10);
    const linesHeight = lines.reduce((sum, l) => sum + doc.heightOfString(l.text, { width: contentWidth - 15 }), 0);
    const blockHeight = headingHeight + HEADING_GAP + linesHeight;

    const boxPadding = 8;
    // doc.y sits right at the last line's own bottom edge (no descender
    // room), so the bottom needs its own padding too.
    const bottomPadding = 6;
    // Clear of the footer (and page 1's footnote, via its larger margin).
    const pageBottom = Math.min(doc.page.height - PAGE_MARGIN - 40, doc.page.maxY() - 10);
    // A day that doesn't fit the rest of this page starts on the next one
    // rather than splitting - unless it wouldn't fit a whole page either.
    const fitsOnePage = blockHeight + boxPadding + bottomPadding <= pageBottom - doc.page.margins.top;
    if (doc.y + blockHeight + bottomPadding > pageBottom && (fitsOnePage || doc.y > 700)) {
      doc.addPage();
    }
    const boxed = doc.y + blockHeight + bottomPadding <= pageBottom;
    if (boxed) {
      doc
        .roundedRect(
          PAGE_MARGIN - boxPadding,
          doc.y - boxPadding,
          contentWidth + boxPadding * 2,
          blockHeight + boxPadding + bottomPadding,
          6,
        )
        .fillAndStroke('#f4f8f5', '#dde6e0');
    }

    const headingY = doc.y;
    doc.font('Heading').fontSize(13).fillColor('#333');
    const headingWidth = doc.widthOfString(headingText);
    doc.text(headingText, PAGE_MARGIN, headingY, { width: contentWidth });
    doc.x = PAGE_MARGIN;

    // Bare icon (no background chip) right before the temperatures, same
    // as the tour-details page's own day-heading weather icon - without
    // it, "22°/7°" on its own doesn't read as weather at a glance.
    if (weather) {
      const iconSize = 14;
      const iconX = PAGE_MARGIN + headingWidth + 8;
      const iconPath = weatherIconPath(weather.condition);
      if (fs.existsSync(iconPath)) {
        doc.image(iconPath, iconX, headingY + 1, { width: iconSize, height: iconSize });
      }
      doc
        .font('Body')
        .fontSize(11)
        .fillColor('#333')
        .text(`${weather.tempDayC}°/${weather.tempNightC}°`, iconX + iconSize + 4, headingY + 2, {
          lineBreak: false,
        });
      doc.x = PAGE_MARGIN;
    }
    doc.y = headingY + headingHeight + HEADING_GAP;

    for (const line of lines) {
      // Only an oversized (unboxed) day ever runs onto a new page.
      if (!boxed && doc.y > 720) doc.addPage();
      doc
        .font('Body')
        .fontSize(10)
        .fillColor(line.color)
        .text(line.text, PAGE_MARGIN + 15, doc.y, { width: contentWidth - 15 });
      doc.x = PAGE_MARGIN;
    }
    // A fixed gap rather than moveDown (which scales with whatever font
    // size was last set, an easy way to under-shoot) - has to clear the
    // box's own top+bottom padding (8 + 6) plus a few pixels of real
    // visual gap, or the next day's box overlaps this one's bottom edge.
    doc.y += 20;
  }

  // Extra infók - only when the tour actually has at least one uploaded
  // document, and only ever the titles, never the files themselves or a
  // way to reach them - the PDF can end up printed or shared beyond a
  // logged-in visitor, unlike the tour-details page's own "Extra infók"
  // cards, which link straight to each file.
  if (tour.extraDocuments?.length > 0) {
    if (doc.y > 700) doc.addPage();
    doc.font('Heading').fontSize(16).fillColor(COLORS.darkGreen).text('Extrák', PAGE_MARGIN, doc.y, {
      width: contentWidth,
    });
    doc.x = PAGE_MARGIN;
    doc.moveDown(0.5);
    doc
      .font('Body')
      .fontSize(10)
      .fillColor('#666')
      .text('A táborhoz tartoznak kiegészítő file-ok is, de ahhoz be kell lépned:', PAGE_MARGIN, doc.y, {
        width: contentWidth,
      });
    doc.x = PAGE_MARGIN;
    doc.moveDown(0.4);
    for (const document of tour.extraDocuments) {
      if (doc.y > 720) doc.addPage();
      doc
        .font('Body')
        .fontSize(10)
        .fillColor('#000')
        .text(`• ${document.title}`, PAGE_MARGIN + 10, doc.y, { width: contentWidth - 10 });
      doc.x = PAGE_MARGIN;
    }
    doc.moveDown(1);
  }

  // Szobabeosztás - its own page, only once the admin has finalized it
  // (Véglegesítés); before that it's still changing and not worth printing.
  if (tour.accommodation?.finalized && tour.accommodation.houses?.length) {
    await renderRoomAllocationPage(doc, tour, contentWidth, viewer);
  }

  // Footer on every page: download date bottom-left, ownership
  // attribution bottom-right - added last (after all real content, once
  // the final page count is known) via bufferPages, not interleaved with
  // the content loop above.
  const footerY = doc.page.height - PAGE_MARGIN - 10;
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    // pdfkit's auto-page-break check is "does doc.y + this line's full
    // height exceed page.maxY() (= page.height - margins.bottom)" - even
    // a small 8pt line's height can push past that with only 10pt of
    // clearance, silently inserting a whole blank page instead of
    // drawing the footer. Temporarily zeroing the bottom margin (only
    // this page object, restored after) gives the line room regardless
    // of its exact height, without needing to guess at font metrics.
    const realBottomMargin = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;

    // Thin rule above the footer, margin to margin.
    doc
      .moveTo(PAGE_MARGIN, footerY - 7)
      .lineTo(PAGE_MARGIN + contentWidth, footerY - 7)
      .lineWidth(0.5)
      .stroke('#ccc');

    // First page only: the footnote for the "*" after the navigation icons.
    if (i === range.start && hasNavLinks) {
      const note =
        '* Ha már beültél az autóba, és fogalmad sincs, merre tovább: bökj rá valamelyik navigációs ikonra, ' +
        'dőlj hátra, és kapcsolj önvezető üzemmódba (ha az autód nem tud ilyet, legalább a navigációt kövesd). ' +
        'Mi a célban várunk!';
      doc.font('Italic').fontSize(8).fillColor('#666');
      const noteHeight = doc.heightOfString(note, { width: contentWidth });
      doc.text(note, PAGE_MARGIN, footerY - 14 - noteHeight, { width: contentWidth });
    }

    doc.y = footerY;
    doc
      .font('Body')
      .fontSize(8)
      .fillColor('#999')
      .text(`Letöltve: ${formatHu(new Date(), LONG_DATE)} · ${i - range.start + 1}/${range.count}. oldal`, PAGE_MARGIN, footerY, {
        width: contentWidth / 2,
        lineBreak: false,
      });
    doc.y = footerY;
    doc
      .font('Body')
      .fontSize(8)
      .fillColor('#999')
      .text(`Ez a dokumentum ${ownerName} tulajdona.`, PAGE_MARGIN + contentWidth / 2, footerY, {
        width: contentWidth / 2,
        align: 'right',
        lineBreak: false,
      });

    // Centered, clickable link back to the site - the blue fill alone
    // signals it's a link, no underline.
    doc.font('Body').fontSize(8);
    const siteLabel = 'bodorgo.hu';
    const siteLabelWidth = doc.widthOfString(siteLabel);
    doc
      .fillColor(COLORS.blue)
      .text(siteLabel, PAGE_MARGIN + contentWidth / 2 - siteLabelWidth / 2, footerY, {
        link: 'https://bodorgo.hu',
        lineBreak: false,
      });

    doc.page.margins.bottom = realBottomMargin;
  }

  doc.end();
}

// Generated fresh from the current Tour document on every request - never
// cached or pre-rendered - so an edit to the tour is reflected the very
// next time someone downloads it. Deliberately leaves out the rating/
// review widget (not meaningful in a static, point-in-time document);
// everything else visible on the tour-details page's own info block is
// included: place, address, distance, date/duration, description, the
// full day-by-day schedule (with that day's weather, if known), a
// two-column layout mirroring the page's own image-left/info-right hero
// row, and a footer on every page naming who downloaded it.
export const downloadTourPdf = async (req, res) => {
  const tour = await findTourByIdParam(req.params.id);
  const distanceInfo = await resolveDistanceInfo(tour, req.user);

  // bufferPages: true lets the footer (which needs to know the final page
  // count) be added to every page in one pass at the very end, rather
  // than trying to predict page breaks up front.
  const doc = new PDFDocument({ margin: PAGE_MARGIN, size: 'A4', bufferPages: true });
  const filename = `${tour.order ? tour.order + '-' : ''}${tour.slug || 'tabor'}.pdf`;
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  doc.pipe(res);

  await renderTourPdfDocument(doc, tour, req.user, distanceInfo);
};

// Builds the same PDF as downloadTourPdf, but collects it into a Buffer
// instead of streaming it to an HTTP response - PDFKit's bufferPages
// mechanism already defers the actual byte-writing until doc.end() calls
// flush internally, so attaching these 'data'/'end' listeners beforehand
// is enough to capture every page regardless.
function renderTourPdfToBuffer(tour, viewer, distanceInfo) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: PAGE_MARGIN, size: 'A4', bufferPages: true });
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    renderTourPdfDocument(doc, tour, viewer, distanceInfo).catch(reject);
  });
}

// Shared by both the self-test send below and the admin's bulk send to
// every eligible attendee - the plain-text/basic-HTML body here is
// intentionally minimal; a proper branded template (MJML) is a separate
// follow-up. The "don't reply" line matters because this really is a
// send-only address (see terfotozas.hu's own MX - no-reply@ has no
// mailbox, so a reply would just bounce).
function programfuzetEmailBody(recipientName, tourTitle) {
  const noReplyNote = 'Erre az e-mailre kérjük, ne válaszolj - ez egy automatikusan generált üzenet.';
  return {
    subject: `Programfüzet - ${tourTitle}`,
    text: `Szia ${recipientName}!\n\nCsatolva küldjük a(z) "${tourTitle}" tábor programfüzetét.\n\nÜdvözlettel,\nBódorgó\n\n${noReplyNote}`,
    html: `<p>Szia ${recipientName}!</p><p>Csatolva küldjük a(z) "${tourTitle}" tábor programfüzetét.</p><p>Üdvözlettel,<br>Bódorgó</p><p style="color:#888;font-size:0.85em;">${noReplyNote}</p>`,
  };
}

// v1: sends the tour's own Programfüzet PDF to the logged-in requester's
// own email address (there's no recipient picker yet - this is the "click
// and see it received" test the admin asked for).
export const emailTourPdf = async (req, res) => {
  const tour = await findTourByIdParam(req.params.id);
  if (!req.user.email) {
    throw new AppError('A fiókodhoz nincs e-mail cím rendelve.', 400);
  }

  const distanceInfo = await resolveDistanceInfo(tour, req.user);
  const pdfBuffer = await renderTourPdfToBuffer(tour, req.user, distanceInfo);
  const filename = `${tour.order ? tour.order + '-' : ''}${tour.slug || 'tabor'}.pdf`;
  const { subject, text, html } = programfuzetEmailBody(req.user.name, tour.title);

  await sendResendEmail({ to: req.user.email, subject, text, html, attachments: [{ filename, content: pdfBuffer }] });

  res.status(200).json({ status: 'success', data: { sentTo: req.user.email } });
};

// Pure (no DB/network) so it's directly unit-testable - given a list of
// candidate users (already populated with the 3 fields it cares about),
// splits them into who's eligible for the bulk Programfüzet email and who
// isn't, and why. The 3 rules, in the order the admin described them:
// has an email address, has logged in at least once (lastLoginAt set - a
// login-less dependent added by hand never has this and has no way to
// read email tied to their "account" anyway), and hasn't turned off
// wantsEmailNotifications in their own profile.
export function partitionAttendeesByEmailEligibility(users) {
  const eligible = [];
  const skipped = [];
  for (const user of users) {
    if (!user.email) {
      skipped.push({ name: user.name, reason: 'nincs e-mail cím' });
    } else if (!user.lastLoginAt) {
      skipped.push({ name: user.name, reason: 'még sosem jelentkezett be' });
    } else if (user.wantsEmailNotifications === false) {
      skipped.push({ name: user.name, reason: 'kikapcsolta az e-mail értesítéseket' });
    } else {
      eligible.push(user);
    }
  }
  return { eligible, skipped };
}

// Admin-only: emails the Programfüzet to every eligible attendee of this
// tour (see partitionAttendeesByEmailEligibility above). The same person
// can show up as an attendee on more than one reservation for this tour
// (rare, but possible - see e.g. a re-booking); deduped so they only get
// one copy. Each copy is still generated (and footer-stamped) per-
// recipient, same as the self-send above, rather than one generic PDF for
// everyone.
export const emailTourPdfToAttendees = async (req, res) => {
  const tour = await findTourByIdParam(req.params.id);

  const reservations = await Reservation.find({ tour: tour._id }).populate({
    path: 'attendees.user',
    select: 'name username email lastLoginAt wantsEmailNotifications location address',
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

  const { eligible, skipped } = partitionAttendeesByEmailEligibility([...recipientsById.values()]);

  const filename = `${tour.order ? tour.order + '-' : ''}${tour.slug || 'tabor'}.pdf`;
  for (const user of eligible) {
    const distanceInfo = await resolveDistanceInfo(tour, user);
    const pdfBuffer = await renderTourPdfToBuffer(tour, user, distanceInfo);
    const { subject, text, html } = programfuzetEmailBody(user.name, tour.title);
    await sendResendEmail({ to: user.email, subject, text, html, attachments: [{ filename, content: pdfBuffer }] });
  }

  res.status(200).json({
    status: 'success',
    data: {
      sentCount: eligible.length,
      sentTo: eligible.map((u) => u.email),
      skipped,
    },
  });
};
