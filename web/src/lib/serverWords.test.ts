import { afterEach, describe, expect, it, vi } from "vitest";
import { isNoAnswer, signInWords, syncFailedMessage, syncWords } from "./serverWords";

afterEach(() => vi.restoreAllMocks());

describe("no answer at all", () => {
  it("is each browser's own words for a request that never got one", () => {
    for (const raw of [
      "TypeError: Failed to fetch",
      "NetworkError when attempting to fetch resource.",
      "Load failed",
      "The server could not be reached: Failed to fetch",
      "net::ERR_INTERNET_DISCONNECTED",
    ]) {
      expect(isNoAnswer(raw), raw).toBe(true);
    }
  });

  it("is never something a server answered", () => {
    for (const raw of ["canceling statement due to statement timeout", "JWT expired", "row refused", "upstream answered 502"]) {
      expect(isNoAnswer(raw), raw).toBe(false);
    }
  });
});

/**
 * A server's trouble is said in one plain sentence — what went wrong, then what
 * to do — and its own words go to the console only (review CD-01).
 */
describe("sign-in's words for a failure", () => {
  it("never shows the library's own words, and logs them instead", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    for (const raw of ["Failed to fetch", "JWT expired", "TypeError: NetworkError when attempting to fetch resource."]) {
      const said = signInWords(raw);
      expect(said).not.toContain(raw);
      expect(said).toMatch(/\.$/);
    }
    expect(log).toHaveBeenCalledWith("sign-in failed:", "Failed to fetch");
  });

  it("tells an unreachable server from a refused one, and names the way out", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(signInWords("Failed to fetch")).toBe(
      "The server could not be reached. Check the connection and try again, or use this device only.",
    );
    expect(signInWords("JWT expired")).toMatch(/turned the request away.*use this device only/);
    expect(signInWords("Email rate limit exceeded")).toBe("Too many tries. Wait a minute, then try again.");
    expect(signInWords("Signups not allowed for otp")).toMatch(/^No account for that address/);
    expect(signInWords("some new internal thing")).toBe("Signing in did not work. Try again, or use this device only.");
  });

  it("keeps a backend's own sentences, translating only what never reached it", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const own = "That email and password do not match an account here.";
    expect(signInWords(own, true)).toBe(own);
    expect(signInWords("Failed to fetch", true)).toMatch(/^The server could not be reached/);
  });
});

describe("the sync-failed dialog's first sentence", () => {
  it("says what went wrong in the app's words", () => {
    expect(syncWords("Failed to fetch")).toBe("The server could not be reached.");
    expect(syncWords("JWT expired")).toMatch(/did not accept this device's sign-in/);
    expect(syncWords('null value in column "body" violates not-null constraint')).toBe(
      "The server would not take the last sync.",
    );
    expect(syncWords(null)).toBe("The last sync did not finish.");
  });
});

describe("a file the server would not take (audit BUG-2)", () => {
  it("is named in the dialog, which does not promise it will be tried again", () => {
    const raw = "file refused: holiday.mp4\nThe object exceeded the maximum allowed size";
    expect(syncWords(raw)).toBe("The server would not take the file “holiday.mp4”.");
    expect(syncFailedMessage(raw)).toMatch(/not sent again until the app is reopened/);
    expect(syncFailedMessage("Failed to fetch")).toMatch(/sync tries again on its own/);
  });
});
