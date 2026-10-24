// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { allNotes, putNote, setMeta, writeCaptureDraft } from "./store/db";
import { INBOX_ALL } from "./lib/boards";
import { enablePush } from "./store/push";
import { takeReminderAnswers } from "./lib/reminderActions";
import type { Note } from "./types";

/*
 * The app's half of reminders: a tapped notification opens the note it was
 * about (cold, through `?note=`, and warm, through the worker's message), a
 * time set in the open note is written to the store and asks this device to
 * ring, and a Later or Done pressed in the shade becomes an edit.
 *
 * `store/push.ts` and `lib/reminderActions.ts` are covered on their own; this
 * pins the wiring between them and the board, which nothing else watched.
 */

vi.mock("./store/push", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./store/push")>()),
  refreshPush: vi.fn(async () => {}),
  pushState: vi.fn(async () => "on" as const),
  enablePush: vi.fn(async () => "on" as const),
  disablePush: vi.fn(async () => "off" as const),
  ringingOff: vi.fn(() => false),
  setRingingOff: vi.fn(),
}));

vi.mock("./lib/reminderActions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./lib/reminderActions")>()),
  takeReminderAnswers: vi.fn(async () => []),
}));

// The worker stub below would otherwise send the update watch off to
// register a real one.
vi.mock("./lib/appUpdate", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./lib/appUpdate")>()),
  watchForUpdate: vi.fn(async () => null),
}));

const PLAIN = "zzzremind-plain";
const RINGING = "zzzremind-ringing";
const RING_AT = "2099-01-01T09:00:00.000Z";

function note(id: string, body: string, reminder_at: string | null): Note {
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
    status: "active",
    priority: 0,
    reminder_at,
    done: null,
    merged_from: null,
    keep_id: null,
    attachments: [],
  };
}

const worker = new EventTarget();

afterEach(() => {
  cleanup();
  window.history.replaceState({}, "", "/");
});

beforeEach(async () => {
  localStorage.setItem("spar.deviceOnly", "1");
  sessionStorage.clear();
  await setMeta("inboxSince", INBOX_ALL);
  await writeCaptureDraft("");
  await putNote(note(PLAIN, "zzzremind plain words", null));
  await putNote(note(RINGING, "zzzremind ringing words", RING_AT));
  Object.defineProperty(navigator, "serviceWorker", { value: worker, configurable: true });
  vi.mocked(enablePush).mockClear();
  vi.mocked(takeReminderAnswers).mockResolvedValue([]);
});

async function open() {
  render(<App />);
  await waitFor(() => expect(document.querySelectorAll(".card").length).toBeGreaterThan(0), {
    timeout: 10_000,
  });
}

const stored = async (id: string) => (await allNotes()).find((n) => n.id === id);

describe("reminders, arriving", () => {
  it("opens the note a cold start from a notification names, and clears the address", async () => {
    window.history.replaceState({}, "", `/?note=${PLAIN}`);
    render(<App />);
    const sheet = await screen.findByRole("dialog", { name: "Note" }, { timeout: 10_000 });
    expect(sheet.textContent).toMatch(/zzzremind plain words/i);
    expect(window.location.search).toBe("");
  });

  it("opens the note the worker posts across while the app is open", async () => {
    await open();
    expect(screen.queryByRole("dialog", { name: "Note" })).toBeNull();
    worker.dispatchEvent(
      new MessageEvent("message", { data: { type: "open-note", note_id: RINGING } }),
    );
    const sheet = await screen.findByRole("dialog", { name: "Note" }, { timeout: 10_000 });
    expect(sheet.textContent).toMatch(/zzzremind ringing words/i);
  });

  it("writes a time set in the open note, and asks this device to ring", async () => {
    await open();
    fireEvent.click(await screen.findByRole("button", { name: /zzzremind plain words/i }));
    const sheet = await screen.findByRole("dialog", { name: "Note" }, { timeout: 10_000 });
    fireEvent.click(within(sheet).getByRole("button", { name: "Set a reminder" }));
    const panel = await screen.findByRole("menu", { name: "Reminder" });
    fireEvent.click(within(panel).getAllByRole("menuitemradio")[0]);
    await waitFor(async () => expect((await stored(PLAIN))?.reminder_at).toBeTruthy());
    await waitFor(() => expect(enablePush).toHaveBeenCalled());
  });

  // Review 2026-10-04, FX-B-06: the capture bar's clock. The preset becomes
  // `reminder_at` on the note's own first write, and Save is when this device
  // is asked to ring — not the tap on the clock, which only chose.
  it("saves a note with the reminder chosen in the write bar, and asks to ring at Save", async () => {
    await open();
    const field = screen.getByLabelText("Write a note");
    fireEvent.change(field, { target: { value: "zzzremind from the bar" } });
    fireEvent.click(screen.getByRole("button", { name: "Reminder" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: /^Next week/ }));
    expect(enablePush).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Save note" }));
    await waitFor(async () => {
      const made = (await allNotes()).find((n) => /zzzremind from the bar/i.test(n.body ?? ""));
      expect(made?.reminder_at).toBeTruthy();
      // Next week lands at 09:00, a week on.
      expect(new Date(made!.reminder_at!).getTime()).toBeGreaterThan(Date.now() + 6 * 86_400_000);
    });
    expect(enablePush).toHaveBeenCalledTimes(1);
  });

  it("applies a Done pressed in the shade once the archive is in", async () => {
    vi.mocked(takeReminderAnswers).mockResolvedValueOnce([
      { note_id: RINGING, action: "done", at: new Date().toISOString(), for: RING_AT },
    ]);
    await open();
    await waitFor(async () => expect((await stored(RINGING))?.reminder_at).toBeNull());
  });
});
