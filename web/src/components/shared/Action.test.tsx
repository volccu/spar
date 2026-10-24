// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Action } from "./Action";

afterEach(cleanup);

/**
 * The two props the insert, reminder and add panels needed and did not have,
 * which is why each hand-rolled the row again: a press that leaves the caret
 * where it was, and a row that can say whether it is on.
 */
describe("Action", () => {
  it("swallows mousedown only when asked to keep focus", () => {
    render(
      <>
        <Action label="Keeps" keepFocus onClick={() => {}}>
          <span />
        </Action>
        <Action label="Takes" onClick={() => {}}>
          <span />
        </Action>
      </>,
    );
    const kept = fireEvent.mouseDown(screen.getByRole("button", { name: "Keeps" }));
    const taken = fireEvent.mouseDown(screen.getByRole("button", { name: "Takes" }));
    expect(kept).toBe(false);
    expect(taken).toBe(true);
  });

  it("is a checkbox row when told it is on or off, and a plain row otherwise", () => {
    const onClick = vi.fn();
    render(
      <>
        <Action label="every week" role="menuitemcheckbox" checked onClick={onClick}>
          <span />
        </Action>
        <Action label="Tomorrow" role="menuitem" onClick={onClick}>
          <span />
        </Action>
      </>,
    );
    expect(screen.getByRole("menuitemcheckbox", { name: "every week" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("menuitem", { name: "Tomorrow" }).hasAttribute("aria-checked")).toBe(false);
    fireEvent.click(screen.getByRole("menuitem", { name: "Tomorrow" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
