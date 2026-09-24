import fs from 'fs';
import path from 'path';
import Tour from '../models/tourModel.js';
import AppError from '../utils/appError.js';
import config from '../config.js';

const VIDEO_EXTENSIONS = new Set(['.mp4', '.mkv', '.mov', '.webm']);

// Tried in order against the video's own basename - .hun.srt is Jellyfin's
// own convention for a Hungarian subtitle track, seen on the couple of
// episodes here that actually have one; .srt alone covers anything not
// language-tagged.
const SUBTITLE_SUFFIXES = ['.hun.srt', '.hu.srt', '.srt'];

// Same escape-guard pattern as tourImageController.js's resolveImagePath -
// tour.videoFile only ever comes from the admin picker below (a real path
// listAvailableVideos itself found on disk), but resolved the same
// defensive way regardless, in case that field is ever hand-edited to
// something unexpected.
function resolveVideoPath(root, filename) {
  const fullPath = path.resolve(root, filename);
  if (fullPath !== root && !fullPath.startsWith(root + path.sep)) {
    throw new AppError('Invalid video path', 400);
  }
  return fullPath;
}

// GET /tours/:tourId/video - requireAuth, no role restriction (see
// tourRoutes.js) - anybody logged in can watch, for now. res.sendFile is
// built on the `send` package, which already handles Range/Accept-Ranges
// headers on its own, so seeking/scrubbing in the <video> element just
// works with no extra code needed here.
export const getTourVideo = async (req, res) => {
  const tour = await Tour.findById(req.params.tourId).select('+videoFile');
  if (!tour || !tour.videoFile) {
    throw new AppError('Ehhez a táborhoz nincs videó feltöltve.', 404);
  }

  const root = path.resolve(config.videosRoot);
  const fullPath = resolveVideoPath(root, tour.videoFile);
  if (!fs.existsSync(fullPath)) {
    throw new AppError('A videó nem található a lemezen.', 404);
  }

  res.sendFile(fullPath);
};

// Looks for a sibling subtitle file next to the video, trying each suffix
// in turn - e.g. "05 - Parádsasvár (2014) S03E02.mp4" pairs with
// "05 - Parádsasvár (2014) S03E02.hun.srt" in the same folder. Returns
// null (not an error) when none exists - most episodes don't have one, and
// that's a normal, silent case, not a problem.
function findSubtitlePath(root, videoFile) {
  const dir = path.dirname(videoFile);
  const base = path.basename(videoFile, path.extname(videoFile));
  for (const suffix of SUBTITLE_SUFFIXES) {
    const candidate = resolveVideoPath(root, path.join(dir, base + suffix));
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

// SRT and WebVTT are nearly identical - the only real differences are the
// "WEBVTT" header VTT requires up front, and the timestamp separator
// (comma in SRT, period in VTT). The regex only touches that exact
// HH:MM:SS,mmm shape, so it can't accidentally mangle a comma anywhere in
// the actual subtitle text.
function srtToVtt(srtText) {
  const withoutBom = srtText.replace(/^﻿/, '');
  const body = withoutBom.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');
  return `WEBVTT\n\n${body}`;
}

// GET /tours/:tourId/subtitles.vtt - same requireAuth bar as the video
// itself. 404s plainly when there's no video or no matching .srt file -
// the client just doesn't render a <track> in that case, no error shown.
export const getTourSubtitles = async (req, res) => {
  const tour = await Tour.findById(req.params.tourId).select('+videoFile');
  if (!tour || !tour.videoFile) {
    throw new AppError('Ehhez a táborhoz nincs videó feltöltve.', 404);
  }

  const root = path.resolve(config.videosRoot);
  const subtitlePath = findSubtitlePath(root, tour.videoFile);
  if (!subtitlePath) {
    throw new AppError('Ehhez a videóhoz nincs felirat.', 404);
  }

  const srtText = fs.readFileSync(subtitlePath, 'utf8');
  res.setHeader('Content-Type', 'text/vtt; charset=utf-8');
  res.send(srtToVtt(srtText));
};

// GET /tours/videos/available - admin-only. Walks config.videosRoot (the
// existing Jellyfin "A bódorgó klán" library) for the tour-edit page's
// video picker, so an admin chooses a real file from a dropdown instead of
// typing a fragile path by hand - important since a single trip can have
// more than one cut of the same episode (e.g. two alternate edits), which
// no naming convention could resolve on its own.
export const listAvailableVideos = async (req, res) => {
  const root = path.resolve(config.videosRoot);
  const results = [];

  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'metadata') continue; // Jellyfin's own thumbnail/nfo cache
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (VIDEO_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        results.push(path.relative(root, full));
      }
    }
  }

  if (fs.existsSync(root)) {
    walk(root);
  }

  res.status(200).json({ status: 'success', data: { files: results.sort() } });
};
