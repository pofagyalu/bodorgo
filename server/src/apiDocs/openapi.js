// The API's OpenAPI 3.1 description - shown at /docs (admins only, see
// apiDocs/docsRouter.js) with Scalar. tests/api/apiDocs.test.js checks
// that every route in src/routes/ is described here and nothing else, so
// a new endpoint needs its entry below.
//
// op() keeps each entry short: who may call it (a badge + the security
// requirement), the path/query/body parameters, the success answer and
// the usual error answers.

// --- Building blocks ---

const ROLE = {
  public: { badge: 'Nyilvános', color: '#7a858b', text: 'No login needed.' },
  user: {
    badge: 'Bejelentkezve',
    color: '#1e88e5',
    text: 'Any logged-in user (guest, member, admin).',
  },
  member: { badge: 'Tag', color: '#1a796c', text: 'Club members and admins (not guests).' },
  admin: { badge: 'Admin', color: '#b5533a', text: 'Admins only.' },
};

const ref = (name) => ({ $ref: `#/components/schemas/${name}` });
const arrayOf = (items) => ({ type: 'array', items });
const obj = (properties, required) => ({
  type: 'object',
  properties,
  ...(required && { required }),
});
const str = (description, extra = {}) => ({ type: 'string', description, ...extra });
const int = (description, extra = {}) => ({ type: 'integer', description, ...extra });
const num = (description, extra = {}) => ({ type: 'number', description, ...extra });
const bool = (description) => ({ type: 'boolean', description });
const id = (description = 'MongoDB ObjectId') => str(description, { pattern: '^[0-9a-f]{24}$' });
const date = (description) => str(description, { format: 'date-time' });

// The { status: 'success', data } envelope every JSON answer comes in.
const envelope = (data) =>
  obj({ status: { type: 'string', const: 'success' }, data }, ['status', 'data']);

const path = (name, description) => ({
  name,
  in: 'path',
  required: true,
  description,
  schema: { type: 'string' },
});
const query = (name, description, schema = { type: 'string' }) => ({
  name,
  in: 'query',
  description,
  schema,
});

const ERRORS = {
  400: 'Hibás kérés - a `message` mondja meg, mi a gond (magyarul, a felhasználónak szól).',
  401: 'Nincs bejelentkezve.',
  403: 'Nincs jogosultsága.',
  404: 'Nincs ilyen elem.',
  409: 'Ütközés (pl. véglegesített szobabeosztás).',
  429: 'Túl sok (pl. a napi fotókorlát elfogyott).',
  502: 'A fizetési szolgáltató (Barion/Stripe) nem válaszolt jól.',
};
const errorResponse = (code) => ({
  description: ERRORS[code],
  content: { 'application/json': { schema: ref('Error') } },
});

// A file answer: its media type(s), no JSON envelope.
const file = (types, description) => ({
  description,
  content: Object.fromEntries(
    types.map((t) => [t, { schema: { type: 'string', format: 'binary' } }]),
  ),
});

function op({
  tag,
  summary,
  description,
  role = 'user',
  params = [],
  body,
  multipart,
  ok = 200,
  data,
  response,
  errors = [],
}) {
  const r = ROLE[role];
  const responses = {};
  if (response) responses[ok] = response;
  else if (ok === 204) responses[204] = { description: 'Kész - nincs tartalom.' };
  else
    responses[ok] = {
      description: 'Siker',
      content: { 'application/json': { schema: envelope(data ?? { type: 'object' }) } },
    };
  const codes = new Set(errors);
  if (role !== 'public') codes.add(401);
  if (role === 'member' || role === 'admin') codes.add(403);
  for (const code of [...codes].sort()) responses[code] = errorResponse(code);

  return {
    tags: [tag],
    summary,
    description: [description, `**Ki hívhatja:** ${r.text}`].filter(Boolean).join('\n\n'),
    'x-badges': [{ name: r.badge, position: 'before', color: r.color }],
    ...(role === 'public' && { security: [] }),
    ...(params.length && { parameters: params }),
    ...(body && {
      requestBody: {
        required: true,
        content: { 'application/json': { schema: body } },
      },
    }),
    ...(multipart && {
      requestBody: {
        required: true,
        content: { 'multipart/form-data': { schema: multipart } },
      },
    }),
    responses,
  };
}

// --- Shared parameters ---

const tourId = path('id', 'The tour id.');
const tourIdT = path('tourId', 'The tour id.');
const musicKey = path('key', '`bodorgo-fm` (everyone) or `buli` (members only).');
const chatRoomIdP = path('chatRoomId', 'The chat room id (the general one, or a tour’s).');
// ?w= on a photo: a smaller version for the viewer (photos/imageSizes.js).
const sizeW = query('w', 'Width: `800`, `1200` or `1920`. Omit for the original.', {
  type: 'integer',
  enum: [800, 1200, 1920],
});
const userIdP = path('id', 'The user id.');

// --- Schemas ---

const schemas = {
  Error: obj(
    {
      status: str('`fail` (4xx) or `error` (5xx).', { enum: ['fail', 'error'] }),
      message: str('Human-readable, usually Hungarian - shown to the user as is.'),
    },
    ['status', 'message'],
  ),

  Tour: obj({
    _id: id(),
    order: int('Sorszám - the tour number (1, 2, … 32).'),
    title: str('Name, e.g. "Tátrai ősz".'),
    slug: str('URL-friendly name.'),
    startDate: date('First day.'),
    duration: int('Days.'),
    maxCapacity: int('Maximum number of attendees.'),
    location: obj({
      type: { type: 'string', const: 'Point' },
      coordinates: arrayOf(num('[longitude, latitude]')),
      address: str('Address of the accommodation.'),
      description: str('Place name.'),
    }),
    distanceFromBudapestKm: num('Driving distance.'),
    drivingDurationFromBudapestMinutes: num('Driving time.'),
    pricingMode: str('How the accommodation is priced.', { enum: ['perHouse', 'perPerson'] }),
    accommodationPricePerNight: num('Price per night.'),
    accommodationCurrency: str(
      'Currency of the accommodation prices - and of the attendee list and Excel amounts (not the HUF advance).',
      { enum: ['HUF', 'EUR'] },
    ),
    childPricePerNight: num('Child price per night.'),
    childAgeLimitYears: int('Below this age the child price applies.'),
    advancePaymentPercentage: num('Előleg - the share paid in advance (0-100).'),
    clubSubsidyAmount: num('Klubtámogatás - per person.'),
    ratingsAverage: num('Average rating (1-10).'),
    ratingsQuantity: int('Number of ratings.'),
    summary: str('Short description.'),
    description: str('Long description.'),
    schedule: arrayOf(ref('ScheduleEvent')),
    accommodation: obj({
      houses: arrayOf(ref('House')),
      finalized: bool('Szobabeosztás véglegesítve.'),
    }),
    dailyWeather: arrayOf({ type: 'object', description: 'Forecast per day (Open-Meteo).' }),
    extraDocuments: arrayOf(ref('TourDocument')),
    coverUpdatedAt: date('When the cover was uploaded - the cover URL carries it (`?v=`).'),
    secretTour: bool('Titkos túra - its details are hidden until it starts.'),
    createdAt: date(),
    updatedAt: date(),
  }),

  ScheduleEvent: obj({
    _id: id(),
    day: int('Which day of the tour (1-based).'),
    time: str('e.g. "09:00".'),
    description: str('What happens.'),
    isOptional: bool('People opt in (e.g. an extra breakfast).'),
    extraCost: num('Extra cost for an optional event.'),
    participants: arrayOf(id('User id')),
  }),

  House: obj({
    _id: id(),
    name: str('House name.'),
    rooms: arrayOf(obj({ _id: id(), name: str('Room name.'), beds: int('Beds.') })),
  }),

  // A tour's Extrák document as the tour page gets it (a Document - see
  // Dokumentumok; the file is at `/documents/{_id}/file`).
  TourDocument: obj({
    _id: id(),
    title: str('Shown on the card.'),
    filename: str('On disk.'),
    mimeType: str('Type.', { enum: ['application/pdf', 'image/jpeg', 'image/png'] }),
  }),

  User: obj({
    _id: id(),
    name: str('Full name (from Authentik).'),
    username: str('For @mentions in Kotyogó.'),
    email: str('E-mail.', { format: 'email' }),
    role: str('Role - managed in the app; only the role manager changes it.', {
      enum: ['admin', 'member', 'guest'],
    }),
    canManageRoles: bool(
      'The role manager (INITIAL_ADMIN_USER) - read-only, set by the server at start.',
    ),
    familyId: id('Users sharing it are one family (they can sign up / pay for each other).'),
    birthday: date(),
    age: int('Computed from birthday.'),
    gender: str('Admins only.', { enum: ['férfi', 'nő'] }),
    memberSince: int('Year the membership started.'),
    weightKg: num(
      'Súly (kg, one decimal) - admins only: only in GET/PATCH /users/{id} and POST /users; empty clears it.',
    ),
    weightUpdatedAt: date('When the weight last changed - set by the server, admins only.'),
    lastLoginAt: date(),
    photoUpdatedAt: date('Profile photo version - `/users/{id}/photo?v=`.'),
    retired: bool('Archived ("deleted") user.'),
    wantsEmailNotifications: bool('Gets e-mails from the app.'),
    address: obj({ zipCode: str(), city: str(), street: str(), country: str() }),
  }),

  Reservation: obj({
    _id: id(),
    tour: id('Tour id.'),
    bookedBy: id('Who made the sign-up.'),
    attendees: arrayOf(
      obj({
        _id: id('Attendee id (used in the attendee routes).'),
        user: id('User id.'),
        nights: int('Billed nights.'),
        feeExempt: bool('Owes nothing.'),
        paid: bool('Advance paid.'),
      }),
    ),
    createdAt: date(),
  }),

  Cancellation: obj({
    _id: id(),
    tour: id(),
    user: id(),
    name: str('Who was taken off.'),
    bookedByName: str(),
    cancelledByName: str('Who did it.'),
    reason: str(),
    wasPaid: bool('Their advance had been paid.'),
    cancelledAt: date(),
  }),

  Payment: obj({
    _id: id(),
    purpose: str('What it pays.', { enum: ['tourAdvance', 'membershipFee'] }),
    method: str('How.', { enum: ['stripe', 'barion', 'cash'] }),
    tour: id(),
    amount: num('Amount.'),
    currency: str(),
    status: str('Gateway status.', {
      enum: ['Prepared', 'Started', 'Succeeded', 'Failed', 'Canceled', 'Expired'],
    }),
    membershipYear: int('For dues.'),
    createdAt: date(),
  }),

  Transaction: obj({
    _id: id(),
    date: date(),
    name: str('Description.'),
    type: str('Income or expense.', { enum: ['income', 'expense'] }),
    category: str('e.g. "Tagdíj".'),
    amount: num('Positive.'),
    currency: str('Currency.', { enum: ['HUF', 'EUR'] }),
    membershipYear: int('For Tagdíj income.'),
    paymentMethod: str('For payments.', { enum: ['barion', 'stripe', 'cash'] }),
  }),

  DartsThrow: obj(
    {
      segment: int('1-20, 25 (the bull), or 0: a miss.'),
      multiplier: int('1-3 (the bull: 1 or 2 - the bullseye); 0 with a miss.'),
    },
    ['segment', 'multiplier'],
  ),

  DartsGame: obj({
    _id: id(),
    type: str('', { enum: ['x01', 'cricket'] }),
    ended: bool('The players ended it themselves, before the rules did.'),
    options: obj({
      startScore: int('', { enum: [301, 201, 101] }),
      outMode: str('', { enum: ['single', 'double'] }),
      playUntil: str('', { enum: ['winner', 'top3', 'all'] }),
    }),
    status: str('', { enum: ['in_progress', 'finished', 'abandoned'] }),
    createdBy: obj({ _id: id(), name: str() }),
    createdAt: date(),
    finishedAt: { type: ['string', 'null'] },
    players: arrayOf(
      obj({
        idx: int('Place in the throwing order (from 0).'),
        userId: { type: ['string', 'null'], description: 'Null for a guest.' },
        name: str(),
        photoUpdatedAt: { type: ['string', 'null'] },
        remaining: int('X01 only.'),
        marks: {
          type: 'object',
          description:
            'Cricket only: the hits on 15-20 and 25 (the bull), at most 3 each - three close it.',
        },
        darts: int('Darts thrown.'),
        points: int('Points scored (busts score nothing).'),
        average: {
          type: ['number', 'null'],
          description: 'Per three darts: points in X01, marks in Cricket.',
        },
        highestTurn: int(),
        position: {
          type: ['integer', 'null'],
          description: 'Once finished - and for everyone once the game is over.',
        },
        positionFinal: bool(
          'False while someone still to throw in that round could take the place (same round: fewer darts in the last turn wins).',
        ),
      }),
    ),
    placings: arrayOf(int('Player idx, best first.')),
    canEdit: bool('I may throw, undo and correct in it.'),
    turns: {
      description: 'Only on a single game, not in the list.',
      ...arrayOf(
        obj({
          playerIdx: int(),
          round: int(),
          throws: arrayOf(ref('DartsThrow')),
          startScore: int('What the player had left before it.'),
          points: int(),
          marks: int('Cricket only: the hits that closed or scored.'),
          bust: bool(),
          finished: bool(),
          short: bool('Fewer than three darts without ending - left so by a correction.'),
          editedAt: { type: ['string', 'null'] },
          previousThrows: { type: ['array', 'null'], items: ref('DartsThrow') },
        }),
      ),
    },
    next: {
      description: 'Who throws next (single game only) - null once it is over.',
      type: ['object', 'null'],
      properties: {
        playerIdx: int(),
        round: int(),
        dartsLeft: int(),
        checkout: {
          type: ['array', 'null'],
          items: ref('DartsThrow'),
          description: 'The way to finish with the darts left in this turn, if there is one.',
        },
      },
    },
  }),

  Poll: obj({
    _id: id(),
    tour: {
      description: 'The tour (id, title, order) - null for a general poll.',
      type: ['object', 'null'],
    },
    question: str(),
    details: str(
      'Részletek - optional formatted text under the question (bold, colors, lists, links; cleaned like a mailing).',
    ),
    options: arrayOf(
      obj({ _id: id(), text: str(), count: int('Votes (open polls, or after close).') }),
    ),
    closesAt: date(),
    closed: bool(),
    visibility: str('Open: who voted what is visible; secret: only counts.', {
      enum: ['open', 'secret'],
    }),
    minimum: obj({ option: id(), count: int('At least this many for that answer.') }),
    awaitsMyVote: bool(
      'Rád vár: open, not voted yet, and mine to vote on (my tour’s, or a general poll) - what the Voks badge counts.',
    ),
    myVote: id('My chosen option, if any.'),
    createdBy: { type: 'object' },
  }),

  ChatRoom: obj({
    _id: id(),
    type: str('`general` - the club-wide room; `tour` - a tour’s own.', {
      enum: ['general', 'tour'],
    }),
    tourId: { type: ['string', 'null'], description: 'The tour - null for the general room.' },
  }),
  Post: obj({
    _id: id(),
    chatRoomId: id('The chat room it was written in.'),
    creator: obj({ _id: id(), name: str(), username: str() }),
    text: str('Message text (may be empty with a photo).'),
    image: obj({
      width: int(),
      height: int(),
      size: int('Bytes.'),
      expired: bool('Removed by the size quota.'),
    }),
    poll: id('A poll card instead of text.'),
    reactions: arrayOf(
      obj({ user: obj({ _id: id(), name: str() }), emoji: str('One of 👍 😂 😮 😢 😭.') }),
    ),
    editedAt: date(),
    deletedAt: date('Deleted: shown as "Hozzászólás törölve".'),
    createdAt: date(),
  }),

  Document: obj({
    _id: id(),
    name: str('Shown on the card.'),
    filename: str('On disk - the file itself is at `/documents/{id}/file`.'),
    mimeType: str('From the file.', { enum: ['application/pdf', 'image/jpeg', 'image/png'] }),
    tour: {
      type: ['string', 'null'],
      description: 'A tour’s Extrák document; null for a club document.',
    },
    category: str('Club documents only.', {
      enum: [
        'Alapdokumentumok',
        'Éves hivatalos dokumentumok',
        '1%-os felajánlások',
        'Számlák',
        'Egyéb',
      ],
    }),
    year: int('For yearly club documents.'),
    preview: bool('A first-page picture exists (`/documents/{id}/preview`) - club documents only.'),
    createdAt: date(),
  }),

  BirthdaySettings: obj(
    {
      enabled: bool('Greet people on their birthday.'),
      effect: str(
        'Konfetti eső, Tűzijáték, Oldalsó ágyúk, Csillagszórás, Lassú konfetti, Emoji eső.',
        {
          enum: ['confetti', 'fireworks', 'cannons', 'stars', 'snow', 'emoji'],
        },
      ),
      message: str('At most 200 characters; {név} = the given name.'),
    },
    ['enabled', 'effect', 'message'],
  ),
  BarionWallet: obj({
    payeeEmail: str('Barion wallet e-mail - payments land here.'),
    withdrawName: str('Account holder.'),
    withdrawIban: str('Hungarian IBAN, in groups of four.'),
  }),
};

// --- Descriptions shown on the start page ---

const DESCRIPTION = `The HTTP API behind the Bódorgó club app (bodorgo.hu) - tours, sign-ups and
payments, the Kotyogó chat, Voks polls, photos and videos, the club's documents and
settings.

## Logging in

The app logs in through Authentik (OpenID Connect): \`GET /auth/login\` starts it and
the server keeps a **session cookie** (\`connect.sid\`, HTTP-only). Every other call sends
that cookie - a browser does it by itself, so the **Try it** button here works with your
own login. There are no API keys for users.

Authentik is only the **identity provider** - it says who someone is, nothing about their
role. Only people an admin has already added in the app (Klub → Felhasználók, with their
e-mail) can log in; anyone else is refused. The one exception is the \`INITIAL_ADMIN_USER\`
(see below), so a fresh installation can be entered.

## Roles

Each user has one role, **managed in the app** - Authentik's groups don't matter:

| Role | Badge | Who |
|---|---|---|
| \`guest\` | Bejelentkezve | Logged-in non-members (e.g. family members) |
| \`member\` | Tag | Club members |
| \`admin\` | Admin | Club admins |

Each endpoint's badge shows the lowest role that may call it (an admin can call everything).

**Only one admin may change roles** - the *role manager*: whoever \`INITIAL_ADMIN_USER\` in
the server's \`.env\` names (\`canManageRoles\` on their user). At every server start that
person gets the flag and the admin role, and nobody else keeps the flag - so handing the app
over is changing that one line and restarting. Other admins can add people (as \`guest\`)
and edit everything else about them.

## Answers

JSON answers come as \`{ "status": "success", "data": { … } }\`. Errors as
\`{ "status": "fail" | "error", "message": "…" }\` - the message is Hungarian and meant for
the user. Files (photos, PDFs, videos, Excel) come as they are; videos support
\`Range\` requests.

## Kotyogó and live updates (Socket.IO)

The chat and the Szobabeosztás board are live over **Socket.IO** on the same origin, with
the same session cookie.

Every message belongs to a **chat room** - the one general room, or a tour's own room
(\`GET /chat-rooms/general\`, \`GET /tours/{tourId}/chat-room\`); the room's \`_id\` is what
the chat events use. A tour's Szobabeosztás is its own channel (\`join-tour\`).

| Direction | Event | Payload |
|---|---|---|
| → server | \`join-chat\` | \`{ chatRoomId }\` - open a chat room; answered by \`initial-posts\` |
| → server | \`leave-chat\` | \`{ chatRoomId }\` |
| → server | \`chat-visible\` | \`{ chatRoomId, visible }\` - no push while you look at it |
| → server | \`create-post\` | \`{ chatRoomId, text }\` |
| → server | \`join-tour\` / \`leave-tour\` | \`{ tourId }\` - the tour's Szobabeosztás updates |
| → server | \`edit-post\` / \`delete-post\` | \`{ postId, text }\` / \`{ postId }\` - own messages |
| → server | \`react-post\` | \`{ postId, emoji }\` - 👍 😂 😮 😢 😭, others' messages; the same again takes it back |
| ← client | \`initial-posts\` | \`{ chatRoomId, posts }\` |
| ← client | \`new-post\` / \`post-updated\` | a Post |
| ← client | \`poll-updated\` | a poll in the open chat changed (votes, closed) |
| ← client | \`rooms-changed\` | the tour's room board changed - reload it |
| ← client | \`chat-error\` | a message |

Photos are uploaded over HTTP (\`POST /chat-rooms/{chatRoomId}/images\`) and then announced
as \`new-post\`.`;

// --- The endpoints, by area ---

const T = {
  auth: 'Bejelentkezés',
  tours: 'Táborok',
  signup: 'Jelentkezés és résztvevők',
  schedule: 'Program',
  rooms: 'Szállás és szobabeosztás',
  tourFiles: 'Tábor fájlok',
  gallery: 'Tábor fotók és videók',
  mailing: 'Levél a résztvevőknek',
  chat: 'Kotyogó',
  polls: 'Voks',
  payments: 'Fizetés',
  finance: 'Pénzügyek',
  users: 'Felhasználók',
  documents: 'Dokumentumok',
  media: 'Média',
  music: 'Zene',
  games: 'Móka',
  settings: 'Beállítások',
  push: 'Értesítések',
  system: 'Rendszer',
};

const tags = [
  [T.auth, 'Login and logout through Authentik (OpenID Connect).'],
  [T.tours, 'The tours themselves.'],
  [T.signup, 'Signing up, the attendees, Lemondás (withdrawing), ratings.'],
  [T.schedule, "A tour's daily program and the optional events people opt into."],
  [T.rooms, 'Houses and rooms, and who sleeps where (Szobabeosztás).'],
  [
    T.tourFiles,
    'Cover picture, the Programfüzet PDF, the beszámoló, the attendee Excel. (Extrák documents: see Dokumentumok.)',
  ],
  [T.gallery, "A tour's photos (from the NAS) and its recap videos."],
  [T.mailing, 'Admins writing to all attendees of a tour.'],
  [
    T.chat,
    'The chat rooms - the general one and one per tour. Messages go over Socket.IO (see the introduction); photos over HTTP.',
  ],
  [T.polls, "Polls - club-wide on the Voks page, or started in a tour's Kotyogó."],
  [
    T.payments,
    'Tour advances and membership dues - Barion or Stripe, and cash recorded by admins; withdrawing from the Barion wallets.',
  ],
  [T.finance, "The club's open-book income and expenses."],
  [T.users, 'People, families, profile photos, usernames.'],
  [T.documents, "Klub → Dokumentumok and every tour's Extrák - one mechanism for both."],
  [T.media, "Média → Videók and Fotók - the club's own videos and photo folders on the NAS."],
  [
    T.music,
    'The music: Jellyfin playlists (Bódorgó FM for everyone, Buli rádió for members), streamed through this server - the Jellyfin key never reaches the browser.',
  ],
  [
    T.games,
    'Móka: the games - Darts so far. While they are being built, every call here is refused (403) for everyone but the role manager (`INITIAL_ADMIN_USER`).',
  ],
  [
    T.settings,
    'Klub → Beállítások: membership fees, reminders, Kotyogó photos, Barion wallets, the birthday greeting.',
  ],
  [T.push, 'Phone/browser notifications and per-chat muting.'],
  [T.system, 'Health check.'],
].map(([name, description]) => ({ name, description }));

const paths = {
  // --- Bejelentkezés ---
  '/auth/login': {
    get: op({
      tag: T.auth,
      role: 'public',
      summary: 'Start login',
      description: 'Redirects to Authentik; comes back to `/auth/callback`.',
      response: { description: 'Redirect to Authentik.' },
      ok: 302,
    }),
  },
  '/auth/callback': {
    get: op({
      tag: T.auth,
      role: 'public',
      summary: 'Login callback',
      description:
        'Authentik returns here. Finds the user an admin added (by Authentik id, or at the first login by e-mail, any case) and refreshes their name and e-mail - never their role - then starts the session and redirects to the app. Someone not added is sent back with `login?error=not-invited`; the `INITIAL_ADMIN_USER` is created as the role-managing admin if they have no account yet.',
      response: { description: 'Redirect to the app.' },
      ok: 302,
    }),
  },
  '/auth/logout': {
    get: op({
      tag: T.auth,
      role: 'public',
      summary: 'Log out',
      description: 'Ends the session, and the Authentik one too.',
      response: { description: 'Redirect.' },
      ok: 302,
    }),
  },
  '/auth/me': {
    get: op({
      tag: T.auth,
      role: 'public',
      summary: 'Who am I',
      description:
        'The logged-in user of this session (read fresh from the database) - the app asks it on start. Not in the usual envelope.',
      response: {
        description: 'Logged in or not.',
        content: {
          'application/json': {
            schema: obj(
              {
                loggedIn: bool(),
                canManageRoles: bool('I am the role manager.'),
                id: id(),
                name: str(),
                email: str(),
                role: str('', { enum: ['admin', 'member', 'guest'] }),
                familyId: id(),
                photoUpdatedAt: { type: ['string', 'null'] },
              },
              ['loggedIn'],
            ),
          },
        },
      },
    }),
  },

  // --- Táborok ---
  '/tours/ticker': {
    get: op({
      tag: T.tours,
      role: 'public',
      summary: 'The landing page ticker',
      description:
        'The only tour data a logged-out visitor gets: the next tour that has not ended ("Következő"), or the latest one ("Legutóbbi").',
    }),
  },
  '/tours': {
    get: op({
      tag: T.tours,
      summary: 'All tours',
      description:
        'With attendee counts. Supports filtering/sorting/paging with query parameters (`sort`, `fields`, `page`, `limit`, `field[gte]=`…).',
      params: [
        query('sort', 'e.g. `-startDate`'),
        query('fields', 'Only these fields, comma-separated.'),
        query('page', 'Page number.', { type: 'integer' }),
        query('limit', 'Page size.', { type: 'integer' }),
      ],
      data: obj({ tours: arrayOf(ref('Tour')) }),
    }),
    post: op({
      tag: T.tours,
      role: 'admin',
      summary: 'Create a tour',
      description:
        '`order` (the tour number) is required and must be unused. The cover comes separately (`POST /tours/{id}/cover`).',
      body: ref('Tour'),
      ok: 201,
      data: obj({ tour: ref('Tour') }),
      errors: [400],
    }),
  },
  '/tours/last-3': {
    get: op({
      tag: T.tours,
      summary: 'The latest three tours',
      data: obj({ tours: arrayOf(ref('Tour')) }),
    }),
  },
  '/tours/years': {
    get: op({
      tag: T.tours,
      summary: 'The years that had a tour',
      description:
        "Every year with a tour (by its first day), oldest first - the Táborok page's year filter lists them without loading every tour (a year's own tours: GET /tours with startDate.gte and startDate.lt).",
      data: obj({ years: arrayOf(int('A year, e.g. 2024')) }),
    }),
  },
  '/tours/tour-stats': {
    get: op({
      tag: T.tours,
      summary: 'Tour statistics',
      description:
        "Counts and averages for the homepage. `attendeeAges` feeds the age chart: `tours` is each tour's average attendee age (their age on the tour's first day; only attendees with a birthday on file - `count` is how many of the `total`; `minAge`-`maxAge` the range of those ages), `years` the yearly average over every such attendance of that year, so a tour weighs in by its `count`. Tours and years with no known age are left out; both lists are in time order.",
      data: obj({
        totalTours: int('Tours that have already ended.'),
        upcomingTours: int('Tours still ahead.'),
        totalParticipants: int('Attendances over every tour.'),
        genderRatio: obj({ malePercentage: int('0-100'), femalePercentage: int('0-100') }),
        attendeeAges: obj({
          tours: arrayOf(
            obj({
              title: str('Tour title'),
              order: int('Tour number'),
              slug: str('Tour slug'),
              year: int("Year of the tour's first day"),
              averageAge: num('Average age, one decimal (a baby not yet one counts as 1)'),
              count: int('Attendees with a known age'),
              total: int('Every attendee, known age or not'),
              minAge: int('The youngest known age'),
              maxAge: int('The oldest known age'),
            }),
          ),
          years: arrayOf(
            obj({
              year: int('Year'),
              averageAge: num('Average age over the attendances of the year, one decimal'),
              count: int('Attendances with a known age'),
              total: int('Every attendance of the tours counted in'),
              minAge: int('The youngest known age'),
              maxAge: int('The oldest known age'),
            }),
          ),
        }),
        mostAttendedTour: { type: 'object' },
        bestRatedTour: { type: 'object' },
      }),
    }),
  },
  '/tours/montly-plan/{year}': {
    get: op({
      tag: T.tours,
      summary: 'Tours of a year, by month',
      params: [path('year', 'e.g. 2026')],
    }),
  },
  '/tours/{id}': {
    get: op({
      tag: T.tours,
      summary: 'One tour',
      description:
        "Everything the tour page shows - schedule, accommodation, weather, Extrák, attendees with their payment rows. Payment rows' `totalPrice`/`rest` are in the tour's `accommodationCurrency` (EUR: whole euros, rounded up); `advance` is always the HUF paid to the club, `advanceInCurrency` the same advance in the tour's currency. A EUR tour gets no club subsidy.",
      params: [tourId],
      data: obj({ tour: ref('Tour') }),
      errors: [404],
    }),
    patch: op({
      tag: T.tours,
      role: 'admin',
      summary: 'Update a tour',
      description:
        'Any tour fields. Setting the advance to exactly 0 marks every attendee paid. `onSitePayment` (Fizetési módok - how the rest is paid at the house): `{ cash, card, szep }` (szep: SZÉP kártya). Shown to attendees on the attendee list (the Fizetendő column) and in the Programfüzet.',
      params: [tourId],
      body: ref('Tour'),
      data: obj({ tour: ref('Tour') }),
      errors: [400, 404],
    }),
    delete: op({
      tag: T.tours,
      role: 'admin',
      summary: 'Delete a tour',
      params: [tourId],
      ok: 204,
      errors: [404],
    }),
  },

  // --- Jelentkezés és résztvevők ---
  '/tours/{tourId}/signup': {
    post: op({
      tag: T.signup,
      summary: 'Sign up for a tour',
      description:
        'One reservation for one or more people. A member may sign up themselves and their family, a guest only themselves, an admin anyone. Closes when the tour starts (except for admins); refused when full, or for a retired person (by anyone, admins too - restore them first). E-mails the registrant and those registered.',
      params: [tourIdT],
      body: obj({ attendeeIds: arrayOf(id('User ids to sign up.')) }, ['attendeeIds']),
      ok: 201,
      data: obj({ reservation: ref('Reservation') }),
      errors: [400, 403, 404],
    }),
  },
  '/tours/{tourId}/reservations/{reservationId}/attendees/{attendeeId}': {
    delete: op({
      tag: T.signup,
      summary: 'Lemondás - take someone off the tour',
      description:
        'Whoever could sign them up may withdraw them. Their room and optional-program sign-ups are freed; a finalized Szobabeosztás becomes editable again. Recorded in Lemondások.',
      params: [
        tourIdT,
        path('reservationId', 'The reservation.'),
        path('attendeeId', 'The attendee in it.'),
      ],
      body: obj({ reason: str('Optional reason.') }),
      data: obj({
        cancellation: ref('Cancellation'),
        wasPaid: bool('Their advance had been paid - settle it by hand.'),
        roomsReopened: bool('The Szobabeosztás was un-finalized.'),
      }),
      errors: [403, 404],
    }),
  },
  '/tours/{tourId}/reservations/{reservationId}/attendees/{attendeeId}/nights': {
    patch: op({
      tag: T.signup,
      role: 'admin',
      summary: "Correct an attendee's nights",
      description: 'For someone who cannot stay the whole tour - their price follows.',
      params: [
        tourIdT,
        path('reservationId', 'The reservation.'),
        path('attendeeId', 'The attendee.'),
      ],
      body: obj({ nights: int('0 … the tour length.') }, ['nights']),
      data: obj({ attendee: { type: 'object' } }),
      errors: [400, 404],
    }),
  },
  '/tours/{tourId}/reservations/{reservationId}/attendees/{attendeeId}/fee-exempt': {
    patch: op({
      tag: T.signup,
      role: 'admin',
      summary: 'Mark an attendee as owing nothing',
      description: 'An infant, a comped guest… Also sets their paid flag to match.',
      params: [
        tourIdT,
        path('reservationId', 'The reservation.'),
        path('attendeeId', 'The attendee.'),
      ],
      body: obj({ feeExempt: bool('Exempt or not.') }, ['feeExempt']),
      data: obj({ attendee: { type: 'object' } }),
      errors: [400, 404],
    }),
  },
  '/tours/{tourId}/cancellations': {
    get: op({
      tag: T.signup,
      role: 'admin',
      summary: 'Lemondások - who was taken off',
      params: [tourIdT],
      data: obj({ cancellations: arrayOf(ref('Cancellation')) }),
    }),
  },
  '/tours/{tourId}/reviews': {
    put: op({
      tag: T.signup,
      summary: 'Rate a tour',
      description:
        'Attendees only, once the tour has ended. Sending again replaces the earlier rating.',
      params: [tourIdT],
      body: obj({ rating: int('1-10', { minimum: 1, maximum: 10 }) }, ['rating']),
      errors: [400, 403, 404],
    }),
  },
  '/tours/{tourId}/reviews/me': {
    get: op({
      tag: T.signup,
      summary: 'My rating of a tour',
      description: 'Whether I may rate it (an attendee, and it has ended) and my current rating.',
      params: [tourIdT],
      data: obj({ isAttendee: bool(), hasEnded: bool(), rating: { type: ['integer', 'null'] } }),
      errors: [404],
    }),
  },

  // --- Program ---
  '/tours/{tourId}/schedule': {
    post: op({
      tag: T.schedule,
      role: 'admin',
      summary: 'Add a program item',
      params: [tourIdT],
      body: obj(
        {
          day: int('Day of the tour.'),
          time: str('"09:00"'),
          description: str('What happens.'),
          isOptional: bool('People opt in.'),
          extraCost: num('For an optional item.'),
        },
        ['day', 'time', 'description'],
      ),
      ok: 201,
      data: obj({ event: ref('ScheduleEvent') }),
      errors: [400, 404],
    }),
  },
  '/tours/{tourId}/schedule/{eventId}': {
    patch: op({
      tag: T.schedule,
      role: 'admin',
      summary: 'Edit a program item',
      description: 'Time, description, optional, extra cost - not the day.',
      params: [tourIdT, path('eventId', 'The program item.')],
      body: obj({ time: str(), description: str(), isOptional: bool(), extraCost: num() }),
      data: obj({ event: ref('ScheduleEvent') }),
      errors: [404],
    }),
  },
  '/tours/{tourId}/schedule/{eventId}/participants': {
    patch: op({
      tag: T.schedule,
      summary: 'Who joins an optional program item',
      description:
        'Sets exactly who of the people I may speak for (myself, my family; an admin: anyone) is in.',
      params: [tourIdT, path('eventId', 'The program item.')],
      body: obj({ userIds: arrayOf(id()) }, ['userIds']),
      data: obj({ participants: arrayOf(id()) }),
      errors: [400, 403, 404],
    }),
  },

  // --- Szállás és szobabeosztás ---
  '/tours/{id}/accommodation': {
    put: op({
      tag: T.rooms,
      role: 'admin',
      summary: 'Set the houses and rooms',
      description:
        'Replaces the whole list. Existing houses/rooms keep their `_id` (so the room board survives a rename); anyone whose room disappears goes back to "no room".',
      params: [tourId],
      body: obj({ houses: arrayOf(ref('House')) }, ['houses']),
      data: obj({ accommodation: { type: 'object' } }),
      errors: [400, 404],
    }),
  },
  '/tours/{id}/rooms': {
    get: op({
      tag: T.rooms,
      summary: 'The room board',
      description:
        'Houses and rooms, every registered person with their room (or none), and whether it is finalized.',
      params: [tourId],
    }),
  },
  '/tours/{id}/rooms/assignment': {
    put: op({
      tag: T.rooms,
      role: 'admin',
      summary: 'Put someone in a room (or take them out)',
      description:
        'Refused while finalized, or if the room is full. Everyone on the board sees it live (`rooms-changed`).',
      params: [tourId],
      body: obj(
        {
          attendeeId: id('User id.'),
          roomId: { type: ['string', 'null'], description: 'null: no room.' },
        },
        ['attendeeId', 'roomId'],
      ),
      errors: [400, 404, 409],
    }),
  },
  '/tours/{id}/rooms/finalized': {
    put: op({
      tag: T.rooms,
      role: 'admin',
      summary: 'Finalize (or reopen) the room board',
      params: [tourId],
      body: obj({ finalized: bool() }, ['finalized']),
      data: obj({ finalized: bool() }),
    }),
  },

  // --- Tábor fájlok ---
  '/tours/{id}/cover': {
    get: op({
      tag: T.tourFiles,
      summary: 'Cover picture',
      description: 'Always asked with `?v={coverUpdatedAt}` - cached for good.',
      params: [tourId, query('v', 'Cache version (coverUpdatedAt).')],
      response: file(['image/jpeg'], 'The JPEG.'),
      errors: [404],
    }),
    post: op({
      tag: T.tourFiles,
      role: 'admin',
      summary: 'Upload the cover',
      description: 'A JPEG, already cropped to 3:2 by the app.',
      params: [tourId],
      multipart: obj({ cover: { type: 'string', format: 'binary' } }, ['cover']),
      data: obj({ tour: ref('Tour') }),
      errors: [400, 404],
    }),
  },
  '/tours/{id}/pdf': {
    get: op({
      tag: T.tourFiles,
      summary: 'Programfüzet PDF',
      description: 'Generated fresh from the tour every time.',
      params: [tourId],
      response: file(['application/pdf'], 'The PDF.'),
      errors: [404],
    }),
  },
  '/tours/{id}/pdf/email': {
    post: op({
      tag: T.tourFiles,
      summary: 'E-mail me the Programfüzet',
      params: [tourId],
      data: obj({ sentTo: str() }),
      errors: [400, 404],
    }),
  },
  // --- Beszámoló ---
  '/tours/{id}/report': {
    get: op({
      tag: T.tourFiles,
      summary: 'The beszámoló',
      description:
        "Whether I can download the finished beszámoló (it is Kész, and I was on the tour - or I'm an admin). An admin also gets the working copy: the days (the editor's content), the header lines and what they'd be when left empty (`auto`, from the tour), the picked album photo, and when it was last finished.",
      params: [tourId],
      data: obj({
        canDownload: bool(),
        publishedAt: {
          ...date('When it was last finished (only if I can download it).'),
          nullable: true,
        },
        report: { type: 'object', description: 'Admins only - the working copy.' },
      }),
      errors: [404],
    }),
    put: op({
      tag: T.tourFiles,
      role: 'admin',
      summary: 'Save the beszámoló',
      description:
        "Saved as the admin types. `days`: one editor content (Quill delta) per day, or null - only text, bold/italic/underline and bullet/numbered lists with their levels are kept. `facts`: the header lines (place, dates, headcount); empty = the tour's own. `photo`: one of the tour's album photos (file name), or null. Refused while it's Kész.",
      params: [tourId],
      body: obj({
        days: arrayOf({ type: ['object', 'null'], description: 'Quill delta.' }),
        facts: obj({ place: str(), dates: str(), headcount: str() }),
        photo: { type: ['string', 'null'], description: 'An album photo’s file name.' },
      }),
      data: obj({ updatedAt: date() }),
      errors: [400, 404, 409],
    }),
  },
  '/tours/{id}/report/finish': {
    post: op({
      tag: T.tourFiles,
      role: 'admin',
      summary: 'Kész - publish the beszámoló',
      description:
        "Locks the working copy and makes it the one the tour's attendees download. Needs text on at least one day.",
      params: [tourId],
      data: obj({ report: { type: 'object' } }),
      errors: [400, 404],
    }),
  },
  '/tours/{id}/report/reopen': {
    post: op({
      tag: T.tourFiles,
      role: 'admin',
      summary: 'Visszanyitás - edit it again',
      description: 'The attendees keep downloading the last finished one until the next Kész.',
      params: [tourId],
      data: obj({ report: { type: 'object' } }),
      errors: [404],
    }),
  },
  '/tours/{id}/report/pdf': {
    get: op({
      tag: T.tourFiles,
      summary: 'Beszámoló PDF',
      description:
        "The finished beszámoló - the tour's attendees and admins. The picked album photo, place, dates, headcount, the days as bullet points, and at the end the club, the elnök and a wax seal with the elnök's name. `?draft=1` (admin): the working copy as it is now, marked PISZKOZAT.",
      params: [tourId, query('draft', "`1`: the admin's preview of the working copy.")],
      response: file(['application/pdf'], 'The PDF.'),
      errors: [403, 404],
    }),
  },
  '/tours/{id}/attendees/export.xlsx': {
    get: op({
      tag: T.tourFiles,
      role: 'admin',
      summary: 'Attendee list as Excel',
      description:
        'For the house owner: nights, price, advance, rest - grouped by family. A EUR tour: every amount in EUR (the advance and the optional events too), no forints.',
      params: [tourId],
      response: file(
        ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
        'The spreadsheet.',
      ),
      errors: [404],
    }),
  },

  // --- Tábor fotók és videók ---
  '/tours/{tourId}/images': {
    get: op({
      tag: T.gallery,
      summary: "A tour's photos",
      description:
        '`{ filename, width, height }` in order. A restricted photo is left out for those who may not see it.',
      params: [tourIdT],
      data: obj({
        images: arrayOf(obj({ filename: str(), width: int(), height: int(), restricted: bool() })),
      }),
      errors: [404],
    }),
  },
  '/tours/{tourId}/images/download-zip': {
    get: op({
      tag: T.gallery,
      summary: 'All photos as a zip',
      description: 'Streamed; only the photos I may see.',
      params: [tourIdT],
      response: file(['application/zip'], 'The zip.'),
      errors: [404],
    }),
  },
  '/tours/{tourId}/images/{filename}': {
    get: op({
      tag: T.gallery,
      summary: 'A photo (original, or a smaller version)',
      description:
        'Without `w`: the original. With `w`: a WebP at most that wide (never enlarged), made on first request and kept in the image cache (Kép gyorsítótár). Cached by browsers for a year.',
      params: [tourIdT, path('filename', 'e.g. `mobil%2FIMG_1.jpg`.'), sizeW],
      response: file(
        ['image/jpeg', 'image/png', 'image/webp'],
        'The original, or the WebP version.',
      ),
      errors: [400, 404],
    }),
    patch: op({
      tag: T.gallery,
      role: 'admin',
      summary: 'Restrict a photo to the attendees',
      params: [tourIdT, path('filename', 'The photo.')],
      body: obj({ restricted: bool() }, ['restricted']),
      data: obj({ image: { type: 'object' } }),
      errors: [404],
    }),
  },
  '/tours/{tourId}/images/{filename}/thumb': {
    get: op({
      tag: T.gallery,
      summary: 'A photo thumbnail',
      params: [tourIdT, path('filename', 'The photo.')],
      response: file(['image/webp'], 'WebP, 400 px wide (the original if missing).'),
      errors: [404],
    }),
  },
  '/tours/{tourId}/images/{filename}/download': {
    get: op({
      tag: T.gallery,
      summary: 'Download a photo',
      params: [tourIdT, path('filename', 'The photo.')],
      response: file(['image/jpeg'], 'As an attachment.'),
      errors: [404],
    }),
  },
  '/tours/{tourId}/videos/{videoId}/video': {
    get: op({
      tag: T.gallery,
      summary: 'A recap video',
      description: 'Supports `Range` - seeking works.',
      params: [tourIdT, path('videoId', 'From the tour.')],
      response: file(['video/mp4'], 'The video.'),
      errors: [404],
    }),
  },
  '/tours/{tourId}/videos/{videoId}/cover': {
    get: op({
      tag: T.gallery,
      summary: "A video's cover",
      params: [tourIdT, path('videoId', 'The video.')],
      response: file(['image/jpeg'], 'The picture.'),
      errors: [404],
    }),
  },
  '/tours/{tourId}/videos/{videoId}/subtitles.vtt': {
    get: op({
      tag: T.gallery,
      summary: "A video's subtitles",
      params: [tourIdT, path('videoId', 'The video.')],
      response: file(['text/vtt'], 'WebVTT.'),
      errors: [404],
    }),
  },

  // --- Levél a résztvevőknek ---
  '/tours/{id}/mailings': {
    get: op({
      tag: T.mailing,
      role: 'admin',
      summary: 'The letters of a tour',
      description: 'The draft, the sent letters, and who would get the next one.',
      params: [tourId],
    }),
  },
  '/tours/{id}/mailings/draft': {
    put: op({
      tag: T.mailing,
      role: 'admin',
      summary: 'Save the draft',
      description: 'Saved as the admin types.',
      params: [tourId],
      body: obj({
        subject: str(),
        html: str(),
        delta: { type: 'object', description: 'The editor content (Quill).' },
      }),
      data: obj({ updatedAt: date() }),
    }),
  },
  '/tours/{id}/mailings/test': {
    post: op({
      tag: T.mailing,
      role: 'admin',
      summary: 'Send the draft to myself',
      params: [tourId],
      data: obj({ sentTo: str() }),
      errors: [400],
    }),
  },
  '/tours/{id}/mailings/send': {
    post: op({
      tag: T.mailing,
      role: 'admin',
      summary: 'Send the letter to all attendees',
      description: 'Those who can get e-mail. The draft becomes a sent letter.',
      params: [tourId],
      data: obj({ mailing: { type: 'object' } }),
      errors: [400],
    }),
  },

  // --- Kotyogó ---
  '/chat-rooms/overview': {
    get: op({
      tag: T.chat,
      summary: 'The list of chat rooms, with last message and unread count',
      description:
        "The general room and every tour's, for the list of Kotyogós. Each has `lastPost` (author - username, or name without one -, the text shortened to 80 characters, whether it is a photo or a poll, when; null if empty), `unread` (messages by others since the asker last had it open) and `memberCount` (a tour's attendees; everyone active for the general room). A tour's entry also has `past` (the tour ended more than 14 days ago - its chat is listed among the archives) and `closed` (it is read-only: new messages, photos and polls are refused; `unread` is 0). Every past chat is closed, except the test tour's (number 11), which stays writable. `chatRoomId` is null for a tour whose room nobody has opened yet.",
      data: obj({
        general: obj({
          chatRoomId: id(),
          lastPost: { type: 'object' },
          unread: int(),
          memberCount: int(),
        }),
        tours: arrayOf(
          obj({
            tourId: id(),
            chatRoomId: id(),
            past: { type: 'boolean' },
            closed: { type: 'boolean' },
            lastPost: { type: 'object' },
            unread: int(),
            memberCount: int(),
          }),
        ),
      }),
    }),
  },
  '/chat-rooms/general': {
    get: op({
      tag: T.chat,
      summary: 'The general chat room',
      description:
        'The one club-wide room, not about any tour - open to everyone logged in; its messages notify everyone. Made on first use.',
      data: obj({ chatRoom: ref('ChatRoom') }),
    }),
  },
  '/chat-rooms/general/game': {
    get: op({
      tag: T.chat,
      summary: "The launch game's podium",
      description:
        'The one-off game "the first three to write in Bódorgók". It starts with the organizer\'s (INITIAL_ADMIN_USER) first text message in the general room; the first three other people to send a text message there (a photo or a reaction does not count) take the three places, one each. `game` is null when there is nothing to show: not started yet, or finished more than a day ago. Otherwise it has `startedAt`, `finishedAt` (null while it runs), `places` (3) and the `winners` so far in order (`place`, `userId`, `name`, `username`, `photoUpdatedAt`, `at`). Live: every new winner is sent to the room over the socket as `chat-game` ({ game, newPlace }). When the last place is taken the result is posted in the chat in the organizer\'s name.',
      data: obj({ game: { type: 'object' } }),
    }),
  },
  '/chat-rooms/general/people': {
    get: op({
      tag: T.chat,
      summary: 'Who can be @-mentioned in the general room',
      description: 'Everyone with a username who isn’t retired.',
      data: obj({
        people: arrayOf(obj({ userId: id(), name: str(), username: str() })),
      }),
    }),
  },
  '/chat-rooms/general/polls': {
    post: op({
      tag: T.polls,
      summary: 'Start a poll in the general Kotyogó',
      description:
        'Anyone logged in. A general poll (no tour): shows on Voks too, and as a live card in the general room; everyone gets a notification, and the "not voted yet" reminder too.',
      body: obj(
        {
          question: str(),
          details: str(
            'Részletek - optional formatted text under the question (bold, colors, lists, links; cleaned like a mailing).',
          ),
          options: arrayOf(str()),
          closesAt: date(),
          visibility: str('', { enum: ['open', 'secret'] }),
          minimumCount: int('Optional minimum for the first answer.'),
        },
        ['question', 'options', 'closesAt'],
      ),
      ok: 201,
      data: obj({ poll: ref('Poll') }),
      errors: [400],
    }),
  },
  '/tours/{tourId}/chat-room': {
    get: op({
      tag: T.chat,
      summary: "A tour's chat room",
      description: 'The tour’s own room - made on first use.',
      params: [tourIdT],
      data: obj({ chatRoom: ref('ChatRoom') }),
      errors: [404],
    }),
  },
  '/chat-rooms/{chatRoomId}/images': {
    post: op({
      tag: T.chat,
      summary: 'Send a photo',
      description:
        'Stored as WebP (1600 px + a 480 px thumbnail, no EXIF). Limited per person per day; over the size quota the oldest photos go. Announced to the chat room as `new-post`. Refused (403) in a past tour\x27s closed room - see GET /chat-rooms/overview.',
      params: [chatRoomIdP],
      multipart: obj(
        {
          image: { type: 'string', format: 'binary', description: 'At most 12 MB.' },
          text: str('Optional caption.'),
        },
        ['image'],
      ),
      ok: 201,
      data: obj({ post: ref('Post') }),
      errors: [400, 404, 429],
    }),
  },
  '/chat-rooms/{chatRoomId}/images/{postId}': {
    get: op({
      tag: T.chat,
      summary: 'A chat photo',
      params: [chatRoomIdP, path('postId', 'The message.')],
      response: file(['image/webp'], 'WebP.'),
      errors: [404],
    }),
  },
  '/chat-rooms/{chatRoomId}/images/{postId}/thumb': {
    get: op({
      tag: T.chat,
      summary: 'A chat photo thumbnail',
      params: [chatRoomIdP, path('postId', 'The message.')],
      response: file(['image/webp'], 'WebP, 480 px.'),
      errors: [404],
    }),
  },
  '/tours/{tourId}/chat/background': {
    get: op({
      tag: T.chat,
      summary: "The Kotyogó's background",
      description:
        "This week's landscape photo from the tour's album (never a restricted one), made pale (75% white) - changes every ISO week by itself. `null` if the album has no landscape photo. Made on the first request of the week.",
      params: [tourIdT],
      data: obj({ background: obj({ version: str('e.g. `2026-W40.1a2b3c4d`.') }) }),
      errors: [404],
    }),
  },
  '/tours/{tourId}/chat/background/image': {
    get: op({
      tag: T.chat,
      summary: "The Kotyogó's background image",
      description: 'Cached by browsers for a year - the `v` in the address changes with it.',
      params: [tourIdT, query('v', 'The `version` from the call above.')],
      response: file(['image/webp'], 'WebP, at most 1920 px wide.'),
      errors: [404],
    }),
  },
  '/tours/{tourId}/chat/background/next': {
    post: op({
      tag: T.chat,
      role: 'admin',
      summary: 'Another background ("Másik háttér")',
      description: 'Another landscape photo from the album, for the rest of the week.',
      params: [tourIdT],
      data: obj({ background: obj({ version: str() }) }),
      errors: [404, 409],
    }),
  },

  // --- Voks ---
  '/polls': {
    get: op({
      tag: T.polls,
      summary: 'All polls',
      description: 'Newest first, with my vote.',
      data: obj({ polls: arrayOf(ref('Poll')) }),
    }),
    post: op({
      tag: T.polls,
      role: 'admin',
      summary: 'Create a poll (Voks page)',
      body: obj(
        {
          tour: id('The tour it belongs to - none (or empty): a general poll, for everyone.'),
          question: str(),
          details: str(
            'Részletek - optional formatted text under the question (bold, colors, lists, links; cleaned like a mailing).',
          ),
          options: arrayOf(str()),
          closesAt: date(),
          visibility: str('Default: secret.', { enum: ['open', 'secret'] }),
          minimumCount: int(
            'Optional: the first answer needs at least this many (1-500) - they are told when reached.',
          ),
        },
        ['question', 'options', 'closesAt'],
      ),
      ok: 201,
      data: obj({ poll: ref('Poll') }),
      errors: [400],
    }),
  },
  '/polls/pending': {
    get: op({
      tag: T.polls,
      summary: 'How many polls wait for my vote',
      description: 'The Voks menu badge - open polls of my tours and the general ones.',
      data: obj({ count: int() }),
    }),
  },
  '/polls/{id}': {
    get: op({
      tag: T.polls,
      summary: 'One poll',
      params: [path('id', 'The poll.')],
      data: obj({ poll: ref('Poll') }),
      errors: [404],
    }),
    patch: op({
      tag: T.polls,
      role: 'admin',
      summary: 'Edit a poll',
      description: 'After the first vote only the tour and the closing time can change.',
      params: [path('id', 'The poll.')],
      body: obj({
        tour: id(),
        question: str(),
        details: str(
          'Részletek - optional formatted text under the question (bold, colors, lists, links; cleaned like a mailing).',
        ),
        options: arrayOf(str()),
        closesAt: date(),
        visibility: str('', { enum: ['open', 'secret'] }),
        minimumCount: int(),
      }),
      data: obj({ poll: ref('Poll') }),
      errors: [400, 404],
    }),
    delete: op({
      tag: T.polls,
      summary: 'Delete a poll',
      description:
        'Whoever started it, or an admin. Its chat message becomes "Hozzászólás törölve".',
      params: [path('id', 'The poll.')],
      ok: 204,
      errors: [403, 404],
    }),
  },
  '/polls/{id}/close': {
    post: op({
      tag: T.polls,
      summary: 'Close a poll now',
      description: 'Whoever started it, or an admin.',
      params: [path('id', 'The poll.')],
      data: obj({ poll: ref('Poll') }),
      errors: [403, 404],
    }),
  },
  '/polls/{id}/vote': {
    post: op({
      tag: T.polls,
      summary: 'Vote',
      description: 'While it is open; voting again changes the vote.',
      params: [path('id', 'The poll.')],
      body: obj({ optionId: id('The chosen answer.') }, ['optionId']),
      data: obj({ poll: ref('Poll') }),
      errors: [400, 404],
    }),
  },
  '/tours/{tourId}/polls': {
    post: op({
      tag: T.polls,
      summary: "Start a poll in a tour's Kotyogó",
      description:
        "Anyone signed up for the tour (or an admin). Shows on Voks too, and as a live card in the chat; the attendees get a notification. Refused (403) once the tour's chat has closed - 14 days after its last day (see GET /chat-rooms/overview).",
      params: [tourIdT],
      body: obj(
        {
          question: str(),
          details: str(
            'Részletek - optional formatted text under the question (bold, colors, lists, links; cleaned like a mailing).',
          ),
          options: arrayOf(str()),
          closesAt: date(),
          visibility: str('', { enum: ['open', 'secret'] }),
          minimumCount: int('Optional minimum for the first answer.'),
        },
        ['question', 'options', 'closesAt'],
      ),
      ok: 201,
      data: obj({ poll: ref('Poll') }),
      errors: [400, 403, 404],
    }),
  },

  // --- Fizetés ---
  '/payments/start': {
    post: op({
      tag: T.payments,
      summary: 'Pay tour advances',
      description:
        'For myself and my family - the server works out who is still unpaid and how much, never trusting the amount. Answers with the gateway page to send the browser to.',
      body: obj(
        {
          tourId: id(),
          attendeeIds: arrayOf(id()),
          method: str('Default: stripe.', { enum: ['barion', 'stripe'] }),
        },
        ['tourId', 'attendeeIds'],
      ),
      data: obj({ gatewayUrl: str(), paymentId: id() }),
      errors: [400, 502],
    }),
  },
  '/payments/membership/start': {
    post: op({
      tag: T.payments,
      summary: 'Pay membership dues',
      description: 'One payment for several person + year pairs (family members, unpaid years).',
      body: obj(
        {
          items: arrayOf(obj({ userId: id(), year: int() })),
          method: str('Default: stripe.', { enum: ['barion', 'stripe'] }),
        },
        ['items'],
      ),
      data: obj({ gatewayUrl: str(), paymentId: id() }),
      errors: [400, 502],
    }),
  },
  '/payments/{id}/status': {
    get: op({
      tag: T.payments,
      summary: 'Payment status',
      description:
        'Asked by the payment page after the gateway sends the browser back; checks with the gateway itself.',
      params: [path('id', 'The payment.')],
      data: obj({ status: str(), amount: num() }),
      errors: [403, 404],
    }),
  },
  '/payments/{id}/receipt': {
    get: op({
      tag: T.payments,
      summary: 'Payment receipt (PDF)',
      description: 'The payer or an admin.',
      params: [path('id', 'The payment.')],
      response: file(['application/pdf'], 'The receipt.'),
      errors: [403, 404],
    }),
  },
  '/payments/{id}': {
    delete: op({
      tag: T.payments,
      role: 'admin',
      summary: 'Undo a cash payment',
      description: 'Only `method: cash` - an online payment can never be undone here.',
      params: [path('id', 'The payment.')],
      ok: 204,
      errors: [400, 404],
    }),
  },
  '/payments/barion/callback': {
    get: op({
      tag: T.payments,
      role: 'public',
      summary: 'Barion callback',
      description:
        'Barion calls it server-to-server ("something changed"); the real status is asked from Barion.',
      params: [query('paymentId', 'Barion payment id.')],
      response: { description: 'OK.' },
      errors: [400],
    }),
  },
  '/payments/stripe/webhook': {
    post: op({
      tag: T.payments,
      role: 'public',
      summary: 'Stripe webhook',
      description: 'Stripe calls it server-to-server; signature-checked.',
      response: { description: 'OK.' },
      errors: [400],
    }),
  },
  '/payments/cash': {
    post: op({
      tag: T.payments,
      role: 'admin',
      summary: 'Record a cash tour advance',
      description: 'Someone paid an admin in cash: marked paid at once, no e-mail.',
      body: obj({ tourId: id(), attendeeIds: arrayOf(id()) }, ['tourId', 'attendeeIds']),
      ok: 201,
      data: obj({ payment: ref('Payment') }),
      errors: [400],
    }),
  },
  '/payments/cash-membership': {
    post: op({
      tag: T.payments,
      role: 'admin',
      summary: "Record a member's dues paid in cash",
      body: obj({ userId: id(), year: int() }, ['userId', 'year']),
      ok: 201,
      data: obj({ payment: ref('Payment') }),
      errors: [400, 404],
    }),
  },
  '/payments/withdraw/{purpose}': {
    get: op({
      tag: T.payments,
      role: 'admin',
      summary: 'Can this wallet be withdrawn from',
      description: "Its bank account is set on Beállítások and its API key in the server's .env.",
      params: [path('purpose', '`membershipFee` or `tourAdvance`.')],
      data: obj({ configured: bool() }),
    }),
  },
  '/payments/withdraw': {
    post: op({
      tag: T.payments,
      role: 'admin',
      summary: 'Withdraw from a Barion wallet',
      description:
        "To that wallet's bank account from Beállítások - never to an account given in the request. Barion's fee: 0.1%, at least 70 Ft.",
      body: obj(
        { purpose: str('', { enum: ['membershipFee', 'tourAdvance'] }), amount: int('Forints.') },
        ['purpose', 'amount'],
      ),
      data: obj({ fee: int(), net: int() }),
      errors: [400, 502],
    }),
  },

  // --- Pénzügyek ---
  '/finance/transactions': {
    get: op({
      tag: T.finance,
      role: 'member',
      summary: 'All income and expenses',
      data: obj({ transactions: arrayOf(ref('Transaction')) }),
    }),
    post: op({
      tag: T.finance,
      role: 'admin',
      summary: 'Record income or an expense',
      body: obj(
        {
          date: str('', { format: 'date' }),
          name: str(),
          type: str('', { enum: ['income', 'expense'] }),
          category: str(),
          amount: num(),
          currency: str('', { enum: ['HUF', 'EUR'] }),
        },
        ['date', 'name', 'type', 'category', 'amount'],
      ),
      ok: 201,
      data: obj({ transaction: ref('Transaction') }),
      errors: [400],
    }),
  },

  // --- Felhasználók ---
  '/users': {
    get: op({
      tag: T.users,
      role: 'member',
      summary: 'Everyone',
      description:
        'Admins get every field; members name and e-mail only - no birthday and no age (sensitive: admins only).',
      data: obj({ users: arrayOf(ref('User')) }),
    }),
    post: op({
      tag: T.users,
      role: 'admin',
      summary: 'Add a person',
      description:
        'Someone who may then log in with this e-mail, or a child without a login. Other admins add a `guest`; only the role manager may give another role (403 otherwise). `canManageRoles` cannot be set.',
      body: ref('User'),
      ok: 201,
      errors: [400],
    }),
  },
  '/users/me': {
    get: op({
      tag: T.users,
      summary: 'My own record (Profilom)',
      data: obj({ user: ref('User') }),
    }),
  },
  '/users/updateMe': {
    patch: op({
      tag: T.users,
      summary: 'Update my own record',
      description: 'Username, address, e-mail preference - name and e-mail are not mine to change.',
      body: obj({ username: str(), wantsEmailNotifications: bool(), address: { type: 'object' } }),
      errors: [400],
    }),
  },
  '/users/me/birthday': {
    get: op({
      tag: T.users,
      summary: 'Is it my birthday (the greeting)',
      description:
        'On my birthday (Budapest date), the first time that day: the effect and the greeting with my name - and it is then marked as celebrated for this year, so it shows once, on whichever device comes first. Otherwise `celebrate: false`. The app asks it on every start.',
      data: obj({
        celebrate: bool(),
        effect: str('Only when celebrate.', {
          enum: ['confetti', 'fireworks', 'cannons', 'stars', 'snow', 'emoji'],
        }),
        message: str('Only when celebrate - e.g. "Boldog születésnapot, Anna! 🎂".'),
      }),
    }),
  },
  '/users/me/rank': {
    get: op({
      tag: T.users,
      summary: 'Did I reach a new rank (the celebration)',
      description:
        'The first time after reaching a new rank (10 Bronz, 20 Ezüst, 30 Arany, 40 Platina, 50 Gyémánt started tours): the effect and the message - then it is marked as celebrated, so it shows once, on whichever device comes first, and every admin is e-mailed. Ranks already reached when this began count as celebrated. Otherwise `celebrate: false` (also when it is turned off - the rank is still marked and the admins still e-mailed). The app asks it on every start.',
      data: obj({
        celebrate: bool(),
        effect: str('Only when celebrate.', {
          enum: ['confetti', 'fireworks', 'cannons', 'stars', 'snow', 'emoji'],
        }),
        message: str('Only when celebrate - e.g. "Kedves Csabi! Túléltél 10+ bódorgót! …".'),
      }),
    }),
  },
  '/users/me/attendance': {
    get: op({
      tag: T.users,
      summary: 'Tours I attended',
      data: obj({ tours: arrayOf(ref('Tour')) }),
    }),
  },
  '/users/me/family': {
    get: op({
      tag: T.users,
      summary: 'My family',
      description: 'The others in my family - not the retired ones (they can’t be signed up).',
      data: obj({ members: arrayOf(ref('User')) }),
    }),
  },
  '/users/me/photo': {
    put: op({
      tag: T.users,
      summary: 'Set my profile photo',
      description: 'A 320×320 JPEG. From then on an admin cannot change it.',
      multipart: obj({ photo: { type: 'string', format: 'binary' } }, ['photo']),
      errors: [400],
    }),
    delete: op({ tag: T.users, summary: 'Remove my profile photo', ok: 204 }),
  },
  '/users/{id}': {
    get: op({
      tag: T.users,
      role: 'admin',
      summary: 'One person (full record)',
      params: [userIdP],
      data: obj({ user: ref('User') }),
      errors: [404],
    }),
    patch: op({
      tag: T.users,
      role: 'admin',
      summary: 'Edit a person',
      description:
        'Any admin edits the details. Changing `role` is for the role manager only (403 otherwise), and not their own (400). Sending the current role back unchanged is fine.',
      params: [userIdP],
      body: ref('User'),
      errors: [400, 403, 404],
    }),
    delete: op({
      tag: T.users,
      role: 'admin',
      summary: 'Archive a person',
      description: 'Never really deleted (their history stays) - reversible with `/restore`.',
      params: [userIdP],
      data: obj({ user: obj({ _id: id(), retired: bool() }) }),
      errors: [404],
    }),
  },
  '/users/{id}/restore': {
    patch: op({
      tag: T.users,
      role: 'admin',
      summary: 'Restore an archived person',
      params: [userIdP],
      data: obj({ user: obj({ _id: id(), retired: bool() }) }),
      errors: [404],
    }),
  },
  '/users/{id}/photo': {
    get: op({
      tag: T.users,
      summary: "Someone's profile photo",
      description: 'Always asked with `?v={photoUpdatedAt}` - cached for good.',
      params: [userIdP, query('v', 'Cache version.')],
      response: file(['image/jpeg'], 'The JPEG.'),
      errors: [404],
    }),
    put: op({
      tag: T.users,
      role: 'admin',
      summary: "Set someone's profile photo",
      description: 'Not once they set their own.',
      params: [userIdP],
      multipart: obj({ photo: { type: 'string', format: 'binary' } }, ['photo']),
      errors: [400, 403, 404],
    }),
    delete: op({
      tag: T.users,
      role: 'admin',
      summary: "Remove someone's profile photo",
      params: [userIdP],
      ok: 204,
      errors: [403, 404],
    }),
  },
  '/users/invitations': {
    get: op({
      tag: T.users,
      role: 'admin',
      summary: 'Meghívók - who can be invited, and how it stands',
      description:
        'Everyone with an e-mail who has never logged in (and is not suspended), plus those invited who have joined since. `status`: `none` (not invited), `sent`, `expired`, `joined`. `enabled`: the server has its Authentik API token.',
      data: obj({
        enabled: bool(),
        days: int('How long a link is valid.'),
        intro: str("The invitation e-mail's intro text (paragraphs separated by an empty line)."),
        people: arrayOf(
          obj({
            _id: id(),
            name: str(),
            email: str(),
            role: str('', { enum: ['admin', 'member', 'guest'] }),
            status: str('', { enum: ['none', 'sent', 'expired', 'joined'] }),
            sentAt: { type: ['string', 'null'], format: 'date-time' },
            expiresAt: { type: ['string', 'null'], format: 'date-time' },
            sentByName: { type: ['string', 'null'] },
          }),
        ),
      }),
    }),
    post: op({
      tag: T.users,
      role: 'admin',
      summary: 'Send invitations',
      description:
        'Each person gets a new single-use Authentik invitation (their e-mail and name pre-filled; valid for 30 days) and an e-mail with their own link; a previous link of theirs stops working. Either `userIds` (one person - a test, a resend) or `group`: `members` (club members and admins) / `others` (guests) - a batch only takes those not invited yet. Someone who has logged in is never invited. One failure does not stop the others; it is listed by name.',
      body: obj({
        userIds: arrayOf(id()),
        group: str('A batch.', { enum: ['members', 'others'] }),
      }),
      data: obj({
        sent: arrayOf(str('Name.')),
        failed: arrayOf(obj({ name: str(), message: str() })),
      }),
      errors: [400],
    }),
  },
  '/users/invitations/intro': {
    put: op({
      tag: T.users,
      role: 'admin',
      summary: 'Set the invitation e-mail intro',
      description:
        'The text above the steps in every invitation e-mail sent from now on (1-2000 characters; an empty line starts a new paragraph; no HTML). Recorded in the history.',
      body: obj({ intro: str() }, ['intro']),
      data: obj({ intro: str() }),
      errors: [400],
    }),
  },
  '/users/invitations/test': {
    post: op({
      tag: T.users,
      role: 'admin',
      summary: 'Send me a test invitation e-mail',
      description:
        'The invitation e-mail as it will look - with the given (unsaved) intro, or the saved one - to the admin themselves, with a sample link that does not work. No invitation is created.',
      body: obj({ intro: str('Optional: the text being edited.') }),
      data: obj({ sentTo: str() }),
      errors: [400],
    }),
  },
  '/users/{id}/invitation': {
    delete: op({
      tag: T.users,
      role: 'admin',
      summary: 'Take an invitation back',
      description: 'Deletes it in Authentik - the link stops working.',
      params: [userIdP],
      data: { type: 'object' },
      errors: [400, 404],
    }),
  },
  '/users/join-family': {
    post: op({
      tag: T.users,
      role: 'admin',
      summary: 'Put people in one family',
      body: obj({ userIds: arrayOf(id()) }, ['userIds']),
      data: obj({ users: arrayOf(ref('User')), familyId: id() }),
      errors: [400, 404],
    }),
  },
  '/users/usernames': {
    get: op({
      tag: T.users,
      role: 'admin',
      summary: 'Everyone with their username',
      data: obj({ users: arrayOf(obj({ _id: id(), name: str(), username: str() })) }),
    }),
    put: op({
      tag: T.users,
      role: 'admin',
      summary: 'Set many usernames at once',
      description:
        "All-or-nothing: if any row is wrong (rule, clash), nothing is saved and each problem is listed by user id. `''` clears one.",
      body: obj({ items: arrayOf(obj({ id: id(), username: str() })) }, ['items']),
      data: obj({ updated: int() }),
      errors: [400],
    }),
  },
  '/membership/users': {
    get: op({
      tag: T.users,
      role: 'member',
      summary: 'Members and dues (Felhasználók page)',
      description:
        'Everyone with their role, attendance and paid years. `age` is sent to admins only (sensitive); the raw birthday to nobody.',
      data: obj({ users: arrayOf(ref('User')) }),
    }),
  },

  // --- Dokumentumok ---
  '/documents': {
    get: op({
      tag: T.documents,
      summary: "The club's documents, or a tour's Extrák",
      description:
        "Without `tour`: Klub → Dokumentumok. With `tour`: that tour's Extrák (the tour page also gets them in `tour.extraDocuments`).",
      params: [query('tour', 'A tour id: its Extrák.')],
      data: obj({ documents: arrayOf(ref('Document')) }),
      errors: [404],
    }),
    post: op({
      tag: T.documents,
      role: 'admin',
      summary: 'Upload a document',
      description:
        "PDF, JPG or PNG, at most 15 MB. For the club: `name`, `category`, `year` - its first-page preview is made at once. For a tour's Extrák: `name` and `tour` - at most 5 per tour, no preview.",
      multipart: obj(
        {
          file: { type: 'string', format: 'binary' },
          name: str('Shown on the card.'),
          tour: id("For a tour's Extrák; leave out for a club document."),
          category: str('Club documents only; unknown -> "Egyéb".'),
          year: int('Club documents only.'),
        },
        ['file', 'name'],
      ),
      ok: 201,
      data: obj({ document: ref('Document') }),
      errors: [400, 404],
    }),
  },
  '/documents/{id}': {
    delete: op({
      tag: T.documents,
      role: 'admin',
      summary: 'Delete a document',
      description: 'Its file and preview go too.',
      params: [path('id', 'The document.')],
      ok: 204,
      errors: [404],
    }),
  },
  '/documents/{id}/file': {
    get: op({
      tag: T.documents,
      summary: 'A document file',
      description:
        "Inline for the browser's viewer, or with `download` as an attachment named after the document.",
      params: [path('id', 'The document.'), query('download', 'Any value: as an attachment.')],
      response: file(['application/pdf', 'image/jpeg', 'image/png'], 'The file.'),
      errors: [404],
    }),
  },
  '/documents/{id}/preview': {
    get: op({
      tag: T.documents,
      summary: "A club document's preview",
      description: 'Its first page (or the photo), 360 px wide. Tour documents have none.',
      params: [path('id', 'The document.')],
      response: file(['image/webp'], 'WebP.'),
      errors: [404],
    }),
  },
  '/documents/tours/{tourId}/{filename}': {
    get: op({
      tag: T.documents,
      summary: 'A tour document by its old address',
      description:
        'Where tour documents were before - kept so links already sent out still work. New links use `/documents/{id}/file`.',
      params: [tourIdT, path('filename', 'The file name.')],
      response: file(['application/pdf', 'image/jpeg', 'image/png'], 'The file.'),
      errors: [404],
    }),
  },

  // --- Média ---
  '/media/videos': {
    get: op({
      tag: T.media,
      role: 'member',
      summary: 'All video categories and videos',
      description:
        "Each category with its videos, newest first. A video has its title, year, season and episode (from its file name), whether it has a cover and subtitles, and `durationSeconds` - its length, read from the file's own header (MP4/MOV; null when it can't be read).",
      data: obj({ categories: arrayOf({ type: 'object' }) }),
    }),
  },
  '/media/videos/{category}/cover': {
    get: op({
      tag: T.media,
      role: 'member',
      summary: "A category's cover",
      params: [path('category', 'e.g. `szilveszter`.')],
      response: file(['image/jpeg', 'image/png'], 'The picture.'),
      errors: [404],
    }),
  },
  '/media/videos/{category}/{id}/video': {
    get: op({
      tag: T.media,
      role: 'member',
      summary: 'A video',
      description: 'Supports `Range`.',
      params: [path('category', 'The category.'), path('id', 'The video.')],
      response: file(['video/mp4'], 'The video.'),
      errors: [404],
    }),
  },
  '/media/videos/{category}/{id}/cover': {
    get: op({
      tag: T.media,
      role: 'member',
      summary: "A video's cover",
      params: [path('category', 'The category.'), path('id', 'The video.')],
      response: file(['image/jpeg'], 'The picture.'),
      errors: [404],
    }),
  },
  '/media/videos/{category}/{id}/subtitles.vtt': {
    get: op({
      tag: T.media,
      role: 'member',
      summary: "A video's subtitles",
      params: [path('category', 'The category.'), path('id', 'The video.')],
      response: file(['text/vtt'], 'WebVTT.'),
      errors: [404],
    }),
  },
  '/media/photos': {
    get: op({
      tag: T.media,
      role: 'member',
      summary: 'All photo folders and photos',
      data: obj({
        categories: arrayOf(obj({ key: str(), title: str(), photos: arrayOf({ type: 'object' }) })),
      }),
    }),
  },
  '/media/photos/{category}/{filename}': {
    get: op({
      tag: T.media,
      role: 'member',
      summary: 'A photo (original, or a smaller version)',
      description:
        'Without `w`: the original. With `w`: a WebP at most that wide (never enlarged), made on first request and kept in the image cache (Kép gyorsítótár). Cached by browsers for a year.',
      params: [path('category', 'The folder.'), path('filename', 'The photo.'), sizeW],
      response: file(
        ['image/jpeg', 'image/png', 'image/webp'],
        'The original, or the WebP version - a PNG keeps its transparency either way.',
      ),
      errors: [400, 404],
    }),
  },
  '/media/photos/{category}/{filename}/thumb': {
    get: op({
      tag: T.media,
      role: 'member',
      summary: 'A photo thumbnail',
      params: [path('category', 'The folder.'), path('filename', 'The photo.')],
      response: file(['image/webp'], 'WebP.'),
      errors: [404],
    }),
  },
  '/media/photos/{category}/{filename}/download': {
    get: op({
      tag: T.media,
      role: 'member',
      summary: 'Download a photo',
      params: [path('category', 'The folder.'), path('filename', 'The photo.')],
      response: file(['image/jpeg', 'image/png'], 'As an attachment.'),
      errors: [404],
    }),
  },
  '/media/discover': {
    get: op({
      tag: T.media,
      role: 'admin',
      summary: 'Új média felfedezése - progress',
      description: 'How the running (or last) discovery is going, and what it found.',
    }),
    post: op({
      tag: T.media,
      role: 'admin',
      summary: 'Új média felfedezése - start',
      description:
        'Looks through the NAS for new tour photos/videos and Média photos, makes thumbnails, e-mails attendees about new tour videos. Runs in the background.',
    }),
  },

  // --- Beállítások ---
  '/settings/membership-fees': {
    get: op({
      tag: T.settings,
      role: 'member',
      summary: 'Membership fees by year',
      description:
        "`paymentDeadline` is the day of the year the fee is due by - the first day of the Tagdíj emlékeztető (set with PUT /settings/membership-reminder's startMonth/startDay). Admins also get the change history and the years already paid for (locked).",
      data: obj({
        fees: arrayOf(obj({ fromYear: int(), amount: int() })),
        foundingYear: int(),
        paymentDeadline: obj({ month: int('1-12'), day: int('1-28') }),
      }),
    }),
    put: op({
      tag: T.settings,
      role: 'admin',
      summary: 'Set the membership fees',
      description: 'Replaces the table. A year somebody already paid for cannot change.',
      body: obj({ fees: arrayOf(obj({ fromYear: int(), amount: int() })) }, ['fees']),
      data: obj({ fees: arrayOf({ type: 'object' }) }),
      errors: [400],
    }),
  },
  '/settings/membership-reminder': {
    get: op({
      tag: T.settings,
      role: 'admin',
      summary: 'Tagdíj emlékeztető settings',
      description: "The settings, this year's rounds and who would get one now.",
    }),
    put: op({
      tag: T.settings,
      role: 'admin',
      summary: 'Set the Tagdíj emlékeztető',
      body: obj(
        {
          enabled: bool(),
          startMonth: int('1-12'),
          startDay: int('1-28'),
          frequency: str('', { enum: ['monthly', 'quarterly'] }),
        },
        ['enabled', 'startMonth', 'startDay', 'frequency'],
      ),
      errors: [400],
    }),
  },
  '/settings/membership-reminder/test': {
    post: op({
      tag: T.settings,
      role: 'admin',
      summary: 'Send me a test reminder',
      data: obj({ sentTo: str() }),
      errors: [400],
    }),
  },
  '/settings/chat-images': {
    get: op({
      tag: T.settings,
      role: 'admin',
      summary: 'Kotyogó photo settings',
      data: obj({ quotaMB: int(), dailyLimit: int(), usage: obj({ bytes: int(), count: int() }) }),
    }),
    put: op({
      tag: T.settings,
      role: 'admin',
      summary: 'Set the Kotyogó photo quota and daily limit',
      description: 'A smaller quota applies at once - the oldest photos go until it fits.',
      body: obj({ quotaMB: int('50-100000'), dailyLimit: int('1-1000') }, [
        'quotaMB',
        'dailyLimit',
      ]),
      data: obj({
        quotaMB: int(),
        dailyLimit: int(),
        usage: { type: 'object' },
        removed: int('Photos removed now.'),
      }),
      errors: [400],
    }),
  },
  '/settings/image-cache': {
    get: op({
      tag: T.settings,
      role: 'admin',
      summary: 'Image cache (Kép gyorsítótár) settings',
      description:
        'The smaller photo versions made for the viewer (tour albums, Média → Fotók): the quota and what they take up now.',
      data: obj({ quotaMB: int(), usage: obj({ bytes: int(), count: int() }) }),
    }),
    put: op({
      tag: T.settings,
      role: 'admin',
      summary: 'Set the image cache quota',
      description:
        'A smaller quota applies at once - the least recently viewed versions go until it fits.',
      body: obj({ quotaMB: int('100-1000000') }, ['quotaMB']),
      data: obj({
        quotaMB: int(),
        usage: { type: 'object' },
        removed: int('Versions removed now.'),
      }),
      errors: [400],
    }),
    delete: op({
      tag: T.settings,
      role: 'admin',
      summary: 'Empty the image cache',
      description:
        'Every version goes; they are made again as photos are viewed. The originals are untouched.',
      data: obj({
        quotaMB: int(),
        usage: { type: 'object' },
        removed: int('Versions removed.'),
      }),
    }),
  },
  '/settings/barion': {
    get: op({
      tag: T.settings,
      role: 'admin',
      summary: 'The Barion wallets',
      data: obj({ membership: ref('BarionWallet'), tour: ref('BarionWallet') }),
    }),
  },
  '/settings/barion/{wallet}': {
    put: op({
      tag: T.settings,
      role: 'admin',
      summary: "Set a Barion wallet's e-mail and bank account",
      description:
        'The IBAN must be Hungarian with valid check digits. Every change goes into the history and is **e-mailed to every admin**.',
      params: [path('wallet', '`membership` (Tagdíjak) or `tour` (Előlegek).')],
      body: ref('BarionWallet'),
      data: ref('BarionWallet'),
      errors: [400, 404],
    }),
  },

  '/settings/birthday': {
    get: op({
      tag: T.settings,
      role: 'admin',
      summary: 'The birthday greeting',
      data: ref('BirthdaySettings'),
    }),
    put: op({
      tag: T.settings,
      role: 'admin',
      summary: 'Set the birthday greeting',
      description:
        'On/off, the effect, and the message - `{név}` becomes the person’s given name. Recorded in the history.',
      body: ref('BirthdaySettings'),
      data: ref('BirthdaySettings'),
      errors: [400],
    }),
  },
  '/settings/rank': {
    get: op({
      tag: T.settings,
      role: 'admin',
      summary: 'The rank celebration',
      data: ref('BirthdaySettings'),
    }),
    put: op({
      tag: T.settings,
      role: 'admin',
      summary: 'Set the rank celebration',
      description:
        'On/off, the effect, and the message - `{név}` becomes the person’s given name, `{szám}` the rank’s tour count ("10", or "10+" if they are past it by then), `{rang}` its name (Bronz…). Same shape as the birthday greeting. Recorded in the history.',
      body: ref('BirthdaySettings'),
      data: ref('BirthdaySettings'),
      errors: [400],
    }),
  },
  '/settings/president': {
    get: op({
      tag: T.settings,
      role: 'admin',
      summary: 'The elnök',
      description: "Named at the end of a tour's beszámoló, and around its wax seal.",
      data: obj({ presidentName: str() }),
    }),
    put: op({
      tag: T.settings,
      role: 'admin',
      summary: 'Set the elnök',
      description: 'The name, 1-100 characters. Recorded in the history.',
      body: obj({ presidentName: str() }, ['presidentName']),
      data: obj({ presidentName: str() }),
      errors: [400],
    }),
  },
  '/settings/president/seal.png': {
    get: op({
      tag: T.settings,
      role: 'admin',
      summary: 'The wax seal',
      description: "As it appears on the beszámoló, with the saved elnök's name.",
      response: file(['image/png'], 'The seal (600×600, transparent around the wax).'),
    }),
  },
  // --- Értesítések ---
  '/push/public-key': {
    get: op({
      tag: T.push,
      summary: "The server's push key",
      description: 'The VAPID public key a browser subscribes with; `null` if push is off.',
      data: obj({ publicKey: { type: ['string', 'null'] } }),
    }),
  },
  '/push/subscriptions': {
    post: op({
      tag: T.push,
      summary: 'Turn notifications on for this device',
      body: obj({ endpoint: str(), keys: obj({ p256dh: str(), auth: str() }) }, [
        'endpoint',
        'keys',
      ]),
      ok: 201,
      errors: [400],
    }),
    delete: op({
      tag: T.push,
      summary: 'Turn notifications off for this device',
      body: obj({ endpoint: str() }),
      ok: 204,
    }),
  },
  '/push/test': {
    post: op({
      tag: T.push,
      summary: 'Send me a test notification',
      data: obj({ sent: int('Devices.') }),
      errors: [400],
    }),
  },
  '/push/chat-mutes/{chatRoomId}': {
    get: op({
      tag: T.push,
      summary: 'Is a chat room muted for me',
      params: [chatRoomIdP],
      data: obj({ muted: bool() }),
    }),
    put: op({
      tag: T.push,
      summary: 'Mute / unmute a chat room',
      params: [chatRoomIdP],
      body: obj({ muted: bool() }, ['muted']),
      data: obj({ muted: bool() }),
      errors: [404],
    }),
  },

  // --- Zene ---
  '/music/{key}/playlist': {
    get: op({
      tag: T.music,
      summary: 'A music playlist',
      description:
        'The Jellyfin playlist’s tracks, in order. `bodorgo-fm`: everyone logged in; `buli`: members and admins (403 for guests). Loaded at server start and answered from memory; refreshed in the background every 12 hours (browsers may keep it 30 minutes). 503 if not set up (JELLYFIN_* settings), 502 if Jellyfin can’t be reached on the very first load.',
      params: [musicKey],
      data: obj({
        tracks: arrayOf(
          obj({
            id: str('The Jellyfin item id.'),
            title: str(),
            artist: str(),
            durationMs: int('May be null.'),
            streamUrl: str('Relative - `/music/{key}/stream/{itemId}` on this server.'),
            imageUrl: str(
              'Relative - `/music/{key}/image/{itemId}`, or null if there is no picture.',
            ),
          }),
        ),
      }),
      errors: [403, 404, 502, 503],
    }),
  },
  '/music/{key}/refresh': {
    post: op({
      tag: T.music,
      role: 'admin',
      summary: 'Reload a playlist from Jellyfin now',
      description: 'After a change in Jellyfin - otherwise it is refreshed every 12 hours.',
      params: [musicKey],
      data: obj({ tracks: arrayOf({ type: 'object' }) }),
      errors: [404, 502, 503],
    }),
  },
  '/music/{key}/image/{itemId}': {
    get: op({
      tag: T.music,
      summary: 'One track’s thumbnail',
      description:
        'The artist’s photo if Jellyfin has one, otherwise the album cover (or the track’s own picture) - square, resized by Jellyfin, cached a day. Only a track of that playlist.',
      params: [musicKey, path('itemId', 'A track’s id from the playlist.')],
      response: file(['image/jpeg'], 'The picture.'),
      errors: [403, 404, 502],
    }),
  },
  '/music/{key}/stream/{itemId}': {
    get: op({
      tag: T.music,
      summary: 'One track’s audio',
      description:
        'Piped through from Jellyfin, the original file (no transcoding). Byte ranges (`Range`) are passed on - 206 with `Content-Range`, which Safari needs. Only a track of that playlist.',
      params: [musicKey, path('itemId', 'A track’s id from the playlist.')],
      response: file(['audio/mpeg', 'audio/flac', 'audio/mp4'], 'The audio.'),
      errors: [403, 404, 502],
    }),
  },

  // --- Móka ---
  '/jatekok/players': {
    get: op({
      tag: T.games,
      summary: 'Everyone who can be picked as a player',
      description:
        'Every user of the app, by the name the app shows (username, or name without one), in Hungarian alphabetical order.',
      data: obj({
        players: arrayOf(
          obj({ _id: id(), name: str(), photoUpdatedAt: { type: ['string', 'null'] } }),
        ),
      }),
      errors: [403],
    }),
  },
  '/jatekok/darts/games': {
    get: op({
      tag: T.games,
      summary: 'My darts games',
      description:
        'The games I started or play in - nobody else sees a game, an admin neither. The newest 100 first, each as it stands - without its turns.',
      params: [
        query('status', 'Only these.', {
          type: 'string',
          enum: ['in_progress', 'finished', 'abandoned'],
        }),
      ],
      data: obj({ games: arrayOf(ref('DartsGame')) }),
      errors: [403],
    }),
    post: op({
      tag: T.games,
      summary: 'Start a darts game',
      description:
        'X01 or Cricket on one phone: the game starts at once, the players throw in the order given. The X01 options mean nothing in Cricket. A player is a user (`userId`, each at most once) or just a name (`guestName`, 1-30 characters).',
      body: obj(
        {
          type: str(
            'Default x01. Cricket (standard scoring): 15-20 and the bull each take three hits to close; hits on a closed number score while someone still playing has it open; whoever has closed everything with the most points has finished.',
            { enum: ['x01', 'cricket'] },
          ),
          startScore: int('Default 301.', { enum: [301, 201, 101] }),
          outMode: str('Default single: any dart may finish; double: only a double.', {
            enum: ['single', 'double'],
          }),
          playUntil: str(
            'Where it stops by itself: at the winner, once three have finished, or (default) when everyone has a place. The round is always played out. The app always uses the default - the players end a game earlier with `/finish`.',
            { enum: ['winner', 'top3', 'all'] },
          ),
          players: arrayOf(obj({ userId: id(), guestName: str() })),
        },
        ['players'],
      ),
      ok: 201,
      data: obj({ game: ref('DartsGame') }),
      errors: [400, 403],
    }),
  },
  '/jatekok/darts/games/{id}': {
    get: op({
      tag: T.games,
      summary: 'One darts game',
      description:
        'With every turn, who throws next and the way out if there is one. Only for whoever started it or plays in it - for anyone else there is no such game (404), as on every call below.',
      params: [path('id', 'The game.')],
      data: obj({ game: ref('DartsGame') }),
      errors: [403, 404],
    }),
  },
  '/jatekok/darts/leaderboard': {
    get: op({
      tag: T.games,
      summary: 'The darts leaderboard',
      params: [
        query('type', 'The kind of game - each has its own leaderboard. Default x01.', {
          type: 'string',
          enum: ['x01', 'cricket'],
        }),
        query('startScore', 'X01 only: just the games from this score.', {
          type: 'integer',
          enum: [301, 201, 101],
        }),
      ],
      description:
        'Everyone’s numbers from every finished game of one kind (the games themselves stay their players’). Guests - only named, not users - are not in it. Best first: the most wins, then 2nd and 3rd places, then the average.',
      data: obj({
        players: arrayOf(
          obj({
            userId: id(),
            name: str(),
            photoUpdatedAt: { type: ['string', 'null'] },
            games: int('Finished games played.'),
            firsts: int(),
            seconds: int(),
            thirds: int(),
            average: {
              type: ['number', 'null'],
              description: 'Per three darts, over all games: points in X01, marks in Cricket.',
            },
            highestTurn: int('The best turn: its points in X01, its marks in Cricket.'),
            highestCheckout: int('X01: the most points in a finishing turn.'),
            count180: int('X01 only.'),
          }),
        ),
      }),
      errors: [403],
    }),
  },
  '/jatekok/darts/games/{id}/throws': {
    post: op({
      tag: T.games,
      summary: 'Throw a dart',
      description:
        'The next dart of whoever is next - the server works out the bust, the finish, the next player and the placings. By whoever started the game or plays in it.',
      params: [path('id', 'The game.')],
      body: ref('DartsThrow'),
      data: obj({ game: ref('DartsGame') }),
      errors: [400, 403, 404],
    }),
  },
  '/jatekok/darts/games/{id}/throws/last': {
    delete: op({
      tag: T.games,
      summary: 'Take the last dart back',
      description:
        'A bust or a finishing dart too, across turns - a finished game is on again. On a game the players ended (`/finish`) it takes the ending back instead: no dart is removed. Up to 30 minutes after the end for its players; later only those of them who are admins.',
      params: [path('id', 'The game.')],
      data: obj({ game: ref('DartsGame') }),
      errors: [400, 403, 404],
    }),
  },
  '/jatekok/darts/games/{id}/turns/{turnIdx}': {
    patch: op({
      tag: T.games,
      summary: 'Correct an earlier turn',
      description:
        'Replaces the turn’s darts; everything after it is worked out again (busts, finishes, placings - later turns of someone who now finished earlier are left out). Three darts are needed unless the turn ends sooner (a bust, a finish) or it is the last, open one. The turn keeps who corrected it, when, and its previous darts - unless the darts are the same as before, which changes nothing. Up to 30 minutes after the end for the players; later only those of them who are admins.',
      params: [
        path('id', 'The game.'),
        path('turnIdx', 'The turn’s place in `turns` (from 0).'),
        query(
          'preview',
          '`true`: nothing is stored - the answer is the game as it would be (the app asks before a correction that changes the placings).',
          { type: 'boolean' },
        ),
      ],
      body: obj({ throws: arrayOf(ref('DartsThrow')) }, ['throws']),
      data: obj({ game: ref('DartsGame') }),
      errors: [400, 403, 404],
    }),
  },
  '/jatekok/darts/games/{id}/finish': {
    post: op({
      tag: T.games,
      summary: 'End a darts game',
      description:
        'Játék befejezése: the players agree it is over. The game is finished as it stands - whoever had finished keeps their place, the others are ranked by where they are (X01: the least left; Cricket: the most points, then marks). It counts on the leaderboard.',
      params: [path('id', 'The game.')],
      data: obj({ game: ref('DartsGame') }),
      errors: [400, 403, 404],
    }),
  },
  '/jatekok/darts/games/{id}/abandon': {
    post: op({
      tag: T.games,
      summary: 'Abandon a darts game',
      description:
        'A game still on is given up (started by mistake, say): it stays in the list, nothing more is thrown, and it does not count on the leaderboard.',
      params: [path('id', 'The game.')],
      data: obj({ game: ref('DartsGame') }),
      errors: [400, 403, 404],
    }),
  },

  // --- Rendszer ---
  '/health': {
    get: op({
      tag: T.system,
      role: 'public',
      summary: 'Health check',
      description: 'Uptime Kuma asks it every 5 minutes.',
      response: { description: 'Up.' },
    }),
  },
  '/health/version': {
    get: op({
      tag: T.system,
      summary: 'The running server\x27s version',
      description:
        'Which build is running: the commit it was built from and that commit\'s date - `version` is the two together ("2026.10.01 · adc1c34"; a + after it: built with uncommitted changes). `builtAt` is null when the server runs from the source instead of a build. The client shows it beside its own version (Klub → Beállítások).',
      data: obj({
        version: str('Date and commit, as shown'),
        commit: str('The first seven digits of the commit'),
        date: str('The commit\x27s date, YYYY.MM.DD'),
        builtAt: str('When it was built (ISO), or null'),
      }),
    }),
  },
};

// "GET /tours/{id}/rooms" -> "getToursIdRooms": a stable id per operation
// (Scalar links to them).
function withOperationIds(all) {
  return Object.fromEntries(
    Object.entries(all).map(([p, ops]) => [
      p,
      Object.fromEntries(
        Object.entries(ops).map(([method, o]) => {
          const words = p.split(/[^A-Za-z0-9]+/).filter(Boolean);
          const operationId = [method, ...words]
            .map((w, i) => (i ? w[0].toUpperCase() + w.slice(1) : w))
            .join('');
          return [method, { operationId, ...o }];
        }),
      ),
    ]),
  );
}

export function buildOpenApi({ version }) {
  return {
    openapi: '3.1.0',
    info: {
      title: 'Bódorgó API',
      version,
      description: DESCRIPTION,
      license: { name: 'Private - the Bódorgó club’s own system' },
    },
    servers: [{ url: '/', description: 'This server' }],
    security: [{ session: [] }],
    tags,
    paths: withOperationIds(paths),
    components: {
      securitySchemes: {
        session: {
          type: 'apiKey',
          in: 'cookie',
          name: 'connect.sid',
          description: 'The session cookie set by logging in (`/auth/login`).',
        },
      },
      schemas,
    },
  };
}
