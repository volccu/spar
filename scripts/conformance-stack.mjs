#!/usr/bin/env node
// The local Supabase stack the conformance suite runs against, started and
// stopped so that nothing it publishes is reachable from anywhere but this
// machine.
//
//   node scripts/conformance-stack.mjs start   # network, stack, binding check
//   node scripts/conformance-stack.mjs check   # every published port on loopback?
//   node scripts/conformance-stack.mjs env     # the stack's URL and keys, as env lines
//   node scripts/conformance-stack.mjs stop    # stack down, volumes and network gone
//
// Why a script rather than a bare `supabase start`:
//
// 1. **Loopback only.** Ports that Docker publishes are written straight into
//    the NAT table and bypass a host firewall such as ufw, and the Supabase CLI
//    publishes its ports without naming an address, which Docker reads as every
//    interface. The stack is therefore started on a network of its own created
//    with `com.docker.network.bridge.host_binding_ipv4=127.0.0.1`, which makes
//    loopback the default address for every port published on it, and the
//    bindings are read back afterwards. Anything bound elsewhere stops the
//    stack at once.
// 2. **Its own name.** `SUPABASE_PROJECT_ID` (default `spar-conformance`) names
//    the containers and volumes, so this stack never collides with a developer's
//    own `supabase start` of the same repository.
// 3. **No table reached by default.** The migrations were written against a
//    project whose default privileges expose every new table in `public` to
//    the API roles; a project made today exposes nothing it is not granted.
//    The stack is started the new way, pinned rather than left to the CLI's
//    default, so the migrations' own grants are what the suite exercises. Until
//    migration 0025 granted `folders`, `prefs`, `push_subscriptions` and
//    `reminder_deliveries` explicitly this needed the legacy exposure turned
//    back on (docs/sync-contract.md, D4); nothing needs it now.
//
// 4. **Email sign-in on, sign-up off**, which is the hosted shape; see
//    `stackEnv` below.
//
// Nothing here touches a linked or hosted project: every command is local.

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PROJECT = process.env.SUPABASE_PROJECT_ID || "spar-conformance";
const NETWORK = process.env.SPAR_CONFORMANCE_NETWORK || "spar-conformance";
const BIND_OPTION = "com.docker.network.bridge.host_binding_ipv4";

function supabaseBin() {
  const local = join(ROOT, "node_modules", ".bin", "supabase");
  if (!existsSync(local)) {
    throw new Error("the Supabase CLI is not installed; run `npm ci` in the repository root first");
  }
  return local;
}

function stackEnv() {
  return {
    ...process.env,
    SUPABASE_PROJECT_ID: PROJECT,
    // A new table reaches the API roles only through a grant a migration
    // wrote — the shape of every project created since 2026-05-30. Forced, not
    // defaulted, so a `true` left in the caller's shell cannot hide a missing
    // grant.
    SUPABASE_API_AUTO_EXPOSE_NEW_TABLES: "false",
    // `[auth.email] enable_signup = false` in config.toml switches the email
    // provider off altogether in a local stack (GOTRUE_EXTERNAL_EMAIL_ENABLED),
    // so nobody could sign in at all. The hosted shape is "email sign-in on,
    // sign-up off", which is this plus the `[auth] enable_signup = false` the
    // file already has. Test users are made through the admin API.
    SUPABASE_AUTH_EMAIL_ENABLE_SIGNUP: process.env.SUPABASE_AUTH_EMAIL_ENABLE_SIGNUP ?? "true",
  };
}

function supabase(args, { capture = false } = {}) {
  const run = spawnSync(supabaseBin(), [...args, "--workdir", ROOT], {
    env: stackEnv(),
    encoding: "utf8",
    stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
  });
  if (run.status !== 0) {
    const detail = capture ? `\n${run.stderr || run.stdout}` : "";
    throw new Error(`supabase ${args.join(" ")} failed (exit ${run.status})${detail}`);
  }
  return run.stdout ?? "";
}

function docker(args) {
  return execFileSync("docker", args, { encoding: "utf8" }).trim();
}

function ensureNetwork() {
  let options;
  try {
    options = JSON.parse(docker(["network", "inspect", NETWORK, "--format", "{{json .Options}}"]));
  } catch {
    docker(["network", "create", "-o", `${BIND_OPTION}=127.0.0.1`, NETWORK]);
    return;
  }
  if (options?.[BIND_OPTION] !== "127.0.0.1") {
    throw new Error(
      `docker network ${NETWORK} exists without ${BIND_OPTION}=127.0.0.1; remove it or name another with SPAR_CONFORMANCE_NETWORK`,
    );
  }
}

/** Every port any of this project's containers publishes, as `name address:port`. */
function publishedPorts() {
  const names = docker(["ps", "--filter", `name=_${PROJECT}`, "--format", "{{.Names}}"])
    .split("\n")
    .filter(Boolean);
  const out = [];
  for (const name of names) {
    const mapping = docker(["port", name]);
    for (const line of mapping.split("\n").filter(Boolean)) {
      // "5432/tcp -> 127.0.0.1:54322"
      const address = line.split("->")[1]?.trim() ?? "";
      out.push({ name, address });
    }
  }
  return { names, ports: out };
}

function check() {
  const { names, ports } = publishedPorts();
  const exposed = ports.filter(({ address }) => !address.startsWith("127.0.0.1:"));
  for (const { name, address } of ports) console.log(`${name} ${address}`);
  if (exposed.length > 0) {
    console.error("NOT LOOPBACK:", exposed.map((p) => `${p.name} ${p.address}`).join(", "));
    return false;
  }
  console.log(`${names.length} containers, ${ports.length} published ports, all on 127.0.0.1`);
  return true;
}

/** Names of this project's containers or volumes still on the machine. */
function leftovers(kind) {
  const args =
    kind === "container"
      ? ["ps", "-a", "--filter", `name=_${PROJECT}`, "--format", "{{.Names}}"]
      : ["volume", "ls", "--filter", `name=_${PROJECT}`, "--format", "{{.Name}}"];
  return docker(args)
    .split("\n")
    .filter((name) => name.endsWith(`_${PROJECT}`));
}

function stop() {
  try {
    supabase(["stop", "--no-backup"]);
  } finally {
    // `supabase stop --no-backup` can leave the edge runtime's container and
    // its cache volume behind; nothing named for this project may outlive it.
    for (const name of leftovers("container")) docker(["rm", "-f", name]);
    for (const name of leftovers("volume")) docker(["volume", "rm", name]);
    try {
      docker(["network", "rm", NETWORK]);
    } catch {
      // Already gone, or still in use by something this script did not start.
    }
  }
}

const command = process.argv[2];
try {
  if (command === "start") {
    ensureNetwork();
    supabase(["start", "--network-id", NETWORK]);
    if (!check()) {
      console.error("stopping the stack: a port was published beyond loopback");
      stop();
      process.exit(1);
    }
  } else if (command === "check") {
    process.exit(check() ? 0 : 1);
  } else if (command === "env") {
    process.stdout.write(supabase(["status", "-o", "env"], { capture: true }));
  } else if (command === "stop") {
    stop();
  } else {
    console.error("usage: node scripts/conformance-stack.mjs start|check|env|stop");
    process.exit(2);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
