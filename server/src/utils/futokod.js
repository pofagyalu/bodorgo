import crypto from 'crypto';
import User from '../models/userModel.js';
import logger from '../logger.js';

// Futókód: everyone's own four-digit number for the Futókör (the running
// race) - with it someone can run from any phone, without logging in: a
// child with no e-mail address, a guest with a borrowed phone. It's theirs
// to see on Profilom; an admin sees it on their edit page and can tell it
// to them. Nobody else's is ever sent to anyone (the field is select:false).
//
// 1000-9999: a code never starts with a zero, so it's the same typed or
// said out loud.

// A code nobody has yet.
export async function newFutokod() {
  for (;;) {
    const code = String(crypto.randomInt(1000, 10000));
    if (!(await User.exists({ futokod: code }))) return code;
  }
}

// At every server start: whoever has none yet gets one (people from before
// there were codes, and those made without the model's own save).
export async function ensureFutokodok() {
  const without = await User.find({ futokod: { $exists: false } }).select('_id');
  for (const user of without) {
    await User.updateOne({ _id: user._id }, { futokod: await newFutokod() });
  }
  if (without.length) logger.info(`Futókód given to ${without.length} user(s).`);
}

// Whose code it is - null if nobody's.
export function userOfFutokod(code) {
  if (typeof code !== 'string' || !/^\d{4}$/.test(code)) return null;
  return User.findOne({ futokod: code });
}
