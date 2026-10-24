# Changelog

All notable changes to spår are recorded here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project
uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- The source is published under the GNU Affero General Public License v3.0.
- `CONTRIBUTING.md`, `SECURITY.md` and this changelog.
- The link-preview function reads the origins it answers from an `ALLOWED_ORIGINS` secret.
- The Web Push public key is read from `VITE_VAPID_PUBLIC_KEY` at build time. A build without it
  says that reminders will not ring on the device instead of trying to subscribe.
- **Import from Google Keep**, in the browser: a Google Takeout zip (deflated, split parts, ZIP64)
  or its unzipped `Keep` folder, read on the device. Titles become note names, checklists tick
  boxes, saved links addresses, and Keep's created and edited times are kept; archived notes go to
  the Archive, pinned ones are marked important, Keep's trash stays behind. Each label can become a
  new board, go into an existing one or stay in the Inbox, and labels that did not become a note's
  board are kept on its last line. Photographs, drawings and recordings come in as files under the
  25 MB limit, and anything left behind is named. A second import skips what is already here, and
  the whole import has one undo that moves it to the trash. Offered from the menu and on the empty
  Inbox of a new archive.
- A build made with `VITE_RUNTIME_CONFIG=1` reads its backend from `/config.json` on the server it
  is served from (`supabase`, `spar-server` or `none`, with the Supabase project, the Web Push key
  and the sign-up mode), after the notes are on screen and never before them. A build without it
  answers from its own variables and fetches nothing new. See `docs/self-hosting.md`.
- An email-and-password sign-in form for the spår server, offering to make an account only where
  the server allows it (the first account, open sign-up, or an invite code).
- **The app syncs with the spår server.** A runtime build pointed at one signs in and makes
  accounts there, and syncs notes, boards, ideas, files, link previews and reminder subscriptions
  with it, hearing the other device's changes live over the server's event stream. A device that
  has signed in once opens straight onto its notes. Signing out, a session ended elsewhere and a
  deleted account all return the app to the sign-in form. The About page can close the account
  (after the password is given again), deleting everything the server holds for it.
  `npm run e2e:server` proves the round trip in headless Chrome against a throwaway server.
- **The spår server** (`server/`), a self-hosted backend with no Supabase: one Node process and one
  SQLite file holding accounts (email and password, no email server needed), sync, files, reminders
  that ring through Web Push, link previews, a live change stream, and account export and deletion.
  It implements the sync contract with no known deviation and is checked against it on every push.
  An admin command line makes accounts and invites and resets passwords. Its API is
  `docs/server-api.md`, and it serves the `/config.json` a runtime build reads.
- **`npm run supabase:setup`**, for running spår on a Supabase project of your own: it links the
  project, pushes and verifies the migrations, makes the Web Push keys, sets the functions' secrets,
  stores the two Vault secrets the reminder sweep reads, deploys both functions, and prints the
  dashboard steps and the app's settings. Every step can be run again or resumed, `--dry-run` runs
  nothing, secrets never reach a command line or the screen, and it refuses a project that already
  holds notes unless told otherwise. See "Bring your own Supabase" in `docs/self-hosting.md`.
- On Supabase, a runtime-config build whose `/config.json` says `"signup": "open"` lets a sign-in
  link make an account for a new address. Every other build, and every other value, still never
  makes one.
- **The container image**: the app and the spår server on one port, every byte of state in one
  `/data` volume, running as an unprivileged user with a healthcheck and a clean `docker stop`.
  Published to the GitHub Container Registry for `linux/amd64` and `linux/arm64` on every version
  tag, with a `docker-compose.yml` example. `docs/self-hosting.md` is now the guide: running it,
  HTTPS behind a reverse proxy, the first account, backups and upgrades.
- **One image, any backend.** `SPAR_BACKEND=supabase` (with `SPAR_SUPABASE_URL`,
  `SPAR_SUPABASE_KEY` and `SPAR_VAPID_PUBLIC_KEY`) serves the app pointed at your own Supabase
  project, and `SPAR_BACKEND=none` serves it device-only; either way the server's own API and
  database stay off. A secret Supabase key is refused rather than served.
- **A public demo build**, `npm run build:demo` (into `web/dist-demo/`): the app with no server,
  every note kept in the visitor's browser, no sign-in screen. An empty Inbox offers **Try it with
  sample notes**, an invented set with a pile to tidy, dressed boards, checklists, links, a merged
  idea with its canvas, an important note, a repeating reminder and a picture, loaded like an
  import and taken back with one undo. The demo says where the notes live, that links and reminders
  need a server, and what its address receives (nothing), and ships the security headers, a
  privacy page and a 404 page for Cloudflare Pages. `.github/workflows/demo.yml` deploys it on
  every version tag once the Pages settings exist. None of it is in any other build. See
  `docs/demo.md`.
- **A README**: what spår is and is not, the Docker quick start, coming from Google Keep, the
  features, the principles, the alternatives worth choosing instead, privacy, self-hosting and
  development. Its pictures (`docs/media/`: a desktop-and-phone hero, the canvas, and GIFs of
  capture, Tidy up, the Keep import and merge) are made by **`npm run shots`** from the demo's
  invented sample notes and a synthetic Takeout, in headless Chrome under Docker; it checks every
  scene holds the sample set and nothing else, and refuses to start while a seeded real archive is
  in the checkout.
- `docs/ios.md`: putting spår on an iPhone or iPad's Home Screen so reminders can ring, and what is
  known about web apps in the EU.
- A root test that every relative link in the public documents resolves, headings included.
- **Boards can be dragged into order.** Hold a tab (or a drawer row) until it lifts, then carry it:
  folders move among folders, and Todos, Links and Files among themselves, never across the line
  between them. Letting go where it was still opens the board's menu, whose Move rows stay as the
  way that needs no pointer; the lenses' order syncs with the folders.

### Changed

- The web client reaches its backend through one interface (`web/src/store/backend/`). The
  Supabase calls moved behind it unchanged, into the chunk the Supabase client already loads in,
  so the first paint's bundle is slightly smaller.

### Fixed

- Migration `0025`: a Supabase project created with
  today's defaults can reach canvases, boards and push subscriptions, because the tables are now
  granted explicitly; a note emptied on one device is stored empty instead of reverting to its
  first capture on the others; re-sending a note can no longer move its `updated_at` backwards; and
  a Google Keep id is unique per account rather than across all of them.
