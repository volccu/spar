// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Speech, bubblePath } from "./Speech";

afterEach(cleanup);

describe("the creature's speech bubble", () => {
  it("says its words, with the one verb as a real button named in full", () => {
    const run = vi.fn();
    const { container } = render(
      <Speech said={{ key: "a", words: "Deleted 1 note", act: { verb: "Undo", label: "Undo: Deleted 1 note", run }, clockMs: 8000 }} />,
    );
    expect(container.querySelector(".speech-words")?.textContent).toBe("Deleted 1 note");
    const button = container.querySelector<HTMLButtonElement>("button.speech-act")!;
    expect(button.textContent).toBe("Undo");
    expect(button.getAttribute("aria-label")).toBe("Undo: Deleted 1 note");
    fireEvent.click(button);
    expect(run).toHaveBeenCalledTimes(1);
    // The countdown runs for the window it is handed, and it is not a live
    // region: the header's permanent regions are the voice.
    expect(container.querySelector<HTMLElement>(".speech")?.style.getPropertyValue("--undo-ms")).toBe("8000ms");
    expect(container.querySelector(".speech-clock")).not.toBeNull();
    expect(container.querySelector('[role="status"]')).toBeNull();
  });

  it("draws no button and no clock for a plain sentence", () => {
    const { container } = render(<Speech said={{ key: "b", words: "Beep. All synced · just now" }} />);
    expect(container.querySelector("button")).toBeNull();
    expect(container.querySelector(".speech-clock")).toBeNull();
  });

  it("draws its bubble and tail as one outline, with the drawing's curves", () => {
    const { container } = render(<Speech said={{ key: "c", words: "Copied 3 notes" }} />);
    // One path, not a body and a tail stuck together.
    expect(container.querySelectorAll(".speech-shape path")).toHaveLength(1);
    expect(container.querySelector(".speech-shape")?.getAttribute("aria-hidden")).toBe("true");
    expect(container.querySelector("filter#speech-boil")).not.toBeNull();
  });

  it("draws the countdown on the outline itself", () => {
    const { container } = render(<Speech said={{ key: "e", words: "Archived 1 note", clockMs: 8000 }} />);
    const [edge, clock] = container.querySelectorAll(".speech-shape path");
    expect(clock.getAttribute("class")).toBe("speech-clock");
    expect(clock.getAttribute("d")).toBe(edge.getAttribute("d"));
    expect(clock.getAttribute("pathLength")).toBe("1");
  });

  it("points its tail at the creature, and has none where nothing stands beside it", () => {
    const tip = (d: string) => /L1\.5,25/.test(d);
    expect(tip(bubblePath(200, 50, true))).toBe(true);
    expect(tip(bubblePath(200, 50, false))).toBe(false);
    // Starts at the top-left corner and closes.
    expect(bubblePath(200, 50, true)).toMatch(/^M21\.5,1\.5 .* Z$/);
  });

  it("goes when there is nothing left to say", () => {
    const { container, rerender } = render(<Speech said={{ key: "d", words: "Tucked into Inbox" }} />);
    rerender(<Speech said={null} />);
    // jsdom cannot animate, so the going is immediate.
    expect(container.querySelector(".speech")).toBeNull();
  });

  it("sets a weather line's facts in bold, and the words read the same", () => {
    const { container } = render(
      <Speech said={{ key: "w", words: "Beep. 12° and mostly clear out.", strong: ["12°", "mostly clear"] }} />,
    );
    const bold = [...container.querySelectorAll(".speech-words b")].map((b) => b.textContent);
    expect(bold).toEqual(["12°", "mostly clear"]);
    expect(container.querySelector(".speech-words")?.textContent).toBe("Beep. 12° and mostly clear out.");
  });

  it("draws a busy line's ellipsis as three counting dots", () => {
    const { container } = render(<Speech said={{ key: "h", words: "Hm…", busy: true }} />);
    expect(container.querySelectorAll(".speech-dots > span")).toHaveLength(3);
    expect(container.querySelector(".speech-dots")?.getAttribute("aria-label")).toBe("…");
  });
});
