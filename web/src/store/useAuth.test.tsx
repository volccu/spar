// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { Session } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Sign-in exists only so the notes are private, and this hook is the whole of
 * what the app knows about it: whether a session exists, whether that is
 * settled yet, whether a link is on its way, and what went wrong.
 *
 * The auth client is scripted per case. What is held here is what the rest of
 * the app leans on: `ready` always turns true in the end, whatever fails; the
 * session follows the client's own change events; a mistyped address comes
 * back as words about the address; and a sign-out that did not happen says
 * so instead of looking exactly like one that did.
 */

type Listener = (event: string, next: Session | null) => void;

const auth = vi.hoisted(() => ({
  configured: true,
  /** How `getSupabase` answers: the client, or a failure to load it. */
  loadFails: null as Error | null,
  /** Held open until the case releases it, so "not yet ready" can be seen. */
  pendingClient: null as null | ((client: unknown) => void),
  holdClient: false,
  listener: null as Listener | null,
  unsubscribe: null as unknown as ReturnType<typeof vi.fn>,
  client: null as unknown as {
    auth: {
      getSession: ReturnType<typeof vi.fn>;
      onAuthStateChange: ReturnType<typeof vi.fn>;
      signInWithOtp: ReturnType<typeof vi.fn>;
      verifyOtp: ReturnType<typeof vi.fn>;
      signOut: ReturnType<typeof vi.fn>;
    };
  },
}));

vi.mock("./supabase", () => ({
  get syncConfigured() {
    return auth.configured;
  },
  getSupabase: () => {
    if (!auth.configured) return Promise.resolve(null);
    if (auth.loadFails) return Promise.reject(auth.loadFails);
    if (auth.holdClient) {
      return new Promise((resolve) => {
        auth.pendingClient = resolve;
      });
    }
    return Promise.resolve(auth.client);
  },
}));

import { deletionWords, useAuth } from "./useAuth";

const session = (id: string) =>
  ({ access_token: `token-${id}`, user: { id } }) as unknown as Session;

beforeEach(() => {
  auth.configured = true;
  auth.loadFails = null;
  auth.holdClient = false;
  auth.pendingClient = null;
  auth.listener = null;
  auth.unsubscribe = vi.fn();
  auth.client = {
    auth: {
      getSession: vi.fn(async () => ({ data: { session: null } })),
      onAuthStateChange: vi.fn((cb: Listener) => {
        auth.listener = cb;
        return { data: { subscription: { unsubscribe: auth.unsubscribe } } };
      }),
      signInWithOtp: vi.fn(async () => ({ error: null })),
      verifyOtp: vi.fn(async () => ({ error: null })),
      signOut: vi.fn(async () => ({ error: null })),
    },
  };
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("useAuth", () => {
  describe("settling the session", () => {
    it("is ready at once on a device-only build, with no session and no client", () => {
      // With no keys configured the app works completely on this device, and
      // nothing may wait on a server that is not there (SPEC §2.6).
      auth.configured = false;
      const { result } = renderHook(() => useAuth());
      expect(result.current.ready).toBe(true);
      expect(result.current.session).toBeNull();
      expect(result.current.syncConfigured).toBe(false);
    });

    it("is not ready until the client has answered", async () => {
      auth.holdClient = true;
      const { result } = renderHook(() => useAuth());
      expect(result.current.ready).toBe(false);

      await act(async () => auth.pendingClient?.(auth.client));
      await waitFor(() => expect(result.current.ready).toBe(true));
      expect(result.current.session).toBeNull();
    });

    it("picks up the session this browser already holds", async () => {
      const mine = session("me");
      auth.client.auth.getSession.mockResolvedValue({ data: { session: mine } });
      const { result } = renderHook(() => useAuth());
      await waitFor(() => expect(result.current.ready).toBe(true));
      expect(result.current.session).toBe(mine);
    });

    it("turns ready even when the client cannot be loaded", async () => {
      // A failed chunk (offline on a first open, a deploy mid-flight) leaves
      // no session, which the app can show. It must not leave `ready` false
      // forever, which the app cannot.
      vi.spyOn(console, "error").mockImplementation(() => {});
      auth.loadFails = new Error("chunk failed");
      const { result } = renderHook(() => useAuth());
      await waitFor(() => expect(result.current.ready).toBe(true));
      expect(result.current.session).toBeNull();
    });

    it("turns ready even when reading the session fails", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      auth.client.auth.getSession.mockRejectedValue(new Error("refresh failed"));
      const { result } = renderHook(() => useAuth());
      await waitFor(() => expect(result.current.ready).toBe(true));
      expect(result.current.session).toBeNull();
    });
  });

  describe("following the client", () => {
    it("takes the session the email link signs in with", async () => {
      const { result } = renderHook(() => useAuth());
      await waitFor(() => expect(result.current.ready).toBe(true));
      expect(result.current.session).toBeNull();

      const mine = session("me");
      act(() => auth.listener?.("SIGNED_IN", mine));
      expect(result.current.session).toBe(mine);
    });

    it("drops the session when the client signs out, from here or elsewhere", async () => {
      auth.client.auth.getSession.mockResolvedValue({ data: { session: session("me") } });
      const { result } = renderHook(() => useAuth());
      await waitFor(() => expect(result.current.session).not.toBeNull());

      act(() => auth.listener?.("SIGNED_OUT", null));
      expect(result.current.session).toBeNull();
    });

    it("stops listening when it goes away", async () => {
      const { result, unmount } = renderHook(() => useAuth());
      await waitFor(() => expect(result.current.ready).toBe(true));
      expect(auth.unsubscribe).not.toHaveBeenCalled();
      unmount();
      expect(auth.unsubscribe).toHaveBeenCalledTimes(1);
    });

    it("does not stay subscribed if it went away before the client arrived", async () => {
      // The client comes by dynamic import, so it can land after the screen
      // that asked for it has gone. Subscribing then and never letting go is
      // a listener kept alive by nothing.
      auth.holdClient = true;
      const { unmount } = renderHook(() => useAuth());
      unmount();
      await act(async () => auth.pendingClient?.(auth.client));
      expect(auth.client.auth.getSession).not.toHaveBeenCalled();
      expect(auth.client.auth.onAuthStateChange).not.toHaveBeenCalled();
    });
  });

  describe("signing in", () => {
    it("sends a link, and says so", async () => {
      const { result } = renderHook(() => useAuth());
      await waitFor(() => expect(result.current.ready).toBe(true));

      await act(() => result.current.signIn("me@example.com"));
      expect(result.current.sent).toBe(true);
      expect(result.current.error).toBeNull();
    });

    it("never creates an account, and brings the link back to this app", async () => {
      // Left on, a mistyped address is accepted in silence: a second account
      // is made, its link goes nowhere, and every board looks empty.
      const { result } = renderHook(() => useAuth());
      await act(() => result.current.signIn("me@example.com"));
      expect(auth.client.auth.signInWithOtp).toHaveBeenCalledWith({
        email: "me@example.com",
        options: { emailRedirectTo: window.location.origin, shouldCreateUser: false },
      });
    });

    it("blames the address, not the server, when there is no account for it", async () => {
      auth.client.auth.signInWithOtp.mockResolvedValue({
        error: { message: "Signups not allowed for otp" },
      });
      const { result } = renderHook(() => useAuth());
      await act(() => result.current.signIn("me@exmaple.com"));
      expect(result.current.sent).toBe(false);
      expect(result.current.error).toMatch(/no account for that address/i);
      expect(result.current.error).not.toMatch(/otp/i);
    });

    /** Every other failure in one plain sentence; the server's own words go
     *  to the console only (review CD-01). */
    it("says any other failure in the app's words, never the server's", async () => {
      const log = vi.spyOn(console, "error").mockImplementation(() => {});
      auth.client.auth.signInWithOtp.mockResolvedValue({
        error: { message: "Email rate limit exceeded" },
      });
      const { result } = renderHook(() => useAuth());
      await act(() => result.current.signIn("me@example.com"));
      expect(result.current.error).toBe("Too many tries. Wait a minute, then try again.");
      auth.client.auth.signInWithOtp.mockResolvedValue({ error: { message: "Failed to fetch" } });
      await act(() => result.current.signIn("me@example.com"));
      expect(result.current.error).toMatch(/^The server could not be reached\./);
      expect(log).toHaveBeenCalledWith("sign-in failed:", "Failed to fetch");
      log.mockRestore();
    });

    it("clears an old error when it tries again", async () => {
      auth.client.auth.signInWithOtp.mockResolvedValueOnce({
        error: { message: "Signups not allowed for otp" },
      });
      const { result } = renderHook(() => useAuth());
      await act(() => result.current.signIn("me@exmaple.com"));
      expect(result.current.error).not.toBeNull();

      await act(() => result.current.signIn("me@example.com"));
      expect(result.current.error).toBeNull();
      expect(result.current.sent).toBe(true);
    });

    it("goes back from 'check your email' to the form", async () => {
      // The sent screen used to be a dead end when the mail was slow or lost.
      const { result } = renderHook(() => useAuth());
      await act(() => result.current.signIn("me@example.com"));
      expect(result.current.sent).toBe(true);
      act(() => result.current.resetSent());
      expect(result.current.sent).toBe(false);
      expect(result.current.error).toBeNull();
    });
  });

  /**
   * The email's code, typed instead of following its link (audit UX-11): an
   * iPhone Home Screen app keeps its storage apart from Safari, where the
   * link opens, so the code is how that app signs itself in.
   */
  describe("signing in with the code instead", () => {
    it("checks the code against the address the link went to", async () => {
      const { result } = renderHook(() => useAuth());
      await act(() => result.current.signIn("me@example.com"));
      await act(() => result.current.verifyCode(" 123 456 "));
      expect(auth.client.auth.verifyOtp).toHaveBeenCalledWith({
        email: "me@example.com",
        token: "123456",
        type: "email",
      });
      expect(result.current.error).toBeNull();
    });

    it("asks nothing before a link has been sent", async () => {
      const { result } = renderHook(() => useAuth());
      await waitFor(() => expect(result.current.ready).toBe(true));
      await act(() => result.current.verifyCode("123456"));
      expect(auth.client.auth.verifyOtp).not.toHaveBeenCalled();
    });

    it("says a wrong or spent code in plain words", async () => {
      const log = vi.spyOn(console, "error").mockImplementation(() => {});
      auth.client.auth.verifyOtp.mockResolvedValue({ error: { message: "Token has expired or is invalid" } });
      const { result } = renderHook(() => useAuth());
      await act(() => result.current.signIn("me@example.com"));
      await act(() => result.current.verifyCode("000000"));
      expect(result.current.error).toBe(
        "That code did not work. Check it against the newest email, or try again.",
      );
      expect(result.current.sent).toBe(true);
      log.mockRestore();
    });
  });

  describe("signing out", () => {
    it("says it worked when the server took the logout", async () => {
      const { result } = renderHook(() => useAuth());
      let ok: boolean | undefined;
      await act(async () => {
        ok = await result.current.signOut();
      });
      expect(ok).toBe(true);
      expect(auth.client.auth.signOut).toHaveBeenCalledTimes(1);
      expect(result.current.error).toBeNull();
    });

    it("says it failed, rather than looking like it worked, when the logout did not go", async () => {
      // A failed sign-out leaves the session in place and the archive on
      // screen, reached from the moment the browser is about to be handed to
      // somebody else. It must not pass for one that worked.
      vi.spyOn(console, "error").mockImplementation(() => {});
      auth.client.auth.signOut.mockResolvedValue({ error: { message: "Failed to fetch" } });
      const { result } = renderHook(() => useAuth());
      let ok: boolean | undefined;
      await act(async () => {
        ok = await result.current.signOut();
      });
      expect(ok).toBe(false);
      expect(result.current.error).toMatch(/^The server could not be reached\./);
    });

    it("clears what the sign-in screen would otherwise show stale", async () => {
      auth.client.auth.signInWithOtp.mockResolvedValue({ error: null });
      const { result } = renderHook(() => useAuth());
      await act(() => result.current.signIn("me@example.com"));
      expect(result.current.sent).toBe(true);

      await act(async () => {
        await result.current.signOut();
      });
      expect(result.current.sent).toBe(false);
      expect(result.current.error).toBeNull();
    });

    it("does not claim a sign-out when there is no client to ask", async () => {
      auth.configured = false;
      const { result } = renderHook(() => useAuth());
      let ok: boolean | undefined;
      await act(async () => {
        ok = await result.current.signOut();
      });
      expect(ok).toBe(false);
    });
  });
});

describe("a request that is out", () => {
  it("is shown as busy, and a second tap on the code's button is ignored", async () => {
    const { result } = renderHook(() => useAuth());
    await act(() => result.current.signIn("me@example.com"));
    let release: (value: { error: null }) => void = () => {};
    auth.client.auth.verifyOtp.mockReturnValueOnce(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    let first: Promise<void> = Promise.resolve();
    act(() => {
      first = result.current.verifyCode("123456");
    });
    await waitFor(() => expect(result.current.busy).toBe(true));
    await act(() => result.current.verifyCode("123456"));
    expect(auth.client.auth.verifyOtp).toHaveBeenCalledTimes(1);
    await act(async () => {
      release({ error: null });
      await first;
    });
    expect(result.current.busy).toBe(false);
  });
});

describe("deleting an account when the server does not answer", () => {
  it("says nothing was deleted, not the sign-in way out", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(deletionWords("The server could not be reached: Failed to fetch")).toBe(
      "The server could not be reached, so nothing was deleted. Check the connection and try again.",
    );
    expect(deletionWords("Wrong password.")).toBe("Wrong password.");
    log.mockRestore();
  });
});
