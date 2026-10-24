// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { PileEdge, pileEdge } from "./PileEdge";
import { SorterTally, tallyLines } from "./SorterTally";

afterEach(cleanup);

describe("pileEdge", () => {
  it("shows three lines when three or more wait, then two, one, none", () => {
    expect([10, 4, 3, 2, 1, 0].map(pileEdge)).toEqual([3, 3, 3, 2, 1, 0]);
  });
  it("never goes below none", () => {
    expect(pileEdge(-1)).toBe(0);
  });
  it("draws that many hairlines, hidden from a reader", () => {
    const { container } = render(<PileEdge after={2} />);
    expect(container.querySelectorAll(".pile-edge-line")).toHaveLength(2);
    expect(container.querySelector(".pile-edge")?.getAttribute("aria-hidden")).toBe("true");
  });
});

describe("the end-of-run report", () => {
  it("keeps only the lines that happened", () => {
    expect(tallyLines([["Left", 2], ["Moved", 0], ["Archived", 1]])).toEqual([
      ["Left", 2],
      ["Archived", 1],
    ]);
  });
  it("draws only the lines that happened", () => {
    const { container } = render(
      <SorterTally lines={[["Left", 2], ["Moved", 3], ["Archived", 0]]} />,
    );
    expect(container.querySelectorAll(".sorter-end-line")).toHaveLength(2);
    expect(container.textContent).not.toMatch(/Archived|0/);
  });
  it("says something plain when nothing happened", () => {
    const { container } = render(<SorterTally lines={[["Left", 0], ["Moved", 0]]} />);
    expect(container.querySelector(".sorter-end-line")).toBeNull();
    expect(container.textContent).toBe("Nothing changed.");
  });
});
