# Browser checks

Review STD-03 (`review/2026-10-04/quality-bar.md` §7). A short Playwright job that opens the
**demo build** — the whole app, no backend, invented sample notes — in a real Chromium and checks
what unit tests cannot see. The tests titled `@core` run in **Firefox** too (CH-01), because the
owner uses spår in Firefox on his phone and his PC. It runs in CI as the last step of `.github/workflows/check.yml` and
**never in the deploy hook**: a flaky browser must not be able to stop a deploy.

## What it checks

| File (`web/e2e/`) | Check |
|---|---|
| `screens.e2e.ts` | axe-core (WCAG 2.x A+AA) on the Inbox, an open note, the drawer, Tidy up, Tick off, search, About and Links, at 390×844 and 1440×900. Serious or critical violations fail; lesser ones are printed as `[axe note]`. The same screens are compared with stored pictures, 0.1% of pixels allowed to differ. |
| `speed.e2e.ts` | The first letter typed in search paints within 200 ms (Interaction to Next Paint) with the CPU throttled 4x. |
| `copy-undo.e2e.ts` | About, an open note with a reminder and the empty-trash dialog never say "other device" or "Synced", and say "server" only in the demo's own honest sentences; deleting and archiving offer an undo and the undo works; a mode opened straight after a board action carries no stale undo. |
| `core.e2e.ts` | `@core`: a note is captured with the write field and Save, shows on the board, and opens and closes; Tidy up shows a note to Leave, Back one note is off on the first and on after leaving, and Stop ends it. |
| `marks.e2e.ts` | `@core`: one mark per tier (24, 20 and 14px) has the computed stroke-width the design sets, 1.5, 1.8 and 2.57, in Chromium and in Firefox. |
| `back.e2e.ts` | After a note (its button, Back, and closed-then-the-next-opened at once), the drawer, Settings and a reload onto a left-over entry, the board stands on the app's first history entry, and one Back from it leaves the app (`@core`). |

Not done yet from §7: Lighthouse CI (LCP / CLS) and the sign-in screen against a dummy backend.

## Run it

From the repository root:

```
npm run test:e2e
```

That builds the demo (`web/dist-demo/`, gitignored), starts `vite preview` on port 4173 and runs
the checks. `npx playwright test --project=firefox` runs only the `@core` tests in Firefox. First time on a machine: `npx playwright install chromium firefox` in `web/`. Useful variables:
`E2E_PORT` (preview port), `E2E_OUTDIR` (serve a demo build you made yourself, in that folder), `E2E_UPDATE=1` (take every picture again after a change to how something looks is
meant). It never touches a real account: the demo build has no backend, and the clock is fixed so
"due in 2 days" reads the same every run.

## The pictures (baselines)

They are **not committed from a developer's machine**: text is anti-aliased differently on Windows
and on CI's Linux, so a local picture would fail its first CI run for no reason. The first CI run
writes any picture that is missing and passes; it uploads them in the `e2e-baselines` artifact.
Download that, put the files in `web/e2e/baselines/`, commit them. From then on a run compares
against them, and a failed comparison leaves the new, the old and the difference in the artifact's
`results/` folder. After a deliberate visual change: re-take with `E2E_UPDATE=1` (in CI, that means
committing the new artifact the same way).

## Marks are drawn at the same weight in Chromium and Firefox

Found 2026-10-13 (the owner uses Firefox): `.icon { stroke-width: calc(var(--icon-stroke) * … ) }`
was unitless, Firefox drops that, and every mark came out at a third of its weight. It is a
`* 1px` length now (`styles/70-note-view-and-motion.css`), and `styles.test.ts` holds the shape.
Measured on the demo build, drawn width on screen (computed stroke-width × box / 24), before and
after: Chromium 1.50px at all three tiers both times; Firefox 1.00 (24px box), 0.83 (20px) and
0.58 (14px) before, 1.50 at all three after. `marks.e2e.ts` (`@core`, so it runs in Chromium and
Firefox) reads `getComputedStyle(svg).strokeWidth` of one mark per tier and expects 1.5, 1.8 and
2.57; with the unitless form back it fails in Firefox (received 1).

## No web test over eight seconds

Not a browser check, but the other CI-only gate, and here for the same reason: it must never be able
to stop a deploy. The deploy hook fails a deploy when any web test passes Vitest's 15 s timeout, so a
test creeping towards it is a deploy that one day fails for no reason in the code (audit 2026-10-10,
CODE-5). In CI the web suite writes a JSON report (`web/test-report.json`, gitignored), and
`web/scripts/slow-tests.mjs` reads it: it prints the five slowest, and for any test over 8 s it runs
that test's file again **alone** — a whole-suite run shares the machine between a hundred and sixty
files, and a test that takes half a second alone has been seen at nine. Only a test still over 8 s on
its own fails the step. The same by hand, from the repository root:

```
npm --prefix web test -- --reporter=default --reporter=json --outputFile.json=test-report.json
node web/scripts/slow-tests.mjs web/test-report.json --limit 8000
```

A test that fails it is made faster, not given a longer limit: seed the store instead of driving the
screen to the state under test, and split one that does several things. Loading code is not a test's
cost — every `App.*.test.tsx` starts with the app's lazy layers already in memory
(`web/src/test/appChunks.ts`).
