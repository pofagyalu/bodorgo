import mongoose from 'mongoose';
import ExcelJS from 'exceljs';
import Tour from '../models/tourModel.js';
import AppError from '../utils/appError.js';
import { computeAttendeePayments } from './reservationController.js';

function formatHu(date) {
  return new Intl.DateTimeFormat('hu-HU', { year: 'numeric', month: 'long', day: 'numeric' }).format(date);
}

// Same grouping rule as the client's own attendee-list.ts groupedFamilies
// - a real family (2+ members sharing a familyId) vs. each family-less
// attendee being its own solo "group" of one.
function groupByFamily(rows) {
  const groups = new Map();
  for (const r of rows) {
    const key = r.familyId ?? `solo-${r.attendeeId}`;
    const group = groups.get(key);
    if (group) {
      group.push(r);
    } else {
      groups.set(key, [r]);
    }
  }
  for (const members of groups.values()) {
    members.sort((a, b) => a.name.localeCompare(b.name, 'hu'));
  }
  return [...groups.values()].sort((a, b) => a[0].name.localeCompare(b[0].name, 'hu'));
}

// "Nagy" when every member of the family shares the same first name token
// (Hungarian surname-first convention) - same reasoning as the client's
// own familyLabel, kept in sync deliberately rather than shared, since
// one's a PDF/Excel-generation concern and the other's a template helper.
function familyLabel(members) {
  const surnames = new Set(members.map((m) => m.name.trim().split(/\s+/)[0]));
  if (surnames.size === 1) {
    return `${[...surnames][0]} család`;
  }
  return 'Család';
}

const MONEY_FORMAT = '#,##0" Ft"';
const HEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF445A67' } };
const FAMILY_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDCEAF3' } };
const TOTAL_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEEEEEE' } };

// Admin-only - a real, self-contained spreadsheet meant to be handed to
// the house owner: every attendee's own name/nights/price/advance/rest,
// grouped by family with an emphasized subtotal row per family (bold,
// tinted, matching the on-screen attendee list's own collapsible family
// row), so the owner can tick people off on arrival and collect exactly
// the Fizetendő (rest) from each. Built from the exact same
// computeAttendeePayments numbers the tour-details page itself shows, so
// the export can never disagree with what's on screen.
//
// Deliberately no "paid" column - everyone on this list has, by
// definition, already settled their Előleg (advance) or been marked
// exempt, since that's a precondition of attending at all. A per-row
// "Fizetve: Igen" would just be constant noise, not real information.
export const downloadAttendeesExcel = async (req, res) => {
  const query = mongoose.isValidObjectId(req.params.id) ? { _id: req.params.id } : { slug: req.params.id };
  const tour = await Tour.findOne(query).populate({
    path: 'reservations',
    populate: [{ path: 'attendees.user', select: 'role birthday familyId' }],
  });
  if (!tour) {
    throw new AppError('No tour found with that ID!', 404);
  }

  const { attendeePayments, totals } = computeAttendeePayments(tour, tour.reservations);
  const hasPricing = totals !== null;
  const families = groupByFamily(attendeePayments);

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Bódorgó';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet('Résztvevők', { views: [{ state: 'frozen', ySplit: 4 }] });

  sheet.mergeCells('A1:F1');
  sheet.getCell('A1').value = tour.title;
  sheet.getCell('A1').font = { bold: true, size: 14 };

  sheet.mergeCells('A2:F2');
  sheet.getCell('A2').value = `${formatHu(tour.startDate)} · ${tour.duration} nap / ${tour.duration - 1} éjszaka`;
  sheet.getCell('A2').font = { color: { argb: 'FF666666' } };

  sheet.mergeCells('A3:F3');
  sheet.getCell('A3').value = `Készítve: ${formatHu(new Date())}`;
  sheet.getCell('A3').font = { color: { argb: 'FF999999' }, size: 9 };

  const headerRow = sheet.addRow(['Név', 'Család', 'Éjszakák', 'Teljes ár', 'Előleg', 'Fizetendő']);
  headerRow.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = HEADER_FILL;
  });

  sheet.columns = [
    { key: 'name', width: 28 },
    { key: 'family', width: 20 },
    { key: 'nights', width: 10 },
    { key: 'totalPrice', width: 14 },
    { key: 'advance', width: 14 },
    { key: 'rest', width: 14 },
  ];

  for (const members of families) {
    const label = familyLabel(members);
    for (const r of members) {
      const row = sheet.addRow([
        r.name,
        members.length > 1 ? label : '',
        r.nights,
        hasPricing ? r.totalPrice : null,
        hasPricing ? r.advance : null,
        hasPricing ? r.rest : null,
      ]);
      if (hasPricing) {
        row.getCell(4).numFmt = MONEY_FORMAT;
        row.getCell(5).numFmt = MONEY_FORMAT;
        row.getCell(6).numFmt = MONEY_FORMAT;
      }
    }

    if (members.length > 1) {
      const subtotalRow = sheet.addRow([
        `${label} összesen`,
        '',
        '',
        hasPricing ? members.reduce((sum, m) => sum + (m.totalPrice ?? 0), 0) : null,
        hasPricing ? members.reduce((sum, m) => sum + (m.advance ?? 0), 0) : null,
        hasPricing ? members.reduce((sum, m) => sum + (m.rest ?? 0), 0) : null,
      ]);
      subtotalRow.eachCell((cell) => {
        cell.font = { bold: true, color: { argb: 'FF1A4971' } };
        cell.fill = FAMILY_FILL;
      });
      if (hasPricing) {
        subtotalRow.getCell(4).numFmt = MONEY_FORMAT;
        subtotalRow.getCell(5).numFmt = MONEY_FORMAT;
        subtotalRow.getCell(6).numFmt = MONEY_FORMAT;
      }
    }
  }

  if (hasPricing) {
    const grandTotalRow = sheet.addRow(['Mindösszesen', '', '', totals.totalPrice, totals.advance, totals.rest]);
    grandTotalRow.eachCell((cell) => {
      cell.font = { bold: true };
      cell.fill = TOTAL_FILL;
    });
    grandTotalRow.getCell(4).numFmt = MONEY_FORMAT;
    grandTotalRow.getCell(5).numFmt = MONEY_FORMAT;
    grandTotalRow.getCell(6).numFmt = MONEY_FORMAT;
  }

  const filename = `${tour.order ? tour.order + '-' : ''}${tour.slug || 'tabor'}-resztvevok.xlsx`;
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  await workbook.xlsx.write(res);
  res.end();
};
