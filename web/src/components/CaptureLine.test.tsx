// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CaptureLine } from "./CaptureLine";

afterEach(cleanup);

describe("the bar's one line", () => {
  it("has one verb, as it always had", () => {
    render(<CaptureLine line={{ key: "k", said: "In Inbox", verb: "Go", act: vi.fn() }} />);
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });

  it("offers a second verb beside the first when it is handed one — Inspiration", () => {
    const act = vi.fn();
    const also = vi.fn();
    render(
      <CaptureLine
        line={{ key: "k", said: "Saved", verb: "Open", act, also: { verb: "Inspiration", act: also } }}
      />,
    );
    expect(screen.getAllByRole("button")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: /Inspiration/ }));
    expect(also).toHaveBeenCalledTimes(1);
    expect(act).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /Open/ }));
    expect(act).toHaveBeenCalledTimes(1);
  });

  it("shows the waiting files as squares: a picture as itself, a file as its mark, four at most", () => {
    const made = vi.fn(() => "blob:shot");
    const revoked = vi.fn();
    const was = { made: URL.createObjectURL, revoked: URL.revokeObjectURL };
    Object.assign(URL, { createObjectURL: made, revokeObjectURL: revoked });
    const files = [
      new File(["a"], "a.jpg", { type: "image/jpeg" }),
      new File(["b"], "b.pdf", { type: "application/pdf" }),
      ...["c", "d", "e"].map((n) => new File([n], `${n}.png`, { type: "image/png" })),
    ];
    const { container, unmount } = render(
      <CaptureLine line={{ key: "k", said: "5 files attached", verb: "Remove", act: vi.fn(), files }} />,
    );
    const squares = container.querySelectorAll(".capture-line-file");
    expect(squares).toHaveLength(4);
    expect(squares[0].querySelector("img")?.getAttribute("src")).toBe("blob:shot");
    expect(squares[1].querySelector("img")).toBeNull();
    expect(squares[1].querySelector("svg")).not.toBeNull();
    expect(screen.getAllByRole("button")).toHaveLength(1);
    unmount();
    expect(revoked).toHaveBeenCalledTimes(made.mock.calls.length);
    Object.assign(URL, { createObjectURL: was.made, revokeObjectURL: was.revoked });
  });

  it("draws no squares on a line about no files", () => {
    const { container } = render(<CaptureLine line={{ key: "k", said: "In Inbox", verb: "Go", act: vi.fn() }} />);
    expect(container.querySelector(".capture-line-files")).toBeNull();
  });

  it("says what is being done with no verb while files are made ready", () => {
    render(<CaptureLine line={{ key: "adding", said: "Adding 3 files", busy: true }} />);
    expect(screen.getByText("Adding 3 files")).toBeTruthy();
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });
});
