import { useState } from "react";
import type { Canvas, Note, UserBoard } from "../types";
import { saveBlob } from "../lib/saveFile";
import { Dialog } from "./Dialog";

/* --- a device that still holds somebody's unsent work ---------------------------
   A different account signed in on a device whose store still holds the previous
   account's work that never reached the server — edits in the outbox, files never
   uploaded, deletes never sent. Emptying the store for the new account (which is
   what a switch does, `claimForOwner`) would destroy the only copies, and it used
   to do exactly that with nothing on screen.

   So the switch stops here and asks. Three ways out, in the order they are safe:
   take a copy of everything, sign out so the account the work belongs to can sign
   back in and send it, or clear the device anyway — which asks once more, because
   it is the one answer that cannot be taken back. Sync stays off throughout: the
   store is not claimed until one of them is chosen.

   It borrows the sign-in box, as `Stopped` does.
   -------------------------------------------------------------------------- */

interface Props {
  count: number;
  notes: Note[];
  folders: UserBoard[];
  canvases: Canvas[];
  onSignOut: () => void;
  onClear: () => void;
}

type Taking = "idle" | "working" | "done" | "failed";

export function HeldWork({ count, notes, folders, canvases, onSignOut, onClear }: Props) {
  const [taking, setTaking] = useState<Taking>("idle");
  const [asking, setAsking] = useState(false);
  const things = count === 1 ? "1 change" : `${count} changes`;

  async function takeCopy() {
    if (taking === "working") return;
    setTaking("working");
    try {
      // The same zip the About page writes, loaded only when it is asked for.
      const [{ planArchive, writeArchive }, { exportBytes }] = await Promise.all([
        import("../lib/exportArchive"),
        import("../store/attachments"),
      ]);
      const result = await writeArchive(planArchive({ notes, folders, canvases }), exportBytes);
      saveBlob(result.blob, result.fileName);
      setTaking("done");
    } catch {
      setTaking("failed");
    }
  }

  return (
    <div className="signin">
      <div className="signin-box">
        <h1 className="wordmark signin-mark">spår</h1>
        <p className="signin-error stopped-error" role="alert">
          This device still holds {things} from the account that used it before, and they
          never reached the server. Signing in here would clear them for good.
        </p>
        <div className="held-actions">
          <button
            type="button"
            className="btn mono stopped-reload"
            onClick={() => void takeCopy()}
            disabled={taking === "working"}
          >
            {taking === "working" ? "Packing" : "Download everything first"}
          </button>
          <button type="button" className="btn mono stopped-reload" onClick={onSignOut}>
            Sign out, to sign in as that account
          </button>
          <button type="button" className="signin-skip" onClick={() => setAsking(true)}>
            Clear this device anyway
          </button>
        </div>
        <p className="signin-note" role="status">
          {taking === "done"
            ? "Saved. Everything on this device is in that zip."
            : taking === "failed"
              ? "The download could not be made. Nothing changed. Try again."
              : ""}
        </p>
      </div>
      {asking && (
        <Dialog
          title="Clear this device?"
          message={`The ${things} that never reached the server are deleted for good. Everything that did reach it is safe there.`}
          confirmLabel="Clear"
          destructive
          onConfirm={() => {
            setAsking(false);
            onClear();
          }}
          onCancel={() => setAsking(false)}
        />
      )}
    </div>
  );
}
