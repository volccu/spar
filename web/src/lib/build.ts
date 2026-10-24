/** Replaced at build time by `define` in vite.config.ts. */
declare const __BUILD__: { commit: string; built: string } | undefined;

/** The commit this build was made from and when, as the About page states it. */
export function buildInfo(): { commit: string; built: string | null } {
  if (typeof __BUILD__ === "undefined") return { commit: "unknown", built: null };
  return { commit: __BUILD__.commit, built: __BUILD__.built };
}
