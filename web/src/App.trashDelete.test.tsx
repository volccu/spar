// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { putNote, setMeta, writeCaptureDraft } from "./store/db";
import { INBOX_ALL } from "./lib/boards";
import { forgetServerClock, noteServerDate } from "./store/serverClock";
import { note } from "./test/fixtures";

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

describe("the Delete key with a selection in the Trash", () => {
  it("does not announce 'Deleted 1' for a note that was already in the Trash", async () => {
    const stamp = new Date().toISOString();
    await putNote(note({ id: "td-1", body: "zzzbinned one", raw_content: "zzzbinned one", status: "trashed", updated_at: stamp, created_at: stamp }));
    render(<App />);
    await waitFor(() => expect(document.querySelectorAll(".card").length).toBeGreaterThan(0), { timeout: 10_000 });
    fireEvent.click(screen.getByRole("button", { name: "Menu" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: /^Trash/ }));
    const card = await screen.findByRole("button", { name: /zzzbinned one/i });
    fireEvent.contextMenu(card);
    await waitFor(() => expect(screen.queryByRole("button", { name: /^Menu, 1 selected$/ })).toBeTruthy());
    fireEvent.keyDown(document.body, { key: "Delete" });
    await new Promise((r) => setTimeout(r, 300));
    // Nothing was deleted: the note was already in the Trash. No toast should claim otherwise.
    expect(screen.queryByRole("button", { name: /Undo: Deleted/ })).toBeNull();
  });
});
