// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useRef } from "react";
import { useRestoreFocus } from "./useRestoreFocus";

afterEach(cleanup);

function Layer({ preferId }: { preferId?: string }) {
  const preferred = useRef<HTMLElement | null>(
    preferId ? document.getElementById(preferId) : null,
  );
  useRestoreFocus(preferId ? preferred : undefined);
  return <button type="button">inside</button>;
}

function opener(id: string): HTMLButtonElement {
  const b = document.createElement("button");
  b.id = id;
  document.body.appendChild(b);
  return b;
}

/**
 * Every layer here takes focus into itself on open, so that is what the
 * cases do too — and it is load-bearing: React's commit puts focus back on
 * whatever had it before the commit if that element is still in the
 * document, which would undo the cleanup's focus. With focus inside the
 * layer being removed there is nothing for React to put it back on.
 */
function focusInside() {
  screen.getByRole("button", { name: "inside" }).focus();
}

describe("useRestoreFocus", () => {
  it("gives focus back to whatever had it when the layer opened", () => {
    const from = opener("from");
    from.focus();
    const { unmount } = render(<Layer />);
    focusInside();
    unmount();
    expect(document.activeElement).toBe(from);
    from.remove();
  });

  it("prefers the named element, and falls back when it has gone", () => {
    const from = opener("from");
    const burger = opener("burger");
    from.focus();
    const { unmount } = render(<Layer preferId="burger" />);
    focusInside();
    unmount();
    expect(document.activeElement).toBe(burger);

    from.focus();
    const again = render(<Layer preferId="burger" />);
    focusInside();
    burger.remove();
    again.unmount();
    expect(document.activeElement).toBe(from);
    from.remove();
  });
});
