import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./supabase", () => ({ syncConfigured: true }));

import { forgetServerClock, noteServerDate, stampForUpload } from "./serverClock";

/**
 * The stamp an upload carries is the one thing a pull cursor on the other
 * device is compared against, so it may never step backwards — and the server's
 * clock, read in whole seconds off each answer, can.
 */
describe("the stamp a row is uploaded with", () => {
  beforeEach(() => forgetServerClock());

  it("never runs backwards when a later reading of the server's clock says less", () => {
    noteServerDate("Sat, 12 Sep 2026 12:00:05 GMT");
    const first = stampForUpload("2026-08-01T00:00:00.000Z");
    // The next answer's whole-second header, read a moment later, is earlier.
    noteServerDate("Sat, 12 Sep 2026 12:00:04 GMT");
    const second = stampForUpload("2026-08-01T00:00:01.000Z");

    expect(Date.parse(first)).toBeGreaterThanOrEqual(Date.parse("2026-09-12T12:00:05Z"));
    expect(Date.parse(second)).toBeGreaterThanOrEqual(Date.parse(first));
  });

  it("leaves a stamp alone before any server has answered", () => {
    expect(stampForUpload("2026-08-01T00:00:00.000Z")).toBe("2026-08-01T00:00:00.000Z");
  });
});
