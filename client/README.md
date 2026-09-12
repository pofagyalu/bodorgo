# Bódorgó client

Angular 21 (zoneless, no zone.js), standalone components, session-cookie auth against the [server](../server/README.md).

## Local development

```
npm install
npm start
```

Runs `ng serve` on `http://localhost:4200`. The dev environment (`src/environments/environment.development.ts`) points `apiBaseUrl` directly at `http://localhost:8235` — start the server locally too (see the server README) for login, tours, etc. to work. Calls are cross-origin in dev (4200 → 8235); the server's CORS config already allows `http://localhost:4200` with credentials, so this works without a proxy.

`environment.development.ts` and `environment.ts` both need a real OpenWeatherMap API key filled in (`openWeatherApi`) for the weather widget on the home page — there's a placeholder value checked in.

## Running tests

```
npm test
```

Runs `ng test`, which uses Angular's official Vitest-based unit-test builder. Tests run in jsdom — no browser install required.

## Building for production

```
npm run build
```

Runs `ng build` (production configuration by default). Output lands at `dist/client/browser/`.

Don't re-add Angular's `i18n`/`localize` build options unless the app actually gets translated content — they used to be set (unused, no translation files existed) and caused a real production bug: a localized build's `index.html` gets `<base href="/hu/">`, but this app is deployed straight to the site root, so every relative asset URL silently 404'd (served the SPA's `index.html` instead, which is what a "MIME type text/html, expected JavaScript" console error means for a `<script type="module">` tag).

## Deploying

```
npm run deploy
```

Builds and copies `dist/client/browser/` to `W:\bodorgo` (a mapped network drive — the production web root for `bodorgo.hu`) in one step, via `sync.js`. It clears out the previous deploy's files first (keeping `.htaccess`, which isn't build output) so old content-hashed bundles (`main-<hash>.js` etc.) don't pile up release after release.

If you've already built and just want to (re-)copy without rebuilding:

```
npm run sync
```

There's no process manager involved on the client side — `bodorgo.hu` is served directly as static files by the NAS's web server (OpenResty), so a successful sync is immediately live; no restart needed.
