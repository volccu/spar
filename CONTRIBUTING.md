# Contributing to spår

Thank you for looking. spår is a small, opinionated notes app, and it is built by one person, so
this page is mostly about how a change gets from you into a release.

## Before you open a pull request

Run the four checks CI runs, from the repository root, in this order:

```bash
npm ci && npm --prefix web ci   # once
npm run lint                    # eslint over the whole repository, then the server's and the root's typechecks
npm test                        # the root suite: the importer and the edge functions' shared code
npm run build:web               # the app's typecheck, then the production build
npm run test:web                # the web app's suite
```

The typechecks are `npm run build:web` for the app and `npm run lint` for the server
(`tsc -p server`) and for `src/`, `tests/` and `conformance/` (`tsc -p tsconfig.json`). Neither
test suite typechecks, so a type error passes both of them and only shows up in one of those. None of the four needs a Supabase project or any keys: without them
the app builds and runs on the device only.

CI also runs the spår server's own suite and the sync contract against it
(`npm run test:server`, `npm run test:conformance:server`); run them too when you touch `server/`
or `web/src/store/backend/`. `npm run e2e:server` drives the app against the server in headless
Chrome (it needs Docker) and is worth running before a change to either reaches a release.

A pull request that touches the container (`Dockerfile`, `server/`, `web/`) also builds the image
and runs it once (`.github/workflows/image.yml`); `docker build -t spar .` does the same locally.

If a change alters what the pictures in the [README](README.md) show, `npm run shots` makes them
again from the demo's invented sample notes (it needs Docker; see [`docs/demo.md`](docs/demo.md)).
Never add a screenshot of your own notes. Running spår yourself is described in
[`docs/self-hosting.md`](docs/self-hosting.md).

## How pull requests are handled

Pull requests are welcome, but they are **not merged on GitHub**. The public repository is a series
of release snapshots, so a change is applied by hand as a patch, credited to you, and arrives in the
next release. Your pull request is then closed with a link to that release.

Small, focused changes are the easiest to take. For anything larger, open an issue first so we can
agree on the shape before you spend the time.

## The design rules, in short

spår has a few rules that are easy to break by accident and are not up for negotiation in a patch:

- **There is no colour.** Emphasis is a step along a warm greyscale or a heavier rule, never an
  accent, a coloured link or a red error. The one exception is the optional tint on a folder you
  made yourself.
- **Dark is the ground.** The light theme is the same greys turned over, chosen per device in
  Settings, never a second palette.
- **Capture asks for nothing.** One text field and Save. The four optional marks beside Save
  (priority, to-do, folder, reminder) all start off, and typing then Enter must stay exactly as
  fast as it is.
- **Organising is optional and costs one gesture.** Never required, never a menu dive.
- **Delete means the trash.** Nothing a person wrote is destroyed except by the 30-day trash
  sweep or by emptying the trash on purpose.
- **The original capture is immutable.** `raw_content` is never rewritten; edits go to `body`.
- **No AI.** No model calls, no embeddings, no enrichment.

[`DESIGN.md`](DESIGN.md) is the source of truth for how the app looks, and [`SPEC.md`](SPEC.md) is
the source of truth for what it does and why. If your change touches either, read the relevant
section first. Both explain their reasons, and a change that keeps the reason is much easier to
take than one that argues with it.

## Licence

spår is licensed under the [GNU Affero General Public License v3.0](LICENSE). By sending a change
you agree that it is released under the same licence. There is no contributor agreement to sign.
