// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { putNote, setMeta, writeCaptureDraft } from "./store/db";
import { INBOX_ALL } from "./lib/boards";
import { isReturnNavigation, stashReturn } from "./lib/returnState";
import type { Note } from "./types";

/*
 * The way back from a link that took the window — `lib/returnState.ts`.
 *
 * `returnState.test.ts` covers the stash itself. This is the app's two halves
 * of it: the spot it hands the stash is the board and the note on screen, and
 * a back/forward boot puts both back. jsdom cannot say what kind of navigation
 * booted it, so that one answer is handed in.
 */

vi.mock("./lib/returnState", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./lib/returnState")>()),
  isReturnNavigation: vi.fn(() => false),
}));

const NOTE_ID = "zzzreturn-note";

afterEach(cleanup);

beforeEach(async () => {
  localStorage.setItem("spar.deviceOnly", "1");
  sessionStorage.clear();
  await setMeta("inboxSince", INBOX_ALL);
  await writeCaptureDraft("");
  const now = new Date().toISOString();
  const note: Note = {
    id: NOTE_ID,
    raw_content: "zzzreturn words",
    body: "zzzreturn words",
    source: "web",
    created_at: now,
    updated_at: now,
    note_type: null,
    board_id: null,
    status: "active",
    priority: 0,
    reminder_at: null,
    done: null,
    merged_from: null,
    keep_id: null,
    attachments: [],
  };
  await putNote(note);
  vi.mocked(isReturnNavigation).mockReturnValue(false);
});

async function open() {
  render(<App />);
  await waitFor(() => expect(document.querySelectorAll(".card").length).toBeGreaterThan(0), {
    timeout: 10_000,
  });
}

const boardName = () =>
  document.querySelector('[role="tab"][aria-selected="true"]')?.textContent ?? "";

describe("the way back from a link", () => {
  it("stashes the board and the note that are on screen", async () => {
    await open();
    fireEvent.click(await screen.findByRole("tab", { name: /^all/i }));
    await waitFor(() => expect(boardName()).toMatch(/^all/i));
    fireEvent.click(await screen.findByRole("button", { name: /zzzreturn words/i }));
    await screen.findByRole("dialog", { name: "Note" }, { timeout: 10_000 });

    stashReturn();
    const spot = JSON.parse(sessionStorage.getItem("spar-return") ?? "null");
    expect(spot).toMatchObject({ boardId: "recent", openId: NOTE_ID });
  });

  it("puts the board and the note back on a back/forward boot", async () => {
    vi.mocked(isReturnNavigation).mockReturnValue(true);
    sessionStorage.setItem(
      "spar-return",
      JSON.stringify({ openId: NOTE_ID, boardId: "recent", scrollTop: 0, when: Date.now() }),
    );
    await open();
    await waitFor(() => expect(boardName()).toMatch(/^all/i));
    const sheet = await screen.findByRole("dialog", { name: "Note" }, { timeout: 10_000 });
    expect(sheet.textContent).toMatch(/zzzreturn words/i);
    // Spent: a second boot does not come back here.
    expect(sessionStorage.getItem("spar-return")).toBeNull();
  });

  it("leaves an ordinary open where it opens", async () => {
    sessionStorage.setItem(
      "spar-return",
      JSON.stringify({ openId: NOTE_ID, boardId: "recent", scrollTop: 0, when: Date.now() }),
    );
    await open();
    await waitFor(() => expect(sessionStorage.getItem("spar-return")).toBeNull());
    expect(boardName()).toMatch(/^inbox/i);
    expect(screen.queryByRole("dialog", { name: "Note" })).toBeNull();
  });
});
