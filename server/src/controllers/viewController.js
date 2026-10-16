import AppError from '../utils/appError.js';
import { MAX_VIEWS_PER_REQUEST, popularFor, recordViews } from '../utils/views.js';

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
