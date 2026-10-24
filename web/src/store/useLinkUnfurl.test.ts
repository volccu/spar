// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { LinkPreview, Note } from "../types";

/**
 * The function's answers, scripted per test. `invoke` records every call so
 * a test can say not only what was written but how many times the server
 * was asked — the one number this hook exists to keep small.
 */
const invoke = vi.fn();
let hasClient = true;

vi.mock("./supabase", () => ({
  syncConfigured: true,
  getSupabase: async () => (hasClient ? { functions: { invoke } } : null),
}));

// jsdom has no canvas, so the shrink answers what the real one would: the size
// it was asked for, at half the height.
vi.mock("../lib/shrink", async (importActual) => {
  const actual = await importActual<typeof import("../lib/shrink")>();
  return {
    ...actual,
    shrunkFromDataUrl: vi.fn(async (_data: string, px: number) => ({
      thumb: `data:image/jpeg;base64,px${px}`,
      width: px,
      height: Math.round(px / 2),
    })),
  };
});

import { RECHECK_AFTER_MS, UNFURL_QUIET_MS, useLinkUnfurl } from "./useLinkUnfurl";
import { linkPreview, note } from "../test/fixtures";
import { DREW_BLANK, shrunkFromDataUrl } from "../lib/shrink";


/** Lets the queue drain: each job awaits the client, then the answer. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("useLinkUnfurl", () => {
  // The client is reached through the backend adapter, which the app loads by
  // a dynamic import once the client exists (`getBackend`). In the browser that
  // module is already in the client's chunk; here the first import compiles it,
  // which can outlast `settle` on a loaded machine. Loaded once up front, every
  // job below waits only on what `settle` was written for.
  beforeAll(async () => {
    await import("./backend/supabaseBackend");
  });

  beforeEach(() => {
    invoke.mockReset();
    hasClient = true;
  });

  it("asks once per link and writes the answer into the note", async () => {
    invoke.mockResolvedValue({
      data: { url: "https://example.com/a", title: "Example", description: "A page", image: null },
      error: null,
    });
    const update = vi.fn();
    const linked = note({ body: "read https://example.com/a" });

    renderHook(() => useLinkUnfurl({ notes: [linked], signedIn: true, update }));
    await settle();
    await settle();

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith("link-preview", { body: { url: "https://example.com/a" } });
    expect(update).toHaveBeenCalledTimes(1);
    const [id, patch] = update.mock.calls[0];
    expect(id).toBe("n1");
    expect(patch.link_previews).toHaveLength(1);
    expect(patch.link_previews?.[0]).toMatchObject({
      href: "https://example.com/a",
      title: "Example",
      description: "A page",
      image: null,
    });
    expect(patch.link_previews?.[0].fetched_at).toBeTruthy();
  });

  it("keeps a hidden flag through the first unfurl, the answer and the gone verdict alike", async () => {
    // Hiding a link that has never been fetched stores a bare entry carrying
    // `hidden`. The unfurl rebuilds the entry from the local one, and must put
    // the flag back or the owner's choice would vanish a second later.
    const bare = (href: string): LinkPreview => ({
      href,
      domain: "example.com",
      title: "Mine",
      description: null,
      image: null,
      fetched_at: null,
      hidden: true,
    });
    for (const answer of [
      { data: { url: "https://example.com/a", title: "Example", description: "d", image: null }, error: null },
      { data: { url: "https://example.com/a", title: "", description: null, image: null, gone: true }, error: null },
    ]) {
      invoke.mockReset();
      invoke.mockResolvedValue(answer);
      const update = vi.fn();
      const linked = note({ body: "read https://example.com/a", link_previews: [bare("https://example.com/a")] });
      renderHook(() => useLinkUnfurl({ notes: [linked], signedIn: true, update }));
      await settle();
      await settle();
      expect(update).toHaveBeenCalledTimes(1);
      const entry = update.mock.calls[0][1].link_previews[0];
      expect(entry.fetched_at).toBeTruthy();
      expect(entry.hidden).toBe(true);
    }
  });

  it("asks nothing about a note in the trash, and asks once it is restored", async () => {
    invoke.mockResolvedValue({
      data: { url: "https://example.com/a", title: "Example", description: null, image: null },
      error: null,
    });
    const update = vi.fn();
    const binned = note({ body: "https://example.com/a", status: "trashed" });

    const { rerender } = renderHook(
      ({ notes }) => useLinkUnfurl({ notes, signedIn: true, update }),
      { initialProps: { notes: [binned] } },
    );
    await settle();
    await settle();
    // A preview written now would restamp the note and reset its month in
    // the trash.
    expect(invoke).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();

    rerender({ notes: [{ ...binned, status: "active" }] });
    await settle();
    await settle();
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledTimes(1);
  });

  it("does not re-scan a note whose body has not changed, or ask twice about one link", async () => {
    invoke.mockResolvedValue({ data: null, error: null });
    const update = vi.fn();
    const linked = note({ body: "https://example.com/a" });

    const { rerender } = renderHook(
      ({ notes }) => useLinkUnfurl({ notes, signedIn: true, update }),
      { initialProps: { notes: [linked] } },
    );
    await settle();
    // Another note changing elsewhere in the app re-runs the effect with a
    // fresh array; the linked note's body is the same, so nothing is asked.
    rerender({ notes: [{ ...linked }, note({ id: "n2", body: "plain" })] });
    await settle();
    // An edit that keeps the link re-scans the body, but the link was already
    // asked about this session (it answered nothing, which is transient).
    rerender({ notes: [{ ...linked, body: "https://example.com/a — still" }] });
    await settle();

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(update).not.toHaveBeenCalled();
  });

  it("leaves a link alone once it carries a fetched preview", async () => {
    const update = vi.fn();
    const done = note({
      body: "https://example.com/a",
      link_previews: [
        {
          href: "https://example.com/a",
          domain: "example.com",
          title: "Example",
          description: null,
          image: "data:image/jpeg;base64,AAAA",
          fetched_at: "2026-09-01T00:00:00.000Z",
        },
      ],
    });
    renderHook(() => useLinkUnfurl({ notes: [done], signedIn: true, update }));
    await settle();
    expect(invoke).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  /**
   * The error supabase-js hands back for a non-2xx answer: the fetch
   * `Response` itself, carried as `context`, which is where the status is read
   * from. Nothing here consumes a body — the client gave up on it before we
   * ever saw the error.
   */
  const httpError = (status: number) =>
    Object.assign(new Error("Edge Function returned a non-2xx status code"), {
      name: "FunctionsHttpError",
      context: { status },
    });

  it("writes down a page that refused, so it is asked once in its life", async () => {
    // 415 — the address answered, and what came back was not a web page. That
    // is a fact about the page and it will be just as true tomorrow.
    invoke.mockResolvedValue({ data: null, error: httpError(415) });
    const update = vi.fn();
    renderHook(() =>
      useLinkUnfurl({ notes: [note({ body: "https://example.com/wall" })], signedIn: true, update }),
    );
    await settle();
    await settle();

    expect(update).toHaveBeenCalledTimes(1);
    const preview = update.mock.calls[0][1].link_previews?.[0];
    expect(preview?.href).toBe("https://example.com/wall");
    expect(preview?.fetched_at).toBeTruthy();
  });

  /**
   * The whole of the 5xx band is a moment, not a page. Supabase's gateway
   * answers 502/504 for a cold start, a deploy in flight or throttling, where
   * the function never ran at all; and the function's own 502 — the page could
   * not be fetched, the redirect chain ran long, the upstream took too long —
   * is by construction the failure most worth asking about again. Stamped, a
   * bad ten seconds marked the link "asked, answered, no picture" for the life
   * of the note.
   */
  it.each([500, 502, 503, 504])("writes nothing for a gateway %i", async (status) => {
    invoke.mockResolvedValue({ data: null, error: httpError(status) });
    const update = vi.fn();
    renderHook(() =>
      useLinkUnfurl({ notes: [note({ body: "https://example.com/a" })], signedIn: true, update }),
    );
    await settle();
    await settle();
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(update).not.toHaveBeenCalled();
  });

  /** 401 a token the gateway would not take, 404 the function not deployed,
   *  429 throttling: all 4xx, none of them anything to do with the page. */
  it.each([401, 404, 429])("writes nothing for a %i that is about us", async (status) => {
    invoke.mockResolvedValue({ data: null, error: httpError(status) });
    const update = vi.fn();
    renderHook(() =>
      useLinkUnfurl({ notes: [note({ body: "https://example.com/a" })], signedIn: true, update }),
    );
    await settle();
    await settle();
    expect(update).not.toHaveBeenCalled();
  });

  it.each([400, 413])("writes down a %i, which names the page", async (status) => {
    invoke.mockResolvedValue({ data: null, error: httpError(status) });
    const update = vi.fn();
    renderHook(() =>
      useLinkUnfurl({ notes: [note({ body: "https://example.com/a" })], signedIn: true, update }),
    );
    await settle();
    await settle();
    expect(update).toHaveBeenCalledTimes(1);
    expect(update.mock.calls[0][1].link_previews?.[0].fetched_at).toBeTruthy();
  });

  it("writes nothing when the status cannot be read at all", async () => {
    // Something upstream changed the shape of the error. Re-asking on the next
    // open is the recoverable half of not knowing.
    const shapeless = Object.assign(new Error("Edge Function returned a non-2xx status code"), {
      name: "FunctionsHttpError",
    });
    invoke.mockResolvedValue({ data: null, error: shapeless });
    const update = vi.fn();
    renderHook(() =>
      useLinkUnfurl({ notes: [note({ body: "https://example.com/a" })], signedIn: true, update }),
    );
    await settle();
    await settle();
    expect(update).not.toHaveBeenCalled();
  });

  it("writes nothing for a failure that may pass next time", async () => {
    invoke.mockResolvedValue({ data: null, error: new Error("Failed to fetch") });
    const update = vi.fn();
    renderHook(() =>
      useLinkUnfurl({ notes: [note({ body: "https://example.com/a" })], signedIn: true, update }),
    );
    await settle();
    await settle();
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(update).not.toHaveBeenCalled();
  });

  it("writes a page that answered 404 or 410 down as gone, under the note's own words", async () => {
    // The function answers a dead page with a 200 carrying `gone`, and an
    // empty title — the address's own words are the best name it has.
    invoke.mockResolvedValue({
      data: { url: "https://example.com/dead", title: "", description: null, image: null, gone: true, status: 404 },
      error: null,
    });
    const update = vi.fn();
    renderHook(() =>
      useLinkUnfurl({
        notes: [note({ body: "Old recipe https://example.com/dead" })],
        signedIn: true,
        update,
      }),
    );
    await settle();
    await settle();

    expect(update).toHaveBeenCalledTimes(1);
    const preview = update.mock.calls[0][1].link_previews?.[0];
    expect(preview).toMatchObject({ href: "https://example.com/dead", title: "Old recipe", gone: true });
    expect(preview?.fetched_at).toBeTruthy();
  });

  it("says a link is on the wall, so only a wall link may be answered with a screenshot", async () => {
    invoke.mockResolvedValue({ data: { url: "https://example.com/", title: "T", description: null, image: null }, error: null });
    const update = vi.fn();
    const onWall = note({ id: "w", body: "https://example.com/", board_id: "insp" });
    const elsewhere = note({ id: "e", body: "https://example.org/" });
    renderHook(() => useLinkUnfurl({ notes: [onWall, elsewhere], signedIn: true, update, wallBoardId: "insp" }));
    await settle();
    await settle();
    expect(invoke).toHaveBeenCalledWith("link-preview", { body: { url: "https://example.com/", wall: true } });
    expect(invoke).toHaveBeenCalledWith("link-preview", { body: { url: "https://example.org/" } });
  });

  it("stores a link's picture at WALL_THUMB_PX (1080) with its size on the Inspiration board, and at 200px everywhere else", async () => {
    invoke.mockResolvedValue({
      data: { url: "https://example.com/a", title: "T", description: null, image: "data:image/png;base64,AAAA", media: "image", width: 900, height: 450, video: null },
      error: null,
    });
    const update = vi.fn();
    const onWall = note({ id: "w", body: "https://example.com/a", board_id: "insp" });
    renderHook(() => useLinkUnfurl({ notes: [onWall], signedIn: true, update, wallBoardId: "insp" }));
    await settle();
    await settle();
    expect(update.mock.calls[0][1].link_previews[0]).toMatchObject({ image: "data:image/jpeg;base64,px1080", width: 1080, height: 540, thumb_px: 1080, media: "image" });

    invoke.mockClear();
    update.mockClear();
    const elsewhere = note({ id: "e", body: "https://example.com/a" });
    renderHook(() => useLinkUnfurl({ notes: [elsewhere], signedIn: true, update, wallBoardId: "insp" }));
    await settle();
    await settle();
    expect(update.mock.calls[0][1].link_previews[0]).toMatchObject({ image: "data:image/jpeg;base64,px200", thumb_px: 200 });
  });

  it("asks again, once, when an already-fetched note is filed into Inspiration — and not when it is merely edited", async () => {
    invoke.mockResolvedValue({
      data: { url: "https://example.com/a", title: "T", description: null, image: "data:image/png;base64,AAAA", media: "image", video: null },
      error: null,
    });
    const update = vi.fn();
    const stored = linkPreview({ href: "https://example.com/a", fetched_at: "2026-10-01T00:00:00.000Z", image: "data:image/jpeg;base64,small" });
    const before = note({ id: "n", body: "https://example.com/a", link_previews: [stored] });

    const { rerender } = renderHook(
      ({ notes }) => useLinkUnfurl({ notes, signedIn: true, update, wallBoardId: "insp" }),
      { initialProps: { notes: [before] } },
    );
    await settle();
    expect(invoke).not.toHaveBeenCalled(); // nothing is asked for a note that is not on the wall

    rerender({ notes: [{ ...before, board_id: "insp" }] });
    await settle();
    await settle();
    expect(invoke).toHaveBeenCalledTimes(1);

    rerender({ notes: [{ ...before, board_id: "insp", priority: 1 }] });
    await settle();
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("keeps the fields it does not know when it writes the answer back", async () => {
    invoke.mockResolvedValue({ data: { url: "https://example.com/a", title: "T", description: null, image: null, media: null }, error: null });
    const update = vi.fn();
    // Never answered, so it is asked — a hidden preview is no wall picture
    // (BUG-7), so it would not be re-asked for the wall's size.
    const stored = linkPreview({ href: "https://example.com/a", fetched_at: null, image: null, hidden: true });
    renderHook(() =>
      useLinkUnfurl({ notes: [note({ id: "n", body: "https://example.com/a", board_id: "insp", link_previews: [stored, linkPreview({ href: "https://example.org/other", fromTheFuture: 7 } as never)] })], signedIn: true, update, wallBoardId: "insp" }),
    );
    await settle();
    await settle();
    const entries = update.mock.calls[0][1].link_previews;
    expect(entries.find((e: { href: string }) => e.href === "https://example.org/other").fromTheFuture).toBe(7);
    expect(entries.find((e: { href: string }) => e.href === "https://example.com/a").hidden).toBe(true);
  });

  it("does not write a media field an older function never sent, so the link is asked again once the function is deployed", async () => {
    invoke.mockResolvedValue({ data: { url: "https://example.com/a", title: "T", description: null, image: null }, error: null });
    const update = vi.fn();
    renderHook(() => useLinkUnfurl({ notes: [note({ id: "n", body: "https://example.com/a", board_id: "insp" })], signedIn: true, update, wallBoardId: "insp" }));
    await settle();
    await settle();
    expect(update.mock.calls[0][1].link_previews[0]).not.toHaveProperty("media");
  });

  describe("the wall's one re-ask", () => {
    const fetchedSmall = (over: Partial<LinkPreview> = {}) =>
      linkPreview({
        href: "https://example.com/a",
        fetched_at: "2026-10-01T00:00:00.000Z",
        image: "data:image/jpeg;base64,small",
        width: 200,
        height: 100,
        thumb_px: 200,
        media: "image",
        checked_at: "2026-10-02T00:00:00.000Z",
        ...over,
      });
    const onWallNote = (previews: LinkPreview[]) =>
      note({ id: "n", body: "https://example.com/a", board_id: "insp", link_previews: previews });

    it("never replaces a stored picture with nothing when the answer brings none", async () => {
      invoke.mockResolvedValue({ data: { url: "https://example.com/a", title: "T", description: null, image: null, media: null }, error: null });
      const update = vi.fn();
      renderHook(() => useLinkUnfurl({ notes: [onWallNote([fetchedSmall()])], signedIn: true, update, wallBoardId: "insp" }));
      await settle();
      await settle();
      expect(update.mock.calls[0][1].link_previews[0]).toMatchObject({
        image: "data:image/jpeg;base64,small",
        width: 200,
        height: 100,
        thumb_px: 200,
        media: "image",
        checked_at: "2026-10-02T00:00:00.000Z",
      });
    });

    it("never replaces a stored picture with nothing when the new one will not shrink", async () => {
      vi.mocked(shrunkFromDataUrl).mockResolvedValueOnce(null);
      invoke.mockResolvedValue({ data: { url: "https://example.com/a", title: "T", description: null, image: "data:image/png;base64,AAAA", media: "image" }, error: null });
      const update = vi.fn();
      renderHook(() => useLinkUnfurl({ notes: [onWallNote([fetchedSmall()])], signedIn: true, update, wallBoardId: "insp" }));
      await settle();
      await settle();
      expect(update.mock.calls[0][1].link_previews[0]).toMatchObject({ image: "data:image/jpeg;base64,small", width: 200, thumb_px: 200 });
    });

    it("writes once and is quiet on the next open, though the answer had no bigger picture and the function sent no media", async () => {
      // The older function: no `media` key, no picture. Without a stamp of its
      // own the entry would still look unasked and be re-fetched on every open.
      invoke.mockResolvedValue({ data: { url: "https://example.com/a", title: "T", description: null, image: null }, error: null });
      const update = vi.fn();
      const first = onWallNote([fetchedSmall({ media: undefined })]);
      renderHook(() => useLinkUnfurl({ notes: [first], signedIn: true, update, wallBoardId: "insp" }));
      await settle();
      await settle();
      expect(invoke).toHaveBeenCalledTimes(1);
      expect(update).toHaveBeenCalledTimes(1);
      const written = update.mock.calls[0][1].link_previews;
      expect(written[0].wall_asked_at).toBeTruthy();

      // The next open: the note as it was written back.
      invoke.mockClear();
      renderHook(() => useLinkUnfurl({ notes: [{ ...first, link_previews: written }], signedIn: true, update, wallBoardId: "insp" }));
      await settle();
      await settle();
      expect(invoke).not.toHaveBeenCalled();
    });

    it("leaves a note in the trash alone", async () => {
      invoke.mockResolvedValue({ data: { url: "https://example.com/a", title: "T", description: null, image: "data:image/png;base64,AAAA", media: "image" }, error: null });
      const update = vi.fn();
      const trashed = { ...onWallNote([fetchedSmall()]), status: "trashed" as const };
      renderHook(() => useLinkUnfurl({ notes: [trashed], signedIn: true, update, wallBoardId: "insp" }));
      await settle();
      await settle();
      expect(invoke).not.toHaveBeenCalled();
      expect(update).not.toHaveBeenCalled();
    });

    it("writes the bigger picture and keeps what else the entry holds, without touching the board", async () => {
      invoke.mockResolvedValue({ data: { url: "https://example.com/a", title: "T", description: null, image: "data:image/png;base64,AAAA", media: "image" }, error: null });
      const update = vi.fn();
      renderHook(() => useLinkUnfurl({ notes: [onWallNote([fetchedSmall({ fromTheFuture: 7 } as never)])], signedIn: true, update, wallBoardId: "insp" }));
      await settle();
      await settle();
      expect(update.mock.calls[0][1].link_previews[0]).toMatchObject({
        image: "data:image/jpeg;base64,px1080",
        thumb_px: 1080,
        width: 1080,
        height: 540,
        fromTheFuture: 7,
        checked_at: "2026-10-02T00:00:00.000Z",
      });
      expect(Object.keys(update.mock.calls[0][1])).toEqual(["link_previews"]);
    });

    /**
     * Audit BUG-7 (2026-10-10): the wall shows one link's picture, and a note
     * with ten links used to store ten 1080px pictures and make ten screenshot
     * calls. Only the link the tile shows is asked for at the wall's size.
     */
    it("asks for the wall's size only for the link the tile shows", async () => {
      invoke.mockImplementation(async (_name: string, { body }: { body: { url: string } }) => ({
        data: { url: body.url, title: "T", description: null, image: "data:image/png;base64,AAAA", media: "image" },
        error: null,
      }));
      const update = vi.fn();
      const wallNote = note({
        id: "n",
        body: "https://example.com/a https://example.com/b https://example.com/c",
        board_id: "insp",
      });
      renderHook(() => useLinkUnfurl({ notes: [wallNote], signedIn: true, update, wallBoardId: "insp" }));
      for (let i = 0; i < 6; i++) await settle();
      const asked = invoke.mock.calls.map(([, { body }]) => body as { url: string; wall?: true });
      expect(asked).toHaveLength(3);
      expect(asked.filter((b) => b.wall).map((b) => b.url)).toEqual(["https://example.com/a"]);
      // Only the shown link's entry is stamped as the wall's one ask, and only
      // it is stored at the wall's size.
      const written = update.mock.calls.map(([, patch]) => (patch.link_previews as LinkPreview[]).at(-1)!);
      expect(written.filter((e) => e.wall_asked_at).map((e) => e.href)).toEqual(["https://example.com/a"]);
      expect(written.filter((e) => e.thumb_px === 1080).map((e) => e.href)).toEqual(["https://example.com/a"]);
    });

    it("does not ask a wall note's other links again for the wall's size", async () => {
      const update = vi.fn();
      const second = fetchedSmall({ href: "https://example.com/b" });
      const wallNote = note({
        id: "n",
        body: "https://example.com/a https://example.com/b",
        board_id: "insp",
        link_previews: [fetchedSmall({ thumb_px: 1080, wall_asked_at: "2026-10-11T00:00:00.000Z" }), second],
      });
      renderHook(() => useLinkUnfurl({ notes: [wallNote], signedIn: true, update, wallBoardId: "insp" }));
      await settle();
      await settle();
      expect(invoke).not.toHaveBeenCalled();
    });

    /**
     * Audit BUG-9: a page answering 400/413/415, or gone, kept the stored entry
     * with a fresh stamp — and with it a black picture from the 2026-10-09
     * window, for good. That picture is dropped instead.
     */
    it.each([
      ["refused", { data: null, error: Object.assign(new Error("x"), { name: "FunctionsHttpError", context: { status: 415 } }) }],
      ["gone", { data: { url: "https://example.com/a", title: "", description: null, image: null, gone: true }, error: null }],
    ])("drops a black-window picture when the page is %s", async (_label, answer) => {
      invoke.mockResolvedValue(answer);
      const update = vi.fn();
      const black = fetchedSmall({ fetched_at: "2026-10-09T08:56:55.000Z", wall_asked_at: "2026-10-09T08:56:55.000Z", thumb_px: 480 });
      renderHook(() => useLinkUnfurl({ notes: [onWallNote([black])], signedIn: true, update, wallBoardId: "insp" }));
      await settle();
      await settle();
      const written = update.mock.calls[0][1].link_previews[0];
      expect(written.image).toBeNull();
      expect(written).not.toHaveProperty("thumb_px");
      expect(written).not.toHaveProperty("width");
    });

    // 2026-10-09: a canvas that drew nothing encoded as a solid black picture,
    // which was stored and stamped as the answer.
    it("writes nothing when the canvas drew nothing, so the link is asked again later", async () => {
      vi.mocked(shrunkFromDataUrl).mockResolvedValueOnce(DREW_BLANK);
      invoke.mockResolvedValue({ data: { url: "https://example.com/a", title: "T", description: null, image: "data:image/png;base64,AAAA", media: "image" }, error: null });
      const update = vi.fn();
      renderHook(() => useLinkUnfurl({ notes: [onWallNote([fetchedSmall()])], signedIn: true, update, wallBoardId: "insp" }));
      await settle();
      await settle();
      expect(invoke).toHaveBeenCalledTimes(1);
      expect(update).not.toHaveBeenCalled();
    });

    it("clears a picture from the black-picture window when the answer brings none", async () => {
      invoke.mockResolvedValue({ data: { url: "https://example.com/a", title: "T", description: null, image: null, media: null }, error: null });
      const update = vi.fn();
      const black = fetchedSmall({ fetched_at: "2026-10-09T08:56:55.000Z", wall_asked_at: "2026-10-09T08:56:55.000Z", thumb_px: 480 });
      renderHook(() => useLinkUnfurl({ notes: [onWallNote([black])], signedIn: true, update, wallBoardId: "insp" }));
      await settle();
      await settle();
      const written = update.mock.calls[0][1].link_previews[0];
      expect(written.image).toBeNull();
      expect(written).not.toHaveProperty("thumb_px");
      expect(written.media).toBeNull();
    });
  });

  it("does not run at all when signed out", async () => {
    const update = vi.fn();
    renderHook(() =>
      useLinkUnfurl({ notes: [note({ body: "https://example.com/a" })], signedIn: false, update }),
    );
    await settle();
    expect(invoke).not.toHaveBeenCalled();
  });

  it("drops the answer if the link left the note while it was being asked", async () => {
    let answer: (value: unknown) => void = () => {};
    invoke.mockReturnValue(new Promise((resolve) => (answer = resolve)));
    const update = vi.fn();
    const linked = note({ body: "https://example.com/a" });
    const { rerender } = renderHook(
      ({ notes }) => useLinkUnfurl({ notes, signedIn: true, update }),
      { initialProps: { notes: [linked] } },
    );
    await settle();
    expect(invoke).toHaveBeenCalledTimes(1);
    // The user removed the link before the server answered.
    rerender({ notes: [{ ...linked, body: "no link any more" }] });
    answer({
      data: { url: "https://example.com/a", title: "Late", description: null, image: null },
      error: null,
    });
    await settle();
    await settle();
    expect(update).not.toHaveBeenCalled();
  });
});

/**
 * The effect runs on every keystroke, and an address being typed is a new
 * link every character past the fifth. Each partial was queued and sent — the
 * check that it was still in the note came after the request — so typing one
 * URL cost a couple of dozen cold edge-function calls fetching pages that
 * mostly do not exist. A note whose stamp is seconds old now waits until it
 * has held still for `UNFURL_QUIET_MS`; one that has not moved for longer is
 * asked at once, which is every note the other tests hand in.
 */
describe("a link in a note that is being written this instant", () => {
  it("is asked about once the hand has lifted, and only as it stands then", async () => {
    vi.useFakeTimers();
    try {
      invoke.mockResolvedValue({
        data: { url: "https://example.org/typing", title: "Typed", description: null, image: null },
        error: null,
      });
      const update = vi.fn();
      const fresh = () => new Date().toISOString();
      const { rerender } = renderHook(
        ({ notes }) => useLinkUnfurl({ notes, signedIn: true, update }),
        { initialProps: { notes: [note({ body: "https://example.org/typ", updated_at: fresh() })] } },
      );
      await vi.advanceTimersByTimeAsync(UNFURL_QUIET_MS / 2);
      rerender({ notes: [note({ body: "https://example.org/typi", updated_at: fresh() })] });
      await vi.advanceTimersByTimeAsync(UNFURL_QUIET_MS / 2);
      rerender({ notes: [note({ body: "https://example.org/typing", updated_at: fresh() })] });
      // Counted by address: a job left over from an earlier test in this file
      // may still answer for its own note here.
      const asked = () =>
        invoke.mock.calls
          .map((call) => (call[1] as { body: { url: string } }).body.url)
          .filter((url) => url.startsWith("https://example.org/"));
      // Nothing yet: the note has not held still for the whole quiet period.
      expect(asked()).toEqual([]);

      await vi.advanceTimersByTimeAsync(UNFURL_QUIET_MS + 10);
      expect(asked()).toEqual(["https://example.org/typing"]);
    } finally {
      vi.useRealTimers();
    }
  });
});

/**
 * Asking again. A preview is fetched once, so a page that died after it was
 * saved would wear its old title for ever; once an open, a while after the
 * archive is up, the oldest few answers are asked again and only the verdict
 * is written. Each test uses its own address so a job left over from an
 * earlier test cannot answer for it.
 */
describe("the re-check of old links", () => {
  const month = 31 * 86_400_000;
  const saved = (href: string, over: Partial<LinkPreview> = {}): Note =>
    note({
      id: `re-${href}`,
      body: `Saved https://recheck.example/${href}`,
      link_previews: [
        {
          href: `https://recheck.example/${href}`,
          domain: "recheck.example",
          title: "The page's own title",
          description: "What it said about itself",
          image: "data:image/jpeg;base64,AAAA",
          fetched_at: new Date(Date.now() - month).toISOString(),
          ...over,
        },
      ],
    });
  const askedAbout = (href: string) =>
    invoke.mock.calls.filter(
      (call) => (call[1] as { body: { url: string } }).body.url === `https://recheck.example/${href}`,
    );

  async function run(notes: Note[], answer: unknown) {
    invoke.mockResolvedValue(answer);
    const update = vi.fn();
    renderHook(() => useLinkUnfurl({ notes, signedIn: true, update }));
    // Nothing is asked while the rest of the opening has the network.
    await vi.advanceTimersByTimeAsync(RECHECK_AFTER_MS - 100);
    const early = update.mock.calls.length;
    await vi.advanceTimersByTimeAsync(200);
    await vi.advanceTimersByTimeAsync(10);
    return { update, early };
  }

  beforeEach(() => {
    invoke.mockReset();
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it("asks for the verdict only, and writes nothing but the stamp when the page is there", async () => {
    const { update, early } = await run([saved("alive")], {
      data: { url: "https://recheck.example/alive", title: "A new title", description: null, image: null },
      error: null,
    });
    expect(early).toBe(0);
    expect(askedAbout("alive")).toHaveLength(1);
    expect(askedAbout("alive")[0][1]).toEqual({
      body: { url: "https://recheck.example/alive", check: true },
    });
    expect(update).toHaveBeenCalledTimes(1);
    const entry = update.mock.calls[0][1].link_previews[0];
    // The preview the owner has been looking at is left exactly as it was.
    expect(entry).toMatchObject({
      title: "The page's own title",
      description: "What it said about itself",
      image: "data:image/jpeg;base64,AAAA",
    });
    expect(entry.gone).toBeUndefined();
    expect(entry.checked_at).toBeTruthy();
  });

  it("marks a page that now answers 404 as gone, keeping its title", async () => {
    const { update } = await run([saved("dead")], {
      data: { url: "https://recheck.example/dead", title: "", description: null, image: null, gone: true },
      error: null,
    });
    const entry = update.mock.calls[0][1].link_previews[0];
    expect(entry).toMatchObject({ title: "The page's own title", gone: true });
    expect(entry.checked_at).toBeTruthy();
  });

  it("asks a gone page in full, and a page that has come back loses the mark", async () => {
    const { update } = await run([saved("back", { gone: true })], {
      data: { url: "https://recheck.example/back", title: "Back again", description: null, image: null },
      error: null,
    });
    // Not a verdict-only ask: this is the page's first real answer in a while.
    expect(askedAbout("back")[0][1]).toEqual({ body: { url: "https://recheck.example/back" } });
    const entry = update.mock.calls[0][1].link_previews[0];
    expect(entry.title).toBe("Back again");
    expect(entry.gone).toBeUndefined();
  });

  it("keeps a hidden flag through a re-check, a gone verdict and a page that came back", async () => {
    for (const [over, answer] of [
      [{}, { title: "A new title", description: null, image: null }],
      [{}, { title: "", description: null, image: null, gone: true }],
      [{ gone: true }, { title: "Back again", description: null, image: null }],
    ] as const) {
      invoke.mockReset();
      const { update } = await run([saved("h", { ...over, hidden: true })], {
        data: { url: "https://recheck.example/h", ...answer },
        error: null,
      });
      expect(update.mock.calls[0][1].link_previews[0].hidden).toBe(true);
    }
  });

  it("keeps the verdict and moves only the stamp when the answer says nothing about the page", async () => {
    // A 403 bot wall arrives from the function as a 502. Not evidence either
    // way — but stamped, so the same link is not the oldest again next open.
    const wall = Object.assign(new Error("Edge Function returned a non-2xx status code"), {
      name: "FunctionsHttpError",
      context: { status: 502 },
    });
    const { update } = await run([saved("walled", { gone: true })], { data: null, error: wall });
    const entry = update.mock.calls[0][1].link_previews[0];
    expect(entry.gone).toBe(true);
    expect(entry.checked_at).toBeTruthy();
  });

  it("writes nothing when the question never arrived", async () => {
    const { update } = await run([saved("offline")], {
      data: null,
      error: new Error("Failed to fetch"),
    });
    expect(askedAbout("offline")).toHaveLength(1);
    expect(update).not.toHaveBeenCalled();
  });

  it("leaves a link alone whose answer is inside the month", async () => {
    const { update } = await run(
      [saved("recent", { fetched_at: new Date(Date.now() - 86_400_000).toISOString() })],
      { data: null, error: null },
    );
    expect(askedAbout("recent")).toHaveLength(0);
    expect(update).not.toHaveBeenCalled();
  });
});
