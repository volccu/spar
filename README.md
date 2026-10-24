<p align="center">
  <img src="web/public/icon.svg" width="96" height="96" alt="The spår mascot: a small square machine with a face, drawn in warm greys">
</p>

<h1 align="center">spår</h1>

<p align="center">
  A local-first Google Keep replacement: capture without choosing anything, tidy the pile to zero later.
</p>

<p align="center">
  <a href="https://spar.willemaki.com"><b>Try the demo</b></a> ·
  <a href="#run-it-with-docker"><b>Run with Docker</b></a> ·
  <a href="#coming-from-google-keep"><b>Import from Keep</b></a>
</p>

![spår on a desktop and on a phone: the Inbox, a flush grid of short notes on a dark ground](docs/media/hero.png)

spår (Swedish for *trace*) is a notes app for one person. It keeps Keep's model — short notes,
lists, links and pictures on cards — and replaces the interface: nothing to decide when you write
something down, and a quick way to put it all away afterwards. It runs in the browser and installs
as an app. It works with no server at all; add one when you want your notes on more than one device.

- **Capture asks for nothing.** One field at the bottom of the screen. Type, press Enter, and the
  note is on the board. No title, no folder, no label to pick first.
- **Tidy the pile to zero.** Everything you write lands in the Inbox. When you have a minute,
  *Tidy up* shows one note at a time with your folders as buttons, and the Inbox counts down to zero.
- **Reminders that repeat, free.** Once, or every day, week or month, set on the note itself and
  rung by Web Push from your own server. There is no paid tier to put them behind.
- **Offline, no account, no AI.** The app opens from your device and works without a network. Used
  on one device it needs no account and no server. Nothing reads your notes to summarise, tag or
  "enrich" them: there is no model call anywhere in the code.

## See it

**Capture.** Type, press Enter, and it is there, before any server has heard about it.

![Typing a note into the bar at the bottom and pressing Enter; the note appears at the top of the Inbox at once](docs/media/capture.gif)

**Tidy up.** One note at a time: move it to a folder, archive it, or delete it, until the pile is gone.

![Tidy up working through five notes, filing three into folders, archiving one and deleting one, ending on an empty Inbox](docs/media/tidy.gif)

**Import from Google Keep.** A Takeout zip, read on your device. Labels can become folders; the rest lands in the Inbox.

![Choosing a Google Takeout zip on the import screen, sending two labels to the Inbox, importing, and landing on the Inbox with the new notes](docs/media/keep.gif)

**Merge, and un-merge.** Two notes become one idea with a canvas. Taking the merge back puts both where they were.

![Selecting two notes, merging them into an idea, opening the idea's canvas and choosing Un-merge; the two notes return to the Inbox](docs/media/merge.gif)

**The canvas.** An idea's notes laid out by hand, with lines and words drawn between them.

![The Lisbon in May idea: four notes arranged on a grid canvas, an arrow drawn from one to another, and a line of text written beside them](docs/media/canvas.png)

Everything in these pictures is the demo's invented sample notes. `npm run shots` makes them again.

## Run it with Docker

One container holds the app and a small sync server with its SQLite database. Everything it keeps
is in one volume.

```bash
docker run -d --name spar --restart unless-stopped \
  -p 127.0.0.1:8080:8080 \
  -v spar-data:/data \
  -e SPAR_ALLOWED_HOSTS=localhost \
  ghcr.io/volccu/spar:latest
```

Open <http://localhost:8080> and make the first account; it becomes the admin. The image is built
for `linux/amd64` and `linux/arm64`, so a Raspberry Pi 4 or 5 works.

The port is on loopback on purpose. Browsers allow a service worker (offline, installing, sharing
into the app) and Web Push (reminders) only over HTTPS or on `localhost`, so to use spår from a
phone, put an HTTPS reverse proxy such as Caddy in front of it. [`docs/self-hosting.md`](docs/self-hosting.md)
covers that, the first account, sign-up settings, backups and upgrades.

## Coming from Google Keep

In Keep's Takeout (takeout.google.com, choose Keep), Google sends you a zip. In spår, open the menu,
choose **Import from Google Keep**, and pick the zip or the unzipped `Keep` folder. It is read in the
browser; nothing is uploaded to be read.

- Titles, text, checklists (as `[ ]` / `[x]` lines), saved links, and Keep's own created and edited
  times come across. Pinned notes are marked important. Archived notes go to the Archive; Keep's
  trash is left behind.
- Photographs, drawings and recordings become attached files (up to 50 MB each). Anything that could
  not come across is named in the summary, never dropped silently.
- Each label can become a new folder, go into a folder you have, or stay in the Inbox. A note lives
  in one folder, so the labels that did not become its folder are written on its last line
  (`Keep labels: work, ideas`).
- Keep's colours, its reminders (Takeout does not export them) and its sharing do not come across,
  and the import screen says so before you start.
- Importing the same Takeout again skips what is already here, and one undo sends the whole import
  to the trash.

Then *Tidy up* takes it from there.

## Features

**Writing and finding**

- A capture bar at the bottom of every screen. On a keyboard Enter saves and Shift+Enter starts a
  new line. Four optional marks beside Save (important, to-do, folder, reminder) all start off.
- Installed on Android, spår is in the share sheet: a page, some text or several photos shared from
  another app become one note. A long press on the icon offers *New note*.
- Notes are cards in a flush grid, each drawn for what it holds: text, a checklist, a saved link
  with its preview, a photograph, a PDF.
- Search as you type, over every note including the Archive, and over the words inside attached PDFs
  and pictures (read on your device).
- The grid can be walked from the keyboard; the keys are listed in Settings and on the About page.

**Organising, when you want to**

- Folders. A note is in at most one, like a file. A folder you make can have its own mark and one of
  sixteen muted tints; that is the only colour in the app.
- Inspiration is a folder of its own, drawn as a wall of pictures and links to look at again.
- Todos, Links, Files and All gather notes from every folder without moving them.
- *Tidy up* works through a pile one note at a time, on the Inbox or any folder. The *Ticker* does the same for the
  lists on Todos, with every box a button; *Untick all* resets a weekly shopping list.
- Select several notes (long press, or right-click) to move, archive, delete or merge them.
- Merging makes an **idea**: one card for related notes, with a canvas to arrange them on, draw on
  and write on. *Un-merge* puts the notes back. Selected words in a note can be split off into a new
  note.

**Keeping**

- The words you first wrote are kept forever, whatever you edit later, and are in every download.
- Delete moves a note to the Trash for 30 days. Archiving, deleting, filing, merging and importing
  can each be undone.
- Reminders: once, or repeating daily, weekly or monthly. A one-off reminder's notification has
  *Later* and *Done* on it.
- *Download everything* (in Settings) saves a zip that needs nothing from spår to read: each
  note a text file, in a folder per place, with its files beside it, and everything again as one
  JSON file.

**Sync, if you want it**

- With the spår server (the container above) or with a Supabase project of your own: sign in, and
  notes, folders, files and reminders sync between devices, with changes arriving live.
- The device is the source of truth. The app opens from local storage and writes there first;
  sync runs afterwards. Conflicts resolve last-write-wins per field, with no CRDTs, which is enough
  for one person on a few devices.

**Not in spår**, on purpose or not yet: native apps and home-screen widgets, sharing a note with
someone else, end-to-end encryption, labels, and colours for notes.

## Principles

The long version, with the reasons, is in [`SPEC.md`](SPEC.md) (what the app does) and
[`DESIGN.md`](DESIGN.md) (how it looks). The short one:

1. **Capture asks for nothing.** Writing something down costs exactly one field and Enter.
2. **Organising is optional, after the fact, and one gesture.** Never required, never a menu dive.
3. **The original capture is always recoverable.** Edits never overwrite what you first wrote.
4. **Nothing is destroyed by accident.** Delete means the Trash; only the 30-day sweep or emptying
   the Trash by hand, which asks first, removes a note for good.
5. **A note needs no metadata to work.** Every field beyond the text is yours to set or leave.
6. **The everyday path is instant.** Open, capture, edit and find commit locally in under 50 ms,
   with no spinner. Settings shows how fast it was on your device.
7. **Everything can leave.** One download holds the whole archive in plain files.

And one about looks: **there is no colour, and dark is the ground.** The app is a warm greyscale
on a dark ground, so the brightest thing on the screen is always what you wrote. The one exception
is the tint you may give a folder you made. Settings offers a light version of the same greys; out
of the box spår follows the device's own setting, and is dark wherever the device asks for nothing.

## Alternatives

spår is small and opinionated, and there are good open-source notes apps that suit other people
better. What each one does better, as far as its own documentation says:

- **[Kept](https://github.com/ericerkz/kept)** is a faithful self-hosted copy of Google Keep: labels,
  colours, drawings, pinned notes, link previews, Takeout import, repeating reminders by browser
  push, and sharing a note with other people on the same server. It has native iOS and Android apps
  with a widget, a share-sheet capture and location reminders. **Choose it** if Keep's interface
  suited you and you only want it on your own server, or you need native apps or shared notes.
- **[Memos](https://github.com/usememos/memos)** is a timeline of Markdown notes with tags, run with
  one `docker run` on SQLite, PostgreSQL or MySQL. It has a REST and gRPC API, public sharing, a web
  clipper and a large community. **Choose it** if you think in a stream rather than in cards, want to
  publish some notes, or want to script against your notes.
- **[Unforget](https://github.com/computing-den/unforget)** is the closest in shape: a local-first
  web app with Google Keep import. It encrypts notes end to end, so its server only ever holds
  ciphertext, and it offers a free hosted sync. It has no reminders. **Choose it** if you want sync
  through a server that cannot read your notes.
- **[Joplin](https://joplinapp.org)** is a Markdown notebook app with native apps on every desktop
  and phone platform, end-to-end encrypted sync through many targets (Nextcloud, WebDAV, S3, its own
  server and others), plugins and a web clipper. Keep import is by a community plugin. **Choose it**
  for long, structured notes, notebooks, and a mature ecosystem.
- **[Notesnook](https://notesnook.com)** encrypts everything end to end and has polished native
  apps on every platform, a rich editor and a thorough on-device Keep import. Its sync server can be
  self-hosted but is still described as alpha, and repeating reminders are on its paid plans.
  **Choose it** for encryption with native apps and a hosted service run by a company.

What spår has that they do not all have: capture that asks nothing, an Inbox you are meant to empty
with Tidy up, merge and un-merge with a canvas, free repeating reminders, search inside PDFs, and no
AI features planned or present. What it lacks, plainly: end-to-end encryption, native apps, widgets
and sharing.

## On iPhone and iPad

spår works in Safari, but reminders only ring once it is on the Home Screen: iOS allows Web Push
only for web apps added there (iOS 16.4 and later). Open spår in Safari, tap Share, then
**Add to Home Screen** (on iOS 26, leave *Open as Web App* on), open it from the new icon, and allow
notifications when you first set a reminder. [`docs/ios.md`](docs/ios.md) has the steps, what to do when notifications do not arrive,
and what is known about the EU.

## Privacy

- **On one device, nothing leaves it.** Without a server your notes are in the browser's storage
  and nowhere else. The public demo works this way: its address hands out the app and receives
  nothing back, not your notes and not what you type. Clearing the site's data deletes the notes,
  so use *Download everything* to keep a copy.
- **With a server, the server is yours.** The spår server stores your notes, files, folders,
  reminder times and push subscriptions, and your email address with a scrypt hash of your
  password. Notes are not encrypted at rest beyond what your disk does, so whoever runs the server
  can read them. With your own Supabase project, the same data lives there instead.
- **Link previews are fetched by your server** (or your Supabase project's function), not by the
  browser, so the site you linked sees your server's address, and the preview's picture is stored
  with the note rather than loaded from that site. Reminders travel through the push service your
  browser uses (Google's, Mozilla's or Apple's); Web Push encrypts the message, so that service sees
  when a notification was sent, not what it says.
- **No telemetry.** There are no analytics, no error reporting and no calls home. The fonts are
  served with the app. spår times its own capture, open, typing and search on your device and shows
  the medians in Settings; the timings are never stored or sent.

## Self-hosting

There are three ways to run spår, all described in [`docs/self-hosting.md`](docs/self-hosting.md):

1. **One container** (the default): the app and the spår server, with SQLite, in one image and
   one volume.
2. **Your own Supabase project**: the same image serves the app and points it at your project;
   `npm run supabase:setup` prepares the project.
3. **One device only**: the static app with no backend, served from any web server, or the image
   with `SPAR_BACKEND=none`. The public demo is this build; see [`docs/demo.md`](docs/demo.md).

## Development

spår is Vite, React and TypeScript in the browser, IndexedDB on the device, and a Node server with
SQLite (or Supabase) for sync. You need Node 22. Run every command from the repository root; the
root scripts reach into `web/` for you.

```bash
npm ci && npm --prefix web ci   # once
npm run dev                     # the app, device-only unless web/.env names a backend
```

With no `web/.env` the app runs on the device only, which is all most changes need. To work on
sync, run the spår server from source as [`docs/self-hosting.md`](docs/self-hosting.md#running-the-server-from-source)
describes.

Every change passes the same checks CI runs:

```bash
npm run lint                    # eslint over the repository, then the server's and the root's typechecks
npm test                        # the root suite
npm run build:web               # the app's typecheck, then the production build
npm run test:web                # the app's suite
npm run test:server             # the spår server's suite
npm run test:conformance:server # the sync contract, run against the spår server
npm run e2e:server              # two headless Chrome profiles against a real server (needs Docker)
```

Neither test suite checks types, so `npm run build:web` (the app) and `npm run lint` (the server,
and `src/`, `tests/` and `conformance/`) are the only places a type error shows. To run one test file:

```bash
npm test -- tests/keep.test.ts                    # the root suite
npm --prefix web test -- src/lib/face.test.ts     # the app's suite
```

[`CONTRIBUTING.md`](CONTRIBUTING.md) explains what each one covers and how a pull request reaches a
release. `npm run shots` rebuilds the pictures in this README from the demo's sample notes
(it needs Docker). Security reports go to [`SECURITY.md`](SECURITY.md); changes are listed in
[`CHANGELOG.md`](CHANGELOG.md).

### Where things are

```text
web/                    the app: everything that runs in the browser
  src/App.tsx           the screen: boards, the open note, the modes, Back and Escape
  src/components/       one file per piece of the screen (NoteCard, NoteView, CaptureBar, Sorter…)
  src/lib/              logic with no storage in it, and the small hooks App.tsx is built from
  src/store/            the device's database (IndexedDB), sync and its outbox, accounts, undo
  src/store/backend/    the two sync targets behind one interface: the spår server and Supabase
  src/styles.css        every visual value, as tokens; styles.test.ts holds the design rules
  public/               icons, fonts, the manifest, and the service-worker parts for push and share
  e2e/                  browser checks (Playwright) against the demo build
server/                 the spår sync server: Node and SQLite, accounts, files, link previews, push
supabase/               the other backend: Postgres migrations and two edge functions
conformance/            the sync contract as tests, run against either backend
src/, tests/            the original command-line Google Keep importer and its suite
scripts/                project setup, migration checks, screenshots, the end-to-end server run
docs/                   self-hosting, the sync contract, the server API, database migrations
```

Most tests sit beside the file they test (`face.ts` and `face.test.ts`). The app-wide ones are
`web/src/App.*.test.tsx`, one file per behaviour.

### Decisions that shape the code

These are settled. [`SPEC.md`](SPEC.md) gives the reasons, and a change that keeps them is much
easier to take than one that argues with them.

- **The device is the source of truth.** The app reads and writes IndexedDB and never waits for
  the network. Changes go into an outbox that is sent in the background and retried until the
  server takes them.
- **Last write wins, field by field.** No CRDTs (merge-anything data structures) and no block
  model: one person on a few devices seldom edits the same field in two places at once.
  [`docs/sync-contract.md`](docs/sync-contract.md) is the exact rule, and `conformance/` tests it.
- **Two backends, one contract.** The app talks to sync through one interface (`Backend`, in
  `web/src/store/backend/types.ts`) with two implementations, and the conformance suite runs the
  same tests against both.
- **What you first wrote is never changed.** `raw_content` is set once, and both backends refuse
  any change to it. Every edit goes to `body`.
- **Delete moves to the Trash.** Only the 30-day sweep and emptying the Trash by hand (which asks
  first) destroy a note.
- **A folder is a real place.** A note is in at most one, like a file. Todos, Links, Files and All
  are views across every folder; nothing is ever filed into them.
- **No AI.** Summaries, tags and semantic search were tried early and removed (`SPEC.md` §8).
- **The look is enforced by tests.** [`DESIGN.md`](DESIGN.md) decides how things look, and
  `styles.test.ts` fails the build on a raw colour, size, font or timing outside the tokens.

## Licence

spår is released under the [GNU Affero General Public License v3.0](LICENSE). There is no
contributor agreement. The three typefaces it ships, Libre Baskerville, Marcellus and IBM Plex
Mono, are under the SIL Open Font License 1.1 ([`web/public/fonts/OFL.txt`](web/public/fonts/OFL.txt)).
