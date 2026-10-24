// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Board } from "../types";

/**
 * The empty Inbox in the public demo's build: its one extra sentence and its
 * one extra offer (`SampleOffer.tsx`, reached from `EmptyBoard` under `DEMO`).
 *
 * `DEMO` is a build-time literal, so the only way to see the demo's screen in a
 * test is to say it is on — which is what the mock does. Every other test file
 * sees the owner's build, where the offer does not exist.
 */

const demo = vi.hoisted(() => ({ loadSamples: vi.fn(async () => 42) }));
vi.mock("../lib/demo", () => ({ DEMO: true, loadSamples: demo.loadSamples }));

import { EmptyBoard } from "../components/EmptyBoard";
import { MenuPanel } from "../components/MenuPanel";

afterEach(cleanup);

const inbox: Board = { id: "inbox", name: "Inbox", kind: "inbox" };
const todos: Board = { id: "todos", name: "Todos", kind: "todos" };

function empty({ freshArchive = true, board = inbox, searching = false } = {}) {
  return render(
    <EmptyBoard
      fetching={false}
      searching={searching}
      remindersOpen={false}
      headerMood="idle"
      board={board}
      freshArchive={freshArchive}
      oldNotesOut={0}
      onImportKeep={() => {}}
    />,
  );
}

describe("the demo's empty Inbox", () => {
  it("keeps one sentence, offers the sample notes above the Keep import, and says where the notes live under both", () => {
    empty();
    const state = document.querySelector(".empty")!;
    expect(screen.getByText(/A notes app where you just write/).textContent).toContain(
      "A notes app where you just write. Type in the bar below, and sort it into boards later.",
    );
    // Where the notes live: once, under the offers
    // (review GD-10) — not a second sentence in the italic line.
    expect(state.textContent).not.toContain("Your notes live in this browser only.");
    // A sentence of advice, not a machine string: the reading face, italic (review UI-18).
    const stamp = state.querySelector(".empty-stamp.advice");
    expect(stamp?.textContent).toBe("Your notes stay in this browser");
    expect(stamp?.classList.contains("mono")).toBe(false);
    const buttons = screen.getAllByRole("button").map((b) => b.textContent);
    expect(buttons.indexOf("Try it with sample notes")).toBeGreaterThanOrEqual(0);
    expect(buttons.indexOf("Try it with sample notes")).toBeLessThan(buttons.indexOf("Import from Google Keep"));
    const keep = screen.getByRole("button", { name: "Import from Google Keep" });
    expect(keep.compareDocumentPosition(stamp!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  /**
   * The first step and the second (2026-09-29): the sample notes are the one
   * a stranger should press first, so they are the offer one step up the
   * ramp; the import is the quieter of the two. Neither is in the machine's
   * uppercase face — they finish the sentence above them — and each wears the
   * mark from the icon set, hidden from a reader so the name is the words.
   */
  it("makes the sample notes the first step and the import the second", () => {
    empty();
    const samples = screen.getByRole("button", { name: "Try it with sample notes" });
    const keep = screen.getByRole("button", { name: "Import from Google Keep" });
    expect(samples.classList.contains("empty-offer-first")).toBe(true);
    expect(keep.classList.contains("empty-offer-first")).toBe(false);
    for (const offer of [samples, keep]) {
      expect(offer.classList.contains("empty-offer")).toBe(true);
      expect(offer.classList.contains("mono")).toBe(false);
      expect(offer.querySelector("svg.icon")?.getAttribute("aria-hidden")).toBe("true");
    }
  });

  it("loads the set on a press, once, however often it is pressed", async () => {
    demo.loadSamples.mockClear();
    let finish: (n: number) => void = () => {};
    demo.loadSamples.mockImplementationOnce(() => new Promise<number>((resolve) => (finish = resolve)));
    empty();
    const offer = screen.getByRole("button", { name: "Try it with sample notes" });
    fireEvent.click(offer);
    fireEvent.click(offer);
    expect(demo.loadSamples).toHaveBeenCalledTimes(1);
    expect((offer as HTMLButtonElement).disabled).toBe(true);
    // While it loads the button says so, in the same box (review UX-13).
    expect(offer.textContent).toBe("Adding the sample notes…");
    expect(offer.getAttribute("aria-busy")).toBe("true");
    await act(async () => finish(42));
  });

  it("is not offered once anything is written, on another board, or in a search", () => {
    empty({ freshArchive: false });
    expect(screen.queryByRole("button", { name: "Try it with sample notes" })).toBeNull();
    expect(screen.queryByText(/stay in this browser/)).toBeNull();
    cleanup();
    empty({ board: todos });
    expect(screen.queryByRole("button", { name: "Try it with sample notes" })).toBeNull();
    cleanup();
    empty({ searching: true });
    expect(screen.queryByRole("button", { name: "Try it with sample notes" })).toBeNull();
  });
});

/**
 * A visitor's first move is a "test" note. The empty Inbox's offer goes the
 * moment it is written, so the menu carries the same row until the samples are
 * in (review UX-A-03); App hands `onSampleNotes` only while none is.
 */
describe("the demo's menu", () => {
  function menu(onSampleNotes?: () => Promise<unknown>, onClose: () => void = () => {}) {
    const noop = () => {};
    return render(
      <MenuPanel
        trashCount={0}
        inTrash={false}
        modeEntry={null}
        onMode={noop}
        oldNotesOut={0}
        onBringOldNotesIn={noop}
        onSearch={noop}
        reminderCount={0}
        onReminders={noop}
        onTrash={noop}
        onEmptyTrash={noop}
        signedIn={false}
        syncConfigured={false}
        onAccount={noop}
        onAbout={noop}
        onImportKeep={noop}
        onSampleNotes={onSampleNotes}
        onClose={onClose}
      />,
    );
  }

  it("offers the sample notes until they are in", () => {
    const load = vi.fn(async () => 1);
    menu(load);
    fireEvent.click(screen.getByRole("menuitem", { name: "Try it with sample notes" }));
    expect(load).toHaveBeenCalledOnce();
    cleanup();
    menu(undefined);
    expect(screen.queryByRole("menuitem", { name: "Try it with sample notes" })).toBeNull();
  });

  it("says Adding the sample notes while they load, then closes (review UX-13)", async () => {
    let finish: () => void = () => {};
    const load = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    const onClose = vi.fn();
    menu(load, onClose);
    fireEvent.click(screen.getByRole("menuitem", { name: "Try it with sample notes" }));
    const row = screen.getByRole("menuitem", { name: "Adding the sample notes…" }) as HTMLButtonElement;
    expect(row.disabled).toBe(true);
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => finish());
    expect(onClose).toHaveBeenCalledOnce();
  });
});
