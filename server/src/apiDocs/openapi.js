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
    accommodationCurrency: str('Currency.', { enum: ['HUF', 'EUR'] }),
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
    role: str('Role - synced from Authentik groups at every login.', {
      enum: ['admin', 'member', 'guest'],
    }),
    familyId: id('Users sharing it are one family (they can sign up / pay for each other).'),
    birthday: date(),
    age: int('Computed from birthday.'),
    gender: str('Admins only.', { enum: ['férfi', 'nő'] }),
    memberSince: int('Year the membership started.'),
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

  Poll: obj({
    _id: id(),
    tour: { description: 'The tour (id, title, order).', type: 'object' },
    question: str(),
    options: arrayOf(
      obj({ _id: id(), text: str(), count: int('Votes (open polls, or after close).') }),
    ),
    closesAt: date(),
    closed: bool(),
    visibility: str('Open: who voted what is visible; secret: only counts.', {
      enum: ['open', 'secret'],
    }),
    minimum: obj({ option: id(), count: int('At least this many for that answer.') }),
    myVote: id('My chosen option, if any.'),
    createdBy: { type: 'object' },
  }),

  Post: obj({
    _id: id(),
    tourId: id(),
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

## Roles

Each user has one role, synced from their Authentik group at every login:

| Role | Badge | Who |
|---|---|---|
| \`guest\` | Bejelentkezve | Logged-in non-members (e.g. family members) |
| \`member\` | Tag | Club members |
| \`admin\` | Admin | Club admins |

Each endpoint's badge shows the lowest role that may call it (an admin can call everything).

## Answers

JSON answers come as \`{ "status": "success", "data": { … } }\`. Errors as
\`{ "status": "fail" | "error", "message": "…" }\` - the message is Hungarian and meant for
the user. Files (photos, PDFs, videos, Excel) come as they are; videos support
\`Range\` requests.

## Kotyogó and live updates (Socket.IO)

The chat and the Szobabeosztás board are live over **Socket.IO** on the same origin, with
the same session cookie.

| Direction | Event | Payload |
|---|---|---|
| → server | \`join-tour-chat\` | \`{ tourId }\` - join; answered by \`initial-posts\` |
| → server | \`leave-tour-chat\` | \`{ tourId }\` |
| → server | \`chat-visible\` | \`{ tourId, visible }\` - no push while you look at it |
| → server | \`create-post\` | \`{ tourId, text }\` |
| → server | \`edit-post\` / \`delete-post\` | \`{ postId, text }\` / \`{ postId }\` - own messages |
| → server | \`react-post\` | \`{ postId, emoji }\` - 👍 😂 😮 😢 😭, others' messages; the same again takes it back |
| ← client | \`initial-posts\` | \`{ tourId, posts }\` |
| ← client | \`new-post\` / \`post-updated\` | a Post |
| ← client | \`poll-updated\` | a poll changed (votes, closed) |
| ← client | \`rooms-changed\` | the room board changed - reload it |
| ← client | \`chat-error\` | a message |

Photos are uploaded over HTTP (\`POST /tours/{tourId}/chat/images\`) and then announced as
\`new-post\`.`;

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
    'Cover picture, the Programfüzet PDF, the attendee Excel. (Extrák documents: see Dokumentumok.)',
  ],
  [T.gallery, "A tour's photos (from the NAS) and its recap videos."],
  [T.mailing, 'Admins writing to all attendees of a tour.'],
  [T.chat, 'The tour chat. Messages go over Socket.IO (see the introduction); photos over HTTP.'],
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
        'Authentik returns here. Creates or updates the user (role from the Authentik group), starts the session and redirects to the app.',
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
  '/tours/tour-stats': {
    get: op({ tag: T.tours, summary: 'Tour statistics', description: 'Counts and averages.' }),
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
        'Everything the tour page shows - schedule, accommodation, weather, Extrák, attendees with their payment rows.',
      params: [tourId],
      data: obj({ tour: ref('Tour') }),
      errors: [404],
    }),
    patch: op({
      tag: T.tours,
      role: 'admin',
      summary: 'Update a tour',
      description: 'Any tour fields. Setting the advance to exactly 0 marks every attendee paid.',
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
        'One reservation for one or more people. A member may sign up themselves and their family, a guest only themselves, an admin anyone. Closes when the tour starts (except for admins); refused when full. E-mails the registrant and those registered.',
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
  '/tours/{id}/attendees/export.xlsx': {
    get: op({
      tag: T.tourFiles,
      role: 'admin',
      summary: 'Attendee list as Excel',
      description: 'For the house owner: nights, price, advance, rest - grouped by family.',
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
      summary: 'A photo (original)',
      params: [tourIdT, path('filename', 'e.g. `mobil%2FIMG_1.jpg`.')],
      response: file(['image/jpeg', 'image/png', 'image/webp'], 'The original.'),
      errors: [404],
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
  '/tours/{tourId}/chat/images': {
    post: op({
      tag: T.chat,
      summary: 'Send a photo',
      description:
        'Stored as WebP (1600 px + a 480 px thumbnail, no EXIF). Limited per person per day; over the size quota the oldest photos go. Announced to the chat as `new-post`.',
      params: [tourIdT],
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
  '/tours/{tourId}/chat/images/{postId}': {
    get: op({
      tag: T.chat,
      summary: 'A chat photo',
      params: [tourIdT, path('postId', 'The message.')],
      response: file(['image/webp'], 'WebP.'),
      errors: [404],
    }),
  },
  '/tours/{tourId}/chat/images/{postId}/thumb': {
    get: op({
      tag: T.chat,
      summary: 'A chat photo thumbnail',
      params: [tourIdT, path('postId', 'The message.')],
      response: file(['image/webp'], 'WebP, 480 px.'),
      errors: [404],
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
          tour: id('The tour it belongs to.'),
          question: str(),
          options: arrayOf(str()),
          closesAt: date(),
          visibility: str('Default: secret.', { enum: ['open', 'secret'] }),
          minimumCount: int(
            'Optional: the first answer needs at least this many (1-500) - they are told when reached.',
          ),
        },
        ['tour', 'question', 'options', 'closesAt'],
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
      description: 'The Voks menu badge.',
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
        'Anyone signed up for the tour (or an admin). Shows on Voks too, and as a live card in the chat; the attendees get a notification.',
      params: [tourIdT],
      body: obj(
        {
          question: str(),
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
      description: 'Admins get every field; members name, e-mail and age only.',
      data: obj({ users: arrayOf(ref('User')) }),
    }),
    post: op({
      tag: T.users,
      role: 'admin',
      summary: 'Add a person',
      description: 'e.g. a child without an Authentik login.',
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
  '/users/me/attendance': {
    get: op({
      tag: T.users,
      summary: 'Tours I attended',
      data: obj({ tours: arrayOf(ref('Tour')) }),
    }),
  },
  '/users/me/family': {
    get: op({ tag: T.users, summary: 'My family', data: obj({ members: arrayOf(ref('User')) }) }),
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
      params: [userIdP],
      body: ref('User'),
      errors: [400, 404],
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
      description: 'Everyone with their role, attendance and paid years.',
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
      summary: 'A photo (original)',
      params: [path('category', 'The folder.'), path('filename', 'The photo.')],
      response: file(
        ['image/jpeg', 'image/png', 'image/webp'],
        'The original - a PNG keeps its transparency.',
      ),
      errors: [404],
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
      description: 'Admins also get the change history and the years already paid for (locked).',
      data: obj({ fees: arrayOf(obj({ fromYear: int(), amount: int() })), foundingYear: int() }),
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
  '/push/chat-mutes/{tourId}': {
    get: op({
      tag: T.push,
      summary: "Is a tour's Kotyogó muted for me",
      params: [tourIdT],
      data: obj({ muted: bool() }),
    }),
    put: op({
      tag: T.push,
      summary: "Mute / unmute a tour's Kotyogó",
      params: [tourIdT],
      body: obj({ muted: bool() }, ['muted']),
      data: obj({ muted: bool() }),
      errors: [404],
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
