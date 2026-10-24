// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import App from "./App";
import { allNotes, putNote, setMeta, writeCaptureDraft } from "./store/db";
import { INBOX_ALL } from "./lib/boards";
import type { Note } from "./types";

/*
 * The selection panel's verbs that `App.test.tsx` does not already drive end
 * to end — Archive, Important, Links and Put back — each reaching the store.
 * (Delete, Move and to-do are `App.test.tsx`'s.)
 */

const PLAIN = "zzzsel-plain";
const LINKED = "zzzsel-linked";
const BINNED = "zzzsel-binned";

function note(id: string, body: string, status: Note["status"] = "active"): Note {
  const now = new Date().toISOString();
  return {
    id,
    raw_content: body,
    body,
    source: "web",
    created_at: now,
    updated_at: now,
    note_type: null,
    board_id: null,
    status,
    priority: 0,
    reminder_at: null,
    done: null,
    merged_from: null,
    keep_id: null,
    attachments: [],
  };
}

afterEach(cleanup);

beforeEach(async () => {
  localStorage.setItem("spar.deviceOnly", "1");
  sessionStorage.clear();
  await setMeta("inboxSince", INBOX_ALL);
  await writeCaptureDraft("");
  await putNote(note(PLAIN, "zzzsel plain words"));
  await putNote(note(LINKED, "zzzsel linked words https://example.com/zzzsel"));
  await putNote(note(BINNED, "zzzsel binned words", "trashed"));
});

const stored = async (id: string) => (await allNotes()).find((n) => n.id === id);
const card = (id: string) => document.querySelector<HTMLElement>(`.card[data-id="${id}"]`);

async function pick(id: string) {
  await waitFor(() => expect(card(id)).toBeTruthy(), { timeout: 10_000 });
  fireEvent.contextMenu(card(id)!);
  await waitFor(() => expect(screen.getByText(/1 selected/)).toBeTruthy());
  fireEvent.click(screen.getByRole("button", { name: /^Menu, \d+ selected$/ }));
}

describe("the selection's verbs reach the store", () => {
  it("archives", async () => {
    render(<App />);
    await pick(PLAIN);
    fireEvent.click(await screen.findByRole("button", { name: /^archive/i }));
    await waitFor(async () => expect((await stored(PLAIN))?.status).toBe("archived"));
  });

  it("marks as important", async () => {
    render(<App />);
    await pick(PLAIN);
    fireEvent.click(await screen.findByRole("button", { name: "Important" }));
    await waitFor(async () => expect((await stored(PLAIN))?.priority).toBe(1));
  });

  it("puts a note with an address on Links", async () => {
    render(<App />);
    await pick(LINKED);
    fireEvent.click(await screen.findByRole("button", { name: /^move/i }));
    fireEvent.click(await screen.findByRole("button", { name: /^links/i }));
    await waitFor(async () => expect((await stored(LINKED))?.note_type).toBe("link"));
  });

  it("puts a note back out of the trash", async () => {
    render(<App />);
    fireEvent.click(await screen.findByRole("tab", { name: /^trash/i }, { timeout: 10_000 }));
    await pick(BINNED);
    fireEvent.click(await screen.findByRole("button", { name: /^put back/i }));
    await waitFor(async () => expect((await stored(BINNED))?.status).toBe("active"));
  });
});
