import { useCallback, useState } from "react";

/**
 * useDialogs — the five questions the app stops to ask.
 *
 * Small, but it earns its own file for one reason: the *order* they dismiss
 * in is a rule, and a rule buried in the middle of a 2,000-line component is a
 * rule that gets broken by the next person who adds a dialog. The count is
 * `dialogOpen` below; the order is `dismissTopDialog`.
 *
 * The order is destructive first. The permanent-delete confirmation is drawn
 * above the informational notice, so if both are ever on screen at once, Back
 * has to take the one on top — otherwise the phone's back gesture answers a
 * question the user cannot currently see.
 *
 * What stays in `App.tsx` is every dialog's *consequence*. This file knows that
 * something is being asked; it does not know what happens when the answer is
 * yes, and it must not learn — that is how a confirmation stays a confirmation
 * rather than becoming a second place where notes get destroyed.
 */

export interface DestroyRequest {
  ids: string[];
  /** Named in the question, so it reads as a sentence: "…delete 3 notes?" */
  what: string;
}

export interface FileNotice {
  title: string;
  message: string;
}

export function useDialogs() {
  const [fileNotice, setFileNotice] = useState<FileNotice | null>(null);
  const [destroyRequest, setDestroyRequest] = useState<DestroyRequest | null>(null);
  /**
   * Which idea is being taken apart, while it asks.
   *
   * It asks even though it destroys nothing and is undoable, because it is the
   * one action here that touches every note in the idea at once — and because
   * it is reached from a right-click menu, where a slip lands on a neighbouring
   * row rather than on nothing.
   */
  const [dissolveRequest, setDissolveRequest] = useState<string | null>(null);

  /**
   * Which folder board is about to be deleted, while it asks — its id and
   * name, since deleting archives every note filed there and the question
   * has to name the board it's asking about. Reached by a long press or a
   * right-click on the tab (`BoardMenu`'s Delete row), the same "reached
   * from a place a slip lands on a neighbour, not on nothing" reasoning
   * `dissolveRequest` documents. Nothing is destroyed — the notes are
   * archived, not trashed — so this sits at the same tier as dissolve.
   */
  const [deleteBoardRequest, setDeleteBoardRequest] = useState<{ id: string; name: string } | null>(
    null,
  );

  /**
   * How many notes were never filed, while the app asks what to do about them —
   * the one question here that is not a confirmation of something the user just
   * asked for (SPEC §6). It is asked once, on the first open after the Inbox
   * arrived, and the answer is a stored date rather than anything happening to a
   * note.
   *
   * Dismissing it is deliberately *not* an answer: Back, Escape and the ✕ leave
   * it unanswered and it is asked again next time. The question is about a couple
   * of hundred notes, and the app would rather ask twice than decide for you.
   */
  const [backlogRequest, setBacklogRequest] = useState<number | null>(null);

  /**
   * Asked once a sign-out from the menu has gone through, on a device that
   * still holds notes (audit 2026-10-10, SEC-2): remove them from this device,
   * or keep them here. Walking away keeps them — nothing is removed unless the
   * button says so — which is the answer a session that lapses by itself gets
   * without being asked.
   */
  const [signOutQuestion, setSignOutQuestion] = useState(false);

  /** Whether anything is being asked. The board reads this to know a layer is
   *  open, which is what keeps Back and the keyboard grid standing down. */
  const dialogOpen = Boolean(
    fileNotice ||
      destroyRequest ||
      dissolveRequest ||
      deleteBoardRequest ||
      backlogRequest ||
      signOutQuestion,
  );

  /** Asks before the one path that actually destroys a note. */
  const askToDestroy = useCallback((ids: string[], what: string) => {
    if (ids.length === 0) return;
    setDestroyRequest({ ids: [...ids], what });
  }, []);

  /**
   * Closes the topmost dialog, if there is one, and says whether it did.
   *
   * Destructive first — see the note at the top of this file.
   */
  const dismissTopDialog = useCallback((): boolean => {
    if (destroyRequest) {
      setDestroyRequest(null);
      return true;
    }
    // Back answers "keep them here", which removes nothing.
    if (signOutQuestion) {
      setSignOutQuestion(false);
      return true;
    }
    if (dissolveRequest) {
      setDissolveRequest(null);
      return true;
    }
    if (deleteBoardRequest) {
      setDeleteBoardRequest(null);
      return true;
    }
    if (fileNotice) {
      setFileNotice(null);
      return true;
    }
    // Last, because it is the only one here that is not urgent: it is a question
    // about how the app should look, not about a note that is on its way out.
    if (backlogRequest) {
      setBacklogRequest(null);
      return true;
    }
    return false;
  }, [destroyRequest, signOutQuestion, dissolveRequest, deleteBoardRequest, fileNotice, backlogRequest]);

  return {
    fileNotice,
    destroyRequest,
    dissolveRequest,
    deleteBoardRequest,
    dialogOpen,
    showFileNotice: setFileNotice,
    closeFileNotice: useCallback(() => setFileNotice(null), []),
    askToDestroy,
    closeDestroy: useCallback(() => setDestroyRequest(null), []),
    askToDissolve: setDissolveRequest,
    closeDissolve: useCallback(() => setDissolveRequest(null), []),
    askToDeleteBoard: setDeleteBoardRequest,
    closeDeleteBoard: useCallback(() => setDeleteBoardRequest(null), []),
    backlogRequest,
    askAboutBacklog: setBacklogRequest,
    closeBacklog: useCallback(() => setBacklogRequest(null), []),
    signOutQuestion,
    askAboutSignOut: useCallback(() => setSignOutQuestion(true), []),
    closeSignOut: useCallback(() => setSignOutQuestion(false), []),
    dismissTopDialog,
  };
}
