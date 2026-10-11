// OpenStreetMap's map tiles, fetched by the server itself - for the map a
// recorded hike is drawn on (utils/trackMap.js). The pages' own maps get
// theirs in the browser; this is the only place the server asks for any.
// Their usage policy (operations.osmfoundation.org/policies/tiles): say
// who is asking, ask for little, keep what was given - a hike's map is a
// couple of dozen tiles, made once and kept on disk.

const TILE_URL = 'https://tile.openstreetmap.org';
const USER_AGENT = 'Bodorgo/1.0 (+https://bodorgo.hu; a hiking club, a few tiles per hike)';
const TIMEOUT_MS = 15000;

// One 256 px tile, as a PNG buffer. Throws when it can't be had.
export async function fetchMapTile(z, x, y) {
  const res = await fetch(`${TILE_URL}/${z}/${x}/${y}.png`, {
    headers: { 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`map tile ${z}/${x}/${y}: HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}
