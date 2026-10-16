import fs from 'fs';
import path from 'path';
import AppError from '../utils/appError.js';
import { mp4DurationSeconds } from '../utils/mp4Duration.js';
import config from '../config.js';
import MediaVideoTitle from '../models/mediaVideoTitleModel.js';
import { canEditMedia, maySee, ownSettingsFrom, saveOwnSettings } from '../utils/mediaAccess.js';
import {
  VIDEO_EXTENSIONS,
  coverVersion,
  findSubtitlePath,
  resolveVideoPath,
  srtToVtt,
} from '../utils/videoFiles.js';
import {
  removeSmallCopy,
  requestSmallCopy,
  smallCopyJobs,
  videoFileFor,
  videoQualityInfo,
} from '../utils/videoCopies.js';
import { newVideoKeys, videoKey } from '../utils/newMedia.js';

// The club's own videos that don't belong to any one tour - Média → Videók.
// The videos aren't stored in the database: each category is a
// Jellyfin-organized folder under MEDIA_ROOT (next to the tour videos'
// a-bodorgo-klan), and whatever is in it is what the page shows, covers
// included - add or replace a file there and the page follows. What is
// stored is what the role manager set for a video (mediaVideoTitleModel.js): its
// own title, shown instead of the one from its file name, and the members
// who may see it - anyone else (but an admin) doesn't get it in the list,
// and can't fetch it, its cover or its subtitles either.
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
  // Covers change rarely; a short cache still picks up a replaced one soon
  // (the page asks for a replaced one at once anyway: its address carries
  // the list's coverVersion).
  res.setHeader('Cache-Control', 'private, max-age=3600');
  res.sendFile(filePath);
}

// GET /media/videos - every category with its videos, newest first. Empty
// categories are left out.
export const listMediaVideos = async (req, res) => {
  const canEdit = canEditMedia(req.user);
  // What was set for them, by "category/path".
  const settings = new Map(
    (await MediaVideoTitle.find().lean()).map((s) => [`${s.category}/${s.path}`, s]),
  );
  const newKeys = await newVideoKeys(req.user);
  const categories = MEDIA_VIDEO_CATEGORIES.map((category) => {
    const root = categoryRoot(category);
    const videos = findVideoFiles(root)
      .filter((relPath) => maySee(req.user, settings.get(`${category.key}/${relPath}`)))
      .map((relPath) => {
        const parsed = parseVideoName(relPath);
        const own = settings.get(`${category.key}/${relPath}`);
        const thumb = findThumb(root, relPath);
        return {
          id: encodeId(relPath),
          title: own?.title || parsed.title,
          // An admin: "Új" on one a discovery has just met.
          ...(newKeys.has(videoKey(`media:${category.key}`, relPath)) ? { isNew: true } : {}),
          // Who may see it (empty: every member) - only the one who sets it
          // is told.
          ...(canEdit ? { viewers: (own?.viewers ?? []).map(String) } : {}),
          // What the file name says - what an emptied title goes back to.
          discoveredTitle: parsed.title,
          year: parsed.year,
          season: parsed.season,
          episode: parsed.episode,
          hasCover: !!thumb,
          ...coverVersion(thumb),
          hasSubtitles: !!findSubtitlePath(root, relPath),
          // Its small copy and the two pictures' lines (utils/videoCopies.js).
          ...videoQualityInfo({
            area: category.folder,
            root,
            fullPath: resolveVideoPath(root, relPath),
          }),
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
    const folderCover = findFolderCover(root);
    return {
      key: category.key,
      title: category.title,
      description: category.description,
      hasCover: !!folderCover,
      ...coverVersion(folderCover),
      videos,
    };
  }).filter((c) => c.videos.length > 0);

  res.status(200).json({ status: 'success', data: { categories } });
};

// A file's path the one way it can be compared: the same file can be
// asked for in other spellings (upper/lower case on the NAS, a Windows
// short name).
function canonicalPath(fullPath) {
  let real = fullPath;
  try {
    real = fs.realpathSync.native(fullPath);
  } catch {
    // Not there (any more) - compared as written.
  }
  return real.normalize('NFC').toLowerCase();
}

// Resolves :category/:id to a real video file inside that category folder -
// one this user may see: a video kept for others is, to them, not there.
async function videoPath(req) {
  const category = categoryOf(req.params.category);
  const root = categoryRoot(category);
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

  if (req.user.role !== 'admin') {
    // The category's videos this user is not among the viewers of.
    const hidden = await MediaVideoTitle.find({
      category: req.params.category,
      'viewers.0': { $exists: true },
      viewers: { $ne: req.user._id },
    }).lean();
    const asked = hidden.length ? canonicalPath(fullPath) : null;
    if (hidden.some((h) => canonicalPath(resolveVideoPath(root, h.path)) === asked)) {
      throw new AppError('Nincs ilyen videó.', 404);
    }
  }
  return { root, relPath, fullPath, area: category.folder };
}

// A video as the homepage's "Népszerű" plays it (utils/views.js) - null if
// it isn't there, or this user may not see it.
export async function visibleMediaVideo(user, categoryKey, id) {
  let video;
  try {
    video = await videoPath({ params: { category: categoryKey, id }, user });
  } catch {
    return null;
  }
  const parsed = parseVideoName(video.relPath);
  const own = await MediaVideoTitle.findOne({ category: categoryKey, path: video.relPath }).lean();
  const thumb = findThumb(video.root, video.relPath);
  return {
    title: own?.title || parsed.title,
    year: parsed.year,
    categoryTitle: categoryOf(categoryKey).title,
    hasCover: !!thumb,
    ...coverVersion(thumb),
    hasSubtitles: !!findSubtitlePath(video.root, video.relPath),
    ...videoQualityInfo(video),
  };
}

// Every Média video file, as the small copies know them - for "Új média
// felfedezése" to count the ones without a copy.
export function mediaVideoFiles() {
  if (!config.mediaVideosRoot) return [];
  return MEDIA_VIDEO_CATEGORIES.flatMap((category) => {
    const root = categoryRoot(category);
    return findVideoFiles(root).map((relPath) => ({
      area: category.folder,
      root,
      fullPath: resolveVideoPath(root, relPath),
    }));
  });
}

// Every Média video as the "seen" records know it (utils/newMedia.js).
export function mediaVideoPaths() {
  if (!config.mediaVideosRoot) return [];
  return MEDIA_VIDEO_CATEGORIES.flatMap((category) =>
    findVideoFiles(categoryRoot(category)).map((relPath) => ({
      area: `media:${category.key}`,
      path: relPath,
    })),
  );
}

// PATCH /media/videos/:category/:id - the role manager: the video's own title, shown
// instead of the one from its file name, and who may see it. Only what is
// sent changes. An empty title (or the file name's own) takes the
// correction away; an empty viewers list gives the video back to every
// member.
export const updateMediaVideo = async (req, res) => {
  const { relPath } = await videoPath(req);
  const category = req.params.category;
  const discoveredTitle = parseVideoName(relPath).title;
  const own = await MediaVideoTitle.findOne({ category, path: relPath }).lean();
  const { title, viewers } = await ownSettingsFrom(req.body, own, discoveredTitle);
  await saveOwnSettings(MediaVideoTitle, { category, path: relPath }, { title, viewers });
  res.status(200).json({
    status: 'success',
    data: {
      video: { id: req.params.id, title: title || discoveredTitle, discoveredTitle, viewers },
    },
  });
};

// GET /media/videos/:category/:id/video - res.sendFile handles Range
// requests itself, so seeking just works (same as the tour videos). The
// small copy when there is one, unless ?quality=original.
export const getMediaVideo = async (req, res) => {
  res.sendFile(videoFileFor(await videoPath(req), req.query.quality));
};

// How the page knows a video's conversion again among the jobs.
const smallCopyRef = (req, video) =>
  `media:${req.params.category}:${encodeId(path.relative(video.root, video.fullPath))}`;

// POST /media/videos/:category/:id/small - an admin: make its small copy.
// Queued (one is made at a time); GET /media/videos/small-copies tells how
// it's going.
export const startMediaVideoSmall = async (req, res) => {
  const video = await videoPath(req);
  res.status(202).json({
    status: 'success',
    data: { job: requestSmallCopy(video, smallCopyRef(req, video)) },
  });
};

// DELETE /media/videos/:category/:id/small - an admin: the copy goes (its
// conversion is stopped, if still going); the original plays again.
export const removeMediaVideoSmall = async (req, res) => {
  removeSmallCopy(await videoPath(req));
  res.status(204).end();
};

// GET /media/videos/small-copies - an admin: every conversion asked for
// since the server started, the tour videos' too.
export const listSmallCopyJobs = (req, res) => {
  res.status(200).json({ status: 'success', data: { jobs: smallCopyJobs() } });
};

// GET /media/videos/:category/:id/cover
export const getMediaVideoCover = async (req, res) => {
  const { root, relPath } = await videoPath(req);
  const thumb = findThumb(root, relPath);
  if (!thumb) throw new AppError('Ehhez a videóhoz nincs borítókép.', 404);
  sendCover(res, thumb);
};

// GET /media/videos/:category/:id/subtitles.vtt - 404 when there's none;
// the page only asks for it when the list said hasSubtitles.
export const getMediaVideoSubtitles = async (req, res) => {
  const { root, relPath } = await videoPath(req);
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
