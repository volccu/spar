// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { setMeta, writeCaptureDraft } from "./store/db";
import { INBOX_ALL } from "./lib/boards";

/*
 * Inspiration waits for the account's own answer (plan Review Focus 2).
 *
 * The first-open question once answered itself on a device that had not yet
 * heard from the server, and pushed an empty list over four real folders.
 * Adopting Inspiration is a write to that same list, so it must wait for the
 * same thing: a whole sync tick come round clean (`idle`). A file of its own,
 * because the sign-in and the sync loop are replaced for the whole file.
 */

const sync = vi.hoisted(() => ({ state: "working" as "working" | "idle" }));

vi.mock("./store/useAuth", async (importOriginal) => {
  const real = await importOriginal<typeof import("./store/useAuth")>();
  return {
    ...real,
    useAuth: () => ({
      session: { user: { id: "user-1" } },
      ready: true,
      sent: false,
      error: null,
      signIn: vi.fn(),
      signOut: vi.fn(),
      resetSent: vi.fn(),
      syncConfigured: true,
      method: "magic-link" as const,
      signup: null,
      signInWithPassword: vi.fn(),
      signUp: vi.fn(),
    }),
  };
});

vi.mock("./store/useSync", async (importOriginal) => {
  const real = await importOriginal<typeof import("./store/useSync")>();
  return {
    ...real,
    useSync: () => ({
      state: sync.state,
      busy: sync.state === "working",
      lastError: null,
      held: [],
      retryHeld: vi.fn(async () => {}),
      keepHeldLocal: vi.fn(async () => {}),
      pulledOnce: sync.state === "idle",
    }),
  };
});

afterEach(cleanup);

beforeEach(async () => {
  localStorage.removeItem("spar.deviceOnly");
  sync.state = "working";
  await setMeta("inboxSince", INBOX_ALL);
  await writeCaptureDraft("");
});

describe("adopting Inspiration on a synced account", () => {
  it("does not adopt until a whole sync tick has come round clean", async () => {
    const { rerender } = render(<App />);
    await waitFor(() => expect(document.querySelectorAll(".card").length).toBeGreaterThan(0), {
      timeout: 10_000,
    });
    // Notes are in and the preferences are read (the shelf is drawn from them),
    // but the server has not answered. Let the frames go by, inside `act`, so
    // every effect that is going to run has run — a fixed sleep proved nothing
    // under load, a count of frames does not depend on how slow the machine is.
    await screen.findByRole("tab", { name: /Archive/i }, { timeout: 10_000 });
    await act(async () => {
      await new Promise<void>((resolve) => {
        let left = 5;
        const tick = () => (--left <= 0 ? resolve() : window.requestAnimationFrame(tick));
        window.requestAnimationFrame(tick);
      });
    });
    expect(screen.queryByRole("tab", { name: /Inspiration/i })).toBeNull();

    sync.state = "idle";
    rerender(<App />);
    expect(await screen.findByRole("tab", { name: /Inspiration/i }, { timeout: 10_000 })).toBeTruthy();
  });
});
