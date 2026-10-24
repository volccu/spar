import { defineConfig } from "@playwright/test";

/**
 * The browser checks (review STD-03). They run against the **demo build** — the
 * whole app with no backend and invented sample notes — served by
 * `vite preview`, so nothing here can ever reach a real account.
 *
 * They run in CI as their own step and never in the deploy hook: a slow or
 * flaky browser must not be able to hold up a deploy. `docs/browser-checks.md`
 * says how to run them by hand.
 *
 * Environment (all optional):
 *   E2E_PORT     port for the preview server (default 4173)
 *   E2E_OUTDIR   where the demo build was written (default: the build's own dist-demo/)
 *   E2E_UPDATE   "1" re-takes every screenshot baseline
 */
const port = Number(process.env.E2E_PORT ?? 4173);
const outDir = process.env.E2E_OUTDIR ? ` --outDir "${process.env.E2E_OUTDIR}"` : "";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.e2e.ts",
  // Baselines are one folder, not one per platform: see e2e/shots.ts for why
  // they are produced in CI rather than committed from a developer's machine.
  snapshotPathTemplate: "e2e/baselines/{arg}{ext}",
  outputDir: "e2e/results",
  timeout: 90_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never", outputFolder: "e2e/report" }]] : "list",
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    colorScheme: "dark",
    reducedMotion: "reduce",
    serviceWorkers: "block",
  },
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
    // Firefox is the owner's own browser (phone and PC), so the core checks run there too:
    // only the tests titled with @core (CH-01).
    { name: "firefox", use: { browserName: "firefox" }, grep: /@core/ },
  ],
  webServer: {
    command: `npx vite preview --mode demo${outDir} --host 127.0.0.1 --port ${port} --strictPort`,
    url: `http://127.0.0.1:${port}/`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
