# Bódorgó

Monorepo for the Bódorgó club site: an Angular client and a Node/Express API, with authentication delegated to a self-hosted [Authentik](https://goauthentik.io/) instance via OIDC + PKCE.

- [`client/`](client/README.md) — Angular 21 app, deployed to `bodorgo.hu`
- [`server/`](server/README.md) — Express API, deployed to `api.bodorgo.hu`

See each subproject's README for dev setup, build, and deploy instructions specific to it.

## Production topology

- `bodorgo.hu` (client) and `api.bodorgo.hu` (server) are **separate origins** — different subdomains, not a shared reverse-proxied domain. The server's CORS config and the client's `environment.ts` both reflect this.
- Both are served from the same Synology NAS: the client as static files from a network share (`W:\bodorgo`), the server as a Node process managed by pm2 (`S:\bodorgo`, working directory defined in `S:\ecosystem.config.js`).
- Session cookies are set by the server (`api.bodorgo.hu`) and read only by the server — the client never touches them directly, so no cookie `Domain` sharing between the two subdomains is needed.
- **Known gap:** `api.bodorgo.hu` needs an nginx/OpenResty vhost on the NAS proxying to the Node process's port. That vhost doesn't exist yet as of this writing, so production login won't complete end-to-end until it's added — this is infrastructure config, not something in this repo.

## Repository layout note

This repo used to be split across two separate Forgejo repos (`bodorgo_server`, `bodorgo_client`) plus a separate monorepo; it's now consolidated as a single monorepo, pushed to `forgejo.terfotozas.hu/gazda/bodorgo`. The old split repos still exist there with their own history but are no longer the active target.
