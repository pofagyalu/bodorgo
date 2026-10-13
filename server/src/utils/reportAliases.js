import User from '../models/userModel.js';

// The people of the beszámolók as an AI model sees them: "P7" instead of a
// name or a user id - the same person is the same P-number in every tour
// (userModel.js's reportAlias). The swap happens here, on both sides: names
// to aliases in what goes to the model (hideNames, and the beszámoló's
// JSON), aliases back to names in what it answers (showNames).

const label = (number) => `P${number}`;

// The aliases of these users (ids): Map(id → "P7") - whoever has none yet
// gets the next number.
export async function ensureAliases(userIds) {
  const ids = [...new Set(userIds.map(String))];
  const aliases = new Map();
  if (!ids.length) return aliases;
  const users = await User.find({ _id: { $in: ids } }).select('+reportAlias');
  for (const user of users) {
    // Two requests can reach for the same next number - the unique index
    // lets one through, the other tries the one after.
    for (let attempt = 0; user.reportAlias == null && attempt < 20; attempt++) {
      const last = await User.findOne({ reportAlias: { $ne: null } })
        .sort({ reportAlias: -1 })
        .select('+reportAlias');
      const number = (last?.reportAlias ?? 0) + 1;
      try {
        const given = await User.updateOne(
          { _id: user._id, reportAlias: null },
          { $set: { reportAlias: number } },
        );
        user.reportAlias = given.modifiedCount
          ? number
          : (await User.findById(user._id).select('+reportAlias')).reportAlias;
      } catch (err) {
        if (err?.code !== 11000) throw err;
      }
    }
    if (user.reportAlias != null) aliases.set(String(user._id), label(user.reportAlias));
  }
  return aliases;
}

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const sameName = (s) => s.trim().replace(/\s+/g, ' ').toLocaleLowerCase('hu');

// A text with every user's full name in it replaced by their alias: "Mikor
// esett le Nagy Gábor a bicikliről?" → "Mikor esett le P7 a bicikliről?".
// Only whole full names, upper or lower case - an ending stays on it
// ("Nagy Gábornak" → "P7nak", "Kiss Annának" → "P9nak"). A name two users share is left as it is and
// told back (ambiguous). → { text, people: ["P7"], ambiguous: ["…"] }
export async function hideNames(text) {
  const users = await User.find({ name: { $exists: true, $ne: '' } }).select('name');
  const byName = new Map();
  for (const user of users) {
    const key = sameName(user.name);
    if (key) byName.set(key, [...(byName.get(key) ?? []), user]);
  }
  // A last a/e grows long before an ending: "Anna" → "Annának".
  const pattern = (name) =>
    new RegExp(
      `(?<![\\p{L}\\p{N}])${name.split(' ').map(escapeRegExp).join('\\s+')}`.replace(
        /[ae]$/,
        (last) => (last === 'a' ? '[aá]' : '[eé]'),
      ),
      'giu',
    );

  // The longest names first: "Nagy Gábor Péter" before "Nagy Gábor".
  const found = [...byName]
    .sort((a, b) => b[0].length - a[0].length)
    .filter(([name]) => pattern(name).test(text));
  const ambiguous = found.filter(([, same]) => same.length > 1).map(([, same]) => same[0].name);
  const single = found.filter(([, same]) => same.length === 1);
  const aliases = await ensureAliases(single.map(([, [user]]) => user._id));

  let out = text;
  const people = [];
  for (const [name, [user]] of single) {
    const alias = aliases.get(String(user._id));
    if (!alias) continue;
    out = out.replace(pattern(name), alias);
    people.push(alias);
  }
  return { text: out, people, ambiguous };
}

// The other way, for what the model answered: "P7, 2026-07-10" → "Nagy
// Gábor, 2026-07-10". A P-number nobody has stays as it is and is told
// back (unknown) - the model made it up or miscopied it.
export async function showNames(text) {
  const numbers = [...new Set([...text.matchAll(/(?<![\p{L}\p{N}])P(\d+)/gu)].map((m) => +m[1]))];
  const users = await User.find({ reportAlias: { $in: numbers } }).select('name +reportAlias');
  const names = new Map(users.map((u) => [u.reportAlias, u.name]));
  const unknown = numbers.filter((n) => !names.has(n)).map(label);
  const out = text.replace(/(?<![\p{L}\p{N}])P(\d+)/gu, (all, n) => names.get(+n) ?? all);
  return { text: out, unknown };
}
