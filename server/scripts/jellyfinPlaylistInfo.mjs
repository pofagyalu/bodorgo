// What a Jellyfin playlist is: its name, how many tracks, the genres and a
// few of the songs. Read-only.
//   node --env-file=.env scripts/jellyfinPlaylistInfo.mjs <playlistId>
const [id] = process.argv.slice(2);
const base = process.env.JELLYFIN_URL?.replace(/\/+$/, '');
const headers = { Authorization: `MediaBrowser Token="${process.env.JELLYFIN_API_KEY}"` };
if (!id || !base) throw new Error('usage: jellyfinPlaylistInfo.mjs <playlistId> (JELLYFIN_* set)');

const get = async (path) => {
  const res = await fetch(`${base}${path}`, { headers });
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.json();
};

const userId = process.env.JELLYFIN_USER_ID || (await get('/Users'))[0].Id;
const playlist = await get(`/Users/${userId}/Items/${id}`);
const { Items } = await get(
  `/Playlists/${id}/Items?userId=${userId}&fields=Genres,RunTimeTicks,AlbumArtist`,
);

const genres = {};
for (const i of Items) for (const g of i.Genres ?? []) genres[g] = (genres[g] ?? 0) + 1;
const minutes = Math.round(Items.reduce((s, i) => s + (i.RunTimeTicks ?? 0), 0) / 600000000);

console.log(`${playlist.Name} (${playlist.Type}) - ${Items.length} tracks, ${minutes} min`);
console.log(
  'genres:',
  Object.entries(genres)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([g, n]) => `${g} ${n}`)
    .join(', '),
);
for (const i of Items.slice(0, 25)) console.log(` - ${i.AlbumArtist ?? '?'}: ${i.Name}`);
