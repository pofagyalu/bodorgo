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
// ownerName is passed in rather than read off req directly so this
// function has no dependency on the request/response objects at all.
async function renderTourPdfDocument(doc, tour, ownerName, distanceInfo) {
  doc.registerFont('Body', FONT_REGULAR);
  doc.registerFont('Heading', FONT_BOLD);
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
      }
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

    if (doc.y > 700) doc.addPage();
    let brokeAcrossPage = false;
    const dayBlockStartY = doc.y;

    const headingText = `${day}. nap – ${label}`;
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
    doc.y = Math.max(doc.y, headingY + 16);
    doc.moveDown(0.3);

    if (events.length === 0) {
      doc
        .font('Body')
        .fontSize(10)
        .fillColor('#999')
        .text('Erre a napra még nincs program megadva.', PAGE_MARGIN + 15, doc.y, {
          width: contentWidth - 15,
        });
      doc.x = PAGE_MARGIN;
    } else {
      for (const event of events) {
        if (doc.y > 720) {
          doc.addPage();
          brokeAcrossPage = true;
        }
        const extra = event.isOptional && event.extraCost != null ? ` (+${event.extraCost} Ft)` : '';
        doc
          .font('Body')
          .fontSize(10)
          .fillColor('#000')
          .text(`${event.time} – ${event.description}${extra}`, PAGE_MARGIN + 15, doc.y, {
            width: contentWidth - 15,
          });
        doc.x = PAGE_MARGIN;
      }
    }

    // A rounded-rectangle outline around the whole day, drawn last (after
    // its text) so the stroke-only box never covers anything - skipped if
    // the day's events ran onto a second page, since a box can't sensibly
    // span two separate pages.
    if (!brokeAcrossPage) {
      const boxPadding = 8;
      // doc.y sits right at the last line's own bottom edge (no descender
      // room), so the box needs padding added on both top AND bottom to
      // clear the content, not just once - a single boxPadding only
      // pushed the top edge up, leaving the last event flush against the
      // bottom border.
      const bottomPadding = 6;
      doc
        .roundedRect(
          PAGE_MARGIN - boxPadding,
          dayBlockStartY - boxPadding,
          contentWidth + boxPadding * 2,
          doc.y - dayBlockStartY + boxPadding + bottomPadding,
          6,
        )
        .stroke('#ddd');
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
    doc.y = footerY;
    doc
      .font('Body')
      .fontSize(8)
      .fillColor('#999')
      .text(`Letöltve: ${formatHu(new Date(), LONG_DATE)}`, PAGE_MARGIN, footerY, {
        width: contentWidth / 2,
        lineBreak: false,
      });
    doc.y = footerY;
    doc
      .font('Body')
      .fontSize(8)
      .fillColor('#999')
      .text(`Ez a dokumentum a ${ownerName} tulajdona.`, PAGE_MARGIN + contentWidth / 2, footerY, {
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

  await renderTourPdfDocument(doc, tour, req.user.name, distanceInfo);
};

// Builds the same PDF as downloadTourPdf, but collects it into a Buffer
// instead of streaming it to an HTTP response - PDFKit's bufferPages
// mechanism already defers the actual byte-writing until doc.end() calls
// flush internally, so attaching these 'data'/'end' listeners beforehand
// is enough to capture every page regardless.
function renderTourPdfToBuffer(tour, ownerName, distanceInfo) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: PAGE_MARGIN, size: 'A4', bufferPages: true });
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    renderTourPdfDocument(doc, tour, ownerName, distanceInfo).catch(reject);
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
  const pdfBuffer = await renderTourPdfToBuffer(tour, req.user.name, distanceInfo);
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
    select: 'name email lastLoginAt wantsEmailNotifications location address',
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
    const pdfBuffer = await renderTourPdfToBuffer(tour, user.name, distanceInfo);
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
