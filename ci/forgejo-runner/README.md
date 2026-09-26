# Forgejo Actions runner on the Synology NAS

Runs the server tests (`.forgejo/workflows/server-tests.yml`) for every pull
request and every push to `main`, and blocks merging a PR while they fail.

How it fits together: **Forgejo** only hands out the jobs; the **runner** (a
small container on the NAS) picks them up and runs each one in a fresh,
throwaway `node:22-bookworm` container. One job at a time, at most 2 GB of
memory each (no CPU limit - Synology's kernel doesn't support one); a run
takes about 1-2 minutes.

## 1. Turn Actions on for the repository

Forgejo → the `bodorgo` repository → **Settings** → under the repository
features ("Units"), make sure **Actions** is enabled → Save.

(If there's no such option at all, Actions is switched off for the whole
Forgejo instance: in Forgejo's `app.ini` set `[actions]` → `ENABLED = true`
and restart the Forgejo container.)

## 2. Create a registration code

Forgejo → **Site Administration** → **Actions** → **Runners** →
**Create new runner** → copy the registration code. (Forgejo 14 shows a
single code; newer Forgejo versions show a UUID + token instead - see the
runner documentation if Forgejo is ever upgraded past 14.)

## 3. Put the runner on the NAS (it registers itself)

1. In File Station, create a folder, e.g. `docker/forgejo-runner`.
2. Copy into it, from this repository's `ci/forgejo-runner/` folder:
   - `docker-compose.yml`
   - the `data` folder (with `config.yml` inside)
3. On the NAS, open `docker-compose.yml` (File Station → right-click → Open
   with Text Editor) and replace `PASTE-THE-CODE-HERE` with the code from
   step 2.
4. **Container Manager** → **Project** → **Create** (or, in Dockge, a new
   stack with this compose file):
   - Project name: `forgejo-runner`
   - Path: the `docker/forgejo-runner` folder
   - Source: "Use existing docker-compose.yml"
   - → Next → Done.

On its first start the container registers itself (its log shows
"Registering with ..." and a harmless "register has been deprecated"
notice), then waits for jobs. In Forgejo → Site Administration → Actions →
Runners it appears as **Idle**.

**Inside the LAN**, `forgejo.terfotozas.hu` has to point at the reverse
proxy's LAN address (`192.168.1.81`) - from the NAS the public address
isn't reachable. `docker-compose.yml` (`extra_hosts`) and
`data/config.yml` (`--add-host`) already do that; update both if that
address ever changes. After changing either file: Container Manager →
Project → Action → Stop → Clean → Build.

## 4. Try it

Open a pull request - the repository's **Actions** tab shows the
`server-tests` run. The first run is the slowest (it downloads the npm
packages and the MongoDB binary once; later runs reuse them).

## 5. Block merging while the tests fail

Repository → **Settings** → **Branches** → **Add rule** for `main`:
- enable **status checks** ("Require status checks to pass before
  merging"),
- choose the `server-tests / test` check (it's listed once it has run at
  least once, step 4),
- Save.

From then on a PR's **Merge** button stays disabled until the tests pass.
