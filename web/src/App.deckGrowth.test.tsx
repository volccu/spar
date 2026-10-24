// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { putNotes, setMeta, writeCaptureDraft } from "./store/db";
import { INBOX_ALL } from "./lib/boards";
import { DECK_PAGE } from "./lib/useDeckGrowth";
import { note } from "./test/fixtures";

/*
 * A long board mounts a page of cards and grows as the end comes near (audit
 * PERF-3, PERF-6) — while everything that reads the board still reads all of
 * it. jsdom has no IntersectionObserver, so every other App test mounts whole;
 * here a stand-in is installed that the test fires by hand.
 */

const watching = new Set<{ fire: () => void }>();
class FakeObserver {
  private cb: IntersectionObserverCallback;
  constructor(cb: IntersectionObserverCallback) {
    this.cb = cb;
  }
  observe() {
    watching.add(this);
  }
  disconnect() {
    watching.delete(this);
  }
  fire() {
    this.cb([{ isIntersecting: true } as IntersectionObserverEntry], this as unknown as IntersectionObserver);
  }
}

const MANY = DECK_PAGE * 2 + 30;

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  watching.clear();
});

beforeEach(async () => {
  vi.stubGlobal("IntersectionObserver", FakeObserver);
  localStorage.setItem("spar.deviceOnly", "1");
  await setMeta("inboxSince", INBOX_ALL);
  await writeCaptureDraft("");
  const stamp = (i: number) => new Date(Date.UTC(2026, 0, 1) + i * 60_000).toISOString();
  await putNotes(
    Array.from({ length: MANY }, (_, i) =>
      note({
        id: `many-${i}`,
        body: `kettle ${i}`,
        raw_content: `kettle ${i}`,
        created_at: stamp(i),
        updated_at: stamp(i),
      }),
    ),
  );
});

const cards = () => document.querySelectorAll(".card[data-id]").length;
const inboxCount = () =>
  Number(
    within(document.querySelector<HTMLElement>("div.boards")!)
      .getByRole("tab", { name: /^inbox/i })
      .textContent?.match(/\d+/)?.[0] ?? "0",
  );

describe("a long board", () => {
  it("mounts a page, counts them all, and grows as the end comes near", async () => {
    render(<App />);
    await waitFor(() => expect(cards()).toBeGreaterThan(0));
    // The fill's first screenful may come first; then the page.
    await waitFor(() => expect(cards()).toBe(DECK_PAGE));
    expect(inboxCount()).toBeGreaterThanOrEqual(MANY);
    expect(document.querySelector(".deck-more")).not.toBeNull();

    act(() => [...watching].forEach((o) => o.fire()));
    await waitFor(() => expect(cards()).toBe(2 * DECK_PAGE));
  });

  it("mounts a page of search results, and says how many it found", async () => {
    render(<App />);
    await waitFor(() => expect(cards()).toBeGreaterThan(0));
    fireEvent.click(screen.getByRole("button", { name: "Menu" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /search/i }));
    fireEvent.change(await screen.findByLabelText("Search notes"), { target: { value: "kettle" } });
    await waitFor(() => expect(screen.getByText(new RegExp(`${MANY} found`, "i"))).toBeTruthy());
    await waitFor(() => expect(cards()).toBe(DECK_PAGE));
  });
});
