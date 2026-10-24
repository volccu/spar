import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// The conformance suite: `npm run test:conformance`, never part of `npm test`.
// It needs a running backend (see docs/sync-contract.md, "Running the
// conformance suite"), so the root config's `tests/**` include keeps it out of
// the four gates.
export default defineConfig({
  root: fileURLToPath(new URL("..", import.meta.url)),
  test: {
    include: ["conformance/**/*.test.ts"],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    // One file at a time: the realtime and reminder tests watch a shared
    // server, and a quiet server makes their silences meaningful.
    fileParallelism: false,
  },
});
