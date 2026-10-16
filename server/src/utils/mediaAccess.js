import mongoose from 'mongoose';
import AppError from './appError.js';
import User from '../models/userModel.js';

// What can be set for a Média video or photo - its own title, and the
// members who may see it (mediaVideoTitleModel.js,
// mediaPhotoSettingsModel.js). Shared by the two controllers.

// Only the role manager (INITIAL_ADMIN_USER) sets these, and only they are
// told who the viewers are - no other admin.
export const canEditMedia = (user) => !!user?.canManageRoles;

export const mediaEditorOnly = (req, res, next) =>
  next(
    canEditMedia(req.user)
      ? undefined
      : new AppError('A videókat és a fotókat csak a szerepkör-kezelő admin szerkesztheti.', 403),
  );

// With viewers set it is only for them (and the admins); with none, for
// every member.
export const maySee = (user, own) =>
  user.role === 'admin' ||
  !own?.viewers?.length ||
  own.viewers.some((v) => String(v) === String(user._id));

// The title and viewers after a PATCH: only what the body has changes. An
// empty title (or the discovered one itself) means no own title; an empty
// viewers list, every member.
export async function ownSettingsFrom(body, own, discoveredTitle) {
  let title = own?.title ?? '';
  let viewers = (own?.viewers ?? []).map(String);

  if (body?.title !== undefined) {
    if (body.title !== null && typeof body.title !== 'string') {
      throw new AppError('A cím szöveg legyen.', 400);
    }
    title = (body.title ?? '').trim();
    if (title.length > 200) throw new AppError('A cím legfeljebb 200 karakter lehet.', 400);
    if (title === discoveredTitle) title = '';
  }

  if (body?.viewers !== undefined) {
    if (
      !Array.isArray(body.viewers) ||
      body.viewers.some((v) => typeof v !== 'string' || !mongoose.isValidObjectId(v))
    ) {
      throw new AppError('A nézők felhasználók listája legyen.', 400);
    }
    viewers = [...new Set(body.viewers)];
    if ((await User.countDocuments({ _id: { $in: viewers } })) !== viewers.length) {
      throw new AppError('Nincs ilyen felhasználó.', 400);
    }
  }
  return { title, viewers };
}

// A video's "AI-val készült" switch after a PATCH: only when the body has it.
export function aiGeneratedFrom(body, own) {
  if (body?.aiGenerated === undefined) return !!own?.aiGenerated;
  if (typeof body.aiGenerated !== 'boolean') {
    throw new AppError('Az AI jelölés igen/nem érték legyen.', 400);
  }
  return body.aiGenerated;
}

// Saves them in `Model` under `key` - or removes the record, when there is
// nothing left to keep. `flags`: a video's on/off settings (aiGenerated).
export async function saveOwnSettings(Model, key, { title, viewers, ...flags }) {
  const anyFlag = Object.values(flags).some(Boolean);
  if (!title && !viewers.length && !anyFlag) return Model.deleteOne(key);
  return Model.findOneAndUpdate(
    key,
    title
      ? { $set: { title, viewers, ...flags } }
      : { $set: { viewers, ...flags }, $unset: { title: 1 } },
    { upsert: true, runValidators: true },
  );
}
