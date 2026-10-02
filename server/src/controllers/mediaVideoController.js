import fs from 'fs';
import path from 'path';
import AppError from '../utils/appError.js';
import { mp4DurationSeconds } from '../utils/mp4Duration.js';
import config from '../config.js';
import MediaVideoTitle from '../models/mediaVideoTitleModel.js';
import {
  VIDEO_EXTENSIONS,
  findSubtitlePath,
  resolveVideoPath,
  srtToVtt,
} from '../utils/videoFiles.js';

// The club's own videos that don't belong to any one tour - Média → Videók.
// The videos aren't stored in the database: each category is a
// Jellyfin-organized folder under MEDIA_ROOT (next to the tour videos'
// a-bodorgo-klan), and whatever is in it is what the page shows, covers
// included - add or replace a file there and the page follows. The one
// thing that is stored: an admin's own title for a video
// (mediaVideoTitleModel.js), shown instead of the one from its file name.
//
// Folder -> the name shown on the page, in display order (also the order
// of the Média sidebar's sub-menu). The folder name is only used to find
// the files; the key is the page address (/media/videok/<key>).
export const MEDIA_VIDEO_CATEGORIES = [
  {
    key: 'szilveszter',
    folder: 'szilveszter',
    title: 'Szilveszteri műsorok',
    description: 'Az év összefoglalója, ahogy éjfélkor adásba ment.',
  },
  {
    key: 'botv',
    folder: 'botv-specials',
    title: 'Bódorgó TV különkiadások',
    description: 'A Bódorgó TV rendkívüli adásai.',
  },
  {
    key: 'farsang',
    folder: 'farsang',
    title: 'Farsangok',
    description: 'Jelmezek, amikre jobb nem emlékezni.',
  },
  {
    key: 'reklam',
    folder: 'reklam',
    title: 'Reklámok',
    description: 'Termékek, amiket sehol nem lehet megvenni.',
  },
];

// Jellyfin's cover images: a video's own "<name>-thumb.jpg" next to it,
// and folder.jpg/.png for a whole category.
const COVER_TYPES = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

function categoryOf(key) {
  const category = MEDIA_VIDEO_CATEGORIES.find((c) => c.key === key);
  if (!category) throw new AppError('Nincs ilyen videókategória.', 404);
  return category;
}

function categoryRoot(category) {
  if (!config.mediaVideosRoot) throw new AppError('A videók mappája nincs beállítva.', 500);
  return path.resolve(config.mediaVideosRoot, category.folder);
}

// A video's id is its path inside the category folder, base64url-encoded -
// safe in a URL, and resolved back through resolveVideoPath, which refuses
// anything that would step outside that folder.
const encodeId = (relPath) =>
  Buffer.from(relPath.replace(/\\/g, '/'), 'utf8').toString('base64url');
const decodeId = (id) => Buffer.from(id, 'base64url').toString('utf8');

// Every video file in the category folder and its season subfolders.
function findVideoFiles(root, rel = '', depth = 0) {
  let entries;
  try {
    entries = fs.readdirSync(path.join(root, rel), { withFileTypes: true });
  } catch {
    return [];
  }
  return entries.flatMap((e) => {
    const childRel = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) return depth < 2 ? findVideoFiles(root, childRel, depth + 1) : [];
    return VIDEO_EXTENSIONS.has(path.extname(e.name).toLowerCase()) ? [childRel] : [];
  });
}

// "Farsang (2025) S01E02.mp4" -> title "Farsang", year 2025, episode 2;
// anything after the episode number is part of the title ("A dal (2026)
// S01E3 Bodorgunk" -> "A dal – Bodorgunk"). A name that doesn't follow
// Jellyfin's pattern is simply shown as it is.
export function parseVideoName(filename) {
  const base = path.basename(filename, path.extname(filename)).trim();
  const m = base.match(/^(.*?)\s*\((\d{4})\)\s*S(\d+)E(\d+)\s*(.*)$/i);
  if (!m) return { title: base, year: null, season: null, episode: null };
  const extra = m[5].trim();
  return {
    title: extra ? `${m[1].trim()} – ${extra}` : m[1].trim(),
    year: Number(m[2]),
    season: Number(m[3]),
    episode: Number(m[4]),
  };
}

// The video's "-thumb" cover - tolerating the stray space Jellyfin keeps
// when the video's own name ends in one ("…S01E01 .mp4" -> "…S01E01 -thumb.jpg").
function findThumb(root, relPath) {
  const dir = path.dirname(relPath);
  const base = path.basename(relPath, path.extname(relPath));
  for (const name of new Set([base, base.trim()])) {
    for (const ext of Object.keys(COVER_TYPES)) {
      const candidate = path.join(root, dir, `${name}-thumb${ext}`);
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return null;
}

function findFolderCover(root) {
  for (const ext of Object.keys(COVER_TYPES)) {
    const candidate = path.join(root, `folder${ext}`);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function sendCover(res, filePath) {
  res.setHeader(
    'Content-Type',
    COVER_TYPES[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream',
  );
  // Covers change rarely; a short cache still picks up a replaced one soon.
  res.setHeader('Cache-Control', 'private, max-age=3600');
  res.sendFile(filePath);
}

// GET /media/videos - every category with its videos, newest first. Empty
// categories are left out.
export const listMediaVideos = async (req, res) => {
  // The admins' own titles, by "category/path".
  const ownTitles = new Map(
    (await MediaVideoTitle.find().lean()).map((t) => [`${t.category}/${t.path}`, t.title]),
  );
  const categories = MEDIA_VIDEO_CATEGORIES.map((category) => {
    const root = categoryRoot(category);
    const videos = findVideoFiles(root)
      .map((relPath) => {
        const parsed = parseVideoName(relPath);
        return {
          id: encodeId(relPath),
          title: ownTitles.get(`${category.key}/${relPath}`) ?? parsed.title,
          // What the file name says - what an emptied title goes back to.
          discoveredTitle: parsed.title,
          year: parsed.year,
          season: parsed.season,
          episode: parsed.episode,
          hasCover: !!findThumb(root, relPath),
          hasSubtitles: !!findSubtitlePath(root, relPath),
          // How long it is - read from the file itself (null if it can't
          // be: not an MP4/MOV, or unreadable).
          durationSeconds: mp4DurationSeconds(path.join(root, relPath)),
        };
      })
      .sort(
        (a, b) =>
          (b.year ?? 0) - (a.year ?? 0) ||
          (b.season ?? 0) - (a.season ?? 0) ||
          (b.episode ?? 0) - (a.episode ?? 0) ||
          a.title.localeCompare(b.title, 'hu'),
      );
    return {
      key: category.key,
      title: category.title,
      description: category.description,
      hasCover: !!findFolderCover(root),
      videos,
    };
  }).filter((c) => c.videos.length > 0);

  res.status(200).json({ status: 'success', data: { categories } });
};

// Resolves :category/:id to a real video file inside that category folder.
function videoPath(req) {
  const root = categoryRoot(categoryOf(req.params.category));
  let relPath;
  try {
    relPath = decodeId(req.params.id);
  } catch {
    throw new AppError('Nincs ilyen videó.', 404);
  }
  if (!relPath || !VIDEO_EXTENSIONS.has(path.extname(relPath).toLowerCase())) {
    throw new AppError('Nincs ilyen videó.', 404);
  }
  const fullPath = resolveVideoPath(root, relPath);
  if (!fs.existsSync(fullPath)) throw new AppError('Nincs ilyen videó.', 404);
  return { root, relPath, fullPath };
}

// PATCH /media/videos/:category/:id - admin: the video's own title, shown
// instead of the one from its file name. An empty title (or the file
// name's own) takes the correction away.
export const updateMediaVideoTitle = async (req, res) => {
  const { relPath } = videoPath(req);
  const category = req.params.category;
  const discoveredTitle = parseVideoName(relPath).title;
  if (req.body?.title != null && typeof req.body.title !== 'string') {
    throw new AppError('A cím szöveg legyen.', 400);
  }
  const title = (req.body?.title ?? '').trim();
  if (title.length > 200) throw new AppError('A cím legfeljebb 200 karakter lehet.', 400);

  if (!title || title === discoveredTitle) {
    await MediaVideoTitle.deleteOne({ category, path: relPath });
  } else {
    await MediaVideoTitle.findOneAndUpdate(
      { category, path: relPath },
      { title },
      { upsert: true, runValidators: true },
    );
  }
  res.status(200).json({
    status: 'success',
    data: { video: { id: req.params.id, title: title || discoveredTitle, discoveredTitle } },
  });
};

// GET /media/videos/:category/:id/video - res.sendFile handles Range
// requests itself, so seeking just works (same as the tour videos).
export const getMediaVideo = async (req, res) => {
  res.sendFile(videoPath(req).fullPath);
};

// GET /media/videos/:category/:id/cover
export const getMediaVideoCover = async (req, res) => {
  const { root, relPath } = videoPath(req);
  const thumb = findThumb(root, relPath);
  if (!thumb) throw new AppError('Ehhez a videóhoz nincs borítókép.', 404);
  sendCover(res, thumb);
};

// GET /media/videos/:category/:id/subtitles.vtt - 404 when there's none;
// the page only asks for it when the list said hasSubtitles.
export const getMediaVideoSubtitles = async (req, res) => {
  const { root, relPath } = videoPath(req);
  const subtitlePath = findSubtitlePath(root, relPath);
  if (!subtitlePath) throw new AppError('Ehhez a videóhoz nincs felirat.', 404);
  res.setHeader('Content-Type', 'text/vtt; charset=utf-8');
  res.send(srtToVtt(fs.readFileSync(subtitlePath, 'utf8')));
};

// GET /media/videos/:category/cover - the category's folder.jpg/.png.
export const getMediaVideoCategoryCover = async (req, res) => {
  const cover = findFolderCover(categoryRoot(categoryOf(req.params.category)));
  if (!cover) throw new AppError('Ennek a kategóriának nincs borítóképe.', 404);
  sendCover(res, cover);
};
