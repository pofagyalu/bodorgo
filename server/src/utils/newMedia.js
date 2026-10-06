import VideoSeen from '../models/videoSeenModel.js';

// "Új" on a photo or video that "Új média felfedezése" has added - for the
// admins only (they press the button, and want to find what it brought),
// for two weeks from that run. Photos keep the time on their own record
// (addedAt); videos aren't stored anywhere, so the run notes when it first
// saw each file (videoSeenModel.js).
export const NEW_MEDIA_DAYS = 14;

const cutoff = () => new Date(Date.now() - NEW_MEDIA_DAYS * 24 * 60 * 60 * 1000);

export const seesNewMedia = (user) => user?.role === 'admin';

// { isNew: true } to spread into what the list sends, or nothing.
export const newMark = (user, addedAt) =>
  seesNewMedia(user) && addedAt && new Date(addedAt) > cutoff() ? { isNew: true } : {};

// A video's key among the seen ones: area "tour" or "media:<category key>",
// and its path inside that area's folder.
export const videoKey = (area, path) => `${area}/${path}`;

// The videos still new, as a set of keys - empty for anyone but an admin.
export async function newVideoKeys(user) {
  if (!seesNewMedia(user)) return new Set();
  const fresh = await VideoSeen.find({ seenAt: { $gt: cutoff() } })
    .select('area path')
    .lean();
  return new Set(fresh.map((v) => videoKey(v.area, v.path)));
}

// Notes the video files met for the first time - `files` is every video
// there is now ({ area, path }). The very first run only takes stock: what
// was already there is not new. Returns how many new ones it found.
export async function recordSeenVideos(files) {
  const known = await VideoSeen.find().select('area path').lean();
  const knownKeys = new Set(known.map((v) => videoKey(v.area, v.path)));
  const unseen = files.filter((f) => !knownKeys.has(videoKey(f.area, f.path)));
  if (!unseen.length) return 0;
  const firstRun = known.length === 0;
  const seenAt = firstRun ? null : new Date();
  await VideoSeen.insertMany(unseen.map((f) => ({ area: f.area, path: f.path, seenAt })));
  return firstRun ? 0 : unseen.length;
}
