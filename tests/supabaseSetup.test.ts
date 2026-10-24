import { existsSync, readFileSync, statSync } from "node:fs";
import { webcrypto } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  CRON_CHECK_SQL,
  NOTES_CHECK_SQL,
  STEPS,
  checkRef,
  checkSubject,
  createSetup,
  envFileText,
  generateVapidKeys,
  normalizeOrigins,
  parseArgs,
  parseQueryRows,
  publishableKey,
  redact,
  secretNames,
  vaultUpsertSql,
} from "../scripts/supabase-setup.mjs";
import { b64uToBytes, bytesToB64u, sendPush } from "../supabase/functions/_shared/webpush";

// `npm run supabase:setup` is meant for someone else's hosted project, so it is
// never run against a real one here. Every step is driven through a scripted
// command runner instead: the tests read which commands it would have run, what
// the secret files held while they existed, and what it printed.

const REF = "abcdefghijklmnopqrst";
const ROOT = "/repo";

interface Call {
  tool: string;
  args: string[];
  capture: boolean;
  /** For a command handed a file: its contents and mode while it existed. */
  file?: { path: string; content: string; mode: number };
}

interface Project {
  notes?: number;
  secrets?: string[];
  loggedIn?: boolean;
  linked?: string | null;
  vaultSecrets?: number;
  cronJobs?: number;
}

function fileArg(args: string[]): string | undefined {
  const at = args.findIndex((a) => a === "--file" || a === "--env-file");
  return at === -1 ? undefined : args[at + 1];
}

/** A fake Supabase: answers each command the way the CLI would. */
function harness(project: Project = {}, opts: { ask?: (q: string) => Promise<string> } = {}) {
  const calls: Call[] = [];
  const out: string[] = [];
  let linked = project.linked ?? null;
  const run = ({ tool, args, capture }: { tool: string; args: string[]; capture: boolean }) => {
    const call: Call = { tool, args, capture };
    const path = fileArg(args);
    if (path) {
      call.file = { path, content: readFileSync(path, "utf8"), mode: statSync(path).mode & 0o777 };
    }
    calls.push(call);
    const ok = (stdout = "") => ({ status: 0, stdout, stderr: "" });
    if (tool === "npm") return ok();
    const [a, b] = args;
    if (a === "projects" && b === "list") {
      return project.loggedIn === false
        ? { status: 1, stdout: "", stderr: "Access token not provided." }
        : ok("[]");
    }
    if (a === "link") {
      linked = args[args.indexOf("--project-ref") + 1];
      return ok();
    }
    if (a === "secrets" && b === "list") {
      return ok(JSON.stringify((project.secrets ?? []).map((name) => ({ name, value: "digest" }))));
    }
    if (a === "secrets" && b === "set") return ok("Finished supabase secrets set.");
    if (a === "functions") return ok();
    if (a === "projects" && b === "api-keys") {
      return ok(
        JSON.stringify([
          { name: "anon", api_key: "legacy-anon", type: "legacy" },
          { name: "service_role", api_key: "SERVICE-ROLE-MUST-NOT-SHOW", type: "legacy" },
          { name: "default", api_key: "sb_publishable_abc", type: "publishable" },
          { name: "default", api_key: "SECRET-KEY-MUST-NOT-SHOW", type: "secret" },
        ]),
      );
    }
    if (a === "db" && b === "query") {
      const sql = call.file?.content ?? "";
      const rows = (r: unknown[]) => ok(`Connecting to linked project...\n${JSON.stringify({ rows: r })}`);
      if (sql === NOTES_CHECK_SQL) return rows([{ notes: project.notes ?? -1 }]);
      if (sql === CRON_CHECK_SQL) {
        return rows([{ vault_secrets: project.vaultSecrets ?? 2, cron_jobs: project.cronJobs ?? 1 }]);
      }
      if (sql.startsWith("do $spar$")) return ok("DO");
    }
    throw new Error(`unexpected command: ${tool} ${args.join(" ")}`);
  };
  const setup = createSetup({
    run,
    ask: opts.ask ?? null,
    log: (line: string) => out.push(line),
    root: ROOT,
    readLinked: () => linked,
  });
  return { calls, out, setup, text: () => out.join("\n") };
}

const fullOpts = (extra: string[] = []) =>
  parseArgs([
    "--project-ref",
    REF,
    "--origin",
    "https://notes.example.com",
    "--vapid-subject",
    "mailto:me@example.com",
    ...extra,
  ]);

const commandLine = (c: Call) => `${c.tool} ${c.args.join(" ")}`;

describe("supabase:setup arguments", () => {
  it("reads both spellings of a valued flag and every switch", () => {
    const opts = parseArgs([
      `--project-ref=${REF}`,
      "--origin",
      "https://a.example/, http://localhost:5173",
      "--from-step",
      "cron",
      "--dry-run",
      "--yes-existing-project",
      "--rotate-vapid",
    ]);
    expect(opts).toMatchObject({
      projectRef: REF,
      origins: ["https://a.example", "http://localhost:5173"],
      fromStep: "cron",
      dryRun: true,
      yesExisting: true,
      rotateVapid: true,
    });
  });

  it("refuses what it cannot use, naming the problem", () => {
    expect(() => parseArgs(["--from-step", "deploy"])).toThrow(/one of link, migrate/);
    expect(() => parseArgs(["--wat"])).toThrow(/unknown option/);
    expect(() => parseArgs(["--project-ref"])).toThrow(/needs a value/);
    expect(() => checkRef("https://abc.supabase.co")).toThrow(/20 letters/);
    expect(() => normalizeOrigins("https://notes.example.com/app")).toThrow(/path/);
    expect(() => normalizeOrigins("ftp://x.example")).toThrow(/https/);
    expect(() => normalizeOrigins(" , ")).toThrow(/at least one/);
    expect(() => checkSubject("me@example.com")).toThrow(/mailto/);
    expect(checkSubject("mailto:me@example.com")).toBe("mailto:me@example.com");
  });

  it("names its steps in the order they run", () => {
    expect(STEPS).toEqual(["link", "migrate", "vapid", "secrets", "cron", "functions", "finish"]);
  });
});

describe("the secrets it makes", () => {
  it("makes a VAPID pair in the shape the push function signs with", async () => {
    const keys = generateVapidKeys();
    const point = b64uToBytes(keys.publicKey);
    expect(point.length).toBe(65);
    expect(point[0]).toBe(4);
    expect(b64uToBytes(keys.privateKey).length).toBe(32);

    // Sign a real push request with the edge function's own code, and check the
    // JWT it made against the public key the app would subscribe with.
    const ua = (await webcrypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, [
      "deriveBits",
    ])) as webcrypto.CryptoKeyPair;
    const uaPublic = new Uint8Array(await webcrypto.subtle.exportKey("raw", ua.publicKey));
    let authorization = "";
    const transport = (async (_url: string, init: RequestInit) => {
      authorization = (init.headers as Record<string, string>).Authorization;
      return new Response(null, { status: 201 });
    }) as unknown as typeof fetch;
    const result = await sendPush(
      {
        endpoint: "https://push.example/abc",
        p256dh: bytesToB64u(uaPublic),
        auth: bytesToB64u(webcrypto.getRandomValues(new Uint8Array(16))),
      },
      { title: "t" },
      { ...keys, subject: "mailto:me@example.com" },
      60,
      transport,
    );
    expect(result.ok).toBe(true);
    const m = /^vapid t=([^.]+\.[^.]+)\.([^,]+), k=(.+)$/.exec(authorization);
    expect(m).not.toBeNull();
    expect(m![3]).toBe(keys.publicKey);
    const verifier = await webcrypto.subtle.importKey(
      "raw",
      point,
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"],
    );
    const valid = await webcrypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      verifier,
      b64uToBytes(m![2]),
      new TextEncoder().encode(m![1]),
    );
    expect(valid).toBe(true);
  });

  it("writes an env file of one line per secret, and refuses a line break", () => {
    expect(envFileText({ A_B: "x=y", C: "https://a,https://b" })).toBe("A_B=x=y\nC=https://a,https://b\n");
    expect(() => envFileText({ A: "x\ny" })).toThrow(/one line/);
    expect(() => envFileText({ "bad name": "x" })).toThrow(/bad secret name/);
  });

  it("stores a Vault secret in one statement that works the second time too", () => {
    const sql = vaultUpsertSql("reminder_fn_key", "it's");
    expect(sql.startsWith("do $spar$")).toBe(true);
    expect(sql).toContain("vault.create_secret('it''s', 'reminder_fn_key')");
    expect(sql).toContain("vault.update_secret(existing, 'it''s')");
    // One statement: the only semicolons outside the block are its end.
    expect(sql.trim().endsWith("$spar$;")).toBe(true);
  });

  it("redacts every secret it has handled from output it shows", () => {
    expect(redact("token abcdefghij in abcdefghij", ["abcdefghij"])).toBe("token [redacted] in [redacted]");
    expect(redact("short", ["abc"])).toBe("short");
  });
});

describe("reading the CLI's answers", () => {
  it("reads query rows out of the CLI's chatter", () => {
    expect(parseQueryRows('Connecting...\n{"rows":[{"n":"{}"}]}\nA new version')).toEqual([{ n: "{}" }]);
    expect(() => parseQueryRows("DO")).toThrow(/no JSON/);
  });

  it("reads secret names from JSON or the table", () => {
    expect(secretNames('[{"name":"VAPID_PUBLIC_KEY","value":"x"}]')).toEqual(new Set(["VAPID_PUBLIC_KEY"]));
    const table = "  NAME              | DIGEST\n  ------------------|------\n  CRON_SECRET       | abc\n  ALLOWED_ORIGINS   | def\n";
    expect(secretNames(table)).toEqual(new Set(["CRON_SECRET", "ALLOWED_ORIGINS"]));
  });

  it("hands out only the publishable key, or the anon key on an older project", () => {
    const listed = [
      { name: "service_role", api_key: "srv", type: "legacy" },
      { name: "anon", api_key: "anon", type: "legacy" },
      { name: "default", api_key: "secret-key-x", type: "secret" },
    ];
    expect(publishableKey(JSON.stringify(listed))).toBe("anon");
    expect(publishableKey(JSON.stringify([...listed, { name: "d", api_key: "sb_publishable_y", type: "publishable" }])))
      .toBe("sb_publishable_y");
    expect(publishableKey(JSON.stringify([listed[0], listed[2]]))).toBeNull();
    expect(publishableKey("not json")).toBeNull();
  });
});

describe("a whole run against a new project", () => {
  it("links, migrates, keys, deploys and says what is left — and never lets a secret out", async () => {
    const h = harness({ notes: -1 });
    const ctx = await h.setup.runSetup(fullOpts());

    const lines = h.calls.map(commandLine);
    const at = (pattern: RegExp) => lines.findIndex((l) => pattern.test(l));
    expect(at(/^supabase projects list/)).toBe(0);
    expect(at(/^supabase link --project-ref abcdefghijklmnopqrst/)).toBe(1);
    // The note count is asked before anything is written.
    expect(at(/^supabase db query --linked --file/)).toBe(2);
    expect(h.calls[2].file!.content).toBe(NOTES_CHECK_SQL);
    expect(at(/^npm run db:push$/)).toBe(3);
    expect(lines.filter((l) => /^supabase functions deploy/.test(l))).toEqual([
      `supabase functions deploy link-preview --project-ref ${REF} --use-api --workdir ${ROOT}`,
      `supabase functions deploy send-reminders --project-ref ${REF} --use-api --workdir ${ROOT}`,
    ]);
    // Every CLI call names this checkout, so it never acts on another folder's link.
    for (const c of h.calls.filter((c) => c.tool === "supabase")) {
      expect(c.args.slice(-2)).toEqual(["--workdir", ROOT]);
    }

    // Secrets travel only in files: owner-only, and gone afterwards.
    const secretFiles = h.calls.filter((c) => c.file);
    expect(secretFiles.length).toBeGreaterThan(0);
    for (const c of secretFiles) {
      // Windows has no owner-only mode bits to read back (audit CODE-7).
      if (process.platform !== "win32") expect(c.file!.mode).toBe(0o600);
      expect(existsSync(c.file!.path)).toBe(false);
    }
    const sets = h.calls.filter((c) => c.args[0] === "secrets" && c.args[1] === "set");
    const env = Object.fromEntries(
      sets.flatMap((c) => c.file!.content.trim().split("\n").map((l) => l.split(/=(.*)/s).slice(0, 2))),
    );
    expect(Object.keys(env).sort()).toEqual([
      "ALLOWED_ORIGINS",
      "CRON_SECRET",
      "VAPID_PRIVATE_KEY",
      "VAPID_PUBLIC_KEY",
      "VAPID_SUBJECT",
    ]);
    expect(env.ALLOWED_ORIGINS).toBe("https://notes.example.com");
    expect(env.VAPID_SUBJECT).toBe("mailto:me@example.com");
    expect(env.VAPID_PUBLIC_KEY).toBe(ctx.vapidPublicKey);

    // The cron token in Vault is the one the function was given.
    const vault = h.calls.filter((c) => c.file?.content.startsWith("do $spar$")).map((c) => c.file!.content);
    expect(vault).toHaveLength(2);
    expect(vault[0]).toContain(`'https://${REF}.supabase.co/functions/v1/send-reminders', 'reminder_fn_url'`);
    expect(vault[1]).toContain(`'${env.CRON_SECRET}', 'reminder_fn_key'`);

    // No secret on any command line, nor in anything printed.
    const secrets = [env.CRON_SECRET, env.VAPID_PRIVATE_KEY];
    for (const line of lines) for (const s of secrets) expect(line).not.toContain(s);
    for (const s of [...secrets, "SERVICE-ROLE-MUST-NOT-SHOW", "SECRET-KEY-MUST-NOT-SHOW"]) {
      expect(h.text()).not.toContain(s);
    }
    // What the app needs is printed: the public key and the publishable key.
    expect(h.text()).toContain(`SPAR_VAPID_PUBLIC_KEY=${env.VAPID_PUBLIC_KEY}`);
    expect(h.text()).toContain("SPAR_SUPABASE_KEY=sb_publishable_abc");
    expect(h.text()).toContain(`SPAR_SUPABASE_URL=https://${REF}.supabase.co`);
    expect(h.text()).toContain("Redirect URLs:  https://notes.example.com");
    // The code an iPhone Home Screen app types instead of the link (audit UX-11).
    expect(h.text()).toContain("Templates -> Magic Link");
    expect(h.text()).toContain("{{ .Token }}");
  });

  it("does not ask the database password or link again when already linked", async () => {
    const h = harness({ notes: -1, linked: REF });
    await h.setup.runSetup(fullOpts());
    expect(h.calls.some((c) => c.args[0] === "link")).toBe(false);
    expect(h.text()).toContain(`already linked to ${REF}`);
  });
});

describe("the guard on a project in use", () => {
  it("refuses a project that holds notes before writing anything", async () => {
    const h = harness({ notes: 401, secrets: ["VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY"] });
    await expect(h.setup.runSetup(fullOpts())).rejects.toThrow(/already holds 401 spår note/);
    const lines = h.calls.map(commandLine);
    expect(lines).toHaveLength(3); // login check, link, the count
    expect(lines.some((l) => /db:push|secrets set|functions deploy/.test(l))).toBe(false);
  });

  it("refuses on a resumed run too, whichever step it starts at", async () => {
    const h = harness({ notes: 3, linked: REF });
    await expect(h.setup.runSetup(fullOpts(["--from-step", "functions"]))).rejects.toThrow(/already holds 3/);
    expect(h.calls.some((c) => c.args[0] === "functions")).toBe(false);
  });

  it("goes on when told to, and keeps the Web Push keys the project already has", async () => {
    const h = harness({ notes: 401, secrets: ["VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY"], linked: REF });
    const ctx = await h.setup.runSetup(fullOpts(["--yes-existing-project"]));
    const sets = h.calls.filter((c) => c.args[0] === "secrets" && c.args[1] === "set");
    const names = sets.flatMap((c) => c.file!.content.trim().split("\n").map((l) => l.split("=")[0]));
    expect(names).not.toContain("VAPID_PRIVATE_KEY");
    expect(names).not.toContain("VAPID_PUBLIC_KEY");
    expect(ctx.vapidKept).toBe(true);
    expect(h.text()).toMatch(/already has a Web Push key pair; kept/);
  });

  it("re-keys Web Push only when asked outright", async () => {
    const h = harness({ notes: -1, secrets: ["VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY"], linked: REF });
    await h.setup.runSetup(fullOpts(["--rotate-vapid"]));
    const sets = h.calls.filter((c) => c.args[0] === "secrets" && c.args[1] === "set");
    expect(sets[0].file!.content).toMatch(/^VAPID_PUBLIC_KEY=.+\nVAPID_PRIVATE_KEY=.+\n$/);
  });
});

describe("resuming, dry runs and the local stack", () => {
  it("resumes at a step, and refuses when this checkout is linked elsewhere", async () => {
    const h = harness({ notes: 0, linked: REF });
    await h.setup.runSetup(fullOpts(["--from-step", "cron"]));
    const lines = h.calls.map(commandLine);
    expect(lines.some((l) => /^supabase (link|projects list)|db:push|secrets list/.test(l))).toBe(false);
    expect(lines.filter((l) => /^supabase secrets set/.test(l))).toHaveLength(1);

    const other = harness({ notes: 0, linked: "zzzzzzzzzzzzzzzzzzzz" });
    await expect(other.setup.runSetup(fullOpts(["--from-step", "cron"]))).rejects.toThrow(
      /linked to zzzzzzzzzzzzzzzzzzzz, not abcdefghijklmnopqrst/,
    );
    expect(other.calls).toHaveLength(0);
  });

  it("says how to log in when the CLI is not", async () => {
    const h = harness({ loggedIn: false });
    await expect(h.setup.runSetup(fullOpts())).rejects.toThrow(/npx supabase login/);
    expect(h.calls).toHaveLength(1);
  });

  it("stops at the reminder sweep when the migration that schedules it is missing", async () => {
    const h = harness({ notes: -1, linked: REF, cronJobs: 0 });
    await expect(h.setup.runSetup(fullOpts(["--from-step", "cron"]))).rejects.toThrow(/0 of 1 cron job/);
  });

  it("names the flag for a value nobody can be asked for", async () => {
    const h = harness({ notes: -1, linked: REF });
    await expect(h.setup.runSetup(parseArgs(["--project-ref", REF, "--from-step", "secrets"]))).rejects.toThrow(
      /missing --origin/,
    );
    await expect(harness().setup.runSetup(parseArgs([]))).rejects.toThrow(/missing --project-ref/);
  });

  it("asks for a missing value again until it is one it can use", async () => {
    const answers = ["not a url", "https://notes.example.com", "mailto:me@example.com"];
    const h = harness({ notes: -1, linked: REF }, { ask: async () => answers.shift()! });
    await h.setup.runSetup(parseArgs(["--project-ref", REF, "--from-step", "secrets"]));
    const set = h.calls.find((c) => c.args[0] === "secrets" && c.args[1] === "set")!;
    expect(set.file!.content).toBe("VAPID_SUBJECT=mailto:me@example.com\nALLOWED_ORIGINS=https://notes.example.com\n");
    expect(h.text()).toContain("is not a URL");
  });

  it("runs nothing at all in a dry run", async () => {
    const h = harness();
    await h.setup.runSetup(parseArgs(["--dry-run"]));
    expect(h.calls).toHaveLength(0);
    expect(h.text()).toContain("would run: supabase link --project-ref <ref>");
    expect(h.text()).toContain("would run: npm run db:push");
    expect(h.text()).toContain("storing the Vault secret reminder_fn_key");
  });

  it("on the local stack, touches only the local database", async () => {
    const h = harness({ notes: 0 });
    await h.setup.runSetup(parseArgs(["--local"]));
    const lines = h.calls.map(commandLine);
    expect(lines.every((l) => /^supabase db query --local --file|^npm run db:verify:local$/.test(l))).toBe(true);
    const vault = h.calls.filter((c) => c.file?.content.startsWith("do $spar$"));
    expect(vault[0].file!.content).toContain("'http://kong:8000/functions/v1/send-reminders'");
  });
});
