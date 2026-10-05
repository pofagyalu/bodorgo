// How the quiet playlist's (hatter) songs come out: "artist — title", as the
// app shows them (music/jellyfin.js titleAndArtist). Read-only.
//   node --env-file=.env scripts/hatterTitles.mjs
import { PLAYLISTS, titleAndArtist } from '../src/music/jellyfin.js';

const base = process.env.JELLYFIN_URL.replace(/\/+$/, '');
const headers = { Authorization: `MediaBrowser Token="${process.env.JELLYFIN_API_KEY}"` };
const get = async (path) => (await fetch(`${base}${path}`, { headers })).json();

const userId = process.env.JELLYFIN_USER_ID || (await get('/Users'))[0].Id;
const { Items } = await get(
  `/Playlists/${process.env.JELLYFIN_HATTER_PLAYLIST_ID}/Items?userId=${userId}&fields=Artists,AlbumArtist`,
);
for (const item of Items) {
  const { title, artist } = titleAndArtist(item, PLAYLISTS.hatter.collections);
  console.log(`${artist} — ${title}`);
}
process.exit(0);
