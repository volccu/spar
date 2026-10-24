// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import App from "./App";
import { putNote, setMeta, writeCaptureDraft } from "./store/db";
import type { Note } from "./types";
import { INBOX_ALL } from "./lib/boards";

/*
 * What the header's creature says, end to end (2026-10-16, owner approved).
 * `lib/useSpeech.test.tsx` holds which sentence wins; this is the wiring: the
 * wordmark is gone, a poke is answered in the bubble, and a capture that
 * carries a reminder is told back with a way to take the reminder off.
 */

afterEach(cleanup);

beforeEach(async () => {
  localStorage.setItem("spar.deviceOnly", "1");
  await setMeta("inboxSince", INBOX_ALL);
  await writeCaptureDraft("");
});

const bubble = () => document.querySelector<HTMLElement>(".topbar .speech");

async function open() {
  render(<App />);
  await waitFor(() => expect(document.querySelectorAll(".card").length).toBeGreaterThan(0), {
    timeout: 10_000,
  });
}

describe("the header's creature, speaking", () => {
  it("stands in the header without the wordmark beside it", async () => {
    await open();
    expect(document.querySelector(".topbar .wordmark")).toBeNull();
    expect(bubble()).toBeNull();
  });

  it("answers a poke with where the notes are", async () => {
    await open();
    fireEvent.click(document.querySelector(".topbar spar-mascot")!);
    await waitFor(() => expect(bubble()?.textContent).toBe("Beep. Your notes are kept on this device."));
    // Said for a reader too, from the header's always-mounted region.
    const regions = [...document.querySelectorAll(".topbar [role='status']")].map((el) => el.textContent);
    expect(regions).toContain("Beep. Your notes are kept on this device.");
  });

  it("tells a capture's reminder back, and Undo takes only the reminder off", async () => {
    await open();
    fireEvent.change(screen.getByLabelText("Write a note"), { target: { value: "zzzremindme" } });
    fireEvent.click(screen.getByRole("button", { name: "Reminder" }));
    fireEvent.click(await screen.findByRole("menuitemradio", { name: /^In 1 hour/ }, { timeout: 10_000 }));
    fireEvent.click(screen.getByRole("button", { name: "Save note" }));

    await waitFor(() => expect(bubble()?.textContent).toMatch(/^Reminder set · /), { timeout: 10_000 });
    // The card's name carries its reminder (`cardName`): on, then off again.
    const card = () => screen.getByRole("button", { name: /zzzremindme/i });
    await waitFor(() => expect(card().getAttribute("aria-label") ?? card().textContent).toMatch(/reminder/), {
      timeout: 10_000,
    });

    fireEvent.click(within(bubble()!).getByRole("button", { name: /^Undo/ }));
    await waitFor(() => expect(card().getAttribute("aria-label") ?? "").not.toMatch(/reminder/), {
      timeout: 10_000,
    });
    // The note itself stays.
    expect(await screen.findByRole("button", { name: /zzzremindme/i })).toBeTruthy();
  });

  // A short screen folds the header band away, so the creature has nowhere to
  // speak: the board's undo offer stays a cell of the capture bar there.
  it("keeps the undo in the capture bar on a short screen", async () => {
    const tall = window.innerHeight;
    window.innerHeight = 420;
    try {
      await open();
      fireEvent.keyDown(window, { key: "ArrowRight" });
      fireEvent.keyDown(window, { key: "Delete" });
      await waitFor(() => expect(document.querySelector("form.capture .undo-slot-bar button.undo")).not.toBeNull());
      expect(bubble()).toBeNull();
    } finally {
      window.innerHeight = tall;
    }
  });

  it("speaks up just before a reminder rings, and Open opens the note", async () => {
    const soon = new Date(Date.now() + 3 * 60_000).toISOString();
    const made = "2026-01-05T09:00:00.000Z";
    await putNote({
      id: "zzzheadsup", raw_content: "Call the dentist", body: "Call the dentist", source: "web",
      created_at: made, updated_at: made, note_type: null, board_id: null, status: "active", priority: 0,
      reminder_at: soon, done: null, merged_from: null, keep_id: null, attachments: [],
    } as Note);
    await open();
    await waitFor(() => expect(bubble()?.textContent).toMatch(/^Ding. In 3 minutes: Call the dentist/), { timeout: 10_000 });
    fireEvent.click(within(bubble()!).getByRole("button", { name: /^Open/ }));
    await waitFor(() => expect(document.querySelector(".sheet")?.textContent).toMatch(/Call the dentist/), {
      timeout: 10_000,
    });
  });
});
