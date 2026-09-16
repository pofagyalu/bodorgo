# Tour photo gallery — implementation plan (v3)

## Context

The bódorgó app (Angular 21 standalone client, Node/Express server managed by pm2, MongoDB), running on a Synology NAS. Tour photos currently live in a NAS folder exposed publicly via a Cloudflare tunnel (`fotok.bodorgo.hu`) with a shared password. This needs to be replaced with images served only through the app itself, to logged-in users, with no direct filesystem access from the browser, and the raw NAS folder path must never be revealed to the client.

## Environment specifics

- Photo source folder, real NAS path: `/volume1/photo/bódorgó_táborok`
- Server app, real NAS path: **`/volume2/server/bodorgo`** — `S:\bodorgo` is just a Windows-side mapped drive onto that same path.
- Client, real NAS path: production web root for `bodorgo.hu`, mapped as **`W:\bodorgo`**.
- Server is plain Node, managed by `pm2`, **not containerized** (deferred - revisit mainly for transferability later; env-var-driven paths make that switch a non-event whenever it happens).
- **Client and server are on two separate origins**: `bodorgo.hu` served as static files by **OpenResty**; `api.bodorgo.hu` reverse-proxied to pm2 by **Nginx Proxy Manager**. No Apache, no same-origin `/api/*` path - every photo route is just another cross-origin endpoint on `api.bodorgo.hu`, same as everything else (`cors({ origin: config.corsOrigins, credentials: true })` already handles this).
- Client is Angular 21 standalone components, **Angular Material** (not Ng-Zorro).

## Core principle

Every image request goes: browser → `api.bodorgo.hu` (session check → look up the tour's recorded photo list → stream the file from disk). The client never receives or references a raw filesystem path - only a tour id + filename pair, validated server-side against that tour's own recorded file list. Auth is via the existing session cookie (Authentik OIDC login, `req.session.user`, checked by the existing `requireAuth` middleware) - already proven to work cross-origin with `credentials: true`.

Precedent already in this repo: `server/src/controllers/documentController.js` + `server/src/routes/documentRoutes.js` already stream the two homepage PDFs from a non-public folder, behind `requireAuth`, with a filename-pattern guard against path traversal. This feature generalizes that same mechanism to per-tour photo folders.

## Data model — reuse what's already on Tour, no new collection

`server/src/models/tourModel.js` already has:
- `imageCover: String` (required) - the public list-view thumbnail. **Unchanged**, stays exactly as today (served from `public/img/tours/`). Not part of this feature.
- `images: [String]` - declared but currently dead. **This is what the gallery repurposes**, upgraded to carry a bit more than a bare filename (see below).

Add one new field, plus a shape change to `images` (both `select: false`, implemented and tested against real data - see "Status" at the bottom):

```js
sourceFolder: { type: String, select: false }, // exact folder name under PHOTOS_ROOT, e.g. "1210_tamasi_bodorgo_ii"
images: {
  type: [{ _id: false, filename: String, width: Number, height: Number }],
  select: false,
},
```

`width`/`height` turned out not to be optional metadata - PhotoSwipe needs them upfront for every slide to size/zoom correctly, not just as a nice-to-have. Since `scripts/syncTourImages.js` already runs `sharp` on every new photo for its thumbnail, capturing `sharp(src).rotate().metadata()`'s width/height in the same pass was free - no separate `Image` collection needed for this.

**`images` (and `sourceFolder`) must never appear on the existing public tour endpoints** (`GET /tours`, `GET /tours/:id` - neither requires login, tours are publicly browsable today). `select: false` on the schema handles this automatically for every query app-wide, not just those two handlers - confirmed live (see Status).

### Folder naming — one folder per tour, not several

Correcting an earlier misreading on my part: this is **not** several folders per tour in sequence. Your real examples:

```
1210_tamasi_bodorgo_ii
1810_bukksztkereszt_bodorgo_xiii
2306_mohacs_bodorgo_xxii
```

are three *different* tours (different places), each folder ending in a *different* small roman numeral - `ii`, `xiii`, `xxii`. That's not a within-tour chapter sequence, it's each folder encoding **that tour's `order` number** (2nd, 13th, 22nd tour) - a field `Tour` already has. So: **one folder = one tour**, full stop. No multi-folder walking or ordering logic needed at all - the earlier "roman-numeral suffix marks chapter order" section is wrong and dropped.

**Confirmed: the roman numeral and `order` are identical.** `sourceFolder` doesn't need to be typed in by hand for all ~32 historical tours - a one-time helper script lists every folder under `PHOTOS_ROOT`, extracts the trailing roman numeral (a small parser is enough - the numerals involved are all well under 100), converts it to an integer, and matches it directly against `Tour.order`. Anything that doesn't match cleanly (no numeral found, no `Tour` with that `order`, more than one folder resolving to the same order) is printed out for manual resolution rather than guessed. `sourceFolder` stays a real stored field either way (not re-derived on every sync), so a one-off correction sticks.

**A few tour folders have subfolders inside them** (not the common case, but real). v1's sync script only reads files **directly** under `PHOTOS_ROOT/<tour.sourceFolder>/` - it does not recurse into subfolders. Rather than silently skipping those photos with no trace, the script prints a notice per tour where it found one or more subfolders it didn't walk (name + how many files inside), so it's visible which tours need the deferred subfolder support rather than just quietly having fewer photos than expected. Recursing into them is a small, contained addition to make later - not needed to ship v1 for the tours that are already flat.

### Sync step (folder → DB)

A script under `server/scripts/` (`node scripts/syncTourImages.js <tourId|order|slug>`), matching every other bulk/one-off data operation in this app (`addTour.js`, `importAttendance.js`, etc.) - not an admin-UI button for v1 (cheaper to ship, easy follow-up later if it turns out to be needed often).

For files directly under `PHOTOS_ROOT/<tour.sourceFolder>/` not already present in `tour.images`, sorted by filename, it **appends** them - never reorders or removes existing entries, so already-recorded photos keep their position (and their thumbnail, see below) across re-syncs even as new photos get dropped into the folder later.

**Thumbnails are generated here too, not at request time.** This script also generates a small `.webp` thumbnail per newly-found image via `sharp`, written to a parallel folder structure under `THUMBNAILS_ROOT` (mirroring each image's relative path). Since `sharp` ships native binaries, and `server/build.js` bundles the whole running server into one `dist/server.js` via esbuild (which can't inline native addons), the key point is: **`sharp` only ever runs inside this script**, executed directly with `node` and the repo's full `node_modules` - it's never part of the bundled server runtime, so `build.js`/`sync.js`'s deploy pipeline needs zero changes. The running server just does `fs.createReadStream` on an already-small pre-made file - the same trivial streaming logic as the full-image route, pointed at a different root. If a thumbnail is ever missing (a sync failed partway, or a file was added by hand), the route falls back to streaming the full image rather than erroring.

Given photos run ~1-2 MB each, generating real thumbnails is worth doing up front rather than shipping full images into a thumbnail rail - the difference between a rail of pre-made ~20-30 KB `.webp` files versus 1-2 MB originals is the actual page-load cost of opening a tour's gallery at all.

## Config

Two different `.env` files, each needs the path in the form its own OS actually understands - easy to get backwards, so calling it out explicitly:

- **This dev machine's local `server/.env`** (used when *running the sync script by hand*, same as every other script in `server/scripts/`, which all connect straight to Mongo and never go through the live server): the NAS is reachable here only via its Windows-mapped drive letters, matching `Z:\bódorgó_táborok` you already gave and the existing `S:\`/`W:\` convention this repo already uses.
  ```
  PHOTOS_ROOT=Z:/bódorgó_táborok
  THUMBNAILS_ROOT=S:/bodorgo/thumbnails
  ```
- **The deployed `S:\bodorgo\.env`** (used by the live pm2 process itself for the streaming routes below - it runs natively on the NAS's own Synology OS, which has no `Z:`/`S:` drive letters, only real absolute paths):
  ```
  PHOTOS_ROOT=/volume1/photo/bódorgó_táborok
  THUMBNAILS_ROOT=/volume2/server/bodorgo/thumbnails
  ```

Both added to `server/src/.env.example` (with the NAS-absolute form, matching how `server/README.md` already documents production-only env vars) and read via `server/src/config.js` alongside the existing `AUTHENTIK_*`/`DB_URI` pattern.

## API routes (all behind `requireAuth`, mounted on `api.bodorgo.hu`)

- `GET /tours/:tourId/images` — ordered list of filenames from `tour.images`
- `GET /tours/:tourId/images/:filename/thumb` — streams the pre-generated `.webp` from `THUMBNAILS_ROOT` (falls back to the full image if missing)
- `GET /tours/:tourId/images/:filename` — streams the full-resolution original from `PHOTOS_ROOT/<tour.sourceFolder>/`. `filename` must (a) appear in `tour.images` for that tour and (b) resolve, via `path.resolve` + a `startsWith` check against that folder, to a path that can't escape it - same guard shape as `documentController.js`'s existing one
- `GET /tours/:tourId/images/:filename/download` — same original via `res.download()` (forces `Content-Disposition: attachment`, same pattern `documentController.js` already uses for the PDFs)
- `GET /tours/:tourId/images/download-zip` — every image in `tour.images`, zipped and streamed straight to the response via `archiver` (`archive.pipe(res)`, never written to a temp file) - pure JS, no native-build concerns, safe inside the bundled server

## Frontend — thumbnail grid + PhotoSwipe

New client dependency: [`photoswipe`](https://photoswipe.com) (npm package - an open-source, pre-built fullscreen image-lightbox/slideshow widget). Going with it as-is for v1 rather than a custom-built viewer, and revisiting once it's clear what it can/can't do for this app's needs (captions, a download button inside the lightbox itself, etc. are all things it may already support via its plugin/UI-registration API - worth exploring once it's actually in use rather than deciding up front).

Layout: a thumbnail grid on the tour details page (plain `<img>` grid sourced from the `/thumb` route above), clicking any thumbnail opens PhotoSwipe's fullscreen lightbox at that image, with its own built-in next/prev arrows and swipe/keyboard navigation - loading the full-resolution `/images/:filename` route once opened. A download icon per thumbnail and a "download all" button (hitting the zip endpoint) sit alongside the grid, outside PhotoSwipe itself for v1 - simplest to wire up first, can move into PhotoSwipe's own UI later if that ends up feeling more natural once we've used it.

## Permissions checklist

- Confirm which DSM user account runs the pm2 process (see `server/README.md`'s pm2/NAS notes)
- Grant that account Read access to `bódorgó_táborok` specifically in DSM File Station permissions
- Confirm sibling folders under the shared `photo` volume are **not** granted to that account - this is the actual isolation boundary now that there's no container wall

## Build order

1. `sourceFolder` field on `Tour`, exclude `images`/`sourceFolder` from the public tour endpoints
2. One-time `scripts/matchTourFolders.js` (roman-numeral → `order` auto-suggest for `sourceFolder`) run once against the real 32 tours, then `scripts/syncTourImages.js` (append-only `images` sync + thumbnail generation via `sharp`) run per tour thereafter
3. `GET /tours/:tourId/images` + the thumb/full streaming routes, all `requireAuth`
4. Frontend thumbnail grid + PhotoSwipe integration
5. Single-image download + zip-download routes
6. Decommission `fotok.bodorgo.hu` / the Cloudflare tunnel and the shared password

## Still open

Nothing blocking - everything below is either resolved or explicitly deferred:

- ~~Numeral-equals-`order`~~ - confirmed identical.
- ~~`THUMBNAILS_ROOT`'s exact path~~ - resolved: `/volume2/server/bodorgo/thumbnails`. Confirmed safe from redeploys - `server/sync.js` only ever copies into `dist/` and `documents/` inside `S:\bodorgo`, it never clears the directory first, so a `thumbnails/` folder living alongside those is never touched by a deploy.
- ~~Folder-naming pattern~~ - resolved with real examples: `<4-digit code>_<place>_bodorgo_<lowercase roman numeral>`, one folder per tour.
- **Deferred, not blocking**: a few tour folders contain subfolders. v1 only reads files directly under the tour's folder and prints a notice for any tour where it found a subfolder it skipped, so nothing is silently lost - recursing into them is a small follow-up once it's clear which tours actually need it.

## Status

Backend done and verified against the real NAS data (31 real folders, 12 real tours so far):

- `matchTourFolders.js` run for real: 12 matched, 19 with no tour yet (expected - only a dozen of the 32 historical tours are uploaded so far), 0 conflicts.
- `syncTourImages.js` run for all 12 matched tours: real thumbnails generated on disk under `S:\bodorgo\thumbnails`, `images` populated with real filename+width+height data. Confirmed the one real folder with subfolders (`2607_kotaj_bodorgo_xxxi`, folders `mi`/`mobil`) correctly printed a notice instead of silently dropping those 3 photos.
- `GET /tours/:tourId/images`, `/thumb`, plain, `/download`, `/download-zip` routes built and wired in `tourRoutes.js` (literal `download-zip` path registered before the generic `/:filename` one, so Express doesn't swallow it). All confirmed `requireAuth`-gated live (401 without a session), and confirmed the public `GET /tours/:id` no longer exposes `images`/`sourceFolder` at all.
- `sharp` confirmed absent from the bundled `dist/server.js` (grepped for it after a real `build.js` run) - it's never imported from anything `src/server.js` pulls in, only from the sync script, so the esbuild-bundling concern raised earlier turned out to be a non-issue in practice, not just in theory.
- `scripts/testTourImageController.js` (new, kept per usual) exercises the real controller functions directly against this real data - list shape, thumb-with-fallback, unknown-filename rejection, and a real zip's PK header - all passing.
- Mid-build correction: `images` gained `width`/`height` alongside `filename` (was going to be a bare filename list) - PhotoSwipe needs them upfront for every slide, not just as nice-to-have metadata. Captured for free via `sharp(src).rotate().metadata()` in the same pass that already generates each thumbnail. The 12 already-synced tours were reset and re-synced once against the new shape (safe, pre-production data).

Frontend done too:

- `photoswipe` installed; its CSS added to `angular.json`'s global styles (same pattern as `leaflet`'s), the JS itself lazy-loaded on demand (`import('photoswipe')`/`import('photoswipe/lightbox')`) so it never touches the main bundle - confirmed via a real prod build, showing up as two separate lazy chunks (~75 KB total) rather than inflating `main.js`.
- Tour details page: a "Fotók" section (thumbnail grid + "Összes letöltése" zip button + per-thumbnail download icon), shown only once logged in and the tour actually has synced photos - most of the 32 historical tours don't yet. Clicking a thumbnail opens PhotoSwipe's fullscreen lightbox loading the full-resolution original.
- One real integration gotcha, resolved: `PhotoSwipeLightbox` resolves its `gallery` selector to DOM elements once, at `.init()` time - it doesn't use top-down delegation from a persistent ancestor, so it has to be (re-)initialized *after* Angular has actually rendered the thumbnails, not at component construction (when the section doesn't exist yet, gated behind `@if`). Solved with an `effect()` on the loaded images plus Angular's `afterNextRender`, so init only runs once the gallery DOM is actually there.
- The per-thumbnail download icon is a separate sibling `<a>`, not nested inside the image's own anchor (anchors can't nest) - `PhotoSwipeLightbox`'s `children` option is scoped to `a.gallery-item-link` specifically so it doesn't also try to treat the download icon as a gallery slide.
- Client-side type-check, dev/prod builds, and all 16 unit tests pass. **Not yet visually verified in a real browser while logged in** - no browser-automation tool was available in this environment to click through it end-to-end, and login requires real Authentik credentials. Worth a real look on your end before/after deploying.

Next: your visual check, then the single-image/zip download UX once you've tried it for real, then decommissioning the old tunnel.

## Update: restricted (sensitive) photos

The on-page thumbnail grid mentioned above was later dropped entirely per feedback (felt like clutter) - clicking the cover photo now opens PhotoSwipe directly, with a bottom filmstrip (click any thumbnail to jump to it) and toolbar buttons for single/zip download built inside the viewer itself via PhotoSwipe's `registerElement` API. The gallery data model and server routes described above are otherwise unchanged.

Added a per-photo `restricted` flag (`Tour.images[].restricted`, default `false`) for the rare sensitive photo an admin wants visible only to that tour's own attendees:

- `canViewRestrictedImages(user, tourId)` (`tourImageController.js`) - true for an admin, or anyone with a real `Reservation` for that tour (same attendee check `getMyAttendance` already uses elsewhere). Not cached - restricted photos are meant to be rare, so the extra query per request is a non-issue.
- Every image route (`list`, `thumb`, `full`, `download`, `download-zip`) enforces this. A restricted photo a viewer isn't allowed to see is **omitted from the list** and returns the exact same "not found" error as an unknown filename on the direct routes - deliberately indistinguishable from a photo that was never recorded, so its existence isn't revealed to anyone outside the allowed set either.
- New admin-only route: `PATCH /tours/:tourId/images/:filename` with `{ restricted: boolean }` - toggles one photo. `restrictTo('admin')`, confirmed 401 without a session.
- Client: an admin-only toggle button inside the PhotoSwipe toolbar (a lock icon, tinted orange while the current photo is restricted) - `setImageRestricted()` on `TourService`, patches `tourImages()` locally on success so the icon and gallery list reflect the new state immediately without reloading.
- `scripts/testRestrictedImages.js` (new) verifies all of this against real data (tour order 2, a real reservation's real attendee) - admin sees it, the actual attendee sees it, a fabricated non-attendee gets rejected, and the list correctly includes/omits it depending on the viewer. Temporarily restricts one real photo and always restores it in a `finally`, since this touches production data.
