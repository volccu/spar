#!/usr/bin/env node
/**
 * Fails when a single web test takes longer than eight seconds on its own
 * (audit 2026-10-10, CODE-5).
 *
 *   node web/scripts/slow-tests.mjs <vitest JSON report> [--limit 8000]
 *
 * The deploy hook stops a deploy on any test past Vitest's 15 s timeout, so a
 * test creeping towards it is a deploy that one day fails for no reason in the
 * code. This catches the creep while there is still room — in CI only, never
 * in the hook, so it can never be the thing that stops a deploy.
 *
 * **It does not trust a time measured under load.** In a whole-suite run a
 * hundred and sixty files share the machine, and a test that takes half a
 * second alone has been seen taking nine. So a test over the limit in the
 * report is not yet a failure: its file is run again, alone, and only a test
 * still over the limit there fails the check. The slowest few are printed
 * either way, so the trend is visible before it is a failure.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const reportPath = args.find((a) => !a.startsWith("--"));
const limitAt = args.indexOf("--limit");
const LIMIT = limitAt >= 0 ? Number(args[limitAt + 1]) : 8000;
if (!reportPath || !Number.isFinite(LIMIT)) {
  console.error("usage: node web/scripts/slow-tests.mjs <vitest JSON report> [--limit ms]");
  process.exit(2);
}

const web = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Every test in a report, as [ms, file, full name, status]. */
function testsOf(report) {
  const out = [];
  for (const file of report.testResults ?? []) {
    for (const test of file.assertionResults ?? []) {
      out.push({ ms: test.duration ?? 0, file: file.name, name: test.fullName ?? test.title, status: test.status });
    }
  }
  return out;
}

const seconds = (ms) => `${(ms / 1000).toFixed(1)} s`;
const shown = (file) => relative(web, file).replaceAll("\\", "/");

const all = testsOf(JSON.parse(readFileSync(reportPath, "utf8")));
const ranked = [...all].sort((a, b) => b.ms - a.ms);
console.log(`Slowest web tests in the whole-suite run (limit ${seconds(LIMIT)} alone):`);
for (const t of ranked.slice(0, 5)) console.log(`  ${seconds(t.ms).padStart(7)}  ${shown(t.file)} > ${t.name}`);

const over = all.filter((t) => t.ms > LIMIT);
if (over.length === 0) {
  console.log("No test over the limit.");
  process.exit(0);
}

// Each file with a test over the limit, run again on its own.
const scratch = mkdtempSync(join(tmpdir(), "slow-tests-"));
const stillOver = [];
try {
  for (const file of new Set(over.map((t) => t.file))) {
    const out = join(scratch, "alone.json");
    console.log(`\nOver the limit under load; running ${shown(file)} alone…`);
    const run = spawnSync(
      process.execPath,
      [join(web, "node_modules", "vitest", "vitest.mjs"), "run", shown(file), "--reporter=json", `--outputFile=${out}`],
      { cwd: web, stdio: ["ignore", "ignore", "inherit"] },
    );
    let alone;
    try {
      alone = testsOf(JSON.parse(readFileSync(out, "utf8")));
    } catch {
      console.error(`  could not read the report of the run alone (exit ${run.status})`);
      stillOver.push({ ms: NaN, file, name: "(the file did not run alone)" });
      continue;
    }
    for (const was of over.filter((t) => t.file === file)) {
      const now = alone.find((t) => t.name === was.name);
      const note = now ? `${seconds(was.ms)} under load, ${seconds(now.ms)} alone` : "not found alone";
      console.log(`  ${was.name}: ${note}`);
      if (!now || now.status !== "passed" || now.ms > LIMIT) stillOver.push(now ?? was);
    }
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

if (stillOver.length > 0) {
  console.error(`\n${stillOver.length} web test(s) over ${seconds(LIMIT)} on their own:`);
  for (const t of stillOver) console.error(`  ${Number.isNaN(t.ms) ? "  —" : seconds(t.ms)}  ${shown(t.file)} > ${t.name}`);
  console.error("Make it faster (seed the store rather than drive the screen; split it) — see docs/browser-checks.md.");
  process.exit(1);
}
console.log("\nEvery test over the limit under load is under it alone.");
