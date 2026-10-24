// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { act, cleanup, fireEvent, render, screen, waitFor, configure } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { allNotes, setMeta, writeCaptureDraft } from "./store/db";
import { INBOX_ALL } from "./lib/boards";
import { LONG_PRESS_MS } from "./components/NoteCard";

/*
 * Every find and wait in this file gets ten seconds, and a test forty, because
 * this file was seen failing only inside the whole suite, where the machine is
 * busy and a find that takes 100 ms alone takes seconds. A longer wait costs
 * nothing when the thing arrives, and a failing test still fails — later.
 */
configure({ asyncUtilTimeout: 10_000 });
vi.setConfig({ testTimeout: 40_000 });

/*
 * The merge drag, end to end — SPEC §6: a card long-press is multi-select, and
 * carrying that hold on to another card merges the pair.
 *
 * `NoteCard.test.tsx` covers the card's half: the hold, the move and the
 * release reach its three callbacks, and a cancel never reaches the commit.
 * This is the board's half, which is where the merge actually happens — which
 * card is under the finger, which notes are carried, and what comes out the
 * far end when the finger lifts.
 *
 * A file of its own for the reason `App.capture.test.tsx` gives: a merge
 * archives two notes and adds an idea, and `App.test.tsx` shares one database
 * across every test it holds.
 */

afterEach(cleanup);

beforeEach(async () => {
  localStorage.setItem("spar.deviceOnly", "1");
  await setMeta("inboxSince", INBOX_ALL);
  await writeCaptureDraft("");
});

async function capture(words: string) {
  fireEvent.change(screen.getByLabelText("Write a note"), { target: { value: words } });
  fireEvent.click(screen.getByRole("button", { name: "Save note" }));
  return await screen.findByRole("button", { name: new RegExp(words, "i") });
}

describe("carrying a held card on to another", () => {
  it("merges the pair into a new idea and archives both into it", async () => {
    render(<App />);
    await waitFor(() => expect(document.querySelectorAll(".card").length).toBeGreaterThan(0), {
      timeout: 10_000,
    });
    const source = await capture("zzzdragsource");
    const target = await capture("zzzdragtarget");

    // Held: the long press picks the card out, and the hold is still down.
    fireEvent.pointerDown(source, { pointerId: 1, pointerType: "touch" });
    await act(() => new Promise((resolve) => setTimeout(resolve, LONG_PRESS_MS + 100)));
    await waitFor(() => expect(screen.getByText(/1 selected/)).toBeTruthy());

    // jsdom has no layout, so "what is under the finger" is answered here.
    const elementFromPoint = document.elementFromPoint;
    document.elementFromPoint = () => target;
    try {
      fireEvent.pointerMove(source, { pointerId: 1, pointerType: "touch", clientX: 10, clientY: 10 });
      await waitFor(() => expect(target.getAttribute("data-merge-target")).toBe("true"));
      expect(source.getAttribute("data-merge-dragging")).toBe("true");
      fireEvent.pointerUp(source, { pointerId: 1, pointerType: "touch" });
    } finally {
      document.elementFromPoint = elementFromPoint;
    }

    // A merge lands you in the idea it made.
    await waitFor(() => expect(screen.getByRole("dialog", { name: "Idea canvas" })).toBeTruthy(), {
      timeout: 10_000,
    });
    await waitFor(async () => {
      const notes = await allNotes();
      const from = notes.find((n) => /^zzzdragsource$/i.test(n.body))!;
      const onto = notes.find((n) => /^zzzdragtarget$/i.test(n.body))!;
      const idea = notes.find((n) => n.merged_from?.includes(from.id));
      expect(idea?.merged_from).toEqual([from.id, onto.id]);
      expect(from.status).toBe("archived");
      expect(onto.status).toBe("archived");
      expect(from.merged_into).toBe(idea!.id);
      expect(onto.merged_into).toBe(idea!.id);
    });
  });
});
