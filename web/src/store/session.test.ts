// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { hasStoredSession } from "./session";

/**
 * The boot gate reads this before the auth client exists, so it decides
 * whether a returning device paints its archive at once or waits on the
 * sign-in check. Wrong in one direction, a first visit flashes an empty board
 * before sign-in; wrong in the other, every open hangs on a network round-trip
 * the rule in web/CLAUDE.md ("what the claim gates is sync, never paint")
 * exists to keep off the first paint.
 */

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("hasStoredSession", () => {
  it("says no on a browser that has never signed in", () => {
    expect(hasStoredSession()).toBe(false);
  });

  it("says yes when supabase-js has left its session behind", () => {
    localStorage.setItem(
      "sb-exampleprojectref0-auth-token",
      JSON.stringify({ access_token: "a", refresh_token: "r", expires_at: 0 }),
    );
    expect(hasStoredSession()).toBe(true);
  });

  it("finds the session among the app's own keys, wherever it sits", () => {
    localStorage.setItem("spar.haptics", "on");
    localStorage.setItem("spar.draft", "half a thought");
    localStorage.setItem("sb-project-auth-token", "{}");
    expect(hasStoredSession()).toBe(true);
  });

  it("still says yes when the stored value is not readable JSON", () => {
    // The question is "who is this likely to be", not "is the session valid":
    // a stale, revoked or mangled token is still somebody's, and the real
    // check runs behind the grid. Parsing it here would put a decision about
    // validity back on the paint path.
    localStorage.setItem("sb-project-auth-token", "not json {");
    expect(hasStoredSession()).toBe(true);
  });

  it("ignores keys that only look like a session", () => {
    // supabase-js keeps a PKCE verifier beside the token while a link is in
    // flight; that is a sign-in half done, not a session.
    localStorage.setItem("sb-project-auth-token-code-verifier", "v");
    localStorage.setItem("sb--auth-token", "{}");
    localStorage.setItem("auth-token", "{}");
    expect(hasStoredSession()).toBe(false);
  });

  it("says no, rather than throwing, when storage is blocked", () => {
    // Private mode at its strictest throws on any touch of localStorage. The
    // gate must land on sign-in, not take the boot down with it.
    vi.spyOn(Storage.prototype, "key").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });
    localStorage.setItem("sb-project-auth-token", "{}");
    expect(() => hasStoredSession()).not.toThrow();
    expect(hasStoredSession()).toBe(false);
  });

  it("says no when localStorage itself cannot be reached", () => {
    localStorage.setItem("sb-project-auth-token", "{}");
    vi.spyOn(window, "localStorage", "get").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });
    expect(hasStoredSession()).toBe(false);
  });
});

describe("hasStoredSession and a spår server", () => {
  // `RUNTIME_CONFIG` is read once, when the module is first evaluated — as the
  // build does — so each case loads the module afresh.
  async function fresh(runtimeConfig: boolean) {
    vi.stubEnv("VITE_RUNTIME_CONFIG", runtimeConfig ? "1" : "");
    vi.resetModules();
    return (await import("./session")).hasStoredSession;
  }

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("finds the server's own marker on a build that reads /config.json", async () => {
    // The session is an httpOnly cookie script cannot see; the marker the
    // backend leaves at sign-in is what lets a signed-in device paint first.
    const has = await fresh(true);
    expect(has()).toBe(false);
    localStorage.setItem("spar.server-session", JSON.stringify({ id: "someone" }));
    expect(has()).toBe(true);
  });

  it("does not look for it on a build with its values baked in", async () => {
    const has = await fresh(false);
    localStorage.setItem("spar.server-session", JSON.stringify({ id: "someone" }));
    expect(has()).toBe(false);
  });
});
