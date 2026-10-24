// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { render, screen, fireEvent, waitFor, cleanup, within, configure } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { putNote, setMeta, writeCaptureDraft } from "./store/db";
import { INBOX_ALL } from "./lib/boards";
import { takeShared } from "./lib/shareTarget";
import type { Note } from "./types";

/*
 * Every find and wait in this file gets ten seconds, and a test forty, because
 * this file was seen failing only inside the whole suite, where the machine is
 * busy and a find that takes 100 ms alone takes seconds. A longer wait costs
 * nothing when the thing arrives, and a failing test still fails — later.
 */
configure({ asyncUtilTimeout: 10_000 });
vi.setConfig({ testTimeout: 40_000 });

/*
 * The one line the capture bar says about a note (`CaptureLine`), end to end:
 * the receipt for a capture that landed off the screen, and the notice that an
 * address being written is already saved. `CaptureBar.test.tsx` covers the
 * bar's half on its own; this is the half that needs the store and the board.
 *
 * A file of its own for the reason `App.capture.test.tsx` gives: these make
 * folders, and App.test.tsx shares one database across seventy tests.
 */

vi.mock("./lib/shareTarget", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./lib/shareTarget")>()),
  takeShared: vi.fn(async () => null),
}));

afterEach(cleanup);

beforeEach(async () => {
  localStorage.setItem("spar.deviceOnly", "1");
  await setMeta("inboxSince", INBOX_ALL);
  await writeCaptureDraft("");
  window.history.replaceState({}, "", "/");
});

const cards = () => Array.from(document.querySelectorAll<HTMLElement>(".card"));
const line = () => document.querySelector<HTMLElement>(".capture-line");
/** Where a capture went is the header's creature's to say (2026-10-16). */
const said = () => document.querySelector<HTMLElement>(".topbar .speech");
const boardName = () =>
  document.querySelector('[role="tab"][aria-selected="true"]')?.textContent ?? "";

async function open() {
  render(<App />);
  await waitFor(() => expect(cards().length).toBeGreaterThan(0), { timeout: 10_000 });
}

async function goToBoard(name: RegExp) {
  fireEvent.click(await screen.findByRole("tab", { name }));
}

async function makeBoard(name: string) {
  fireEvent.click(screen.getByRole("button", { name: "New board" }));
  const field = screen.getByLabelText("New board name");
  fireEvent.change(field, { target: { value: name } });
  fireEvent.keyDown(field, { key: "Enter" });
  return await screen.findByRole("tab", { name: new RegExp(name, "i") }, { timeout: 10_000 });
}

function write(words: string) {
  fireEvent.change(screen.getByLabelText("Write a note"), { target: { value: words } });
}

function note(id: string, body: string, fields: Partial<Note> = {}): Note {
  return {
    id,
    raw_content: body,
    body,
    source: "web",
    created_at: "2026-01-05T09:00:00.000Z",
    updated_at: "2026-01-05T09:00:00.000Z",
    note_type: null,
    board_id: null,
    status: "active",
    priority: 0,
    reminder_at: null,
    done: null,
    merged_from: null,
    keep_id: null,
    attachments: [],
    ...fields,
  };
}

describe("where a capture went, when the screen cannot show it", () => {
  it("names the folder the bar's mark sent it to, and goes there", async () => {
    await open();
    fireEvent.click(await makeBoard("Elsewhere"));
    await goToBoard(/^inbox/i);

    write("zzzsentelsewhere");
    fireEvent.click(screen.getByRole("button", { name: "Board" }));
    fireEvent.click(await screen.findByRole("button", { name: /^Elsewhere/ }, { timeout: 10_000 }));
    fireEvent.click(screen.getByRole("button", { name: "Save note" }));

    await waitFor(() => expect(said()?.textContent).toMatch(/Tucked into Elsewhere/), { timeout: 10_000 });
    fireEvent.click(within(said()!).getByRole("button", { name: /^Go/ }));
    await waitFor(() => expect(boardName()).toMatch(/Elsewhere/), { timeout: 10_000 });
    expect(await screen.findByRole("button", { name: /zzzsentelsewhere/i }, { timeout: 10_000 })).toBeTruthy();
  });

  it("says nothing when the note lands on the folder being stood on", async () => {
    await open();
    fireEvent.click(await makeBoard("Standing here"));
    write("zzzstayshere");
    fireEvent.click(screen.getByRole("button", { name: "Save note" }));
    expect(await screen.findByRole("button", { name: /zzzstayshere/i }, { timeout: 10_000 })).toBeTruthy();
    expect(said()).toBeNull();
  });

  it("names the board under a search that does not hold it, and leaves the search", async () => {
    await open();
    await goToBoard(/^inbox/i);
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    fireEvent.change(await screen.findByLabelText("Search notes", {}, { timeout: 10_000 }), {
      target: { value: "zzznothingmatchesthis" },
    });

    write("zzzwrittenwhilesearching");
    fireEvent.click(screen.getByRole("button", { name: "Save note" }));
    await waitFor(() => expect(said()?.textContent).toMatch(/Tucked into Inbox/), { timeout: 10_000 });

    fireEvent.click(within(said()!).getByRole("button", { name: /^Go/ }));
    await waitFor(() => expect(screen.queryByLabelText("Search notes")).toBeNull(), { timeout: 10_000 });
    expect(await screen.findByRole("button", { name: /zzzwrittenwhilesearching/i }, { timeout: 10_000 })).toBeTruthy();
  });

  it("names Links for a bare address written on a board that does not keep it", async () => {
    await open();
    await goToBoard(/^inbox/i);
    write("https://example.org/zzzbare-address");
    fireEvent.click(screen.getByRole("button", { name: "Save note" }));
    // A note that is nothing but an address lives on Links alone.
    await waitFor(() => expect(said()?.textContent).toMatch(/Tucked into Links/), { timeout: 10_000 });
  });

  // Scrolled down an Inbox of forty, the new card lands above the screen: the
  // words vanish and nothing in view says where they went (review UX-01). The
  // same line a capture on another board gets, and Go jumps up and traces it.
  it("names the board when the card lands above what is on screen, and goes up to it", async () => {
    await open();
    await goToBoard(/^inbox/i);
    const scroller = document.querySelector<HTMLElement>("main.scroll")!;
    scroller.scrollTop = 1800;
    fireEvent.scroll(scroller);

    write("zzzlandedabove");
    fireEvent.click(screen.getByRole("button", { name: "Save note" }));
    await waitFor(() => expect(said()?.textContent).toMatch(/Tucked into Inbox/), { timeout: 10_000 });
    // Said for a reader from the header's always-mounted region, too.
    const regions = [...document.querySelectorAll(".topbar [role='status']")].map((el) => el.textContent);
    expect(regions).toContain("Tucked into Inbox");
    expect(scroller.scrollTop).toBe(1800);

    // The card's own trace played where nobody could see it; wait it out, so
    // the one Go asks for is the one seen.
    await waitFor(() => expect(document.querySelector(".card .trace")).toBeNull(), { timeout: 10_000 });
    fireEvent.click(within(said()!).getByRole("button", { name: /^Go/ }));
    await waitFor(() => expect(scroller.scrollTop).toBe(0), { timeout: 10_000 });
    expect(boardName()).toMatch(/Inbox/);
    await waitFor(
      () => expect(document.querySelector(".card .trace")?.closest(".card")?.textContent).toMatch(/zzzlandedabove/i),
      { timeout: 10_000 },
    );
    expect(said()).toBeNull();
  });

  it("says nothing when the card lands in view at the top", async () => {
    await open();
    await goToBoard(/^inbox/i);
    write("zzzlandsinview");
    fireEvent.click(screen.getByRole("button", { name: "Save note" }));
    expect(await screen.findByRole("button", { name: /zzzlandsinview/i }, { timeout: 10_000 })).toBeTruthy();
    expect(said()).toBeNull();
  });

  it("goes by itself", async () => {
    await open();
    await goToBoard(/^links/i);
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      write("zzzfadesaway");
      fireEvent.click(screen.getByRole("button", { name: "Save note" }));
      await waitFor(() => expect(said()).toBeTruthy(), { timeout: 10_000 });
      await vi.advanceTimersByTimeAsync(6_000);
      await waitFor(() => expect(said()).toBeNull(), { timeout: 10_000 });
    } finally {
      vi.useRealTimers();
    }
  });
});

// Said by the header's creature since 2026-10-16: "Hm. You saved this … · Open".
describe("an address that is already saved", () => {
  it("says so while it is being written, opens the saved note, and still saves", async () => {
    await putNote(note("zzztwin-held", "Recipe https://www.example.com/zzzsoup/#method"));
    await open();

    write("try this http://example.com/zzzsoup");
    await waitFor(() => expect(said()?.textContent).toMatch(/You saved this on 5 Jan/), { timeout: 10_000 });

    // Information only: Save saves the new note as it always did.
    fireEvent.click(screen.getByRole("button", { name: "Save note" }));
    expect(await screen.findByRole("button", { name: /try this/i }, { timeout: 10_000 })).toBeTruthy();
    // ...and it went with the words.
    expect(said()).toBeNull();

    // Two notes hold it now, and the newest answers.
    write("again https://example.com/zzzsoup/");
    await waitFor(() => expect(said()?.textContent).toMatch(/You saved this just now/), { timeout: 10_000 });
    fireEvent.click(within(said()!).getByRole("button", { name: /^Open/ }));
    await waitFor(() => expect(document.querySelector(".sheet")).toBeTruthy(), { timeout: 10_000 });
    expect(document.querySelector(".sheet")?.textContent).toMatch(/try this/i);
  });

  it("leaves a different page alone, and the trash out of it", async () => {
    await putNote(note("zzztwin-trashed", "https://example.com/zzzgone", { status: "trashed" }));
    await putNote(note("zzztwin-other", "https://example.com/zzzpage?id=1"));
    await open();

    write("https://example.com/zzzgone");
    write("https://example.com/zzzpage?id=2");
    // Give the lookup a render to be wrong in. The bubble may be saying
    // something else meanwhile (the trash sweep takes the old trashed note);
    // what matters is that it never says this page was saved.
    await new Promise((done) => setTimeout(done, 50));
    expect(said()?.textContent ?? "").not.toMatch(/You saved this/);
  });

  it("says it about a shared page after it arrives", async () => {
    await putNote(note("zzztwin-shared", "https://example.com/zzzshared-page", { status: "archived" }));
    const commit = vi.fn(async () => {});
    vi.mocked(takeShared).mockResolvedValueOnce({
      files: [],
      text: "A page https://example.com/zzzshared-page",
      commit,
    });
    render(<App />);
    await waitFor(() => expect(said()?.textContent).toMatch(/You saved this on 5 Jan, it's in the Archive/), {
      timeout: 10_000,
    });
  });
});

/**
 * The Inspiration offers (plan Task 9): what arrives from the phone's share
 * sheet may be filed into Inspiration with one tap, and nothing else is ever
 * offered it — a typed capture, or a share the reader leaves alone, goes where
 * it always went.
 */
describe("a share from the phone, offered Inspiration", () => {
  const picture = () => new File(["x"], "pic.png", { type: "image/png" });
  const shareOf = (files: File[], text = "") => ({ files, text, commit: vi.fn(async () => {}) });
  /** A share carrying files waits for one tap first (audit SEC-1). */
  const saveHeld = async () =>
    fireEvent.click(await screen.findByRole("button", { name: /^Save: 1 picture shared/ }, { timeout: 10_000 }));

  it("offers Inspiration on a shared picture for the few seconds the line shows, and files the note there with an undo", async () => {
    vi.mocked(takeShared).mockResolvedValueOnce(shareOf([picture()]));
    render(<App />);
    await saveHeld();
    const offer = await waitFor(
      () => within(line()!).getByRole("button", { name: /^Inspiration/ }),
      { timeout: 10_000 },
    );
    // The ordinary verb stands beside it, and the offer is not it.
    expect(within(line()!).getAllByRole("button")).toHaveLength(2);
    fireEvent.click(offer);
    // The line has done its job and goes; the note is on Inspiration now.
    expect(line()).toBeNull();
    const inspo = await screen.findByRole("tab", { name: /Inspiration/i }, { timeout: 10_000 });
    await waitFor(() => expect(inspo.textContent).toBe("Inspiration1"), { timeout: 10_000 });
    // One tap takes it back.
    fireEvent.click(await screen.findByRole("button", { name: /undo/i }, { timeout: 10_000 }));
    await waitFor(() => expect(inspo.textContent).toBe("Inspiration0"), { timeout: 10_000 });
  });

  it("leaves the picture where it would have gone when the offer is ignored", async () => {
    vi.mocked(takeShared).mockResolvedValueOnce(shareOf([picture()]));
    render(<App />);
    await saveHeld();
    await waitFor(() => expect(line()?.textContent).toMatch(/Inspiration/), { timeout: 10_000 });
    const inspo = await screen.findByRole("tab", { name: /Inspiration/i }, { timeout: 10_000 });
    expect(inspo.textContent).toBe("Inspiration0");
  });

  it("takes the offer away with the line, after its few seconds", async () => {
    vi.mocked(takeShared).mockResolvedValueOnce(shareOf([picture()]));
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      render(<App />);
      await saveHeld();
      await waitFor(() => expect(line()?.textContent).toMatch(/Inspiration/), { timeout: 10_000 });
      await vi.advanceTimersByTimeAsync(6_000);
      await waitFor(() => expect(line()).toBeNull(), { timeout: 10_000 });
      expect(screen.queryByRole("button", { name: /^Inspiration: / })).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("offers Save to Inspiration beside Save for a shared page, and that one tap files it", async () => {
    vi.mocked(takeShared).mockResolvedValueOnce(shareOf([], "A page https://example.com/zzzoffered"));
    render(<App />);
    const mark = await screen.findByRole("button", { name: "Save to Inspiration" }, { timeout: 10_000 });
    fireEvent.click(mark);
    await waitFor(() => expect(said()?.textContent).toMatch(/Tucked into Inspiration/), { timeout: 10_000 });
    expect(screen.queryByRole("button", { name: /Save to/ })).toBeNull();
  });

  it("never offers it for a typed capture", async () => {
    await open();
    await goToBoard(/^inbox/i);
    write("zzztypedonly");
    expect(screen.queryByRole("button", { name: /Save to/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Save note" }));
    expect(await screen.findByRole("button", { name: /zzztypedonly/i }, { timeout: 10_000 })).toBeTruthy();
    expect(line()).toBeNull();
    expect(said()).toBeNull();
  });
});
