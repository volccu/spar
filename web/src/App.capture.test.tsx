// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { beforeEach, afterEach, describe, expect, it } from "vitest";
import App from "./App";
import { allNotes, setMeta, writeCaptureDraft } from "./store/db";
import { INBOX_ALL } from "./lib/boards";

/*
 * The capture bar's three marks, end to end — SPEC §2.1 and §12's last row.
 *
 * `CaptureBar.test.tsx` covers the bar on its own: what it shows, what it
 * forgets, and what it hands up. This is the other half, and the half that
 * would actually be noticed if it broke — the note that comes out the far
 * end. A mark that lights up and is then dropped between the bar and the
 * store looks completely correct right up until the card appears without it.
 *
 * A file of its own for the reason `App.dissolve.test.tsx` is: these make
 * folders, App.test.tsx shares one database across seventy tests, and one
 * extra board there pushes another test's board off the end of the Move
 * chooser's list eleven hundred lines away.
 */

afterEach(cleanup);

beforeEach(async () => {
  localStorage.setItem("spar.deviceOnly", "1");
  await setMeta("inboxSince", INBOX_ALL);
  await writeCaptureDraft("");
  // Every test below opens the app at an address, and one of them opens it at
  // the launcher's. Reset rather than trusted, or the shortcut leaks forward.
  window.history.replaceState({}, "", "/");
});

const cards = () => Array.from(document.querySelectorAll<HTMLElement>(".card"));

async function open() {
  render(<App />);
  await waitFor(() => expect(cards().length).toBeGreaterThan(0), { timeout: 10_000 });
}

async function goToBoard(name: RegExp) {
  fireEvent.click(await screen.findByRole("tab", { name }));
}

async function makeBoard(name: string) {
  fireEvent.click(screen.getByRole("button", { name: "New board" }));
  const field = screen.getByLabelText("New board name");
  fireEvent.change(field, { target: { value: name } });
  fireEvent.keyDown(field, { key: "Enter" });
  return await screen.findByRole("tab", { name: new RegExp(name, "i") });
}

/** Type it, mark it however, save it, and hand back the card that appeared. */
async function capture(words: string, mark?: string) {
  fireEvent.change(screen.getByLabelText("Write a note"), { target: { value: words } });
  if (mark) fireEvent.click(screen.getByRole("button", { name: mark }));
  fireEvent.click(screen.getByRole("button", { name: "Save note" }));
  return await screen.findByRole("button", { name: new RegExp(words, "i") });
}

describe("marking a note as it is written", () => {
  it("saves a priority without opening the note first", async () => {
    await open();
    // Four gestures before this: save it, find the card, open it, press the
    // flag. The whole point of the mark is that the writer already knew.
    const card = await capture("call the dentist", "Important");
    expect(card.getAttribute("data-priority")).toBe("1");
  });

  it("leaves an unmarked capture exactly as it was", async () => {
    await open();
    const card = await capture("nothing urgent about this");
    expect(card.getAttribute("data-priority")).toBe("0");
    expect(card.getAttribute("data-filed")).toBe("false");
  });

  /**
   * Marked a to-do in the bar, and gone from the Inbox on the same breath.
   *
   * Two rules meet here and it is worth pinning that they agree. A to-do does
   * not show in the Inbox — its place is the Todos board — and that rule was
   * written for notes marked *after* they were captured. A note marked in the
   * bar is a to-do from its first instant, so it never appears in the Inbox at
   * all rather than appearing and then leaving, which would be a card blinking
   * out of a list the writer is still looking at.
   */
  it("marks a to-do in the bar, and it goes straight to Todos, never the Inbox", async () => {
    await open();
    await goToBoard(/^inbox/i);

    fireEvent.change(screen.getByLabelText("Write a note"), {
      target: { value: "water the plants" },
    });
    fireEvent.click(screen.getByRole("button", { name: "To-do" }));
    fireEvent.click(screen.getByRole("button", { name: "Save note" }));

    await waitFor(() =>
      expect(screen.queryByRole("button", { name: /water the plants/i })).toBeNull(),
    );
    await goToBoard(/^todos/i);
    expect(await screen.findByRole("button", { name: /water the plants/i })).toBeTruthy();
  });

  it("files into a board chosen in the bar, from the Inbox", async () => {
    await open();
    fireEvent.click(await makeBoard("Chosen"));
    await goToBoard(/^inbox/i);

    // The board mark opens the same chooser Move uses, scoped to the note
    // being written. Picking a board here is the whole of item 6's third
    // part: no save, no find, no open, no Move.
    fireEvent.change(screen.getByLabelText("Write a note"), {
      target: { value: "belongs in chosen" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Board" }));
    fireEvent.click(await screen.findByRole("button", { name: /^Chosen/ }));
    fireEvent.click(screen.getByRole("button", { name: "Save note" }));

    // Filed, so it has left the Inbox — that is what makes the Inbox a pile
    // with an end to it — and it is standing in the folder instead.
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: /belongs in chosen/i })).toBeNull(),
    );
    await goToBoard(/Chosen/i);
    expect(await screen.findByRole("button", { name: /belongs in chosen/i })).toBeTruthy();
  });

  /**
   * The one case the Inbox row exists for.
   *
   * A note written while standing in a folder is filed into it — that rule is
   * older than the marks and stays. So without a way to say "no, the Inbox",
   * standing in a folder would be the one place a stray thought could not be
   * written down, and the writer would have to leave the board first. The
   * chooser offers that row only here, where it changes something.
   */
  it("keeps a note out of the folder it was written in when the Inbox is chosen", async () => {
    await open();
    fireEvent.click(await makeBoard("Standing"));
    await waitFor(() => expect(cards()).toHaveLength(0));

    fireEvent.change(screen.getByLabelText("Write a note"), {
      target: { value: "a stray thought" },
    });
    // Standing in the folder, the mark already names it as where the note
    // is going — a default shown, not a choice made.
    fireEvent.click(screen.getByRole("button", { name: "Board: Standing" }));
    fireEvent.click(await screen.findByRole("button", { name: /^Inbox/ }));
    fireEvent.click(screen.getByRole("button", { name: "Save note" }));

    // It did not land here, which is the whole claim — the folder stays empty.
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: /a stray thought/i })).toBeNull(),
    );
    expect(cards()).toHaveLength(0);

    await goToBoard(/^inbox/i);
    expect(await screen.findByRole("button", { name: /a stray thought/i })).toBeTruthy();
  });
});

/**
 * The launcher shortcut — "capture without opening the app first".
 *
 * Android's long-press on the home-screen icon and the Windows taskbar's
 * jump list both read the same `shortcuts` entry in the manifest, and both
 * land on `/?do=capture`. Everything else the shortcut could want is already
 * true — the app opens on the Inbox and the bar is anchored to the bottom of
 * it — so what is tested here is the whole of the feature: whether the caret
 * is in the field when the app arrives.
 */
describe("opened from the launcher's New note", () => {
  it("puts the caret in the write field", async () => {
    window.history.replaceState({}, "", "/?do=capture");
    await open();
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByLabelText("Write a note")),
    );
  });

  it("takes the shortcut back out of the address bar", async () => {
    window.history.replaceState({}, "", "/?do=capture");
    await open();
    // A signal from one launch, never a place to come back to: a reload of
    // this URL weeks later is an ordinary open.
    await waitFor(() => expect(window.location.search).toBe(""));
  });

  /**
   * The launcher is the one thing that can focus this field before the words
   * it is about to hold have arrived — a hand can only touch a field already
   * drawn, and the draft is a read of IndexedDB a commit or two behind. The
   * caret still has to end up *after* the unfinished sentence, or the first
   * word typed goes in front of it.
   *
   * It does, and nothing in this app arranges it: setting a textarea's value
   * is specified to move the cursor to the end, so the restore carries the
   * caret along with it. Written here as the promise rather than the
   * mechanism — the day the draft comes back some other way, this is what
   * says whether it still holds.
   */
  it("lands after an unfinished draft, never in front of it", async () => {
    await writeCaptureDraft("half a thought");
    window.history.replaceState({}, "", "/?do=capture");
    await open();

    const field = screen.getByLabelText("Write a note") as HTMLTextAreaElement;
    await waitFor(() => expect(field.value).toBe("half a thought"));
    await waitFor(() => expect(field.selectionStart).toBe("half a thought".length));
  });

  // Review 2026-10-04, FX-A-03: the desktop bookmark. Words fill the field,
  // never save, and the caret waits on a blank first line above them.
  it("fills the write field from ?text= and never saves it", async () => {
    const words = "A page\nhttps://example.com/zzzmark";
    window.history.replaceState({}, "", `/?do=capture&text=${encodeURIComponent(words)}`);
    await open();
    const field = screen.getByLabelText("Write a note") as HTMLTextAreaElement;
    await waitFor(() => expect(field.value).toBe(`\n${words}`));
    expect(document.activeElement).toBe(field);
    expect(field.selectionStart).toBe(0);
    expect(window.location.search).toBe("");
    expect((await allNotes()).some((n) => /zzzmark/.test(n.body))).toBe(false);
  });

  it("leaves the field alone on an ordinary open", async () => {
    await open();
    expect(document.activeElement).not.toBe(screen.getByLabelText("Write a note"));
  });
});
