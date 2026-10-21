import MediaVideoTitle from '../../src/models/mediaVideoTitleModel.js';
import { mediaVideoPaths } from '../../src/controllers/mediaVideoController.js';

// A new Média video is the admins' alone (mediaVideoTitleModel.js's access):
// opens every one in the test's folder to all members, as
// scripts/fillVideoAccess.mjs did with the ones already there.
export const openMediaVideos = () =>
  MediaVideoTitle.bulkWrite(
    mediaVideoPaths().map((v) => {
      const key = { category: v.area.replace(/^media:/, ''), path: v.path };
      return { updateOne: { filter: key, update: { $set: { access: 'all' } }, upsert: true } };
    }),
  );
