# The public demo

The demo is spår with no server behind it: every note is kept in the visitor's own browser, there is
no account and no sign-in screen, and an empty Inbox offers **Try it with sample notes**. It is the
same app as every other build, made with one command, and it is meant to be served as static files
from the root of a domain.

```bash
npm --prefix web ci
npm run build:demo        # the site is in web/dist-demo/
```

## What is different about it

Everything is decided when it is built (`vite build --mode demo`, see `web/vite.config.ts`); nothing
is read at run time.

- **No backend, whatever else is set.** The demo build reads no `web/.env` and defines the backend
  variables empty, so it cannot pick up a Supabase project or `VITE_RUNTIME_CONFIG` by accident. It
  carries no sync client and never asks for `/config.json`. It opens straight onto the Inbox.
- **Sample notes.** On the Inbox of a browser with no note in use (a deleted "test" note does not
  count), and as a menu row beside the Keep import until they are loaded, *Try it with sample notes*
  loads one invented person's notes (rewritten 2026-10-23 to read like real ones, with no tutorial
  notes): a pile of about twenty loose notes for Tidy up, four dressed boards (four, so a phone's
  Tidy up draws each as a one-tap button), to-do lists with some boxes ticked, saved links with
  their previews, two merged notes (one an idea with a canvas), an important note, a reminder for
  tomorrow and one that repeats every week, four photographs on Inspiration and one on Home, a
  recipe PDF written in the browser, a short code snippet, and notes in Archive and the Trash. The
  photographs are CC0 or public domain, shipped in `web/src/demo/pictures` (never hotlinked, never
  precached) and credited in `sampleNotes.ts`. None of it is anyone's real writing. It goes in
  through the same path as the Google Keep import, so it behaves exactly like notes typed in, and
  one undo takes it all back to the trash. The notes and the loader are a chunk of their own
  (`web/src/demo/sampleNotes.ts`), fetched only on the click.
- **It says where the notes are.** The empty Inbox says *Your notes stay in this browser* once, in the machine's
  voice under its offers, the
  header says the same on a wide screen and opens the About page, and the About page says
  what the demo does without a server — a saved link shows its address and your words rather than a
  fetched title and picture, and a reminder waits in the Reminders list without ringing — and holds
  **Download everything**, which exports every note as files.
- **It says what next.** The About page's *Keep using spår* names three ways on: install it, run
  your own copy (linking the README's Docker section and `docs/self-hosting.md`), and keep a copy
  with Download everything. It promises no way to load a download back in, because there is none.
- **The host's own files.** The build adds `_headers` (security headers and cache lifetimes for
  Cloudflare Pages, from `web/demo-site/`), `privacy.html` and a `404.html`.

Every one of these is gated on a build-time constant (`DEMO` in `web/src/lib/demo.ts`). In every
other build it is `false` and the bundler removes the demo's code and words entirely; the build
invariants test checks that.

## Privacy

The demo's address hands out the app and receives nothing back: not the notes, not what is typed,
not which notes are opened. There are no analytics, no cookies and no third-party requests, and the
page's Content-Security-Policy allows it to connect to nothing but its own address (`connect-src
'self'`, pictures only from itself). The same paragraph is on the demo's About page and at
`/privacy.html`.

Clearing the site's data in the browser deletes the notes, and a browser may clear it by itself when
space runs low. Notes made in the demo stay at the demo's address; **Download everything** on the
About page is the way to take them anywhere else.

## Publishing it on Cloudflare Pages

Cloudflare Pages serves the demo from the root of a domain, which matters: the service worker's
scope and the Android share target both assume the app is at `/`, so a sub-path such as a GitHub
Pages project site does not work well.

The workflow `.github/workflows/demo.yml` builds the demo and deploys it on every `v*` tag, and can
be run by hand from the Actions tab. Until it is configured it skips with a notice. One-time setup:

1. **A Pages project.** A "direct upload" project, with no Git connection to make: in the Cloudflare
   dashboard *Workers & Pages → Create → Pages → Upload assets*, or from a machine with `wrangler`
   logged in, `npx wrangler pages project create spar-demo --production-branch main`. The name
   (`spar-demo` here) gives the default address, `https://spar-demo.pages.dev`. Its production
   branch must be `main`, which is the branch the workflow deploys to.
2. **An API token.** *My Profile → API Tokens → Create Token → Custom token*, with the single
   permission **Account → Cloudflare Pages → Edit**, limited to your account.
3. **Three settings on the GitHub repository** (*Settings → Secrets and variables → Actions*):
   - secret `CLOUDFLARE_API_TOKEN`: the token from step 2;
   - secret `CLOUDFLARE_ACCOUNT_ID`: the account ID shown on the dashboard's overview page;
   - variable `DEMO_PAGES_PROJECT`: the project name from step 1.
4. **Optionally, your own address.** In the Pages project, *Custom domains → Set up a domain*, for
   example `demo.example.com`. A subdomain of a domain whose DNS is on Cloudflare is one click;
   otherwise add the CNAME it shows you. Serve it at the root of that name, not under a path.
5. **Deploy.** Push a tag (`git push origin v0.1.0`) — the *check* workflow runs first and deploys
   the demo only if every check passes — or run the *demo* workflow by hand.

To deploy from a machine instead of from GitHub, with `wrangler` logged in to the same account:

```bash
npm run build:demo
npx wrangler pages deploy web/dist-demo --project-name spar-demo --branch main
```

### What the headers do

`web/demo-site/_headers` is the same policy the app is served with elsewhere, with two narrowings:
`connect-src 'self'` (there is no server to reach) and `img-src 'self' data: blob:` (no link preview
is ever fetched, so no picture comes from anywhere else). `web/src/demo/demoHeaders.test.ts` holds
the rest of it to the same directives. Hashed files under `/assets/` are cached for a year, the fonts
for a week, and the page and the service worker are checked on every open, so a new release reaches
an installed demo the next time it is opened. The `404.html` makes a missing file a real 404:
without it, Pages answers any unknown path with the app's page under a `200`, and an installed demo
asking for a file a newer release has removed would store that page under the file's name.

## Sample notes from a script

The README's screenshots use the same set, and `npm run shots` (`scripts/shots.mjs`) makes them: it
builds the demo, drives headless Chrome in Docker, presses *Try it with sample notes* on the empty
Inbox of a fresh profile for every scene, checks that the browser holds that set and nothing else,
and writes the stills and GIFs to `docs/media/`. It refuses to start while `web/src/seed/notes.json`
exists unless told `--i-know-seed-exists`. To use the set elsewhere, build it as data:
`buildSampleSet(now)` in `web/src/demo/sampleNotes.ts` returns the boards and notes as plain objects,
with no DOM and no store.
