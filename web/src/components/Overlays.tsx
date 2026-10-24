import { Dialog } from "./Dialog";
import type { DestroyRequest, FileNotice } from "../store/useDialogs";

/**
 * The four questions the app stops to ask, drawn in one place.
 *
 * Presentational only, and deliberately so. `useDialogs` knows that something
 * is being asked; this knows what the question looks like; `App.tsx` keeps
 * every answer's consequence. That third part is the one worth protecting —
 * the comment at the top of `useDialogs.ts` explains why a confirmation must
 * not learn what happens when the answer is yes, and the same reasoning
 * applies here. Each `onConfirm` below is handed in already bound, so this file
 * cannot destroy a note, dissolve an idea or delete a board even by accident.
 *
 * They are grouped rather than left inline because they are four instances of
 * one shape — a nullable request, a confirm, a cancel — and reading them side
 * by side is how you notice that one of them is missing a cancel label or has
 * its destructive flag off.
 *
 * Order matters and is not alphabetical: it matches the dismissal order in
 * `useDialogs.dismissTopDialog`, so the dialog drawn last is the one Back
 * answers first.
 */
interface Props {
  fileNotice: FileNotice | null;
  onCloseFileNotice: () => void;

  /** The id of the idea being taken apart, or null. */
  dissolveRequest: string | null;
  onConfirmDissolve: () => void;
  onCancelDissolve: () => void;

  deleteBoardRequest: { id: string; name: string } | null;
  onConfirmDeleteBoard: () => void;
  onCancelDeleteBoard: () => void;

  destroyRequest: DestroyRequest | null;
  /** Whether this device sends its notes to a server. Only then does a
   *  delete-for-good reach anywhere but here (review CD-03). */
  synced: boolean;
  onConfirmDestroy: () => void;
  onCancelDestroy: () => void;

  /** How many notes were never filed, while the app asks about them. */
  backlogRequest: number | null;
  onSortBacklog: () => void;
  onLeaveBacklog: () => void;
  onDismissBacklog: () => void;

  /** Asked after a sign-out from the menu (audit SEC-2), or false. */
  signOutQuestion: boolean;
  /** How many changes on this device have not reached the account. */
  unsentHere: number;
  onRemoveFromDevice: () => void;
  onKeepOnDevice: () => void;
}

export function Overlays({
  fileNotice,
  onCloseFileNotice,
  dissolveRequest,
  onConfirmDissolve,
  onCancelDissolve,
  deleteBoardRequest,
  onConfirmDeleteBoard,
  onCancelDeleteBoard,
  destroyRequest,
  synced,
  onConfirmDestroy,
  onCancelDestroy,
  backlogRequest,
  onSortBacklog,
  onLeaveBacklog,
  onDismissBacklog,
  signOutQuestion,
  unsentHere,
  onRemoveFromDevice,
  onKeepOnDevice,
}: Props) {
  return (
    <>
      {fileNotice && (
        <Dialog
          title={fileNotice.title}
          message={fileNotice.message}
          confirmLabel="Close"
          cancelLabel=""
          onConfirm={onCloseFileNotice}
          onCancel={onCloseFileNotice}
        />
      )}

      {dissolveRequest && (
        <Dialog
          title="Dissolve this idea?"
          message={
            `Every note in it goes back to the board, and the idea itself goes ` +
            `to the trash with its canvas intact. You can undo this.`
          }
          confirmLabel="Dissolve"
          onConfirm={onConfirmDissolve}
          onCancel={onCancelDissolve}
        />
      )}

      {deleteBoardRequest && (
        <Dialog
          title={`Delete “${deleteBoardRequest.name}”?`}
          message="Every note filed here goes to the archive — nothing is destroyed. The board itself is gone. You can undo this."
          confirmLabel="Delete"
          // The focus lands on Cancel: a stray Enter must not take a whole
          // folder's filing with it. Cancel, not "Keep it" — Keep is the name
          // of the app this replaces (review 2026-10-04, CD-07).
          destructive
          onConfirm={onConfirmDeleteBoard}
          onCancel={onCancelDeleteBoard}
        />
      )}

      {/* The one question that is not a confirmation: nothing has happened, and
          neither answer moves, archives or deletes a single note — both decide
          only what the Inbox shows. So it has three ways out rather than two.
          The ✕ and Escape (`onDismissBacklog`) settle nothing and it asks again
          next open; the two buttons are the answers, and either can be changed
          afterwards from the menu. */}
      {backlogRequest !== null && (
        <Dialog
          title={`${backlogRequest} notes have never been filed`}
          // One sentence and one line of consequence. The six-line version
          // explained a policy at length to somebody who had not used the app
          // yet, and told them twice that neither answer moved anything, which
          // only invited "then why am I being asked?" (2026-09-04 audit, F10).
          message={
            `Tidy up one at a time, or leave them where they are and start ` +
            `the Inbox empty today. You can change this from the menu.`
          }
          confirmLabel="Tidy up"
          cancelLabel="Leave them"
          onConfirm={onSortBacklog}
          onCancel={onLeaveBacklog}
          onDismiss={onDismissBacklog}
        />
      )}

      {/* After a deliberate sign-out from the menu (audit 2026-10-10, SEC-2):
          a borrowed computer should be able to let the notes go. Walking away
          is Keep, and Keep is today's board with the sign-in line. The focus
          lands on Keep, as on every question with a destructive answer. */}
      {signOutQuestion && (
        <Dialog
          title="Remove notes from this device, or keep them here?"
          message={
            unsentHere > 0
              ? `You are signed out. ${unsentHere} ${unsentHere === 1 ? "change has" : "changes have"} not reached your account yet, and removing loses ${unsentHere === 1 ? "it" : "them"}.`
              : "You are signed out. Your notes stay in your account either way."
          }
          confirmLabel="Remove"
          cancelLabel="Keep them here"
          destructive
          onConfirm={onRemoveFromDevice}
          onCancel={onKeepOnDevice}
        />
      )}

      {destroyRequest && (
        <Dialog
          title="Delete for good?"
          message={`This deletes ${destroyRequest.what} for good${synced ? ", here and on the server" : ""}. It cannot be undone.`}
          confirmLabel="Delete for good"
          destructive
          onConfirm={onConfirmDestroy}
          onCancel={onCancelDestroy}
        />
      )}
    </>
  );
}
