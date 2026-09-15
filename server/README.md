# Bódorgó server

Node/Express API, ESM (`"type": "module"`), MongoDB via Mongoose, session-based auth against a self-hosted Authentik instance (OIDC + PKCE).

## Prerequisites

- Node.js 22+
- A reachable MongoDB instance
- An OAuth2/OpenID **Provider** + **Application** set up in Authentik (confidential client), with the redirect URI(s) you'll actually use registered under "Redirect URIs" — e.g. `http://localhost:8235/auth/callback` for local dev and `https://api.bodorgo.hu/auth/callback` for production. The server computes its `redirect_uri` from the incoming request's own host, so both must be registered on the Authentik side; nothing in this repo needs to change between environments for that specific value.

## Roles & Authentik integration

Local user records (`src/models/userModel.js`) have a `role` field: `admin | member | guest`. This is **not** set by hand in the app — it's driven entirely by Authentik, re-synced on every login:

- Authentik has three flat groups: `bodorgo-admin`, `bodorgo-member`, `bodorgo-guest`. Invitation links point at whichever of three separate enrollment flows adds the invitee to the matching group — role assignment happens at invite time, on Authentik's side. This app has no invite/role-picker UI of its own.
- A custom scope/property mapping on the Authentik OAuth2/OIDC provider (Customization → Property Mappings → Scope Mappings, scope name `bodorgo_role`) computes the role from the user's group membership (`user.groups.all()`) and returns it directly as a claim: `"admin" | "member" | "guest" | null` (`null` when the user isn't in any of the three groups). The login request (`authOidcController.js`'s `login()`) requests this scope alongside `openid profile email`; the callback reads `claims.bodorgo_role`, falling back to the userinfo endpoint if the ID token itself didn't carry it.
- **A missing or unrecognized role denies the login outright** (`roleFromClaim()` returns `null` → redirect to `/login?error=no-role`, no session created, no local user record created or touched) — a deliberate choice so a broken invite or a group membership removed later locks someone out instead of silently downgrading them to guest. A role change (including a downgrade) only takes effect on that user's *next* login, not by killing an already-active session immediately.
- `admin` = full access. `member` = an official, dues-paying club member. `guest` = can log in and use the app fully, just isn't a paying member (this is *not* the same as "not enrolled" — a real `bodorgo-guest` group member still gets a valid role and logs in fine).
- The one exception: a login-less dependent (e.g. a child with no email/account of their own, created by hand via `scripts/addFamilyMember.js` or `scripts/importAttendance.js`) never goes through a login at all, so their `role` (schema default `guest`) stays whatever it was set to until they get a real Authentik account — at which point the callback's email-match "claim" logic attaches their `sub` and the group sync above takes over normally.
- `scripts/testRoleFromClaim.js` verifies the claim-validation logic without needing a live Authentik login.

This replaced an earlier design (raw `groups` claim mapped to a role in this app's own code, group named `bodorgo` rather than `bodorgo-member`, and "keep the existing role" instead of "deny login" when the claim was missing) — `scripts/testRoleFromGroups.js` documents that superseded mapping for reference only; it's not used by the app anymore.

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

## Reverse proxy

`api.bodorgo.hu` is proxied to this app by Nginx Proxy Manager (running as a container on the NAS), forwarding to `192.168.1.94:8235`. See the root [README](../README.md#production-topology) for an important DNS gotcha around this (its Cloudflare record must stay DNS-only, not proxied, or a global GeoIP check in NPM will 403 every request before it reaches Node).
