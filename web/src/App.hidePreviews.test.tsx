// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { beforeEach, afterEach, describe, expect, it } from "vitest";
import App from "./App";
import { setMeta, writeCaptureDraft } from "./store/db";
import { INBOX_ALL } from "./lib/boards";

/*
 * A file of its own, for the reason `App.split.test.tsx` gives: the test files
 * a folder away from the seventy that share one store in `App.test.tsx`.
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

const cards = () => Array.from(document.querySelectorAll<HTMLElement>(".card"));
const previews = () => document.querySelectorAll(".link-previews .link-preview");

describe("hiding a link preview", () => {
  it("puts it away in the note and on the card, leaves the words alone, and one undo brings it back", async () => {
    render(<App />);
    await waitFor(() => expect(cards().length).toBeGreaterThan(0), { timeout: 10_000 });
    fireEvent.click(await makeBoard("Links here"));

    const words = "two spots https://one.example/a https://two.example/b";
    fireEvent.change(screen.getByLabelText("Write a note"), { target: { value: words } });
    fireEvent.click(screen.getByRole("button", { name: "Save note" }));
    await waitFor(() => expect(cards()).toHaveLength(1));
    // Two addresses: the card draws a ledger line for each.
    expect(cards()[0].querySelectorAll(".card-link-line")).toHaveLength(2);

    fireEvent.click(cards()[0]);
    await waitFor(() => expect(previews()).toHaveLength(2), { timeout: 10_000 });

    fireEvent.click(screen.getByLabelText("Hide preview of one.example"));
    await waitFor(() => expect(previews()).toHaveLength(1));
    expect(screen.getByText("1 hidden · show")).toBeTruthy();
    expect(screen.getByLabelText("Note text").textContent).toContain("https://one.example/a");

    fireEvent.click(screen.getByRole("button", { name: /^Undo: Hid preview/ }));
    await waitFor(() => expect(previews()).toHaveLength(2));
    expect(screen.queryByText("1 hidden · show")).toBeNull();

    // Hide again, then bring it back through the row.
    fireEvent.click(screen.getByLabelText("Hide preview of two.example"));
    await waitFor(() => expect(previews()).toHaveLength(1));
    fireEvent.click(screen.getByText("1 hidden · show"));
    await waitFor(() => expect(previews()).toHaveLength(2));

    // And the card keeps what is hidden off its face.
    fireEvent.click(screen.getByLabelText("Hide preview of one.example"));
    await waitFor(() => expect(previews()).toHaveLength(1));
    fireEvent.click(screen.getByRole("button", { name: "Close note" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Note" })).toBeNull());
    await waitFor(() => expect(cards()[0].querySelectorAll(".card-link-line")).toHaveLength(0));
    expect(cards()[0].querySelectorAll(".card-link-previews .link-preview")).toHaveLength(1);
  });
});
