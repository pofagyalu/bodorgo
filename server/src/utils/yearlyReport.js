import fs from 'fs';
import path from 'path';
import PDFDocument from 'pdfkit';
import User from '../models/userModel.js';
import Tour from '../models/tourModel.js';
import Transaction, { INCOME_CATEGORIES, EXPENSE_CATEGORIES } from '../models/transactionModel.js';
import Reservation from '../models/reservationModel.js';
import { CLUB_FOUNDING_YEAR, feeForYear, getClubSettings } from './clubSettings.js';
import { budapestParts, huDate, huDateRange } from './huDate.js';
import { waxSealPng } from './waxSeal.js';

// "Éves jelentés": the club's year on one A4 page - members and dues, the
// year's money, the year's tours - with the figures of the Klub pages and
// a joke under each. Every number is counted here from the database; the
// jokes only ever repeat or divide those numbers.

const rootDir = path.resolve();
const LOGO_PATH = path.join(rootDir, 'assets', 'img', 'logo.png');
const FONT_REGULAR = path.join(rootDir, 'assets', 'fonts', 'Mulish-Regular.ttf');
const FONT_BOLD = path.join(rootDir, 'assets', 'fonts', 'Mulish-Bold.ttf');
const FONT_ITALIC = path.join(rootDir, 'assets', 'fonts', 'Mulish-Italic.ttf');
const FONT_TITLE = path.join(rootDir, 'assets', 'fonts', 'Marhey-Bold.ttf');

const MARGIN = 40;
const GAP = 12;
const ROW = 16.5;
const TILE = 82;
const DARK_GREEN = '#1b6548';
const INK = '#22302a';
const MUTED = '#6b7671';
const CARD = '#f4f1ea';
const RULE = '#d9d4c7';
const RED = '#c22a1c';
// The logo's letters, for the four tiles.
const TILE_COLORS = ['#f47b20', '#0b6397', '#6fb35c', '#8b5a3c'];

// "12 345 Ft" - with spaces that don't break the line.
const forint = (amount) =>
  `${Math.round(Math.abs(amount))
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, '\u00a0')}\u00a0Ft`;
// "a" or "az" before a number said aloud (az 1, az 5, az 50, az 1000; a 2, a 10).
const article = (n) => {
  const digits = String(n);
  return digits[0] === '5' || (digits[0] === '1' && digits.length % 3 === 1) ? 'az' : 'a';
};
// "2027-re", "2030-ra": the year with the "onto" ending that fits how its
// last word sounds.
const ONES_RA = new Set([3, 6, 8]);
const TENS_RA = new Set([2, 3, 6, 8]);
export const yearOnto = (year) => {
  const ones = year % 10;
  const tens = Math.floor(year / 10) % 10;
  const back = ones ? ONES_RA.has(ones) : tens ? TENS_RA.has(tens) : year % 1000 !== 0;
  return `${year}-${back ? 'ra' : 're'}`;
};
const signedForint = (amount) => `${amount < 0 ? '−' : '+'}${forint(amount)}`;

// The figures of `year`, as they stand at `now` (on 1 January: the whole
// of last year).
export async function yearlyReportStats(year, now = new Date()) {
  const settings = await getClubSettings();
  const fee = feeForYear(settings.membershipFees, year);

  // Club members of the year, as the dues reminders count them (see
  // membershipReminders.js): admin or member, not suspended, joined by then.
  const members = await User.find({
    role: { $in: ['admin', 'member'] },
    retired: { $ne: true },
    $or: [{ memberSince: null }, { memberSince: { $lte: year } }],
  }).select('memberSince');
  const memberIds = new Set(members.map((m) => String(m._id)));
  const paidIds = (
    await Transaction.distinct('user', {
      type: 'income',
      category: 'Tagdíj',
      membershipYear: year,
    })
  ).map(String);

  // The year's money, as the Pénzügyek page shows it: the year is the
  // date's own (UTC) year, Nyitó is everything before it. Forint only.
  const transactions = await Transaction.find({ date: { $lte: now } })
    .select('date type category amount currency membershipYear')
    .lean();
  const huf = transactions.filter((t) => t.currency !== 'EUR');
  const yearOf = (t) => t.date.getUTCFullYear();
  const signed = (t) => (t.type === 'income' ? t.amount : -t.amount);
  const opening = huf.filter((t) => yearOf(t) < year).reduce((sum, t) => sum + signed(t), 0);
  const inYear = huf.filter((t) => yearOf(t) === year);
  const byCategory = (type, known) => {
    const totals = new Map(known.map((category) => [category, 0]));
    for (const t of inYear.filter((x) => x.type === type)) {
      totals.set(t.category, (totals.get(t.category) ?? 0) + t.amount);
    }
    return [...totals]
      .filter(([, amount]) => amount)
      .map(([category, amount]) => ({ category, amount }));
  };
  const income = byCategory('income', INCOME_CATEGORIES);
  const expense = byCategory('expense', EXPENSE_CATEGORIES);
  const incomeTotal = income.reduce((sum, r) => sum + r.amount, 0);
  const expenseTotal = expense.reduce((sum, r) => sum + r.amount, 0);
  const duesInYear = inYear.filter((t) => t.type === 'income' && t.category === 'Tagdíj');

  // The year's tours that have started (Budapest dates), with who was there.
  const candidates = await Tour.find({
    startDate: { $gte: new Date(Date.UTC(year - 1, 11, 30)), $lte: now },
  })
    .select('order title startDate duration distanceFromBudapestKm')
    .sort('startDate')
    .lean();
  const tours = [];
  const tourCountByPerson = new Map();
  for (const tour of candidates.filter((t) => budapestParts(t.startDate).year === year)) {
    const reservations = await Reservation.find({ tour: tour._id }).select('attendees').lean();
    const nightsByPerson = new Map();
    for (const a of reservations.flatMap((r) => r.attendees)) {
      nightsByPerson.set(String(a.user), a.nights ?? Math.max(0, tour.duration - 1));
    }
    for (const id of nightsByPerson.keys()) {
      tourCountByPerson.set(id, (tourCountByPerson.get(id) ?? 0) + 1);
    }
    tours.push({
      order: tour.order,
      title: tour.title,
      dates: huDateRange(tour.startDate, tour.duration),
      days: tour.duration,
      people: nightsByPerson.size,
      nights: [...nightsByPerson.values()].reduce((a, b) => a + b, 0),
      km: Math.round((tour.distanceFromBudapestKm ?? 0) * 2),
    });
  }

  return {
    year,
    generatedAt: now,
    presidentName: settings.presidentName,
    members: {
      total: members.length,
      joined: members.filter((m) => m.memberSince === year).length,
      paid: paidIds.filter((id) => memberIds.has(id)).length,
      fee,
      // The fee never changed: one row, from the founding year.
      feeSinceFounding:
        settings.membershipFees.length === 1 &&
        settings.membershipFees[0].fromYear === CLUB_FOUNDING_YEAR,
    },
    finance: {
      opening,
      income,
      expense,
      incomeTotal,
      expenseTotal,
      closing: opening + incomeTotal - expenseTotal,
      dues: duesInYear.reduce((sum, t) => sum + t.amount, 0),
      // Dues that came in this year for an earlier one.
      lateDues: duesInYear
        .filter((t) => t.membershipYear && t.membershipYear < year)
        .reduce((sum, t) => sum + t.amount, 0),
      hasEuro: transactions.some((t) => t.currency === 'EUR' && yearOf(t) === year),
    },
    tours: {
      list: tours,
      days: tours.reduce((sum, t) => sum + t.days, 0),
      km: tours.reduce((sum, t) => sum + t.km, 0),
      nights: tours.reduce((sum, t) => sum + t.nights, 0),
      signUps: tours.reduce((sum, t) => sum + t.people, 0),
      people: tourCountByPerson.size,
      // Who was on every one of them.
      onAll: tours.length
        ? [...tourCountByPerson.values()].filter((n) => n === tours.length).length
        : 0,
    },
  };
}

// The jokes. Each one only says what the figures say.
function memberJokes({ members, finance, year }) {
  const lines = [];
  const unpaid = members.total - members.paid;
  if (members.total && !unpaid) {
    lines.push('Mindenki befizette. A pénztáros azóta is gyanakszik.');
  } else if (unpaid) {
    lines.push(`${unpaid} tag még gondolkodik rajta. Nem sürgetünk, csak számolunk.`);
  }
  if (members.fee && members.feeSinceFounding && year > CLUB_FOUNDING_YEAR) {
    lines.push(
      `A tagdíj ${CLUB_FOUNDING_YEAR} óta ${forint(members.fee)}. Az infláció nálunk nem klubtag.`,
    );
  }
  if (finance.lateDues) {
    lines.push(
      `Az idén befolyt ${forint(finance.dues)} tagdíjból ${forint(finance.lateDues)} korábbi évek pótlása. Jobb későn, mint soha.`,
    );
  }
  return lines;
}

function financeJokes({ members, finance }) {
  const lines = [];
  const tax = finance.income.find((r) => r.category === '1% SZJA felajánlás');
  if (tax && members.fee) {
    lines.push(
      `Az 1%-os felajánlás ${Math.floor(tax.amount / members.fee)} évnyi tagdíjat ér. Köszönjük mindenkinek, aki ránk gondolt a bevallásnál!`,
    );
  }
  const bank = finance.expense.find((r) => r.category === 'Banki költségek');
  if (bank) lines.push(`A bank ${forint(bank.amount)}-ot kért azért, hogy vigyáz a pénzünkre.`);
  const change = finance.closing - finance.opening;
  if (change > 0) {
    lines.push(`Az év mérlege ${signedForint(change)}. Lassan miénk a világ.`);
  } else if (change < 0) {
    lines.push(`Az év mérlege ${signedForint(change)}. De legalább jól éreztük magunkat.`);
  } else {
    lines.push('Az év mérlege kereken nulla. Ezt gyakorolni kellett.');
  }
  return lines;
}

function tourJokes({ tours }) {
  if (!tours.list.length) return ['Idén egy tábor sem volt. Jövőre duplán megyünk.'];
  const lines = [
    `Oda-vissza ${tours.km.toLocaleString('en-US').replace(/,/g, '\u00a0')} km Budapestről. Aki az anyósülésről navigált, ezúton is elnézést kér.`,
    `${tours.nights} közösen töltött éjszaka. A horkolásról nem vezetünk nyilvántartást.`,
  ];
  const biggest = [...tours.list].sort((a, b) => b.people - a.people)[0];
  if (tours.list.length > 1) {
    lines.push(
      `A legnépesebb ${article(biggest.order)} ${biggest.order}. tábor volt (${biggest.title}, ${biggest.people} fő). Ott a zuhanyhoz is sorszámot kellett volna húzni.`,
    );
  }
  if (tours.onAll && tours.list.length > 1) {
    lines.push(
      `${tours.onAll} fő ${tours.list.length === 2 ? 'mindkét' : `mind ${article(tours.list.length)} ${tours.list.length}`} táborban ott volt. Őket lassan leltárba vesszük.`,
    );
  }
  return lines;
}

function card(doc, x, y, width, height) {
  doc.roundedRect(x, y, width, height, 8).fill(CARD);
}

function cardTitle(doc, text, x, y) {
  doc.font('Heading').fontSize(13.5).fillColor(DARK_GREEN).text(text, x, y, { lineBreak: false });
}

// Label left, amount right; returns the next row's top.
function moneyRow(doc, label, amount, x, y, width, { bold = false, color = INK } = {}) {
  doc
    .font(bold ? 'Heading' : 'Body')
    .fontSize(10.5)
    .fillColor(color);
  doc.text(label, x, y, { width: width - 90, lineBreak: false });
  doc.text(amount, x + width - 90, y, { width: 90, align: 'right', lineBreak: false });
  return y + ROW;
}

// The jokes of a card, in italics; returns where they end.
function jokeLines(doc, lines, x, y, width) {
  doc.font('Italic').fontSize(9.5).fillColor(MUTED);
  let top = y;
  for (const line of lines) {
    doc.text(line, x, top, { width, lineGap: 1 });
    top = doc.y + 4;
  }
  return top;
}

function jokesHeight(doc, lines, width) {
  doc.font('Italic').fontSize(9.5);
  return lines.reduce((sum, line) => sum + doc.heightOfString(line, { width, lineGap: 1 }) + 4, 0);
}

function tile(doc, x, y, width, color, value, label, note) {
  const height = TILE;
  card(doc, x, y, width, height);
  doc.roundedRect(x, y, 5, height, 2.5).fill(color);
  const inner = { width: width - 22, lineBreak: false };
  doc
    .font('Title')
    .fontSize(value.length > 9 ? 16 : 25)
    .fillColor(color);
  doc.text(value, x + 14, y + (value.length > 9 ? 17 : 9), inner);
  doc
    .font('Heading')
    .fontSize(10.5)
    .fillColor(INK)
    .text(label, x + 14, y + 45, inner);
  doc
    .font('Body')
    .fontSize(8)
    .fillColor(MUTED)
    .text(note, x + 14, y + 61, inner);
  return y + height;
}

// The report onto a pdfkit document (A4, no margins of its own).
export async function renderYearlyReport(doc, stats) {
  const { year, members, finance, tours } = stats;
  doc.registerFont('Body', FONT_REGULAR);
  doc.registerFont('Heading', FONT_BOLD);
  doc.registerFont('Italic', FONT_ITALIC);
  doc.registerFont('Title', FONT_TITLE);
  const width = doc.page.width - 2 * MARGIN;

  // Head: the logo, and the year.
  if (fs.existsSync(LOGO_PATH)) doc.image(LOGO_PATH, MARGIN, 34, { fit: [210, 48] });
  doc.font('Title').fontSize(12).fillColor(MUTED);
  doc.text('ÉVES JELENTÉS', MARGIN, 32, { width, align: 'right', lineBreak: false });
  doc.fontSize(32).fillColor(DARK_GREEN);
  doc.text(String(year), MARGIN, 44, { width, align: 'right', lineBreak: false });
  doc.font('Italic').fontSize(10).fillColor(MUTED);
  doc.text('A Bódorgó Klub hivatalos, de nem túl komoly évzárója', MARGIN, 92, {
    width,
    lineBreak: false,
  });
  doc
    .moveTo(MARGIN, 110)
    .lineTo(MARGIN + width, 110)
    .lineWidth(1)
    .strokeColor(RULE)
    .stroke();

  // Four tiles.
  const tileWidth = (width - 3 * GAP) / 4;
  const tiles = [
    [
      String(members.total),
      'klubtag',
      members.joined ? `ebből ${members.joined} újonc` : 'stabil, mint a bográcsállvány',
    ],
    [String(tours.list.length), 'tábor', `${tours.days} nap távol a mosogatástól`],
    [String(tours.people), 'bódorgó', 'legalább egy táborban'],
    [forint(finance.closing), 'a kasszában', 'a klub teljes vagyona'],
  ];
  let y = 120;
  tiles.forEach(([value, label, note], i) =>
    tile(doc, MARGIN + i * (tileWidth + GAP), y, tileWidth, TILE_COLORS[i], value, label, note),
  );
  y += TILE + GAP;

  // Two cards side by side: the dues and the money.
  const half = (width - GAP) / 2;
  const pad = 16;
  const inner = half - 2 * pad;
  const mJokes = memberJokes(stats);
  const fJokes = financeJokes(stats);
  if (finance.hasEuro)
    fJokes.push('Az eurós tételek ebben nincsenek benne - azokat külön számoljuk.');
  const moneyRows = 2 + finance.income.length + finance.expense.length;
  const cardHeight =
    Math.max(
      40 + 76 + jokesHeight(doc, mJokes, inner),
      40 + moneyRows * ROW + 16 + jokesHeight(doc, fJokes, inner),
    ) + pad;
  card(doc, MARGIN, y, half, cardHeight);
  card(doc, MARGIN + half + GAP, y, half, cardHeight);

  // Tagdíj: how many paid, as a bar.
  let x = MARGIN + pad;
  cardTitle(doc, `Tagdíj ${year}`, x, y + pad);
  let top = y + 40;
  doc.font('Title').fontSize(24).fillColor(DARK_GREEN);
  doc.text(`${members.paid} / ${members.total}`, x, top, { lineBreak: false });
  const paidWidth = doc.widthOfString(`${members.paid} / ${members.total}`);
  doc.font('Body').fontSize(10.5).fillColor(INK);
  doc.text('tag fizette be', x + paidWidth + 8, top + 12, { lineBreak: false });
  top += 38;
  doc.roundedRect(x, top, inner, 9, 4.5).fill('#ffffff');
  const share = members.total ? members.paid / members.total : 0;
  if (share) doc.roundedRect(x, top, Math.max(9, inner * share), 9, 4.5).fill('#6fb35c');
  top += 17;
  doc.font('Body').fontSize(9.5).fillColor(MUTED);
  doc.text(
    `${Math.round(share * 100)}%${members.fee ? ` · éves tagdíj: ${forint(members.fee)}` : ''}`,
    x,
    top,
    { lineBreak: false },
  );
  jokeLines(doc, mJokes, x, top + 21, inner);

  // Pénzügyek: from Nyitó to Záró.
  x = MARGIN + half + GAP + pad;
  cardTitle(doc, `Pénzügyek ${year}`, x, y + pad);
  top = moneyRow(doc, 'Nyitó egyenleg', forint(finance.opening), x, y + 40, inner);
  for (const row of finance.income) {
    top = moneyRow(doc, row.category, `+${forint(row.amount)}`, x, top, inner, {
      color: DARK_GREEN,
    });
  }
  for (const row of finance.expense) {
    top = moneyRow(doc, row.category, `−${forint(row.amount)}`, x, top, inner, { color: RED });
  }
  doc
    .moveTo(x, top + 1)
    .lineTo(x + inner, top + 1)
    .lineWidth(0.7)
    .strokeColor(RULE)
    .stroke();
  top = moneyRow(doc, 'Záró egyenleg', forint(finance.closing), x, top + 5, inner, { bold: true });
  jokeLines(doc, fJokes, x, top + 7, inner);
  y += cardHeight + GAP;

  // The year's tours, one row each.
  const tJokes = tourJokes(stats);
  const wide = width - 2 * pad;
  const toursHeight = 40 + tours.list.length * ROW + 8 + jokesHeight(doc, tJokes, wide) + pad - 4;
  card(doc, MARGIN, y, width, toursHeight);
  x = MARGIN + pad;
  cardTitle(doc, `Táborok ${year}`, x, y + pad);
  top = y + 40;
  for (const tour of tours.list) {
    doc.font('Heading').fontSize(10.5).fillColor(INK);
    doc.text(`${tour.order}.  ${tour.title}`, x, top, {
      width: 180,
      lineBreak: false,
      ellipsis: true,
    });
    doc.font('Body').fillColor(MUTED);
    doc.text(tour.dates, x + 190, top, { width: 150, lineBreak: false });
    doc.fillColor(INK);
    doc.text(`${tour.days} nap`, x + 340, top, { width: 45, align: 'right', lineBreak: false });
    doc.text(`${tour.people} fő`, x + 385, top, { width: 45, align: 'right', lineBreak: false });
    doc.text(`${tour.km} km`, x + 430, top, {
      width: wide - 430,
      align: 'right',
      lineBreak: false,
    });
    top += ROW;
  }
  jokeLines(doc, tJokes, x, top + 8, wide);
  y += toursHeight + GAP;

  // The seal and the small print.
  y = doc.page.height - MARGIN - 96;
  const seal = await waxSealPng(stats.presidentName);
  doc.image(seal, MARGIN + width - 96, y, { width: 96 });
  doc.font('Heading').fontSize(12).fillColor(INK);
  doc.text(`Jó bódorgást ${yearOnto(year + 1)} is!`, MARGIN, y + 20, { lineBreak: false });
  if (stats.presidentName) {
    doc.font('Body').fontSize(10.5).fillColor(INK);
    doc.text(`${stats.presidentName}, elnök`, MARGIN, y + 38, { lineBreak: false });
  }
  doc.font('Body').fontSize(8).fillColor(MUTED);
  doc.text(
    `Készült: ${huDate(stats.generatedAt)} A számok a klub nyilvántartásából valók, és pontosak. A vicceket nem látta könyvvizsgáló.`,
    MARGIN,
    y + 66,
    { width: width - 115 },
  );
}

// The report of `year` as a PDF file's bytes.
export async function yearlyReportPdf(year, now = new Date()) {
  const stats = await yearlyReportStats(year, now);
  const doc = new PDFDocument({ size: 'A4', margin: 0 });
  const chunks = [];
  doc.on('data', (chunk) => chunks.push(chunk));
  const done = new Promise((resolve, reject) => {
    doc.on('end', resolve);
    doc.on('error', reject);
  });
  await renderYearlyReport(doc, stats);
  doc.end();
  await done;
  return { stats, pdf: Buffer.concat(chunks) };
}
