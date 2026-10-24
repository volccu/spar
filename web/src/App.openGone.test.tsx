// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { act, cleanup, fireEvent, render, screen, waitFor, configure } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { setMeta, writeCaptureDraft, deleteNotes } from "./store/db";
import { TAB_CHANNEL } from "./store/tabs";
import { INBOX_ALL } from "./lib/boards";

configure({ asyncUtilTimeout: 30_000 });
vi.setConfig({ testTimeout: 90_000 });

afterEach(cleanup);
beforeEach(async () => {
  localStorage.setItem("spar.deviceOnly", "1");
  await setMeta("inboxSince", INBOX_ALL);
  await writeCaptureDraft("");
});

describe("a note destroyed elsewhere while it is open", () => {
  it("does not leave the board dead under an open note that is no longer there", async () => {
    render(<App />);
    await waitFor(() => expect(document.querySelectorAll(".card").length).toBeGreaterThan(0), {
      timeout: 10_000,
    });
    const card = document.querySelector<HTMLElement>(".card")!;
    const id = card.getAttribute("data-id")!;
    fireEvent.click(card);
    await screen.findByRole("dialog", {}, { timeout: 30_000 });
    // Another tab/device destroys it (what a tombstone or a second tab's empty-trash does).
    await deleteNotes([id]);
    const other = new BroadcastChannel(TAB_CHANNEL);
    await act(async () => {
      other.postMessage({ ids: [id] });
      await new Promise((r) => setTimeout(r, 200));
    });
    await waitFor(() => expect(document.querySelector(`.card[data-id="${id}"]`)).toBeNull());
    // The sheet is gone with the note. The board must be usable again.
    await new Promise((r) => setTimeout(r, 300));
    const board = document.querySelector<HTMLElement>("[inert]");
    expect(board ? `${board.tagName}.${board.className}` : null, "element still inert after the open note vanished").toBeNull();
    other.close();
  });

  it("and Escape cannot get out of it either", async () => {
    render(<App />);
    await waitFor(() => expect(document.querySelectorAll(".card").length).toBeGreaterThan(0), { timeout: 10_000 });
    const card = document.querySelector<HTMLElement>(".card")!;
    const id = card.getAttribute("data-id")!;
    fireEvent.click(card);
    await screen.findByRole("dialog", {}, { timeout: 30_000 });
    await deleteNotes([id]);
    const other = new BroadcastChannel(TAB_CHANNEL);
    await act(async () => {
      other.postMessage({ ids: [id] });
      await new Promise((r) => setTimeout(r, 200));
    });
    await waitFor(() => expect(document.querySelector(`.card[data-id="${id}"]`)).toBeNull());
    (document.activeElement as HTMLElement | null)?.blur();
    fireEvent.keyDown(document.body, { key: "Escape" });
    await new Promise((r) => setTimeout(r, 500));
    expect(document.querySelector("main.scroll[inert]")).toBeNull();
    other.close();
  });
});
