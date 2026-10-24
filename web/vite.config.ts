import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import { motionSetting } from "./src/lib/motionSetting.ts";

/**
 * One of the two worker files, named with a fingerprint of its own bytes.
 *
 * push-sw.js and share-sw.js are `importScripts`ed at the top of the generated
 * worker and are in `globIgnores`, so nothing about them reaches the precache
 * manifest — which meant a change to either produced a **byte-identical**
 * sw.js. A browser decides whether to install a new worker by comparing it
 * with the bytes of the one it already has, so an edit to the reminder handler
 * or the share handler was live on a fresh install and invisible forever on
 * every device that already had the app: the two files that can only be fixed
 * by shipping them were the two the deploy could not reach. The hash in the
 * query string is what changes those bytes.
 *
 * It buys the fetch as well. A registration's `updateViaCache` defaults to
 * `"imports"`, which means the imported scripts are the part still served from
 * the ordinary HTTP cache — so even a worker that did update could re-import
 * yesterday's copy of its own import.
 *
 * A query rather than a hashed filename because nothing renames these: they
 * are plain files copied out of public/ verbatim, and the manifest's
 * share_target and the push subscription both name the paths.
 */
const stamped = (name: string) => {
  const bytes = readFileSync(fileURLToPath(new URL(`./public/${name}`, import.meta.url)));
  return `/${name}?v=${createHash("sha256").update(bytes).digest("hex").slice(0, 8)}`;
};

/**
 * The packages whose files make up the picture-reading engine — the library,
 * its core and the two language files.
 */
const OCR_PACKAGES = ["tesseract.js", "tesseract.js-core", "@tesseract.js-data/eng", "@tesseract.js-data/fin"];

/**
 * The runtime cache the engine is kept in, named for the installed versions of
 * those packages (`ocr-engine-` and eight hex characters of their hash). The
 * `/ocr/` files are not hashed, so a cache-first rule would serve a device last
 * year's worker beside this year's core for ninety days; a new version is a new
 * name instead, and the change needs nobody to remember a number. Workbox
 * forgets an old runtime cache only for the precache, so the previous one idles
 * on the device, as `pdf-viewer-1` does. `buildInvariants.test.ts` recomputes
 * the name from the same four versions and finds it in the built `sw.js`.
 */
const ocrCacheName = () => {
  const versions = OCR_PACKAGES.map((name) => {
    const manifest = fileURLToPath(new URL(`./node_modules/${name}/package.json`, import.meta.url));
    return `${name}@${(JSON.parse(readFileSync(manifest, "utf8")) as { version: string }).version}`;
  });
  return `ocr-engine-${createHash("sha256").update(versions.join("\n")).digest("hex").slice(0, 8)}`;
};

/**
 * The text-reading engine's own files, served from this app's origin under
 * `/ocr/` (FX-A-07: pictures are read on the device, and nothing is fetched from
 * a CDN at run time).
 *
 * Copied out of the packages the build already installs rather than committed
 * as ten megabytes of binaries: the worker, the three LSTM-only builds of the
 * core (the engine asks the device what it can run and fetches one), and the
 * English and Finnish language files. A device fetches one core, both language
 * files and the worker (about 10.8 MB) the first time a picture is read, and
 * keeps them by the runtime rule below — never the precache (`globIgnores`).
 * Emitted from the build, so the dev server does not have them; the reader then
 * fails to load its engine, which is recorded as nothing.
 */
const ocrAssets = (): Plugin => {
  const modules = (name: string) => fileURLToPath(new URL(`./node_modules/${name}`, import.meta.url));
  const files: [string, string][] = [
    ["ocr/worker.min.js", modules("tesseract.js/dist/worker.min.js")],
    ...["lstm", "simd-lstm", "relaxedsimd-lstm"].map(
      (v): [string, string] => [
        `ocr/tesseract-core-${v}.wasm.js`,
        modules(`tesseract.js-core/tesseract-core-${v}.wasm.js`),
      ],
    ),
    ...["eng", "fin"].map(
      (l): [string, string] => [
        `ocr/${l}.traineddata.gz`,
        modules(`@tesseract.js-data/${l}/4.0.0_best_int/${l}.traineddata.gz`),
      ],
    ),
  ];
  return {
    name: "spar-ocr-assets",
    apply: "build",
    generateBundle() {
      for (const [fileName, from] of files) {
        if (!existsSync(from)) this.error(`OCR asset missing: ${join(from)}`);
        this.emitFile({ type: "asset", fileName, source: readFileSync(from) });
      }
    },
  };
};

/**
 * Which build this is, for the About page (`lib/build.ts`): the commit it was
 * built from and when. The deploy hook builds inside a git checkout on the
 * server, so the commit is there; anywhere it is not — a copied folder, a
 * build with no git on the path — the page says "unknown" rather than the
 * build failing over a line of colophon.
 */
const BUILD = (() => {
  let commit = "unknown";
  try {
    commit = execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  } catch {
    // Not a checkout. The build is still a build.
  }
  return { commit, built: new Date().toISOString() };
})();

/**
 * The public demo (`npm run build:demo`, which is `vite build --mode demo`).
 *
 * Same app, three differences, and every one of them is made here rather than
 * by an environment the caller has to remember to clear:
 *
 * - **No backend, whatever is lying around.** `envDir: false` reads no `.env`
 *   at all — the owner's server holds a `web/.env` with the Supabase project in
 *   it — and the backend variables are defined empty on top, so a `VITE_*` in
 *   the shell cannot reach the bundle either. With no project the app opens
 *   straight onto this device's board, with no sign-in screen.
 * - **`VITE_DEMO` is `"1"`**, which is what `DEMO` in `src/lib/demo.ts` reads.
 *   Everywhere else it is undefined and every demo line folds away.
 * - **It lands in `dist-demo/`**, beside the host's files from `demo-site/`
 *   (`demoSite` below), so a demo build can never be mistaken for, or copied
 *   over, the build the deploy hook serves.
 */
const DEMO_ENV = {
  "import.meta.env.VITE_DEMO": JSON.stringify("1"),
  "import.meta.env.VITE_SUPABASE_URL": JSON.stringify(""),
  "import.meta.env.VITE_SUPABASE_ANON_KEY": JSON.stringify(""),
  "import.meta.env.VITE_VAPID_PUBLIC_KEY": JSON.stringify(""),
  "import.meta.env.VITE_RUNTIME_CONFIG": JSON.stringify(""),
};

/**
 * The `import()`s that only a build with a switch on can reach: the sample
 * notes (`DEMO`, `lib/demo.ts`); the spår-server backend and its password form
 * (`RUNTIME_CONFIG`, `store/backend/config.ts`); and, in the demo, which has no
 * server at all, the Supabase client and its backend.
 *
 * Every other build folds those switches to a literal, and the imports go with
 * the dead branches. Under Rollup that was the end of them. Rolldown (Vite 8)
 * still makes a chunk for each — written beside the app and precached on every
 * device — and keeps alive whatever the first paint shares with them (the
 * spår server's session key in the entry chunk). So a build that does not reach
 * them never resolves them: the import is left as written, inside code the
 * minifier then removes, and `generateBundle` fails the build if any of it
 * survived — an import of a file that was never built would be a 404 at the
 * worst moment. `buildInvariants.test.ts` holds the outcome.
 */
const foldedImports = (mode: string): Plugin => {
  const env = loadEnv(mode, fileURLToPath(new URL(".", import.meta.url)), "VITE_");
  const demo = mode === "demo";
  const runtimeConfig = !demo && env.VITE_RUNTIME_CONFIG === "1";
  // The importing file (under src/), what it imports, and whether this build reaches it.
  const imports: [string, string, boolean][] = [
    ["lib/demo.ts", "../demo/sampleNotes", demo],
    ["App.tsx", "./components/PasswordSignIn", runtimeConfig],
    ["store/backend/index.ts", "./sparServerBackend", runtimeConfig],
    ["store/backend/index.ts", "./supabaseBackend", !demo],
    ["store/supabase.ts", "@supabase/supabase-js", !demo],
  ];
  const off = imports.filter(([, , reached]) => !reached);
  return {
    name: "spar-folded-imports",
    apply: "build",
    resolveDynamicImport(specifier, importer) {
      if (typeof specifier !== "string" || !importer) return null;
      const from = importer.split("\\").join("/");
      return off.some(([file, spec]) => spec === specifier && from.endsWith(`/src/${file}`)) ? false : null;
    },
    generateBundle(_options, bundle) {
      for (const file of Object.values(bundle)) {
        if (file.type !== "chunk") continue;
        for (const [, spec] of off) {
          if (file.code.includes(spec)) this.error(`${file.fileName} still imports ${spec}, which this build does not make`);
        }
      }
    },
  };
};

/**
 * The static host's own files, into the demo's output only: `_headers` (the
 * security headers and caching Cloudflare Pages reads, `demo-site/_headers`),
 * the one-paragraph `privacy.html`, and a `404.html` so a missing file is a 404
 * rather than the app's shell. Emitted into the bundle, so the service worker
 * generated after it sees the two pages and precaches them.
 */
function demoSite(): Plugin {
  const site = (name: string) =>
    readFileSync(fileURLToPath(new URL(`./demo-site/${name}`, import.meta.url)), "utf8");
  return {
      name: "spar-demo-site",
      apply: "build",
      transformIndexHtml(html) {
        // What a link to the demo says for itself where it is pasted.
        const about =
          "spår, a notes app where capture asks for nothing. This demo keeps every note in your own browser.";
        return html.replace(
          "<title>spår</title>",
          `<title>spår · demo</title>\n    <meta name="description" content="${about}" />\n` +
            `    <meta property="og:title" content="spår · demo" />\n` +
            `    <meta property="og:description" content="${about}" />`,
        );
      },
      generateBundle() {
        for (const name of ["_headers", "privacy.html", "404.html"]) {
          this.emitFile({ type: "asset", fileName: name, source: site(name) });
        }
      },
    };
  }

  export default defineConfig(({ mode }) => {
    const demo = mode === "demo";
    return {
    envDir: demo ? false : undefined,
    // The device's Reduced motion setting follows every reduced-motion block
    // in the stylesheet, written once there (src/lib/motionSetting.ts).
    css: { postcss: { plugins: [motionSetting()] } },
    define: {
      __BUILD__: JSON.stringify(BUILD),
      ...(demo ? DEMO_ENV : {}),
    },
    build: {
      outDir: demo ? "dist-demo" : "dist",
      rolldownOptions: {
        output: {
          // How the build is cut into files. Vite 8 bundles with Rolldown,
          // whose automatic splitting differs from Rollup's in the one way that
          // matters here: a module the first paint loads *and* a lazy chunk
          // reads used to sit inside the entry chunk, and Rolldown gives every
          // such set of modules a small file of its own — twenty-three files on
          // the first paint where there was one, one of them `lib/pdf.ts` under
          // a `pdf-*` name the precache leaves out (so the shell would not have
          // opened offline). The groups below put it back the way it was.
          codeSplitting: {
            groups: [
              // Everything the first paint loads statically, into the entry
              // chunk: `$initial` is Rolldown's own tag for "statically reached
              // from an entry", and a group that captures the entry module
              // becomes the entry chunk, named `index-*.js` as before. Highest
              // priority, so no group below can pull a first-paint module into
              // a lazy chunk by way of its dependencies (the Supabase group
              // otherwise takes `store/backend/config.ts` with it and drags the
              // whole client onto the first paint).
              { name: "index", tags: ["$initial"], priority: 30 },
              // The text-reading library, in both builds: it is only ever
              // reached by dynamic import, and named it can be kept out of the
              // precache by its filename (`globIgnores`).
              { name: "tesseract", test: /node_modules[\\/]tesseract\.js[\\/]/, priority: 20 },
              // The iPhone-photo decoder (lib/photoPrep.ts): 2.9 MB, fetched the
              // first time an HEIC is attached, and named so the precache can
              // leave it out (`globIgnores`).
              { name: "heic", test: /node_modules[\\/]heic-to[\\/]/, priority: 20 },
              // The sync client is reached by dynamic import (store/supabase.ts)
              // so its ~215 kB stay out of the first paint's bundle. Left
              // unnamed, its chunk would be called index-*.js — indistinguishable
              // from the entry chunk it exists to slim down — so it is named
              // here, which is also what lets the build-invariant test tell the
              // two apart (see lib/buildInvariants.test.ts).
              //
              // The Supabase backend (`store/backend/supabaseBackend.ts`) rides
              // in the same chunk: it is reached by a dynamic import only once
              // the client exists, so beside the client it costs no request of
              // its own and takes the store's query code off the first paint.
              //
              // The demo reaches neither, and a chunk named for them would still
              // be made there, holding whatever small helper they share with the
              // entry — one more request on the demo's first paint for nothing.
              ...(demo
                ? []
                : [
                    {
                      name: "supabase",
                      test: /node_modules[\\/]@supabase[\\/]|[\\/]store[\\/]backend[\\/]supabaseBackend\.ts$/,
                      priority: 10,
                    },
                  ]),
            ],
          },
        },
      },
    },
    plugins: [
      react(),
      ocrAssets(),
      foldedImports(mode),
      // The 90% path — open, scan, capture, edit, find — is local-first by
      // design (CLAUDE.md): IndexedDB already holds the archive offline. But
      // without this, the *app itself* — the HTML, JS, CSS, the three preloaded
      // fonts — still has to come from the network on every open, so "offline"
      // meant the browser's own error page, one layer below the code that
      // promises otherwise.
      //
      // generateSW writes the service worker at build time and precaches the
      // shell so it opens from the cache first, then updates in the background.
      // The manifest is read from web/public/manifest.webmanifest rather than
      // generated here, so system bars, icons and the install prompt stay
      // defined in the one file that already owns them (see themeColor.ts).
      VitePWA({
        manifest: false,
        // The app registers the worker itself (lib/appUpdate.ts) and no script
        // is injected into index.html for it. Two reasons, one old and one new.
        // The old one: an injected `<script src>` served `no-cache` was a
        // render-blocking round trip on every cold open, and `inline` is shut
        // by the CSP. The new one: only the app can *look* for a new build
        // when it is brought to the front, and only the app can offer it.
        injectRegister: false,
        // `prompt`, and not `autoUpdate`. A new worker installs and then WAITS
        // until the user presses Update in the header, at which point the app
        // tells it to take over and reloads. Until 2026-09-16 this said
        // autoUpdate with skipWaiting/clientsClaim stated outright below, and
        // that was a worse deal than it looked: the new worker did let itself
        // in, but nothing reloaded the page, so an installed phone kept
        // running the old build against the new cache — for a week, while the
        // desktop, whose tab is closed and reopened, saw every deploy. And
        // nothing ever *checked* for a new worker: the browser looks on a
        // navigation or once a day, and a backgrounded installed app does
        // neither. Both halves are in lib/appUpdate.ts now, and the worker's
        // job is only to wait to be asked.
        //
        // Waiting is safe in the way taking over was not: the page that is
        // open keeps the cache it was built against, so no chunk 404s out from
        // under it. And a worker left waiting is not stranded — the browser
        // activates it on its own the next time the app is fully closed and
        // reopened, which is what happened before as well, only now with the
        // page reloaded to match.
        registerType: "prompt",
        workbox: {
          // Not `skipWaiting` — see `registerType` above; the generated worker
          // still answers a SKIP_WAITING message, which is what Update sends.
          // `clientsClaim` stays so that once it does take over it takes the
          // open page with it, which is what the reload after Update relies on.
          clientsClaim: true,
          // The PDF viewer is 480kB and deliberately stays behind a dynamic
          // import, off the hot path (see lib/pdf.ts) — it must not be pulled
          // into the shell just because the service worker precaches "every
          // built file". It is still cached the first time a document is
          // actually opened, via the runtime rule below.
          //
          // The icon sets are the same case one size down: Lucide's drawings
          // (lib/lucideSet.ts, ~420kB), its search words (lib/markSearch.ts)
          // and the older Heroicons (lib/iconSet.ts), wanted only when a folder
          // wears a mark or somebody is choosing one. Precached they would be
          // most of everything an install downloads, for a panel opened a
          // handful of times in a folder's life. They take a runtime rule.
          globPatterns: ["**/*.{js,css,html,woff2,svg,png,webmanifest}"],
          // push-sw.js and share-sw.js are imported *into* this worker
          // (below), so precaching them would have the worker holding a cached
          // copy of a piece of itself.
          globIgnores: [
            "**/pdf-*.js",
            "**/pdf.worker*",
            "**/iconSet-*.js",
            "**/lucideSet-*.js",
            "**/markSearch-*.js",
            // The picture-reading engine (FX-A-07): its library chunk and
            // everything under /ocr/, ten megabytes a device fetches only if it
            // holds a picture to read.
            "**/tesseract-*.js",
            "ocr/**",
            // The iPhone-photo decoder: three megabytes a device fetches only
            // the first time it is handed an HEIC photograph.
            "**/heic-*.js",
            "**/push-sw.js",
            "**/share-sw.js",
          ],
          // The two jobs only a worker can do. push-sw.js is the reminder half:
          // a service worker is the only thing still running when the tab is
          // closed, which is the whole reason Web Push exists (SPEC §10).
          // share-sw.js answers the manifest's share_target — Android posts the
          // shared photos to /share, and nothing serves that path but this.
          // Both stay plain files imported at the top of the generated worker
          // rather than switching the build to injectManifest — the generated
          // worker already does the precaching carefully, and none of that is
          // worth rewriting for a handful of listeners.
          // Stamped with their own contents (see `stamped` at the top of this
          // file) — imported and unprecached, they are otherwise the one part of
          // the app a deploy could not change on a device that already had it.
          importScripts: [stamped("push-sw.js"), stamped("share-sw.js")],
          navigateFallback: "/index.html",
          runtimeCaching: [
            {
              urlPattern: /\/assets\/(pdf-|pdf\.worker).*\.(js|mjs)$/,
              handler: "CacheFirst",
              options: {
                // "-2" because the first name holds poison. From the move onto
                // the server's nginx until 2026-09-13 the worker `.mjs` went out
                // as application/octet-stream, which a module worker refuses —
                // and that 200 was cached here, under a hashed name that will
                // not change, for up to ninety days. A new name is the one way
                // to make every device forget it; Workbox drops caches it no
                // longer names only for precache, so the old one simply idles.
                cacheName: "pdf-viewer-2",
                // CacheFirst stores whatever came back and then never asks
                // again, so what it stores has to be worth keeping. A hashed
                // chunk a newer deploy has removed used to come back as the app
                // shell with a 200 — deploy/nginx.conf's single-page fallback
                // covered /assets/ too, and now does not — and that HTML, written
                // under the JS key, would answer every later import of the viewer
                // for the life of the install. Two guards, because the server
                // half is a file this app cannot see from here.
                cacheableResponse: { statuses: [200] },
                // A ceiling as well: "kept once it has been opened" was the
                // intent, "kept forever, however many builds go by" was not. The
                // viewer is two files (the chunk and its worker), so four is the
                // current build and the one before it.
                expiration: { maxEntries: 4, maxAgeSeconds: 60 * 60 * 24 * 90 },
              },
            },
            // The picture-reading engine, fetched the first time a picture is
            // read at idle and kept after that, so a phone that has read its
            // pictures once reads the next one offline. The /ocr/ files are not
            // hashed: they change only with the pinned package versions, and
            // the name is made from those versions (`ocrCacheName`), so it
            // changes with them by itself.
            {
              urlPattern: /\/(ocr\/|assets\/tesseract-)/,
              handler: "CacheFirst",
              options: {
                cacheName: ocrCacheName(),
                cacheableResponse: { statuses: [200] },
                expiration: { maxEntries: 8, maxAgeSeconds: 60 * 60 * 24 * 90 },
              },
            },
            // The iPhone-photo decoder, kept once it has been fetched: two
            // entries is this build's chunk and the last one's.
            {
              urlPattern: /\/assets\/heic-.*\.js$/,
              handler: "CacheFirst",
              options: {
                cacheName: "heic-decoder",
                cacheableResponse: { statuses: [200] },
                expiration: { maxEntries: 2, maxAgeSeconds: 60 * 60 * 24 * 90 },
              },
            },
            // Fetched the first time a board is dressed (or a shelf draws a
            // dressed board), and kept afterwards — so the second board costs
            // nothing and the panel opens on a plane once it has been opened
            // anywhere.
            {
              urlPattern: /\/assets\/(iconSet|lucideSet|markSearch)-.*\.js$/,
              handler: "CacheFirst",
              options: {
                cacheName: "icon-set",
                // The same pair of reasons as the viewer above: six entries is
                // this build's three chunks and the last build's.
                cacheableResponse: { statuses: [200] },
                expiration: { maxEntries: 6, maxAgeSeconds: 60 * 60 * 24 * 90 },
              },
            },
          ],
        },
      }),
      ...(demo ? [demoSite()] : []),
    ],
    server: { port: 5173 },
    test: {
      /*
       * Vitest's default is five seconds, and these are not unit tests. The
       * heaviest of them mount the whole app, seed IndexedDB, and then drive a
       * real sequence of gestures through it — board made, notes written,
       * merged, dissolved — each step waiting on React to settle. One of them
       * measured 4.1s on an idle machine, which is 82% of the old budget: the
       * file passed, but only until anybody added anything to it, and then it
       * failed somewhere else entirely and looked like a regression in whatever
       * had just been touched. That already cost one investigation.
       *
       * Fifteen seconds is not a licence for slow tests. It is the difference
       * between a suite that fails when the code is wrong and a suite that also
       * fails when the machine is busy — only the first kind is worth having.
       */
      testTimeout: 15_000,
      /* Finds and waits get ten seconds, not one — `src/test/asyncWaits.ts`; the
       * gesture-only panels start already fetched, as they are for a person —
       * `src/test/panels.ts`; and an `App.*` file starts with the app's lazy
       * layers and its seed loaded, so no test pays for loading code —
       * `src/test/appChunks.ts`; and the creature is never drowsy by the clock —
       * `src/test/daytime.ts`. */
      setupFiles: ["./src/test/asyncWaits.ts", "./src/test/panels.ts", "./src/test/appChunks.ts", "./src/test/daytime.ts"],
    },
  };
});
