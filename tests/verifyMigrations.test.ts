import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// `scripts/verify-migrations.mjs` is the safety net behind `npm run db:push`: it
// reads the SQL files, works out what an applied migration must have left
// behind, and asks the database. It has no exports and runs `main()` on import,
// so this test drives it the way `npm run db:verify` does — as a child process —
// and never touches a real database:
//
//   1. `--dry-run` over the real `supabase/migrations/` (the parser's half).
//   2. A throwaway copy of the script beside a few small, hand-written
//      migrations, with a fake `npx` first on PATH that answers the script's
//      `supabase db query` calls from a JSON file this test writes. The script
//      itself is unmodified; only the "database" is a stand-in. That is what
//      lets a test say "the catalogue lacks this index" or "anon can read this
//      table" and watch the script exit 1 and name it.

// Every case starts one or two child processes (on Windows through cmd), and the
// suite runs beside a dozen others; the default 5 s is too tight under load.
vi.setConfig({ testTimeout: 60_000 });

const REPO = join(__dirname, "..");
const SCRIPT = join(REPO, "scripts", "verify-migrations.mjs");

interface Run {
  code: number | null;
  out: string; // stdout + stderr, in that order
  stdout: string;
  stderr: string;
}

function runNode(script: string, args: string[], cwd: string, env?: NodeJS.ProcessEnv): Run {
  const res = spawnSync(process.execPath, [script, ...args], {
    cwd,
    env: env ?? process.env,
    encoding: "utf8",
  });
  return {
    code: res.status,
    stdout: res.stdout ?? "",
    stderr: res.stderr ?? "",
    out: `${res.stdout ?? ""}${res.stderr ?? ""}`,
  };
}

// ---------------------------------------------------------------------------
// 1. The real migrations, parsed (no database, no fake)
// ---------------------------------------------------------------------------

describe("verify-migrations --dry-run over the real migrations", () => {
  const sqlFiles = readdirSync(join(REPO, "supabase", "migrations")).filter((f) =>
    f.endsWith(".sql"),
  );
  const run = runNode(SCRIPT, ["--dry-run"], REPO);

  it("parses every migration file and says no database was contacted", () => {
    expect(run.code).toBe(0);
    expect(run.stdout).toContain(
      `Parsed ${sqlFiles.length} migrations`,
    );
    expect(run.stdout).toContain("No database was contacted.");
  });

  it("finds the object kinds the schema is made of", () => {
    const count = (kind: string): number => {
      const m = new RegExp(`^\\s+(\\d+)\\s+${kind}$`, "m").exec(run.stdout);
      return m ? Number(m[1]) : 0;
    };
    expect(count("table")).toBeGreaterThanOrEqual(8);
    expect(count("column")).toBeGreaterThan(50);
    expect(count("function")).toBeGreaterThanOrEqual(10);
    expect(count("index")).toBeGreaterThan(10);
    expect(count("policy")).toBeGreaterThan(20);
    expect(count("trigger")).toBeGreaterThanOrEqual(5);
  });

  it("recovers the security shape of the functions that carry it", () => {
    const line = (name: string) =>
      run.stdout.split("\n").find((l) => l.trim().startsWith(`public.${name}(`)) ?? "";

    // 0022: invoker on purpose, so it keeps obeying row level security.
    const pull = line("pull_changes");
    expect(pull).toContain("security invoker");
    expect(pull).toContain("set search_path=public,pg_temp");
    expect(pull).toContain("revoked from public/anon");

    // 0023: a definer that pins both settings and is closed to everyone but the sweep.
    const due = line("due_reminders");
    expect(due).toContain("security definer");
    expect(due).toContain("set timezone=utc");
    expect(due).toContain("grant to service_role");
    expect(due).toContain("revoked from public/anon/authenticated");

    // 0026 drops the embedding RPC; a later migration must cancel an earlier one.
    expect(line("set_note_embedding")).toContain("dropped by 0026");
  });

  it("reads a body for every function that still exists, and notes nothing it could not read", () => {
    const fnLines = run.stdout
      .split("\n")
      .filter((l) => /^\s+public\.[a-z_]+\(.*\) — /.test(l) && !l.includes("dropped by"));
    expect(fnLines.length).toBeGreaterThanOrEqual(10);
    for (const l of fnLines) {
      expect(l).not.toContain("body NOT READ");
      expect(l).toMatch(/body \d+ lines/);
    }
    // The only parse notes the real tree is allowed: schema grants, reported as unread.
    const notes = run.stdout
      .split("\n")
      .filter((l) => /^\s+· \d{4}:/.test(l));
    for (const n of notes) expect(n).toContain("schema-level privileges");
    expect(run.stdout).not.toContain("could not read");
    expect(run.stdout).not.toContain("could not locate");
    expect(run.stdout).not.toContain("is not a plain lowercase identifier");
  });

  it("prints what it does not check, on every run", () => {
    expect(run.stdout).toContain("NOT CHECKED");
    expect(run.stdout).toContain("index definitions");
  });
});

// ---------------------------------------------------------------------------
// 2. Hand-written migrations against a stand-in database
// ---------------------------------------------------------------------------

const MIG_0001 = `
-- 0001: a table, its owner policy, an index, explicit grants, and "revoke all"
create table public.widgets (
  id uuid primary key,
  owner_id uuid not null,
  body text
);
alter table public.widgets enable row level security;
create policy widgets_owner on public.widgets
  for all to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());
create index widgets_owner_idx on public.widgets (owner_id);
grant select, insert, update, delete on public.widgets to authenticated, service_role;
revoke all on public.widgets from anon;
`;

const MIG_0002 = `
-- 0002: a second table; grants and revokes with *named* privilege lists, a
-- security definer function closed to everyone, a trigger that calls it
create table public.gadgets (
  id uuid primary key,
  widget_id uuid
);
alter table public.gadgets enable row level security;
alter table public.gadgets add column note text;
grant select, insert, delete on public.gadgets to authenticated;
revoke delete on public.gadgets from authenticated;
revoke truncate, references on public.gadgets from anon, public;
create function public.touch() returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin return new; end
$$;
revoke all on function public.touch() from public, anon, authenticated;
create trigger trg_gadgets_touch before update on public.gadgets
  for each row execute function public.touch();
`;

const MIG_0003 = `
-- 0003: written but, in some scenarios, not applied yet. "grant all" is the
-- shape the verifier skips with a note rather than expanding.
create table public.later (id uuid primary key);
grant all on public.later to authenticated;
`;

interface Inventory {
  applied: string[];
  schemas: string[];
  tables: string[];
  views: string[];
  columns: string[];
  functions: string[];
  triggers: string[];
  indexes: string[];
  policies: string[];
  types: string[];
  rls: { key: string; enabled: boolean; forced: boolean; replica: string }[];
  policy_detail: Record<string, unknown>[];
  function_detail: Record<string, unknown>[];
  trigger_detail: { key: string; fn: string }[];
  table_acl: { key: string; grants: { role: string; priv: string }[] }[];
  publications: string[];
  extensions: string[];
}

const grants = (role: string, ...privs: string[]) =>
  privs.map((priv) => ({ role, priv }));

// What the database looks like when MIG_0001..0003 all landed exactly as written.
function healthyInventory(): Inventory {
  return {
    applied: ["0001", "0002", "0003"],
    schemas: ["public"],
    tables: ["public.widgets", "public.gadgets", "public.later"],
    views: [],
    columns: [
      "public.widgets.id",
      "public.widgets.owner_id",
      "public.widgets.body",
      "public.gadgets.id",
      "public.gadgets.widget_id",
      "public.gadgets.note",
      "public.later.id",
    ],
    functions: ["public.touch"],
    triggers: ["public.gadgets.trg_gadgets_touch"],
    indexes: ["public.widgets_owner_idx"],
    policies: ["public.widgets.widgets_owner"],
    types: [],
    rls: [
      { key: "public.widgets", enabled: true, forced: false, replica: "d" },
      { key: "public.gadgets", enabled: true, forced: false, replica: "d" },
    ],
    policy_detail: [
      {
        key: "public.widgets.widgets_owner",
        table: "public.widgets",
        cmd: "all",
        permissive: true,
        roles: ["authenticated"],
        using: "(owner_id = auth.uid())",
        check: "(owner_id = auth.uid())",
      },
    ],
    function_detail: [
      {
        schema: "public",
        name: "touch",
        argtypes: "",
        secdef: true,
        config: ["search_path=public, pg_temp"],
        src: "\nbegin return new; end\n",
        execute_roles: ["postgres", "service_role"],
      },
    ],
    trigger_detail: [
      { key: "public.gadgets.trg_gadgets_touch", fn: "public.touch" },
    ],
    table_acl: [
      {
        key: "public.widgets",
        grants: [
          ...grants("postgres", "SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE"),
          ...grants("authenticated", "SELECT", "INSERT", "UPDATE", "DELETE"),
          ...grants("service_role", "SELECT", "INSERT", "UPDATE", "DELETE"),
        ],
      },
      {
        key: "public.gadgets",
        grants: [
          ...grants("postgres", "SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE"),
          ...grants("authenticated", "SELECT", "INSERT"),
        ],
      },
      {
        key: "public.later",
        grants: grants("postgres", "SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE"),
      },
    ],
    publications: [],
    extensions: [],
  };
}

describe("verify-migrations against a stand-in database", () => {
  let root: string; // the throwaway "repo"
  let fakeBin: string; // holds the fake npx
  let env: NodeJS.ProcessEnv;
  let n = 0;

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), "spar-verify-test-"));
    mkdirSync(join(root, "scripts"));
    mkdirSync(join(root, "supabase", "migrations"), { recursive: true });
    copyFileSync(SCRIPT, join(root, "scripts", "verify-migrations.mjs"));
    writeMigrations({
      "0001_widgets.sql": MIG_0001,
      "0002_gadgets.sql": MIG_0002,
      "0003_later.sql": MIG_0003,
    });

    // The fake `supabase db query`: reads --file, logs the call, and answers
    // from the JSON file named in the environment.
    fakeBin = join(root, "fakebin");
    mkdirSync(fakeBin);
    writeFileSync(
      join(fakeBin, "fake-supabase.mjs"),
      `import { appendFileSync, readFileSync } from "node:fs";
const a = process.argv.slice(2);
const sql = readFileSync(a[a.indexOf("--file") + 1], "utf8");
appendFileSync(process.env.FAKE_LOG, JSON.stringify({ args: a, sql }) + "\\n");
const inventory = /cron\\.job/.test(sql)
  ? { jobs: JSON.parse(process.env.FAKE_CRON || "[]") }
  : JSON.parse(readFileSync(process.env.FAKE_INVENTORY, "utf8"));
process.stdout.write("Connecting to the stand-in...\\n" + JSON.stringify({ rows: [{ inventory }] }) + "\\n");
`,
    );
    const node = process.execPath;
    const shim = join(fakeBin, "fake-supabase.mjs");
    if (process.platform === "win32") {
      writeFileSync(join(fakeBin, "npx.cmd"), `@"${node}" "${shim}" %*\r\n`);
    } else {
      const sh = join(fakeBin, "npx");
      writeFileSync(sh, `#!/bin/sh\nexec "${node}" "${shim}" "$@"\n`);
      chmodSync(sh, 0o755);
    }

    env = { ...process.env };
    const pathKey =
      Object.keys(env).find((k) => k.toLowerCase() === "path") ?? "PATH";
    env[pathKey] = `${fakeBin}${delimiter}${env[pathKey] ?? ""}`;
  });

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function writeMigrations(files: Record<string, string>): void {
    const dir = join(root, "supabase", "migrations");
    for (const f of readdirSync(dir)) rmSync(join(dir, f));
    for (const [name, sql] of Object.entries(files)) {
      writeFileSync(join(dir, name), sql);
    }
  }

  // Run the unmodified script, with `inv` as the database.
  function verify(inv: Inventory, args: string[] = [], cron?: unknown[]) {
    n += 1;
    const inventoryFile = join(root, `inventory-${n}.json`);
    const log = join(root, `calls-${n}.log`);
    writeFileSync(inventoryFile, JSON.stringify(inv));
    writeFileSync(log, "");
    const res = runNode(join(root, "scripts", "verify-migrations.mjs"), args, root, {
      ...env,
      FAKE_INVENTORY: inventoryFile,
      FAKE_LOG: log,
      FAKE_CRON: JSON.stringify(cron ?? []),
    });
    const calls = readFileSync(log, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as { args: string[]; sql: string });
    return { ...res, calls };
  }

  it("passes when the database holds exactly what the migrations wrote", () => {
    const r = verify(healthyInventory());
    expect(r.out).toContain("OK — every object from every applied migration exists");
    expect(r.code).toBe(0);
    expect(r.out).not.toContain("MISSING");
    expect(r.out).not.toContain("WRONG");
  });

  it("asks the linked project by default and the local stack only with --local", () => {
    const remote = verify(healthyInventory());
    expect(remote.calls.length).toBeGreaterThan(0);
    expect(remote.calls[0].args).toContain("--linked");
    expect(remote.calls[0].args).toEqual(
      expect.arrayContaining(["--no-install", "supabase", "db", "query"]),
    );
    expect(remote.out).toContain("linked (remote)");

    const local = verify(healthyInventory(), ["--local"]);
    expect(local.calls[0].args).not.toContain("--linked");
    expect(local.out).toContain("local");
    expect(local.code).toBe(0);
  });

  describe("an object an applied migration defines that the catalogue lacks", () => {
    // The 2026-08-17 shape: a history row for the migration, none of its objects.
    it("reports a missing function, trigger, index and column, and exits 1", () => {
      const inv = healthyInventory();
      inv.functions = [];
      inv.triggers = [];
      inv.indexes = [];
      inv.columns = inv.columns.filter((c) => c !== "public.gadgets.note");
      const r = verify(inv);
      expect(r.code).toBe(1);
      expect(r.out).toContain("MISSING: 4 object(s)");
      expect(r.out).toContain("function public.touch");
      expect(r.out).toContain("trigger public.gadgets.trg_gadgets_touch");
      expect(r.out).toContain("index public.widgets_owner_idx");
      expect(r.out).toContain("column public.gadgets.note");
      // each is filed under the migration that should have made it
      expect(r.out).toContain("migration 0001 is recorded as applied");
      expect(r.out).toContain("migration 0002 is recorded as applied");
    });

    it("reports a missing table", () => {
      const inv = healthyInventory();
      inv.tables = inv.tables.filter((t) => t !== "public.gadgets");
      const r = verify(inv);
      expect(r.code).toBe(1);
      expect(r.out).toContain("table public.gadgets");
    });

    it("skips what a not-yet-applied migration made, unless --all", () => {
      const inv = healthyInventory();
      inv.applied = ["0001", "0002"];
      inv.tables = inv.tables.filter((t) => t !== "public.later");
      inv.columns = inv.columns.filter((c) => c !== "public.later.id");
      inv.table_acl = inv.table_acl.filter((t) => t.key !== "public.later");

      const normal = verify(inv);
      expect(normal.code).toBe(0);
      expect(normal.out).toContain("Skipping 2 objects from migrations not yet applied there: 0003");

      const all = verify(inv, ["--all"]);
      expect(all.code).toBe(1);
      expect(all.out).toContain("table public.later");
    });
  });

  describe("anon holding a privilege on a table a migration created", () => {
    // The project's default privileges hand every new table to anon; a table
    // whose migration never revoked it comes back from the catalogue like this.
    it("reports SELECT and TRUNCATE held by anon, and says how to close it", () => {
      const inv = healthyInventory();
      inv.table_acl
        .find((t) => t.key === "public.gadgets")!
        .grants.push(...grants("anon", "SELECT", "INSERT", "TRUNCATE"));
      const r = verify(inv);
      expect(r.code).toBe(1);
      expect(r.out).toContain("WRONG");
      expect(r.out).toContain("table public.gadgets grants SELECT and TRUNCATE to anon");
      expect(r.out).toContain("revoke select, truncate on public.gadgets from anon;");
    });

    it("reports a lone SELECT, or a lone TRUNCATE", () => {
      const a = healthyInventory();
      a.table_acl.find((t) => t.key === "public.widgets")!.grants.push(...grants("anon", "SELECT"));
      const ra = verify(a);
      expect(ra.code).toBe(1);
      expect(ra.out).toContain("table public.widgets grants SELECT to anon");

      const b = healthyInventory();
      b.table_acl.find((t) => t.key === "public.widgets")!.grants.push(...grants("anon", "TRUNCATE"));
      const rb = verify(b);
      expect(rb.code).toBe(1);
      expect(rb.out).toContain("table public.widgets grants TRUNCATE to anon");
    });

    it("treats PUBLIC the same, because PUBLIC reaches anon", () => {
      const inv = healthyInventory();
      inv.table_acl.find((t) => t.key === "public.widgets")!.grants.push(...grants("public", "SELECT"));
      const r = verify(inv);
      expect(r.code).toBe(1);
      expect(r.out).toContain("table public.widgets grants SELECT to public");
    });

    it("checks a table created by a migration the database has not applied only with --all", () => {
      const inv = healthyInventory();
      inv.applied = ["0001", "0002"];
      inv.table_acl.find((t) => t.key === "public.later")!.grants.push(...grants("anon", "SELECT"));
      expect(verify(inv).code).toBe(0);
      const all = verify(inv, ["--all"]);
      expect(all.code).toBe(1);
      expect(all.out).toContain("table public.later grants SELECT to anon");
    });

    it("lets anon hold privileges that are neither SELECT nor TRUNCATE", () => {
      // The check is scoped to the two that read or destroy; it is not a
      // claim that anon must hold nothing at all.
      const inv = healthyInventory();
      inv.table_acl.find((t) => t.key === "public.widgets")!.grants.push(...grants("anon", "REFERENCES"));
      expect(verify(inv).code).toBe(0);
    });
  });

  describe("table grants: named privilege lists and `all`", () => {
    it("reports a privilege a named grant list gave that the table no longer holds", () => {
      const inv = healthyInventory();
      const widgets = inv.table_acl.find((t) => t.key === "public.widgets")!;
      widgets.grants = widgets.grants.filter(
        (g) => !(g.role === "authenticated" && g.priv === "UPDATE"),
      );
      const r = verify(inv);
      expect(r.code).toBe(1);
      expect(r.out).toContain("table public.widgets no longer grants UPDATE to authenticated");
    });

    it("subtracts a named revoke: delete was granted then revoked, so it is not expected", () => {
      // healthyInventory's gadgets holds SELECT, INSERT only. If the verifier
      // ignored the `revoke delete` it would demand DELETE and fail this.
      const r = verify(healthyInventory());
      expect(r.code).toBe(0);
      expect(r.out).not.toContain("public.gadgets no longer grants");
    });

    it("still demands what the revoke left behind", () => {
      const inv = healthyInventory();
      const gadgets = inv.table_acl.find((t) => t.key === "public.gadgets")!;
      gadgets.grants = gadgets.grants.filter(
        (g) => !(g.role === "authenticated" && g.priv === "INSERT"),
      );
      const r = verify(inv);
      expect(r.code).toBe(1);
      expect(r.out).toContain("table public.gadgets no longer grants INSERT to authenticated");
    });

    it("counts a grant to PUBLIC as holding the privilege", () => {
      const inv = healthyInventory();
      const widgets = inv.table_acl.find((t) => t.key === "public.widgets")!;
      widgets.grants = widgets.grants.filter(
        (g) => !(g.role === "service_role" && g.priv === "DELETE"),
      );
      widgets.grants.push(...grants("public", "DELETE"));
      expect(verify(inv).code).toBe(0);
    });

    it("does not expand `all`: its table's grants are skipped, and the dry-run says so", () => {
      // 0003 says `grant all on public.later to authenticated`. If `all` were
      // read as a privilege name the empty ACL below would fail; it is skipped.
      const r = verify(healthyInventory());
      expect(r.code).toBe(0);
      expect(r.out).not.toContain("public.later no longer grants");

      const dry = runNode(join(root, "scripts", "verify-migrations.mjs"), ["--dry-run"], root);
      expect(dry.code).toBe(0);
      expect(dry.stdout).toContain("grant all … on public.later` is not expanded");
      expect(dry.stdout).toContain("revoke all … on public.widgets` is not expanded");
    });
  });

  describe("attributes other than presence", () => {
    it("reports row level security switched off", () => {
      const inv = healthyInventory();
      inv.rls.find((r) => r.key === "public.widgets")!.enabled = false;
      const r = verify(inv);
      expect(r.code).toBe(1);
      expect(r.out).toContain("row level security on public.widgets");
    });

    it("reports a policy rewritten to `using (true)` under the same name", () => {
      const inv = healthyInventory();
      inv.policy_detail[0].using = "true";
      const r = verify(inv);
      expect(r.code).toBe(1);
      expect(r.out).toContain("using has been opened to everything");
    });

    it("reports a function executable by PUBLIC after a drop-and-recreate", () => {
      const inv = healthyInventory();
      inv.function_detail[0].execute_roles = ["postgres", "service_role", "public"];
      const r = verify(inv);
      expect(r.code).toBe(1);
      expect(r.out).toContain("function public.touch() is executable by");
    });

    it("reports a function that lost its pinned search_path", () => {
      const inv = healthyInventory();
      inv.function_detail[0].config = [];
      const r = verify(inv);
      expect(r.code).toBe(1);
      expect(r.out).toContain("has lost its `set search_path`");
    });

    it("reports a function body that is not the one the migration wrote", () => {
      const inv = healthyInventory();
      inv.function_detail[0].src = "\nbegin return null; end\n";
      const r = verify(inv);
      expect(r.code).toBe(1);
      expect(r.out).toContain("has a different body");
    });

    it("ignores CRLF and trailing spaces in a stored body", () => {
      const inv = healthyInventory();
      inv.function_detail[0].src = "\r\nbegin return new; end  \r\n";
      expect(verify(inv).code).toBe(0);
    });

    it("reports a trigger that now calls a different function", () => {
      const inv = healthyInventory();
      inv.trigger_detail[0].fn = "public.other";
      const r = verify(inv);
      expect(r.code).toBe(1);
      expect(r.out).toContain("trigger public.gadgets.trg_gadgets_touch calls a different function");
    });
  });

  describe("what a later migration cancels", () => {
    it("does not demand an object a later migration dropped", () => {
      writeMigrations({
        "0001_widgets.sql": MIG_0001,
        "0002_gadgets.sql": MIG_0002,
        "0003_later.sql": `${MIG_0003}
drop index if exists public.widgets_owner_idx;
drop function if exists public.touch();
alter table public.gadgets drop column note;
`,
      });
      try {
        const inv = healthyInventory();
        inv.indexes = [];
        inv.functions = [];
        inv.function_detail = [];
        inv.columns = inv.columns.filter((c) => c !== "public.gadgets.note");
        const r = verify(inv);
        expect(r.code).toBe(0);
        expect(r.out).not.toContain("MISSING");
      } finally {
        writeMigrations({
          "0001_widgets.sql": MIG_0001,
          "0002_gadgets.sql": MIG_0002,
          "0003_later.sql": MIG_0003,
        });
      }
    });

    it("does not demand a table's children once the table is dropped", () => {
      writeMigrations({
        "0001_widgets.sql": MIG_0001,
        "0002_gadgets.sql": MIG_0002,
        // An index is not tied to its table in the verifier's bookkeeping (it
        // has a name and a schema, nothing else), so the migration drops it by
        // name as well, as a real one would.
        "0003_later.sql": `${MIG_0003}
drop index public.widgets_owner_idx;
drop table public.widgets;
`,
      });
      try {
        const inv = healthyInventory();
        inv.tables = inv.tables.filter((t) => t !== "public.widgets");
        inv.columns = inv.columns.filter((c) => !c.startsWith("public.widgets."));
        inv.indexes = [];
        inv.policies = [];
        inv.policy_detail = [];
        inv.rls = inv.rls.filter((r) => r.key !== "public.widgets");
        inv.table_acl = inv.table_acl.filter((t) => t.key !== "public.widgets");
        const r = verify(inv);
        expect(r.code).toBe(0);
        expect(r.out).not.toContain("MISSING");
      } finally {
        writeMigrations({
          "0001_widgets.sql": MIG_0001,
          "0002_gadgets.sql": MIG_0002,
          "0003_later.sql": MIG_0003,
        });
      }
    });
  });

  it("does not take comments or string literals for statements", () => {
    writeMigrations({
      "0001_widgets.sql": `${MIG_0001}
-- create table public.ghost_in_a_comment (id int);
/* create table public.ghost_in_a_block (id int); */
select 'create table public.ghost_in_a_string (id int)';
`,
      "0002_gadgets.sql": MIG_0002,
      "0003_later.sql": MIG_0003,
    });
    try {
      const r = verify(healthyInventory());
      expect(r.code).toBe(0);
      expect(r.out).not.toContain("ghost");
    } finally {
      writeMigrations({
        "0001_widgets.sql": MIG_0001,
        "0002_gadgets.sql": MIG_0002,
        "0003_later.sql": MIG_0003,
      });
    }
  });

  it("books cron jobs from a do-block and reports one that is not scheduled", () => {
    writeMigrations({
      "0001_widgets.sql": MIG_0001,
      "0002_gadgets.sql": MIG_0002,
      "0003_later.sql": `${MIG_0003}
do $$
begin
  perform cron.schedule('sweep-widgets', '* * * * *', 'select 1');
end
$$;
`,
    });
    try {
      const ok = verify(healthyInventory(), [], [
        { name: "sweep-widgets", schedule: "* * * * *", active: true },
      ]);
      expect(ok.code).toBe(0);

      const gone = verify(healthyInventory(), [], []);
      expect(gone.code).toBe(1);
      expect(gone.out).toContain("cron job 'sweep-widgets' is not scheduled");
    } finally {
      writeMigrations({
        "0001_widgets.sql": MIG_0001,
        "0002_gadgets.sql": MIG_0002,
        "0003_later.sql": MIG_0003,
      });
    }
  });

  it("never runs the dry-run against a database", () => {
    const dry = runNode(
      join(root, "scripts", "verify-migrations.mjs"),
      ["--dry-run"],
      root,
      { ...env, FAKE_LOG: join(root, "dry.log"), FAKE_INVENTORY: join(root, "nope.json") },
    );
    expect(dry.code).toBe(0);
    expect(dry.stdout).toContain("Parsed 3 migrations");
    expect(dry.stdout).toContain("No database was contacted.");
    expect(() => readFileSync(join(root, "dry.log"))).toThrow();
  });
});
