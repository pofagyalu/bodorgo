# Bódorgó server

Node/Express API, ESM (`"type": "module"`), MongoDB via Mongoose, session-based auth against a self-hosted Authentik instance (OIDC + PKCE).

## Prerequisites

- Node.js 22+
- A reachable MongoDB instance
- An OAuth2/OpenID **Provider** + **Application** set up in Authentik (confidential client), with the redirect URI(s) you'll actually use registered under "Redirect URIs" — e.g. `http://localhost:8235/auth/callback` for local dev and `https://api.bodorgo.hu/auth/callback` for production. The server computes its `redirect_uri` from the incoming request's own host, so both must be registered on the Authentik side; nothing in this repo needs to change between environments for that specific value.

## Local development

1. Copy `src/.env.example` to `.env` (at the `server/` root, next to `package.json`) and fill in real values — DB connection string, Authentik client ID/secret, `COOKIE_SECRET`, etc. This file is gitignored; never commit it.
2. `npm install`
3. `npm start` — runs `nodemon src/server.js`, reloading on file changes. Listens on the `PORT` from `.env` (`8235` in the example values used during development).

There's no automated test suite for the server at the moment.

## Building for deployment

```
npm run build
```

This runs `build.js` (bundles `src/server.js` into a single `dist/server.js` via esbuild) and then `sync.js` (copies `dist/server.js` to `S:\bodorgo`, a mapped network drive to the production NAS share pm2 runs from).

**Important:** `build.js` deliberately bundles as **CommonJS**, not ESM, even though this repo itself is ESM. That's not an oversight — `S:\bodorgo` has no `package.json` of its own, so Node treats `.js` files there as CommonJS by default regardless of this repo's `"type": "module"`. A CJS bundle just works there; an ESM bundle would need `node_modules` shipped alongside it and a `package.json` with `"type": "module"` placed at the deploy target, which is unnecessary complexity for what's otherwise a single self-contained file. Don't add `format: 'esm'` to `build.js` without also solving that.

## Deploying

1. `npm run build` (see above) — this only copies the built server file, **not** `.env`.
2. The `.env` file used in production lives directly at `S:\bodorgo\.env` and is maintained separately from this repo — if you've added or changed env vars, update it there too (currently it needs at least `CLIENT_BASE_URL` and `CLIENT_ORIGIN` in addition to everything in `.env.example`).
3. pm2 runs on the Synology NAS itself (not this dev machine); `S:\bodorgo` is just the network share its working directory points at. The app is defined in `S:\ecosystem.config.js` (name `bodorgo`) with `watch: true`, so copying a new `server.js` there should trigger an automatic restart — but SMB file-watching across the network share can be unreliable, so if the new build doesn't seem to be live, log into the NAS and check:
   ```
   pm2 list
   pm2 restart bodorgo
   ```
4. To start it fresh (e.g. after a NAS reboot if it isn't already running):
   ```
   pm2 start ecosystem.config.js --env production
   ```

### Making pm2 survive a NAS reboot

Run once, on the NAS:

```
pm2 save
pm2 startup
```

`pm2 startup` prints a command (usually prefixed with `sudo`) — copy and run that exact command; it registers a systemd service that calls `pm2 resurrect` on boot. `pm2 save` snapshots the currently-running process list so there's something for it to restore. If a real reboot doesn't bring `bodorgo` back (Synology's DSM occasionally doesn't preserve third-party systemd units across updates), fall back to a DSM Task Scheduler **Triggered Task** (event: Boot-up) that runs `pm2 resurrect`.

## Known gap

`api.bodorgo.hu` needs an nginx/OpenResty server block on the NAS proxying to this app's port — as of this writing that vhost doesn't exist yet (requests to `api.bodorgo.hu` 403 before ever reaching Node), so the production login flow won't complete end-to-end until that's added. This is infrastructure config outside this repo.
