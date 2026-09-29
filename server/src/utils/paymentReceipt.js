import fs from 'fs';
import path from 'path';
import PDFDocument from 'pdfkit';
import slugify from 'slugify';
import { RECEIPTS_DIR as RECEIPTS_DIR_CONFIG } from './dataDirs.js';
import { huDate, huDateTime } from './huDate.js';

// Same code-adjacent asset paths tourPdfController.js already established
// (server/assets, git-tracked, auto-deployed - see sync.js) - duplicated
// here rather than imported, since tourPdfController.js doesn't export
// them and this is a genuinely separate document (a payment receipt, not
// a tour Programfüzet).
const rootDir = path.resolve();
const LOGO_PATH = path.join(rootDir, 'assets', 'img', 'logo.png');
const FONT_REGULAR = path.join(rootDir, 'assets', 'fonts', 'Mulish-Regular.ttf');
const FONT_BOLD = path.join(rootDir, 'assets', 'fonts', 'Mulish-Bold.ttf');

// See utils/dataDirs.js (overridable only by the automated tests).
const RECEIPTS_DIR = RECEIPTS_DIR_CONFIG;

const DARK_GREEN = '#1b6548';

// Hungarian even on the live server (see utils/huDate.js).
const formatHu = (date) => huDateTime(date);
const formatHuDate = (date) => huDate(date);

function formatForint(amount) {
  const digits = Math.round(amount).toString();
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

// tour-<order>-cover.<ext>-style deterministic naming, but for receipts:
// date/time first (so the folder sorts chronologically at a glance just
// browsing it), then the payer's name, then the payment's own id (full,
// not shortened - guarantees no collision and makes tracing a specific
// file back to its Payment document trivial).
export function receiptFilenameFor(payment, payerName) {
  const d = new Date(payment.createdAt ?? Date.now());
  const pad = (n) => String(n).padStart(2, '0');
  const datePart = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const timePart = `${pad(d.getHours())}${pad(d.getMinutes())}`;
  const nameSlug = slugify(payerName, { lower: true });
  return `${datePart}_${timePart}_${nameSlug}_${payment._id}.pdf`;
}

// Generates the receipt PDF for one succeeded payment and saves it to
// documents/payments/ (created on first use - unlike documents/'s other,
// git-tracked contents, this subfolder is per-environment and gitignored,
// see .gitignore's own comment). Returns just the filename, not the full
// path, matching documentController.js's own convention.
//
// Deliberately titled "Fizetési igazolás" (payment confirmation), not
// "Számla" (invoice) - a real áfás számla has legal requirements (adószám,
// sequential numbering, etc.) that don't apply to this club tracking its
// own members' advance/dues payments internally.
//
// tourTitle/tourStartDate are only meaningful for purpose:'tourAdvance' -
// pass null/undefined for a membershipFee payment, which lists
// payment.members (each with their own membershipYear) instead of
// payment.attendees and skips the tour-specific lines entirely.
export async function generateReceiptPdf(payment, payerName, tourTitle, tourStartDate) {
  fs.mkdirSync(RECEIPTS_DIR, { recursive: true });
  const filename = receiptFilenameFor(payment, payerName);
  const filePath = path.join(RECEIPTS_DIR, filename);

  const doc = new PDFDocument({ margin: 50, size: 'A4' });
  const stream = fs.createWriteStream(filePath);
  doc.pipe(stream);

  doc.registerFont('Body', FONT_REGULAR);
  doc.registerFont('Heading', FONT_BOLD);
  doc.font('Body');

  const contentWidth = doc.page.width - 100;

  if (fs.existsSync(LOGO_PATH)) {
    doc.image(LOGO_PATH, 50, 50, { fit: [110, 40] });
    doc.y = 100;
  }

  doc.font('Heading').fontSize(18).fillColor(DARK_GREEN).text('Fizetési igazolás', 50, doc.y);
  doc.moveDown(0.3);
  doc
    .font('Body')
    .fontSize(10)
    .fillColor('#666')
    .text(`Kiállítva: ${formatHu(new Date(payment.createdAt ?? Date.now()))}`);
  doc.moveDown(1);

  const isMembership = payment.purpose === 'membershipFee';
  const rows = isMembership
    ? payment.members.map((m) => ({ name: `${m.name} (${m.membershipYear})`, amount: m.amount }))
    : payment.attendees;

  doc.font('Body').fontSize(11).fillColor('#000');
  doc
    .text(`Tárgy: `, { continued: true })
    .font('Heading')
    .text(isMembership ? 'Klubtagsági díj befizetése' : 'Szállás előleg befizetése');
  doc.font('Body').text(`Befizető: `, { continued: true }).font('Heading').text(payerName);
  if (!isMembership) {
    doc.font('Body').text(`Tábor: `, { continued: true }).font('Heading').text(tourTitle);
    if (tourStartDate) {
      doc
        .font('Body')
        .text(`Tábor időpontja: `, { continued: true })
        .font('Heading')
        .text(formatHuDate(new Date(tourStartDate)));
    }
  }
  doc.moveDown(1);

  // Table: name | amount, one row per attendee/member this payment covered.
  const colNameX = 50;
  const colAmountX = 50 + contentWidth - 120;
  doc.font('Heading').fontSize(11).fillColor(DARK_GREEN);
  doc.text(isMembership ? 'Tag' : 'Résztvevő', colNameX, doc.y, {
    width: colAmountX - colNameX,
    continued: false,
  });
  doc.text('Összeg', colAmountX, doc.y - doc.currentLineHeight(), { width: 120, align: 'right' });
  doc.moveDown(0.3);
  doc
    .moveTo(colNameX, doc.y)
    .lineTo(colNameX + contentWidth, doc.y)
    .strokeColor('#ddd')
    .stroke();
  doc.moveDown(0.5);

  doc.font('Body').fontSize(11).fillColor('#000');
  for (const row of rows) {
    const rowY = doc.y;
    doc.text(row.name, colNameX, rowY, { width: colAmountX - colNameX });
    doc.text(`${formatForint(row.amount)} Ft`, colAmountX, rowY, { width: 120, align: 'right' });
    doc.moveDown(0.4);
  }

  // The gap between what each row lists and payment.amount is Barion's own
  // ~1.6% fee, passed on to the payer (see paymentController.js's
  // chargeableAmount) - shown as its own line so the total above reconciles
  // with what the rows list, rather than silently looking off by a few Ft.
  const feeAmount = payment.amount - rows.reduce((sum, r) => sum + r.amount, 0);
  if (feeAmount > 0) {
    const rowY = doc.y;
    doc.text('Barion díj (1,6%)', colNameX, rowY, { width: colAmountX - colNameX });
    doc.text(`${formatForint(feeAmount)} Ft`, colAmountX, rowY, { width: 120, align: 'right' });
    doc.moveDown(0.4);
  }

  doc.moveDown(0.3);
  doc
    .moveTo(colNameX, doc.y)
    .lineTo(colNameX + contentWidth, doc.y)
    .strokeColor('#ddd')
    .stroke();
  doc.moveDown(0.5);

  doc.font('Heading').fontSize(13).fillColor(DARK_GREEN);
  doc.text('Összesen', colNameX, doc.y, { width: colAmountX - colNameX, continued: false });
  doc.text(`${formatForint(payment.amount)} Ft`, colAmountX, doc.y - doc.currentLineHeight(), {
    width: 120,
    align: 'right',
  });

  doc.moveDown(3);
  doc
    .font('Body')
    .fontSize(9)
    .fillColor('#999')
    .text(
      isMembership
        ? 'Ez a dokumentum a Bódorgó klub által kezelt tagdíjbefizetés visszaigazolása.'
        : 'Ez a dokumentum a Bódorgó klub által kezelt előlegbefizetés visszaigazolása.',
      50,
      doc.y,
      { width: contentWidth },
    );

  doc.end();

  await new Promise((resolve, reject) => {
    stream.on('finish', resolve);
    stream.on('error', reject);
  });

  return filename;
}

export { RECEIPTS_DIR };
