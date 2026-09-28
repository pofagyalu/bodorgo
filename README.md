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

- **Two databases.** Production uses `bodorgo`; the local dev server uses `bodorgo-dev` (each `server/.env`'s `DB_URI`). Uploaded files live on each machine's own disk, so copying a database between the two does not bring its files along.
- **Members-only.** Everything needs a login except the landing page and its tour ticker (`GET /tours/ticker`). `server/public/` is not served statically any more.
- **API documentation:** `https://api.bodorgo.hu/docs` (admins only) - every endpoint, generated from `server/src/apiDocs/openapi.js`. Update that file with every endpoint change; a test fails if a route is missing from it.
- **Where files live:**
  - **Profile photos and tour covers** — in the database (`userphotos`, `tourcovers` collections), cropped and resized in the browser before upload, served only to logged-in users. Nothing to copy between machines.
  - **Documents** — the club's (Klub → Dokumentumok) in `server/documents/`, each tour's Extrák in `server/documents/tours/<tourId>/`; one `clubdocuments` collection for both. **Not in git and never copied between machines** — uploads happen on the live site. Previews of club documents in `server/documents/previews/`.
  - **Kotyogó (chat) photos** — `server/chat-images/`, under a size quota set on Beállítások.
  - **Tour photos and videos** — on the NAS (`PHOTOS_ROOT`, `THUMBNAILS_ROOT`, `VIDEOS_ROOT`), served through login-only routes.

## Access and roles (handover)

- **Authentik is only the identity provider.** It says *who* someone is (login, e-mail, name) — nothing about their role in the club. Its `bodorgo_role` property mapping and the `bodorgo-admin/-member/-guest` groups are no longer read by the app.
- **Only people added in the app can log in.** An admin adds each person first (Klub → Felhasználók, with the e-mail they use in Authentik); their first login links the two. Anyone else who gets through Authentik is refused ("Még nem vagy felvéve…").
- **Invitations (Felhasználók → Meghívók, admins).** Everyone added with an e-mail who has never logged in can be sent their own single-use Authentik invitation link (valid 30 days) - one by one, or in two batches (club members, then everyone else). The app creates the invitation through Authentik's REST API (`server/src/utils/authentikInvitations.js`) and e-mails the link itself. Authentik side, all needed for it:
  - Flow `enrollment-invitation`: 10 `enrollment-invitation-check` (Invitation stage, *continue without invitation* off) → 20 `enrollment-invitation-prompt` (username, name, email, password, password_repeat) → 30 `enrollment-invitation-write` (always create, inactive, internal, group `bodorgo`) → 35 `enrollment-invitation-email-verify` (Email stage, activates the user) → 40 login.
  - Group `bodorgo`: the Bódorgó application is bound to it, so only its members reach the app; invitation registrations join it automatically.
  - Service account `bodorgo-app` with role `bodorgo-invitations` (add/view/delete Invitation only), and its non-expiring API token as `AUTHENTIK_API_TOKEN` in `server/.env` (live and local). Optional: `AUTHENTIK_INVITATION_FLOW` if the flow's slug changes.
- **Roles live in the app:** `admin`, `member` (dues-paying club member), `guest` (everyone else — family members, children without a login). A person added by an ordinary admin starts as `guest`.
- **Only one admin may change roles — the role manager.** It is whoever `INITIAL_ADMIN_USER` in the live `server/.env` names (currently the founder's e-mail). At every server start, that person gets the role-manager flag (`canManageRoles`) and the `admin` role, and nobody else keeps the flag. They cannot change their own role (they always stay admin). If they have no account yet — e.g. a brand-new installation — their first login creates it.
- **Handing the app over:** add the successor in Felhasználók (or let them log in first, if they are the new `INITIAL_ADMIN_USER`), change `INITIAL_ADMIN_USER` in `S:\bodorgo\.env` to their e-mail, and restart the server (`cd /volume2/server && pm2 restart bodorgo`). From then on only they can change roles. The same line is the way back in if the role manager is ever unavailable: whoever can edit the server's `.env` can name a new one.

## Repository layout note

This repo used to be split across two separate Forgejo repos (`bodorgo_server`, `bodorgo_client`) plus a separate monorepo; it's now consolidated as a single monorepo, pushed to `forgejo.terfotozas.hu/gazda/bodorgo`. The old split repos still exist there with their own history but are no longer the active target.

Its history was rewritten on 2026-09-25 to remove club documents that had once been committed (`server/documents/`, `client/src/assets/documents/`), so every commit ID changed then: any clone from before that date must be re-cloned (or hard-reset to the new branches), never merged.
