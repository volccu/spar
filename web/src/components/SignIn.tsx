import { useState } from "react";
import { hasKeyboard } from "../lib/hotkeys";

interface Props {
  sent: boolean;
  error: string | null;
  /** A request is out (`useAuth`): the button says so and waits. */
  busy?: boolean;
  onSignIn: (email: string) => void;
  onSkip: () => void;
  /** Back from "Check your email" to the form, address still in the field. */
  onBack: () => void;
  /**
   * The code from the same email, typed instead of following its link (audit
   * UX-11). Absent where the backend has no codes to check.
   */
  onCode?: (code: string) => void;
}

/**
 * Shown once per device. Skipping is a real option — the app is fully usable
 * without an account, it just keeps the notes on this device only, so the
 * trade-off is stated plainly rather than hidden behind a nag.
 */
export function SignIn({ sent, error, busy = false, onSignIn, onSkip, onBack, onCode }: Props) {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");

  return (
    <div className="signin">
      <div className="signin-box">
        <h1 className="wordmark signin-mark">spår</h1>

        {sent ? (
          <>
            <p className="signin-lead">
              Check your email.{email.trim() ? ` We sent a link to ${email.trim()}.` : ""}
            </p>
            {/* The link signs in whichever browser opens it, and an email app
                will happily hand it to the wrong one — say so here, at the
                one moment the warning can still help. */}
            <p className="signin-note">
              Open the link on this device, in this same browser. You only do
              this once per device.
            </p>
            {/* The link opens in whatever browser the mail app picks, and an
                iPhone app on the Home Screen is not that browser: its storage
                is its own. The email carries a code too, and a code typed
                here signs in this very app, wherever the link would have
                gone (audit UX-11). */}
            {onCode && (
              <form
                className="signin-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  const typed = code.replace(/\s+/g, "");
                  if (typed) onCode(typed);
                }}
              >
                <input
                  className="signin-input mono"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="Type the code instead"
                  aria-label="Type the code instead"
                  maxLength={12}
                  required
                  autoFocus={hasKeyboard(false)}
                />
                <button type="submit" className="btn mono signin-go" disabled={busy}>
                  {busy ? "Signing in…" : "Sign in"}
                </button>
              </form>
            )}
            {/* Back to the form with the address kept, not a resend: the
                words say what the button does. */}
            <button type="button" className="signin-skip mono" onClick={onBack}>
              No email? Try again
            </button>
          </>
        ) : (
          <>
            <p className="signin-lead">
              Sign in to keep your notes on every device.
            </p>
            <form
              className="signin-form"
              onSubmit={(e) => {
                e.preventDefault();
                if (email.trim()) onSignIn(email.trim());
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
                autoFocus={hasKeyboard(false)}
              />
              <button type="submit" className="btn mono signin-go" disabled={busy}>
                {busy ? "Sending…" : "Send link"}
              </button>
            </form>
            <p className="signin-note">
              No password. The email holds a link that signs you in.
            </p>
          </>
        )}

        {/* `role="alert"`, or the one sentence that says why nothing arrived
            reaches only the people who can see it appear. */}
        {error && (
          <p className="signin-error" role="alert">
            {error}
          </p>
        )}

        <button type="button" className="signin-skip mono" onClick={onSkip}>
          Use on this device only
        </button>
      </div>
    </div>
  );
}
