import { describe, expect, it } from "vitest";
import { allowedOrigins, DEV_ORIGINS } from "../supabase/functions/_shared/origins";

// link-preview's CORS list, read from the ALLOWED_ORIGINS secret. A missing
// entry is invisible from both ends (link pictures just stop appearing), so
// the parsing is pinned here rather than discovered in production.
describe("allowedOrigins", () => {
  it("allows only the dev server when the secret is unset", () => {
    expect([...allowedOrigins(undefined)]).toEqual([...DEV_ORIGINS]);
    expect([...allowedOrigins("")]).toEqual([...DEV_ORIGINS]);
  });

  it("adds every comma-separated origin, trimmed", () => {
    const origins = allowedOrigins(" https://notes.example.com , https://example.org:8443,");
    expect(origins.has("https://notes.example.com")).toBe(true);
    expect(origins.has("https://example.org:8443")).toBe(true);
    expect(origins.has("")).toBe(false);
    expect(origins.size).toBe(DEV_ORIGINS.length + 2);
  });

  it("drops a trailing slash, which no Origin header carries", () => {
    expect(allowedOrigins("https://notes.example.com/").has("https://notes.example.com")).toBe(true);
  });
});
