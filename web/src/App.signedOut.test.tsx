// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { putNote, setMeta, writeCaptureDraft } from "./store/db";
import { INBOX_ALL } from "./lib/boards";
import { note } from "./test/fixtures";

/*
 * A session that ended on a device that holds notes (review QA-06): the board
 * stays, with one line saying the notes are waiting for a sign-in. The sign-in
 * wall is for a device with nothing on it, or for the line's own button.
 */

vi.mock("./store/useAuth", async (importOriginal) => {
  const real = await importOriginal<typeof import("./store/useAuth")>();
  return {
    ...real,
    useAuth: () => ({
      session: null,
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

afterEach(cleanup);

beforeEach(async () => {
  localStorage.removeItem("spar.deviceOnly");
  await setMeta("inboxSince", INBOX_ALL);
  await writeCaptureDraft("");
});

describe("a signed-out device that holds notes", () => {
  it("keeps the board with one line, and the line's button asks for the sign-in", async () => {
    await putNote(note({ id: "qa06-a", body: "first note here" }));
    await putNote(note({ id: "qa06-b", body: "second note here" }));
    render(<App />);
    const line = await screen.findByText(/^Not signed in. Sign in to sync \d+ notes\.$/, {}, { timeout: 10_000 });
    expect(line).toBeTruthy();
    await waitFor(() => expect(document.querySelectorAll(".card").length).toBeGreaterThan(0));
    expect(screen.queryByText(/No password/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByText(/No password/)).toBeTruthy();
  });
});

describe("signing in from a device that chose to do without", () => {
  it("opens the sign-in screen on the first tap in Settings, not the banner", async () => {
    localStorage.setItem("spar.deviceOnly", "1");
    await putNote(note({ id: "one-tap-a", body: "first note here" }));
    render(<App />);
    await waitFor(() => expect(document.querySelectorAll(".card").length).toBeGreaterThan(0), {
      timeout: 10_000,
    });
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.click(await screen.findByRole("button", { name: "Account" }, { timeout: 10_000 }));
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByText(/No password/)).toBeTruthy();
  });
});
