// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Backend, SignupState } from "./backend";

/**
 * `useAuth` in front of a backend that signs in by password — a spår server.
 * The magic-link half is held in `useAuth.test.tsx`; this holds what the
 * password form leans on: the hook says which form to draw, learns what the
 * server allows before the form needs it, reports a refusal in the server's
 * words, and says so in words when the backend cannot sign anyone in yet
 * rather than failing silently. And a `/config.json` that names no backend
 * leaves the app on this device, ready, with no sign-in screen at all.
 */

const auth = vi.hoisted(() => ({
  backend: null as unknown,
  listener: null as ((session: { user: { id: string } } | null) => void) | null,
}));

vi.mock("./supabase", () => ({ syncConfigured: true }));
vi.mock("./backend", () => ({ getBackend: async () => auth.backend }));

import { useAuth } from "./useAuth";

function passwordBackend(overrides: Partial<Record<string, unknown>> = {}) {
  const password = {
    kind: "password" as const,
    signupState: vi.fn(async (): Promise<SignupState> => ({ mode: "invite", firstAccount: false })),
    signIn: vi.fn(async () => ({ error: null })),
    signUp: vi.fn(async () => ({ error: null })),
    ...overrides,
  };
  return {
    kind: "spar-server",
    auth: password,
    session: async () => null,
    onSessionChange: (listener: (session: { user: { id: string } } | null) => void) => {
      auth.listener = listener;
      return () => {};
    },
    signOut: async () => ({ error: null }),
  } as unknown as Backend & { auth: typeof password };
}

beforeEach(() => {
  auth.backend = passwordBackend();
  auth.listener = null;
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("useAuth with a password backend", () => {
  it("asks for the password form, and learns what the server allows", async () => {
    const { result } = renderHook(() => useAuth());
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.method).toBe("password");
    await waitFor(() =>
      expect(result.current.signup).toEqual({ mode: "invite", firstAccount: false }),
    );
    expect(result.current.syncConfigured).toBe(true);
  });

  it("reads a server that will not say as closed", async () => {
    auth.backend = passwordBackend({
      signupState: vi.fn(async () => {
        throw new Error("no answer");
      }),
    });
    const { result } = renderHook(() => useAuth());
    await waitFor(() =>
      expect(result.current.signup).toEqual({ mode: "closed", firstAccount: false }),
    );
  });

  it("signs in, and hears the session through the subscription", async () => {
    const backend = auth.backend as ReturnType<typeof passwordBackend>;
    const { result } = renderHook(() => useAuth());
    await waitFor(() => expect(result.current.ready).toBe(true));

    await act(() => result.current.signInWithPassword("me@example.com", "secret"));
    expect(backend.auth.signIn).toHaveBeenCalledWith("me@example.com", "secret");
    expect(result.current.error).toBeNull();

    act(() => auth.listener?.({ user: { id: "me" } }));
    expect(result.current.session).toEqual({ user: { id: "me" } });
  });

  it("says in the server's words why it would not sign in", async () => {
    auth.backend = passwordBackend({
      signIn: vi.fn(async () => ({ error: { message: "Wrong address or password." } })),
    });
    const { result } = renderHook(() => useAuth());
    await waitFor(() => expect(result.current.ready).toBe(true));
    await act(() => result.current.signInWithPassword("me@example.com", "wrong"));
    expect(result.current.error).toBe("Wrong address or password.");
  });

  it("says so when the server cannot sign anyone in yet, rather than nothing", async () => {
    auth.backend = passwordBackend({
      signIn: vi.fn(() => {
        throw new Error("This server cannot sign anyone in yet.");
      }),
    });
    const { result } = renderHook(() => useAuth());
    await waitFor(() => expect(result.current.ready).toBe(true));
    await act(() => result.current.signInWithPassword("me@example.com", "secret"));
    expect(result.current.error).toBe("This server cannot sign anyone in yet.");
  });

  it("makes an account with the invite, and leaves the invite out when there is none", async () => {
    const backend = auth.backend as ReturnType<typeof passwordBackend>;
    const { result } = renderHook(() => useAuth());
    await waitFor(() => expect(result.current.ready).toBe(true));
    await act(() => result.current.signUp("new@example.com", "secret", "ABC"));
    await act(() => result.current.signUp("new@example.com", "secret"));
    expect(backend.auth.signUp.mock.calls).toEqual([
      [{ email: "new@example.com", password: "secret", invite: "ABC" }],
      [{ email: "new@example.com", password: "secret" }],
    ]);
  });

  it("does not mail a link through a backend that takes passwords", async () => {
    const { result } = renderHook(() => useAuth());
    await waitFor(() => expect(result.current.ready).toBe(true));
    await act(() => result.current.signIn("me@example.com"));
    expect(result.current.sent).toBe(false);
  });
});

describe("useAuth when the configuration names no backend", () => {
  it("settles on this device alone, with nothing to sign in to", async () => {
    auth.backend = null;
    const { result } = renderHook(() => useAuth());
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.syncConfigured).toBe(false);
    expect(result.current.session).toBeNull();
  });
});
