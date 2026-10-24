// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HeldWork } from "./HeldWork";

afterEach(cleanup);

function draw(count = 3) {
  const onSignOut = vi.fn();
  const onClear = vi.fn();
  render(
    <HeldWork count={count} notes={[]} folders={[]} canvases={[]} onSignOut={onSignOut} onClear={onClear} />,
  );
  return { onSignOut, onClear };
}

describe("HeldWork", () => {
  it("says how much would be lost", () => {
    draw(3);
    expect(screen.getByRole("alert").textContent).toMatch(/3 changes/);
  });

  it("clears only after a second, explicit yes", () => {
    const { onClear } = draw();
    fireEvent.click(screen.getByRole("button", { name: "Clear this device anyway" }));
    expect(onClear).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClear).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Clear this device anyway" }));
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it("offers signing out, which loses nothing", () => {
    const { onSignOut, onClear } = draw();
    fireEvent.click(screen.getByRole("button", { name: /Sign out/ }));
    expect(onSignOut).toHaveBeenCalledTimes(1);
    expect(onClear).not.toHaveBeenCalled();
  });
});
