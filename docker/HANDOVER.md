# Bódorgó — starting the app again from this folder

Made on **{{DATE}}** from commit **{{COMMIT}}** ({{COMMIT_DATE}}).

Bódorgó is a hiking club's web app (`bodorgo.hu`): an Angular website, a Node.js API (`api.bodorgo.hu`) and a MongoDB database. This folder holds everything needed to bring it up on any machine that runs Docker, with the data as it was on the date above. It is written for someone who knows Docker, DNS and reverse proxies but has never seen this app.

The full documentation is the `README.md` inside the source. Its section 8 ("Running it in Docker") is the long form of what follows.

## What is in this folder

| Path | What |
| --- | --- |
| `source/bodorgo-source.zip` | The code at commit {{COMMIT}}. Unpacks into a `bodorgo/` folder. |
| `source/bodorgo.bundle` | The same code with its whole history: `git clone bodorgo.bundle bodorgo`. |
| `images/bodorgo-images.tar` | Three Docker images in one `docker save` file: `bodorgo-api`, `bodorgo-web` (both built from that commit) and `mongo:8.0`. |
| `db/{{DUMP_FILE}}` | The production database (`mongodump --archive --gzip`, one database: `bodorgo`). `db/contents.txt` lists what is in it; it was restored once into an empty database as a check. |
| `files/documents/`, `files/chat-images/` | What people uploaded. The database only holds their names. |
| `secrets.7z` | Encrypted (AES-256, 7-Zip). The owner gives you the password separately. Its contents are listed below. |
| `CONTENTS.txt` | Sizes and SHA-256 checksums. |

Inside `secrets.7z`:

| File | What |
| --- | --- |
| `server.env` | The live server's settings: every key and password the app uses. Becomes `server/.env`. |
| `docker.env` | The Docker setup's settings, filled in for the live addresses, with a new database password. Becomes `.env` beside `compose.yaml`. |
| `ecosystem.config.js` | How pm2 ran the server on the old machine. Only for reference. |
| `authentik/authentik-….sql.gz` | The login service's own database (PostgreSQL, `pg_dump`, no owners or grants). It holds everyone's password hash. |
| `authentik/compose.yaml`, `authentik/authentik.env` | How Authentik ran on the old machine, and its settings (secret key, mail account). |

## What is not in this folder

- **The original photos and videos.** They are on the owner's NAS (`raktar`) and in its backups — hundreds of gigabytes. Without them the app runs, but the photo galleries and the videos are empty.
- **What the server made from them** (the old server's `thumbnails/` folder, about 5 GB): the photos' thumbnails and smaller sizes, and the videos' compressed copies in `_videos/`. All of it can be made again once the originals are in place: the photos' in minutes with **Új média felfedezése**, a video's compressed copy in hours, by an admin's button on the video. If the old folder can still be read, copy it into `handover/files/thumbnails/` instead and nothing has to be made again.
- **Authentik itself**, the login service. See "Logging in" below.
- **Jellyfin** (the music pages). Without it only those pages are empty.
- **The HTTPS reverse proxy** and the DNS records.
- The outside accounts: Resend (e-mail), Stripe and Barion (payments), openrouteservice, OpenWeatherMap. Their keys are in `server.env`; the accounts are the club's.

## Starting it

On a machine with Docker (Engine with the compose plugin, or Docker Desktop). Paths below are written for Linux; `STICK` is this folder.

1. **Unpack the code** and go into it.

   ```
   unzip STICK/source/bodorgo-source.zip
   cd bodorgo
   ```

2. **Load the images.** Nothing has to be built or downloaded.

   ```
   docker load -i STICK/images/bodorgo-images.tar
   ```

3. **Put the settings in place.**

   ```
   7z x STICK/secrets.7z -o../bodorgo-secrets
   cp ../bodorgo-secrets/docker.env .env
   cp ../bodorgo-secrets/server.env server/.env
   ```

   Read through both once. In `.env`: the two ports (`WEB_PORT`, `API_PORT`), and where the photo and video folders are on this machine if you have them (`PHOTOS_DIR`, `MEDIA_PHOTOS_DIR`, `VIDEOS_DIR`). In `server/.env` the port, the database address and the folder paths belong to the old machine — `compose.yaml` overrides them, leave them.

4. **Put the data where `compose.yaml` looks for it.**

   ```
   mkdir -p handover/db handover/files/thumbnails
   cp STICK/db/*.archive.gz handover/db/
   sudo chown -R 1000:1000 handover/files/thumbnails
   ```

   `thumbnails` starts empty: the server fills it with what it makes from the photos and videos. It runs as user id 1000 inside its container, hence the last line.

5. **Start it**, and check that the database copy was loaded.

   ```
   docker compose up -d --no-build
   docker compose logs mongo | grep bodorgo:
   ```

   You must see `bodorgo: database copy loaded`. The copy is only read into an empty database: if it says the loading failed, fix the cause and start over with `docker compose down -v` and `up` again.

6. **Copy the uploads into the running server.**

   ```
   docker compose cp STICK/files/documents/. api:/app/documents/
   docker compose cp STICK/files/chat-images/. api:/app/chat-images/
   docker compose exec -u root api chown -R node:node /app/documents /app/chat-images
   ```

7. **Put the reverse proxy in front**, over HTTPS: `bodorgo.hu` → `WEB_PORT`, `api.bodorgo.hu` → `API_PORT`.
   - WebSockets must be let through to the API.
   - The two addresses must be under one domain; the login cookie depends on it.
   - `server.env` says `NODE_ENV=production`: over plain HTTP nobody stays logged in.

8. **Check it.** `https://api.bodorgo.hu/health` answers, `https://api.bodorgo.hu/health/version` and the foot of the website both show `{{COMMIT_DATE}} · {{COMMIT}}`, and `docker compose ps` shows three healthy containers.

### Before you let people in

- **Do not run two live copies at once.** `server.env` has `BACKGROUND_JOBS=on` and `TOUR_VIDEO_EMAILS=on`: two servers would send every reminder twice. The restored copy also holds people's push subscriptions and will send notifications to their phones. For a try-out beside a working live site, switch both lines off, set `EMAIL_REDIRECT_TO=<your address>`, and set `DUMP_SKIP=sessions pushsubscriptions` in `.env` before the first start.
- **Another address than `bodorgo.hu`?** The website image has the API's address built into it ({{API_URL}}). Set `PUBLIC_API_URL` in `.env` and rebuild it (`docker compose up -d --build web`, needs internet), and change `CLIENT_BASE_URL`, `CLIENT_ORIGIN` and `API_BASE_URL` in `server/.env`. Stripe's webhook and Barion's callback must then be pointed at the new API address in those accounts. README section 13 lists the few texts that still name `bodorgo.hu`.
- **Never change** `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` (every phone would have to switch notifications on again), `FUTOKOR_TAG_SECRET` (printed cards stop working) or `APP_SECRET_KEY` (the login service's settings stored in the database become unreadable).
- **Backups.** Nothing here backs itself up. README section 8, "Backing up", has the command; schedule it.

## Restoring a later moment than this folder's

The code and the images stay good for as long as the app itself was not changed after the date above. What does change every day is the data, in four places. For a restore to a later moment, take these from the NAS's backups of that moment instead of the copies here:

| What | Where on the NAS (and in its Hyper Backup) | Goes |
| --- | --- | --- |
| The database | `/volume2/backups/bodorgo-db/hourly/mongo-NN.archive.gz` (last 24 hours) or `daily/mongo-<date>.archive.gz` (03:00, 60 days) | alone into `handover/db/` in step 4. These files hold several databases; only `bodorgo` is taken. |
| The uploads | `/volume2/server/bodorgo/documents/` and `chat-images/` | step 6. An older copy under a newer database leaves cards pointing at missing files. |
| Authentik's database | `/volume2/backups/bodorgo-db/hourly/authentik-NN.sql.gz`, `daily/authentik-<date>.sql.gz` | case C below. People who registered after this folder was made are only in a newer one. |
| The settings | `/volume2/server/bodorgo/.env` | `server/.env`, if a line was added or changed since. |

## Logging in

People log in through an OIDC provider — today an Authentik at `oridzs.terfotozas.hu`, on the same NAS the app ran on. The app matches a person **by e-mail address alone**, so any provider that vouches for the same e-mail opens the same account with all its data. The provider's settings are in the database (Klub → Beállítások → OIDC szolgáltató), the secrets encrypted with `APP_SECRET_KEY`.

Which case are you in?

**A. The old Authentik still works.** Nothing to do if the app is back under the same addresses. Under a new address, add `https://<API address>/auth/callback` and the site's address to the provider's Redirect URIs in Authentik.

**B. Authentik is gone, and you need in now: the emergency login.** It lets in one person, the role manager, with a password.

1. In `server/.env`: `INITIAL_ADMIN_USER` is the role manager's e-mail, `INITIAL_ADMIN_PASSWORD` a long password (both are already there), and set `LOCAL_LOGIN=true`.
2. `docker compose up -d`. The login page now asks for e-mail and password. Nobody else can log in meanwhile.
3. When a provider is ready, enter it on Klub → Beállítások → OIDC szolgáltató, set `LOCAL_LOGIN=false`, and `docker compose up -d` again.

**C. Authentik is gone, and everyone must be able to log in again.** Two ways:

- **A new provider, people invited again.** Set up any OIDC provider (a fresh Authentik as in README section 9, or another), enter it as in case B, and have people register with the e-mail address they had. Nothing of theirs is lost; they only choose a new password. This is the simple and tested way.
- **The old Authentik restored**, so that passwords and Google sign-ins keep working. Not rehearsed — expect to adjust. In outline: run Authentik in the version named in `authentik/compose.yaml` with a PostgreSQL of its own; before its first start create an empty database and load the dump into it (`gunzip -c authentik-….sql.gz | psql -U <user> -d authentik`); give it the `AUTHENTIK_SECRET_KEY` and mail settings from `authentik/authentik.env`; copy the two e-mail templates from the source's `server/authentik/` into its `custom-templates` folder; point `oridzs.terfotozas.hu` at it, or, under a new address, correct the Server URL on the OIDC szolgáltató tab (through case B) and make a new Google sign-in client for that address. README section 9 describes what the app relies on in Authentik, and how to get into a locked Authentik (`ak create_recovery_key`).

## If the old machine is still there

The usual failure is smaller than a lost machine. On the NAS the app does not run in Docker: the API is one bundled `server.js` under pm2 (user `gazda`, `/volume2/server/bodorgo`), the website is static files served by Apache (`web/bodorgo`), and MongoDB is the container `mongodb`. README section 7 covers restarting and redeploying both (`pm2 restart bodorgo`; `npm run build` in `server/`, `npm run deploy` in `client/`), and section 6 the hourly database dumps on the NAS (`/volume2/backups/bodorgo-db/`), which are newer than the copy in this folder. To load a dump into an existing MongoDB:

```
mongorestore --archive=<file> --gzip --nsInclude='bodorgo.*' --drop
```

## Where to read more

All in the source's `README.md`: what the app does (1), roles and the role manager (2), how it is built (3), the settings file line by line (`server/src/.env.example`), data and files (6), the live setup (7), Docker (8), Authentik (9), helper scripts (11).
