// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

type Session = { user: { id: string } } | null;
type Listener = (event: string, session: Session) => void;

/** The one piece of the auth client `useNotes` listens to, held so a test can
 *  speak for supabase-js. */
const auth = vi.hoisted(() => ({ listener: null as Listener | null }));

vi.mock("./supabase", () => ({
  shellReady: () => {},
  syncConfigured: true,
  getSupabase: async () => ({
    auth: {
      onAuthStateChange: (listener: Listener) => {
        auth.listener = listener;
        return { data: { subscription: { unsubscribe: () => {} } } };
      },
    },
  }),
}));

import { useNotes } from "./useNotes";

afterEach(() => {
  cleanup();
  auth.listener = null;
});

const alice: Session = { user: { id: "alice" } };
const bob: Session = { user: { id: "bob" } };

async function mounted() {
  const hook = renderHook(() => useNotes());
  await waitFor(() => expect(hook.result.current.loading).toBe(false), { timeout: 15_000 });
  await waitFor(() => expect(auth.listener).not.toBeNull());
  return hook;
}

/**
 * An auth event is not an account change.
 *
 * supabase-js says `SIGNED_IN` for the same person every time the tab comes
 * back into view, and again whenever another tab speaks over its broadcast
 * channel. Read as a transition, each one emptied the board, flashed Loading,
 * lost the scroll and dropped the open note — for somebody who had only
 * switched apps and back.
 */
describe("the store and the session", () => {
  it("does nothing when the same person is signed in again", async () => {
    const { result } = await mounted();
    act(() => auth.listener!("INITIAL_SESSION", alice));
    act(() => {
      result.current.create("Written before the tab went to the background");
    });
    const before = result.current.notes;

    act(() => auth.listener!("SIGNED_IN", alice));
    act(() => auth.listener!("TOKEN_REFRESHED", alice));

    expect(result.current.loading).toBe(false);
    expect(result.current.notes).toBe(before);
  });

  it("takes a SIGNED_IN that beats INITIAL_SESSION as the first word, not a change", async () => {
    // On a cold open the refresh can answer before the initial session does.
    const { result } = await mounted();
    const before = result.current.notes;
    act(() => auth.listener!("SIGNED_IN", alice));
    act(() => auth.listener!("INITIAL_SESSION", alice));
    expect(result.current.loading).toBe(false);
    expect(result.current.notes).toBe(before);
  });

  it("reads the store again when the account really changes", async () => {
    const { result } = await mounted();
    act(() => auth.listener!("INITIAL_SESSION", alice));

    act(() => auth.listener!("SIGNED_IN", bob));
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false), { timeout: 15_000 });
  });

  it("does not sit on Loading after a sign-out", async () => {
    const { result } = await mounted();
    act(() => auth.listener!("INITIAL_SESSION", alice));
    let id = "";
    act(() => {
      id = result.current.create("Still on this device")!.id;
    });

    act(() => auth.listener!("SIGNED_OUT", null));
    await waitFor(() => expect(result.current.loading).toBe(false), { timeout: 15_000 });
    // The store is whole after a sign-out; it is read back, not forgotten.
    await waitFor(() => expect(result.current.notes.some((note) => note.id === id)).toBe(true));
  });
});
