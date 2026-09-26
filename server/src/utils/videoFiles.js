import fs from 'fs';
import path from 'path';
import AppError from './appError.js';

// File helpers shared by the tour videos and the Média videos - both
// stream straight from the Jellyfin folders on the NAS.

export const VIDEO_EXTENSIONS = new Set(['.mp4', '.mkv', '.mov', '.webm']);

// Tried in order against the video's own basename - .hun.srt is Jellyfin's
// own convention for a Hungarian subtitle track; .srt alone covers
// anything not language-tagged.
const SUBTITLE_SUFFIXES = ['.hun.srt', '.hu.srt', '.srt'];

// Same escape-guard pattern as tourImageController.js's resolveImagePath:
// refuses anything that would step outside `root`.
//
// Normalizes backslashes to forward slashes first - a path found while
// testing against a Windows-mapped drive (Y:/...) has backslash-separated
// segments, which path.resolve on the Linux production server treats as a
// literal character rather than a separator. Forward slashes work on both.
export function resolveVideoPath(root, filename) {
  const normalized = filename.replace(/\\/g, '/');
  const fullPath = path.resolve(root, normalized);
  if (fullPath !== root && !fullPath.startsWith(root + path.sep)) {
    throw new AppError('Invalid video path', 400);
  }
  return fullPath;
}

// A subtitle file next to the video - e.g. "05 - Parádsasvár (2014)
// S03E02.mp4" pairs with "05 - Parádsasvár (2014) S03E02.hun.srt". Null
// (not an error) when there's none - most videos don't have one.
export function findSubtitlePath(root, videoFile) {
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
// HH:MM:SS,mmm shape, so it can't mangle a comma in the subtitle text.
export function srtToVtt(srtText) {
  const withoutBom = srtText.replace(/^\uFEFF/, '');
  const body = withoutBom.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');
  return `WEBVTT\n\n${body}`;
}
