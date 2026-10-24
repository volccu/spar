// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Pen, PEN_STYLE } from "./Pen";
import { STRIKE_MS } from "../../lib/motion";
import { readStyles } from "../../test/readStyles.node";

afterEach(cleanup);

describe("the pen", () => {
  it("wraps the words without changing them, and brings its time from motion.ts", () => {
    const { container } = render(
      <p>
        <Pen>milk</Pen>
      </p>,
    );
    const pen = container.querySelector(".pen") as HTMLElement;
    expect(pen.textContent).toBe("milk");
    expect(pen.style.getPropertyValue("--strike-ms")).toBe(`${STRIKE_MS}ms`);
    expect(String(PEN_STYLE["--strike-ms" as keyof typeof PEN_STYLE])).toBe(`${STRIKE_MS}ms`);
  });

  it("keeps a class of the caller's own beside it", () => {
    const { container } = render(<Pen className="item-words">x</Pen>);
    expect(container.querySelector(".pen.item-words")).not.toBeNull();
  });
});

describe("the pen in the stylesheet", () => {
  const css = readStyles();

  it("draws the strike as a 1px line, never a text decoration, on all four surfaces", () => {
    expect(css).not.toMatch(/text-decoration:\s*line-through/);
    const rule = css.match(/\.pen\s*\{([^}]*)\}/)![1];
    expect(rule).toContain("background-size: 0% 1px");
    expect(rule).toContain("box-decoration-break: clone");
    expect(rule).toContain("var(--strike-ms) var(--ease-enter)");
    const done = css.match(/:is\(\.card-item, \.check-item, \.item\)\[data-done="true"\] \.pen,\s*\.ticker-item\[data-done\] \.pen\s*\{([^}]*)\}/);
    expect(done?.[1]).toContain("background-size: 100% 1px");
  });

  it("stands down under reduced motion", () => {
    // Both the plain pen and the open note's and Ticker's, which also settle the tone.
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.pen,\s*:is\(\.reader, \.ticker-item\) \.pen\s*\{\s*transition: none;/);
  });
});
