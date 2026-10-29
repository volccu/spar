#!/usr/bin/env node
/**
 * The spår server, end to end, in a real browser.
 *
 *   npm run e2e:server                         build, serve, drive, clean up
 *   npm run e2e:server -- --shots <folder>     also keep the screenshots there
 *   npm run e2e:server -- --port 18793         the loopback port (a free one if taken)
 *
 * What it does, in order:
 *
 *   1. builds the web app the way the container does (`VITE_RUNTIME_CONFIG=1`,
 *      no Supabase variables) into a temporary folder;
 *   2. starts the spår server from source on 127.0.0.1, serving that build
 *      (`SPAR_WEB_DIR`) with a throwaway data folder, sign-up closed;
 *   3. drives two browser profiles — a "phone" and a "laptop" — with headless
 *      Chrome in the `zenika/alpine-chrome:with-puppeteer` image, on the host's
 *      network so it reaches loopback (no port is published): the first
 *      account is made, a note is captured, the second profile signs in and
 *      sees it, an edit on either side reaches the other live over the event
 *      stream, a picture is attached and arrives, a link is unfurled by the
 *      server, everything is exported as a zip, and the account is deleted —
 *      after which it cannot sign in;
 *   4. removes the server, the container and every temporary file, whatever
 *      happened.
 *
 * The same file is the browser half: run inside the container with
 * `SPAR_E2E_ROLE=browser`, it is the Puppeteer script. It prints one line per
 * step and exits non-zero on the first failure.
 *
 * What it cannot show: a reminder ringing. That needs a real push service
 * (FCM, Mozilla's) and a device that stays subscribed to it; headless Chrome
 * has neither. The link step needs the internet, and says so when it has none.
 */
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { chmod, copyFile, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const IMAGE = "zenika/alpine-chrome:with-puppeteer";
const THIS_FILE = fileURLToPath(import.meta.url);

if (process.env.SPAR_E2E_ROLE === "browser") {
  await browserRole();
} else {
  await hostRole();
}

// ---------------------------------------------------------------------------
// The host: build, serve, run the browser, clean up.
// ---------------------------------------------------------------------------

async function hostRole() {
  const ROOT = resolve(dirname(THIS_FILE), "..");
  const args = process.argv.slice(2);
  const option = (name) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const shots = option("--shots") ? resolve(option("--shots")) : null;
  const port = await freePort(Number(option("--port") ?? 18793));

  const tmp = await mkdtemp(join(tmpdir(), "spar-e2e-"));
  const web = join(tmp, "web");
  const data = join(tmp, "data");
  const out = join(tmp, "out");
  await mkdir(out, { recursive: true });
  // The container's user is not necessarily this one.
  await chmod(out, 0o777);
  // Made here, so this user owns it and can remove the zip the container's user writes in it.
  await mkdir(join(out, "downloads"));
  await chmod(join(out, "downloads"), 0o777);
  const container = `spar-e2e-${process.pid}`;
  let server = null;

  const say = (line) => console.log(`e2e: ${line}`);
  // One clean-up, however many callers: a second caller waits for the first.
  let cleaning = null;
  const cleanup = () => (cleaning ??= doCleanup());
  const doCleanup = async () => {
    await run("docker", ["rm", "-f", container], { quiet: true }).catch(() => {});
    if (server && server.exitCode === null) {
      server.kill("SIGTERM");
      await Promise.race([
        new Promise((r) => server.once("exit", r)),
        new Promise((r) => setTimeout(r, 5000)),
      ]);
      if (server.exitCode === null) server.kill("SIGKILL");
    }
    await rm(tmp, { recursive: true, force: true });
  };
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => {
      void cleanup().then(() => process.exit(130));
    });
  }

  let failed = false;
  try {
    say(`building the web app with VITE_RUNTIME_CONFIG=1 into ${web}`);
    await run(process.execPath, [join(ROOT, "web/node_modules/vite/bin/vite.js"), "build", "--outDir", web, "--emptyOutDir", "--logLevel", "warn"], {
      cwd: join(ROOT, "web"),
      env: {
        ...process.env,
        VITE_RUNTIME_CONFIG: "1",
        // Set and empty: a web/.env on this machine must not reach this build.
        VITE_SUPABASE_URL: "",
        VITE_SUPABASE_ANON_KEY: "",
        VITE_VAPID_PUBLIC_KEY: "",
      },
    });
    const chunks = await readdir(join(web, "assets"));
    if (!chunks.some((name) => /^sparServerBackend-/.test(name))) {
      throw new Error("the runtime-config build has no sparServerBackend chunk");
    }

    say(`starting the spår server on 127.0.0.1:${port}`);
    server = spawn(process.execPath, ["--import", "tsx", "server/src/main.ts"], {
      cwd: ROOT,
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        SPAR_DATA_DIR: data,
        SPAR_HOST: "127.0.0.1",
        SPAR_PORT: String(port),
        SPAR_WEB_DIR: web,
        SPAR_SIGNUP: "closed",
        // As docs/self-hosting.md recommends: only the name it is reached by.
        SPAR_ALLOWED_HOSTS: `127.0.0.1:${port}`,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const prefix = (stream) =>
      stream.on("data", (chunk) => {
        for (const line of String(chunk).split("\n")) if (line.trim()) console.log(`  server: ${line}`);
      });
    prefix(server.stdout);
    prefix(server.stderr);
    await waitForHealth(`http://127.0.0.1:${port}/api/health`, server);

    say(`driving headless Chrome (${IMAGE}, host network, nothing published)`);
    await run("docker", [
      "run",
      "--rm",
      "--name",
      container,
      "--network",
      "host",
      "--shm-size",
      "512m",
      "-v",
      `${THIS_FILE}:/usr/src/app/e2e/run.mjs:ro`,
      "-v",
      `${out}:/usr/src/app/out`,
      "-e",
      "SPAR_E2E_ROLE=browser",
      "-e",
      `SPAR_E2E_URL=http://127.0.0.1:${port}`,
      IMAGE,
      "node",
      "/usr/src/app/e2e/run.mjs",
    ]);

    // What the browser left behind, read from this side.
    const downloads = await readdir(join(out, "downloads")).catch(() => []);
    const zip = downloads.find((name) => name.endsWith(".zip"));
    if (!zip) throw new Error("no zip was downloaded");
    const head = (await readFile(join(out, "downloads", zip))).subarray(0, 2).toString("latin1");
    if (head !== "PK") throw new Error(`the download ${zip} is not a zip`);
    say(`the export downloaded as ${zip} (${(await stat(join(out, "downloads", zip))).size} bytes)`);
    const left = await readdir(join(data, "files")).catch(() => []);
    if (left.length > 0) throw new Error(`files were left on the server after the account was deleted: ${left.join(", ")}`);
    say("nothing of the account is left in the server's files folder");

    say("passed");
  } catch (error) {
    failed = true;
    console.error(`e2e: FAILED — ${error instanceof Error ? error.message : error}`);
  } finally {
    // The screenshots, a failure's included, before the folder goes.
    if (shots) {
      try {
        await mkdir(shots, { recursive: true });
        const pictures = (await readdir(out).catch(() => [])).filter((n) => n.endsWith(".png") && n !== "grey.png");
        for (const name of pictures) await copyFile(join(out, name), join(shots, name));
        if (pictures.length) say(`screenshots copied to ${shots}`);
      } catch (error) {
        failed = true;
        console.error(`e2e: could not keep the screenshots — ${error instanceof Error ? error.message : error}`);
      }
    }
    await cleanup();
  }
  process.exit(failed ? 1 : 0);
}

/** The wanted port if nothing holds it, or any free loopback port. */
async function freePort(wanted) {
  const tryPort = (p) =>
    new Promise((resolvePort) => {
      const probe = createServer();
      probe.once("error", () => resolvePort(null));
      probe.listen(p, "127.0.0.1", () => {
        const { port } = probe.address();
        probe.close(() => resolvePort(port));
      });
    });
  return (await tryPort(wanted)) ?? (await tryPort(0));
}

async function waitForHealth(url, child) {
  const until = Date.now() + 60_000;
  while (Date.now() < until) {
    if (child.exitCode !== null) throw new Error(`the server exited (${child.exitCode})`);
    try {
      const answer = await fetch(url);
      if (answer.ok) return;
    } catch {
      // Not listening yet.
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("the server did not answer /api/health within a minute");
}

function run(command, argv, { cwd, env, quiet = false } = {}) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, argv, { cwd, env, stdio: quiet ? "ignore" : "inherit" });
    child.once("error", reject);
    child.once("exit", (code) => (code === 0 ? resolveRun() : reject(new Error(`${command} ${argv[0]} exited ${code}`))));
  });
}

// ---------------------------------------------------------------------------
// The browser: two profiles against the served app. Runs in the container.
// ---------------------------------------------------------------------------

async function browserRole() {
  const BASE = process.env.SPAR_E2E_URL;
  const OUT = "/usr/src/app/out";
  const { default: puppeteer } = await import("puppeteer");
  const EMAIL = "owner@example.test";
  const PASSWORD = "a long enough password";
  const started = Date.now();
  const step = (what) => console.log(`browser: ${((Date.now() - started) / 1000).toFixed(1).padStart(5)}s  ${what}`);
  const must = (ok, what) => {
    if (!ok) throw new Error(what);
  };

  const browser = await puppeteer.launch({
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || "/usr/bin/chromium-browser",
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--hide-scrollbars", "--force-color-profile=srgb"],
  });
  const pageErrors = [];
  const open = async (context, name) => {
    const page = await context.newPage();
    await page.setViewport({ width: 1280, height: 860 });
    page.on("pageerror", (error) => pageErrors.push(`${name}: ${error.message}`));
    return page;
  };

  // The "phone" is the browser's own profile (downloads are allowed there); the
  // "laptop" is a separate one, with nothing in common but the server.
  const phoneContext = browser.defaultBrowserContext();
  const laptopContext = await browser.createBrowserContext();
  const phone = await open(phoneContext, "phone");
  const laptop = await open(laptopContext, "laptop");
  let streams = 0;
  phone.on("response", (r) => {
    if (r.url().endsWith("/api/events") && r.status() === 200) streams += 1;
  });

  /** Waits until a card on the board shows `text`. */
  const onBoard = (page, text, timeout = 30_000) =>
    page.waitForFunction(
      (t) => [...document.querySelectorAll(".card")].some((card) => card.textContent.includes(t)),
      { timeout, polling: 100 },
      text,
    );
  /** The caller's notes, as the server has them. */
  const serverNotes = (page) =>
    page.evaluate(async () => (await (await fetch("/api/notes?limit=1000")).json()).notes ?? []);
  const poll = async (fn, timeout, what) => {
    const until = Date.now() + timeout;
    for (;;) {
      const value = await fn();
      if (value) return value;
      if (Date.now() > until) throw new Error(`timed out: ${what}`);
      await new Promise((r) => setTimeout(r, 250));
    }
  };
  const capture = async (page, text, { lands = true } = {}) => {
    await page.click('textarea[aria-label="Write a note"]');
    await page.type('textarea[aria-label="Write a note"]', text);
    await page.click('button[aria-label="Save note"]');
    if (lands) await onBoard(page, text);
  };

  try {
    // 1. The first account.
    await phone.goto(BASE, { waitUntil: "load" });
    await phone.waitForSelector('input[type="email"]', { timeout: 30_000 });
    await phone.waitForFunction(() => document.body.textContent.includes("No one has an account here yet"), {
      timeout: 10_000,
    });
    await phone.screenshot({ path: `${OUT}/1-first-account.png` });
    await phone.type('input[type="email"]', EMAIL);
    await phone.type('input[type="password"]', PASSWORD);
    await phone.click("button.signin-go");
    await phone.waitForSelector('textarea[aria-label="Write a note"]', { timeout: 30_000 });
    const marker = await phone.evaluate(() => localStorage.getItem("spar.server-session"));
    must(marker && JSON.parse(marker).id, "no session marker after sign-up");
    step("first account made; the phone is signed in and holds the session marker");

    // 2. A note, captured on the phone, reaches the server.
    const first = "Tern over the lake at seven";
    await capture(phone, first);
    await poll(async () => (await serverNotes(phone)).some((n) => n.body === first), 20_000, "the note reaching the server");
    step("a note captured on the phone is on the server");

    // Opened again, a signed-in device paints its notes from the device at
    // once: the session marker answers `hasStoredSession`, so the full-screen
    // Loading that waits on the server is never drawn.
    await phone.evaluateOnNewDocument(watchForLoading);
    await laptop.evaluateOnNewDocument(watchForLoading);
    await phone.reload({ waitUntil: "load" });
    await onBoard(phone, first);
    must(!(await phone.evaluate(() => window.__sawLoading === true)), "a signed-in reopen waited on Loading");
    step("reopened, the phone painted its notes without waiting on the server (no Loading screen)");

    // 3. The laptop signs in and finds it.
    await laptop.goto(BASE, { waitUntil: "load" });
    await laptop.waitForSelector('input[type="email"]', { timeout: 30_000 });
    await laptop.waitForFunction(() => document.body.textContent.includes("Sign in to keep your notes"), {
      timeout: 10_000,
    });
    // The same watch, as a control: a browser that has never signed in has no
    // marker, and waits on the server before it can draw the sign-in form.
    const laptopWaited = await laptop.evaluate(() => window.__sawLoading === true);
    await laptop.type('input[type="email"]', EMAIL);
    await laptop.type('input[type="password"]', PASSWORD);
    await laptop.click("button.signin-go");
    await onBoard(laptop, first);
    step(
      `the laptop (no marker: it ${laptopWaited ? "did" : "did not"} show Loading first) signed in and pulled the note`,
    );

    // 4. Live, both ways: an edit on the laptop appears on the phone, and a
    //    capture on the phone appears on the laptop, well inside the 20-second
    //    backstop — the event stream, not the timer.
    await poll(async () => streams > 0, 20_000, "the phone opening its event stream");
    await laptop.evaluate((t) => {
      const card = [...document.querySelectorAll(".card")].find((c) => c.textContent.includes(t));
      card.click();
    }, first);
    await laptop.waitForSelector(".sheet .reader", { timeout: 10_000 });
    // Past the opening move, then a tap under the words: the caret at the end.
    await new Promise((r) => setTimeout(r, 800));
    await laptop.click(".sheet-rest");
    await laptop.waitForSelector("textarea.editor", { timeout: 10_000 });
    await laptop.keyboard.type(", seen from the laptop");
    await laptop.keyboard.press("Escape");
    let t0 = Date.now();
    await onBoard(phone, "seen from the laptop", 30_000);
    const editSeconds = (Date.now() - t0) / 1000;
    must(editSeconds < 15, `the edit took ${editSeconds}s to arrive — that is the backstop, not the stream`);
    step(`an edit on the laptop reached the phone in ${editSeconds.toFixed(1)}s (event stream)`);

    const second = "Second note, written while the laptop watched";
    await capture(phone, second);
    t0 = Date.now();
    await onBoard(laptop, second, 30_000);
    const captureSeconds = (Date.now() - t0) / 1000;
    must(captureSeconds < 15, `the capture took ${captureSeconds}s to arrive`);
    step(`a capture on the phone reached the laptop in ${captureSeconds.toFixed(1)}s (event stream)`);

    // 5. A picture: attached on the phone, uploaded, drawn on the laptop, and
    //    the bytes readable from there.
    const png = greyPng(48, 32);
    await writeFile(`${OUT}/grey.png`, png);
    const picker = await phone.$("form.capture input[type=file]");
    await picker.uploadFile(`${OUT}/grey.png`);
    const withFile = await poll(
      async () => (await serverNotes(phone)).find((n) => (n.attachments ?? []).some((a) => a.path)),
      30_000,
      "the picture uploading",
    );
    const path = withFile.attachments.find((a) => a.path).path;
    const fetched = await laptop.evaluate(async (p) => {
      const answer = await fetch(`/api/files/${p.split("/").map(encodeURIComponent).join("/")}`);
      return { status: answer.status, size: (await answer.arrayBuffer()).byteLength, type: answer.headers.get("content-type") };
    }, path);
    must(fetched.status === 200 && fetched.size === png.length, `the laptop read the file back as ${JSON.stringify(fetched)}`);
    await laptop.waitForFunction(
      (id) => Boolean(document.querySelector(`.card[data-id="${id}"] img`)),
      { timeout: 30_000 },
      withFile.id,
    );
    step(`a ${png.length}-byte picture attached on the phone uploaded, and the laptop draws it and reads it back (${fetched.type})`);

    // 6. A link, unfurled by the server.
    // A note that is nothing but an address lives on Links, not the Inbox,
    // so it never lands on this board; the server is where to look.
    await capture(phone, "https://example.com", { lands: false });
    let unfurled = null;
    try {
      unfurled = await poll(
        async () =>
          (await serverNotes(phone))
            .flatMap((n) => n.link_previews ?? [])
            .find((p) => /example\.com/.test(p.href ?? p.url ?? "") && p.fetched_at && p.title),
        40_000,
        "the link preview",
      );
    } catch {
      const direct = await phone.evaluate(async () => {
        const answer = await fetch("/api/link-preview", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ url: "https://example.com" }),
        });
        return { status: answer.status, body: await answer.text() };
      });
      throw new Error(`no preview came back; the server answers the link with ${direct.status} ${direct.body}` + (direct.status === 502 ? " (no internet from the server?)" : ""));
    }
    step(`https://example.com unfurled through the server: "${unfurled.title}"`);

    await phone.screenshot({ path: `${OUT}/2-board.png` });

    // 7. Everything out: the About page's zip, downloaded; and the server's own export.
    await mkdir(`${OUT}/downloads`, { recursive: true });
    const cdp = await phone.createCDPSession();
    await cdp.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: `${OUT}/downloads` });
    await phone.click('button[aria-label="Menu"]');
    await phone.click("::-p-text(About spår)");
    await phone.waitForSelector(".about", { timeout: 10_000 });
    await phone.click("::-p-text(Download everything)");
    const zip = await poll(
      async () => (await readdir(`${OUT}/downloads`)).find((name) => name.endsWith(".zip")),
      30_000,
      "the zip downloading",
    );
    step(`"Download everything" saved ${zip}`);
    const exported = await phone.evaluate(async () => {
      const answer = await fetch("/api/account/export");
      const bytes = new Uint8Array(await answer.arrayBuffer());
      return { status: answer.status, type: answer.headers.get("content-type"), zip: bytes[0] === 0x50 && bytes[1] === 0x4b, size: bytes.length };
    });
    must(exported.status === 200 && exported.zip, `the server's export answered ${JSON.stringify(exported)}`);
    step(`the server's own export answers a ${exported.size}-byte zip (${exported.type})`);

    // 8. Closing the account.
    await phone.click("::-p-text(Delete the account)");
    await phone.waitForSelector('input[aria-label="Your password"]', { timeout: 10_000 });
    await phone.evaluate(() => document.querySelector(".about-close-account").scrollIntoView({ block: "center" }));
    await phone.screenshot({ path: `${OUT}/3-close-account.png` });
    await phone.type('input[aria-label="Your password"]', "not the password");
    await phone.click("::-p-text(Delete for good)");
    await phone.waitForFunction(() => document.body.textContent.includes("nothing was deleted"), { timeout: 10_000 });
    step("a wrong password deletes nothing, and says so");
    await phone.click('input[aria-label="Your password"]', { count: 3 });
    await phone.keyboard.press("Backspace");
    await phone.type('input[aria-label="Your password"]', PASSWORD);
    await phone.click("::-p-text(Delete for good)");
    await phone.waitForSelector('input[type="email"]', { timeout: 30_000 });
    must((await phone.evaluate(() => localStorage.getItem("spar.server-session"))) === null, "the marker outlived the account");
    step("the account is deleted; the phone is back at the sign-in form, marker cleared");

    // The laptop's session went with it: its stream is closed, and the next
    // knock is refused, which signs it out.
    await laptop.waitForSelector('input[type="email"]', { timeout: 45_000 });
    step("the laptop was signed out on its own");

    const login = await phone.evaluate(
      async (email, password) => {
        const answer = await fetch("/api/auth/login", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email, password }),
        });
        return { status: answer.status, code: (await answer.json()).code };
      },
      EMAIL,
      PASSWORD,
    );
    must(login.status === 401 && login.code === "invalid_credentials", `signing in again answered ${JSON.stringify(login)}`);
    await phone.waitForFunction(() => document.body.textContent.includes("No one has an account here yet"), {
      timeout: 10_000,
    });
    step("signing in with the deleted account is refused, and the server is empty again (the form offers the first account)");

    must(pageErrors.length === 0, `uncaught errors in the pages:\n  ${pageErrors.join("\n  ")}`);
    step("no uncaught error in either page");
  } catch (error) {
    await phone.screenshot({ path: `${OUT}/failure-phone.png` }).catch(() => {});
    await laptop.screenshot({ path: `${OUT}/failure-laptop.png` }).catch(() => {});
    console.error(`browser: FAILED — ${error instanceof Error ? error.message : error}`);
    if (pageErrors.length) console.error(`browser: page errors:\n  ${pageErrors.join("\n  ")}`);
    await browser.close();
    process.exit(1);
  }
  await browser.close();
}

/**
 * Installed before the app's own scripts: notes whether the full-screen Loading
 * — the gate that waits on the server, standing alone in `.app` — was ever
 * drawn. The board's own "Loading" while the device's store opens sits inside
 * `.deck`, and is not waiting on anybody.
 */
function watchForLoading() {
  new MutationObserver(() => {
    if (document.querySelector(".app > .empty-loading")) window.__sawLoading = true;
  }).observe(document, { childList: true, subtree: true });
}

/** A small grey PNG, written by hand so the container needs nothing installed. */
function greyPng(width, height) {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (bytes) => {
    let c = 0xffffffff;
    for (const b of bytes) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, body) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(body.length, 0);
    head.write(type, 4, "latin1");
    const tail = Buffer.alloc(4);
    tail.writeUInt32BE(crc(Buffer.concat([head.subarray(4), body])), 0);
    return Buffer.concat([head, body, tail]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 0; // greyscale: this app has no colour
  const rows = Buffer.alloc((width + 1) * height);
  for (let y = 0; y < height; y++) {
    rows[y * (width + 1)] = 0;
    for (let x = 0; x < width; x++) rows[y * (width + 1) + 1 + x] = 60 + ((x + y) % 2) * 40;
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(rows)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
