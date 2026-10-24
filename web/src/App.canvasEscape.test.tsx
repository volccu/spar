// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { beforeEach, afterEach, describe, expect, it } from "vitest";
import App from "./App";
import { putNotes, setMeta, writeCaptureDraft } from "./store/db";
import { INBOX_ALL } from "./lib/boards";
import { note } from "./test/fixtures";

/*
 * A file of its own for the reason App.dissolve.test.tsx gives: an idea and
 * its archived sources in the store, which other tests must not inherit.
 *
 * The idea is put in the store rather than merged on screen (audit
 * 2026-10-10, CODE-5): merging is `App.test.tsx`'s subject, and driving it
 * here was a second of every test spent on something else.
 */

const IDEA = "zzzcanvas-idea";
const now = new Date().toISOString();
/** A note the idea was merged from: archived into it, as a merge leaves it. */
const source = (id: string, words: string) =>
  note({ id, body: words, raw_content: words, status: "archived", merged_into: IDEA, updated_at: now });

afterEach(cleanup);

beforeEach(async () => {
  localStorage.setItem("spar.deviceOnly", "1");
  await setMeta("inboxSince", INBOX_ALL);
  await writeCaptureDraft("");
  await putNotes([
    source("zzzcanvas-a", "zzzcanvas one"),
    source("zzzcanvas-b", "zzzcanvas two"),
    note({
      id: IDEA,
      source: "merge",
      body: "zzzcanvas one\n\nzzzcanvas two",
      raw_content: "zzzcanvas one\n\nzzzcanvas two",
      merged_from: ["zzzcanvas-a", "zzzcanvas-b"],
      created_at: now,
      updated_at: now,
    }),
  ]);
});

// Review 2026-10-04, UX-A-05: Escape closes the idea canvas like the open
// note, and focus goes back to the idea's card.
describe("closing an idea canvas with Escape", () => {
  async function openIdea() {
    render(<App />);
    const card = () => document.querySelector<HTMLElement>(`.card[data-id="${IDEA}"]`);
    await waitFor(() => expect(card()).toBeTruthy(), { timeout: 10_000 });
    fireEvent.click(card()!);
    await waitFor(() => expect(screen.getByRole("dialog", { name: "Idea canvas" })).toBeTruthy(), {
      // The canvas is a lazy chunk; a loaded machine takes longer than a second.
      timeout: 10_000,
    });
  }

  it("closes with focus on the page body, and puts focus on the idea's card", async () => {
    await openIdea();
    (document.activeElement as HTMLElement | null)?.blur();
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Idea canvas" })).toBeNull(), {
      timeout: 5000,
    });
    await waitFor(
      () => {
        const active = document.activeElement as HTMLElement;
        expect(active.classList.contains("card")).toBe(true);
      },
      { timeout: 5000 },
    );
  });

  it("leaves a label being edited to end its own edit", async () => {
    await openIdea();
    const name = screen.getByRole("button", { name: /name this idea/i });
    fireEvent.click(name);
    const field = await screen.findByLabelText("Idea name");
    fireEvent.keyDown(field, { key: "Escape" });
    expect(screen.getByRole("dialog", { name: "Idea canvas" })).toBeTruthy();
  });
});
