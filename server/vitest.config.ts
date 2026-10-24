import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// The server's own suite: `npm run test:server`. The conformance suite
// (`npm run test:conformance:server`) holds the server to the sync contract;
// this one covers what the contract does not — accounts, CSRF, the SSRF
// guards, files on disk, the reminder sweep, export and deletion.
export default defineConfig({
  root: fileURLToPath(new URL("..", import.meta.url)),
  test: {
    include: ["server/test/**/*.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
