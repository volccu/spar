// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { putNote, setMeta, writeCaptureDraft } from "./store/db";
import { INBOX_ALL } from "./lib/boards";
import type { HeldNote } from "./store/held";

/*
 * The two banners under the header — "somewhere this note has not reached".
 *
 * Neither state is easy to reach for real: one needs IndexedDB to refuse a
 * write or a read, the other needs a server to refuse a note. So the real
 * stores run as they always do and only the fields the banners read are
 * overridden, which pins the wiring between the stores and the banner — what
 * it says, and which of the store's own functions each button reaches.
 */

const stores = vi.hoisted(() => ({
  storageError: null as string | null,
  loadFailed: false,
  retryStorage: vi.fn(async () => {}),
  held: [] as HeldNote[],
  retryHeld: vi.fn(async () => {}),
  keepHeldLocal: vi.fn(async () => {}),
}));

vi.mock("./store/useNotes", async (importOriginal) => {
  const real = await importOriginal<typeof import("./store/useNotes")>();
  return {
    ...real,
    useNotes: (...args: Parameters<typeof real.useNotes>) => {
      const notes = real.useNotes(...args);
      if (stores.storageError === null) return notes;
      return {
        ...notes,
        storageError: stores.storageError,
        loadFailed: stores.loadFailed,
        retryStorage: stores.retryStorage,
      };
    },
  };
});

vi.mock("./store/useSync", async (importOriginal) => {
  const real = await importOriginal<typeof import("./store/useSync")>();
  return {
    ...real,
    useSync: (...args: Parameters<typeof real.useSync>) => {
      const sync = real.useSync(...args);
      if (stores.held.length === 0) return sync;
      return {
        ...sync,
        held: stores.held,
        retryHeld: stores.retryHeld,
        keepHeldLocal: stores.keepHeldLocal,
      };
    },
  };
});

afterEach(cleanup);

beforeEach(async () => {
  localStorage.setItem("spar.deviceOnly", "1");
  await setMeta("inboxSince", INBOX_ALL);
  await writeCaptureDraft("");
  stores.storageError = null;
  stores.loadFailed = false;
  stores.held = [];
  vi.clearAllMocks();
});

async function open() {
  render(<App />);
  await waitFor(() => expect(document.querySelectorAll(".card").length).toBeGreaterThan(0), {
    timeout: 10_000,
  });
}

const banners = () => screen.queryAllByRole("alert").filter((el) => el.matches(".storage-warning"));

describe("the storage banners", () => {
  it("says nothing when everything has reached where it is going", async () => {
    await open();
    expect(banners()).toHaveLength(0);
  });

  it("says a change is not on this device yet, and Try again asks the store", async () => {
    stores.storageError = "zzz not saved here yet";
    await open();
    const banner = banners()[0];
    expect(within(banner).getByText("zzz not saved here yet")).toBeTruthy();
    expect(within(banner).queryByRole("button", { name: "Reload" })).toBeNull();
    fireEvent.click(within(banner).getByRole("button", { name: "Try again" }));
    expect(stores.retryStorage).toHaveBeenCalledTimes(1);
  });

  it("offers a reload rather than a retry when the archive could not be read", async () => {
    stores.storageError = "zzz could not be opened";
    stores.loadFailed = true;
    render(<App />);
    const banner = await waitFor(() => {
      const found = banners()[0];
      expect(found).toBeTruthy();
      return found;
    });
    expect(within(banner).getByText("zzz could not be opened")).toBeTruthy();
    expect(within(banner).getByRole("button", { name: "Reload" })).toBeTruthy();
    expect(within(banner).queryByRole("button", { name: "Try again" })).toBeNull();
  });

  it("names the one note the server refused, and both ways out reach sync", async () => {
    await putNote({
      id: "zzzheld-one",
      raw_content: "zzzheld first line\nand more",
      body: "zzzheld first line\nand more",
      source: "web",
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
      note_type: null,
      board_id: null,
      status: "active",
      priority: 0,
      reminder_at: null,
      done: null,
      merged_from: null,
      keep_id: null,
      attachments: [],
    });
    stores.held = [
      { id: "zzzheld-one", stamp: "2026-01-01T00:00:00.000Z", message: "zzz refused", count: 1 },
    ];
    await open();
    const banner = await waitFor(() => {
      const found = banners().find((el) => /server/.test(el.textContent ?? ""));
      expect(found).toBeTruthy();
      return found!;
    });
    expect(within(banner).getByText(
      "“zzzheld first line” could not be saved to the server. Try again, or keep it on this device only.",
    )).toBeTruthy();
    fireEvent.click(within(banner).getByRole("button", { name: "Try again" }));
    expect(stores.retryHeld).toHaveBeenCalledTimes(1);
    fireEvent.click(within(banner).getByRole("button", { name: "Stop sending" }));
    expect(stores.keepHeldLocal).toHaveBeenCalledTimes(1);
  });

  it("counts the notes when the server refused more than one", async () => {
    stores.held = [
      { id: "a", stamp: "x", message: "no", count: 1 },
      { id: "b", stamp: "x", message: "no", count: 1 },
    ];
    await open();
    await waitFor(() =>
      expect(
        screen.getByText("2 notes could not be saved to the server. Try again, or keep them on this device only."),
      ).toBeTruthy(),
    );
  });
});
