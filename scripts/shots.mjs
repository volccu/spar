#!/usr/bin/env node
/**
 * The README's pictures: stills and GIFs of the public demo, made from the
 * invented sample notes and nothing else.
 *
 *   npm run shots                          build the demo, shoot everything into docs/media/
 *   npm run shots -- --only capture,tidy   just those (hero, canvas, capture, tidy, keep, merge;
 *                                          hero makes hero.png and hero-light.png)
 *   npm run shots -- --out <folder>        somewhere else than docs/media/
 *   npm run shots -- --frames <folder>     also keep every recorded frame there, to look at
 *
 * What it does, in order:
 *
 *   1. refuses to start if `web/src/seed/notes.json` exists (a real archive,
 *      turned into seed data by `npm run seed`). A production build never reads
 *      it — seeding is development-only — so `--i-know-seed-exists` goes on
 *      anyway; the checks in steps 2 and 4 still run;
 *   2. builds the demo (`vite build --mode demo`, no `web/.env`, no backend)
 *      into a temporary folder, and refuses a build that carries a seed chunk;
 *   3. serves it on 127.0.0.1 and drives headless Chrome in the
 *      `zenika/alpine-chrome:with-puppeteer` image, on the host's network so
 *      it reaches loopback (no port is published) — so it needs Docker on
 *      Linux: Docker Desktop's host network does not reach the host's
 *      loopback, and the run stops at ERR_CONNECTION_REFUSED. Every scene starts in a
 *      fresh browser profile, where the empty Inbox offers "Try it with sample
 *      notes" — the one way notes get in here, apart from the Keep scene, which
 *      imports a synthetic Takeout built from `tests/fixtures/keep/takeout-sample/`;
 *   4. before shooting, checks that the browser holds the sample set and only
 *      the sample set: the same number of notes `buildSampleSet` makes, every
 *      one of them a sample or a merge of samples, and the sample boards on
 *      the shelf. Anything else stops the run;
 *   5. turns each recording into a GIF with ffmpeg (palettegen/paletteuse) in a
 *      throwaway container, and removes the ffmpeg image afterwards if this run
 *      pulled it;
 *   6. removes the server, the containers and every temporary file, whatever
 *      happened.
 *
 * The same file is the browser half: run inside the container with
 * `SPAR_SHOTS_ROLE=browser`, it is the Puppeteer script.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { chmod, copyFile, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createServer as createHttpServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateRawSync } from "node:zlib";

const CHROME_IMAGE = "zenika/alpine-chrome:with-puppeteer";
const FFMPEG_IMAGE = "jrottenberg/ffmpeg:7.1-alpine320";
const THIS_FILE = fileURLToPath(import.meta.url);
const SCENES = ["hero", "canvas", "capture", "tidy", "keep", "merge"];
/** The GIFs' width, and the ceiling each must stay under. */
const GIF_WIDTH = 800;
const GIF_MAX_BYTES = 3 * 1024 * 1024;

if (process.env.SPAR_SHOTS_ROLE === "browser") {
  await browserRole();
} else {
  await hostRole();
}

// ---------------------------------------------------------------------------
// The host: guard, build, serve, run the browser, encode, clean up.
// ---------------------------------------------------------------------------

async function hostRole() {
  const ROOT = resolve(dirname(THIS_FILE), "..");
  const args = process.argv.slice(2);
  const option = (name) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const say = (line) => console.log(`shots: ${line}`);
  const only = (option("--only") ?? SCENES.join(",")).split(",").map((s) => s.trim()).filter(Boolean);
  for (const scene of only) {
    if (!SCENES.includes(scene)) {
      console.error(`shots: no scene called "${scene}" (there are ${SCENES.join(", ")})`);
      process.exit(2);
    }
  }
  const media = resolve(option("--out") ?? join(ROOT, "docs/media"));
  const keepFrames = option("--frames") ? resolve(option("--frames")) : null;

  // 1. A real archive on disk is a reason to stop and think, even though the
  //    build below cannot read it (`seedIfEmpty` in store/useNotes.ts runs in
  //    development only, and a production build's glob is empty).
  if (existsSync(join(ROOT, "web/src/seed/notes.json")) && !args.includes("--i-know-seed-exists")) {
    console.error(
      "shots: web/src/seed/notes.json exists — that is a real archive, made by `npm run seed`.\n" +
        "shots: The demo build does not seed from it (seeding is development-only), and every scene\n" +
        "shots: is checked to hold the sample set and nothing else. To go on anyway, pass\n" +
        "shots: --i-know-seed-exists, or move the file out of the checkout first.",
    );
    process.exit(2);
  }

  const tmp = await mkdtemp(join(tmpdir(), "spar-shots-"));
  const web = join(tmp, "web");
  const out = join(tmp, "out");
  await mkdir(out, { recursive: true });
  // The container's user is not necessarily this one.
  await chmod(out, 0o777);
  const container = `spar-shots-${process.pid}`;
  let server = null;
  let pulledFfmpeg = false;

  let cleaned = false;
  const cleanup = async () => {
    if (cleaned) return;
    cleaned = true;
    await run("docker", ["rm", "-f", container], { quiet: true }).catch(() => {});
    await run("docker", ["rm", "-f", `${container}-ffmpeg`], { quiet: true }).catch(() => {});
    if (pulledFfmpeg) {
      await run("docker", ["rmi", FFMPEG_IMAGE], { quiet: true }).catch(() => {});
      say(`removed ${FFMPEG_IMAGE}, which this run pulled`);
    }
    if (server) await new Promise((r) => server.close(r));
    await rm(tmp, { recursive: true, force: true });
  };
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.once(signal, () => {
      void cleanup().then(() => process.exit(130));
    });
  }

  let failed = false;
  try {
    // 2. The demo, into a folder of its own: the checkout's dist-demo/ is not touched.
    say(`building the demo into ${web}`);
    await run(
      process.execPath,
      [join(ROOT, "web/node_modules/vite/bin/vite.js"), "build", "--mode", "demo", "--outDir", web, "--emptyOutDir", "--logLevel", "warn"],
      { cwd: join(ROOT, "web") },
    );
    const assets = await readdir(join(web, "assets"));
    if (!assets.some((name) => /^sampleNotes-/.test(name))) throw new Error("the build has no sampleNotes chunk — is it a demo build?");
    const seedChunk = assets.find((name) => /^(notes|fixture|archive)-/.test(name));
    if (seedChunk) throw new Error(`the build carries a seed chunk (${seedChunk}); refusing to photograph it`);
    for (const name of assets.filter((n) => n.endsWith(".js"))) {
      if ((await readFile(join(web, "assets", name), "utf8")).includes("seed/notes.json")) {
        throw new Error(`assets/${name} names seed/notes.json; refusing to photograph this build`);
      }
    }

    // What the browser must find, and nothing more.
    // The sample set reaches the robot's custom element (through
    // mascotMoments), which extends HTMLElement at load; Node has none, and
    // nothing here draws, so an empty stand-in is enough.
    globalThis.HTMLElement ??= class {};
    globalThis.customElements ??= { define() {}, get() {} };
    const { tsImport } = await import("tsx/esm/api");
    const { buildSampleSet } = await tsImport("../web/src/demo/sampleNotes.ts", import.meta.url);
    const sample = buildSampleSet(new Date());
    const expect = { notes: sample.notes.length, boards: sample.boards.map((b) => b.name) };
    say(`the sample set: ${expect.notes} notes, boards ${expect.boards.join(", ")}`);

    // 3. Serve it, and shoot.
    const port = await freePort(18795);
    server = await serveStatic(web, port);
    say(`serving the demo on http://127.0.0.1:${port}`);

    say(`driving headless Chrome (${CHROME_IMAGE}, host network, nothing published)`);
    await run("docker", [
      "run",
      "--rm",
      "--name",
      container,
      "--network",
      "host",
      "--shm-size",
      "1g",
      "-v",
      `${THIS_FILE}:/usr/src/app/shots/run.mjs:ro`,
      "-v",
      `${join(ROOT, "tests/fixtures/keep/takeout-sample")}:/usr/src/app/takeout:ro`,
      "-v",
      `${out}:/usr/src/app/out`,
      "-e",
      "SPAR_SHOTS_ROLE=browser",
      "-e",
      `SPAR_SHOTS_URL=http://127.0.0.1:${port}`,
      "-e",
      `SPAR_SHOTS_ONLY=${only.join(",")}`,
      "-e",
      `SPAR_SHOTS_EXPECT=${JSON.stringify(expect)}`,
      CHROME_IMAGE,
      "node",
      "/usr/src/app/shots/run.mjs",
    ]);

    // 5. The recordings, as GIFs.
    const recordings = (await readdir(out)).filter((name) => name.startsWith("frames-"));
    if (recordings.length > 0) {
      pulledFfmpeg = !(await imagePresent(FFMPEG_IMAGE));
      if (pulledFfmpeg) say(`pulling ${FFMPEG_IMAGE} for the encoding (removed again at the end)`);
    }
    for (const folder of recordings) {
      const name = folder.slice("frames-".length);
      let gif = null;
      // Fewer colours, then fewer frames, until it fits.
      for (const [colors, fps] of [[128, 12], [64, 12], [48, 10], [32, 8]]) {
        gif = join(out, `${name}.gif`);
        await encodeGif(join(out, folder), gif, { colors, fps, width: GIF_WIDTH, container: `${container}-ffmpeg` });
        const size = (await stat(gif)).size;
        say(`${name}.gif: ${(size / 1024 / 1024).toFixed(2)} MB (${colors} colours, ${fps} fps)`);
        if (size <= GIF_MAX_BYTES) break;
      }
    }

    // Everything made, into the media folder.
    await mkdir(media, { recursive: true });
    const made = (await readdir(out)).filter((n) => /\.(gif|png)$/.test(n) && !/^(hero-desktop|hero-phone)\.png$/.test(n) && !n.startsWith("failure-"));
    for (const name of made) await copyFile(join(out, name), join(media, name));
    say(`wrote ${made.sort().join(", ")} to ${media}`);
    if (keepFrames) {
      await mkdir(keepFrames, { recursive: true });
      await run("cp", ["-r", ...recordings.map((f) => join(out, f)), ...made.map((n) => join(out, n)), keepFrames]);
      say(`frames kept in ${keepFrames}`);
    }
    say("done");
  } catch (error) {
    failed = true;
    console.error(`shots: FAILED — ${error instanceof Error ? error.message : error}`);
    const failures = (await readdir(out).catch(() => [])).filter((n) => n.startsWith("failure-"));
    if (failures.length > 0 && keepFrames) {
      await mkdir(keepFrames, { recursive: true });
      for (const name of failures) await copyFile(join(out, name), join(keepFrames, name));
      say(`the failure's screenshots are in ${keepFrames}`);
    }
  } finally {
    await cleanup();
  }
  process.exit(failed ? 1 : 0);
}

/** A static server for the built demo: its files, and its page for any other path. */
function serveStatic(root, port) {
  const types = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript",
    ".mjs": "text/javascript",
    ".css": "text/css",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".json": "application/json",
    ".webmanifest": "application/manifest+json",
    ".woff2": "font/woff2",
    ".txt": "text/plain; charset=utf-8",
  };
  const server = createHttpServer(async (request, response) => {
    const path = normalize(decodeURIComponent(new URL(request.url ?? "/", "http://x").pathname));
    let file = join(root, path);
    if (!file.startsWith(root + sep) && file !== root) {
      response.writeHead(403).end();
      return;
    }
    try {
      if ((await stat(file)).isDirectory()) file = join(file, "index.html");
    } catch {
      file = join(root, "index.html");
    }
    try {
      const body = await readFile(file);
      response.writeHead(200, { "content-type": types[extname(file)] ?? "application/octet-stream", "cache-control": "no-store" });
      response.end(body);
    } catch {
      response.writeHead(404).end();
    }
  });
  return new Promise((resolveServer, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolveServer(server));
  });
}

/**
 * One recording as a GIF. The frames arrive with their own durations (Chrome
 * sends a frame only when something moved), so they go in through ffmpeg's
 * concat list, are resampled to a steady rate, and share one palette — the app
 * is a warm greyscale, so a small palette loses almost nothing.
 */
async function encodeGif(frames, gif, { colors, fps, width, container }) {
  const uid = typeof process.getuid === "function" ? `${process.getuid()}:${process.getgid()}` : null;
  const filter =
    `fps=${fps},scale=${width}:-2:flags=lanczos,split[a][b];` +
    `[a]palettegen=max_colors=${colors}:stats_mode=full[p];` +
    `[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle`;
  await run("docker", [
    "run",
    "--rm",
    "--name",
    container,
    "--network",
    "none",
    ...(uid ? ["--user", uid] : []),
    "-v",
    `${frames}:/frames:ro`,
    "-v",
    `${dirname(gif)}:/gif`,
    FFMPEG_IMAGE,
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    "/frames/list.txt",
    "-vf",
    filter,
    "-loop",
    "0",
    `/gif/${gif.slice(dirname(gif).length + 1)}`,
  ]);
}

async function imagePresent(image) {
  try {
    await run("docker", ["image", "inspect", image], { quiet: true });
    return true;
  } catch {
    return false;
  }
}

/** The wanted port if nothing holds it, or any free loopback port. */
async function freePort(wanted) {
  const tryPort = (p) =>
    new Promise((resolvePort) => {
      const probe = createNetServer();
      probe.once("error", () => resolvePort(null));
      probe.listen(p, "127.0.0.1", () => {
        const { port } = probe.address();
        probe.close(() => resolvePort(port));
      });
    });
  return (await tryPort(wanted)) ?? (await tryPort(0));
}

function run(command, argv, { cwd, env, quiet = false } = {}) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, argv, { cwd, env, stdio: quiet ? "ignore" : "inherit" });
    child.once("error", reject);
    child.once("exit", (code) => (code === 0 ? resolveRun() : reject(new Error(`${command} ${argv[0]} exited ${code}`))));
  });
}

// ---------------------------------------------------------------------------
// The browser: one fresh profile per scene. Runs in the container.
// ---------------------------------------------------------------------------

async function browserRole() {
  const BASE = process.env.SPAR_SHOTS_URL;
  const OUT = "/usr/src/app/out";
  const TAKEOUT = "/usr/src/app/takeout";
  const ONLY = (process.env.SPAR_SHOTS_ONLY ?? SCENES.join(",")).split(",");
  const EXPECT = JSON.parse(process.env.SPAR_SHOTS_EXPECT ?? "{}");
  const { default: puppeteer } = await import("puppeteer");
  const started = Date.now();
  const step = (what) => console.log(`browser: ${((Date.now() - started) / 1000).toFixed(1).padStart(5)}s  ${what}`);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const must = (ok, what) => {
    if (!ok) throw new Error(what);
  };

  const browser = await puppeteer.launch({
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || "/usr/bin/chromium-browser",
    args: [
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--hide-scrollbars",
      "--force-color-profile=srgb",
      "--font-render-hinting=none",
    ],
  });
  const pageErrors = [];

  const DESKTOP = { width: 1440, height: 900, deviceScaleFactor: 1 };
  const PHONE = { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
  /** What the GIFs are recorded at: scaled to 800 wide, the words stay readable. */
  const CLIP = { width: 1000, height: 625, deviceScaleFactor: 1 };

  /** A new profile — empty IndexedDB, no service worker — on the demo. */
  const fresh = async (viewport, { pointer = false, theme = null } = {}) => {
    const context = await browser.createBrowserContext();
    const page = await context.newPage();
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.setViewport(viewport);
    // The image's Chromium predates Promise.try, which the PDF reader calls;
    // every browser the app supports has it.
    await page.evaluateOnNewDocument(() => {
      Promise.try ??= (fn, ...args) => new Promise((resolve) => resolve(fn(...args)));
    });
    if (!viewport.isMobile) await page.evaluateOnNewDocument(answerAsDesktop);
    if (pointer) await page.evaluateOnNewDocument(drawPointer);
    // The light ramp is a device setting (lib/settings.ts); dark needs nothing.
    if (theme) await page.evaluateOnNewDocument((t) => localStorage.setItem("spar.theme", t), theme);
    await page.goto(BASE, { waitUntil: "load" });
    return { context, page };
  };

  /** The notes this profile holds, read from the app's own database. */
  const storedNotes = (page) =>
    page.evaluate(
      () =>
        new Promise((resolveNotes, reject) => {
          const open = indexedDB.open("spar");
          open.onerror = () => reject(open.error);
          open.onsuccess = () => {
            const db = open.result;
            if (!db.objectStoreNames.contains("notes")) {
              db.close();
              resolveNotes([]);
              return;
            }
            const all = db.transaction("notes").objectStore("notes").getAll();
            all.onsuccess = () => {
              db.close();
              resolveNotes(all.result.map((n) => ({ source: n.source, keep_id: n.keep_id ?? null })));
            };
            all.onerror = () => reject(all.error);
          };
        }),
    );

  /**
   * "Try it with sample notes" on the empty Inbox, and then proof that what
   * the browser holds is that set and only that set.
   */
  const loadSamples = async (page, { checkBoards = true } = {}) => {
    await page.waitForFunction(() => document.body.textContent.includes("Try it with sample notes"), { timeout: 30_000 });
    must((await storedNotes(page)).length === 0, "a fresh profile already holds notes");
    await page.click("::-p-text(Try it with sample notes)");
    await page.waitForSelector(".card", { timeout: 30_000 });
    await sleep(500);
    const notes = await storedNotes(page);
    must(notes.length === EXPECT.notes, `the browser holds ${notes.length} notes; the sample set is ${EXPECT.notes}`);
    must(
      notes.every((n) => n.source === "sample" || n.source === "merge"),
      `a note that is not a sample: sources ${[...new Set(notes.map((n) => n.source))].join(", ")}`,
    );
    if (checkBoards) {
      const tabs = await page.evaluate(() => [...document.querySelectorAll(".board-tab")].map((t) => t.textContent.replace(/\d+$/, "").trim()));
      for (const name of EXPECT.boards) must(tabs.includes(name), `the sample board ${name} is not on the shelf`);
      const automatic = ["Inbox", "Archive", "Inspiration", "Todos", "Links", "Files", "All", "Trash", ""];
      const extra = tabs.filter((t) => !EXPECT.boards.includes(t) && !automatic.includes(t));
      must(extra.length === 0, `boards that are not the sample set's: ${extra.join(", ")}`);
    }
    // The load's own undo offer, gone, so it is in no picture.
    await page.waitForFunction(() => !document.querySelector(".undo") && !document.querySelector(".speech"), { timeout: 30_000 });
    // Then the demo's one tip ("Hold a note to pick it"), said just after the
    // offer and kept for KEEP_MS (30 s): waited out, so it is in no picture either.
    const tip = await page
      .waitForFunction(() => document.querySelector(".speech")?.textContent.includes("Hold a note"), { timeout: 3_000 })
      .then(() => true, () => false);
    if (tip) await page.waitForFunction(() => !document.querySelector(".speech"), { timeout: 45_000 });
    await sleep(400);
  };

  /** Moves the drawn pointer to an element the way a hand would, and clicks it. */
  const clickOn = async (page, target, { button = "left", settle = 150, click = true } = {}) => {
    const handle = typeof target === "string" ? await page.waitForSelector(target, { timeout: 15_000 }) : target;
    must(handle, `nothing to click: ${target}`);
    const inView = await handle.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return r.top >= 0 && r.bottom <= innerHeight;
    });
    if (!inView) {
      await handle.evaluate((el) => el.scrollIntoView({ block: "center", behavior: "smooth" }));
      await sleep(700);
    }
    const box = await handle.boundingBox();
    must(box, `not on screen: ${target}`);
    const x = box.x + box.width / 2;
    const y = box.y + Math.min(box.height / 2, 40);
    await page.mouse.move(x, y, { steps: 18 });
    await sleep(settle);
    if (click) await page.mouse.click(x, y, { button });
  };
  /** One of the Sorter's answers, by its name ("Archive", "Home", "Done"…). */
  const sorterButton = async (page, name) => {
    const handle = await page.evaluateHandle(
      (n) => [...document.querySelectorAll(".sorter-dest")].find((b) => b.querySelector(".sorter-dest-name")?.textContent === n) ?? null,
      name,
    );
    must(await handle.evaluate((el) => el !== null), `the Sorter offers no "${name}"`);
    return handle;
  };
  const card = async (page, text) => {
    const handle = await page.evaluateHandle(
      (t) => [...document.querySelectorAll(".card")].find((c) => c.textContent.includes(t)) ?? null,
      text,
    );
    must(await handle.evaluate((el) => el !== null), `no card reads "${text}"`);
    return handle;
  };

  /**
   * Records whatever `act` does, as frames with their durations, into
   * frames-<name>/ for the host to encode. Chrome sends a frame only when the
   * page changed, so a still moment is one frame held.
   */
  const record = async (page, name, act) => {
    const dir = `${OUT}/frames-${name}`;
    await mkdir(dir, { recursive: true });
    const cdp = await page.createCDPSession();
    const frames = [];
    const writes = [];
    cdp.on("Page.screencastFrame", ({ data, metadata, sessionId }) => {
      const file = `f${String(frames.length).padStart(5, "0")}.png`;
      frames.push({ file, t: metadata.timestamp });
      writes.push(writeFile(`${dir}/${file}`, Buffer.from(data, "base64")));
      void cdp.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
    });
    await cdp.send("Page.startScreencast", { format: "png", everyNthFrame: 1 });
    await sleep(300);
    const from = Date.now() / 1000;
    await act();
    const until = Date.now() / 1000;
    await cdp.send("Page.stopScreencast");
    await Promise.all(writes);
    await cdp.detach();
    must(frames.length > 1, `the ${name} recording caught ${frames.length} frame(s)`);
    // Frames from before `act` began are trimmed to the last one, which is
    // what was on screen when it did.
    const lead = frames.findLastIndex((f) => f.t <= from);
    const kept = lead > 0 ? frames.slice(lead) : frames;
    const lines = ["ffconcat version 1.0"];
    kept.forEach((frame, i) => {
      const next = i + 1 < kept.length ? kept[i + 1].t : until;
      lines.push(`file '${frame.file}'`, `duration ${Math.max(0.01, next - frame.t).toFixed(3)}`);
    });
    // The concat demuxer ignores the last entry's duration without this.
    lines.push(`file '${kept.at(-1).file}'`);
    await writeFile(`${dir}/list.txt`, lines.join("\n") + "\n");
    step(`recorded ${name}: ${kept.length} frames over ${(until - from).toFixed(1)}s`);
  };

  const scenes = {
    /** Desktop and phone side by side, in one picture, in each theme. */
    async hero() {
      for (const theme of ["dark", "light"]) {
        const desk = await fresh(DESKTOP, { theme });
        await loadSamples(desk.page);
        await desk.page.mouse.move(DESKTOP.width - 2, DESKTOP.height - 2);
        await sleep(300);
        const desktopShot = await desk.page.screenshot({ type: "png" });
        await desk.context.close();

        const phone = await fresh(PHONE, { theme });
        await loadSamples(phone.page, { checkBoards: false });
        const phoneShot = await phone.page.screenshot({ type: "png" });
        await phone.context.close();

        const name = theme === "dark" ? "hero.png" : "hero-light.png";
        const stage = await fresh({ width: 1920, height: 979, deviceScaleFactor: 1 });
        await stage.page.setContent(heroPage(desktopShot.toString("base64"), phoneShot.toString("base64"), theme), { waitUntil: "load" });
        await stage.page.screenshot({ path: `${OUT}/${name}`, type: "png" });
        await stage.context.close();
        step(`${name}: the Inbox on a desktop and a phone`);
      }
    },

    /** The trip's idea, opened: its notes laid out on the canvas. */
    async canvas() {
      const { context, page } = await fresh(DESKTOP);
      await loadSamples(page);
      await page.click("::-p-text(Lisbon in May)");
      await page.waitForFunction(() => [...document.querySelectorAll(".card")].some((c) => (c.getAttribute("aria-label") ?? "").startsWith("Idea:")), { timeout: 10_000 });
      await page.evaluate(() => [...document.querySelectorAll(".card")].find((c) => (c.getAttribute("aria-label") ?? "").startsWith("Idea:")).click());
      await page.waitForSelector('button[aria-label="Close idea"]', { timeout: 10_000 });
      await sleep(1500);
      // Laid out by hand, as a person would: two notes dragged into place, a
      // line drawn between them, and a word written on the canvas itself.
      const drag = async (from, to) => {
        await page.mouse.move(...from);
        await page.mouse.down();
        await page.mouse.move(...to, { steps: 25 });
        await page.mouse.up();
        await sleep(400);
      };
      await drag([150, 380], [1040, 250]); // Sintra, off to the right
      await drag([700, 140], [520, 470]); // eating, below the stay
      // Where the box, the words and the highlight go, on that layout.
      const SHAPE_FROM = [34, 90];
      const SHAPE_TO = [598, 348];
      const TEXT_AT = [918, 478];
      const HIGHLIGHT = [[922, 497], [1100, 497]];
      /** A tool from the bar; and one of a choice menu's items, opened from its button. */
      const tool = async (name) => {
        await page.click(`button.canvas-tool-btn[aria-label="${name}"]`);
        await sleep(300);
      };
      const choose = async (opener, item) => {
        await page.click(opener);
        await sleep(300);
        await page.click(item);
        await sleep(300);
      };
      await tool("Draw");
      await choose('button[aria-label^="Pen colour"]', '.canvas-palette-item[aria-label="Clay"]');
      const stroke = async (points) => {
        await page.mouse.move(...points[0]);
        await page.mouse.down();
        for (const point of points.slice(1)) await page.mouse.move(...point, { steps: 6 });
        await page.mouse.up();
        await sleep(300);
      };
      // From the stay, round to Sintra: a loose curve and an arrowhead.
      const curve = [];
      for (let i = 0; i <= 24; i++) {
        const t = i / 24;
        curve.push([600 + t * 300, 230 - Math.sin(t * Math.PI) * 90 + t * 20]);
      }
      await stroke(curve);
      await stroke([[880, 236], [902, 250], [884, 268]]);
      // A box round the two that go together, with the shape tool, in a second pen.
      await tool("Shapes");
      await choose('button[aria-label^="Shape:"]', "::-p-text(Rectangle)");
      await choose('button[aria-label^="Pen colour"]', '.canvas-palette-item[aria-label="Sage"]');
      await page.mouse.move(...SHAPE_FROM);
      await page.mouse.down();
      await page.mouse.move(...SHAPE_TO, { steps: 20 });
      await page.mouse.up();
      await sleep(300);
      // Words on the canvas itself, then the highlighter across them.
      await tool("Move");
      await page.mouse.click(...TEXT_AT, { button: "right" });
      await sleep(400);
      await page.click("::-p-text(Add text)");
      await sleep(500);
      await page.keyboard.type("Only if the weather holds", { delay: 20 });
      await sleep(300);
      await page.keyboard.down("Control");
      await page.keyboard.press("Enter");
      await page.keyboard.up("Control");
      await sleep(600);
      await tool("Highlighter");
      await choose('button[aria-label^="Pen colour"]', '.canvas-palette-item[aria-label="Ochre"]');
      await stroke(HIGHLIGHT);
      await tool("Move");
      await sleep(1200);
      await page.mouse.move(DESKTOP.width - 2, DESKTOP.height - 2);
      await page.screenshot({ path: `${OUT}/canvas.png`, type: "png" });
      await context.close();
      step("canvas.png: the Lisbon in May idea");
    },

    /** Type, Enter, and the note is on the board. */
    async capture() {
      const { context, page } = await fresh(CLIP, { pointer: true });
      await loadSamples(page);
      await page.mouse.move(640, 300);
      await record(page, "capture", async () => {
        await sleep(900);
        await clickOn(page, 'textarea[aria-label="Write a note"]');
        await sleep(300);
        await page.keyboard.type("Book the car in for a service before the long drive", { delay: 55 });
        await sleep(500);
        await page.keyboard.press("Enter");
        await page.waitForFunction(() => [...document.querySelectorAll(".card")].some((c) => c.textContent.includes("Book the car in")), { timeout: 5_000 });
        await sleep(2600);
      });
      await context.close();
    },

    /** Tidy up, one note at a time, until the pile is gone. */
    async tidy() {
      const { context, page } = await fresh(CLIP, { pointer: true });
      await loadSamples(page);
      // Where each note in the recorded pile goes; everything else is
      // archived before the recording starts, so the pile is a short one.
      const fates = [
        ["electricity bill due fri", { board: "Home" }],
        ["film maria mentioned", { verb: "Archive" }],
        ["bakery on the corner", { verb: "Delete" }],
        ["miso butter mushrooms", { board: "Kitchen" }],
        ["printer ink 305XL", { board: "Work" }],
      ];
      const fateOf = async () => {
        const text = await page.$eval(".sorter-note", (el) => el.textContent);
        return fates.find(([words]) => text.includes(words))?.[1] ?? null;
      };
      const sorterAt = () => page.waitForSelector(".sorter-note, .sorter-end", { timeout: 10_000 });

      // Off camera: the rest of the pile, archived.
      await page.click('button[aria-label="Menu"]');
      await page.click("::-p-text(Tidy up)");
      for (;;) {
        await sorterAt();
        if (await page.$(".sorter-end")) break;
        const fate = await fateOf();
        if (fate) await page.click("button.sorter-skip");
        else await (await sorterButton(page, "Archive")).click();
        await sleep(350);
      }
      await (await sorterButton(page, "Done")).click();
      await page.waitForFunction(() => !document.querySelector(".sorter"), { timeout: 10_000 });
      await sleep(600);
      must((await page.$$(".card")).length === fates.length, "the pile is not the five notes the recording expects");
      await page.waitForFunction(() => !document.querySelector(".undo") && !document.querySelector(".speech"), { timeout: 30_000 });

      await page.mouse.move(700, 250);
      await record(page, "tidy", async () => {
        await sleep(1000);
        await clickOn(page, 'button[aria-label="Menu"]');
        await sleep(700);
        await clickOn(page, "::-p-text(Tidy up)");
        for (;;) {
          await sorterAt();
          if (await page.$(".sorter-end")) break;
          await sleep(1100);
          const fate = await fateOf();
          must(fate, "a note in the pile nobody planned for");
          if (fate.board) {
            // A few folders are buttons of their own; more sit behind one row.
            const direct = await page.evaluate(
              (n) => [...document.querySelectorAll(".sorter-dest-name")].some((el) => el.textContent === n),
              fate.board,
            );
            if (!direct) {
              await clickOn(page, await sorterButton(page, "Move to a board…"));
              await sleep(600);
            }
            await clickOn(page, await sorterButton(page, fate.board));
          } else {
            await clickOn(page, await sorterButton(page, fate.verb));
          }
          await sleep(450);
        }
        await sleep(2600);
        await clickOn(page, await sorterButton(page, "Done"));
        await page.waitForFunction(() => !document.querySelector(".sorter"), { timeout: 10_000 });
        await sleep(2800);
      });
      must((await page.$$(".card")).length === 0, "the Inbox is not empty after Tidy up");
      await context.close();
    },

    /** A Google Takeout, chosen on the import screen, lands in the app. */
    async keep() {
      const { context, page } = await fresh(CLIP, { pointer: true });
      await page.waitForFunction(() => document.body.textContent.includes("Import from Google Keep"), { timeout: 30_000 });
      must((await storedNotes(page)).length === 0, "a fresh profile already holds notes");
      const zip = `${OUT}/takeout-sample.zip`;
      await writeFile(zip, await syntheticTakeout(page, TAKEOUT));

      await page.mouse.move(640, 200);
      await record(page, "keep", async () => {
        await sleep(1200);
        await clickOn(page, "::-p-text(Import from Google Keep)");
        await page.waitForSelector("::-p-text(Choose the zip)", { timeout: 10_000 });
        await sleep(1400);
        const [chooser] = await Promise.all([page.waitForFileChooser({ timeout: 10_000 }), clickOn(page, "::-p-text(Choose the zip)")]);
        await chooser.accept([zip]);
        await page.waitForSelector("::-p-text(What was found)", { timeout: 20_000 });
        await sleep(1800);
        // Two of the labels stay in the Inbox rather than becoming boards.
        for (const label of ["Errands", "Someday"]) {
          const select = `select[aria-label="Where the notes labelled ${label} go"]`;
          await clickOn(page, select, { click: false });
          await sleep(300);
          await page.select(select, "inbox");
          await sleep(900);
        }
        const importButton = await page.waitForSelector(".keep-actions ::-p-text(Import)", { timeout: 10_000 });
        await clickOn(page, importButton);
        await page.waitForSelector("::-p-text(Undo this import)", { timeout: 30_000 });
        await sleep(2400);
        await clickOn(page, ".keep-actions ::-p-text(Show my notes)");
        await page.waitForSelector(".card", { timeout: 10_000 });
        await sleep(3000);
      });
      const notes = await storedNotes(page);
      must(notes.length > 0 && notes.every((n) => n.keep_id), "the import brought in something that is not from the synthetic Takeout");
      await context.close();
    },

    /** Two notes merged into an idea, and the merge taken back. */
    async merge() {
      const { context, page } = await fresh(CLIP, { pointer: true });
      await loadSamples(page);
      await page.mouse.move(700, 300);
      await record(page, "merge", async () => {
        await sleep(900);
        await clickOn(page, await card(page, "electricity bill due fri"), { button: "right" });
        await sleep(600);
        // The right-click opened the selection panel at the pointer; it goes,
        // the selection stays, and Ctrl+click adds the second note.
        await page.keyboard.press("Escape");
        await sleep(500);
        await page.keyboard.down("Control");
        await clickOn(page, await card(page, "call dentist"));
        await page.keyboard.up("Control");
        await sleep(700);
        await clickOn(page, "button.capture-menu");
        await sleep(900);
        await clickOn(page, "::-p-text(Merge 2)");
        await page.waitForSelector('button[aria-label="Close idea"]', { timeout: 10_000 });
        await sleep(2000);
        // Back on the board, the two are one idea card; opened again, taken apart.
        await clickOn(page, 'button[aria-label="Close idea"]');
        await page.waitForFunction(() => !document.querySelector('button[aria-label="Close idea"]'), { timeout: 10_000 });
        await sleep(2200);
        const idea = await page.evaluateHandle(
          () => [...document.querySelectorAll(".card")].find((c) => /^idea/i.test(c.getAttribute("aria-label") ?? "")) ?? null,
        );
        must(await idea.evaluate((el) => el !== null), "no idea card on the board after the merge");
        await clickOn(page, idea);
        await page.waitForSelector('button[aria-label="Close idea"]', { timeout: 10_000 });
        await sleep(1200);
        await page.mouse.move(760, 110, { steps: 18 });
        await sleep(200);
        await page.mouse.click(760, 110, { button: "right" });
        await sleep(1000);
        await clickOn(page, "::-p-text(Separate)");
        await page.waitForFunction(() => !document.querySelector('button[aria-label="Close idea"]'), { timeout: 10_000 });
        await sleep(2800);
      });
      await context.close();
    },
  };

  try {
    for (const name of ONLY) {
      step(`scene: ${name}`);
      await scenes[name]();
    }
    must(pageErrors.length === 0, `uncaught errors in the pages:\n  ${pageErrors.join("\n  ")}`);
  } catch (error) {
    for (const [i, context] of browser.browserContexts().entries()) {
      for (const [j, page] of (await context.pages()).entries()) {
        await page.screenshot({ path: `${OUT}/failure-${i}-${j}.png` }).catch(() => {});
      }
    }
    console.error(`browser: FAILED — ${error instanceof Error ? error.message : error}`);
    if (pageErrors.length) console.error(`browser: page errors:\n  ${pageErrors.join("\n  ")}`);
    await browser.close();
    process.exit(1);
  }
  await browser.close();
}

/**
 * A pointer drawn into the page, because a headless screen has none and a GIF
 * of clicks nobody can see is a slideshow. Installed before the app's scripts;
 * it takes no events and sits above everything.
 */
function drawPointer() {
  const install = () => {
    if (document.getElementById("shots-pointer")) return;
    const pointer = document.createElement("div");
    pointer.id = "shots-pointer";
    pointer.innerHTML =
      '<svg width="22" height="24" viewBox="0 0 22 24" xmlns="http://www.w3.org/2000/svg">' +
      '<path d="M2 1.5 L2 18 L6.6 14 L9.8 21.5 L13 20.1 L9.9 12.8 L16 12.8 Z" fill="#ded5c6" stroke="#0c0a08" stroke-width="1.5" stroke-linejoin="round"/></svg>';
    Object.assign(pointer.style, {
      position: "fixed",
      left: "-50px",
      top: "-50px",
      zIndex: "2147483647",
      pointerEvents: "none",
      transform: "translate(-2px, -1px)",
    });
    document.documentElement.appendChild(pointer);
    addEventListener(
      "mousemove",
      (event) => {
        pointer.style.left = `${event.clientX}px`;
        pointer.style.top = `${event.clientY}px`;
      },
      true,
    );
  };
  if (document.readyState === "loading") addEventListener("DOMContentLoaded", install);
  else install();
}

/**
 * Headless Chrome answers `(hover: none)` and `(pointer: none)`, and no flag or
 * emulation in this image changes that, so the app takes it for a phone with a
 * screen keyboard: Enter breaks the line instead of saving, and the keyboard
 * hints are not drawn. This answers the scripts' media questions about hover and
 * pointer as a desktop with a mouse would; every other query goes to the real
 * `matchMedia`. (CSS media queries are not reached, so hover styles stay off.)
 */
function answerAsDesktop() {
  const real = window.matchMedia.bind(window);
  const term = (text) => {
    const m = /^\(\s*(any-)?(hover|pointer)\s*:\s*([a-z-]+)\s*\)$/.exec(text.trim());
    if (!m) return null;
    return m[2] === "hover" ? m[3] === "hover" : m[3] === "fine";
  };
  const answer = (query) => {
    let any = false;
    for (const part of query.split(",")) {
      const negated = /^\s*not\s+/.test(part);
      const terms = part.replace(/^\s*(not|only)\s+/, "").split(/\s+and\s+/);
      const values = terms.map(term);
      if (values.some((v) => v === null)) return null;
      const all = values.every(Boolean);
      if (negated ? !all : all) any = true;
    }
    return any;
  };
  window.matchMedia = (query) => {
    const matches = answer(String(query));
    if (matches === null) return real(query);
    return {
      matches,
      media: String(query),
      onchange: null,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
      dispatchEvent: () => false,
    };
  };
}

/** The hero: the desktop and the phone on the app's own ground, each inside a hairline. */
/** The stage both shots stand on: the ramp's own paper and rule, per theme. */
function heroPage(desktop, phone, theme = "dark") {
  const [paper, rule] = theme === "light" ? ["#f3efe7", "#cfc6bd"] : ["#0c0a08", "#423830"];
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    html, body { margin: 0; background: ${paper}; }
    .stage { width: 1920px; height: 979px; display: flex; align-items: center; justify-content: center; gap: 40px; }
    img { display: block; border: 1px solid ${rule}; }
    .desktop { width: 1400px; height: 875px; }
    .phone { width: 404px; height: 875px; }
  </style></head><body><div class="stage">
    <img class="desktop" src="data:image/png;base64,${desktop}" alt="">
    <img class="phone" src="data:image/png;base64,${phone}" alt="">
  </div></body></html>`;
}

/**
 * A Google Takeout zip made from the invented fixture in
 * `tests/fixtures/keep/takeout-sample/Keep/`, with the pictures its notes name
 * drawn here in greyscale (the fixture holds only the JSON). The voice memo's
 * recording is left out of its note: a sound cannot be drawn, and a file the
 * Takeout names but does not hold would show up as missing.
 */
async function syntheticTakeout(page, fixture) {
  const names = (await readdir(`${fixture}/Keep`)).sort();
  const entries = [];
  for (const name of names) {
    let body = await readFile(`${fixture}/Keep/${name}`);
    if (name === "Voice memo.json") {
      const note = JSON.parse(body.toString("utf8"));
      delete note.attachments;
      body = Buffer.from(JSON.stringify(note));
    }
    entries.push({ path: `Takeout/Keep/${name}`, data: body });
  }
  const pictures = await page.evaluate(async () => {
    const draw = (width, height, paint, type) => {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const g = canvas.getContext("2d");
      paint(g, width, height);
      return canvas.toDataURL(type, 0.86).split(",")[1];
    };
    const ferry = draw(
      800,
      560,
      (g, w, h) => {
        const sky = g.createLinearGradient(0, 0, 0, h * 0.6);
        sky.addColorStop(0, "#3a3835");
        sky.addColorStop(1, "#b9b4ab");
        g.fillStyle = sky;
        g.fillRect(0, 0, w, h * 0.6);
        g.fillStyle = "#57544f";
        g.beginPath();
        g.moveTo(0, h * 0.6);
        [0.52, 0.48, 0.55, 0.5, 0.57, 0.53].forEach((y, i) => g.lineTo((w * (i + 1)) / 6, h * y));
        g.lineTo(w, h * 0.6);
        g.fill();
        const sea = g.createLinearGradient(0, h * 0.6, 0, h);
        sea.addColorStop(0, "#77736c");
        sea.addColorStop(1, "#1d1c1a");
        g.fillStyle = sea;
        g.fillRect(0, h * 0.6, w, h * 0.4);
        g.fillStyle = "#d8d3ca";
        for (let i = 0; i < 12; i++) g.fillRect(w * 0.2 + i * 37, h * 0.66 + (i % 3) * 22, 26, 2);
        // The deck rail in the foreground.
        g.fillStyle = "#141311";
        g.fillRect(0, h * 0.86, w, 10);
        for (let x = 20; x < w; x += 90) g.fillRect(x, h * 0.86, 8, h * 0.14);
      },
      "image/jpeg",
    );
    const swatch = draw(
      600,
      400,
      (g, w, h) => {
        g.fillStyle = "#e9e6e0";
        g.fillRect(0, 0, w, h);
        ["#b8b4ad", "#8f8b85", "#6c6964", "#4b4945"].forEach((tone, i) => {
          g.fillStyle = tone;
          g.fillRect(40 + i * 135, 60, 115, 280);
        });
      },
      "image/jpeg",
    );
    const doodle = draw(
      600,
      600,
      (g, w, h) => {
        g.fillStyle = "#cfcac2";
        g.fillRect(0, 0, w, h);
        g.strokeStyle = "#2b2a28";
        g.lineWidth = 6;
        g.lineCap = "round";
        g.beginPath();
        g.arc(w / 2, h / 2, 150, 0, Math.PI * 2);
        g.moveTo(w / 2 - 60, h / 2 - 40);
        g.arc(w / 2 - 60, h / 2 - 40, 4, 0, Math.PI * 2);
        g.moveTo(w / 2 + 64, h / 2 - 40);
        g.arc(w / 2 + 60, h / 2 - 40, 4, 0, Math.PI * 2);
        g.moveTo(w / 2 - 80, h / 2 + 50);
        g.quadraticCurveTo(w / 2, h / 2 + 120, w / 2 + 80, h / 2 + 50);
        g.stroke();
      },
      "image/png",
    );
    return { ferry, swatch, doodle };
  });
  entries.push({ path: "Takeout/Keep/ferry.jpg", data: Buffer.from(pictures.ferry, "base64") });
  entries.push({ path: "Takeout/Keep/swatch.jpeg", data: Buffer.from(pictures.swatch, "base64") });
  entries.push({ path: "Takeout/Keep/doodle.png", data: Buffer.from(pictures.doodle, "base64") });
  return zipOf(entries);
}

/** A plain deflated zip, written by hand so the container needs nothing installed. */
function zipOf(entries) {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc32 = (bytes) => {
    let c = 0xffffffff;
    for (const b of bytes) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { path, data } of entries) {
    const name = Buffer.from(path, "utf8");
    const packed = deflateRawSync(data);
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, packed);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(packed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += local.length + name.length + packed.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}
