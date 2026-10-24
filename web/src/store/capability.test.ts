import { describe, expect, it, vi } from "vitest";

vi.mock("./supabase", () => ({ getSupabase: async () => ({}), syncConfigured: true }));

const { probe, reallyMissing } = await import("./capability");

/**
 * The rule every sync path now shares: a "no" is only worth remembering when
 * the server actually said the thing is missing.
 *
 * This was fixed once for notes and left unfixed for canvases and boards, where
 * `hasX = !error` meant one dropped connection on the first tick after sign-in
 * stopped those features syncing for the whole session — invisibly, and until a
 * reload nobody knew to do.
 */
describe("reallyMissing", () => {
  it("recognises the codes that mean the migration has not run", () => {
    expect(reallyMissing({ code: "42703" })).toBe(true);
    expect(reallyMissing({ code: "42P01" })).toBe(true);
    expect(reallyMissing({ code: "PGRST204" })).toBe(true);
    expect(reallyMissing({ code: "PGRST205" })).toBe(true);
  });

  it("reads the message when the build answers without a code", () => {
    expect(reallyMissing({ message: 'relation "folders" does not exist' })).toBe(true);
    expect(reallyMissing({ message: "Could not find the column in the schema cache" })).toBe(true);
  });

  it("does not mistake a transient failure for a missing column", () => {
    expect(reallyMissing({ code: "57014", message: "canceling statement" })).toBe(false);
    expect(reallyMissing({ message: "Failed to fetch" })).toBe(false);
    expect(reallyMissing({ message: "JWT expired" })).toBe(false);
    expect(reallyMissing(null)).toBe(false);
  });
});

describe("probe", () => {
  it("remembers a yes", async () => {
    const outcome = await probe(null, async () => ({ error: null }));
    expect(outcome).toEqual({ known: true, remember: true });
  });

  it("remembers a no only when the thing is genuinely missing", async () => {
    const outcome = await probe(null, async () => ({ error: { code: "42703" } }));
    expect(outcome).toEqual({ known: false, remember: true });
  });

  it("forgets a transient failure so the next tick asks again", async () => {
    const outcome = await probe(null, async () => ({ error: { message: "Failed to fetch" } }));
    // known:false downgrades this one turn, which is safe. remember:false is the
    // whole fix — the caller keeps its cache null and asks again next tick,
    // rather than running degraded until the page is reloaded.
    expect(outcome).toEqual({ known: false, remember: false });
  });

  it("does not ask again once the answer is known", async () => {
    const ask = vi.fn(async () => ({ error: null }));
    expect(await probe(true, ask)).toEqual({ known: true, remember: false });
    expect(await probe(false, ask)).toEqual({ known: false, remember: false });
    expect(ask).not.toHaveBeenCalled();
  });
});
