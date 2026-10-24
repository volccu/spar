// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { beforeEach, afterEach, describe, expect, it } from "vitest";
import App from "./App";
import { setMeta, writeCaptureDraft } from "./store/db";
import { INBOX_ALL } from "./lib/boards";

/*
 * A file of its own for the reason `App.dissolve.test.tsx` gives: the test is
 * about a folder, a folder is left behind, and `App.test.tsx` shares one store
 * across seventy tests whose Move chooser counts the folders it can list.
 */

afterEach(cleanup);

beforeEach(async () => {
  localStorage.setItem("spar.deviceOnly", "1");
  await setMeta("inboxSince", INBOX_ALL);
  await writeCaptureDraft("");
});

async function makeBoard(name: string) {
  fireEvent.click(screen.getByRole("button", { name: "New board" }));
  const field = screen.getByLabelText("New board name");
  fireEvent.change(field, { target: { value: name } });
  fireEvent.keyDown(field, { key: "Enter" });
  return await screen.findByRole("tab", { name: new RegExp(name, "i") });
}

const boardName = () =>
  document.querySelector('[role="tab"][aria-selected="true"]')?.textContent ?? "";

const cards = () => Array.from(document.querySelectorAll<HTMLElement>(".card"));

describe("new note from selection", () => {
  /**
   * Merge's inverse, end to end: the picked words become a note of their own
   * in the same folder, they leave the note they came from, and one undo puts
   * both halves back — the words into the note, the new note into the trash.
   */
  it("files the new note beside the old one, and one undo puts both back", async () => {
    render(<App />);
    await waitFor(() => expect(cards().length).toBeGreaterThan(0), { timeout: 10_000 });

    fireEvent.click(await makeBoard("Split"));
    await waitFor(() => expect(boardName()).toMatch(/Split/i));

    const words = "Keep this paragraph\n\nMove this paragraph";
    fireEvent.change(screen.getByLabelText("Write a note"), { target: { value: words } });
    fireEvent.click(screen.getByRole("button", { name: "Save note" }));
    await waitFor(() => expect(cards()).toHaveLength(1));

    fireEvent.click(cards()[0]);
    // Long wait: under the full suite's load the open note has taken over a second.
    const reader = await screen.findByLabelText("Note text", {}, { timeout: 10_000 });
    fireEvent.click(reader);
    const field = (await screen.findByRole("textbox", { name: "Note text" })) as HTMLTextAreaElement;
    const at = field.value.indexOf("Move this");
    field.setSelectionRange(at, field.value.length);
    fireEvent.select(field);

    fireEvent.click(screen.getByRole("button", { name: "Insert" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "New note from selection" }));
    expect(field.value).toBe("Keep this paragraph");

    fireEvent.click(screen.getByRole("button", { name: "Close note" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Note" })).toBeNull());

    // Both halves, in the folder the note was filed in.
    await waitFor(() => expect(cards()).toHaveLength(2));
    const faces = () => cards().map((c) => c.querySelector(".card-body")?.textContent ?? "");
    expect(faces().sort()).toEqual(["Keep this paragraph", "Move this paragraph"]);

    fireEvent.click(screen.getByRole("button", { name: /^Undo: Split into a new note/ }));
    await waitFor(() => expect(cards()).toHaveLength(1));
    await waitFor(() => expect(faces()[0]).toMatch(/Keep this paragraph.*Move this paragraph/s));
  });
});
