// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SHORTCUTS } from "../lib/shortcuts";

import { About } from "./About";

const nativeScroll = Element.prototype.scrollIntoView;
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  Element.prototype.scrollIntoView = nativeScroll;
});

function page(at?: "top" | "keys") {
  return render(
    <About
      synced={false}
      onClose={() => {}}
      restoreTo={createRef<HTMLButtonElement>()}
      at={at}
    />,
  );
}

/** A machine that answers the one keyboard query yes (`hasKeyboard`). */
function withKeyboard() {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query === "(hover: hover) and (pointer: fine)",
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

describe("the About page's opening", () => {
  /** A trash with no server behind it empties nowhere but here (review CD-03). */
  it("mentions the server only on a device that syncs", () => {
    const { container } = page();
    expect(container.textContent).toMatch(/Then it is gone for good\. Archive/);
    expect(container.textContent).not.toMatch(/on the server/);
  });

  it("speaks to whoever is reading it, and keeps the demo's section out of every other build", () => {
    const { container } = page();
    const opening = container.querySelector(".about-body p")?.textContent ?? "";
    // Says what the app is, plainly, before what its name means (review WD-05).
    expect(opening).toMatch(/^Spår is a notes app\. You write first and sort later/);
    expect(opening).not.toMatch(/ — /);
    expect(opening).not.toMatch(/one person's notes/);
    expect(screen.queryByRole("heading", { name: "Keep using spår" })).toBeNull();
  });

  it("says plainly that sharing into spår on Android needs the app from Chrome (review PS-01)", () => {
    page();
    const heading = screen.getByRole("heading", { name: "On Android" });
    expect(heading.nextElementSibling?.textContent).toMatch(/^Install spår from Chrome\. Only then can you share/);
  });

  it("heads the page with the masthead: the creature, then the wordmark", () => {
    const { container } = page();
    const head = container.querySelector(".about-head")!;
    const mascot = head.querySelector("spar-mascot");
    expect(mascot).not.toBeNull();
    expect(mascot?.hasAttribute("home")).toBe(false); // a visitor; the header's is home
    expect(mascot?.nextElementSibling?.className).toBe("about-mark");
  });
});

// The Inbox-count switch moved to Settings (2026-10-11): Settings.test.tsx.
describe("what moved to Settings", () => {
  it("holds no switch, no export and no account any more", () => {
    page();
    expect(screen.queryByRole("switch")).toBeNull();
    expect(screen.queryByRole("button", { name: /Download everything/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Delete the account/ })).toBeNull();
    expect(screen.getByText(/Download everything, in Settings/)).toBeTruthy();
  });
});

describe("the keys, on the About page", () => {
  it("lists every shortcut in the one list, each key in its box and in words", () => {
    withKeyboard();
    const { container } = page();
    expect(screen.getByRole("heading", { name: "The keys" })).toBeTruthy();
    const rows = container.querySelectorAll(".about-keys .about-data > div");
    const lines = SHORTCUTS.flatMap((group) => group.shortcuts);
    expect(rows).toHaveLength(lines.length);
    const chords = lines.flatMap((line) => line.keys).length;
    expect(container.querySelectorAll(".about-keys .kbd")).toHaveLength(chords);
    // The drawn box is furniture to a reader; the words beside it are what is said.
    const search = screen.getAllByText("Search").find((el) => el.tagName === "DT");
    expect(search?.parentElement?.textContent).toContain("Ctrl+K");
  });

  it("is not drawn on a device with no keyboard to press them on", () => {
    // jsdom answers no media query at all, which reads as no keyboard.
    page();
    expect(screen.queryByRole("heading", { name: "The keys" })).toBeNull();
  });

  it("draws the touches instead on a device with no keyboard (review PL-03)", () => {
    page();
    const heading = screen.getByRole("heading", { name: "The touches" });
    const rows = heading.parentElement?.querySelectorAll(".about-touches dt") ?? [];
    expect([...rows].map((row) => row.textContent)).toEqual([
      "Hold a note",
      "Hold a note and carry it onto another",
      "Hold a note and carry it to a board name",
      "Swipe sideways",
      "Swipe right on the Inbox",
    ]);
  });

  it("leaves the touches out where there is a keyboard", () => {
    withKeyboard();
    page();
    expect(screen.queryByRole("heading", { name: "The touches" })).toBeNull();
  });

  it("opens at the list when asked, and `?` on the page goes back to it", () => {
    const scrolled = vi.fn();
    Element.prototype.scrollIntoView = scrolled;
    page("keys");
    const heading = screen.getByRole("heading", { name: "The keys" });
    expect(scrolled).toHaveBeenCalledTimes(1);
    expect(scrolled.mock.contexts[0]).toBe(heading);
    fireEvent.keyDown(screen.getByRole("dialog", { name: "About spår" }), { key: "?" });
    expect(scrolled).toHaveBeenCalledTimes(2);
  });
});
