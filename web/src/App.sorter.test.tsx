// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import App from "./App";
import { allNotes, markSeeded, putNote, setMeta, writeCaptureDraft } from "./store/db";
import { INBOX_ALL } from "./lib/boards";
import type { Note } from "./types";

/*
 * The Sorter's answers, on the app's side: each one reaches the store —
 * Important, to-do, and a folder made and filed into. `Sorter.test.tsx` covers
 * the screen itself, its summary and its Put back.
 */

const ID = "zzzsort-note";

afterEach(cleanup);

beforeEach(async () => {
  localStorage.setItem("spar.deviceOnly", "1");
  sessionStorage.clear();
  // No seed: the pile is this one note, whatever a machine's seed holds
  // (the owner's real archive put 97 notes ahead of it).
  await markSeeded();
  await setMeta("inboxSince", INBOX_ALL);
  await writeCaptureDraft("");
  const now = new Date().toISOString();
  const note: Note = {
    id: ID,
    raw_content: "zzzsort words",
    body: "zzzsort words",
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
});

const stored = async () => (await allNotes()).find((n) => n.id === ID);

async function openSorter() {
  render(<App />);
  await waitFor(() => expect(document.querySelectorAll(".card").length).toBeGreaterThan(0), {
    timeout: 10_000,
  });
  fireEvent.click(screen.getByRole("button", { name: "Menu" }));
  fireEvent.click(await screen.findByRole("menuitem", { name: /tidy up/i }));
  return screen.findByRole("dialog", { name: "Tidy up Inbox" }, { timeout: 5000 });
}

describe("the Sorter's answers reach the store", () => {
  it("marks, then files into a folder made on the spot", async () => {
    const sorter = await openSorter();
    // The newest note leads the pile.
    expect(sorter.textContent).toMatch(/zzzsort words/);

    fireEvent.click(within(sorter).getByRole("button", { name: "Important" }));
    await waitFor(async () => expect((await stored())?.priority).toBe(1));

    fireEvent.click(within(sorter).getByRole("button", { name: "To-do" }));
    await waitFor(async () => expect((await stored())?.note_type).toBe("todo"));

    const more = within(sorter).queryByRole("button", { name: /move to a board/i });
    if (more) fireEvent.click(more);
    fireEvent.click(within(sorter).getByRole("button", { name: /new board/i }));
    const field = within(sorter).getByRole("textbox", { name: "New board name" });
    fireEvent.change(field, { target: { value: "Zzzfolder" } });
    fireEvent.keyDown(field, { key: "Enter" });
    await waitFor(async () => expect((await stored())?.board_id).toBeTruthy());
  });
});

describe("opening the note from Tidy up", () => {
  it("opens the whole note over the pile, and closing it comes back to the same card", async () => {
    const sorter = await openSorter();
    fireEvent.click(within(sorter).getByRole("button", { name: "Open note" }));
    const sheet = await screen.findByRole("dialog", { name: "Note" }, { timeout: 5000 });
    expect(sheet.textContent).toMatch(/zzzsort words/);
    // The pile is still underneath, on the same card.
    expect(screen.getByRole("dialog", { name: "Tidy up Inbox" }).textContent).toMatch(/1 of 1/);

    fireEvent.click(screen.getByRole("button", { name: "Close note" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Note" })).toBeNull());
    const still = screen.getByRole("dialog", { name: "Tidy up Inbox" });
    expect(still.textContent).toMatch(/1 of 1/);
    expect(still.textContent).toMatch(/zzzsort words/);
  });
});
