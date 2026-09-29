import { givenName } from './birthday.js';

// Rangok ünneplése: the first login after someone reaches a new rank
// (the tour count - see toursAttended.js; the same steps as the client's
// shared/tour-medal)
// plays a celebration with a message - set up on Klub → Beállítások
// (clubSettingsModel.js's rankCelebration) - and every admin is e-mailed about it.

export const RANKS = [
  { min: 10, name: 'Bronz' },
  { min: 20, name: 'Ezüst' },
  { min: 30, name: 'Arany' },
  { min: 40, name: 'Platina' },
  { min: 50, name: 'Gyémánt' },
];

export const rankFor = (tours) => [...RANKS].reverse().find((m) => tours >= m.min) ?? null;

export const DEFAULT_RANK_MESSAGE =
  'Kedves {név}! Túléltél {szám} bódorgót! Ez egy remek teljesítmény, csak így tovább! 🏅';

// Ranks reached by then count as already celebrated - only the ones
// reached after it are.
export const RANK_CELEBRATION_START = new Date('2026-09-30T00:00:00+02:00');

// {név} - the given name; {szám} - the rank's step ("10"), or "10+" if
// they're past it by the time they log in; {rang} - "Bronz" etc.
export const fillRankMessage = (template, user, tours, rank) =>
  (template || DEFAULT_RANK_MESSAGE)
    .replaceAll('{név}', givenName(user))
    .replaceAll('{szám}', tours > rank.min ? `${rank.min}+` : String(rank.min))
    .replaceAll('{rang}', rank.name);
