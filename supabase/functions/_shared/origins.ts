// Which browser origins may read link-preview's answers.
//
// Kept free of Deno so the root suite (`tests/origins.test.ts`) can import it,
// as it does linkStatus.ts. The addresses an instance is served from are that
// instance's setting, not the code's: they arrive as the `ALLOWED_ORIGINS`
// secret, comma-separated, and the local dev server is always allowed on top.

export const DEV_ORIGINS = ["http://localhost:5173", "http://127.0.0.1:5173"] as const;

export function allowedOrigins(raw: string | undefined | null): Set<string> {
  const origins = new Set<string>(DEV_ORIGINS);
  for (const part of (raw ?? "").split(",")) {
    // A browser's Origin header never ends in a slash, so a value pasted with
    // one would otherwise match nothing and fail exactly as silently as a
    // missing entry does.
    const origin = part.trim().replace(/\/+$/, "");
    if (origin) origins.add(origin);
  }
  return origins;
}
