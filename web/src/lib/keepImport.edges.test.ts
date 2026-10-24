import { describe, expect, it } from "vitest";
import { planImport, type KeepFound, type KeepScan } from "./keepImport";

const found = (): KeepFound => ({
  stem: "Shopping", createdUsec: null, text: "milk", labels: [], status: "active",
  pinned: false, created_at: "2020-01-01T00:00:00.000Z", edited_at: "2020-01-01T00:00:00.000Z", files: [],
});

describe("Keep import ids", () => {
  it("gives every new note its own keep_id even when three share a name and none has a creation stamp", () => {
    const scan: KeepScan = { notes: [found(), found(), found()], trashed: 0, unreadable: [] };
    const ids = planImport(scan, []).fresh.map((n) => n.keep_id);
    // the server holds keep_id unique: a repeat is refused on every sync
    expect(new Set(ids).size).toBe(ids.length);
  });
});
