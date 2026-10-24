// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HeaderWords } from "./HeaderWords";

afterEach(cleanup);

const words = (over: Partial<Parameters<typeof HeaderWords>[0]>) =>
  render(
    <HeaderWords said={null} announcement="" offerMessage="" updateReady={false} quiet={null} headerCount={null} {...over} />,
  );

/** Review 2026-10-24, UX-15: "3 selected" in the header is the one tap that ends picking. */
describe("the header's selection count", () => {
  it("is a Cancel button while notes are picked", () => {
    const onEndSelection = vi.fn();
    words({ headerCount: "3 selected", onEndSelection });
    fireEvent.click(screen.getByRole("button", { name: "Cancel, 3 selected" }));
    expect(onEndSelection).toHaveBeenCalledOnce();
  });

  it("stays plain words for a search count", () => {
    words({ headerCount: "5 found" });
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText("5 found")).toBeTruthy();
  });
});
