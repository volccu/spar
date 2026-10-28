// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HeaderWords } from "./HeaderWords";

afterEach(cleanup);

const words = (over: Partial<Parameters<typeof HeaderWords>[0]>) =>
  render(
    <HeaderWords said={null} announcement="" offerMessage="" updateReady={false} quiet={null} headerCount={null} {...over} />,
  );

/** A selection's count is the creature's since 2026-10-26 (owner); the header keeps search and reminders. */
describe("the header's count", () => {
  it("says a selection's count in the bubble, with Cancel", () => {
    const run = vi.fn();
    words({ said: { key: "select:", words: "3 selected", act: { verb: "Cancel", label: "Cancel, 3 selected", run } } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel, 3 selected" }));
    expect(run).toHaveBeenCalledOnce();
  });

  it("is plain words for a search count", () => {
    words({ headerCount: "5 found" });
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText("5 found")).toBeTruthy();
  });
});
