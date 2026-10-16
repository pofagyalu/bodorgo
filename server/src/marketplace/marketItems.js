// Ócskapiac: how one item looks to one person, and the "Stipistopi!" hold.

export const HOLD_DAYS = 7;
const HOLD_MS = HOLD_DAYS * 24 * 60 * 60 * 1000;

const refId = (ref) => String(ref?._id ?? ref);

// The price as the page says it (client services/market.ts's priceLabel) -
// for the push about a new item.
const PRICE_WORDS = {
  ingyen: '🎁 Ingyen elvihető',
  joszo: '😊 Egy jó szó is elég',
  sor: '🍺 {n} sör',
  csoki: '🍫 {n} csoki',
  palinka: '🥃 {n} pálinka',
  kave: '☕ {n} kávé',
  lekvar: '🫙 {n} üveg lekvár',
  forint: '💰 {n} Ft',
};
export function priceLabel(price) {
  const words = PRICE_WORDS[price?.kind] ?? PRICE_WORDS.ingyen;
  return words.replace('{n}', (price?.amount ?? 0).toLocaleString('hu-HU'));
}

// Until when the stipistopi holds - null when nobody holds it (or the 7
// days are over: then it's free for anyone again).
export function holdUntil(item, now = Date.now()) {
  if (!item.reservedBy || !item.reservedAt || item.goneAt) return null;
  const until = item.reservedAt.getTime() + HOLD_MS;
  return until > now ? new Date(until) : null;
}

const person = (u) =>
  u && {
    _id: refId(u),
    name: u.name ?? '',
    username: u.username ?? '',
    photoUpdatedAt: u.photoUpdatedAt ?? null,
  };

export const ITEM_POPULATE = [
  { path: 'owner', select: 'name username photoUpdatedAt' },
  { path: 'reservedBy', select: 'name username' },
  { path: 'wanted.user', select: 'name username' },
  { path: 'notes.user', select: 'name username' },
];

// status: 'available' | 'reserved' (someone's stipistopi holds) | 'gone'.
export function itemView(item, viewer, now = Date.now()) {
  const me = refId(viewer);
  const until = holdUntil(item, now);
  const status = item.goneAt ? 'gone' : until ? 'reserved' : 'available';
  return {
    _id: refId(item),
    title: item.title,
    description: item.description,
    category: item.category,
    price: { kind: item.price?.kind ?? 'ingyen', amount: item.price?.amount ?? null },
    owner: person(item.owner),
    photos: item.photos.map((p) => ({ _id: refId(p), width: p.width, height: p.height })),
    status,
    reservedBy: until ? person(item.reservedBy) : null,
    reservedUntil: until,
    wanted: item.wanted.filter((w) => w.user).map((w) => ({ user: person(w.user), at: w.at })),
    notes: item.notes
      .filter((n) => n.user)
      .map((n) => ({ _id: refId(n), user: person(n.user), text: n.text, createdAt: n.createdAt })),
    mine: refId(item.owner) === me,
    iWant: item.wanted.some((w) => refId(w.user) === me),
    iReserved: !!until && refId(item.reservedBy) === me,
    createdAt: item.createdAt,
    goneAt: item.goneAt,
  };
}
