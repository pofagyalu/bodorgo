# Bódorgó

The Bódorgó club's own website: its tours ("táborok"), chat, votes, photos, videos, music, songbook, finances and games, for the club's members and their guests. Everything is behind a login except the landing page.

One repository, two programs:

- **`client/`** — the website people see (Angular 21), live at `bodorgo.hu`
- **`server/`** — the API behind it (Node + Express + MongoDB), live at `api.bodorgo.hu`

Logins go through a self-hosted [Authentik](https://goauthentik.io/) (`oridzs.terfotozas.hu`). Everything runs on one Synology NAS.

This is the only README. It replaces the separate ones that used to sit in `client/`, `server/`, `server/tests/`, `server/scripts/input/`, `server/authentik/`, `ci/forgejo-runner/`, `docs/` and the header component's folder.

## Contents

1. [What the app does](#1-what-the-app-does)
2. [Who may do what](#2-who-may-do-what)
3. [How it is built](#3-how-it-is-built)
4. [Installing and running it locally](#4-installing-and-running-it-locally)
5. [Tests, lint and CI](#5-tests-lint-and-ci)
6. [Data and files](#6-data-and-files)
7. [The live site and deploying](#7-the-live-site-and-deploying)
8. [Running it in Docker (handing the app over)](#8-running-it-in-docker-handing-the-app-over)
9. [Authentik](#9-authentik)
10. [How some parts work inside](#10-how-some-parts-work-inside)
11. [Helper scripts](#11-helper-scripts)
12. [House rules](#12-house-rules)
13. [Still to do](#13-still-to-do)
14. [Repository history](#14-repository-history)

---

## 1. What the app does

The main menu, and what is behind each item. Page names are the Hungarian ones the site shows.

### Landing page and home (`/`)

- Logged out: the landing page with a scrolling ticker of the tours (`GET /tours/ticker`, the only data served without a login), the legal footer and the privacy notice (`/adatkezeles`).
- Logged in: the home page, with the weather forecast among other things.

### Táborok — the tours (`/taborok`)

- **The list** of all tours with a year picker, a map of where they were, and each tour's card.
- **A tour's page**: cover photo, place, dates, driving distance from Budapest, a countdown, a calendar entry, and:
  - **Sign-up** for oneself and one's family, with nights and the advance; withdrawing.
  - **Program** — the schedule day by day, with opt-ins; admins reorder it by drag and drop.
  - **Résztvevők** — who is coming, who has paid what.
  - **Photos** — the tour's album in a full-screen viewer (PhotoSwipe) with a filmstrip, single and zip download. An admin can lock a sensitive photo so only that tour's attendees see it.
  - **Videos** — the tour's recap videos, streamed from the NAS.
  - **360° panorama** — a round badge on the cover opens it in a popup.
  - **Extrák** — the tour's documents; for organizers: letters to the attendees, the Programfüzet PDF, the Excel export, the accommodation.
  - **Beszámoló** — the tour's report, written by an admin day by day; once marked Kész, attendees download it as a PDF with a wax seal.
  - **Reviews** — attendees rate a tour once it is over.
  - **Lezárás** — an admin closes a finished tour for good. From then on the tour, its programme, sign-ups, payments, documents, letters and rooms are frozen; reviews, new photos and an unfinished beszámoló stay open. There is no reopen button.
- **Paying the advance** (`/taborok/:id/befizetes`) by card, or cash recorded by an admin.
- **New tour / edit tour** (admins), including the accommodation: houses, rooms, beds.

### Kotyogó — the chat (`/chat`)

- One general room (**Általános**) for everyone, and one room per tour.
- Text, photos, reactions, `@mentions`, polls started from the chat.
- A tour's room has a weekly changing pale background from the tour's own album, and beside it the **Szobabeosztás**: who sleeps in which room. Admins drag people into rooms; everyone else watches it live.
- A tour's chat closes at midnight after the tour's last day and stays as an archive.
- Push notifications for new messages (see [10.1](#101-push-notifications)).

### Voks — votes (`/szavazasok`)

Polls for a tour's attendees or for everyone, with a "Rád vár" section for the ones still waiting for your vote. People who have not voted are reminded two hours before a poll closes.

### Média (`/media`, members only)

- **Videók** and **Fotók** — the club's videos and photos that do not belong to one tour, by category. The role manager can give each one its own title and limit who may see it.
- **Zene** — three radios played from the club's Jellyfin: **Bódorgó FM**, **Buli** and **Duruzsoló**, with a player in the header.
- **Daloskönyv** — the songbook (below).

### Daloskönyv — the songbook

Members reach it in Média → Zene (`/media/zene/daloskonyv`); guests, who have no Média, through Klub's menu (`/daloskonyv`). Same pages either way.

- The songs in alphabetical order, searchable by title, artist and lyrics; an alphabet rail; a filter by artist.
- A song's page: lyrics with the chords above the syllables, guitar or ukulele chord diagrams, transposing, letter size, the song's key and tempo, a tap-to-start auto-scroll, "played tonight" ticks, previous / random / next.
- Tuner, circle of fifths and a chord table as extra pages.
- The whole book as a PDF drawn by the server (cover, contents with links, annexes, an index by artist), and any single song as a PDF.
- An editor (ChordPro text). Pasting a song copied from a tab site converts it on the spot.
- Any logged-in user may add songs and edit their own. Only the keeper's songs are in the book PDF; the keeper can take someone's song into the book.

### Klub (`/klub`)

- **Profilom** — everyone: own data, photo, username, notification switch, futókód, the tours attended and the rank earned.
- **Áttekintés** — members: the club at a glance (money, membership fees).
- **Pénzügyek** — members read the club's books; admins add entries. Charts by period.
- **Felhasználók** — the members and the others; admins add and edit people, families, and send invitations (**Meghívók**).
- **Dokumentumok** — the club's documents with previews.
- **Beállítások** — admins: membership fee and reminders, payment methods and their fees, bank accounts, usernames, rank celebrations, chat photo quota.

### Móka — games (`/moka`)

- **Darts** — X01 (301 / 201 / 101), Cricket and High Score (the most points after a set number of rounds), scored on one phone with a keypad, followed live by the other players on their own phones; X01 and Cricket go on until everyone is placed; a leaderboard per game type. A game is visible only to its own players.
- **Kvíz** — Kahoot-style quiz games. Anyone logged in may write a quiz; players join by QR code or code, and the question is on every phone. Six kinds of question: plain, picture uncovered tile by tile, true/false, zoom-out, song (plays on the host's device) and map (drop a pin; points by distance).
- **Futókörök** — a checkpoint running race. Runners scan QR/NFC cards at the checkpoints with their phone; the app times the laps and shows results, splits and a map. **Still open only to the role manager** (see [13](#13-still-to-do)).

### Across the whole app

- **Push notifications** on phones and computers, and the site can be installed to the home screen.
- **An open app updates itself** when a newer version has been deployed (it compares its own version with `version.json`).
- **Membership fee reminders** by e-mail on the dates set in Beállítások.
- **Ranks**: reaching a new number of tours is celebrated at the next login.
- **Not in search engines**: the pages and the API both say `noindex`.

---

## 2. Who may do what

### Roles

Roles live **in the app**, not in Authentik:

| Role | Who | Sees |
| --- | --- | --- |
| `admin` | the organizers | everything, plus the editing pages |
| `member` | dues-paying club members | everything but the admin pages |
| `guest` | everyone else: family, friends, children | tours, chat, votes, songbook, games, own profile. No Média, no finances, no documents |

One admin is the **role manager**: only they can change anyone's role, and a few things are theirs alone (who may see a Média item, the songbook's book, Futókörök for now).

A person's age is sensitive: per-person ages are shown to admins only (and to oneself); averages and the age chart are fine for everyone.

### Logging in

- **Authentik only says who someone is** (e-mail, name). It says nothing about their role.
- **Only people an admin has already added can log in.** An admin adds the person in Klub → Felhasználók with the e-mail they use in Authentik; their first login links the two. Anyone else who gets through Authentik is refused.
- **A person is matched by e-mail alone**, never by Authentik's internal id. A recreated Authentik account with the same e-mail simply works. Do not delete a user's record to fix a login problem: it carries their posts, payments and family links.
- A person added by an ordinary admin starts as `guest`.
- Children and others without a login are plain records an admin creates; they can be signed up for tours by their family.

### Invitations

Klub → Felhasználók → Meghívók (admins). Everyone who has an e-mail and has never logged in can be sent their own single-use Authentik invitation link, valid 30 days: one by one, or in two batches (club members, then everyone else). The app creates the invitation through Authentik's REST API (`server/src/utils/authentikInvitations.js`) and sends the e-mail itself.

### The role manager, and handing the app over

The role manager is whoever `INITIAL_ADMIN_USER` in the live `server/.env` names (an e-mail address). At every server start that person gets the role-manager flag (`canManageRoles`) and the `admin` role, and nobody else keeps the flag. They cannot change their own role. If they have no account yet (a brand-new installation), their first login creates it.

**To hand the app over:** add the successor in Felhasználók, change `INITIAL_ADMIN_USER` in `S:\bodorgo\.env` to their e-mail, and restart the server (`cd /volume2/server && pm2 restart bodorgo`). The same line is the way back in if the role manager is ever unavailable: whoever can edit the server's `.env` can name a new one.

---

## 3. How it is built

```
 Browser ──────────────► bodorgo.hu        static files (Apache on the NAS)
    │                                        the Angular app
    │  session cookie, CORS with credentials
    ├──────────────────► api.bodorgo.hu     Nginx Proxy Manager → Node (pm2)
    │   REST + Socket.IO                      │
    │                                         ├── MongoDB (data, sessions)
    └── login redirect ► Authentik            ├── NAS folders (photos, videos, documents)
                                              ├── Jellyfin (music)
                                              ├── Resend (e-mail)
                                              ├── Stripe, Barion (payments)
                                              └── web push services
```

The client and the API are **two separate origins**. The session cookie is set and read only by the API, so the two subdomains share nothing.

### Client (`client/`)

- **Angular 21**, zoneless (no zone.js), standalone components, signals. Every route except the home page is lazy-loaded (`src/app/app.routes.ts`).
- **Angular Material + CDK** for controls and drag-and-drop; **Tailwind 3** for layout utilities; SCSS per component.
- Session-cookie auth: `auth/auth.service.ts`, an HTTP interceptor, and route guards (`auth`, `member`, `admin`, `moka`, `futokor`, `song-edit`).

| Package | Used for |
| --- | --- |
| `@angular/*`, `@angular/material`, `@angular/cdk` | the framework and its controls |
| `rxjs` | HTTP and streams |
| `socket.io-client` | chat, Szobabeosztás, quiz — live |
| `chart.js` + `ng2-charts` | every chart (finances, age chart, rings) |
| `leaflet` | maps: tours, Futókör tracks, the quiz map |
| `photoswipe` | the full-screen photo viewer |
| `quill` | the rich-text editors (beszámoló, letters, poll details) |
| `ngx-image-cropper`, `heic-to` | cropping profile photos and covers; iPhone HEIC photos |
| `canvas-confetti` | celebrations |
| `material-icons` | the icon font, self-hosted |
| `tailwindcss`, `postcss`, `autoprefixer` | styling build |
| `vitest`, `jsdom`, `@vitest/coverage-v8` | tests |
| `eslint`, `angular-eslint`, `typescript-eslint`, `prettier` | lint and formatting |

Where things are in `client/src/app/`:

| Folder | What |
| --- | --- |
| `pages/` | one folder per page: `tours`, `tour-details`, `tour-edit`, `payment`, `chat`, `szavazasok`, `media`, `daloskonyv`, `klub`, `moka` (`darts`, `quiz`, `futokor`), `home`, `homepage`, `landing-page`, `adatkezeles` |
| `components/` | larger shared pieces: `header`, `feed` (the chat), `poll-card`, `poll-create`, `tours-map`, `tour-ticker`, the charts, `photo-editor`, `crop-dialog` |
| `shared/` | small shared pieces and helpers: photo gallery, video player, music player, podium, confirm dialog, date input, formats |
| `services/` | one per API area: `tour`, `user`, `chat`, `poll`, `payment`, `finance`, `membership`, `media`, `song`, `darts`, `quiz`, `futokor`, `push`, `settings`, `version`… |
| `auth/` | login page, auth service, interceptor, guards |
| `../testing/` | test helpers |

Other files: `src/sw.js` (the push service worker), `src/manifest.webmanifest`, `src/environments/` (API address, OpenWeatherMap key), `deploy-build.js` and `sync.js` (deploying), `live.htaccess` (a copy of the live site's `.htaccess`).

### Server (`server/`)

- **Node 22+**, **Express 5**, ES modules, plain JavaScript (no TypeScript).
- **MongoDB** through **Mongoose 9**. Sessions are stored in the same database (`connect-mongo`).
- **OIDC + PKCE** login against Authentik (`openid-client`); `express-session` cookie.
- **Socket.IO** shares the Express session, so a socket knows who is connected (`session.js`).

| Package | Used for |
| --- | --- |
| `express`, `cors`, `helmet`, `compression`, `express-rate-limit`, `morgan`, `cookie-parser` | the web server and its guards |
| `mongoose`, `connect-mongo`, `express-session` | database and sessions |
| `openid-client`, `jose` | Authentik login |
| `socket.io` | live chat, rooms, quiz |
| `multer` | file uploads |
| `sharp`, `exifr` | thumbnails, photo sizes and orientation |
| `pdfkit`, `fontkit`, `qrcode` | PDFs: Programfüzet, beszámoló, receipts, songbook, Futókör cards |
| `pdfjs-dist`, `@napi-rs/canvas` | a preview picture of each club document |
| `exceljs` | Excel export |
| `archiver` | zip download of a tour's photos |
| `resend` | sending e-mail |
| `stripe` | card payments (Barion is called directly, `utils/barion.js`) |
| `web-push` | push notifications |
| `sanitize-html`, `validator`, `slugify` | cleaning and checking input |
| `winston`, `winston-daily-rotate-file` | logs, one file per day |
| `swagger-jsdoc`, `swagger-ui-express`, `@scalar/api-reference` | the API documentation page |
| `esbuild` | bundles the server into one file for deploying |
| `vitest`, `supertest`, `mongodb-memory-server` | tests |

Where things are in `server/src/`:

| Folder / file | What |
| --- | --- |
| `server.js` | starts everything: database, session, Socket.IO, timed jobs |
| `app.js` | the Express app and its routes |
| `config.js` | every setting read from `.env` |
| `routes/`, `controllers/`, `models/` | one set per area |
| `auth/` | `requireAuth`, role checks |
| `chat/` | sockets, rooms, notifications, backgrounds, poll reminders |
| `photos/` | finding and syncing photos, thumbnails |
| `music/` | the Jellyfin proxy |
| `songs/` | the songbook PDF |
| `jatekok/` | darts and quiz rules |
| `futokor/` | the running race: rules, signed cards, GPX |
| `utils/` | e-mail, payments, push, PDFs' helpers, role manager… |
| `apiDocs/` | `openapi.js`, the description of every endpoint |

The API's top-level paths: `/auth`, `/tours`, `/users`, `/payments`, `/finance`, `/membership`, `/polls`, `/chat-rooms`, `/documents`, `/media`, `/music`, `/songs`, `/jatekok`, `/futokor`, `/push`, `/settings`, `/health`, `/docs`.

**API documentation:** `https://api.bodorgo.hu/docs` (admins only) lists every endpoint. It is generated from `server/src/apiDocs/openapi.js`. Update that file with every endpoint change; a test fails if a route is missing from it.

### The rest of the repository

| Path | What |
| --- | --- |
| `.forgejo/workflows/server-tests.yml`, `ci/` | CI: lint and tests on every pull request |
| `ci/forgejo-runner/` | the CI runner's Docker setup for the NAS |
| `compose.yaml`, `.env.docker.example`, `server/Dockerfile`, `client/Dockerfile`, `docker/`, `.dockerignore` | running the whole app in Docker (section 8) |
| `handover/` | not in git: the database copy and files that travel with the app |
| `docker/HANDOVER.md` | the instructions that go on the handover stick as `READ-ME-FIRST.md` (section 8) |
| `nas/` | a copy of the NAS's hourly database backup script (section 6) |
| `server/authentik/` | the two e-mail templates Authentik uses |
| `server/scripts/` | one-off and helper scripts |
| `brand/` | logo sources (the fonts are kept locally only: their licence forbids redistributing them) |
| `.prettierrc`, `.prettierignore` | formatting rules for both sides |

---

## 4. Installing and running it locally

### What you need

- **Node.js 22.3 or newer** and npm.
- **A MongoDB** you can reach, with a database of your own (local development uses `bodorgo-dev`).
- **An Authentik application**: an OAuth2/OpenID provider (confidential client) with these redirect URIs registered: `http://localhost:8235/auth/callback` for local work and `https://api.bodorgo.hu/auth/callback` for live. The server works out its redirect URI from the request's own host, so nothing changes between environments.
- Optional, each only for its own feature: the NAS folders with photos and videos, a Jellyfin, a Resend key, Stripe/Barion test keys, VAPID keys.

### Server

```
cd server
npm install
```

Copy `src/.env.example` to `server/.env` (next to `package.json`; it is gitignored, never commit it) and fill it in. The example file lists every setting the server reads, each with an explanation; the table below is the short version.

```
npm start
```

Runs `nodemon src/server.js` and restarts on every change. It listens on `PORT`; local development uses **8235** (the client expects it there).

### Client

```
cd client
npm install
npm start
```

Runs `ng serve` on `http://localhost:4200`. `src/environments/environment.development.ts` points at `http://localhost:8235`, so start the server too. The calls are cross-origin (4200 → 8235); the server's CORS setting already allows that, so no proxy is needed — and a proxy would break the login redirect.

Both environment files need a real OpenWeatherMap key in `openWeatherApi` for the weather forecast.

### The server's settings (`server/.env`)

**Needed to start and log in**

| Name | What |
| --- | --- |
| `NODE_ENV` | `development` locally, `production` on the live server |
| `PORT` | `8235` |
| `DB_URI` | the MongoDB connection string, database name included |
| `COOKIE_SECRET` | a long random string |
| `APP_SECRET_KEY` | a long random string: encrypts the secrets kept in the database (the OIDC client secret, the Authentik API token). Keep it with the backups — a database restored under another key cannot read them |
| `AUTHENTIK_SERVER_URL`, `AUTHENTIK_PROVIDER_SLUG`, `AUTHENTIK_CLIENT_ID`, `AUTHENTIK_CLIENT_SECRET`, `AUTHENTIK_POSTLOGOUT_URI` | the Authentik provider. Set in the app (**Klub → Beállítások → OIDC szolgáltató**, the role manager only) and kept in the database, the secrets encrypted. These lines are only for getting started: the first start copies them over. **Delete them once you can log in and the tab shows them** — nothing reads them any more. Other providers can be added on the same tab, and one of them chosen as the active one |
| `LOCAL_LOGIN` | normally `false`. `true` is the **emergency login** for when the OIDC provider cannot be used: the login page asks for an e-mail and a password, and lets in only `INITIAL_ADMIN_USER` with `INITIAL_ADMIN_PASSWORD`, as admin. Set the provider up on Beállítások → OIDC szolgáltató, then switch it back (the steps are in `server/src/.env.example`) |
| `INITIAL_ADMIN_PASSWORD` | the password of that emergency login (at least 12 characters). Read from here at every try, never stored or changed in the app; with `LOCAL_LOGIN=false` it does nothing and can stay in the file |
| `CLIENT_BASE_URL` | the client's full address (`http://localhost:4200/` locally) |
| `CLIENT_ORIGIN` | comma-separated origins allowed to call the API |
| `API_BASE_URL` | this server's own public address (Barion callbacks need it) |
| `INITIAL_ADMIN_USER` | the role manager's e-mail |

**Per feature** (leave out what you do not use)

| Name | Feature |
| --- | --- |
| `AUTHENTIK_API_TOKEN`, `AUTHENTIK_INVITATION_FLOW` (optional) | invitations — set in the app too (Beállítások → OIDC szolgáltató), used from here like the other `AUTHENTIK_*` lines |
| `RESEND_API_KEY`, `RESEND_EMAIL_FROM` | sending e-mail |
| `EMAIL_REDIRECT_TO` | **local only**: every e-mail goes to this address instead of the real people. Never on live |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | push notifications |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PUBLISHABLE_KEY` | card payment of membership fees (the club's Stripe account) |
| `STRIPE_TOUR_SECRET_KEY`, `STRIPE_TOUR_WEBHOOK_SECRET` | card payment of tour advances (a second Stripe account). Without them advances cannot be paid by Stripe |
| `BARION_POS_KEY`, `BARION_ENV`, `BARION_MEMBERSHIP_WALLET_KEY`, `BARION_TOUR_WALLET_KEY` | Barion. Sandbox unless `BARION_ENV=production` |
| `PHOTOS_ROOT`, `THUMBNAILS_ROOT` | tour photos and their thumbnails |
| `MEDIA_PHOTOS_ROOT` | Média → Fotók |
| `MEDIA_ROOT` (or `VIDEOS_ROOT` / `MEDIA_VIDEOS_ROOT`) | the videos |
| `JELLYFIN_URL`, `JELLYFIN_API_KEY`, `JELLYFIN_PLAYLIST_ID`, `JELLYFIN_BULI_PLAYLIST_ID`, `JELLYFIN_HATTER_PLAYLIST_ID`, `JELLYFIN_USER_ID` (optional), `MUSIC_IMAGES_ROOT` (optional) | music |
| `OPENROUTESERVICE_API_KEY` | a tour's driving distance from Budapest |
| `FUTOKOR_TAG_SECRET` | signs the Futókör cards' links (see the warning in [10.6](#106-futókörök)) |
| `TOUR_VIDEO_EMAILS=on`, `BACKGROUND_JOBS=on` | **live only**: the "your tour's video is ready" e-mails and the timed jobs (poll reminders) |

The folder settings need a different form on each machine for the same NAS storage: the live server runs on the NAS and needs real paths (`/volume1/photo/bódorgó_táborok`), a Windows development machine needs the mapped drive (`Z:/bódorgó_táborok`).

The live `.env` is `S:\bodorgo\.env` and is maintained by hand, separately from the repository. A new setting has to be added there too.

---

## 5. Tests, lint and CI

### Commands

| | Server (`cd server`) | Client (`cd client`) |
| --- | --- | --- |
| Run the tests once | `npm test` | `npm test` |
| Re-run on change | `npm run test:watch` | — |
| With coverage | `npm run test:coverage` | `npm run test:coverage` |
| Lint | `npm run lint` | `npm run lint` |
| Formatting | `npm run format` / `format:check` | `npm run format` / `format:check` |

Both sides fail below **70 %** line and statement coverage (`server/vitest.config.js`, `client/angular.json`). The report is printed and written to `coverage/index.html`.

### Server tests (`server/tests/`)

Vitest. Safe by design:

- **Never the real database.** `globalSetup.js` starts a throwaway MongoDB in memory (the first run downloads the MongoDB binary once); every test file gets its own database, emptied after every test.
- **Never the outside world.** `setup.js` replaces e-mail, Stripe, Barion, address lookup, routes and weather with fakes, and silences the logger.
- **Never the real folders.** Uploads and receipts go to a temporary folder.

Writing one:

- `helpers/app.js` — the real Express app, plus `asUser(user)`: the headers that make a request come from that user. No header = logged out.
- `helpers/factories.js` — `createAdmin()`, `createMember()`, `createGuest()`, `createTour()`, `createReservation(tour, users)`.
- `api/` — HTTP-level tests per area (chat over a real Socket.IO connection, login with a faked Authentik…). `unit/` — pure calculations.

```js
import request from 'supertest';
import { app, asUser } from '../helpers/app.js';
import { createMember, createTour } from '../helpers/factories.js';

it('lists tours for a member', async () => {
  await createTour({ title: 'Mátra' });
  const res = await request(app)
    .get('/tours')
    .set(asUser(await createMember()));
  expect(res.status).toBe(200);
});
```

### Client tests

Angular's Vitest-based test builder, in jsdom; no browser needed. Specs sit next to the code (`*.spec.ts`).

- Helpers in `client/src/testing/`: `http.ts` (`itSendsRequests` request tables), `component.ts` (`respond({'GET /path': body})`, `logIn()`, `FakeSocket`, `pageTesting()`), `fixtures.ts` (`makeTour`, `makePayment`).
- jsdom stand-ins (media, canvas, `matchMedia`, observers) are in `src/test-setup.ts`. `matchMedia` reports "reduced motion" there so no spec starts real confetti.
- `vi.mock` of modules does not work under the Angular test builder. Stub through dependency injection, spies, or by setting a field.

### CI (Forgejo Actions)

`.forgejo/workflows/server-tests.yml` runs on every pull request and on every push to `main`: a **lint** job (Prettier, ESLint), then a **test** job (tests with the coverage minimum). Each job checks only the side that changed (`ci/changed-sides.sh` decides); the jobs themselves always run, because branch protection on `main` requires both by name. A pull request with a lint error or a failing test cannot be merged. (The workflow keeps its old name, `server-tests`, because the required checks are named after it.)

### Setting up the CI runner on the NAS

Forgejo only hands out the jobs; the **runner**, a small container on the NAS, picks them up and runs each in a fresh `node:22-bookworm` container. One job at a time, at most 4 GB of memory each; a run takes a minute or two.

1. **Turn Actions on.** Forgejo → the `bodorgo` repository → Settings → enable **Actions**. (If the option is missing, Actions is off for the whole Forgejo: set `[actions] ENABLED = true` in its `app.ini` and restart it.)
2. **Create a registration code.** Forgejo → Site Administration → Actions → Runners → Create new runner → copy the code.
3. **Put the runner on the NAS.** Create a folder (e.g. `docker/forgejo-runner`), copy `ci/forgejo-runner/docker-compose.yml` and its `data` folder into it, replace `PASTE-THE-CODE-HERE` in `docker-compose.yml` with the code, then create a project from it in Container Manager (or a stack in Dockge). On its first start it registers itself and shows up as **Idle** in Forgejo.
4. **Try it.** Open a pull request; the repository's Actions tab shows the run. The first run is the slowest.
5. **Block merging while the tests fail.** Repository → Settings → Branches → add a rule for `main` → require status checks → choose the `server-tests` checks.

Inside the LAN, `forgejo.terfotozas.hu` has to point at the reverse proxy's LAN address (`192.168.1.81`): from the NAS the public address is not reachable. `docker-compose.yml` (`extra_hosts`) and `data/config.yml` (`--add-host`) already do that; update both if the address changes.

---

## 6. Data and files

### Databases

One MongoDB server (a container on the NAS), separate databases with separate users:

| Database | Used by | User |
| --- | --- | --- |
| `bodorgo` | the live server | `bodorgo_app` (read/write on `bodorgo` only) |
| `bodorgo-dev` | local development | `bodorgo_dev` (read/write on `bodorgo-dev` only) |

Sessions live in whichever database the server is connected to, so switching takes only the `.env` change.

- Scripts run from `server/` with the local `.env` touch **`bodorgo-dev`**, not production.
- To run a script against production, give it the live connection string: `DB_URI="<from S:/bodorgo/.env>" node scripts/...`
- To refresh dev from production: `node scripts/refreshDevDb.js` (dry run), then `--go`.

### Where files live

Uploaded files stay on the disk of the machine that received them. **Copying a database between dev and live does not bring its files along** — copy the folders too, or cards will point at missing files.

| What | Where |
| --- | --- |
| Profile photos, tour covers | in the database (`userphotos`, `tourcovers`), resized in the browser before upload |
| Club documents | `server/documents/`; previews in `documents/previews/` (each server makes its own) |
| A tour's Extrák | `server/documents/tours/<tourId>/` |
| Quiz pictures, GPX tracks | `server/documents/quiz-images/`, `server/documents/gpx/` |
| Chat photos | `server/chat-images/`, under a size quota set on Beállítások |
| Tour photos | on the NAS: `PHOTOS_ROOT/<tour's folder>/`; thumbnails in `THUMBNAILS_ROOT` |
| Média photos | on the NAS: `MEDIA_PHOTOS_ROOT/<category>/` |
| Videos | on the NAS, in the Jellyfin library, streamed from there |
| Videos' small copies | `THUMBNAILS_ROOT/_videos/<series folder>/…/<name>.<original's size>.mp4`, made by ffmpeg (`FFMPEG_PATH`) when an admin asks for one; found by their place alone, nothing in the database |
| Music | in Jellyfin; song pictures cached in `THUMBNAILS_ROOT/_music/` |

`documents/` and `chat-images/` are never in git and never copied by a deploy. `server/public/` is no longer served.

### Backups

On the NAS, an hourly scheduled task dumps MongoDB (all databases) and the NAS's PostgreSQL (Authentik, Forgejo and others) into `/volume2/backups/bodorgo-db/` — 24 rolling hourly dumps and 60 daily ones. Authentik's database is dumped once more on its own (`authentik-NN.sql.gz`, without owners or grants), so the app's logins can travel without the other databases. The script is `/volume2/backups/scripts/bodorgo-db-backup.sh`; a copy is kept in `nas/bodorgo-db-backup.sh` — after changing the one on the NAS, update the copy. Hyper Backup sends the `docker` and `backups` folders, encrypted, to Backblaze; the whole NAS is also backed up to a USB disk. A restore was tested on 2026-09-27.

---

## 7. The live site and deploying

### How it is laid out

- `bodorgo.hu` (client) and `api.bodorgo.hu` (server) are **separate origins**, both on the same Synology NAS.
- **Client:** static files in `W:\bodorgo` (a mapped network drive), served by Apache on the NAS. A finished copy is live at once; nothing to restart.
- **Server:** one bundled `server.js` in `S:\bodorgo` (= `/volume2/server/bodorgo` on the NAS), run by **pm2** as app `bodorgo`.
- **Nginx Proxy Manager** (a container on the NAS) forwards `api.bodorgo.hu` to `192.168.1.94:8235`.

> **DNS: `api.bodorgo.hu` and `bodorgo.hu` must stay "DNS only" (grey cloud) in Cloudflare.** Nginx Proxy Manager has a global GeoIP allow-list that checks the visitor's country from the connecting address. If Cloudflare proxies the request, nginx sees Cloudflare's own address, places it in the wrong country, and answers `403` before the request ever reaches Node (in NPM's access log `$upstream_status` is blank for these). To use Cloudflare's proxy, the GeoIP check would first have to read `$http_cf_connecting_ip` instead of `$remote_addr`.

### Before any deploy

- Deploy only what has been merged to `main`, from a clean working folder.
- Let the change be tried in the app first, even if the tests pass.

### Deploying the server

```
cd server
npm run build
```

`build.js` bundles `src/server.js` into one `dist/server.js` with esbuild; `sync.js` copies it to `S:\bodorgo` together with `assets/` and the few packages that cannot be bundled (pdfkit with its dependencies, and the **Linux** builds of sharp and of pdf.js's canvas, fetched for the NAS since this machine is Windows). `server.js` is copied last, because pm2 restarts the server the moment it changes.

- `.env` is **not** copied. A new setting must be added to `S:\bodorgo\.env` by hand.
- **The bundle is CommonJS on purpose**, although the repository is ESM: `S:\bodorgo` has no `package.json`, so Node treats `.js` there as CommonJS. Do not add `format: 'esm'` to `build.js` without solving that. pdfkit and sharp are kept out of the bundle for a related reason (their ESM builds use `import.meta.url`, which crashed the bundled server at start).
- Check afterwards: the "App is listening" line in `S:/bodorgo/logs/app-YYYY-MM-DD.log`, and a real login. Errors are in `error-*.log`.

### pm2 on the NAS

- Runs as user **gazda**, not root (`sudo pm2 list` shows nothing).
- Defined in `/volume2/server/ecosystem.config.js` (= `S:\ecosystem.config.js`, outside the repository).
- `NODE_ENV=production` is set in **both** the ecosystem file and `S:\bodorgo\.env` (pm2's value wins): HTTPS-only session cookie, no error details sent to the browser.
- **Watch** is on, so a new `server.js` or `.env` restarts it. `ignore_watch` lists `node_modules, logs, public, thumbnails, documents, assets, chat-images` — **a new folder the server writes into must be added there**, or every write restarts the server.
- If a deploy does not seem live (file watching over the network share can miss a change): `pm2 list`, then `pm2 restart bodorgo`.
- After changing the ecosystem file: `cd /volume2/server && pm2 delete bodorgo && pm2 start ecosystem.config.js && pm2 save`.
- It survives a reboot through the systemd service `pm2-gazda.service`, which restores the list saved by `pm2 save`. If a DSM update ever drops that service, a DSM Task Scheduler boot-up task running `pm2 resurrect` does the same.

### Deploying the client

```
cd client
npm run deploy
```

`deploy-build.js` runs `ng build` with the build's version written into it (the commit's date and first seven digits, e.g. `2026.10.01 · adc1c34`), writes a Brotli copy (`.br`) beside every script, stylesheet and SVG, and finally `version.json`. `sync.js` then copies `dist/client/browser/` to `W:\bodorgo`.

`sync.js` protects the live site: it refuses to run unless a finished build less than 15 minutes old is there, copies the new files in first, and only then removes what the new build no longer has. It keeps `.htaccess`. `npm run sync` copies an existing build again without rebuilding.

Do not re-add Angular's `i18n` / `localize` build options unless the app really gets translations: a localized build's `index.html` has `<base href="/hu/">`, and on a site served from the root every script then answers with `index.html` ("MIME type text/html" in the console).

### The live site's `.htaccess`

`W:\bodorgo\.htaccess` exists only on the live site; a deploy never writes it. A copy is kept in `client/live.htaccess` — after changing the live file, update the copy. It sets:

- **Caching:** files with a content hash in their name for a year; `index.html`, `version.json`, `manifest.webmanifest`, `sw.js` never cached; other pictures and fonts for an hour.
- **gzip** for text formats, and **Brotli** by handing out the `.br` copies to browsers that accept them (Apache there has no Brotli module).

A syntax error in `.htaccess` takes the whole site down. Back the file up first, keep everything inside `<IfModule>`, and check right after with `curl -sI -H "Accept-Encoding: br, gzip" https://bodorgo.hu/<file>`.

---

## 8. Running it in Docker (handing the app over)

The NAS setup in section 7 is how the live site runs today. This section is the other way to run the same app: on **any machine that has Docker**, with nothing installed by hand. It is meant for handing the app over, and for trying a copy of it.

`compose.yaml` starts three containers:

| Container | What | Image |
| --- | --- | --- |
| `mongo` | the database | `mongo:8.0` (the version the live database runs) |
| `api` | the server | `bodorgo-api`, built by `server/Dockerfile` |
| `web` | the website | `bodorgo-web`, built by `client/Dockerfile`: the built app served by Apache with the live site's own `.htaccess` |

**The images hold only code.** No settings, no passwords, no uploads and no database copy are ever built into them (`.dockerignore` sees to that), so an image can be given to anyone. The data travels beside them, in the `handover/` folder, which is never in git.

**Not in the containers**, because the app only talks to them:

- **Authentik** — nobody can log in without one. Keep using the existing one, or set up a new one as in section 9.
- **The HTTPS reverse proxy** in front of the two ports.
- **Jellyfin** (music), and the accounts at Resend, Stripe, Barion, openrouteservice and OpenWeatherMap.

### What has to be handed over

- [ ] **The code**: this repository.
- [ ] **The database copy**: one `mongodump --archive --gzip` file. The NAS's hourly backup file (`bodorgo-db/hourly/mongo-NN.archive.gz`) is exactly that.
- [ ] **The uploaded files** from the old server's folder: `documents/` and `chat-images/`. The database only holds their names. (`thumbnails/` is worth copying too, into `THUMBNAILS_DIR`: the photos' thumbnails are made again by "Új média felfedezése" in minutes, but the videos' small copies in `thumbnails/_videos/` take hours each.)
- [ ] **The photo and video folders**: tour photos, Média photos, videos.
- [ ] **The settings**: the old `server/.env`. Three values must stay exactly as they were:
  - `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` — or every phone has to switch notifications on again;
  - `FUTOKOR_TAG_SECRET` — or the printed Futókör cards stop working. If it was never set, the cards were signed with `COOKIE_SECRET`: then that one must stay;
  - `INITIAL_ADMIN_USER` — until the new role manager is named.
- [ ] **Authentik**: the client id and secret, and the new addresses added to the provider's Redirect URIs.
- [ ] **The outside accounts**: Resend (the sender's domain), Stripe (its webhook must point at the new API address), Barion, the DNS records.

### The handover folder (for a USB stick)

One command gathers all of the above except the photos and videos and what the server made from them (`thumbnails/`), from the owner's machine (Docker Desktop running, the NAS shares mapped):

```
cd server
node scripts/makeHandover.mjs
```

It makes `D:\bodorgo-handover\bodorgo-handover-<today>\` (`--out` for another place, `--only db,secrets` for some steps only):

- `source/` — the last commit as a zip, and `main`'s history as a git bundle. Only what is committed.
- `images/` — `bodorgo-api` and `bodorgo-web` built from that same commit for the live addresses, with `mongo:8.0`, in one `docker save` file. The local try-out's images keep their names.
- `db/` — a fresh dump of the production database, loaded into a throwaway database to prove it restores.
- `files/` — the live server's `documents/` and `chat-images/`.
- `secrets.7z` — the live `.env`, a ready `.env` for `compose.yaml`, the pm2 file, and Authentik's database dump with its stack's two files; encrypted with a password 7-Zip asks for. Keep the password apart from the stick.
- `READ-ME-FIRST.md` — how to start the app from the folder, made from `docker/HANDOVER.md`; and `CONTENTS.txt` with sizes and checksums.

Run it again whenever the copy should be fresh — each day gets its own folder.

### Setting it up

1. **Install Docker** (Docker Desktop, or Docker Engine with the compose plugin) and get the repository.

2. **Docker's settings.** Copy `.env.docker.example` to `.env` (next to `compose.yaml`) and fill it in: the database password, the two ports, the API's public address, and where the photo and video folders are on this machine.

3. **The app's settings.** Copy `server/src/.env.example` to `server/.env` and fill it in (or bring the old one). The lines marked *[Docker sets this]* — port, database address, folders — are set by `compose.yaml`; what `server/.env` says for them is ignored.

4. **The database copy.** Put the one dump file into `handover/db/`. It is loaded once, the first time the database starts empty. If the file holds several databases, `DUMP_DB` in `.env` says which one to take. The old place's logins (`sessions`) are left out.

5. **Start it.**

   ```
   docker compose up -d --build
   docker compose logs mongo
   ```

   The first start builds the two images (a few minutes). In the database's log look for **`bodorgo: database copy loaded`** and the line before it, `… document(s) restored successfully. 0 document(s) failed`. If it says the loading failed, fix the cause and start over with `docker compose down -v` (this deletes the new, still empty volumes) and `up` again.

6. **The uploaded files.** Copy the old server's two folders into the running container, then give them to the user the server runs as:

   ```
   docker compose cp ./documents/. api:/app/documents/
   docker compose cp ./chat-images/. api:/app/chat-images/
   docker compose exec -u root api chown -R node:node /app/documents /app/chat-images
   ```

7. **The reverse proxy.** Point the site's address at `WEB_PORT` and the API's address at `API_PORT`, both over HTTPS. Three things matter:
   - **WebSockets** must be let through to the API (chat, quiz and darts use them).
   - **The two addresses must be under one domain**, like `example.org` and `api.example.org`. The login cookie is only sent between addresses of the same site.
   - With `NODE_ENV=production` the cookie is HTTPS-only: over plain HTTP nobody stays logged in.

8. **Authentik.** Add `https://<API address>/auth/callback` to the provider's Redirect URIs, and set `CLIENT_BASE_URL`, `CLIENT_ORIGIN` and `API_BASE_URL` in `server/.env` to the new addresses. The provider's own settings (address, client ID and secret, where a logout lands) are on **Klub → Beállítások → OIDC szolgáltató**; a restored database brings them along, readable only with the same `APP_SECRET_KEY`. Without an Authentik at all: `LOCAL_LOGIN=true` and `INITIAL_ADMIN_PASSWORD` let the role manager in with a password.

9. **Log in** as the person `INITIAL_ADMIN_USER` names. Then press **Új média felfedezése** once to make the photos' thumbnails.

### Trying it on your own machine

No proxy and no HTTPS needed: in `server/.env` keep `NODE_ENV=development` and the `localhost` addresses, and in `.env` set `PUBLIC_API_URL=http://localhost:8235`. The site is then at `http://localhost:<WEB_PORT>` — which must be the address `CLIENT_BASE_URL` and `CLIENT_ORIGIN` name.

A try-out started from a copy of the live database is a real copy of real people's data:

- keep `EMAIL_REDIRECT_TO` set, so no e-mail reaches them;
- leave `BACKGROUND_JOBS` and `TOUR_VIDEO_EMAILS` off;
- set `DUMP_SKIP=sessions pushsubscriptions` in `.env`, so it cannot send notifications to their phones.

### Living with it

| To | Do |
| --- | --- |
| See what is running | `docker compose ps` |
| Read the server's log | `docker compose logs -f api` (the daily files are in the `logs` volume, `/app/logs`) |
| Stop / start | `docker compose stop` / `docker compose up -d` |
| Change a setting | edit `server/.env`, then `docker compose up -d` |
| Update to newer code | `git pull`, then `docker compose up -d --build` |
| Run a helper script | `docker compose exec api node scripts/<name>` |
| Open a database shell | `docker compose exec mongo mongosh -u <user> -p --authenticationDatabase admin bodorgo` |
| **Delete everything**, data included | `docker compose down -v` |

**The API's address is built into the website.** After changing `PUBLIC_API_URL`, rebuild: `docker compose up -d --build web`.

**The version** the app shows (bottom of the page) comes from `BUILD_COMMIT` and `BUILD_DATE` in `.env`. Before a build, set them from git: `git rev-parse --short=7 HEAD` and `git log -1 --format=%cd --date=format:%Y.%m.%d`. An open app reloads itself when the version changes.

**Backing up.** Everything that matters is in the Docker volumes `mongo-data`, `documents` and `chat-images` (plus the photo and video folders, which are yours anyway). A database backup, in the same format the restore takes:

```
docker compose exec mongo sh -c 'mongodump -u "$MONGO_INITDB_ROOT_USERNAME" -p "$MONGO_INITDB_ROOT_PASSWORD" --authenticationDatabase admin --db "$MONGO_DB" --archive=/tmp/bodorgo.archive.gz --gzip'
docker compose cp mongo:/tmp/bodorgo.archive.gz ./bodorgo-backup.archive.gz
```

Schedule that, and a copy of the volumes, on whatever the new machine uses for backups. Nothing does it by itself.

**Without the source.** The images can be moved as files: `docker save -o bodorgo-images.tar bodorgo-api bodorgo-web mongo:8.0`, then `docker load -i bodorgo-images.tar` on the other machine. `compose.yaml`, `docker/`, the two settings files and `handover/` are still needed beside them. Remember that `bodorgo-web` only works for the API address it was built with.

### How it differs from the NAS setup

- The server runs its source (`node src/server.js`), not the one-file bundle: inside a Linux image npm installs every package for Linux itself, so nothing is shipped by hand.
- No pm2: Docker restarts a container that stops (`restart: unless-stopped`) and waits for the database before starting the API.
- The container's clock is set to Budapest time (`TZ`), like the NAS.
- The website gets the same caching and Brotli rules as live, from `client/live.htaccess`.

---

## 9. Authentik

Authentik (`oridzs.terfotozas.hu`) is set up by hand in its admin UI. What the app relies on:

### Application and access

- An OAuth2/OpenID provider and application for Bódorgó.
- The group **`bodorgo`** is bound to the application, so only its members reach the app. Both sign-up paths below put new people into it.
- The service account **`bodorgo-app`** with the role `bodorgo-invitations` owns the token in `AUTHENTIK_API_TOKEN`. The role may: add / view / delete **Invitation** (Felhasználók → Meghívók), view **User** (finding a person by e-mail), view / delete **Authenticated Session** (Bejelentkezések: the device list and logging out, added 2026-10-15).

### Flows

- **`enrollment-invitation`** (the invitation links): 10 invitation check (*continue without invitation* off) → 20 prompt (username, name, e-mail, password twice; policy `password-complexity-bodorgo`, at least 15 characters) → 30 user write (inactive, internal, group `bodorgo`) → 35 e-mail verification (activates the user) → 40 login → 50 redirect to `https://api.bodorgo.hu/auth/login`, so the person lands in the app logged in.
- **Google source:** matches an existing user by identical e-mail. Authentication flow `default-source-authentication`; enrollment flow `default-source-enrollment` = 0 prompt (username, e-mail, name, no password) → 1 `bodorgo-source-enrollment-write` (active, internal, group `bodorgo`) → 2 login.
- **`bodorgo-logout`** (the provider's invalidation flow): logs out of Authentik too and returns to `AUTHENTIK_POSTLOGOUT_URI`.

### E-mail templates

`server/authentik/` holds the two templates Authentik sends:

- `bodorgo-email-megerosites.html` — "confirm your e-mail", in the invitation sign-up.
- `bodorgo-jelszo-visszaallitas.html` — "set a new password". It says the link is valid for 30 minutes, which is the recovery stage's token expiry; change both together.

The copies Authentik actually uses are on the NAS in `/volume2/docker/authentik/custom-templates/`; after editing one here, copy it there. Their logo is served by the client (`client/src/assets/images/oridzsinator-logo.png`).

The invitation e-mail itself is sent by the app through Resend; Authentik's own e-mails go through Authentik's SMTP. The two senders differ on purpose.

### Running it

- Authentik runs as a Dockge stack on the NAS: `/volume2/docker/dockge/stacks/authentik/compose.yaml`, with its `.env` beside it. (The `compose.yaml` in `/volume2/docker/authentik` is an unused leftover.)
- **Locked out of Authentik?** On the NAS: `sudo docker exec -it authentik-server ak create_recovery_key 10 akadmin` prints a one-time recovery link that logs in without the login flow.
- `AUTHENTIK_LISTEN__TRUSTED_PROXY_CIDRS` in the stack's `.env` must include both the reverse proxy and the Docker gateway (`192.168.1.81/32,172.22.0.1/32`). Without the gateway Authentik sees every visitor as the same address — which, with a reputation policy on the login flow, once locked everybody out (2026-10-04).
- Forgejo's web login also goes through Authentik (application `forgejo`; a person needs the `gitadmin` / `gituser` entitlement, otherwise Forgejo shows "account suspended"). Git over SSH still uses the hardware key.

---

## 10. How some parts work inside

### 10.1 Push notifications

A website can show real system notifications through the **Web Push** standard, with no app store and no cost. The user allows notifications once per device; the browser gives the site a private address at its push service (Google, Mozilla or Apple). When something happens, the server posts a small encrypted message to that address, and the site's **service worker** shows it.

```
 Browser (per device)                    Server                    Push service
 Profilom: switch on ──► permission ──►  POST /push/subscriptions
   subscribe() returns an address   ──►  stored (PushSubscription)
                                         new chat post ──► rules ──► webpush.send ──► device
 sw.js wakes up, shows the notification ◄──────────────────────────────────────────┘
 tap ──► opens /chat?tabor=<tour>
```

- **Service worker** (`client/src/sw.js`): shows the notification on `push`, opens the right page on `notificationclick`. It does **no** offline caching. Do not run `ng add @angular/pwa` over it.
- **Manifest** (`client/src/manifest.webmanifest`): makes the site installable. **On iPhone this is required**: web push works only for a site added to the Home Screen and opened from there (iOS 16.4+).
- **VAPID keys** (`.env`): the server signs every message with its own key pair. A device subscribed with one pair can only be reached with that pair, so the keys must never change. Without keys, push is simply off.

**The chat's rules** (`server/src/chat/chatNotifications.js`), so phones do not ring at every message:

1. **One buzz, then quiet until read.** Further messages update the same notification silently ("3 új üzenet"). Once the person opens the chat, the next message buzzes again.
2. **Nothing while watching.** Whoever has that chat open and visible gets nothing.
3. **Mentions always get through**, even in a muted chat. Usernames are 3–40 letters, numbers, `.`, `_` or `-`, unique ignoring case and accents, so `@bela` means Béla (`server/src/utils/usernames.js`).
4. **Muting.** The bell in the chat's corner mutes one chat for oneself, except for messages that name you.

"Read", "buzzed" and "muted" are remembered per user per room (`ChatReadState`). A device the push service reports as gone is deleted automatically.

**Adding another kind of notification:** call `sendPushToUsers(userIds, { title, body, tag, url })` from `server/src/utils/push.js`, with a distinct `tag` per kind of thing so repeats replace each other.

**When it does not show up:** notifications off for the browser in the operating system, or Do not disturb; the site blocked in the browser (re-allow at the padlock); iPhone not opened from the Home Screen icon; Android battery saver delaying it. After changing `angular.json`, restart `ng serve`, otherwise `/sw.js` answers 404.

### 10.2 Tour photos

- Every image request goes browser → API → session check → the tour's recorded photo list → the file on disk. The browser never sees a folder path, only a tour id and a file name, checked against that tour's own list.
- One NAS folder per tour, named `<4-digit code>_<place>_bodorgo_<roman numeral>`; the numeral is the tour's `order`.
- `tour.images` holds `{ filename, width, height, restricted }` (PhotoSwipe needs the sizes up front). `images` and `sourceFolder` are `select: false`, so they never leak through other tour endpoints.
- Thumbnails (`.webp`) are made when photos are discovered, not at request time. A missing thumbnail falls back to the full image.
- **Új média felfedezése** (an admin's button, never on a schedule) links new tour folders, syncs every album and the Média categories, and e-mails attendees about a newly added recap video.
- **"Új" for the admins:** a photo or video a discovery has added carries a red **Új** tag for 14 days (`server/src/utils/newMedia.js`), with a count beside its Média category and on the tour's album badge — so whoever pressed the button finds what it brought. Nobody else gets it. Photos keep the time on their own record (`addedAt`); videos are not stored, so the run notes when it first met each file (`VideoSeen`). The first run after this was introduced only takes stock of the videos: none of them is new.
- **Restricted photos:** visible to admins and that tour's attendees only. For anyone else the photo is left out of the list and answers exactly like a file that does not exist.
- PhotoSwipe's script is lazy-loaded. It resolves its gallery elements once, at `init()`, so it has to be initialized after Angular has rendered them.

### 10.3 Videos

Streamed straight from the Jellyfin library's folder with byte-range requests (that is why CORS allows the `Range` header). A tour's recap videos are matched by the tour number the file name starts with — `10 - Sarud (2017) - Directors Cut - S06E01.mp4` is tour #10's — so a correctly named file dropped into the folder shows up on its tour's page.

### 10.4 Music

The server proxies Jellyfin, so its key never reaches the browser. The playlists are loaded at server start; after that only the admin's refresh button on each page (or a restart) reloads them. A new radio = an entry in `PLAYLISTS` in `server/src/music/jellyfin.js`, its `.env` id, and a page. Jellyfin drops requests when asked for many artists at once, so artist photos are looked up one by one.

### 10.5 Daloskönyv

- Songs are stored as **ChordPro** text. Notation is Hungarian (H = B, B = B♭), minors in lower case.
- The parsing, chord, chord-shape and key logic is written once, in the client (TypeScript), and compiled for the server's PDF by `server/scripts/buildSongText.mjs` into `server/src/songs/songText.js` (generated, committed). **Change the client files, then rerun the script.**
- A line `{define: D7 base-fret 3 frets x 3 2 3 1 x fingers 0 3 2 4 1 0}` (ChordPro's own) gives that chord its own shape in the song - on the song page and in both PDFs. Six frets are a guitar shape, four a ukulele one; `fingers` is optional and is drawn into the dots. A transposed song falls back to the songbook's shapes.
- A line `{screen}` means: from here to the end of the song the chords are for the screen only and stay out of both PDFs; `{print}` switches them back on.
- A song's key is worked out from its chords; the editor's Hangnem field overrides it until the chords next change.
- "Played" ticks, letter size and scroll pace are remembered per device.
- **The songs are corrected by hand on the live site.** Never re-import or overwrite them from dev.
- A trap: the client has Tailwind, so a component class named like a Tailwind utility (`contents`, `block`, `hidden`, `flex`, `grid`…) silently gets that utility's CSS.

### 10.6 Futókörök

- **Cards:** each checkpoint is a card with a QR code (and an NFC sticker) whose link is `<site>/fk/<token>`. The token is signed with `FUTOKOR_TAG_SECRET`.

  > **`FUTOKOR_TAG_SECRET` must be set in the live `.env` before cards are printed and never changed afterwards**, or every printed card stops working. Cards must be made and printed on the live site: their links point at the site that made them. The `/fk/` address is printed on the cards and must never change.

- **Rules of a run** are in one pure file, `server/src/futokor/runRules.js`, which the client imports too, so a phone can decide offline. This is the one exception to "rules live only on the server".
- **Runner:** a logged-in phone, or a 4-digit **futókód** typed once at the START card. Every user has one (on Profilom).
- **Courses:** a tour's course (admins, using the club's cards) or anyone's own "instant" track with its own printable cards (Pályaszerkesztő). A track is a GPX file, kept in a shared GPX store; checkpoints are placed on the map.
- **Results:** per course — podium, everyone by best lap, splits, filters. Each course stands alone; tours are never compared with one another.
- **Élő követés:** a runner may opt in to show their place on the map during a run. Only the latest position is kept, never a trail, and only logged-in users see it.

### 10.7 Payments

- Two purposes, two destinations: **membership fees** go to the club's account, **tour advances** to the organizer's. Hence two Stripe accounts and two Barion wallets.
- The payer chooses the gateway and pays its fee, shown before paying: charge = (sum + fixed fee) / (1 − percent), so the full sum arrives. Fees and on/off per gateway are set on Klub → Beállítások → Fizetési módok. A fee of 0 turns the surcharge off.
- Stripe's webhook needs the raw request body, so its route is registered before the JSON body parser (`app.js`).
- Cash recorded by an admin always remains possible.

### 10.8 The soap bubble in the main menu

The main menu has one bubble behind the selected item. On hover it floats to the hovered item, stretches to its width and wobbles; when the mouse leaves, it floats back. The code is in `client/src/app/components/header/` (`header.html`, `header.ts`'s `placeBubble()`, `header.scss`'s `.menu-bubble` and `.menu-bubble-skin`).

- **One bubble for the whole menu**, absolutely positioned inside the menu, with `pointer-events: none` and `aria-hidden`. It is moved and resized instead of showing and hiding a box per item.
- **Measuring:** the target is the hovered item, or else the `.active` one. Its `offsetLeft/Top/Width/Height` are applied as `transform: translate(...)`, `width` and `height`.
- **Movement is done by CSS transitions**, not by code. The easing curve's `y1` is above 1 (`cubic-bezier(0.34, 1.4, 0.55, 1)`), so it overshoots and settles — the springy feel. The resize takes a little longer than the move (0.65 s vs 0.55 s), so the bubble looks stretched while it travels.
- **The wobble** is a separate `element.animate()` call on the inner element. Two elements, because the outer one already uses `transform` for position: one element per kind of motion.
- **Appearing in place** (from the home page, where nothing is selected): transitions off, jump, `void bubble.offsetWidth` to force the browser to apply that now, transitions back on, fade in.
- **Kept in place** by `mouseenter` / `mouseleave`, `afterEveryRender` (route changes, the Voks badge changing an item's width), `document.fonts.ready` and window resize. `placeBubble()` returns at once when nothing changed, which also stops the wobble replaying.
- **The soap look:** a radial highlight over a rainbow gradient three times wider than the bubble, slowly sliding back and forth.
- **Reduced motion:** with the operating system's "reduce motion" on, the bubble only fades between items.

To tune it: raise the `1.4` / `1.5` for more bounce, lengthen the durations for a floatier feel, widen the gap between them for more stretch.

---

## 11. Helper scripts

In `server/scripts/`, run from `server/` (`node scripts/<name>`). With the local `.env` they work on the dev database. Many have a dry run by default and need `--go` to change anything.

**Adding a tour's data by hand**

```
node scripts/addTour.js scripts/input/tour-32.json
node scripts/addSchedule.js <tourId> scripts/input/events-32.json
node scripts/importAttendance.js <tourId> scripts/input/attendance-32.json
```

Put the JSON files in `scripts/input/`. `example-tour.json`, `example-events.json` and `example-attendance.json` there are committed templates to copy; everything else in that folder is gitignored working data.

**Others worth knowing**

| Script | What |
| --- | --- |
| `refreshDevDb.js` | refreshes the dev database from production |
| `makeHandover.mjs` | makes the handover folder for a USB stick (see [8](#8-running-it-in-docker-handing-the-app-over)) |
| `buildSongText.mjs` | recompiles the songbook logic for the server's PDF |
| `buildQuizMap.mjs` | rebuilds the quiz's bundled map |
| `matchTourFolders.js`, `syncTourImages.js` | link photo folders to tours, sync one tour's album |
| `attachFutokorTrack.mjs`, `futokorCourses.mjs`, `futokorResults.mjs`, `gpxInfo.mjs` | Futókör courses and tracks |
| `resetLogin.mjs` | makes a person read "never logged in" again, so they can be re-invited |
| `userByEmail.mjs`, `userReferences.mjs`, `familyOf.mjs`, `addFamilyMember.js`, `createFamily.js` | looking up and arranging people |
| `removeMembershipPayment.mjs`, `checkMembershipPayments.js`, `checkLatestPayment.js` | payments |
| `jellyfinPlaylistInfo.mjs`, `hatterTitles.mjs` | music playlists |
| `testPush.js`, `checkChatPush.js` | push notifications |
| `makeAppIcons.mjs` | the app's icons |

The `migrate*`, `backfill*` and `importSongsFromOdt.mjs` scripts were one-off steps that have already been run on live; they are kept as a record.

---

## 12. House rules

How the work on this app is done. Following them keeps it consistent.

- **Every endpoint change also updates `server/src/apiDocs/openapi.js`**, descriptions included.
- **A feature that changes a tour's data must respect Lezárás**: add `tourOpen` to its route and hide its control when `tour.closed`.
- **Any path that changes roles must check `req.user.canManageRoles`.** Never bring back role sync from Authentik.
- **Per-person age is for admins only**, on the server too.
- **No outside service, provider, CDN or library without the owner's OK first.**
- **Charts** are made with Chart.js / ng2-charts, registering only the pieces that chart needs.
- **Phone first, but desktop gets its own wide layout**, never a narrow centred phone column. The first check is on an Android phone about 384 CSS px wide.
- **Sizes in `rem`**, not `px`, in the client's CSS.
- **Choosing one of many**: a compact button and a panel showing every option, not a wheel.
- **No underlined links; never purple.**
- **Changes go through a pull request** on Forgejo, merged by the owner, then deployed (server and client as needed).

---

## 13. Still to do

Collected from everything open so far. Items marked *(check)* may already be done — confirm before working on them.

### Before and at the launch (planned around 2026-10-20)

- [ ] Test the **Google sign-up path** end to end with a Google account that is not in Authentik yet.
- [ ] A second person's test of the whole invitation path.
- [ ] Confirm the **logout** flow lands on `bodorgo.hu` *(check)*.
- [ ] **Send the invitations** in two batches: club members first, everyone else in the following days.
- [ ] After the mass send: remove the Meghívók tab; move the per-person invite icons into the Klubtagok and A többiek tables, and the intro text with "Próba e-mail magamnak" to Beállítások.
- [ ] Authentik cleanup: delete the old `bodorgo-admin` / `-member` / `-guest` groups and the `bodorgo_role` mapping and scope.
- [ ] Authentik: decide whether to re-enable the `ip-reputation` policy on the login flow (delete the old shared score first).
- [ ] Drop the frozen `bodorgo-test` database *(check)*.

### Payments

- [ ] The real test of card payment on live: the owner pays his own 2026 membership fee (remove his recorded 2026 entry right before, not earlier).
- [ ] A second Stripe account for tour advances → `STRIPE_TOUR_SECRET_KEY` / `STRIPE_TOUR_WEBHOOK_SECRET`. Until then advances by Stripe are greyed out.
- [ ] **Barion live:** the club's live account and approved shop → live keys and `BARION_ENV=production` in the live `.env`, the wallets' payee e-mails on Beállítások. Until then Barion shows as "hamarosan".
- [ ] Optional: a public "Tagság" box (fee, card/cash, refund rule) for the payment providers' review.

### Futókörök (the tour is around 2026-10-15)

- [ ] **Open it to everyone** — it is still role-manager only (`server/src/futokor/access.js`, `client/src/app/auth/futokor.guard.ts`).
- [ ] Make sure `FUTOKOR_TAG_SECRET` is set on live before printing the cards.
- [ ] Delete the trial course on live after testing.
- [ ] Offline app shell, so a card link opened by the phone's camera works without a connection.
- [ ] The scan's sound was not heard on the first real run — look into it.
- [ ] Record a track by walking it with the phone.
- [ ] Hike GPX per tour: upload, download link, and the beszámoló pre-filled with distance, climb and time.
- [ ] Regenerating a futókód; segment records; admin review of flagged runs and invalidating a run; a Futókör section on the tour's page.

### Móka

- [ ] Darts: more game types (Around the Clock and Killer were proposed), each with a rules box.
- [ ] Kvíz: more kinds of question; maybe outsiders joining with a nickname.
- [ ] Kvíz: confirm that picture questions keep speed scoring.

### Daloskönyv

- [ ] Try the tuner and the phone's full-screen song view on a real phone.
- [ ] Correct the songs' chord placement by hand (ongoing, on live) and tidy the artists' names.
- [ ] Correct generated chord shapes where they are wrong.
- [ ] Decide: may guests add songs? (They can now.)
- [ ] Parked: tablature blocks (`{sot}` / `{eot}`); chord diagrams in a column on the right in the PDFs.

### Tours and chat

- [ ] Tour page clean-up: move the videos and the Résztvevők heading into their own components, then a tidy-up of leftover styles and imports. (The info block stays in the page.)
- [ ] Tour photos: check that photos in a tour folder's subfolders are all picked up *(check)*.
- [ ] Retire the old public photo address (`fotok.bodorgo.hu`) and its shared password *(check)*.
- [ ] More push notifications: a new letter to attendees, a tour's video is ready, the Szobabeosztás is finalized, a day-before reminder.
- [ ] Tablet side menu grouping for Média (and maybe Klub) — proposed, not decided.

### Handing over: Authentik

The Docker setup (section 8) does not contain Authentik, and nobody can log in without one. Today's Authentik runs on the owner's NAS, under the owner's own domain (`oridzs.terfotozas.hu`), and also serves other things there (Forgejo). Before a real handover:

- [ ] **Decide where logins will live**: the new place keeps using today's Authentik (it then still depends on the old NAS), or gets an Authentik of its own.
- [ ] If its own: **add Authentik to the Docker setup** as an optional compose file (server, worker, its PostgreSQL), so it starts with the rest.
- [ ] **Export the set-up instead of redoing it by hand**: the Bódorgó application and provider, the `bodorgo` group, the flows of section 9 (`enrollment-invitation`, the Google source's enrollment, `bodorgo-logout`), the password policy and the `bodorgo-app` service account with its role — as an Authentik blueprint kept in `server/authentik/`.
- [ ] **Decide how people get across**: carry the accounts over (Authentik's database is in the NAS's hourly PostgreSQL backup, together with other databases that must not travel), or invite everyone again. The app matches people by e-mail alone, so a newly made account with the same e-mail simply works.
- [ ] What a new Authentik needs by hand whichever way: its own address and HTTPS, an SMTP account for its e-mails, the two e-mail templates from `server/authentik/` copied into its `custom-templates` folder, a new Google sign-in client for the new address, a new API token for `AUTHENTIK_API_TOKEN`, and the trusted-proxy setting (section 9).
- [ ] In either case: add the new API address's `/auth/callback` to the provider's Redirect URIs, and try the three paths end to end — invitation sign-up, Google sign-up, logout.
- [ ] The e-mail templates' logo is fetched from `bodorgo.hu`; at another address change the link in both templates.

### Handing over: the rest

- [ ] Make the handover folder afresh the day before the launch (`node scripts/makeHandover.mjs`, section 8) and copy it to the stick.
- [ ] Rehearse restoring Authentik from its own dump (`READ-ME-FIRST.md`, case C) — never tried.
- [ ] Decide what happens to the photos, videos and the Jellyfin library, which live on the same NAS.
- [ ] Schedule backups at the new place (section 8, "Backing up").
- [ ] Try a full login in the Docker try-out.

### Code and housekeeping

- [ ] **Moving to another address than `bodorgo.hu`:** a few texts still name it — the invitation e-mail (`invitationController.js`), the Programfüzet's foot (`tourPdfController.js`), the footer's and the privacy notice's e-mail address, the calendar entries' id. Make them follow `CLIENT_BASE_URL`, or change them by hand.
- [ ] The server does not retry when the database is not reachable at start (`server.js` only logs it). Docker waits for the database, pm2 restarts; a retry would be sturdier.
- [ ] `swagger-jsdoc` and `swagger-ui-express` look unused since the API page moved to Scalar — check and remove.
- [ ] `app.js` has an open TODO: a replacement for the disabled `express-mongo-sanitize`.
- [ ] Client tests still missing for: the Futókör pages, the Média pages (music, photos, videos), home / landing, the tours map, the age chart, the photo gallery, the crop dialog. The header is about half covered.
- [ ] Decide the fate of three unmerged branches: `feature/bodri-assistant` (an AI assistant on a self-hosted Ollama), `feature/strava-club-stats` (a sport-activity section from the club's Strava feed), `music-pill-icon` (the header's music pill).
- [ ] Prune the many local branches that are already merged.
- [ ] Sync the GitHub snapshot with Forgejo's `main` (only when asked).
- [ ] If Cloudflare's proxy is ever wanted, fix the GeoIP check first (see [7](#7-the-live-site-and-deploying)).

---

## 14. Repository history

- The repository lives on a self-hosted Forgejo (`forgejo.terfotozas.hu/gazda/bodorgo`). It used to be split into separate client and server repositories; those still exist there with their own history but are no longer used. GitHub holds a snapshot of Forgejo's `main`.
- **The history was rewritten on 2026-09-25** to remove club documents that had once been committed, so every commit ID changed then. A clone from before that date must be re-cloned (or hard-reset to the new branches), never merged.
