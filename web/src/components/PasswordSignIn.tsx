import { useState } from "react";
import type { SignupState } from "../store/backend";

interface Props {
  /** What the server says about making accounts; null while it is asked. */
  signup: SignupState | null;
  error: string | null;
  /** A request is out (`useAuth`): the button says so and waits. */
  busy?: boolean;
  onSignIn: (email: string, password: string) => void;
  onSignUp: (email: string, password: string, invite?: string) => void;
  onSkip: () => void;
  /** Clears the old error when the form switches between signing in and making. */
  onSwitch?: () => void;
}

/**
 * Sign-in for a spår server: an address and a password, where Supabase mails a
 * link (`SignIn`). The same box, the same fields, the same way out — only what
 * the server needs to be told differs, so nothing here is drawn that `SignIn`
 * does not already draw.
 *
 * Making an account is offered only where the server says it may be made
 * (`SignupState`): the first account on a new server, anyone when sign-up is
 * open, and anyone holding an invite when it is invite-only. A closed server
 * says who makes accounts instead, so the reader is not left looking for a way
 * in that is not there.
 *
 * Reached only on a build that reads `/config.json`, through a lazy import, so
 * no other build carries it.
 */
export function PasswordSignIn({
  signup,
  error,
  busy = false,
  onSignIn,
  onSignUp,
  onSkip,
  onSwitch,
}: Props) {
  const first = signup?.firstAccount ?? false;
  const mode = signup?.mode ?? "closed";
  const canMake = first || mode === "open" || mode === "invite";
  const [making, setMaking] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [invite, setInvite] = useState("");

  // The first account is the only thing a new server can do, so it is the
  // form; everywhere else signing in is, and making an account is a step away.
  const newAccount = first || (making && canMake);
  const needsInvite = newAccount && !first && mode === "invite";

  const lead = first
    ? "No one has an account here yet. The first one made is the owner's."
    : newAccount
      ? "Make an account to keep your notes on every device."
      : "Sign in to keep your notes on every device.";

  return (
    <div className="signin">
      <div className="signin-box">
        <h1 className="wordmark signin-mark">spår</h1>
        <p className="signin-lead">{lead}</p>

        <form
          className="signin-form signin-stack"
          onSubmit={(e) => {
            e.preventDefault();
            const address = email.trim();
            if (!address || !password) return;
            if (newAccount) onSignUp(address, password, needsInvite ? invite.trim() : undefined);
            else onSignIn(address, password);
          }}
        >
          <input
            className="signin-input"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            aria-label="Email address"
            autoComplete="email"
            required
          />
          <input
            className="signin-input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            aria-label="Password"
            autoComplete={newAccount ? "new-password" : "current-password"}
            // The server's own floor for a new password (server-api.md), said
            // by the browser before the round trip rather than after it.
            minLength={newAccount ? 8 : undefined}
            required
          />
          {needsInvite && (
            <input
              className="signin-input"
              type="text"
              value={invite}
              onChange={(e) => setInvite(e.target.value)}
              placeholder="Invite code"
              aria-label="Invite code"
              autoComplete="off"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              required
            />
          )}
          <button type="submit" className="btn mono signin-go" disabled={busy}>
            {newAccount
              ? busy
                ? "Making account…"
                : "Make account"
              : busy
                ? "Signing in…"
                : "Sign in"}
          </button>
        </form>

        {!canMake && (
          <p className="signin-note">Accounts here are made by whoever runs this server.</p>
        )}

        {/* `role="alert"`, as on the link form: the one sentence that says why
            nothing happened must reach whoever cannot see it appear. */}
        {error && (
          <p className="signin-error" role="alert">
            {error}
          </p>
        )}

        <div className="signin-ways">
          {canMake && !first && (
            <button
              type="button"
              className="signin-skip mono"
              onClick={() => {
                setMaking(!making);
                onSwitch?.();
              }}
            >
              {making
                ? "Have an account? Sign in"
                : mode === "invite"
                  ? "Have an invite? Make an account"
                  : "No account? Make one"}
            </button>
          )}
          <button type="button" className="signin-skip mono" onClick={onSkip}>
            Use on this device only
          </button>
        </div>
      </div>
    </div>
  );
}
