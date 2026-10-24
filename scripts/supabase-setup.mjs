#!/usr/bin/env node
// Sets up a Supabase project of your own for spår: the "bring your own
// Supabase" path in docs/self-hosting.md.
//
//   npm run supabase:setup -- --project-ref <ref> --origin https://notes.example.com \
//                             --vapid-subject mailto:you@example.com
//
// Steps, in order (each is safe to run again, and `--from-step` resumes at one):
//
//   link       check the CLI is logged in, and link this checkout to the project
//   migrate    `npm run db:push`: every migration, then the proof they landed
//   vapid      a Web Push key pair, set as the functions' secrets — only when the
//              project has none, because a new pair silences every device that
//              already allowed notifications
//   secrets    VAPID_SUBJECT and ALLOWED_ORIGINS
//   cron       a fresh CRON_SECRET for send-reminders, and the two Vault secrets
//              the reminder sweep (migration 0015) reads: its URL and that token
//   functions  deploy link-preview and send-reminders
//   finish     print what is left to do in the dashboard, and the app's settings
//
// Before anything writes, it asks the project how many spår notes it holds and
// refuses to go on if the answer is not zero, unless `--yes-existing-project`.
// That protects a project already in use — the author's own included — from
// being set up a second time by accident.
//
// Secrets never appear in a command line, a log line or the terminal: function
// secrets go through `supabase secrets set --env-file` and Vault secrets through
// `supabase db query --file`, both from a file readable by its owner only that
// is deleted straight after. The private key is never printed.
//
// `--dry-run` prints the plan and runs nothing. `--local` rehearses the database
// steps (the notes check, the migration proof, the Vault secrets) against the
// local stack (`supabase start`) and skips everything that only a hosted project
// has: linking, function secrets and deploys.

import { spawnSync } from "node:child_process";
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export const STEPS = ["link", "migrate", "vapid", "secrets", "cron", "functions", "finish"];

/** The two functions this app ships. `send-reminders` has `verify_jwt = false`
 *  in supabase/config.toml, which the deploy reads. */
export const FUNCTIONS = ["link-preview", "send-reminders"];

/** The Vault names migration 0015's cron job reads. They must not change. */
export const VAULT_URL = "reminder_fn_url";
export const VAULT_KEY = "reminder_fn_key";

const USAGE = `Set up your own Supabase project for spår.

  npm run supabase:setup -- [options]

Options
  --project-ref <ref>        the project's reference id (Dashboard -> Project Settings)
  --origin <url[,url…]>      where the app is served from, e.g. https://notes.example.com
  --vapid-subject <mailto:…> the contact address push services see
  --from-step <step>         start at this step: ${STEPS.join(", ")}
  --dry-run                  print what would run, run nothing
  --yes-existing-project     go on although the project already holds spår notes
  --rotate-vapid             make a new Web Push key pair even if one is set
                             (every device must then allow notifications again)
  --local                    rehearse the database steps against the local stack
  --functions-url <url>      with --local: the send-reminders URL the database uses
  --help

Needs \`npx supabase login\` first. Missing values are asked for when the
terminal is interactive.`;

// ---------------------------------------------------------------------------
// Arguments and values
// ---------------------------------------------------------------------------

export function parseArgs(argv) {
  const opts = {
    projectRef: null,
    origins: null,
    vapidSubject: null,
    fromStep: STEPS[0],
    dryRun: false,
    yesExisting: false,
    rotateVapid: false,
    local: false,
    functionsUrl: null,
    help: false,
  };
  const valued = {
    "--project-ref": "projectRef",
    "--origin": "origins",
    "--origins": "origins",
    "--vapid-subject": "vapidSubject",
    "--from-step": "fromStep",
    "--functions-url": "functionsUrl",
  };
  const flags = {
    "--dry-run": "dryRun",
    "--yes-existing-project": "yesExisting",
    "--rotate-vapid": "rotateVapid",
    "--local": "local",
    "--help": "help",
    "-h": "help",
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const eq = arg.indexOf("=");
    const name = arg.startsWith("--") && eq > 0 ? arg.slice(0, eq) : arg;
    if (name in valued) {
      const value = eq > 0 && name !== arg ? arg.slice(eq + 1) : argv[++i];
      if (value === undefined || value.startsWith("--")) throw new Error(`${name} needs a value`);
      opts[valued[name]] = value;
    } else if (arg in flags) {
      opts[flags[arg]] = true;
    } else {
      throw new Error(`unknown option ${arg} (see --help)`);
    }
  }
  if (!STEPS.includes(opts.fromStep)) {
    throw new Error(`--from-step must be one of ${STEPS.join(", ")}`);
  }
  if (opts.projectRef !== null) opts.projectRef = checkRef(opts.projectRef);
  if (opts.origins !== null) opts.origins = normalizeOrigins(opts.origins);
  if (opts.vapidSubject !== null) opts.vapidSubject = checkSubject(opts.vapidSubject);
  if (opts.functionsUrl !== null) opts.functionsUrl = checkHttpUrl(opts.functionsUrl, "--functions-url");
  return opts;
}

/** A hosted project's reference: twenty lowercase letters. */
export function checkRef(raw) {
  const ref = String(raw).trim();
  if (!/^[a-z0-9]{20}$/.test(ref)) {
    throw new Error(
      `"${ref}" is not a project reference — it is the 20 letters in https://<ref>.supabase.co`,
    );
  }
  return ref;
}

/** `https://a.example, http://localhost:5173/` -> ["https://a.example", "http://localhost:5173"]. */
export function normalizeOrigins(raw) {
  const origins = [];
  for (const part of String(raw).split(",")) {
    const text = part.trim();
    if (!text) continue;
    let url;
    try {
      url = new URL(text);
    } catch {
      throw new Error(`"${text}" is not a URL; give the address the app is opened at`);
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      throw new Error(`"${text}" must start with https:// (or http:// for a local address)`);
    }
    if (url.pathname !== "/" || url.search || url.hash) {
      throw new Error(`"${text}" has a path; the app must be served from the root of an origin`);
    }
    if (!origins.includes(url.origin)) origins.push(url.origin);
  }
  if (origins.length === 0) throw new Error("give at least one origin");
  return origins;
}

export function checkSubject(raw) {
  const subject = String(raw).trim();
  if (!/^mailto:[^\s@]+@[^\s@]+$/.test(subject) && !/^https:\/\/\S+$/.test(subject)) {
    throw new Error(`"${subject}" must be mailto:you@example.com or an https:// URL`);
  }
  return subject;
}

function checkHttpUrl(raw, what) {
  const text = String(raw).trim();
  let url;
  try {
    url = new URL(text);
  } catch {
    throw new Error(`${what}: "${text}" is not a URL`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error(`${what}: "${text}" is not an http(s) URL`);
  }
  return url.href;
}

export function projectUrl(ref) {
  return `https://${ref}.supabase.co`;
}

export function functionsUrl(ref) {
  return `${projectUrl(ref)}/functions/v1/send-reminders`;
}

// ---------------------------------------------------------------------------
// Secrets
// ---------------------------------------------------------------------------

/**
 * A Web Push (VAPID) key pair in the form `supabase/functions/_shared/webpush.ts`
 * reads: the public key as the 65-byte uncompressed P-256 point, the private
 * key as the 32-byte scalar, both base64url without padding.
 */
export function generateVapidKeys() {
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const jwk = privateKey.export({ format: "jwk" });
  const point = Buffer.concat([
    Buffer.from([4]),
    Buffer.from(jwk.x, "base64url"),
    Buffer.from(jwk.y, "base64url"),
  ]);
  return { publicKey: point.toString("base64url"), privateKey: jwk.d };
}

/** The token pg_cron presents to send-reminders as `x-cron-secret`. */
export function generateCronSecret() {
  return randomBytes(32).toString("base64url");
}

/** `NAME=value` lines for `supabase secrets set --env-file`. */
export function envFileText(values) {
  return (
    Object.entries(values)
      .map(([name, value]) => {
        if (!/^[A-Z][A-Z0-9_]*$/.test(name)) throw new Error(`bad secret name ${name}`);
        const text = String(value);
        if (/[\r\n]/.test(text)) throw new Error(`${name} must be one line`);
        return `${name}=${text}`;
      })
      .join("\n") + "\n"
  );
}

/** A SQL string literal. */
export function sqlString(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

/**
 * One statement — `supabase db query` refuses more than one per file — that
 * creates the Vault secret `name`, or replaces its value when it is there.
 * `vault.create_secret` alone fails the second time, and this step must be
 * safe to run again.
 */
export function vaultUpsertSql(name, value) {
  return `do $spar$
declare
  existing uuid;
begin
  select id into existing from vault.secrets where name = ${sqlString(name)};
  if existing is null then
    perform vault.create_secret(${sqlString(value)}, ${sqlString(name)});
  else
    perform vault.update_secret(existing, ${sqlString(value)});
  end if;
end
$spar$;
`;
}

/**
 * How many spår notes the project holds: -1 when it has no `notes` table yet
 * (a new project). The count runs through `query_to_xml` so that the one
 * statement still parses on a project without the table. The planner's own
 * estimate stands beside it, so a role that row level security would hide the
 * rows from still sees a used project as used.
 */
export const NOTES_CHECK_SQL = `select case
  when to_regclass('public.notes') is null then -1
  else greatest(
    (xpath('/row/n/text()', query_to_xml('select count(*) as n from public.notes', false, true, '')))[1]::text::bigint,
    coalesce((select n_live_tup from pg_stat_user_tables where schemaname = 'public' and relname = 'notes'), 0)
  )
end as notes;
`;

/** What the cron step leaves behind, read back without reading a secret. */
export const CRON_CHECK_SQL = `select
  (select count(*) from vault.secrets where name in (${sqlString(VAULT_URL)}, ${sqlString(VAULT_KEY)})) as vault_secrets,
  (select count(*) from cron.job where jobname = 'send-reminders') as cron_jobs;
`;

/** Remove every secret value from a piece of output before it is shown. */
export function redact(text, secrets) {
  let out = String(text ?? "");
  for (const secret of secrets) {
    if (secret && secret.length >= 8) out = out.split(secret).join("[redacted]");
  }
  return out;
}

// ---------------------------------------------------------------------------
// Reading the CLI's answers
// ---------------------------------------------------------------------------

/** The rows of a `supabase db query` answer, which wraps its JSON in chatter. */
export function parseQueryRows(text) {
  const start = text.indexOf("{");
  if (start === -1) throw new Error("supabase db query returned no JSON");
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (ch === "\\") i++;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) {
      const parsed = JSON.parse(text.slice(start, i + 1));
      if (!Array.isArray(parsed.rows)) throw new Error("supabase db query returned no rows");
      return parsed.rows;
    }
  }
  throw new Error("supabase db query output was cut short");
}

/** The names `supabase secrets list` reports, from its JSON or its table. */
export function secretNames(text) {
  const raw = String(text ?? "");
  const start = raw.indexOf("[");
  if (start !== -1) {
    try {
      const list = JSON.parse(raw.slice(start, raw.lastIndexOf("]") + 1));
      if (Array.isArray(list)) {
        return new Set(list.map((s) => s?.name ?? s?.Name).filter((n) => typeof n === "string"));
      }
    } catch {
      // Not JSON after all; read it as the table.
    }
  }
  const names = new Set();
  for (const line of raw.split("\n")) {
    const m = /^\s*\|?\s*([A-Z][A-Z0-9_]*)\s*\|/.exec(line);
    if (m && m[1] !== "NAME") names.add(m[1]);
  }
  return names;
}

/**
 * The key a browser may hold, from `supabase projects api-keys -o json`: the
 * publishable key where the project has one, the legacy anon key otherwise.
 * Never a secret or service-role key — those are dropped unread.
 */
export function publishableKey(text) {
  const raw = String(text ?? "");
  const start = raw.indexOf("[");
  if (start === -1) return null;
  let list;
  try {
    list = JSON.parse(raw.slice(start, raw.lastIndexOf("]") + 1));
  } catch {
    return null;
  }
  if (!Array.isArray(list)) return null;
  const key = (entry) => entry?.api_key ?? entry?.apiKey ?? null;
  const publishable = list.find((e) => e?.type === "publishable" && key(e));
  if (publishable) return key(publishable);
  const anon = list.find((e) => e?.name === "anon" && (e?.type ?? "legacy") === "legacy" && key(e));
  return anon ? key(anon) : null;
}

// ---------------------------------------------------------------------------
// The steps
// ---------------------------------------------------------------------------

class SetupError extends Error {}

/**
 * The setup, with everything it touches passed in so the tests can hand it a
 * scripted runner: `run({ tool, args, capture })` runs `supabase` or `npm` and
 * answers `{ status, stdout, stderr }`; `ask(question)` answers a prompt, or is
 * null when nobody can be asked; `log` prints; `root` is the repository.
 */
export function createSetup({ run, ask = null, log = console.log, root = ROOT, readLinked = null }) {
  const secretsShown = [];

  const linkedRef =
    readLinked ??
    (() => {
      const file = join(root, "supabase", ".temp", "project-ref");
      return existsSync(file) ? readFileSync(file, "utf8").trim() : null;
    });

  function show(tool, args) {
    return `${tool} ${args.map((a) => (/\s/.test(a) ? JSON.stringify(a) : a)).join(" ")}`;
  }

  /** Run a command, or in a dry run only say it. Output that is captured is
   *  never printed unless the command fails, and then only redacted. */
  function exec(ctx, tool, args, { capture = false, what } = {}) {
    const full = tool === "supabase" ? [...args, "--workdir", root] : args;
    if (ctx.dryRun) {
      log(`  would run: ${show(tool, full)}${what ? `\n             (${what})` : ""}`);
      return { status: 0, stdout: "", stderr: "" };
    }
    const result = run({ tool, args: full, capture });
    if (result.status !== 0) {
      const detail = capture ? redact(`${result.stderr || ""}${result.stdout || ""}`, secretsShown).trim() : "";
      throw new SetupError(
        `${what ?? show(tool, args)} failed (exit ${result.status})${detail ? `\n${detail}` : ""}`,
      );
    }
    return result;
  }

  /** Write `content` to a file only its owner can read, hand the path to `use`,
   *  and delete it whatever happens. */
  function withSecretFile(ctx, name, content, use) {
    if (ctx.dryRun) return use(`<temporary ${name}, mode 0600>`);
    const dir = mkdtempSync(join(tmpdir(), "spar-setup-"));
    const file = join(dir, name);
    try {
      writeFileSync(file, content, { encoding: "utf8", mode: 0o600 });
      return use(file);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  function setSecrets(ctx, values) {
    for (const value of Object.values(values)) secretsShown.push(String(value));
    withSecretFile(ctx, "secrets.env", envFileText(values), (file) =>
      exec(ctx, "supabase", ["secrets", "set", "--env-file", file, "--project-ref", ctx.ref], {
        capture: true,
        what: `setting the function secrets ${Object.keys(values).join(", ")}`,
      }),
    );
  }

  function dbTarget(ctx) {
    return ctx.local ? ["--local"] : ["--linked"];
  }

  /** One statement from a file. `rows: false` for a statement that answers
   *  none (a `do` block prints only "DO"). */
  function query(ctx, sql, what, { rows = true } = {}) {
    return withSecretFile(ctx, "query.sql", sql, (file) => {
      const result = exec(ctx, "supabase", ["db", "query", ...dbTarget(ctx), "--file", file], {
        capture: true,
        what,
      });
      if (ctx.dryRun || !rows) return null;
      try {
        return parseQueryRows(`${result.stdout}${result.stderr}`);
      } catch (error) {
        throw new SetupError(`${what}: ${error.message}`);
      }
    });
  }

  async function value(ctx, key, question, check) {
    if (ctx[key] !== null && ctx[key] !== undefined) return ctx[key];
    if (ctx.dryRun && !ask) return null;
    if (!ask) {
      throw new SetupError(`missing ${question.flag}; run with ${question.flag} <value> (see --help)`);
    }
    for (;;) {
      const answer = await ask(`${question.text} `);
      try {
        ctx[key] = check(answer);
        return ctx[key];
      } catch (error) {
        log(`  ${error.message}`);
      }
    }
  }

  const needRef = (ctx) =>
    value(ctx, "ref", { flag: "--project-ref", text: "Project reference (the 20 letters in https://<ref>.supabase.co):" }, checkRef);
  const needOrigins = (ctx) =>
    value(ctx, "origins", { flag: "--origin", text: "Where will the app be opened? (https://notes.example.com, comma-separated for several):" }, normalizeOrigins);
  const needSubject = (ctx) =>
    value(ctx, "vapidSubject", { flag: "--vapid-subject", text: "Contact address for push services (mailto:you@example.com):" }, checkSubject);

  /** The linked project must be the one named, or `--linked` means another. */
  function assertLinked(ctx) {
    if (ctx.local || ctx.dryRun) return;
    const linked = linkedRef();
    if (linked !== ctx.ref) {
      throw new SetupError(
        linked
          ? `this checkout is linked to ${linked}, not ${ctx.ref}; run the link step first (--from-step link)`
          : `this checkout is not linked to a project; run the link step first (--from-step link)`,
      );
    }
  }

  const steps = {
    async link(ctx) {
      if (ctx.local) {
        log("  local stack: nothing to link");
        return;
      }
      await needRef(ctx);
      // Asks the API for nothing but the account's own project list, so a
      // missing login is found before anything else is tried.
      if (!ctx.dryRun) {
        const who = run({ tool: "supabase", args: ["projects", "list", "-o", "json", "--workdir", root], capture: true });
        if (who.status !== 0) {
          throw new SetupError(
            "the Supabase CLI is not logged in (or cannot reach the API).\n" +
              "  Run `npx supabase login` once — it opens the browser and stores a token in\n" +
              "  ~/.supabase — then run this again. Never paste the token into a command.",
          );
        }
      } else {
        log("  would check: supabase projects list (is the CLI logged in?)");
      }
      if (!ctx.dryRun && linkedRef() === ctx.ref) {
        log(`  already linked to ${ctx.ref}`);
        return;
      }
      // Interactive: it may ask for the database password, which the terminal
      // takes directly and this script never sees.
      exec(ctx, "supabase", ["link", "--project-ref", ctx.ref]);
    },

    async migrate(ctx) {
      if (ctx.local) {
        // A local stack applies every migration as it starts; what is left is
        // the proof that they landed.
        exec(ctx, "npm", ["run", "db:verify:local"]);
        return;
      }
      // Never a bare `supabase db push`: docs/DATABASE-MIGRATIONS.md.
      exec(ctx, "npm", ["run", "db:push"]);
    },

    async vapid(ctx) {
      if (ctx.local) {
        log("  local stack: function secrets are hosted-only; skipped");
        return;
      }
      if (!ctx.dryRun) {
        const listed = exec(ctx, "supabase", ["secrets", "list", "--project-ref", ctx.ref, "-o", "json"], {
          capture: true,
        });
        const names = secretNames(listed.stdout);
        if (names.has("VAPID_PUBLIC_KEY") && names.has("VAPID_PRIVATE_KEY") && !ctx.rotateVapid) {
          ctx.vapidKept = true;
          log(
            "  the project already has a Web Push key pair; kept. A new one would stop\n" +
              "  every device that allowed notifications from ringing (--rotate-vapid makes one anyway).",
          );
          return;
        }
      } else {
        log("  would check: supabase secrets list (is a key pair set already?)");
      }
      const keys = ctx.dryRun ? { publicKey: "<generated>", privateKey: "<generated>" } : generateVapidKeys();
      setSecrets(ctx, { VAPID_PUBLIC_KEY: keys.publicKey, VAPID_PRIVATE_KEY: keys.privateKey });
      ctx.vapidPublicKey = keys.publicKey;
      if (!ctx.dryRun) log("  a new Web Push key pair is set (the private half only on Supabase)");
    },

    async secrets(ctx) {
      if (ctx.local) {
        log("  local stack: function secrets are hosted-only; skipped");
        return;
      }
      const origins = await needOrigins(ctx);
      const subject = await needSubject(ctx);
      setSecrets(ctx, {
        VAPID_SUBJECT: subject ?? "<asked>",
        ALLOWED_ORIGINS: origins ? origins.join(",") : "<asked>",
      });
    },

    async cron(ctx) {
      // One token, written to both ends in the same step, so they always
      // agree: a resumed run makes a new one rather than needing the old.
      const token = ctx.dryRun ? "<generated>" : generateCronSecret();
      secretsShown.push(token);
      if (!ctx.local) setSecrets(ctx, { CRON_SECRET: token });
      const url = ctx.local
        ? (ctx.functionsUrl ?? "http://kong:8000/functions/v1/send-reminders")
        : functionsUrl(ctx.ref);
      query(ctx, vaultUpsertSql(VAULT_URL, url), `storing the Vault secret ${VAULT_URL}`, { rows: false });
      query(ctx, vaultUpsertSql(VAULT_KEY, token), `storing the Vault secret ${VAULT_KEY}`, { rows: false });
      const rows = query(ctx, CRON_CHECK_SQL, "reading back the reminder sweep");
      if (rows) {
        const row = rows[0] ?? {};
        if (Number(row.vault_secrets) !== 2 || Number(row.cron_jobs) !== 1) {
          throw new SetupError(
            `the reminder sweep is not complete: ${row.vault_secrets} of 2 Vault secrets, ` +
              `${row.cron_jobs} of 1 cron job (migration 0015 schedules it; did the migrate step run?)`,
          );
        }
        log("  the reminder sweep has its URL and token, and runs every minute");
      }
    },

    async functions(ctx) {
      if (ctx.local) {
        log("  local stack: the local functions are served by `supabase start`; skipped");
        return;
      }
      for (const name of FUNCTIONS) {
        // --use-api bundles on Supabase's side, so no Docker is needed here.
        exec(ctx, "supabase", ["functions", "deploy", name, "--project-ref", ctx.ref, "--use-api"]);
      }
    },

    async finish(ctx) {
      if (ctx.local) {
        log("  local stack: nothing to hand to an app");
        return;
      }
      let key = null;
      if (!ctx.dryRun) {
        const keys = run({
          tool: "supabase",
          args: ["projects", "api-keys", "--project-ref", ctx.ref, "-o", "json", "--workdir", root],
          capture: true,
        });
        if (keys.status === 0) key = publishableKey(keys.stdout);
      }
      log(finishText(ctx, key));
    },
  };

  async function runSetup(opts) {
    const ctx = {
      ref: opts.projectRef ?? null,
      origins: opts.origins ?? null,
      vapidSubject: opts.vapidSubject ?? null,
      dryRun: Boolean(opts.dryRun),
      local: Boolean(opts.local),
      yesExisting: Boolean(opts.yesExisting),
      rotateVapid: Boolean(opts.rotateVapid),
      functionsUrl: opts.functionsUrl ?? null,
      vapidPublicKey: null,
      vapidKept: false,
    };
    const from = STEPS.indexOf(opts.fromStep ?? STEPS[0]);
    if (ctx.dryRun) log("Dry run: nothing below is executed.\n");
    if (ctx.local) log("Local stack: hosted-only steps are skipped.\n");

    if (!ctx.local) {
      await needRef(ctx);
      if (ctx.dryRun && !ctx.ref) ctx.ref = "<ref>";
    }
    for (const [index, name] of STEPS.entries()) {
      if (index < from) continue;
      log(`\n[${index + 1}/${STEPS.length}] ${name}`);
      if (name !== "link") {
        assertLinked(ctx);
        if (!ctx.checked) await guard(ctx);
      }
      await steps[name](ctx);
    }
    return ctx;
  }

  /** Refuses a project that already holds notes, before anything is written. */
  async function guard(ctx) {
    ctx.checked = true;
    const rows = query(ctx, NOTES_CHECK_SQL, "counting the project's notes");
    if (!rows) {
      log("  would check: the project holds no spår notes yet");
      return;
    }
    const notes = Number(rows[0]?.notes ?? -1);
    if (notes > 0 && !ctx.yesExisting) {
      throw new SetupError(
        `this project already holds ${notes} spår ${notes === 1 ? "note" : "notes"}. Setting it up again would give it a\n` +
          "  new cron token and could re-key Web Push, which silences every device that allowed\n" +
          "  notifications. If that is really what you want, run again with --yes-existing-project.",
      );
    }
    log(notes < 0 ? "  a new project: no spår tables yet" : `  ${notes} ${notes === 1 ? "note" : "notes"}; going on`);
  }

  return { runSetup, steps };
}

export function finishText(ctx, key) {
  const ref = ctx.ref ?? "<ref>";
  const url = projectUrl(ref);
  const origins = ctx.origins ?? ["https://notes.example.com"];
  const shownKey = key ?? "<the publishable key: Dashboard -> Project Settings -> API Keys>";
  const vapid = ctx.vapidPublicKey
    ? ctx.vapidPublicKey
    : ctx.vapidKept
      ? "<the public key you configured when the pair was made; it is not stored anywhere readable>"
      : "<printed by the vapid step>";
  return `
Done with the command line. What is left is in the dashboard
(https://supabase.com/dashboard/project/${ref}):

  1. Authentication -> URL Configuration
       Site URL:       ${origins[0]}
       Redirect URLs:  ${origins.join(", ")}
     The sign-in link brings the reader back to the address the app was opened at,
     and Supabase refuses to send anyone to an address not on this list.
  2. Authentication -> Emails -> SMTP Settings
     Supabase's own mailer sends only to your organisation's members, a few an hour.
     Anyone else signing in needs an SMTP server of yours here.
  3. Accounts. Sign-in never makes an account unless the app is told sign-up is open.
     Just you: Authentication -> Users -> Add user (or invite), with your email.
     Other people too: Authentication -> Sign In / Providers -> Email -> allow new
     users to sign up, and give the app signup "open" (below).
  4. Authentication -> Emails -> Templates -> Magic Link
     Put the code in the email beside the link: {{ .Token }} (supabase/templates/
     magic_link.html is one to paste). An iPhone app on the Home Screen cannot be
     signed in by the link, which opens Safari; it is signed in by typing the code.

The app's settings — these are all public by nature:

  Docker image (read at startup):
    SPAR_BACKEND=supabase
    SPAR_SUPABASE_URL=${url}
    SPAR_SUPABASE_KEY=${shownKey}
    SPAR_VAPID_PUBLIC_KEY=${vapid}
    SPAR_SIGNUP=open            # only if you allowed sign-up in step 3

  Or a static build (web/.env, then npm run build:web):
    VITE_SUPABASE_URL=${url}
    VITE_SUPABASE_ANON_KEY=${shownKey}
    VITE_VAPID_PUBLIC_KEY=${vapid}
  A static build never offers sign-up; for that, build with VITE_RUNTIME_CONFIG=1 and
  serve a /config.json beside it (docs/self-hosting.md).
`;
}

// ---------------------------------------------------------------------------
// Running it for real
// ---------------------------------------------------------------------------

function realRun({ tool, args, capture }) {
  let command;
  let full;
  if (tool === "supabase") {
    // The pinned CLI from this repository's own node_modules, run by this very
    // Node: no npx, no shell, the same on Windows.
    const cli = join(ROOT, "node_modules", "supabase", "dist", "supabase.js");
    if (!existsSync(cli)) throw new SetupError("the Supabase CLI is not installed; run `npm ci` first");
    command = process.execPath;
    full = [cli, ...args];
  } else if (process.env.npm_execpath) {
    command = process.execPath;
    full = [process.env.npm_execpath, ...args];
  } else {
    command = process.platform === "win32" ? "npm.cmd" : "npm";
    full = args;
  }
  const result = spawnSync(command, full, {
    cwd: ROOT,
    encoding: "utf8",
    stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
    shell: command === "npm.cmd",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  return { status: result.status ?? 1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exit(2);
  }
  if (opts.help) {
    console.log(USAGE);
    return;
  }
  const rl = process.stdin.isTTY ? createInterface({ input: process.stdin, output: process.stdout }) : null;
  const setup = createSetup({ run: realRun, ask: rl ? (q) => rl.question(q) : null });
  try {
    await setup.runSetup(opts);
  } catch (error) {
    console.error(`\n${error instanceof SetupError ? error.message : error?.stack ?? error}`);
    process.exitCode = 1;
  } finally {
    rl?.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}
