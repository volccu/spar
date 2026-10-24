// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { allNotes, putNote, setMeta, writeCaptureDraft } from "./store/db";
import { INBOX_ALL } from "./lib/boards";
import { note } from "./test/fixtures";

/*
 * Signing out from the menu asks what to do with the notes on this device
 * (audit 2026-10-10, SEC-2): remove them, or keep them here. A session that
 * lapses by itself is not asked (`App.signedOut.test.tsx`).
 */

vi.mock("./store/useAuth", async (importOriginal) => {
  const real = await importOriginal<typeof import("./store/useAuth")>();
  const { useState } = await import("react");
  return {
    ...real,
    useAuth: () => {
      const [session, setSession] = useState<{ user: { id: string } } | null>({
        user: { id: "user-1" },
      });
      return {
        session,
        ready: true,
        sent: false,
        error: null,
        signIn: vi.fn(),
        signOut: async () => {
          setSession(null);
          return true;
        },
        resetSent: vi.fn(),
        syncConfigured: true,
        method: "magic-link" as const,
        signup: null,
        signInWithPassword: vi.fn(),
        signUp: vi.fn(),
      };
    },
  };
});

vi.mock("./store/useSync", async (importOriginal) => {
  const real = await importOriginal<typeof import("./store/useSync")>();
  return {
    ...real,
    useSync: () => ({
      state: "idle",
      busy: false,
      lastError: null,
      held: [],
      retryHeld: vi.fn(async () => {}),
      keepHeldLocal: vi.fn(async () => {}),
      pulledOnce: true,
    }),
  };
});

const reload = vi.fn();
const realLocation = window.location;

afterEach(() => {
  cleanup();
  Object.defineProperty(window, "location", { configurable: true, value: realLocation });
});

beforeEach(async () => {
  localStorage.removeItem("spar.deviceOnly");
  reload.mockReset();
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { ...realLocation, reload },
  });
  await setMeta("inboxSince", INBOX_ALL);
  await writeCaptureDraft("");
  await putNote(note({ id: "sec2-a", body: "a note on a borrowed computer" }));
});

async function signOutFromTheMenu() {
  render(<App />);
  await waitFor(() => expect(document.querySelectorAll(".card").length).toBeGreaterThan(0), {
    timeout: 10_000,
  });
  // The row moved from the menu into Settings' Account section (2026-10-11),
  // and Settings is the header's cog (2026-10-12).
  fireEvent.click(screen.getByRole("button", { name: "Settings" }));
  fireEvent.click(await screen.findByRole("button", { name: "Account" }, { timeout: 10_000 }));
  fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
  return screen.findByRole(
    "alertdialog",
    { name: "Remove notes from this device, or keep them here?" },
    { timeout: 10_000 },
  );
}

describe("signing out from the menu", () => {
  it("asks, and Keep leaves the board with its sign-in line", async () => {
    const question = await signOutFromTheMenu();
    fireEvent.click(within(question).getByRole("button", { name: "Keep them here" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(await screen.findByText(/^Not signed in. Sign in to sync/)).toBeTruthy();
    expect(document.querySelectorAll(".card").length).toBeGreaterThan(0);
    expect(reload).not.toHaveBeenCalled();
    expect((await allNotes()).length).toBeGreaterThan(0);
  });

  it("asks, and Remove empties this device and reloads into the sign-in wall", async () => {
    const question = await signOutFromTheMenu();
    fireEvent.click(within(question).getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(reload).toHaveBeenCalled());
    expect(await allNotes()).toEqual([]);
  });
});
