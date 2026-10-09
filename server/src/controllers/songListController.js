import mongoose from 'mongoose';
import Song from '../models/songModel.js';
import SongList from '../models/songListModel.js';
import AppError from '../utils/appError.js';

// The Daloskönyv's playlists: each user's own named lists of songs, in an
// order of their choosing. Private - every request works on the caller's
// own lists only; someone else's is "not found". Any song of the songbook
// may stand in a list, the ones others added too.

// How many lists one user may have, and how many songs a list may hold -
// far more than anyone needs, a fence against a runaway client.
const MAX_LISTS = 100;
const MAX_SONGS = 1000;

const byHungarian = new Intl.Collator('hu', { sensitivity: 'base' });

const view = (list) => ({
  _id: list._id,
  name: list.name,
  songs: list.songs.map(String),
  updatedAt: list.updatedAt,
});

function nameOf(body) {
  const name = String(body.name ?? '').trim();
  if (!name) throw new AppError('A listának kell legyen neve.', 400);
  if (name.length > 60) throw new AppError('A lista neve legfeljebb 60 betű lehet.', 400);
  return name;
}

// The caller's own list - 404 for anyone else's, as if it weren't there.
async function ownList(req) {
  const { id } = req.params;
  const list = mongoose.isValidObjectId(id)
    ? await SongList.findOne({ _id: id, owner: req.user._id })
    : null;
  if (!list) throw new AppError('Nincs ilyen lista.', 404);
  return list;
}

// The songs a list is to hold, as sent: ids of songs that exist, each once,
// in the order given.
async function songsOf(body) {
  if (!Array.isArray(body.songs)) throw new AppError('A dalok listája hibás.', 400);
  const ids = [...new Set(body.songs.map(String))];
  if (ids.length > MAX_SONGS) throw new AppError('Túl sok dal egy listában.', 400);
  if (!ids.every((id) => mongoose.isValidObjectId(id))) {
    throw new AppError('A dalok listája hibás.', 400);
  }
  const known = new Set(
    (await Song.find({ _id: { $in: ids } }).select('_id')).map((s) => `${s._id}`),
  );
  // A song deleted since the list was last read is quietly left out.
  return ids.filter((id) => known.has(id));
}

// A user's lists as they are sent, by name (the songbook's offline copy
// carries them too - songController.js's getOfflineBook).
export async function listsOf(user) {
  const lists = await SongList.find({ owner: user._id });
  lists.sort((a, b) => byHungarian.compare(a.name, b.name));
  return lists.map(view);
}

// GET /songs/lists - the caller's lists, by name.
export const getSongLists = async (req, res) => {
  res.status(200).json({ status: 'success', data: { lists: await listsOf(req.user) } });
};

// POST /songs/lists - a new, empty list (or with songs, if sent).
export const createSongList = async (req, res) => {
  if ((await SongList.countDocuments({ owner: req.user._id })) >= MAX_LISTS) {
    throw new AppError('Túl sok listád van - előbb törölj egyet.', 400);
  }
  const list = await SongList.create({
    owner: req.user._id,
    name: nameOf(req.body),
    songs: req.body.songs === undefined ? [] : await songsOf(req.body),
  });
  res.status(201).json({ status: 'success', data: { list: view(list) } });
};

// PATCH /songs/lists/:id - a new name, or the songs anew: the whole list
// in its order (adding a song, taking one out and reordering are all this).
export const updateSongList = async (req, res) => {
  const list = await ownList(req);
  if (req.body.name !== undefined) list.name = nameOf(req.body);
  if (req.body.songs !== undefined) list.songs = await songsOf(req.body);
  await list.save();
  res.status(200).json({ status: 'success', data: { list: view(list) } });
};

// DELETE /songs/lists/:id - the list goes; its songs stay in the songbook.
export const deleteSongList = async (req, res) => {
  const list = await ownList(req);
  await list.deleteOne();
  res.status(204).send();
};
