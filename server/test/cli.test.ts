/**
 * The admin command line, run as a person would run it, against the data
 * folder of a live server.
 */
import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { Client, startServer, type Running } from "./helpers";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
// tsx's own entry, run by this same node: `node_modules/.bin/tsx` is a shell
// script on Windows (`tsx.cmd`), which execFile cannot start (audit CODE-7).
const TSX = join(ROOT, "node_modules", "tsx", "dist", "cli.mjs");
const CLI = join(ROOT, "server", "src", "cli.ts");

function cli(dataDir: string, args: string[], input?: string): string {
  return execFileSync(process.execPath, [TSX, CLI, ...args], {
    encoding: "utf8",
    input: input ?? "",
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, SPAR_DATA_DIR: dataDir, SPAR_SCRYPT_LOG_N: "10", SPAR_SIGNUP: "invite" },
  });
}

describe("the admin command line", () => {
  let s: Running;
  afterEach(async () => s?.close());

  it("makes accounts, lists them, issues invites and resets passwords on a running instance", async () => {
    s = await startServer({ signup: "invite" });
    expect(cli(s.dataDir, ["create-user", "Admin@Example.test"], "first password here\n")).toMatch(/created admin@example\.test .*admin/);
    const generated = cli(s.dataDir, ["create-user", "second@example.test"]).match(/password: (\S+)/)?.[1];
    expect(generated).toBeTruthy();
    expect((await new Client(s.url).logIn("second@example.test", generated!)).status).toBe(200);

    const listing = cli(s.dataDir, ["users"]);
    expect(listing).toContain("admin@example.test");
    expect(listing).toContain("second@example.test");

    const code = cli(s.dataDir, ["invite", "--days", "2"]).trim();
    expect((await new Client(s.url).signUp(undefined, undefined, code)).status).toBe(201);
    expect(cli(s.dataDir, ["invites"])).toMatch(/used /);

    const signedIn = new Client(s.url);
    await signedIn.logIn("admin@example.test", "first password here");
    cli(s.dataDir, ["reset-password", "admin@example.test"], "the new password\n");
    expect((await signedIn.request("GET", "/api/notes")).status).toBe(401);
    expect((await new Client(s.url).logIn("admin@example.test", "the new password")).status).toBe(200);

    cli(s.dataDir, ["delete-user", "second@example.test"]);
    expect(cli(s.dataDir, ["users"])).not.toContain("second@example.test");
  }, 60_000);
});
