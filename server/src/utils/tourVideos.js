import fs from 'fs';
import path from 'path';
import config from '../config.js';
import { VIDEO_EXTENSIONS, findSubtitlePath } from './videoFiles.js';

const THUMB_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp'];

// The tour recap videos, matched to their tours by the tour number every
// file name starts with - "10 - Sarud (2017) - Directors Cut - S06E01.mp4"
// is tour #10's. Nothing to pick or store: a correctly named file dropped
// into the a-bodorgo-klan folder (any season subfolder) shows up on its
// tour's page.
//
// A tour can have more than one version (two cuts of the same trip); the
// text between the year and the episode code names each one ("Directors
// Cut"). A file with nothing there is just "the" video.

// How a version is shown on the page - the file names keep plain ASCII
// ("Directors Cut"), the page uses the Hungarian film terms.
const VERSION_LABELS = {
  'directors cut': 'Rendezői változat',
  'kilians cut': 'Kilián-féle vágás',
};

export function displayVersionLabel(label) {
  return VERSION_LABELS[label.toLowerCase().replace(/'/g, '')] ?? label;
}

export function parseTourVideoName(filename) {
  const base = path.basename(filename, path.extname(filename)).trim();
  const orderMatch = /^(\d{1,3})\s*[-_.]/.exec(base);
  if (!orderMatch) return null;
  // Whatever sits between "(year)" and the SxxEyy episode code.
  const labelMatch = /\(\d{4}\)(.*?)S\d+E\d+/i.exec(base);
  const label = labelMatch ? labelMatch[1].replace(/^[\s\-_]+|[\s\-_]+$/g, '').trim() : '';
  return { order: Number(orderMatch[1]), label };
}

// "<name>-thumb.jpg" next to the video - tolerating the stray space
// Jellyfin keeps when the name itself ends in one.
export function findVideoThumb(root, relPath) {
  const dir = path.dirname(relPath);
  const base = path.basename(relPath, path.extname(relPath));
  for (const name of new Set([base, base.trim()])) {
    for (const ext of THUMB_EXTENSIONS) {
      const candidate = path.join(root, dir, `${name}-thumb${ext}`);
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return null;
}

export const encodeVideoId = (relPath) => Buffer.from(relPath, 'utf8').toString('base64url');
export const decodeVideoId = (id) => Buffer.from(id, 'base64url').toString('utf8');

export function tourVideosRoot() {
  return config.videosRoot ? path.resolve(config.videosRoot) : null;
}

function walk(root, rel = '', depth = 0) {
  let entries;
  try {
    entries = fs.readdirSync(path.join(root, rel), { withFileTypes: true });
  } catch {
    return [];
  }
  return entries.flatMap((e) => {
    if (e.name === 'metadata') return []; // Jellyfin's own cache
    const childRel = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) return depth < 2 ? walk(root, childRel, depth + 1) : [];
    return VIDEO_EXTENSIONS.has(path.extname(e.name).toLowerCase()) ? [childRel] : [];
  });
}

// Scanned at most once a minute - the tour list and every tour page ask.
const CACHE_MS = 60 * 1000;
let cache = { at: 0, root: null, byOrder: new Map() };

// tour number -> its versions, sorted by name (an unnamed one first).
export function scanTourVideos() {
  const root = tourVideosRoot();
  if (cache.root === root && Date.now() - cache.at < CACHE_MS) return cache.byOrder;

  const byOrder = new Map();
  if (root) {
    for (const relPath of walk(root)) {
      const parsed = parseTourVideoName(relPath);
      if (!parsed) continue;
      if (!byOrder.has(parsed.order)) byOrder.set(parsed.order, []);
      byOrder.get(parsed.order).push({ relPath, label: parsed.label });
    }
    for (const versions of byOrder.values()) {
      versions.sort((a, b) => a.label.localeCompare(b.label, 'hu'));
    }
  }
  cache = { at: Date.now(), root, byOrder };
  return byOrder;
}

export function clearTourVideoCache() {
  cache = { at: 0, root: null, byOrder: new Map() };
}

// What the tour page gets for a tour: each version's id and name, and
// whether it has a cover / subtitles.
export function tourVideoList(order) {
  const root = tourVideosRoot();
  return (scanTourVideos().get(order) ?? []).map(({ relPath, label }) => ({
    id: encodeVideoId(relPath),
    label: displayVersionLabel(label),
    hasCover: !!findVideoThumb(root, relPath),
    hasSubtitles: !!findSubtitlePath(root, relPath),
  }));
}
