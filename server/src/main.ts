/**
 * The server's entry point: read the settings, open the data folder,
 * listen, and shut down cleanly on SIGTERM / SIGINT (what `docker stop` sends).
 *
 *   node server/dist/main.js          (after `npm run build:server`)
 *   npm run server                    (from source, with tsx)
 *
 * With `SPAR_BACKEND=supabase` or `none` it is only the app's web server
 * (site.ts): no API, no database, nothing written to the data folder.
 */
import { createApp } from "./app";
import { configFromEnv, type ServerConfig } from "./config";
import { createSite } from "./site";

async function start(config: ServerConfig): Promise<() => Promise<void>> {
  if (config.backend !== "spar-server") {
    const site = createSite(config);
    const { url } = await site.listen();
    const target = config.backend === "supabase" ? `Supabase at ${config.supabaseUrl}` : "nothing (notes stay on each device)";
    console.log(`spår listening on ${url}, serving the app only: it syncs through ${target}`);
    return () => site.close();
  }
  const app = await createApp(config);
  const { url } = await app.listen();
  const accounts = app.accounts.userCount();
  console.log(`spår server listening on ${url} (data in ${config.dataDir}, sign-up ${config.signup})`);
  if (accounts === 0) {
    console.log(
      "No account exists yet: the first sign-up becomes this instance's admin, whatever SPAR_SIGNUP says. " +
        "Create it now, in the app or with `node server/dist/cli.js create-user <email>`.",
    );
  }
  return () => app.close();
}

async function main(): Promise<void> {
  const close = await start(configFromEnv());
  let stopping = false;
  const stop = (signal: string) => {
    if (stopping) return;
    stopping = true;
    console.log(`${signal}: shutting down`);
    close()
      .then(() => process.exit(0))
      .catch((error: unknown) => {
        console.error(error);
        process.exit(1);
      });
  };
  process.on("SIGTERM", () => stop("SIGTERM"));
  process.on("SIGINT", () => stop("SIGINT"));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
