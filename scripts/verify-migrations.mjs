#!/usr/bin/env node
// Proves that every migration the database *says* it applied actually left its
// objects — and its security — behind.
//
// Why this exists
// ---------------
// On 2026-08-17, `supabase db push --yes` (CLI 2.109.1) printed "Finished
// supabase db push." and wrote a `supabase_migrations.schema_migrations` row
// for migration 0017 — statements and all — while the function and trigger that
// migration defines were never created on the server. Both sides then agreed
// the migration was applied, so it would never have been retried: the schema
// would simply have lacked the change forever. See docs/DATABASE-MIGRATIONS.md.
//
// A migration history row is a *claim*. This script checks the claim against
// the catalogue. It reads the SQL files, works out what each one is supposed to
// leave behind, and asks the live database whether it is there.
//
// Usage
//   node scripts/verify-migrations.mjs            # the linked (remote) project
//   node scripts/verify-migrations.mjs --local    # the local dev stack
//   node scripts/verify-migrations.mjs --all      # check every file, even
//                                                 # ones not yet applied
//   node scripts/verify-migrations.mjs --dry-run  # parse only; print what
//                                                 # would be checked and what
//                                                 # would not. No database.
//
// Exit code 0 = everything the database claims is really there and is still
// shaped the way the migration wrote it. 1 = something is missing or has
// drifted, and the report names it.
//
// What it verifies
// ----------------
// Presence, by name, of everything a migration creates: schemas, tables and
// their inline columns, added columns, views, functions, triggers, indexes,
// policies and types — cancelled by anything a later migration drops or
// renames. That was the whole of it until 2026-09-10; presence alone is blind
// to every shape a *security* regression takes, so it now also checks:
//
//   • Row level security — `relrowsecurity` and `relforcerowsecurity` for every
//     table a migration enables or forces it on. `alter table … enable row
//     level security` used to match no rule at all, so RLS being silently off
//     passed.
//   • Policy predicates — `pg_policies`' `USING` and `WITH CHECK` expressions,
//     normalised and compared against the SQL the migration wrote, plus the
//     command, the roles and permissive/restrictive. A policy rewritten to
//     `USING (true)` under the same name used to pass, and is now its own,
//     loudest failure.
//   • Policies an applied migration *dropped* that are still there.
//   • `prosecdef` — every function declared `security definer` must still be
//     one, and every function declared `security invoker` (0022's `pull_changes`
//     reads through RLS on purpose) must still not be.
//   • `proconfig` — every `set search_path` (0008, 0011, …) and `set timezone`
//     (0023) a function pins. A `create or replace` that omits a `SET` clause
//     silently drops it; 0019 and 0023 both warn about that in prose and
//     nothing checked it.
//   • Function identity signatures — argument types, not just the bare name, so
//     a changed signature is no longer indistinguishable from the old one.
//   • Function bodies, byte for byte, against the `$$…$$` in the migration.
//     This is the check docs/DATABASE-MIGRATIONS.md says db:verify does not
//     have: "a replaced function existed before the migration too, so it passes
//     whether or not the new body landed". It does not any more.
//   • EXECUTE privileges — every `revoke all on function … from public, anon,
//     authenticated` (0007, 0008, 0015, 0020, 0021, 0022, 0023) and the grants
//     beside them, read back through `aclexplode` so a null ACL — the default
//     of EXECUTE to PUBLIC, which is what a drop-and-recreate leaves behind —
//     is caught rather than read as "no grants".
//   • Table privileges — the explicit `grant select, insert, update, delete …`
//     lists, and, for every table a migration creates, that neither `anon` nor
//     `PUBLIC` holds SELECT or TRUNCATE on it.
//   • Trigger functions — which function each trigger actually calls.
//   • Realtime publication membership and `replica identity full`, both of
//     which live inside `do $$ … $$` blocks that the statement parser blanks.
//   • Extensions a migration creates, and the `cron.schedule` jobs it books.
//
// It also prints, advisory only, any *extra* policy sitting on a table a
// migration created — the shape a permissive rule added by hand in the
// dashboard would take. That is the one place extras are worth reporting:
// everything else in `public` has Supabase-managed neighbours and the noise
// would drown the signal.
//
// What it does NOT verify
// -----------------------
// Printed at the end of every run, so a reader never has to assume. Kept there
// rather than only here because a check nobody knows is missing is worse than
// no check at all. Summarised: column types, defaults, NOT NULL, constraints
// and generated expressions (`fts_doc` is redefined in 0011 and only its name
// is read here); index definitions, only names; trigger timing and events, only
// the function; function return types; schema-level grants; data backfills;
// storage bucket rows; Vault secrets; and any statement inside a `do $$ … $$`
// block other than the two shapes named above. Predicate comparison is
// parenthesis-insensitive and cast-insensitive — it catches a rewritten
// predicate, not a re-associated one.
//
// This is a smoke detector, not a schema differ. It parses the shapes our own
// migrations actually use. It deliberately does not understand arbitrary SQL.
// If it ever reports something it shouldn't, teach it the shape — don't delete
// the check.

import {
  readdirSync,
  readFileSync,
  writeFileSync,
  mkdtempSync,
  rmSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MIGRATIONS_DIR = join(REPO_ROOT, "supabase", "migrations");

const args = process.argv.slice(2);
const USE_LOCAL = args.includes("--local");
const CHECK_ALL = args.includes("--all");
const DRY_RUN = args.includes("--dry-run") || args.includes("--explain");

// ---------------------------------------------------------------------------
// 1. Reading SQL without being fooled by comments, strings, or $$ bodies
// ---------------------------------------------------------------------------

// Replace every comment, quoted string and dollar-quoted body with blanks of
// the same length. Offsets stay put, so line numbers survive — and so does the
// ability to find a span in the blanked text and then slice the *original* at
// the same offsets, which is how a policy predicate and a function body are
// recovered intact further down.
//
// `strings` and `dollar` are switchable because two things this script checks
// live inside a `do $$ … $$` block: `alter publication … add table` and
// `cron.schedule('name', 'schedule', …)`. Blanking comments only leaves both
// readable, and the job name is a string literal, so strings have to survive
// that pass too.
function blankOutNoise(sql, { strings = true, dollar = true } = {}) {
  const out = sql.split("");
  let i = 0;
  const blank = (from, to) => {
    for (let k = from; k < to && k < out.length; k++) {
      if (out[k] !== "\n") out[k] = " ";
    }
  };
  while (i < sql.length) {
    const two = sql.slice(i, i + 2);
    if (two === "--") {
      const end = sql.indexOf("\n", i);
      const stop = end === -1 ? sql.length : end;
      blank(i, stop);
      i = stop;
      continue;
    }
    if (two === "/*") {
      // Postgres block comments nest.
      let depth = 1;
      let k = i + 2;
      while (k < sql.length && depth > 0) {
        if (sql.slice(k, k + 2) === "/*") {
          depth++;
          k += 2;
        } else if (sql.slice(k, k + 2) === "*/") {
          depth--;
          k += 2;
        } else k++;
      }
      blank(i, k);
      i = k;
      continue;
    }
    if (sql[i] === "'" || sql[i] === '"') {
      const quote = sql[i];
      let k = i + 1;
      while (k < sql.length) {
        if (sql[k] === quote) {
          if (sql[k + 1] === quote) k += 2;
          else {
            k++;
            break;
          }
        } else k++;
      }
      // Keep double-quoted identifiers readable; only blank string literals.
      if (quote === "'" && strings) blank(i, k);
      i = k;
      continue;
    }
    if (sql[i] === "$" && dollar) {
      const tag = /^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/.exec(sql.slice(i));
      if (tag) {
        const marker = tag[0];
        const end = sql.indexOf(marker, i + marker.length);
        const stop = end === -1 ? sql.length : end + marker.length;
        blank(i, stop);
        i = stop;
        continue;
      }
    }
    i++;
  }
  return out.join("");
}

// Split on semicolons that are genuinely statement terminators. Runs on the
// blanked text, so semicolons inside function bodies are already gone.
//
// Three views of the same span come back, all the same length and sharing every
// offset, because each answers a question the others cannot:
//   `clean`   — comments, strings and $$ bodies blanked. What the rules match.
//   `raw`     — the file as written. Where a predicate or a body is sliced from.
//   `visible` — comments blanked and nothing else. The only one in which
//               `set timezone = 'UTC'` still says UTC and `as $$` still says
//               `$$`, which is what the function-header parser needs.
function splitStatements(blanked, original, visibleSql) {
  const visible =
    visibleSql ?? blankOutNoise(original, { strings: false, dollar: false });
  const parts = [];
  let start = 0;
  const push = (from, to) =>
    parts.push({
      clean: blanked.slice(from, to),
      raw: original.slice(from, to),
      visible: visible.slice(from, to),
    });
  for (let i = 0; i < blanked.length; i++) {
    if (blanked[i] === ";") {
      push(start, i);
      start = i + 1;
    }
  }
  if (start < blanked.length) push(start, blanked.length);
  return parts.filter((p) => p.clean.trim().length > 0);
}

// The closing parenthesis matching the one at `openIdx`. Runs on blanked text,
// so a parenthesis inside a string or a comment cannot unbalance it.
function balancedClose(clean, openIdx) {
  let depth = 0;
  for (let i = openIdx; i < clean.length; i++) {
    if (clean[i] === "(") depth++;
    else if (clean[i] === ")") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

// Find `<keyword> (` in the blanked statement and return the *original* text
// inside the parentheses. The blanked text locates it; the raw text is what
// comes back, because a predicate can contain a string literal ('files' in
// 0005) that blanking would have erased.
function clauseFromRaw(clean, raw, keywordRe) {
  const m = keywordRe.exec(clean);
  if (!m) return null;
  const open = clean.indexOf("(", m.index + m[0].length - 1);
  if (open === -1) return null;
  const close = balancedClose(clean, open);
  if (close === -1) return null;
  return raw.slice(open + 1, close);
}

// Split a parenthesised, comma-separated list at depth zero.
function splitTopLevel(text, sep = ",") {
  const items = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "(" || text[i] === "[") depth++;
    else if (text[i] === ")" || text[i] === "]") depth--;
    else if (text[i] === sep && depth === 0) {
      items.push(text.slice(start, i));
      start = i + 1;
    }
  }
  items.push(text.slice(start));
  return items.map((s) => s.trim()).filter((s) => s.length > 0);
}

// ---------------------------------------------------------------------------
// 2. Turning statements into expectations
// ---------------------------------------------------------------------------

// A bare word, a "quoted word", or schema.name in either style.
const IDENT = String.raw`(?:"[^"]+"|[A-Za-z_][A-Za-z0-9_$]*)`;
const QUALIFIED = String.raw`(?:${IDENT}\s*\.\s*)?${IDENT}`;

function unquote(word) {
  const w = word.trim();
  if (w.startsWith('"') && w.endsWith('"')) return w.slice(1, -1);
  return w.toLowerCase();
}

// "public.notes" -> { schema: "public", name: "notes" }. An unqualified name
// gets the default schema, which for everything we write is `public`.
function splitName(qualified, defaultSchema = "public") {
  const m = new RegExp(`^\\s*(${IDENT})\\s*\\.\\s*(${IDENT})\\s*$`).exec(
    qualified,
  );
  if (m) return { schema: unquote(m[1]), name: unquote(m[2]) };
  return { schema: defaultSchema, name: unquote(qualified) };
}

const KEY = {
  table: (o) => `table ${o.schema}.${o.name}`,
  column: (o) => `column ${o.schema}.${o.table}.${o.name}`,
  function: (o) => `function ${o.schema}.${o.name}`,
  trigger: (o) => `trigger ${o.schema}.${o.table}.${o.name}`,
  index: (o) => `index ${o.schema}.${o.name}`,
  view: (o) => `view ${o.schema}.${o.name}`,
  policy: (o) => `policy ${o.schema}.${o.table}.${o.name}`,
  type: (o) => `type ${o.schema}.${o.name}`,
  schema: (o) => `schema ${o.name}`,
};

// Words that start a *table constraint* rather than a column, inside a
// CREATE TABLE body. Anything beginning with one of these is skipped.
const TABLE_CONSTRAINT_WORDS = new Set([
  "constraint",
  "primary",
  "unique",
  "foreign",
  "check",
  "exclude",
  "like",
  "partition",
]);

// Pull the column names out of the top-level parentheses of a CREATE TABLE.
function columnsFromCreateTable(clean, schema, table) {
  const open = clean.indexOf("(");
  if (open === -1) return [];
  const close = balancedClose(clean, open);
  if (close === -1) return [];
  const cols = [];
  for (const item of splitTopLevel(clean.slice(open + 1, close))) {
    const first = /^\s*("[^"]+"|[A-Za-z_][A-Za-z0-9_$]*)/.exec(item);
    if (!first) continue;
    const name = unquote(first[1]);
    if (TABLE_CONSTRAINT_WORDS.has(name)) continue;
    cols.push({ kind: "column", schema, table, name });
  }
  return cols;
}

// Every rule is [regex, handler]. The handler returns { add: [...] } for
// things the statement creates and { remove: [...] } for things it destroys.
// `remove` also covers renames — the old key goes, the new key arrives.
const RULES = [
  // --- creates ---
  [
    new RegExp(
      `^\\s*create\\s+schema\\s+(?:if\\s+not\\s+exists\\s+)?(${IDENT})`,
      "i",
    ),
    (m) => ({ add: [{ kind: "schema", name: unquote(m[1]) }] }),
  ],
  [
    new RegExp(
      `^\\s*create\\s+(?:or\\s+replace\\s+)?(?:temp(?:orary)?\\s+|unlogged\\s+)?table\\s+(?:if\\s+not\\s+exists\\s+)?(${QUALIFIED})`,
      "i",
    ),
    (m, clean) => {
      const t = splitName(m[1]);
      return {
        add: [
          { kind: "table", ...t },
          ...columnsFromCreateTable(clean, t.schema, t.name),
        ],
      };
    },
  ],
  [
    new RegExp(
      `^\\s*create\\s+(?:or\\s+replace\\s+)?(?:materialized\\s+)?view\\s+(?:if\\s+not\\s+exists\\s+)?(${QUALIFIED})`,
      "i",
    ),
    (m) => ({ add: [{ kind: "view", ...splitName(m[1]) }] }),
  ],
  [
    new RegExp(
      `^\\s*create\\s+(?:or\\s+replace\\s+)?function\\s+(${QUALIFIED})\\s*\\(`,
      "i",
    ),
    (m) => ({ add: [{ kind: "function", ...splitName(m[1]) }] }),
  ],
  [
    new RegExp(
      `^\\s*create\\s+(?:or\\s+replace\\s+)?(?:constraint\\s+)?trigger\\s+(${IDENT})\\s+[\\s\\S]*?\\son\\s+(${QUALIFIED})`,
      "i",
    ),
    (m) => {
      const t = splitName(m[2]);
      return {
        add: [
          {
            kind: "trigger",
            schema: t.schema,
            table: t.name,
            name: unquote(m[1]),
          },
        ],
      };
    },
  ],
  [
    new RegExp(
      `^\\s*create\\s+(?:unique\\s+)?index\\s+(?:concurrently\\s+)?(?:if\\s+not\\s+exists\\s+)?(${IDENT})\\s+on\\s+(${QUALIFIED})`,
      "i",
    ),
    (m) => {
      // An index lives in its table's schema, whatever the bare name suggests.
      const t = splitName(m[2]);
      return {
        add: [
          {
            kind: "index",
            schema: t.schema,
            table: t.name,
            name: unquote(m[1]),
          },
        ],
      };
    },
  ],
  [
    new RegExp(
      `^\\s*create\\s+policy\\s+(${IDENT})\\s+on\\s+(${QUALIFIED})`,
      "i",
    ),
    (m) => {
      const t = splitName(m[2]);
      return {
        add: [
          {
            kind: "policy",
            schema: t.schema,
            table: t.name,
            name: unquote(m[1]),
          },
        ],
      };
    },
  ],
  [
    new RegExp(`^\\s*create\\s+type\\s+(${QUALIFIED})\\s+as\\b`, "i"),
    (m) => ({ add: [{ kind: "type", ...splitName(m[1]) }] }),
  ],
  [
    new RegExp(
      `^\\s*alter\\s+table\\s+(?:if\\s+exists\\s+)?(?:only\\s+)?(${QUALIFIED})\\s+add\\s+column\\s+(?:if\\s+not\\s+exists\\s+)?(${IDENT})`,
      "i",
    ),
    (m) => {
      const t = splitName(m[1]);
      return {
        add: [
          {
            kind: "column",
            schema: t.schema,
            table: t.name,
            name: unquote(m[2]),
          },
        ],
      };
    },
  ],

  // --- drops and renames ---
  [
    new RegExp(`^\\s*drop\\s+schema\\s+(?:if\\s+exists\\s+)?(${IDENT})`, "i"),
    (m) => ({ remove: [{ kind: "schema", name: unquote(m[1]) }] }),
  ],
  [
    new RegExp(
      `^\\s*drop\\s+table\\s+(?:if\\s+exists\\s+)?(${QUALIFIED})`,
      "i",
    ),
    (m) => ({ removeTable: splitName(m[1]) }),
  ],
  [
    new RegExp(
      `^\\s*drop\\s+(?:materialized\\s+)?view\\s+(?:if\\s+exists\\s+)?(${QUALIFIED})`,
      "i",
    ),
    (m) => ({ remove: [{ kind: "view", ...splitName(m[1]) }] }),
  ],
  [
    new RegExp(
      `^\\s*drop\\s+function\\s+(?:if\\s+exists\\s+)?(${QUALIFIED})`,
      "i",
    ),
    (m) => ({ remove: [{ kind: "function", ...splitName(m[1]) }] }),
  ],
  [
    new RegExp(
      `^\\s*drop\\s+trigger\\s+(?:if\\s+exists\\s+)?(${IDENT})\\s+on\\s+(${QUALIFIED})`,
      "i",
    ),
    (m) => {
      const t = splitName(m[2]);
      return {
        remove: [
          {
            kind: "trigger",
            schema: t.schema,
            table: t.name,
            name: unquote(m[1]),
          },
        ],
      };
    },
  ],
  [
    new RegExp(
      `^\\s*drop\\s+index\\s+(?:concurrently\\s+)?(?:if\\s+exists\\s+)?(${QUALIFIED})`,
      "i",
    ),
    (m) => ({ remove: [{ kind: "index", ...splitName(m[1]) }] }),
  ],
  [
    new RegExp(
      `^\\s*drop\\s+policy\\s+(?:if\\s+exists\\s+)?(${IDENT})\\s+on\\s+(${QUALIFIED})`,
      "i",
    ),
    (m) => {
      const t = splitName(m[2]);
      return {
        remove: [
          {
            kind: "policy",
            schema: t.schema,
            table: t.name,
            name: unquote(m[1]),
          },
        ],
      };
    },
  ],
  [
    new RegExp(`^\\s*drop\\s+type\\s+(?:if\\s+exists\\s+)?(${QUALIFIED})`, "i"),
    (m) => ({ remove: [{ kind: "type", ...splitName(m[1]) }] }),
  ],
  [
    new RegExp(
      `^\\s*alter\\s+table\\s+(?:if\\s+exists\\s+)?(?:only\\s+)?(${QUALIFIED})\\s+drop\\s+column\\s+(?:if\\s+exists\\s+)?(${IDENT})`,
      "i",
    ),
    (m) => {
      const t = splitName(m[1]);
      return {
        remove: [
          {
            kind: "column",
            schema: t.schema,
            table: t.name,
            name: unquote(m[2]),
          },
        ],
      };
    },
  ],
  [
    new RegExp(
      `^\\s*alter\\s+table\\s+(?:if\\s+exists\\s+)?(?:only\\s+)?(${QUALIFIED})\\s+rename\\s+(?:column\\s+)?(${IDENT})\\s+to\\s+(${IDENT})`,
      "i",
    ),
    (m) => {
      const t = splitName(m[1]);
      return {
        remove: [
          {
            kind: "column",
            schema: t.schema,
            table: t.name,
            name: unquote(m[2]),
          },
        ],
        add: [
          {
            kind: "column",
            schema: t.schema,
            table: t.name,
            name: unquote(m[3]),
          },
        ],
      };
    },
  ],
  [
    new RegExp(
      `^\\s*alter\\s+table\\s+(?:if\\s+exists\\s+)?(?:only\\s+)?(${QUALIFIED})\\s+rename\\s+to\\s+(${IDENT})`,
      "i",
    ),
    (m) => {
      const from = splitName(m[1]);
      return {
        renameTable: { from, to: { schema: from.schema, name: unquote(m[2]) } },
      };
    },
  ],
  [
    new RegExp(
      `^\\s*alter\\s+index\\s+(?:if\\s+exists\\s+)?(${QUALIFIED})\\s+rename\\s+to\\s+(${IDENT})`,
      "i",
    ),
    (m) => {
      const from = splitName(m[1]);
      return {
        remove: [{ kind: "index", ...from }],
        add: [{ kind: "index", schema: from.schema, name: unquote(m[2]) }],
      };
    },
  ],
];

// Walk one migration file and fold its statements into the running expectation
// set. Order matters: a drop in 0016 must cancel a create from 0005.
function applyFile(expected, statements, version) {
  for (const { clean } of statements) {
    for (const [re, handler] of RULES) {
      const m = re.exec(clean);
      if (!m) continue;
      const result = handler(m, clean) || {};
      if (result.removeTable) {
        const { schema, name } = result.removeTable;
        for (const key of [...expected.keys()]) {
          const o = expected.get(key).object;
          const belongsToTable =
            (o.kind === "table" && o.schema === schema && o.name === name) ||
            (o.table === name && o.schema === schema);
          if (belongsToTable) expected.delete(key);
        }
      }
      if (result.renameTable) {
        const { from, to } = result.renameTable;
        for (const key of [...expected.keys()]) {
          const o = expected.get(key).object;
          if (
            o.kind === "table" &&
            o.schema === from.schema &&
            o.name === from.name
          ) {
            expected.delete(key);
            const moved = { ...o, name: to.name };
            expected.set(KEY.table(moved), { object: moved, version });
          } else if (o.table === from.name && o.schema === from.schema) {
            expected.delete(key);
            const moved = { ...o, table: to.name };
            expected.set(KEY[o.kind](moved), { object: moved, version });
          }
        }
      }
      for (const o of result.remove || []) expected.delete(KEY[o.kind](o));
      for (const o of result.add || [])
        expected.set(KEY[o.kind](o), { object: o, version });
      break; // first matching rule wins
    }
  }
}

// ---------------------------------------------------------------------------
// 2b. Turning statements into *attribute* expectations
// ---------------------------------------------------------------------------
//
// Presence is a Map of key -> the one current expectation, because an object
// either exists or does not. An attribute is different: it accumulates. 0002
// declares `set_note_embedding` security definer with no pinned search_path;
// 0008 pins one with `alter function`; 0007 revokes the execute 0002 granted.
// So each key carries an ordered *list* of snapshots, one per migration that
// touched it, and the check reads the last snapshot whose migration the
// database says it applied. Without that, a not-yet-applied 0023 would be
// checked against nothing rather than against 0020.

function newState() {
  return {
    rls: new Map(), // schema.table -> { enabled, forced, replica }
    policy: new Map(), // schema.table.name -> { dropped, cmd, roles, ... }
    func: new Map(), // schema.name(argtypes) -> { secdef, settings, body, acl }
    tableGrant: new Map(), // schema.table -> { role -> Set(priv) }
    trigger: new Map(), // schema.table.name -> { fnSchema, fnName }
    publication: new Map(), // pub.schema.table -> true
    extension: new Map(), // name -> true
    cron: new Map(), // job name -> schedule
  };
}

const DETAIL_KINDS = [
  "rls",
  "policy",
  "func",
  "tableGrant",
  "trigger",
  "publication",
  "extension",
  "cron",
];

function newHistory() {
  const h = {};
  for (const k of DETAIL_KINDS) h[k] = new Map();
  return h;
}

// Postgres reports argument and column types in its own canonical spelling.
// The migrations write the short aliases, so one side has to move.
const TYPE_ALIASES = new Map([
  ["timestamptz", "timestamp with time zone"],
  ["timestamp", "timestamp without time zone"],
  ["timetz", "time with time zone"],
  ["time", "time without time zone"],
  ["int", "integer"],
  ["int4", "integer"],
  ["int2", "smallint"],
  ["int8", "bigint"],
  ["bool", "boolean"],
  ["float4", "real"],
  ["float8", "double precision"],
  ["varchar", "character varying"],
  ["char", "character"],
  ["decimal", "numeric"],
]);

function canonicalType(text) {
  let t = text.trim().toLowerCase().replace(/\s+/g, " ");
  let suffix = "";
  const arr = /((?:\s*\[\s*\d*\s*\])+)$/.exec(t);
  if (arr) {
    suffix = "[]".repeat(arr[1].split("[").length - 1);
    t = t.slice(0, arr.index).trim();
  }
  // A length or precision is part of the type but never part of a signature we
  // write, so it is kept verbatim rather than guessed at.
  const base = t.replace(/\s*\(\s*/g, "(").replace(/\s*\)\s*/g, ")");
  return (TYPE_ALIASES.get(base) || base) + suffix;
}

// `p_grace interval default interval '1 day'` -> "interval".
// `uuid, jsonb` (as written in a REVOKE) -> ["uuid", "jsonb"].
// Returns null when the list holds something this parser cannot read, so the
// caller can say "not checked" rather than guess a signature.
function parseArgTypes(inside) {
  const text = inside.trim();
  if (text === "") return [];
  const types = [];
  for (const rawItem of splitTopLevel(text)) {
    let item = rawItem.replace(/\s+default\s+[\s\S]*$/i, "");
    item = item.replace(/\s*=\s*[\s\S]*$/, "");
    item = item.replace(/^\s*(in|out|inout|variadic)\s+/i, "");
    item = item.trim();
    if (!item) return null;
    const tokens = item.split(/\s+/);
    // One token is a bare type (how a REVOKE names a signature); more than one
    // is `name type`, and the type may itself be several words.
    const typeText = tokens.length === 1 ? item : tokens.slice(1).join(" ");
    if (!typeText) return null;
    types.push(canonicalType(typeText));
  }
  return types;
}

function funcKey(schema, name, argTypes) {
  return `${schema}.${name}(${argTypes.join(",")})`;
}

// The `$$…$$` body of a CREATE FUNCTION, taken from the original text. The last
// `as $tag$` in the statement is the body: a header comment above it may say
// "as $$" in prose, and nothing follows the body but the terminator.
function functionBody(raw) {
  const re = /\bas\s*(\$[A-Za-z_0-9]*\$)/gi;
  let last = null;
  let m;
  while ((m = re.exec(raw)) !== null) last = m;
  if (!last) return null;
  const tag = last[1];
  const from = last.index + last[0].length;
  const end = raw.indexOf(tag, from);
  if (end === -1) return null;
  return raw.slice(from, end);
}

// CRLF is the one difference that is never a real one: this checkout has
// `core.autocrlf=true` on the PC and LF on the server, and whichever machine
// pushed is what Postgres stored.
function normalizeBody(text) {
  return text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/, ""))
    .join("\n")
    .trim();
}

// Bring a policy predicate to a form both sides can be compared in. Postgres
// re-prints a stored expression its own way: it adds parentheses everywhere,
// aliases a scalar subquery (`( SELECT auth.uid() AS uid)`), drops a schema
// qualification that the search_path covers, and adds casts. None of those is a
// change to the rule, so all of them go.
//
// The cost, stated plainly because it is the one thing this check gives up:
// removing parentheses means `a and (b or c)` and `(a and b) or c` normalise
// alike. It catches a predicate that was *rewritten*, which is the regression
// this exists for; it does not catch one that was merely re-associated.
function normalizePredicate(text) {
  if (text === null || text === undefined) return null;
  let s = blankOutNoise(text, { strings: false, dollar: false });
  s = s.toLowerCase();
  s = s.replace(/\s+as\s+[a-z_][a-z0-9_]*/g, ""); // ( select auth.uid() as uid)
  s = s.replace(
    /::\s*(?:double\s+precision|(?:time|timestamp)(?:\s*\(\d+\))?\s+with(?:out)?\s+time\s+zone|character\s+varying(?:\s*\(\d+\))?|"?[a-z_][a-z0-9_]*"?(?:\s*\(\d+(?:\s*,\s*\d+)?\))?)(\s*\[\s*\])*/g,
    "",
  ); // casts
  s = s.replace(/\bpublic\./g, ""); // search_path makes this invisible
  s = s.replace(/!=/g, "<>");
  s = s.replace(/[()]/g, "");
  s = s.replace(/\s+/g, "");
  return s;
}

// A predicate that means "everybody, always". `USING (true)` under an unchanged
// name is the headline regression this whole section exists to catch, so it is
// recognised on its own rather than only as "differs".
function isAlwaysTrue(normalized) {
  return normalized === "true";
}

const ROLE_LIST = String.raw`(?:${IDENT}|public|current_user|session_user)`;

function parseRoles(text) {
  return splitTopLevel(text).map((r) => unquote(r));
}

function ensure(map, key, make) {
  if (!map.has(key)) map.set(key, make());
  return map.get(key);
}

// One migration file's contribution to the attribute expectations. Mutates
// `state`, and records which keys it touched so a snapshot can be taken.
function applyDetailFile(state, statements, rawSql, version, notes) {
  const touched = {};
  for (const k of DETAIL_KINDS) touched[k] = new Set();
  const mark = (kind, key) => touched[kind].add(key);

  for (const { clean, raw, visible } of statements) {
    // --- row level security, and replica identity -------------------------
    let m = new RegExp(
      `^\\s*alter\\s+table\\s+(?:if\\s+exists\\s+)?(?:only\\s+)?(${QUALIFIED})\\s+(enable|disable|force|no\\s+force)\\s+row\\s+level\\s+security`,
      "i",
    ).exec(clean);
    if (m) {
      const t = splitName(m[1]);
      const key = `${t.schema}.${t.name}`;
      const e = ensure(state.rls, key, () => ({
        enabled: null,
        forced: null,
        replica: null,
      }));
      const verb = m[2].toLowerCase().replace(/\s+/g, " ");
      if (verb === "enable") e.enabled = true;
      else if (verb === "disable") e.enabled = false;
      else if (verb === "force") e.forced = true;
      else if (verb === "no force") e.forced = false;
      mark("rls", key);
      continue;
    }
    m = new RegExp(
      `^\\s*alter\\s+table\\s+(?:if\\s+exists\\s+)?(?:only\\s+)?(${QUALIFIED})\\s+replica\\s+identity\\s+(default|full|nothing)`,
      "i",
    ).exec(clean);
    if (m) {
      const t = splitName(m[1]);
      const key = `${t.schema}.${t.name}`;
      const e = ensure(state.rls, key, () => ({
        enabled: null,
        forced: null,
        replica: null,
      }));
      e.replica = { default: "d", full: "f", nothing: "n" }[
        m[2].toLowerCase()
      ];
      mark("rls", key);
      continue;
    }

    // --- policies ----------------------------------------------------------
    m = new RegExp(
      `^\\s*create\\s+policy\\s+(${IDENT})\\s+on\\s+(${QUALIFIED})`,
      "i",
    ).exec(clean);
    if (m) {
      const t = splitName(m[2]);
      const key = `${t.schema}.${t.name}.${unquote(m[1])}`;
      const tailStart = m.index + m[0].length;
      const usingRe = /\busing\s*\(/i;
      const checkRe = /\bwith\s+check\s*\(/i;
      const u = usingRe.exec(clean.slice(tailStart));
      const c = checkRe.exec(clean.slice(tailStart));
      const firstClause = Math.min(
        u ? tailStart + u.index : clean.length,
        c ? tailStart + c.index : clean.length,
      );
      const head = clean.slice(tailStart, firstClause);
      const cmdM = /\bfor\s+(all|select|insert|update|delete)\b/i.exec(head);
      const permM = /\bas\s+(permissive|restrictive)\b/i.exec(head);
      const rolesM = new RegExp(
        `\\bto\\s+(${ROLE_LIST}(?:\\s*,\\s*${ROLE_LIST})*)`,
        "i",
      ).exec(head);
      state.policy.set(key, {
        dropped: false,
        cmd: cmdM ? cmdM[1].toLowerCase() : "all",
        permissive: permM ? permM[1].toLowerCase() === "permissive" : true,
        roles: rolesM ? parseRoles(rolesM[1]).sort() : ["public"],
        using: clauseFromRaw(clean, raw, usingRe),
        check: clauseFromRaw(clean, raw, checkRe),
      });
      mark("policy", key);
      continue;
    }
    m = new RegExp(
      `^\\s*drop\\s+policy\\s+(?:if\\s+exists\\s+)?(${IDENT})\\s+on\\s+(${QUALIFIED})`,
      "i",
    ).exec(clean);
    if (m) {
      const t = splitName(m[2]);
      const key = `${t.schema}.${t.name}.${unquote(m[1])}`;
      state.policy.set(key, { dropped: true });
      mark("policy", key);
      continue;
    }

    // --- functions: signature, attributes, body ----------------------------
    m = new RegExp(
      `^\\s*create\\s+(?:or\\s+replace\\s+)?function\\s+(${QUALIFIED})\\s*\\(`,
      "i",
    ).exec(clean);
    if (m) {
      const f = splitName(m[1]);
      const open = clean.indexOf("(", m.index + m[0].length - 1);
      const close = balancedClose(clean, open);
      const argTypes =
        close === -1 ? null : parseArgTypes(clean.slice(open + 1, close));
      if (argTypes === null) {
        notes.push(
          `${version}: could not read the argument list of ${f.schema}.${f.name} — its signature, attributes and body are not checked.`,
        );
        continue;
      }
      const key = funcKey(f.schema, f.name, argTypes);
      // The header — everything between the closing paren and the body — is
      // where `security definer` and every `SET` clause live. Read from
      // `visible`: 0020 puts a comment in the middle of it, so comments have to
      // be gone, and 0023 pins `set timezone = 'UTC'`, so string literals have
      // to still be there. `clean` would hand back an empty value for that one
      // and quietly assert nothing.
      const bodyAt = /\bas\s*\$/i.exec(visible.slice(close));
      const header = visible.slice(
        close,
        bodyAt ? close + bodyAt.index : visible.length,
      );
      const settings = {};
      const setRe = /\bset\s+([a-z_][a-z0-9_.]*)\s*(?:=|\bto\b)\s*([^\n;]*)/gi;
      let s;
      while ((s = setRe.exec(header)) !== null) {
        settings[s[1].toLowerCase()] = normalizeSetting(s[2]);
      }
      const body = functionBody(raw);
      if (body === null) {
        notes.push(
          `${version}: could not locate the $$…$$ body of ${f.schema}.${f.name} — its body is not compared.`,
        );
      }
      state.func.set(key, {
        dropped: false,
        schema: f.schema,
        name: f.name,
        argTypes,
        // `security definer` is a declaration; its absence means invoker, which
        // is the safe default and is asserted in that direction too — 0022's
        // `pull_changes` must stay invoker or it stops obeying RLS.
        secdef: /\bsecurity\s+definer\b/i.test(header),
        settings,
        body: body === null ? null : normalizeBody(body),
        acl: state.func.get(key)?.acl || { must: new Set(), mustNot: new Set() },
      });
      mark("func", key);
      continue;
    }
    m = new RegExp(
      `^\\s*drop\\s+function\\s+(?:if\\s+exists\\s+)?(${QUALIFIED})\\s*\\(`,
      "i",
    ).exec(clean);
    if (m) {
      const f = splitName(m[1]);
      const open = clean.indexOf("(", m.index + m[0].length - 1);
      const close = balancedClose(clean, open);
      const argTypes =
        close === -1 ? null : parseArgTypes(clean.slice(open + 1, close));
      if (argTypes !== null) {
        const key = funcKey(f.schema, f.name, argTypes);
        state.func.set(key, { dropped: true });
        mark("func", key);
      }
      continue;
    }
    // `alter function … set search_path = …` (0008). Merges into whatever the
    // last create left, which is exactly what Postgres does.
    m = new RegExp(
      `^\\s*alter\\s+function\\s+(${QUALIFIED})\\s*\\(`,
      "i",
    ).exec(clean);
    if (m) {
      const f = splitName(m[1]);
      const open = clean.indexOf("(", m.index + m[0].length - 1);
      const close = balancedClose(clean, open);
      const argTypes =
        close === -1 ? null : parseArgTypes(clean.slice(open + 1, close));
      const tail = close === -1 ? "" : visible.slice(close + 1);
      const setM = /\bset\s+([a-z_][a-z0-9_.]*)\s*(?:=|\bto\b)\s*([\s\S]*)$/i.exec(
        tail,
      );
      if (argTypes !== null && setM) {
        const key = funcKey(f.schema, f.name, argTypes);
        const e = state.func.get(key);
        if (e && !e.dropped) {
          e.settings[setM[1].toLowerCase()] = normalizeSetting(setM[2]);
          mark("func", key);
        } else {
          notes.push(
            `${version}: \`alter function ${f.schema}.${f.name}\` names a signature no create in these files declares — its settings are not checked.`,
          );
        }
      }
      continue;
    }

    // --- privileges on functions -------------------------------------------
    m = new RegExp(
      `^\\s*(grant|revoke)\\s+([\\s\\S]+?)\\s+on\\s+function\\s+(${QUALIFIED})\\s*\\(`,
      "i",
    ).exec(clean);
    if (m) {
      const verb = m[1].toLowerCase();
      const f = splitName(m[3]);
      const open = clean.indexOf("(", m.index + m[0].length - 1);
      const close = balancedClose(clean, open);
      const argTypes =
        close === -1 ? null : parseArgTypes(clean.slice(open + 1, close));
      const tail = close === -1 ? "" : clean.slice(close + 1);
      const rolesM = new RegExp(
        `\\b(?:to|from)\\s+(${ROLE_LIST}(?:\\s*,\\s*${ROLE_LIST})*)`,
        "i",
      ).exec(tail);
      if (argTypes === null || !rolesM) {
        notes.push(
          `${version}: could not read a ${verb} on function ${f.schema}.${f.name} — its EXECUTE privileges are not checked.`,
        );
        continue;
      }
      const key = funcKey(f.schema, f.name, argTypes);
      const e = ensure(state.func, key, () => ({
        dropped: false,
        schema: f.schema,
        name: f.name,
        argTypes,
        secdef: false,
        settings: {},
        acl: { must: new Set(), mustNot: new Set() },
      }));
      if (!e.acl) e.acl = { must: new Set(), mustNot: new Set() };
      for (const role of parseRoles(rolesM[1])) {
        if (verb === "grant") {
          e.acl.must.add(role);
          e.acl.mustNot.delete(role);
        } else {
          e.acl.mustNot.add(role);
          e.acl.must.delete(role);
        }
      }
      mark("func", key);
      continue;
    }

    // --- privileges on schemas: parsed only so they can be reported unread --
    m = /^\s*(grant|revoke)\s+[\s\S]+?\s+on\s+schema\s+([\s\S]+)$/i.exec(clean);
    if (m) {
      notes.push(
        `${version}: schema-level privileges (\`${m[1].toLowerCase()} … on schema …\`) are not read back.`,
      );
      continue;
    }

    // --- privileges on tables ----------------------------------------------
    m = new RegExp(
      `^\\s*(grant|revoke)\\s+([\\s\\S]+?)\\s+on\\s+(?:table\\s+)?(${QUALIFIED})\\s+(?:to|from)\\s+([\\s\\S]+)$`,
      "i",
    ).exec(clean);
    if (m) {
      const verb = m[1].toLowerCase();
      const privs = splitTopLevel(m[2]).map((p) =>
        p.trim().toUpperCase().replace(/\s+/g, " "),
      );
      const t = splitName(m[3]);
      const key = `${t.schema}.${t.name}`;
      if (privs.some((p) => p.startsWith("ALL"))) {
        notes.push(
          `${version}: \`${verb} all … on ${key}\` is not expanded into a privilege list — that table's grants are not checked.`,
        );
        continue;
      }
      const e = ensure(state.tableGrant, key, () => ({}));
      for (const role of parseRoles(m[4])) {
        const held = (e[role] = e[role] || new Set());
        for (const p of privs) {
          if (verb === "grant") held.add(p);
          else held.delete(p);
        }
      }
      mark("tableGrant", key);
      continue;
    }

    // --- triggers: which function do they call ------------------------------
    m = new RegExp(
      `^\\s*create\\s+(?:or\\s+replace\\s+)?(?:constraint\\s+)?trigger\\s+(${IDENT})\\s+([\\s\\S]*?)\\son\\s+(${QUALIFIED})([\\s\\S]*)$`,
      "i",
    ).exec(clean);
    if (m) {
      const t = splitName(m[3]);
      const key = `${t.schema}.${t.name}.${unquote(m[1])}`;
      const fnM = new RegExp(
        `\\bexecute\\s+(?:function|procedure)\\s+(${QUALIFIED})`,
        "i",
      ).exec(m[4]);
      if (fnM) {
        state.trigger.set(key, { fn: splitName(fnM[1]) });
        mark("trigger", key);
      }
      continue;
    }
    m = new RegExp(
      `^\\s*drop\\s+trigger\\s+(?:if\\s+exists\\s+)?(${IDENT})\\s+on\\s+(${QUALIFIED})`,
      "i",
    ).exec(clean);
    if (m) {
      const t = splitName(m[2]);
      const key = `${t.schema}.${t.name}.${unquote(m[1])}`;
      // A null snapshot, not a deletion: 0016 drops `trg_notes_mark_user_fields`
      // and never brings it back, and the history has to carry that forward or
      // the check would keep asserting a trigger the schema deliberately lost.
      state.trigger.set(key, null);
      mark("trigger", key);
      continue;
    }

    // --- extensions ---------------------------------------------------------
    m = new RegExp(
      `^\\s*create\\s+extension\\s+(?:if\\s+not\\s+exists\\s+)?(${IDENT})`,
      "i",
    ).exec(clean);
    if (m) {
      const key = unquote(m[1]);
      state.extension.set(key, true);
      mark("extension", key);
      continue;
    }
  }

  // Two things worth checking live inside `do $$ … $$` blocks, which the
  // statement parser blanks wholesale. They are read off the file with comments
  // — and only comments — blanked, because `cron.schedule` names its job in a
  // string literal.
  const visible = blankOutNoise(rawSql, { strings: false, dollar: false });
  const pubRe = new RegExp(
    `alter\\s+publication\\s+(${IDENT})\\s+add\\s+table\\s+(?:only\\s+)?(${QUALIFIED})`,
    "gi",
  );
  let p;
  while ((p = pubRe.exec(visible)) !== null) {
    const t = splitName(p[2]);
    const key = `${unquote(p[1])}.${t.schema}.${t.name}`;
    state.publication.set(key, true);
    touched.publication.add(key);
  }
  const cronRe = /cron\.schedule\s*\(\s*'([^']+)'\s*,\s*'([^']+)'/gi;
  let c;
  while ((c = cronRe.exec(visible)) !== null) {
    state.cron.set(c[1], c[2]);
    touched.cron.add(c[1]);
  }

  return touched;
}

// `set search_path = public, pg_temp` -> "public,pg_temp"; `set timezone =
// 'UTC'` -> "utc". Postgres stores a function's SET clauses in `proconfig` as
// `name=value`, list items separated by ", ", so both sides are flattened the
// same way.
function normalizeSetting(value) {
  return value
    .trim()
    .replace(/;+\s*$/, "")
    .replace(/^'(.*)'$/s, "$1")
    .replace(/^"(.*)"$/s, "$1")
    .split(",")
    .map((v) => v.trim().replace(/^'(.*)'$/s, "$1").toLowerCase())
    .filter((v) => v.length > 0)
    .join(",");
}

function snapshot(history, state, touched, version) {
  for (const kind of DETAIL_KINDS) {
    for (const key of touched[kind]) {
      const value = state[kind].get(key);
      const list = ensure(history[kind], key, () => []);
      list.push({ version, value: value === undefined ? null : clone(value) });
    }
  }
}

function clone(value) {
  return typeof structuredClone === "function"
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}

// The last snapshot the database says it applied. `--all` takes the last one
// whatever the history row says.
function currentFor(list, applied) {
  for (let i = list.length - 1; i >= 0; i--) {
    if (CHECK_ALL || applied.has(list[i].version)) return list[i];
  }
  return null;
}

// ---------------------------------------------------------------------------
// 3. Asking the database what it actually has
// ---------------------------------------------------------------------------

function runQuery(sql) {
  const dir = mkdtempSync(join(tmpdir(), "spar-verify-"));
  const file = join(dir, "q.sql");
  writeFileSync(file, sql, "utf8");
  try {
    const target = USE_LOCAL ? [] : ["--linked"];
    const res = spawnSync(
      "npx",
      ["--no-install", "supabase", "db", "query", ...target, "--file", file],
      {
        cwd: REPO_ROOT,
        encoding: "utf8",
        shell: true,
        maxBuffer: 256 * 1024 * 1024,
      },
    );
    const text = `${res.stdout || ""}${res.stderr || ""}`;
    // The CLI wraps its JSON in chatter — a "Connecting to..." line before and
    // sometimes an upgrade notice after — so take the first balanced object.
    const start = text.indexOf("{");
    if (start === -1) {
      throw new Error(`supabase db query returned no JSON.\n${text.trim()}`);
    }
    let depth = 0;
    let end = -1;
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
        end = i + 1;
        break;
      }
    }
    if (end === -1)
      throw new Error(
        `supabase db query output was truncated.\n${text.trim()}`,
      );
    let parsed;
    try {
      parsed = JSON.parse(text.slice(start, end));
    } catch {
      throw new Error(
        `could not parse supabase db query output.\n${text.trim()}`,
      );
    }
    if (!parsed.rows || parsed.rows.length === 0) {
      throw new Error(`supabase db query returned no rows.\n${text.trim()}`);
    }
    return parsed.rows[0];
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const SAFE_IDENT = /^[a-z_][a-z0-9_]*$/;

function inventoryQuery(schemas, funcNames) {
  const list = schemas.map((s) => `'${s}'`).join(", ");
  const fnList = funcNames.length
    ? funcNames.map((s) => `'${s}'`).join(", ")
    : "''";
  // One statement: `db query` runs through a prepared statement and refuses
  // more than one command per file.
  //
  // Privileges are read through `aclexplode(coalesce(acl, acldefault(…)))`
  // rather than off `relacl`/`proacl` directly, because a null ACL is not "no
  // grants" — it is the *default*, which for a function is EXECUTE to PUBLIC.
  // A function dropped and recreated without its revokes has a null proacl and
  // is wide open, and reading the column raw would call that clean.
  return `select json_build_object(
  'applied', (select coalesce(json_agg(version order by version), '[]'::json) from supabase_migrations.schema_migrations),
  'schemas', (select coalesce(json_agg(nspname), '[]'::json) from pg_namespace),
  'tables', (select coalesce(json_agg(n.nspname || '.' || c.relname), '[]'::json)
             from pg_class c join pg_namespace n on n.oid = c.relnamespace
             where c.relkind in ('r','p','f') and n.nspname in (${list})),
  'views', (select coalesce(json_agg(n.nspname || '.' || c.relname), '[]'::json)
            from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where c.relkind in ('v','m') and n.nspname in (${list})),
  'columns', (select coalesce(json_agg(n.nspname || '.' || c.relname || '.' || a.attname), '[]'::json)
              from pg_attribute a join pg_class c on c.oid = a.attrelid
              join pg_namespace n on n.oid = c.relnamespace
              where a.attnum > 0 and not a.attisdropped
                and c.relkind in ('r','p','f','v','m') and n.nspname in (${list})),
  'functions', (select coalesce(json_agg(distinct n.nspname || '.' || p.proname), '[]'::json)
                from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                where n.nspname in (${list})),
  'triggers', (select coalesce(json_agg(n.nspname || '.' || c.relname || '.' || t.tgname), '[]'::json)
               from pg_trigger t join pg_class c on c.oid = t.tgrelid
               join pg_namespace n on n.oid = c.relnamespace
               where not t.tgisinternal and n.nspname in (${list})),
  'indexes', (select coalesce(json_agg(n.nspname || '.' || c.relname), '[]'::json)
              from pg_class c join pg_namespace n on n.oid = c.relnamespace
              where c.relkind in ('i','I') and n.nspname in (${list})),
  'policies', (select coalesce(json_agg(n.nspname || '.' || c.relname || '.' || pol.polname), '[]'::json)
               from pg_policy pol join pg_class c on c.oid = pol.polrelid
               join pg_namespace n on n.oid = c.relnamespace
               where n.nspname in (${list})),
  'types', (select coalesce(json_agg(distinct n.nspname || '.' || t.typname), '[]'::json)
            from pg_type t join pg_namespace n on n.oid = t.typnamespace
            where n.nspname in (${list})),

  'rls', (select coalesce(json_agg(json_build_object(
             'key', n.nspname || '.' || c.relname,
             'enabled', c.relrowsecurity,
             'forced', c.relforcerowsecurity,
             'replica', c.relreplident)), '[]'::json)
          from pg_class c join pg_namespace n on n.oid = c.relnamespace
          where c.relkind in ('r','p') and n.nspname in (${list})),

  'policy_detail', (select coalesce(json_agg(json_build_object(
             'key', n.nspname || '.' || c.relname || '.' || pol.polname,
             'table', n.nspname || '.' || c.relname,
             'cmd', case pol.polcmd when 'r' then 'select' when 'a' then 'insert'
                                    when 'w' then 'update' when 'd' then 'delete'
                                    else 'all' end,
             'permissive', pol.polpermissive,
             'roles', (select coalesce(array_agg(case when r = 0 then 'public'
                                                      else pg_get_userbyid(r) end), '{}'::text[])
                         from unnest(pol.polroles) r),
             'using', pg_get_expr(pol.polqual, pol.polrelid),
             'check', pg_get_expr(pol.polwithcheck, pol.polrelid))), '[]'::json)
          from pg_policy pol join pg_class c on c.oid = pol.polrelid
          join pg_namespace n on n.oid = c.relnamespace
          where n.nspname in (${list})),

  'function_detail', (select coalesce(json_agg(json_build_object(
             'schema', n.nspname,
             'name', p.proname,
             'argtypes', (select coalesce(string_agg(format_type(u.t, null::integer), ',' order by u.ord), '')
                            from unnest(p.proargtypes::oid[]) with ordinality as u(t, ord)),
             'secdef', p.prosecdef,
             'config', coalesce(p.proconfig, '{}'::text[]),
             'src', p.prosrc,
             'execute_roles', (select coalesce(array_agg(distinct case when a.grantee = 0 then 'public'
                                                                       else pg_get_userbyid(a.grantee) end), '{}'::text[])
                                 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                                where a.privilege_type = 'EXECUTE'))), '[]'::json)
          from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname in (${list}) and p.proname in (${fnList})),

  'trigger_detail', (select coalesce(json_agg(json_build_object(
             'key', n.nspname || '.' || c.relname || '.' || t.tgname,
             'fn', fn.nspname || '.' || fp.proname)), '[]'::json)
          from pg_trigger t join pg_class c on c.oid = t.tgrelid
          join pg_namespace n on n.oid = c.relnamespace
          join pg_proc fp on fp.oid = t.tgfoid
          join pg_namespace fn on fn.oid = fp.pronamespace
          where not t.tgisinternal and n.nspname in (${list})),

  'table_acl', (select coalesce(json_agg(json_build_object(
             'key', n.nspname || '.' || c.relname,
             'grants', (select coalesce(json_agg(json_build_object(
                                 'role', case when a.grantee = 0 then 'public'
                                              else pg_get_userbyid(a.grantee) end,
                                 'priv', a.privilege_type)), '[]'::json)
                          from aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a))), '[]'::json)
          from pg_class c join pg_namespace n on n.oid = c.relnamespace
          where c.relkind in ('r','p') and n.nspname in (${list})),

  'publications', (select coalesce(json_agg(pubname || '.' || schemaname || '.' || tablename), '[]'::json)
                   from pg_publication_tables where schemaname in (${list})),

  'extensions', (select coalesce(json_agg(extname), '[]'::json) from pg_extension)
) as inventory`;
}

// `cron.job` is a separate ask on purpose. The schema does not exist on a local
// stack that never installed pg_cron, and a missing relation is a *parse*
// error, so folding it into the query above would take the whole verification
// down with it. Its failure is reported as "not checked", never as a failure.
const CRON_QUERY = `select json_build_object(
  'jobs', (select coalesce(json_agg(json_build_object(
             'name', jobname, 'schedule', schedule, 'active', active)), '[]'::json)
           from cron.job)
) as inventory`;

function readInventory(row) {
  return typeof row.inventory === "string"
    ? JSON.parse(row.inventory)
    : row.inventory;
}

// ---------------------------------------------------------------------------
// 4. Compare and report
// ---------------------------------------------------------------------------

// Everything this script knowingly does not read. Printed on every run: a
// reader who is told what was checked and not told what was skipped will assume
// the second list is empty, and that assumption is how an audit goes wrong.
const NEVER_CHECKED = [
  "column types, defaults, NOT NULL, identity and generated expressions — only that the column exists (so 0011's redefinition of the generated `fts_doc` is unverified beyond its name)",
  "table and column constraints: primary keys, uniques, foreign keys, checks",
  "index definitions — columns, method, uniqueness, partial predicates — only the index name",
  "trigger timing and events (`before insert or update`) — only which function the trigger calls",
  "function return types: Postgres refuses to change one through `create or replace`, so a drift needs a drop-and-create that this script would see as a body or signature change first",
  "schema-level privileges (`grant usage on schema public to …`)",
  "default privileges (`alter default privileges`), which is how a *future* table could arrive already readable",
  "role membership and inheritance: a privilege reached through a granted role is invisible to a direct ACL read",
  "data: every `update`/`insert` backfill, including 0007's owner_id assignment and 0005's storage bucket row",
  "Vault secrets (`reminder_fn_url`, `reminder_fn_key`) — 0015 deliberately keeps them out of the file, so nothing here can confirm the sweep can reach the edge function",
  "edge functions: `supabase/functions/` is deployed separately and no migration touches it",
  "anything else inside a `do $$ … $$` block — only `alter publication … add table` and `cron.schedule` are read out of one",
  "settings pinned on a live function that no migration declares: extra `proconfig` entries are not reported",
];

function main() {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .map((f) => ({ file: f, version: /^(\d+)/.exec(f)?.[1] ?? f }))
    .sort((a, b) =>
      a.version.localeCompare(b.version, undefined, { numeric: true }),
    );

  if (files.length === 0) {
    console.error("No migrations found in supabase/migrations.");
    process.exit(1);
  }

  // Expectations are built in version order across all files, so a drop in a
  // later migration correctly cancels a create in an earlier one.
  const expected = new Map();
  const state = newState();
  const history = newHistory();
  const parseNotes = [];
  for (const { file, version } of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
    const visible = blankOutNoise(sql, { strings: false, dollar: false });
    const statements = splitStatements(blankOutNoise(sql), sql, visible);
    applyFile(expected, statements, version);
    const touched = applyDetailFile(state, statements, sql, version, parseNotes);
    snapshot(history, state, touched, version);
  }

  const schemas = [
    ...new Set(
      [...expected.values()].map((e) => e.object.schema).filter(Boolean),
    ),
  ];
  const unsafe = schemas.filter((s) => !SAFE_IDENT.test(s));
  if (unsafe.length) {
    console.error(
      `Refusing to build a query for unusual schema names: ${unsafe.join(", ")}`,
    );
    process.exit(1);
  }

  // Only the functions a migration names are pulled back with their bodies.
  const wantedFnNames = new Set();
  for (const key of history.func.keys()) {
    const name = /\.([^.(]+)\(/.exec(key);
    if (name) wantedFnNames.add(name[1]);
  }
  for (const { object } of expected.values()) {
    if (object.kind === "function") wantedFnNames.add(object.name);
  }
  const unsafeFn = [...wantedFnNames].filter((f) => !SAFE_IDENT.test(f));
  if (unsafeFn.length) {
    for (const f of unsafeFn) {
      parseNotes.push(
        `function name ${f} is not a plain lowercase identifier — its attributes, privileges and body are not checked.`,
      );
      wantedFnNames.delete(f);
    }
  }

  const attributeCount =
    history.rls.size +
    history.policy.size +
    history.func.size +
    history.tableGrant.size +
    history.trigger.size +
    history.publication.size +
    history.extension.size +
    history.cron.size;

  if (DRY_RUN) {
    printDryRun(files, expected, history, attributeCount, parseNotes);
    return;
  }

  const where = USE_LOCAL ? "local" : "linked (remote)";
  console.log(
    `Verifying ${expected.size} objects and ${attributeCount} attribute sets from ${files.length} migrations against the ${where} database...`,
  );

  const inv = readInventory(
    runQuery(
      inventoryQuery(
        schemas.length ? schemas : ["public"],
        [...wantedFnNames].sort(),
      ),
    ),
  );

  const notChecked = [...parseNotes];
  let cronJobs = null;
  if (history.cron.size > 0) {
    try {
      cronJobs = readInventory(runQuery(CRON_QUERY)).jobs;
    } catch (err) {
      cronJobs = null;
      notChecked.push(
        `cron.job could not be read here, so the ${history.cron.size} scheduled job(s) these migrations book are NOT verified (${String(err.message || err).split("\n")[0]}).`,
      );
    }
  }

  const have = {
    schema: new Set(inv.schemas),
    table: new Set(inv.tables),
    view: new Set(inv.views),
    column: new Set(inv.columns),
    function: new Set(inv.functions),
    trigger: new Set(inv.triggers),
    index: new Set(inv.indexes),
    policy: new Set(inv.policies),
    type: new Set(inv.types),
  };
  const applied = new Set(inv.applied);

  // ---- presence, unchanged ------------------------------------------------
  const missing = [];
  const skipped = [];
  for (const [key, { object, version }] of expected) {
    if (!CHECK_ALL && !applied.has(version)) {
      skipped.push({ key, version });
      continue;
    }
    const id =
      object.kind === "schema"
        ? object.name
        : object.kind === "column" ||
            object.kind === "trigger" ||
            object.kind === "policy"
          ? `${object.schema}.${object.table}.${object.name}`
          : `${object.schema}.${object.name}`;
    // A table that a view replaced, or vice versa, still counts as present.
    const present =
      have[object.kind].has(id) ||
      (object.kind === "table" && have.view.has(id)) ||
      (object.kind === "view" && have.table.has(id));
    if (!present) missing.push({ key, version, id });
  }

  // ---- attributes ---------------------------------------------------------
  const wrong = [];
  const fail = (version, what, detail) => wrong.push({ version, what, detail });

  checkRls(history, applied, inv, fail);
  checkPolicies(history, applied, inv, fail);
  // Every policy any migration mentions, applied or not. A policy from a file
  // the database has not run yet is still not an *extra* one.
  const managedPolicies = new Set(history.policy.keys());
  checkFunctions(history, applied, inv, fail);
  checkTableGrants(history, applied, inv, fail);
  checkTriggers(history, applied, inv, fail);
  checkPublications(history, applied, inv, fail);
  checkExtensions(history, applied, inv, fail);
  checkCron(history, applied, cronJobs, fail);
  const anonFindings = checkAnonExposure(expected, applied, inv);
  for (const f of anonFindings) fail(f.version, f.what, f.detail);

  // ---- advisory: extra policies on tables a migration created -------------
  const migrationTables = new Set(
    [...expected.values()]
      .filter((e) => e.object.kind === "table")
      .map((e) => `${e.object.schema}.${e.object.name}`),
  );
  const extraPolicies = (inv.policy_detail || []).filter(
    (p) => migrationTables.has(p.table) && !managedPolicies.has(p.key),
  );

  // ---- report -------------------------------------------------------------
  const notYetApplied = [...new Set(skipped.map((s) => s.version))].sort();
  if (notYetApplied.length) {
    console.log(
      `Skipping ${skipped.length} objects from migrations not yet applied there: ${notYetApplied.join(", ")}`,
    );
  }

  if (missing.length) {
    console.error("");
    console.error(
      `MISSING: ${missing.length} object(s) that an applied migration should have created.`,
    );
    console.error("");
    const byVersion = new Map();
    for (const m of missing) {
      if (!byVersion.has(m.version)) byVersion.set(m.version, []);
      byVersion.get(m.version).push(m);
    }
    for (const [version, items] of [...byVersion].sort()) {
      console.error(
        `  migration ${version} is recorded as applied, but these do not exist:`,
      );
      for (const item of items) console.error(`    - ${item.key}`);
      console.error("");
    }
    console.error(
      "This is the failure `supabase db push` can hide: the history row was written,",
    );
    console.error(
      "the SQL was not. See docs/DATABASE-MIGRATIONS.md for what to do about it.",
    );
  }

  if (wrong.length) {
    console.error("");
    console.error(
      `WRONG: ${wrong.length} object(s) exist but are not shaped the way an applied migration left them.`,
    );
    console.error("");
    const byVersion = new Map();
    for (const w of wrong) {
      if (!byVersion.has(w.version)) byVersion.set(w.version, []);
      byVersion.get(w.version).push(w);
    }
    for (const [version, items] of [...byVersion].sort()) {
      console.error(`  migration ${version}:`);
      for (const item of items) {
        console.error(`    - ${item.what}`);
        for (const line of item.detail) console.error(`        ${line}`);
      }
      console.error("");
    }
    console.error(
      "An object can exist and still be wrong. A `create or replace` that omits a",
    );
    console.error(
      "`SET` clause drops it silently; a policy edited in the dashboard keeps its",
    );
    console.error(
      "name; a drop-and-recreate resets a function's ACL to EXECUTE for PUBLIC.",
    );
    console.error(
      "Re-apply the migration's own statements by hand — one per file, `--linked`",
    );
    console.error(
      "every time — rather than repairing the history row. If instead the SQL is",
    );
    console.error(
      "right and this reading of it is wrong, teach the parser the shape.",
    );
  }

  if (extraPolicies.length) {
    console.log("");
    console.log(
      `ADVISORY — ${extraPolicies.length} policy(ies) on a migration-created table that no migration wrote.`,
    );
    console.log(
      "  Not a failure: a policy can be legitimately added out of band. It is listed",
    );
    console.log(
      "  because a permissive rule added by hand in the dashboard looks exactly like",
    );
    console.log("  this and nothing else here would ever mention it.");
    for (const p of extraPolicies) {
      console.log(
        `    - ${p.key}  (${p.cmd}, to ${(p.roles || []).join(", ") || "public"})`,
      );
      if (p.using) console.log(`        using: ${oneLine(p.using)}`);
      if (p.check) console.log(`        check: ${oneLine(p.check)}`);
    }
  }

  printNotChecked(notChecked);

  if (missing.length === 0 && wrong.length === 0) {
    console.log("");
    console.log(
      "OK — every object from every applied migration exists, and every attribute",
    );
    console.log("checked above still matches the SQL that created it.");
    return;
  }
  process.exit(1);
}

function oneLine(text) {
  return String(text).replace(/\s+/g, " ").trim();
}

function printNotChecked(extra) {
  console.log("");
  console.log("NOT CHECKED — read this before treating a clean run as a clean schema:");
  for (const line of NEVER_CHECKED) console.log(`  · ${line}`);
  for (const line of [...new Set(extra)]) console.log(`  · ${line}`);
  console.log(
    "  Policy predicates are compared with parentheses and casts normalised away,",
  );
  console.log(
    "  so a re-associated predicate with the same tokens reads as unchanged.",
  );
}

// ---------------------------------------------------------------------------
// 4a. The individual attribute checks
// ---------------------------------------------------------------------------

function checkRls(history, applied, inv, fail) {
  const live = new Map((inv.rls || []).map((r) => [r.key, r]));
  for (const [key, list] of history.rls) {
    const snap = currentFor(list, applied);
    if (!snap || !snap.value) continue;
    const want = snap.value;
    const got = live.get(key);
    if (!got) continue; // presence check already reports a missing table
    if (want.enabled !== null && got.enabled !== want.enabled) {
      fail(snap.version, `row level security on ${key}`, [
        `the migration says ${want.enabled ? "enable" : "disable"} row level security; relrowsecurity is ${got.enabled}.`,
        want.enabled
          ? "With RLS off, every policy on this table is inert and any role holding SELECT reads every row."
          : "",
      ].filter(Boolean));
    }
    if (want.forced !== null && got.forced !== want.forced) {
      fail(snap.version, `forced row level security on ${key}`, [
        `the migration says ${want.forced ? "force" : "no force"} row level security; relforcerowsecurity is ${got.forced}.`,
        want.forced
          ? "Without FORCE the table owner bypasses its own policies."
          : "",
      ].filter(Boolean));
    }
    if (want.replica !== null && got.replica !== want.replica) {
      fail(snap.version, `replica identity on ${key}`, [
        `the migration sets replica identity ${want.replica === "f" ? "full" : want.replica}; relreplident is '${got.replica}'.`,
        "Realtime sends the old row from this; a narrower identity silently changes what subscribers see.",
      ]);
    }
  }
}

function checkPolicies(history, applied, inv, fail) {
  const live = new Map((inv.policy_detail || []).map((p) => [p.key, p]));
  for (const [key, list] of history.policy) {
    const snap = currentFor(list, applied);
    if (!snap || !snap.value) continue;
    const want = snap.value;
    const got = live.get(key);
    if (want.dropped) {
      if (got) {
        fail(snap.version, `policy ${key} was dropped and is back`, [
          `an applied migration drops this policy; it exists with cmd=${got.cmd}, roles=${(got.roles || []).join(", ")}.`,
          got.using ? `using: ${oneLine(got.using)}` : "using: (none)",
          "A dropped policy that exists again was written by something other than these migrations.",
        ]);
      }
      continue;
    }
    if (!got) continue; // presence check already reports it

    if (got.cmd !== want.cmd) {
      fail(snap.version, `policy ${key} applies to a different command`, [
        `the migration writes \`for ${want.cmd}\`; the catalogue says ${got.cmd}.`,
      ]);
    }
    if (got.permissive !== want.permissive) {
      fail(snap.version, `policy ${key} changed permissive/restrictive`, [
        `the migration writes ${want.permissive ? "permissive" : "restrictive"}; the catalogue says ${got.permissive ? "permissive" : "restrictive"}.`,
      ]);
    }
    const gotRoles = [...(got.roles || [])].sort();
    if (gotRoles.join(",") !== want.roles.join(",")) {
      fail(snap.version, `policy ${key} applies to different roles`, [
        `the migration writes \`to ${want.roles.join(", ")}\`; the catalogue says ${gotRoles.join(", ") || "(none)"}.`,
        gotRoles.includes("public") || gotRoles.includes("anon")
          ? "It now covers a role the migration did not name, which widens who the policy lets in."
          : "",
      ].filter(Boolean));
    }
    comparePredicate(fail, snap.version, key, "using", want.using, got.using);
    comparePredicate(fail, snap.version, key, "with check", want.check, got.check);
  }
}

function comparePredicate(fail, version, key, label, wantRaw, gotRaw) {
  const want = normalizePredicate(wantRaw);
  const got = normalizePredicate(gotRaw);
  if (want === null && got === null) return;
  if (want === null) {
    // The migration wrote no such clause but the live policy has one. For a
    // USING clause that is a narrowing, not a widening, so it is still a
    // difference worth naming but not a security regression.
    fail(version, `policy ${key} has a ${label} clause the migration did not write`, [
      `catalogue: ${oneLine(gotRaw)}`,
    ]);
    return;
  }
  if (got === null) {
    fail(version, `policy ${key} has lost its ${label} clause`, [
      `the migration writes: ${oneLine(wantRaw)}`,
      label === "using"
        ? "A SELECT/UPDATE/DELETE policy with no USING lets no rows through; a missing clause here means the policy was rewritten."
        : "With no WITH CHECK, an INSERT or UPDATE under this policy is unconstrained.",
    ]);
    return;
  }
  if (want === got) return;
  if (isAlwaysTrue(got) && !isAlwaysTrue(want)) {
    fail(version, `policy ${key} ${label} has been opened to everything`, [
      `the migration writes: ${oneLine(wantRaw)}`,
      `the catalogue says:  ${oneLine(gotRaw)}`,
      "`true` under an unchanged policy name is the shape a tenant boundary disappears in.",
    ]);
    return;
  }
  fail(version, `policy ${key} ${label} differs from the migration`, [
    `the migration writes: ${oneLine(wantRaw)}`,
    `the catalogue says:  ${oneLine(gotRaw)}`,
    `normalised: ${want}`,
    `        vs: ${got}`,
    "If the two really are the same rule, the normaliser has met a shape it does not know — teach `normalizePredicate`, do not delete the check.",
  ]);
}

function checkFunctions(history, applied, inv, fail) {
  const live = new Map(
    (inv.function_detail || []).map((f) => [
      `${f.schema}.${f.name}(${(f.argtypes || "")
        .split(",")
        .map((t) => canonicalType(t))
        .filter((t) => t.length > 0)
        .join(",")})`,
      f,
    ]),
  );
  for (const [key, list] of history.func) {
    const snap = currentFor(list, applied);
    if (!snap || !snap.value) continue;
    const want = snap.value;
    if (want.dropped) continue;
    const got = live.get(key);
    if (!got) {
      // The bare-name presence check may well have passed: a function with the
      // same name and a different signature is a different function, and until
      // now nothing here could tell them apart.
      fail(snap.version, `function ${key} does not exist with that signature`, [
        "The presence check matches on name alone, so a changed argument list passes it.",
        `Functions named ${want.name ?? key} that do exist: ${
          [...live.keys()].filter((k) => k.startsWith(key.split("(")[0] + "(")).join(", ") ||
          "(none)"
        }`,
      ]);
      continue;
    }

    if (got.secdef !== want.secdef) {
      fail(
        snap.version,
        `function ${key} is ${got.secdef ? "SECURITY DEFINER" : "SECURITY INVOKER"} and the migration writes ${want.secdef ? "SECURITY DEFINER" : "SECURITY INVOKER"}`,
        [
          want.secdef
            ? "As invoker it runs with the caller's rights, so a definer-only job (0011's delete, 0015's sweep) silently sees nothing."
            : "As definer it runs with the owner's rights and stops obeying row level security — 0022's `pull_changes` is invoker on purpose.",
        ],
      );
    }

    const config = new Map(
      (got.config || []).map((entry) => {
        const at = entry.indexOf("=");
        return at === -1
          ? [entry.toLowerCase(), ""]
          : [
              entry.slice(0, at).toLowerCase(),
              normalizeSetting(entry.slice(at + 1)),
            ];
      }),
    );
    for (const [name, value] of Object.entries(want.settings || {})) {
      if (!config.has(name)) {
        fail(snap.version, `function ${key} has lost its \`set ${name}\``, [
          `the migration pins ${name} = ${value}; proconfig has ${(got.config || []).join(", ") || "nothing"}.`,
          name === "search_path"
            ? "This is the trap 0019 and 0023 both warn about: `create or replace` resets a function's configuration and nothing tells you. Without it a definer function resolves objects through a caller-controlled search_path."
            : "A `create or replace` that omits a SET clause drops it silently.",
        ]);
      } else if (config.get(name) !== value) {
        fail(snap.version, `function ${key} pins ${name} to something else`, [
          `the migration writes ${name} = ${value}; the catalogue says ${config.get(name)}.`,
        ]);
      }
    }

    // `body` is a string when a create statement gave one up, and null when it
    // did not — in which case the parser has already said so by name. An entry
    // that exists only because a grant named it has no body to compare at all.
    if (typeof want.body === "string" && normalizeBody(got.src || "") !== want.body) {
      fail(snap.version, `function ${key} has a different body`, [
        "This is the case docs/DATABASE-MIGRATIONS.md says db:verify used to miss: the object existed before the migration too, so presence proves nothing about a `create or replace`.",
        ...bodyDiff(want.body, normalizeBody(got.src || "")),
      ]);
    }

    if (want.acl) {
      const holders = new Set(got.execute_roles || []);
      const openToAll = holders.has("public");
      for (const role of want.acl.mustNot) {
        // A revoke from PUBLIC is undone by anything that re-grants to PUBLIC,
        // and a grant to PUBLIC covers every other named role too.
        const reached = holders.has(role) || (role !== "public" && openToAll);
        if (reached) {
          fail(snap.version, `function ${key} is executable by ${role}`, [
            `the migration revokes EXECUTE from ${[...want.acl.mustNot].join(", ")}; the catalogue grants it to ${[...holders].join(", ") || "nobody"}.`,
            openToAll && role !== "public"
              ? "EXECUTE is held by PUBLIC, which reaches every role including this one — the usual cause is a drop-and-recreate that left proacl null."
              : "",
          ].filter(Boolean));
        }
      }
      for (const role of want.acl.must) {
        if (!holders.has(role) && !openToAll) {
          fail(snap.version, `function ${key} is NOT executable by ${role}`, [
            `the migration grants EXECUTE to ${[...want.acl.must].join(", ")}; the catalogue grants it to ${[...holders].join(", ") || "nobody"}.`,
            "Whatever calls this will fail at run time, not at deploy time.",
          ]);
        }
      }
    }
  }
}

// The first line that differs, with a little of its neighbourhood. A whole diff
// would bury the report; the point is to say *where* to look.
function bodyDiff(want, got) {
  const a = want.split("\n");
  const b = got.split("\n");
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  const out = [`first difference at line ${i + 1} of the body:`];
  out.push(`  migration: ${a[i] === undefined ? "(end of body)" : oneLine(a[i])}`);
  out.push(`  catalogue: ${b[i] === undefined ? "(end of body)" : oneLine(b[i])}`);
  out.push(
    `  (${a.length} lines in the migration, ${b.length} on the server; CRLF and trailing spaces are normalised before comparing.)`,
  );
  return out;
}

function checkTableGrants(history, applied, inv, fail) {
  const live = tableAclMap(inv);
  for (const [key, list] of history.tableGrant) {
    const snap = currentFor(list, applied);
    if (!snap || !snap.value) continue;
    const got = live.get(key);
    if (!got) continue;
    for (const [role, privs] of Object.entries(snap.value)) {
      const held = got.get(role) || new Set();
      const publicHeld = got.get("public") || new Set();
      const wanted = privs instanceof Set ? [...privs] : privs;
      const absent = wanted.filter((p) => !held.has(p) && !publicHeld.has(p));
      if (absent.length) {
        fail(snap.version, `table ${key} no longer grants ${absent.join(", ")} to ${role}`, [
          `the migration grants ${wanted.join(", ")}; ${role} holds ${[...held].join(", ") || "nothing"}.`,
          "The app fails at run time on a privilege it was given at deploy time.",
        ]);
      }
    }
  }
}

function tableAclMap(inv) {
  const live = new Map();
  for (const row of inv.table_acl || []) {
    const byRole = new Map();
    for (const g of row.grants || []) {
      ensure(byRole, g.role, () => new Set()).add(g.priv);
    }
    live.set(row.key, byRole);
  }
  return live;
}

// Nothing in this app signs in as `anon`: the web client authenticates before
// it reads a row, and every policy here is written `to authenticated`. A SELECT
// held by `anon` (or by PUBLIC, which reaches anon) is therefore a grant nobody
// asked for. With RLS enabled and no anon policy it is not by itself an open
// door — but it is one revoke away from being one, and it is exactly what an
// `alter default privileges` set once and forgotten leaves behind. TRUNCATE is
// listed beside it because it is the one table privilege that destroys data
// without reading any.
function checkAnonExposure(expected, applied, inv) {
  const live = tableAclMap(inv);
  const findings = [];
  for (const { object, version } of expected.values()) {
    if (object.kind !== "table") continue;
    if (!CHECK_ALL && !applied.has(version)) continue;
    const key = `${object.schema}.${object.name}`;
    const byRole = live.get(key);
    if (!byRole) continue;
    for (const role of ["anon", "public"]) {
      const held = byRole.get(role);
      if (!held) continue;
      const bad = ["SELECT", "TRUNCATE"].filter((p) => held.has(p));
      if (bad.length) {
        findings.push({
          version,
          what: `table ${key} grants ${bad.join(" and ")} to ${role}`,
          detail: [
            `${role} holds ${[...held].sort().join(", ")} on this table.`,
            "No migration here grants anything to anon or PUBLIC; every grant is written `to authenticated, service_role`.",
            `Close it with: revoke ${bad.join(", ").toLowerCase()} on ${key} from ${role};`,
            "If this is how the project has always been and RLS is on, it is defence in depth rather than a live hole — revoke it once and this line goes away for good.",
          ],
        });
      }
    }
  }
  return findings;
}

function checkTriggers(history, applied, inv, fail) {
  const live = new Map((inv.trigger_detail || []).map((t) => [t.key, t.fn]));
  for (const [key, list] of history.trigger) {
    const snap = currentFor(list, applied);
    if (!snap || !snap.value) continue;
    const got = live.get(key);
    if (!got) continue;
    const want = `${snap.value.fn.schema}.${snap.value.fn.name}`;
    if (got !== want) {
      fail(snap.version, `trigger ${key} calls a different function`, [
        `the migration writes \`execute function ${want}()\`; the catalogue says ${got}.`,
      ]);
    }
  }
}

function checkPublications(history, applied, inv, fail) {
  const live = new Set(inv.publications || []);
  for (const [key, list] of history.publication) {
    const snap = currentFor(list, applied);
    if (!snap || !snap.value) continue;
    if (!live.has(key)) {
      const [pub, ...rest] = key.split(".");
      fail(snap.version, `${rest.join(".")} is not in publication ${pub}`, [
        "This statement lives inside a `do $$ … $$` block, which is why nothing used to read it.",
        "Realtime stops pushing changes for this table; the app still syncs on its poll, so the symptom is slowness, not breakage.",
      ]);
    }
  }
}

function checkExtensions(history, applied, inv, fail) {
  const live = new Set(inv.extensions || []);
  for (const [key, list] of history.extension) {
    const snap = currentFor(list, applied);
    if (!snap || !snap.value) continue;
    if (!live.has(key)) {
      fail(snap.version, `extension ${key} is not installed`, [
        key === "pg_cron"
          ? "Without pg_cron nothing is awake when the phone is not, and no reminder ever fires."
          : key === "pg_net"
            ? "Without pg_net the sweep cannot reach the edge function that does the push crypto."
            : "A migration creates it and the catalogue does not have it.",
      ]);
    }
  }
}

function checkCron(history, applied, jobs, fail) {
  if (jobs === null) return; // reported under NOT CHECKED
  const live = new Map(jobs.map((j) => [j.name, j]));
  for (const [name, list] of history.cron) {
    const snap = currentFor(list, applied);
    if (!snap || !snap.value) continue;
    const got = live.get(name);
    if (!got) {
      fail(snap.version, `cron job '${name}' is not scheduled`, [
        `the migration books it on \`${snap.value}\`; cron.job has no such job.`,
        "A missing job is silent by construction: nothing runs, and nothing reports that nothing ran.",
      ]);
      continue;
    }
    if (got.schedule !== snap.value) {
      fail(snap.version, `cron job '${name}' runs on a different schedule`, [
        `the migration books \`${snap.value}\`; cron.job says \`${got.schedule}\`.`,
      ]);
    }
    if (got.active === false) {
      fail(snap.version, `cron job '${name}' is scheduled but inactive`, [
        "cron.job.active is false, so it never runs.",
      ]);
    }
  }
}

// ---------------------------------------------------------------------------
// 4b. --dry-run: what would be checked, without a database
// ---------------------------------------------------------------------------

function printDryRun(files, expected, history, attributeCount, parseNotes) {
  console.log(
    `Parsed ${files.length} migrations: ${expected.size} objects and ${attributeCount} attribute sets. No database was contacted.`,
  );
  const byKind = new Map();
  for (const { object } of expected.values()) {
    byKind.set(object.kind, (byKind.get(object.kind) || 0) + 1);
  }
  console.log("");
  console.log("  objects by kind:");
  for (const [kind, n] of [...byKind].sort()) {
    console.log(`    ${String(n).padStart(4)}  ${kind}`);
  }
  console.log("");
  console.log("  attributes:");
  const label = {
    rls: "tables whose RLS / replica identity is asserted",
    policy: "policies whose command, roles and predicates are compared",
    func: "functions whose signature, security, settings, body and ACL are compared",
    tableGrant: "tables whose explicit grants are compared",
    trigger: "triggers whose function is compared",
    publication: "publication memberships asserted (read out of do-blocks)",
    extension: "extensions asserted",
    cron: "cron jobs asserted (checked only if cron.job is readable)",
  };
  for (const kind of DETAIL_KINDS) {
    console.log(
      `    ${String(history[kind].size).padStart(4)}  ${label[kind]}`,
    );
  }
  console.log("");
  console.log("  functions, with what was recovered from the SQL:");
  for (const [key, list] of [...history.func].sort()) {
    const last = list[list.length - 1];
    const v = last.value;
    if (!v || v.dropped) {
      console.log(`    ${key} — dropped by ${last.version}`);
      continue;
    }
    const bits = [
      v.secdef ? "security definer" : "security invoker",
      ...Object.entries(v.settings || {}).map(
        ([n, val]) => `set ${n}=${val === "" ? "''" : val}`,
      ),
      typeof v.body === "string"
        ? `body ${v.body.split("\n").length} lines`
        : "body NOT READ",
      v.acl && v.acl.must.size ? `grant to ${[...v.acl.must].join("/")}` : null,
      v.acl && v.acl.mustNot.size
        ? `revoked from ${[...v.acl.mustNot].join("/")}`
        : null,
    ].filter(Boolean);
    console.log(`    ${key} — ${bits.join(", ")}  [last touched by ${last.version}]`);
  }
  printNotChecked(parseNotes);
}

main();
