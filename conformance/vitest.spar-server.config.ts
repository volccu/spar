import { defineConfig, mergeConfig } from "vitest/config";
import base from "./vitest.config";

// The conformance suite against the spår server, in strict mode (no known
// deviations claimed): `npm run test:conformance:server`. It needs no running
// backend — the driver boots the server in-process — so CI runs it on every
// push. Set here rather than on the command line so the script works from
// PowerShell as well as a POSIX shell.
export default mergeConfig(
  base,
  defineConfig({
    test: {
      env: { SPAR_CONFORMANCE_BACKEND: "spar-server", SPAR_CONFORMANCE_STRICT: "1" },
    },
  }),
);
