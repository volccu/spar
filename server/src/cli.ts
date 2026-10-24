/**
 * The admin command line. It opens the same `spar.db` the server uses (SQLite
 * in WAL mode allows both at once), so it works on a running instance:
 *
 *   node server/dist/cli.js users
 *   node server/dist/cli.js create-user <email> [--admin]
 *   node server/dist/cli.js reset-password <email>
 *   node server/dist/cli.js invite [--days N]
 *   node server/dist/cli.js invites
 *   node server/dist/cli.js delete-user <email>
 *
 * A password is read from standard input when one is piped in (one line), and
 * otherwise generated and printed once. Settings come from the same
 * environment as the server's (`SPAR_DATA_DIR` above all).
 */
import { randomBytes } from "node:crypto";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { Accounts } from "./auth";
import { configFromEnv } from "./config";
import { openDb } from "./db";
import { ensureDataDir, sessionSecret } from "./keys";
import { createClock, formatInstant } from "./time";

const USAGE = `usage: cli.js <command>

  users                          list every account
  create-user <email> [--admin]  make an account (password from stdin, or generated)
  reset-password <email>         set a new password (from stdin, or generated) and sign out everywhere
  invite [--days N]              print a single-use invite code (default 7 days)
  invites                        list invite codes (their state, never the codes)
  delete-user <email>            remove an account and everything it owns`;

async function passwordFromStdin(): Promise<string | null> {
  if (process.stdin.isTTY) return null;
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin as AsyncIterable<Buffer>) chunks.push(chunk);
  const line = Buffer.concat(chunks).toString("utf8").split(/\r?\n/)[0] ?? "";
  return line.length > 0 ? line : null;
}

function generatedPassword(): string {
  return randomBytes(15).toString("base64url");
}

async function run(argv: string[]): Promise<number> {
  const [command, ...args] = argv;
  if (!command || command === "help" || command === "--help") {
    console.log(USAGE);
    return command ? 0 : 1;
  }
  const config = configFromEnv();
  if (config.backend !== "spar-server") {
    console.error(`SPAR_BACKEND is ${config.backend}: this instance keeps no accounts of its own, so there is nothing to manage here.`);
    return 1;
  }
  ensureDataDir(config.dataDir);
  const db = openDb(join(config.dataDir, "spar.db"));
  const clock = createClock();
  const accounts = new Accounts(db, sessionSecret(config.dataDir), clock, config.scryptLogN);
  try {
    switch (command) {
      case "users": {
        const users = accounts.list();
        if (users.length === 0) console.log("(no accounts)");
        for (const u of users) {
          const notes = (db.prepare("select count(*) as n from notes where owner_id = ?").get(u.id) as { n: number }).n;
          console.log(`${u.email}\t${u.id}\t${u.is_admin ? "admin" : "user"}\t${notes} notes\tsince ${formatInstant(u.created_at)}`);
        }
        return 0;
      }
      case "create-user": {
        const email = args.find((a) => !a.startsWith("--"));
        if (!email) throw new Error("create-user needs an email");
        const given = await passwordFromStdin();
        const password = given ?? generatedPassword();
        const user = await accounts.signUp(email, password, { mode: "open", bypass: true });
        if (args.includes("--admin")) db.prepare("update users set is_admin = 1 where id = ?").run(user.id);
        console.log(`created ${user.email} (${user.id})${args.includes("--admin") || user.is_admin ? ", admin" : ""}`);
        if (!given) console.log(`password: ${password}`);
        return 0;
      }
      case "reset-password": {
        const user = args[0] ? accounts.byEmail(args[0].trim().toLowerCase()) : null;
        if (!user) throw new Error("no account with that email");
        const given = await passwordFromStdin();
        const password = given ?? generatedPassword();
        await accounts.setPassword(user.id, password);
        accounts.endSessionsOf(user.id);
        console.log(`password reset for ${user.email}; every session of theirs is signed out`);
        if (!given) console.log(`password: ${password}`);
        return 0;
      }
      case "invite": {
        const at = args.indexOf("--days");
        const days = at >= 0 ? Number(args[at + 1]) : 7;
        if (!Number.isFinite(days) || days < 1) throw new Error("--days must be a number of at least 1");
        const invite = accounts.createInvite(days);
        console.log(invite.code);
        console.error(`valid until ${formatInstant(invite.expires_at)}${config.signup !== "invite" ? ` (note: SPAR_SIGNUP is ${config.signup})` : ""}`);
        return 0;
      }
      case "invites": {
        const invites = accounts.listInvites();
        if (invites.length === 0) console.log("(no invites)");
        const now = clock();
        for (const i of invites) {
          const state = i.used_at ? `used ${formatInstant(i.used_at)}` : i.expires_at <= now ? "expired" : "open";
          console.log(`made ${formatInstant(i.created_at)}\tuntil ${formatInstant(i.expires_at)}\t${state}`);
        }
        return 0;
      }
      case "delete-user": {
        const user = args[0] ? accounts.byEmail(args[0].trim().toLowerCase()) : null;
        if (!user) throw new Error("no account with that email");
        db.prepare("delete from users where id = ?").run(user.id);
        rmSync(join(config.dataDir, "files", user.id), { recursive: true, force: true });
        console.log(`deleted ${user.email} and everything it owned`);
        return 0;
      }
      default:
        console.error(USAGE);
        return 1;
    }
  } finally {
    db.close();
  }
}

run(process.argv.slice(2))
  .then((code) => process.exit(code))
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
