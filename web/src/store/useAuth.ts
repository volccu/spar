import { useCallback, useEffect, useRef, useState } from "react";
import { takeLinkError } from "../lib/linkError";
import { syncConfigured } from "./supabase";
import { getBackend, type AuthSession, type SignupState } from "./backend";
import { RUNTIME_CONFIG } from "./backend/config";
import { signInWords } from "../lib/serverWords";

/**
 * Sign-in exists only so the notes are private. It is a one-time step per
 * device — a link arrives by email and the session persists afterwards.
 *
 * Anonymous sign-in was rejected: the public key ships inside the app, so a
 * permissive policy would let anyone who found the address read the notes.
 *
 * How a person signs in depends on the backend (`store/backend/`): Supabase
 * mails a link, and a spår server takes an email and a password. `method` says
 * which, and the app draws the form for it.
 */

/**
 * The server's word for what went wrong, in the app's (`lib/serverWords.ts`,
 * review CD-01): "Failed to fetch" and "JWT expired" name no cause and no next
 * step. `shouldCreateUser: false` reports a mistyped address as "Signups not
 * allowed for otp", which is the one error this screen can actually expect.
 */
function message(raw: string): string {
  return signInWords(raw);
}

/**
 * A typed code's failure. Supabase answers a wrong or spent code "Token has
 * expired or is invalid", which is the one thing this field can expect; the
 * rest are sign-in's own words.
 */
export function codeWords(raw: string): string {
  if (/expired|invalid/i.test(raw) && !/email/i.test(raw)) {
    return "That code did not work. Check it against the newest email, or try again.";
  }
  return signInWords(raw);
}

/** A thrown failure's words. The backends answer rather than throw; this is
 *  the net under that, so a failure is never silent. */
function thrown(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Deletes the signed-in account on a backend that allows it (a spår server),
 * after the password has been asked again. Resolves null when it is gone —
 * the backend then ends the session, and the app hears it through
 * `onSessionChange` like any sign-out — or with the sentence to show.
 *
 * A plain function rather than part of the hook: only a build that reads
 * `/config.json` reaches it, behind `RUNTIME_CONFIG`, so every other build
 * drops it whole.
 */
export async function deleteAccount(password: string): Promise<string | null> {
  const backend = await getBackend();
  if (!backend?.account) return "This server does not delete accounts from the app.";
  try {
    const { error } = await backend.account.delete(password);
    return error ? deletionWords(error.message) : null;
  } catch (failure) {
    return deletionWords(thrown(failure));
  }
}

/**
 * Sign-in's words, except for the server not answering: "or use this device
 * only" is no way out of deleting an account, and the person must know that
 * nothing was deleted.
 */
export function deletionWords(raw: string): string {
  const words = signInWords(raw, true);
  return words.startsWith("The server could not be reached")
    ? "The server could not be reached, so nothing was deleted. Check the connection and try again."
    : words;
}

export type SignInMethod = "magic-link" | "password";

export function useAuth() {
  const [session, setSession] = useState<AuthSession | null>(null);
  /**
   * Whether there is a backend to sign in to. A build with its values baked in
   * knows at once (`syncConfigured`); one that reads `/config.json` assumes so
   * until the file says otherwise, which keeps a first visit on Loading rather
   * than flashing a board and then a sign-in screen over it.
   */
  const [configured, setConfigured] = useState(RUNTIME_CONFIG || syncConfigured);
  const [ready, setReady] = useState(!(RUNTIME_CONFIG || syncConfigured));
  const [method, setMethod] = useState<SignInMethod>("magic-link");
  /** What a password backend says about making accounts; null until it has. */
  const [signup, setSignup] = useState<SignupState | null>(null);
  const [sent, setSent] = useState(false);
  /** The address the last link went to — what a typed code is checked against. */
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sending = useRef(false);
  /** A sign-in request is out: the forms disable their button and say so. */
  const [busy, setBusy] = useState(false);

  /** One request at a time, and the forms told while it runs. */
  const guarded = useCallback(async (run: () => Promise<void>) => {
    if (sending.current) return;
    sending.current = true;
    setBusy(true);
    try {
      await run();
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (!(RUNTIME_CONFIG || syncConfigured)) return;
    // A sign-in link that did not work says so, rather than a blank form.
    const refused = takeLinkError();
    if (refused) setError(refused);
    // The backend arrives by dynamic import (its chunk stays off the first
    // paint), so the subscription is set up when it lands and torn down
    // through the variable the cleanup closes over.
    let cancelled = false;
    let unsubscribe: (() => void) | null = null;
    // Either promise failing leaves the app with no session, which is a
    // state it already knows how to show; what it must not be left with is
    // `ready` never turning true.
    const noSession = (error: unknown) => {
      console.error("auth client not available", error);
      if (!cancelled) setReady(true);
    };
    getBackend().then((backend) => {
      if (cancelled) return;
      if (!backend) {
        // Only a `/config.json` can say "no backend" after the fact; a build
        // with its values baked in always has a client here.
        setConfigured(false);
        setReady(true);
        return;
      }
      setMethod(backend.auth.kind);
      const { auth } = backend;
      const askSignup = () => {
        if (auth.kind !== "password") return;
        auth.signupState().then(
          (state) => {
            if (!cancelled) setSignup(state);
          },
          // Not knowing is "closed": the form still signs in, it just does
          // not offer to make an account it cannot promise.
          () => {
            if (!cancelled) setSignup({ mode: "closed", firstAccount: false });
          },
        );
      };
      askSignup();
      backend.session().then((current) => {
        if (cancelled) return;
        setSession(current);
        setReady(true);
      }, noSession);
      unsubscribe = backend.onSessionChange((next) => {
        setSession(next);
        // The form comes back after a sign-out, and what the server allows
        // may have changed since it was last drawn: the first account made
        // since, or the only account just deleted.
        if (!next) askSignup();
      });
      if (cancelled) unsubscribe();
    }, noSession);
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, []);

  /** Mails a sign-in link (Supabase). */
  const signIn = useCallback(
    (email: string) =>
      // One mail at a time (bughunt 2026-10-15): a double tap sent two, and the
      // second link made the first one stop working, or tripped the rate limit
      // and drew "Too many tries" over a link that had gone out fine.
      guarded(async () => {
        const backend = await getBackend();
        if (!backend || backend.auth.kind !== "magic-link") return;
        setError(null);
        const { error: err } = await backend.auth.sendLink(email, window.location.origin);
        if (err) setError(message(err.message));
        else {
          setSentTo(email);
          setSent(true);
        }
      }),
    [guarded],
  );

  /**
   * Signs in with the code from the same email, instead of its link (audit
   * UX-11). An iPhone app added to the Home Screen keeps its storage apart
   * from Safari, and Mail opens the link in Safari — which signs in Safari,
   * not the app. Typing the code into the app itself signs in the app.
   * Success is heard through the session subscription, as the link's is.
   */
  const verifyCode = useCallback(
    (code: string) =>
      guarded(async () => {
        const backend = await getBackend();
        if (!backend || backend.auth.kind !== "magic-link" || !sentTo) return;
        setError(null);
        try {
          const { error: err } = await backend.auth.verifyCode(sentTo, code.replace(/\s+/g, ""));
          if (err) setError(codeWords(err.message));
        } catch (failure) {
          setError(codeWords(thrown(failure)));
        }
      }),
    [sentTo, guarded],
  );

  /**
   * Signs in with a password (a spår server). Success is heard through the
   * session subscription, exactly as a magic link's is; only a failure is said
   * here.
   */
  const signInWithPassword = useCallback(
    (email: string, password: string) =>
      guarded(async () => {
        const backend = await getBackend();
        if (!backend || backend.auth.kind !== "password") return;
        setError(null);
        try {
          const { error: err } = await backend.auth.signIn(email, password);
          if (err) setError(signInWords(err.message, true));
        } catch (failure) {
          setError(signInWords(thrown(failure), true));
        }
      }),
    [guarded],
  );

  /** Makes an account (a spår server that allows it), which also signs in. */
  const signUp = useCallback(
    (email: string, password: string, invite?: string) =>
      guarded(async () => {
        const backend = await getBackend();
        if (!backend || backend.auth.kind !== "password") return;
        setError(null);
        try {
          const { error: err } = await backend.auth.signUp({
            email,
            password,
            ...(invite ? { invite } : {}),
          });
          if (err) setError(signInWords(err.message, true));
        } catch (failure) {
          setError(signInWords(thrown(failure), true));
        }
      }),
    [guarded],
  );

  /**
   * Ends the session, and says whether it managed to.
   *
   * A sign-out that fails looks exactly like one that worked: the error was
   * thrown away here, nothing on screen moves until the auth subscription
   * fires, and the subscription does not fire because the session is still
   * there. supabase-js only clears the stored session once the server has
   * taken the logout — a network failure comes back as an error and leaves the
   * session in place — so a flaky link means the person is still signed in,
   * with the whole archive on screen, believing they are not. That is the one
   * moment it matters: this is reached from the menu's Account row, where
   * `beginHandoff` has just been called because the browser is about to be
   * handed to somebody else.
   *
   * The error is now surfaced the way the sign-in error is, through the same
   * `error` state and the same `message()`, and cleared first so a second
   * attempt that works leaves nothing stale behind for the sign-in screen to
   * show later. **That screen is the only place `error` is drawn, and it is
   * unreachable while a session is alive** — which is precisely the state a
   * failure leaves us in. So the outcome is also returned, for a caller that
   * can say something where the user is actually standing; `App.tsx` ignores
   * it today, and the console line is what stands in meanwhile.
   */
  const signOut = useCallback(async (): Promise<boolean> => {
    setError(null);
    setSent(false);
    const backend = await getBackend();
    // No backend is not a session ended — it is a session we cannot reach. It
    // takes no message: there is no session on this device to be standing in
    // front of, since the menu offers this row only when one exists.
    if (!backend) return false;
    let err: { message: string } | null;
    try {
      ({ error: err } = await backend.signOut());
    } catch (failure) {
      err = { message: thrown(failure) };
    }
    if (err) {
      console.error("sign-out failed", err);
      setError(message(err.message));
      return false;
    }
    return true;
  }, []);

  /**
   * Back from "Check your email" to the form. The sent screen used to be a
   * dead end: if the mail was slow, in spam, or sent somewhere subtly wrong,
   * the only visible way out was device-only mode — the invisible one was
   * reloading the page, which nobody should have to guess.
   */
  const resetSent = useCallback(() => {
    setSent(false);
    setError(null);
  }, []);

  return {
    session,
    ready,
    sent,
    error,
    busy,
    signIn,
    verifyCode,
    signOut,
    resetSent,
    syncConfigured: configured,
    method,
    signup,
    signInWithPassword,
    signUp,
  };
}
