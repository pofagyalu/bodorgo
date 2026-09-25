# Bódorgó

Monorepo for the Bódorgó club site: an Angular client and a Node/Express API, with authentication delegated to a self-hosted [Authentik](https://goauthentik.io/) instance via OIDC + PKCE.

- [`client/`](client/README.md) — Angular 21 app, deployed to `bodorgo.hu`
- [`server/`](server/README.md) — Express API, deployed to `api.bodorgo.hu`

See each subproject's README for dev setup, build, and deploy instructions specific to it.

## Production topology

- `bodorgo.hu` (client) and `api.bodorgo.hu` (server) are **separate origins** — different subdomains, not a shared reverse-proxied domain. The server's CORS config and the client's `environment.ts` both reflect this.
- Both are served from the same Synology NAS: the client as static files from a network share (`W:\bodorgo`), the server as a Node process managed by pm2 (`S:\bodorgo`, working directory defined in `S:\ecosystem.config.js`).
- Session cookies are set by the server (`api.bodorgo.hu`) and read only by the server — the client never touches them directly, so no cookie `Domain` sharing between the two subdomains is needed.
- Reverse proxying to both is handled by **Nginx Proxy Manager** (a Docker container on the NAS), forwarding `api.bodorgo.hu` to `192.168.1.94:8235`.
- **DNS gotcha (already hit once, don't repeat it):** `api.bodorgo.hu`'s DNS record in Cloudflare must be **DNS only** ("grey cloud"), not proxied. NPM has a global GeoIP allow-list (`/data/nginx/custom/server_proxy.conf` inside the NPM container, applied to every proxied host) that checks the connecting client's country. If Cloudflare proxies the request, nginx sees Cloudflare's own edge IP as the client instead of the real visitor, which gets geolocated to whatever country that Cloudflare datacenter is in and fails the check — a local `403` from nginx itself, before the request ever reaches the Node app (`$upstream_status` shows blank in NPM's access log for this, vs. a real status when a request actually reaches the backend). `bodorgo.hu` has always been DNS-only for this same reason, which is why the client worked while the API didn't. If you ever want Cloudflare's proxying/CDN benefits on the API, the GeoIP check needs to use the real-visitor header Cloudflare provides (e.g. `$http_cf_connecting_ip`) instead of `$remote_addr` — that hasn't been changed, so leave the DNS record as DNS-only until it is.

## Data and files

- **One shared database.** The local dev server (`server/.env`'s `DB_URI`, MongoDB on `192.168.1.99`) and production use the **same** database. Anything done through the local app — uploading a document or photo, suspending a user, editing a tour — changes live data immediately. Keep ad-hoc scripts read-only unless a change is actually intended.
- **Members-only.** Everything needs a login except the landing page and its tour ticker (`GET /tours/ticker`). `server/public/` is not served statically any more.
- **Where files live:**
  - **Profile photos and tour covers** — in the database (`userphotos`, `tourcovers` collections), cropped and resized in the browser before upload, served only to logged-in users. Nothing to copy between machines. (Existing covers were imported from the old `public/img/tours/` with `server/scripts/migrateCoversToDb.js`.)
  - **Club documents** (Klub → Dokumentumok) — files in `server/documents/`, **not in git**; `server/sync.js` copies them to the NAS on deploy (the upload lands on whichever machine's app was used, while its database record is shared).
  - **Extra tour documents** (Extra infók) — files in `server/public/documents/tours/<tourId>/`, served only to logged-in users.
  - **Tour photos and videos** — on the NAS (`PHOTOS_ROOT`, `THUMBNAILS_ROOT`, `VIDEOS_ROOT`), served through login-only routes.

## Repository layout note

This repo used to be split across two separate Forgejo repos (`bodorgo_server`, `bodorgo_client`) plus a separate monorepo; it's now consolidated as a single monorepo, pushed to `forgejo.terfotozas.hu/gazda/bodorgo`. The old split repos still exist there with their own history but are no longer the active target.

Its history was rewritten on 2026-09-25 to remove club documents that had once been committed (`server/documents/`, `client/src/assets/documents/`), so every commit ID changed then: any clone from before that date must be re-cloned (or hard-reset to the new branches), never merged.
