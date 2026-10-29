import { spawn, spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";

// scripts/e2e-spar-server.mjs runs on import, so it is driven as a process. It is copied
// into a folder with no web build, so the build step fails at once and only the
// clean-up path is under test.
const SCRIPT = join(__dirname, "..", "scripts", "e2e-spar-server.mjs");
let work = "";
afterEach(() => rmSync(work, { recursive: true, force: true }));

it("cleans up its temp folder even when the --shots folder cannot be made", () => {
  work = mkdtempSync(join(tmpdir(), "spar-e2e-test-"));
  mkdirSync(join(work, "scripts"));
  copyFileSync(SCRIPT, join(work, "scripts", "e2e-spar-server.mjs"));
  const temp = join(work, "tmp");
  mkdirSync(temp);
  const blocker = join(work, "a-file");
  writeFileSync(blocker, "x");

  const run = spawnSync(
    process.execPath,
    [join(work, "scripts", "e2e-spar-server.mjs"), "--shots", join(blocker, "shots")],
    { env: { PATH: process.env.PATH, TMPDIR: temp }, encoding: "utf8", timeout: 60_000 },
  );

  expect(run.stderr).not.toMatch(/at async hostRole/);
  expect(readdirSync(temp)).toEqual([]);
  expect(run.status).toBe(1);
}, 90_000);

async function runWithSignals(port: string) {
  work = mkdtempSync(join(tmpdir(), "spar-e2e-test-"));
  mkdirSync(join(work, "scripts"));
  copyFileSync(SCRIPT, join(work, "scripts", "e2e-spar-server.mjs"));
  // A stand-in build, server and docker, so the script reaches the browser step.
  mkdirSync(join(work, "web/node_modules/vite/bin"), { recursive: true });
  writeFileSync(
    join(work, "web/node_modules/vite/bin/vite.js"),
    `import { mkdirSync, writeFileSync } from "node:fs";
const out = process.argv[process.argv.indexOf("--outDir") + 1];
mkdirSync(out + "/assets", { recursive: true });
writeFileSync(out + "/assets/sparServerBackend-x.js", "");`,
  );
  mkdirSync(join(work, "node_modules/tsx"), { recursive: true });
  writeFileSync(join(work, "node_modules/tsx/package.json"), '{"name":"tsx","main":"index.js"}');
  writeFileSync(join(work, "node_modules/tsx/index.js"), "");
  mkdirSync(join(work, "server/src"), { recursive: true });
  writeFileSync(
    join(work, "server/src/main.ts"),
    `import { createServer } from "node:http";
createServer((q, r) => r.end("ok")).listen(Number(process.env.SPAR_PORT), "127.0.0.1");`,
  );
  const bin = join(work, "bin");
  mkdirSync(bin);
  const dockerPid = join(work, "docker.pid");
  writeFileSync(
    join(bin, "docker"),
    `#!/bin/sh
if [ "$1" = "run" ]; then
  echo $$ > "${dockerPid}"
  trap 'exit 130' INT
  while :; do sleep 0.1; done
fi
if [ "$1" = "rm" ]; then sleep 1; fi
exit 0
`,
    { mode: 0o755 },
  );
  const temp = join(work, "tmp");
  mkdirSync(temp);

  const child = spawn(process.execPath, [join(work, "scripts", "e2e-spar-server.mjs"), "--port", port], {
    env: { PATH: `${bin}:${process.env.PATH}`, TMPDIR: temp, HOME: work },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const exited = new Promise<number | null>((done) => child.once("exit", done));
  for (let i = 0; i < 100 && !existsSync(dockerPid); i++) await new Promise((r) => setTimeout(r, 100));
  expect(existsSync(dockerPid)).toBe(true);
  return { child, exited, dockerPid, temp };
}

it("finishes the clean-up before it exits when Ctrl-C reaches the script and the container together", async () => {
  const { child, exited, dockerPid, temp } = await runWithSignals("18893");
  // The terminal sends Ctrl-C to both.
  child.kill("SIGINT");
  process.kill(Number(readFileSync(dockerPid, "utf8")), "SIGINT");
  await exited;

  expect(readdirSync(temp)).toEqual([]);
}, 60_000);

it("finishes the clean-up before it exits when Ctrl-C is pressed twice", async () => {
  const { child, exited, temp } = await runWithSignals("18894");
  child.kill("SIGINT");
  await new Promise((r) => setTimeout(r, 300));
  child.kill("SIGINT");
  await exited;

  expect(readdirSync(temp)).toEqual([]);
}, 60_000);

it("removes its temp folder after a passing run even when the container made the downloads folder", () => {
  work = mkdtempSync(join(tmpdir(), "spar-e2e-test-"));
  mkdirSync(join(work, "scripts"));
  copyFileSync(SCRIPT, join(work, "scripts", "e2e-spar-server.mjs"));
  mkdirSync(join(work, "web/node_modules/vite/bin"), { recursive: true });
  writeFileSync(
    join(work, "web/node_modules/vite/bin/vite.js"),
    `import { mkdirSync, writeFileSync } from "node:fs";
const out = process.argv[process.argv.indexOf("--outDir") + 1];
mkdirSync(out + "/assets", { recursive: true });
writeFileSync(out + "/assets/sparServerBackend-x.js", "");`,
  );
  mkdirSync(join(work, "node_modules/tsx"), { recursive: true });
  writeFileSync(join(work, "node_modules/tsx/package.json"), '{"name":"tsx","main":"index.js"}');
  writeFileSync(join(work, "node_modules/tsx/index.js"), "");
  mkdirSync(join(work, "server/src"), { recursive: true });
  writeFileSync(
    join(work, "server/src/main.ts"),
    `import { createServer } from "node:http";
createServer((q, r) => r.end("ok")).listen(Number(process.env.SPAR_PORT), "127.0.0.1");`,
  );
  const bin = join(work, "bin");
  mkdirSync(bin);
  // A stand-in container: it writes the zip into out/downloads. A folder it has to make
  // itself is closed to other users (a different uid, as the chrome user is), as mkdir does.
  writeFileSync(
    join(bin, "docker"),
    `#!/bin/sh
if [ "$1" = "run" ]; then
  for a in "$@"; do case "$a" in */out:*) out="\${a%%:*}";; esac; done
  if [ -d "$out/downloads" ]; then
    printf PK > "$out/downloads/spar.zip"
  else
    mkdir "$out/downloads" && printf PK > "$out/downloads/spar.zip" && chmod 555 "$out/downloads"
  fi
fi
exit 0
`,
    { mode: 0o755 },
  );
  const temp = join(work, "tmp");
  mkdirSync(temp);

  const run = spawnSync(process.execPath, [join(work, "scripts", "e2e-spar-server.mjs"), "--port", "18895"], {
    env: { PATH: `${bin}:${process.env.PATH}`, TMPDIR: temp, HOME: work },
    encoding: "utf8",
    timeout: 60_000,
  });
  for (const left of readdirSync(temp)) {
    const downloads = join(temp, left, "out", "downloads");
    if (existsSync(downloads)) chmodSync(downloads, 0o755);
  }

  expect(run.stderr).not.toMatch(/EACCES/);
  expect(readdirSync(temp)).toEqual([]);
  expect(run.status).toBe(0);
}, 90_000);
