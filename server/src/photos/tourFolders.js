import fs from 'fs';
import config from '../config.js';

// Every tour's photo folder under PHOTOS_ROOT ends in a roman numeral equal
// to that tour's `order` ("..._bodorgo_xxii" is the 22nd tour,
// "..._sarkany_panzio_xxviii" the 28th) - that's how a folder is linked to
// its tour without anyone typing folder names in.

const ROMAN_VALUES = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };

export function romanToInt(roman) {
  const s = roman.toUpperCase();
  let total = 0;
  for (let i = 0; i < s.length; i++) {
    const value = ROMAN_VALUES[s[i]];
    if (value === undefined) return null;
    const next = ROMAN_VALUES[s[i + 1]];
    total += next !== undefined && value < next ? -value : value;
  }
  return total;
}

// The trailing "_<roman numeral>", whatever text precedes it.
export const TRAILING_NUMERAL_RE = /_([ivxlcdm]+)$/i;

// The folder for one tour, or null. Throws if two folders claim the same
// number - a real conflict to resolve by hand.
export function findFolderForOrder(order, photosRoot = config.photosRoot) {
  const matches = fs
    .readdirSync(photosRoot, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .filter((folder) => {
      const m = folder.match(TRAILING_NUMERAL_RE);
      return m && romanToInt(m[1]) === order;
    });
  if (matches.length > 1) {
    throw new Error(
      `Multiple folders match order ${order}: ${matches.join(', ')} - resolve by hand.`,
    );
  }
  return matches[0] ?? null;
}
