import { describe, expect, it } from "vitest";
import { pageVerdict, wantsPicture } from "../supabase/functions/_shared/linkStatus";

// The rule that decides a saved link is dead, checked here because the only
// other place it runs is inside the deployed edge function.

describe("pageVerdict", () => {
  it("calls only 404 and 410 gone", () => {
    expect(pageVerdict(404)).toBe("gone");
    expect(pageVerdict(410)).toBe("gone");
  });

  it("does not take a bot wall, a login, throttling or a bad moment as evidence", () => {
    // 403 is the common one: a page behind Cloudflare that is alive and well
    // for a browser. Marking it dead would be the app lying about the link.
    for (const status of [400, 401, 403, 405, 406, 418, 429, 451, 500, 502, 503, 504, 520, 999]) {
      expect(pageVerdict(status), String(status)).toBe("failed");
    }
  });

  it("reads a 2xx as a page and a 3xx as a step in the walk", () => {
    expect(pageVerdict(200)).toBe("page");
    expect(pageVerdict(203)).toBe("page");
    for (const status of [301, 302, 303, 307, 308]) expect(pageVerdict(status)).toBe("redirect");
  });
});

describe("wantsPicture", () => {
  it("skips the picture only when the caller says it is checking", () => {
    expect(wantsPicture({ check: true })).toBe(false);
  });

  it("gives a client that never heard of the flag exactly what it always got", () => {
    expect(wantsPicture({})).toBe(true);
    expect(wantsPicture({ check: "true" })).toBe(true);
    expect(wantsPicture({ check: 1 })).toBe(true);
  });
});
