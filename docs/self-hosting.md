# Self-hosting spår

spår runs three ways, and one container image covers the first two:

1. **One container, nothing else** (the default). The image holds the app and the spår server — one
   Node process and one SQLite file with accounts, sync, files, reminders that ring, link previews
   and a live change stream. Everything it keeps is in one volume. No database server, no email
   server, no second container.
2. **Your own Supabase project.** The same image, told to serve only the app and point it at a
   Supabase project you run (hosted or self-hosted).
3. **On one device only.** No server at all: the notes stay in the browser.

The rest of this guide takes them in that order. The [README](../README.md) has the one-command
version and what the app does; [`CONTRIBUTING.md`](../CONTRIBUTING.md) is for building it from source
and sending changes.

---

## One container

### Run it

```bash
docker run -d --name spar --restart unless-stopped \
  -p 127.0.0.1:8080:8080 \
  -v spar-data:/data \
  -e SPAR_ALLOWED_HOSTS=localhost \
  ghcr.io/volccu/spar:latest
```

Open <http://localhost:8080>. The image is built for `linux/amd64` and `linux/arm64` (a Raspberry
Pi 4 or 5 with a 64-bit system works). Tags: `latest`, each release's version (`0.4.1`) and its
minor line (`0.4`); pin one of the last two for anything you depend on.

The port is published on the machine's **loopback only**. That is deliberate: browsers allow the
parts of spår that make it an app — the service worker (opening offline, installing it to a home
screen, the share target) and Web Push (reminders that ring) — only over **HTTPS**, or on
`localhost` itself. To use it from a phone, put an HTTPS reverse proxy in front (next sections)
rather than publishing port 8080 to your network. On an iPhone or iPad, reminders also need the app
added to the Home Screen; [`ios.md`](ios.md) has the steps.

### With Docker Compose

[`docker-compose.yml`](../docker-compose.yml) at the top of the repository is a complete example:
the one service, a named volume for `/data`, the port on loopback, and the settings worth setting.
Copy it, change `notes.example.com` and the contact address, and:

```bash
docker compose up -d
docker compose logs -f spar
```

### HTTPS, behind a reverse proxy

Any proxy that terminates TLS will do. With [Caddy](https://caddyserver.com), which fetches and
renews the certificate by itself, the whole configuration is:

```caddyfile
notes.example.com {
    reverse_proxy 127.0.0.1:8080
}
```

(If Caddy runs as a container in the same Compose project, write `reverse_proxy spar:8080` and drop
the `ports:` from the spår service.) Then tell spår about it:

```yaml
    environment:
      SPAR_ALLOWED_HOSTS: "notes.example.com"
      SPAR_TRUST_PROXY: "1"
```

- **`SPAR_ALLOWED_HOSTS`** is the name the instance is reached by. Set it: every other `Host` is
  refused, so a web page cannot reach the server through a DNS-rebound name of its own — which, on
  a fresh instance, could otherwise create the first account. `/api/health` is the one path that
  answers whatever the host, so the container's own healthcheck keeps working.
- **`SPAR_TRUST_PROXY=1`** makes the server believe the proxy's `X-Forwarded-For`, `-Proto` and
  `-Host`: the session cookie is then marked `Secure`, and sign-in rate limits see real client
  addresses. Turn it on only when a proxy that sets those headers is the sole way in. The client's
  address is the **last** entry of `X-Forwarded-For` — the one your proxy added — because anything
  before it was sent by the client and could be anything. So exactly one proxy may stand in front
  of spår; behind a second one (a CDN in front of your proxy), every visitor would share that
  CDN's address.

Wrong passwords are counted per address and email together: ten in fifteen minutes stop that
address trying that account, while the right password from anywhere else still gets in. Each
address may also try 50 sign-ins in fifteen minutes across all accounts.

With **nginx**, forward the same headers (`proxy_set_header Host $host;`,
`X-Forwarded-For $remote_addr;`, `X-Forwarded-Proto $scheme;`), allow uploads with
`client_max_body_size 64m;`, and give the live change stream (`/api/events`, a Server-Sent Events
stream the server already marks `X-Accel-Buffering: no`) a long `proxy_read_timeout`. Caddy needs
none of this.

### The first account

**The first account made on an instance becomes its admin, whatever the sign-up setting says**, so
make it before the instance can be reached by anyone else. Either open the app and use its sign-up
screen, or use the command line inside the container:

```bash
docker exec -it spar node server/dist/cli.js create-user you@example.com --admin
```

With a terminal attached, the password is generated and printed once. To choose it, pipe it in:
`printf '%s\n' 'your password' | docker exec -i spar node server/dist/cli.js create-user you@example.com --admin`.

After that, `SPAR_SIGNUP` decides who else may join: `closed` (the default: nobody),
`invite` (anyone holding a single-use code from `cli.js invite`), or `open`.

### Settings

All settings are environment variables and all are optional; the full list with defaults is in
[`docs/server-api.md`](server-api.md#server-settings). Besides the two above, the ones worth deciding
on:

| Variable | What it does |
|---|---|
| `SPAR_SIGNUP` | `closed`, `invite` or `open`. |
| `SPAR_VAPID_SUBJECT` | The contact push services see on every reminder (`mailto:` or an https URL). The admin's email by default. |
| `SPAR_STORAGE_CAP_MB` | File storage per account, in MiB. No cap by default; each file is at most 50 MB. |
| `SPAR_BACKEND` | `spar-server` (the default), `supabase` or `none` — see [Bring your own Supabase](#bring-your-own-supabase) and [On one device only](#on-one-device-only). |

The image itself sets `SPAR_HOST=0.0.0.0`, `SPAR_PORT=8080`, `SPAR_DATA_DIR=/data` and
`SPAR_WEB_DIR=/app/web`; there is no reason to change them. It runs as the unprivileged `node`
user (uid 1000). A named volume takes care of itself; if you bind-mount a host folder to `/data`
instead, give it to that user first (`chown 1000:1000 ./spar-data`).

### The admin command line

It opens the same database as the running server (SQLite in WAL mode allows both), so it works on a
live instance: `docker exec -it spar node server/dist/cli.js <command>`.

| Command | Does |
|---|---|
| `users` | Lists every account. |
| `create-user <email> [--admin]` | Makes an account. The password is read from standard input when piped (one line), and otherwise generated and printed once. |
| `reset-password <email>` | Sets a new password the same way and signs that account out everywhere. There is no email reset: this is how a forgotten password is recovered. |
| `invite [--days N]` | Prints a single-use invite code (for `SPAR_SIGNUP=invite`), valid 7 days unless told otherwise. |
| `invites` | Lists the invite codes' state (never the codes). |
| `delete-user <email>` | Removes an account and everything it owns. |

Each person can also take everything out as a zip and delete their own account, from the app's
About page ("Download everything", "Close the account"); the API has both too, see
[The account](server-api.md#the-account).

### Backups

Everything is in `/data`, and all of it matters:

| File | What losing it costs |
|---|---|
| `spar.db` (with `spar.db-wal` / `-shm` while running) | Every note, account and setting. |
| `files/` | Every attached file. |
| `vapid.json` | Every device has to allow notifications again. |
| `session-secret` | Everybody is signed out. |

**The simple way: copy the volume while the container is stopped.** A clean stop folds the
write-ahead log back into `spar.db`, so the folder is then complete and consistent:

```bash
docker stop spar
docker run --rm -v spar-data:/data:ro -v "$PWD":/backup alpine \
  tar czf /backup/spar-$(date +%F).tgz -C /data .
docker start spar
```

**Without stopping it**, take a consistent copy of the database with SQLite's online backup, then
copy the rest:

```bash
docker exec spar node -e "require('better-sqlite3')('/data/spar.db',{readonly:true}).backup('/data/spar-backup.db').then(()=>console.log('done'))"
docker cp spar:/data ./spar-$(date +%F)    # spar-backup.db is the copy to keep; skip spar.db*
docker exec spar rm /data/spar-backup.db
```

On a host that has `sqlite3` and a bind-mounted data folder, `sqlite3 ./spar-data/spar.db
".backup spar-backup.db"` does the same. **To restore**, stop the container, put the files back
into the volume (the backed-up database named `spar.db`, with no `-wal` or `-shm` beside it), and
start it again.

**A lost folder list** does not need a backup: the server keeps every list the preferences row
replaced in `prefs_history` (see [`server-api.md`](server-api.md#put-apiprefs)). Copy the `boards`
of the row you want and send it back with `PUT /api/prefs` while signed in as that person.

### Upgrades

```bash
docker compose pull && docker compose up -d
# or: docker pull ghcr.io/volccu/spar:<version>, then recreate the container with the same volume
```

The database schema is versioned and migrated forward on start, so an upgrade needs nothing but the
new image — **but take a backup first**: an older version refuses to open a database a newer one
has migrated, so going back means restoring that backup. [`CHANGELOG.md`](../CHANGELOG.md) says what each release changes. Installed apps pick
up the new version by themselves the next time they are opened and offer to update.

### Building the image yourself

```bash
docker build -t spar .
```

The build compiles the app with `VITE_RUNTIME_CONFIG=1` and no project baked in, bundles the server,
and installs its one native dependency (`better-sqlite3`) for the image's own platform. For another
platform, use Buildx: `docker buildx build --platform linux/arm64 -t spar .`.

### Running the server from source

The same server without Docker, on Node 22:

```bash
npm ci && npm --prefix web ci
VITE_RUNTIME_CONFIG=1 npm run build:web    # the app, in web/dist
npm run build:server                       # server/dist/main.js and cli.js
SPAR_DATA_DIR=./spar-data SPAR_WEB_DIR=./web/dist node server/dist/main.js
```

It listens on `127.0.0.1:8080` by default (`SPAR_HOST`, `SPAR_PORT`); the command line is
`SPAR_DATA_DIR=./spar-data node server/dist/cli.js <command>`. Its HTTP API is documented in
[`docs/server-api.md`](server-api.md).

`npm run e2e:server` does all of this with a throwaway data folder on loopback and drives two
headless Chrome profiles through it: the first account, sync both ways over the live stream, a
file, a link preview, the export and deleting the account. It needs Docker and the
`zenika/alpine-chrome:with-puppeteer` image, publishes no port, and removes everything it made.

---

## Choosing the backend when the app is served, not when it is built

A build's settings are baked in by default. A build made with `VITE_RUNTIME_CONFIG=1` instead reads
`/config.json` from the server it is served from, so one build can be pointed at any backend
without rebuilding. The Docker image is built this way, and its server answers `/config.json` from
its own environment:

| Container setting | `/config.json` |
|---|---|
| `SPAR_BACKEND=spar-server` (default) | `backend: "spar-server"`, with the server's own Web Push key and sign-up mode. |
| `SPAR_BACKEND=supabase` + `SPAR_SUPABASE_URL`, `SPAR_SUPABASE_KEY`, `SPAR_VAPID_PUBLIC_KEY` | `backend: "supabase"`, `supabaseUrl`, `supabaseKey`, `vapidPublicKey`. |
| `SPAR_BACKEND=none` | `backend: "none"`. |

The file's format, for any other web server that serves a runtime-config build:

```json
{
  "backend": "spar-server",
  "supabaseUrl": "https://your-project.supabase.co",
  "supabaseKey": "sb_publishable_…",
  "vapidPublicKey": "B…",
  "signup": "closed"
}
```

| Key | Meaning |
|---|---|
| `backend` | `"supabase"`, `"spar-server"` or `"none"` (the notes stay in the browser). Required. |
| `supabaseUrl`, `supabaseKey` | The Supabase project URL and its publishable key. Used when `backend` is `"supabase"`; without both, the app acts as `"none"`. |
| `vapidPublicKey` | The public Web Push key. Without it reminders are still set and synced, but do not ring. |
| `signup` | `"closed"`, `"invite"` or `"open"`: who may make an account on a spår server. The server's own answer wins. |

Any key but `backend` may be left out, and falls back to the build's own variable. The file is read
once per visit, after the notes are on screen, and decides only sync and sign-in. If it cannot be
fetched (offline), the app uses the last one it read; if it is missing or names no backend it
knows, the build's own variables apply. A build without `VITE_RUNTIME_CONFIG=1` never asks for the
file.

A `/config.json` naming the spår server gives the app an email-and-password sign-in in place of the
emailed link, and from then on the notes sync with that server exactly as they do with Supabase:
files, link previews, reminders and live updates between devices included. A device that has signed
in once opens straight onto its notes, before the server has answered. On the spår server the About
page also offers to close the account, which deletes everything the server holds for it after the
password is given again; the notes already on the device stay there.

---

## Bring your own Supabase

If you would rather keep your notes in a [Supabase](https://supabase.com) project of your own, the
same app works against it: sign-in by emailed link, sync, files, live updates between devices,
link previews, and reminders that ring. This is how the author's own copy runs. It is more to set
up than the one-container path above, which stays the default; choose this one if you already use
Supabase or want its dashboard.

### What you need

- A Supabase project, hosted at supabase.com (the free tier is enough), and its **reference**: the
  20 letters in `https://<ref>.supabase.co`, under Project Settings.
- This repository with Node 22, and `npm ci` run in it. The Supabase CLI comes with it, pinned.
- The address the app will be opened at, such as `https://notes.example.com`. The app must be
  served from the root of an origin, over https (a phone will not ring reminders otherwise).
- The CLI logged in to your Supabase account, once: `npx supabase login`. It opens a browser and
  keeps a token in `~/.supabase`; never paste the token into a command.

### One command

```bash
npm run supabase:setup -- \
  --project-ref <ref> \
  --origin https://notes.example.com \
  --vapid-subject mailto:you@example.com
```

Any value left out is asked for. It runs these steps in order:

| Step | What it does |
|---|---|
| `link` | Checks the CLI is logged in, then links this checkout to the project. The link may ask for the database password; the terminal takes it, the script never sees it. |
| `migrate` | `npm run db:push`: every migration in `supabase/migrations`, then `db:verify`, which reads each object back from the database. It asks before pushing. |
| `vapid` | Makes the Web Push key pair and gives it to the functions — only if the project has none. |
| `secrets` | Gives the functions `VAPID_SUBJECT` and `ALLOWED_ORIGINS` (the origins link previews answer). |
| `cron` | Makes a `CRON_SECRET` for `send-reminders` and stores it, with the function's URL, as the two Vault secrets the minute-by-minute reminder sweep reads (`reminder_fn_url`, `reminder_fn_key`; migration `0015`). |
| `functions` | Deploys `link-preview` and `send-reminders`. No Docker needed. |
| `finish` | Prints what is left to do in the dashboard, and the settings the app needs. |

Before it writes anything, it counts the spår notes already in the project, and **stops if there
are any**. A project that is already in use does not need setting up again, and doing so would give
it a new cron token and could give it new Web Push keys. `--yes-existing-project` goes on anyway.

Every step can be run again. A run that stopped part way is resumed with `--from-step <step>`.
`--dry-run` prints every command it would run and runs none. Secrets are never put on a command
line or printed: they go to Supabase from a file only you can read, deleted straight afterwards.

**Keep the Web Push public key it prints.** It is public, the app needs it, and it cannot be read
back from Supabase later. A second run keeps the existing pair rather than making a new one,
because every phone and browser that allowed notifications is tied to it. `--rotate-vapid` makes a
new pair anyway, and then every device has to allow notifications again.

To rehearse the database steps on your own machine first, start the local stack
(`npx supabase start`) and run `npm run supabase:setup -- --local`. It checks the migrations landed
and stores the Vault secrets there, and skips everything only a hosted project has.

### In the dashboard

The script cannot change these; it prints them with your own values filled in.

1. **Authentication → URL Configuration.** Set the Site URL to the address the app is opened at,
   and add every such address to the Redirect URLs. The sign-in link brings you back to the
   address you asked from, and Supabase will not send anyone to an address not on the list.
2. **Authentication → Emails → SMTP Settings.** Supabase's own mailer sends only to the members of
   your Supabase organisation, and only a few messages an hour. For anyone else to get a sign-in
   link, give it an SMTP server of your own.
3. **Accounts.** The app never makes an account on its own: signing in with an address that has
   none says so. For yourself, add a user under Authentication → Users. To let other people make
   their own, turn on "Allow new users to sign up" under Authentication → Sign In / Providers →
   Email, **and** tell the app with `signup: "open"` (below). Both are needed; either alone keeps
   sign-up closed.
4. **Authentication → Emails → Templates → Magic Link.** Put the six-digit code in the email beside
   the link — `{{ .Token }}`; `supabase/templates/magic_link.html` is one to paste. Supabase's own
   template has the link only, and an iPhone app on the Home Screen cannot be signed in by the link
   (it opens Safari, whose storage is not the app's); it is signed in by typing the code
   ([iPhone and iPad](ios.md#signing-in-from-the-home-screen-app)).

### Running the app against it

With the Docker image, name the backend and the project, and nothing is rebuilt:

```bash
SPAR_BACKEND=supabase
SPAR_SUPABASE_URL=https://<ref>.supabase.co
SPAR_SUPABASE_KEY=sb_publishable_…     # the publishable key, Project Settings → API Keys
SPAR_VAPID_PUBLIC_KEY=B…               # printed by the setup
SPAR_SIGNUP=open                       # only if others may make accounts
```

The image then serves the app and a `/config.json` naming your project. The notes, the files and
the reminders all live in Supabase; the container holds nothing that needs a backup.

Or build the static app yourself, with the values baked in. Put them in `web/.env`:

```bash
VITE_SUPABASE_URL=https://<ref>.supabase.co
VITE_SUPABASE_ANON_KEY=sb_publishable_…
VITE_VAPID_PUBLIC_KEY=B…
```

then `npm run build:web`, and serve `web/dist/` from any static web server at the origin you gave
the setup. A build like this never offers sign-up to a new address. If you want that with a static
build, build it with `VITE_RUNTIME_CONFIG=1` instead and serve a `/config.json` beside it, as
described above, with `"backend": "supabase"` and `"signup": "open"`.

If the app later moves to another address, run `npm run supabase:setup -- --from-step secrets
--origin <new address> --yes-existing-project`, and change the two URL settings in the dashboard.
Without that, sign-in links point at the old address and link previews stop arriving, with nothing
on screen to say why.

### Where Supabase differs from the spår server

The sync contract (`docs/sync-contract.md` §16) lists every known difference. Two are still open
and worth knowing if you let other people have accounts on your project:

- **A permanent delete is announced to everyone signed in.** When anyone permanently deletes a
  note, Supabase's live updates tell every signed-in user of the project the deleted note's id.
  Only the id: never its words, its files or whose it was. With one account it tells nobody but
  you. It stays because the fix needs a change to how the app listens, not only to the database.
- **A deleted note's files can outlive it.** Supabase does not remove a note's files when the note
  is deleted for good; the app removes them afterwards, and tries again if that fails. A removal
  that never succeeds leaves the files in storage, where only their owner can reach them.

### A Supabase you run yourself

`supabase:setup` works through the Supabase platform's API (linking, function secrets, deploys),
so it is for hosted projects. On a self-hosted Supabase the same pieces are set by hand: apply
`supabase/migrations` in order, give the edge functions the five secrets named in `.env.example`,
serve `link-preview` and `send-reminders`, and create the two Vault secrets as the comment in
`supabase/migrations/0015_push.sql` shows, with the URL your functions are reached at.

## On one device only

With no backend, the app keeps everything in the browser: no account, no sync, and no reminders that
ring. Either run the image with `SPAR_BACKEND=none` (it then serves only the app), or build it and
serve `web/dist/` from any static web server:

```bash
npm ci && npm --prefix web ci
npm run build:web      # the static app is in web/dist/
```

With no settings in `web/.env`, that build is device-only. `.env.example` lists every setting there
is.

A build that *has* a backend also offers **Use on this device only** on its sign-in screen. Notes
written that way are kept when you sign in later: the first account to sign in on a browser adopts
what that browser holds and uploads it. Signing in to an account that already has boards
keeps them: boards made on this browser are added to the account's list, never laid over it. (Signing *out* from the menu is different: it is treated as handing
the browser to someone else, so choosing device-only straight after it clears this browser's copy —
what was synced is still on the server.) The public demo is this mode on its own address, so its
notes cannot follow you to your server except through **Download everything**; see
[the demo](demo.md).
