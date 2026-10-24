// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { allNotes, putNote, setMeta, writeCaptureDraft } from "./store/db";
import { INBOX_ALL } from "./lib/boards";
import { forgetServerClock, noteServerDate } from "./store/serverClock";
import { note } from "./test/fixtures";

/*
 * Move in a trashed open note takes the note out of the Trash, as filing does
 * in Tidy up, with one undo for both (audit 2026-10-10, UX-2). Before, it wrote
 * the board and left the note counting down in the Trash.
 */

vi.mock("./lib/shareTarget", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./lib/shareTarget")>()),
  takeShared: vi.fn(async () => null),
}));

vi.setConfig({ testTimeout: 40_000 });

afterEach(cleanup);

beforeEach(async () => {
  forgetServerClock();
  noteServerDate(new Date().toUTCString());
  localStorage.setItem("spar.deviceOnly", "1");
  await setMeta("inboxSince", INBOX_ALL);
  await writeCaptureDraft("");
});

describe("Move in a note in the Trash", () => {
  it("takes it out of the Trash into the board, and one undo puts it back", async () => {
    const stamp = new Date().toISOString();
    await putNote(
      note({
        id: "ux2-binned",
        body: "zzzbinned rescue me",
        raw_content: "zzzbinned rescue me",
        status: "trashed",
        updated_at: stamp,
        created_at: stamp,
      }),
    );
    render(<App />);
    await waitFor(() => expect(document.querySelectorAll(".card").length).toBeGreaterThan(0), {
      timeout: 10_000,
    });
    fireEvent.click(screen.getByRole("button", { name: "Menu" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: /^Trash/ }));
    const card = await screen.findByRole("button", { name: /zzzbinned rescue me/i });
    fireEvent.click(card);
    await waitFor(() => expect(document.querySelector(".sheet")).toBeTruthy());

    // Marks for a note in use stand down; Put back and Move stay.
    const sheet = document.querySelector(".sheet") as HTMLElement;
    expect(within(sheet).queryByRole("button", { name: "Important" })).toBeNull();
    expect(within(sheet).queryByRole("button", { name: "To-do" })).toBeNull();
    expect(within(sheet).queryByRole("button", { name: "Set a reminder" })).toBeNull();
    expect(within(sheet).getByRole("button", { name: "Put back" })).toBeTruthy();

    fireEvent.click(within(sheet).getByRole("button", { name: "Move to a board" }));
    const field = await screen.findByLabelText("Search boards or name a new one");
    fireEvent.change(field, { target: { value: "zzzrescued" } });
    fireEvent.keyDown(field, { key: "Enter" });
    await waitFor(async () => {
      const moved = (await allNotes()).find((n) => n.id === "ux2-binned")!;
      expect(moved.status).toBe("active");
      expect(moved.board_id).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "Close note" }));
    await waitFor(() => expect(document.querySelector(".sheet")).toBeNull());
    fireEvent.click(await screen.findByRole("button", { name: /^Undo: Moved 1/ }));
    await waitFor(async () => {
      const back = (await allNotes()).find((n) => n.id === "ux2-binned")!;
      expect(back.status).toBe("trashed");
      expect(back.board_id).toBeNull();
    });
  });
});

/* Audit 2026-10-10, UX-1: the most common reason to search for a known note is
   that it was deleted. The empty answer says so and offers the way, and the
   trashed note is still never a result. */
describe("a search whose only match is in the Trash", () => {
  it("says so, and Go to Trash goes there", async () => {
    const stamp = new Date().toISOString();
    await putNote(
      note({
        id: "ux1-binned",
        body: "qqqwhereisit plumber number",
        raw_content: "qqqwhereisit plumber number",
        status: "trashed",
        updated_at: stamp,
        created_at: stamp,
      }),
    );
    render(<App />);
    await waitFor(() => expect(document.querySelectorAll(".card").length).toBeGreaterThan(0), {
      timeout: 10_000,
    });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    fireEvent.change(screen.getByLabelText("Search notes"), { target: { value: "qqqwhereisit" } });
    expect(await screen.findByText("1 match is in the Trash.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /qqqwhereisit/i })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Go to Trash" }));
    expect(await screen.findByRole("button", { name: /qqqwhereisit plumber/i })).toBeTruthy();
    expect(screen.queryByLabelText("Search notes")).toBeNull();
  });
});
