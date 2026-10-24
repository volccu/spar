// Bundles the server into server/dist/: `main.js` (the server) and `cli.js`
// (the admin command line), each one ES module file for Node 22.
//
// A bundle rather than `tsc` output because the server imports TypeScript from
// web/src/ and supabase/functions/_shared/ — the projection, the notification,
// the export — and those files use extensionless imports that Node's own
// resolver will not follow. esbuild follows them the way Vite and Vitest do,
// so the server runs the very same code the app does. `better-sqlite3` stays
// outside the bundle: it is a native module, installed by `npm ci`.
//
//   npm run build:server
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));

await build({
  entryPoints: { main: `${here}src/main.ts`, cli: `${here}src/cli.ts` },
  outdir: `${here}dist`,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  external: ["better-sqlite3"],
  sourcemap: true,
  legalComments: "none",
  logLevel: "warning",
  // A bundled ES module has no `require`; better-sqlite3 is loaded through it.
  banner: { js: 'import { createRequire as __sparRequire } from "node:module"; const require = __sparRequire(import.meta.url);' },
});
console.log("built server/dist/main.js and server/dist/cli.js");
