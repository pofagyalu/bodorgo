import AppError from '../utils/appError.js';
import {
  MAX_VIEWS_PER_REQUEST,
  STATS_PERIODS,
  popularFor,
  recordViews,
  statsFor,
} from '../utils/views.js';
import { noteInstalledApp } from '../utils/activity.js';

// Megtekintések (utils/views.js): the pages tell what was seen, the
// homepage asks for the most viewed.

// POST /views - { views: [{ type, key, playlist? }] }: what this user has
// just seen. The page sends them in small batches - and as plain text when
// the page is closing (navigator.sendBeacon can't send JSON across the
// client's and the API's subdomains), so a string body is read here too.
export const postViews = async (req, res) => {
  let body = req.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      throw new AppError('Hibás kérés.', 400);
    }
  }
  const views = body?.views;
  if (!Array.isArray(views) || views.length > MAX_VIEWS_PER_REQUEST) {
    throw new AppError(
      `A views legfeljebb ${MAX_VIEWS_PER_REQUEST} megtekintés listája legyen.`,
      400,
    );
  }
  const recorded = await recordViews(req.user, views);
  res.status(200).json({ status: 'success', data: { recorded } });
};

// GET /views/popular - the most viewed photo, video, tour and song of the
// last 30 days that this user may see.
export const getPopular = async (req, res) => {
  res.status(200).json({ status: 'success', data: await popularFor(req.user) });
};

// POST /views/app - the installed app (home screen icon) says it is the one
// in use today; a browser can't tell that from its requests.
export const postInstalledApp = async (req, res) => {
  await noteInstalledApp(req.user);
  res.status(204).end();
};

// GET /views/stats?days=30 (admins) - Klub → Statisztika: active users,
// devices, the most viewed and the songbook searches that found nothing,
// for the last 7, 30 or 90 days, or every day (0). Totals only.
export const getStats = async (req, res) => {
  const days = req.query.days === undefined ? 30 : Number(req.query.days);
  if (!STATS_PERIODS.includes(days)) {
    throw new AppError(`A days ezek egyike legyen: ${STATS_PERIODS.join(', ')}.`, 400);
  }
  res.status(200).json({ status: 'success', data: await statsFor(req.user, days) });
};
