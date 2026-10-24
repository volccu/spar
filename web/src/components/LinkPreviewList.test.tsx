// @vitest-environment jsdom
import { render, cleanup, fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LinkPreviewList, PREVIEWS_SHOWN } from "./LinkPreviewList";
import type { LinkPreviewData } from "../lib/links";

afterEach(cleanup);

function many(n: number, hiddenFrom = Infinity): LinkPreviewData[] {
  return Array.from({ length: n }, (_, i) => ({
    href: `https://example.com/${i}`,
    domain: "example.com",
    title: `Page ${i}`,
    description: null,
    image: null,
    fetched_at: null,
    ...(i >= hiddenFrom ? { hidden: true } : {}),
  }));
}

describe("LinkPreviewList", () => {
  it("draws every preview up to the cap, with no extra row", () => {
    const { container } = render(
      <LinkPreviewList previews={many(PREVIEWS_SHOWN)} onHide={vi.fn()} onShowHidden={vi.fn()} />,
    );
    expect(container.querySelectorAll(".link-preview")).toHaveLength(PREVIEWS_SHOWN);
    expect(container.querySelector(".link-previews-row")).toBeNull();
  });

  it("shows three and a row for the rest, which opens them all", () => {
    const { container, getByText } = render(
      <LinkPreviewList previews={many(8)} onHide={vi.fn()} onShowHidden={vi.fn()} />,
    );
    expect(PREVIEWS_SHOWN).toBe(3);
    expect(container.querySelectorAll(".link-preview")).toHaveLength(3);
    fireEvent.click(getByText("Show 5 more"));
    expect(container.querySelectorAll(".link-preview")).toHaveLength(8);
    expect(container.querySelector(".link-previews-row")).toBeNull();
  });

  it("counts only the visible previews against the cap", () => {
    const { container } = render(
      <LinkPreviewList previews={many(6, 3)} onHide={vi.fn()} onShowHidden={vi.fn()} />,
    );
    expect(container.querySelectorAll(".link-preview")).toHaveLength(3);
    expect(container.textContent).not.toContain("Show");
  });

  it("gives each preview a hide button beside its link, never inside it", () => {
    const onHide = vi.fn();
    const { container } = render(
      <LinkPreviewList previews={many(2)} onHide={onHide} onShowHidden={vi.fn()} />,
    );
    const buttons = container.querySelectorAll("button.link-preview-hide");
    expect(buttons).toHaveLength(2);
    for (const button of buttons) {
      expect(button.closest("a")).toBeNull();
      expect(button.getAttribute("aria-label")).toBe("Hide preview of example.com");
    }
    fireEvent.click(buttons[1]);
    expect(onHide).toHaveBeenCalledWith("https://example.com/1");
  });

  it("offers no hide button when hiding is not on offer", () => {
    const { container } = render(<LinkPreviewList previews={many(2)} onShowHidden={vi.fn()} />);
    expect(container.querySelector(".link-preview-hide")).toBeNull();
  });

  it("ends with a quiet row that brings every hidden preview back", () => {
    const onShowHidden = vi.fn();
    const { container, getByText } = render(
      <LinkPreviewList previews={many(5, 2)} onHide={vi.fn()} onShowHidden={onShowHidden} />,
    );
    expect(container.querySelectorAll(".link-preview")).toHaveLength(2);
    const row = getByText("3 hidden · show");
    expect(container.querySelector(".link-previews")?.lastElementChild).toBe(row);
    fireEvent.click(row);
    expect(onShowHidden).toHaveBeenCalledWith(["https://example.com/2", "https://example.com/3", "https://example.com/4"]);
  });

  it("stays standing, with only the row, when everything is hidden", () => {
    const { container, getByText } = render(
      <LinkPreviewList previews={many(2, 0)} onHide={vi.fn()} onShowHidden={vi.fn()} />,
    );
    expect(container.querySelectorAll(".link-preview")).toHaveLength(0);
    expect(getByText("2 hidden · show")).toBeTruthy();
  });

  it("draws nothing for a note with no links", () => {
    const { container } = render(<LinkPreviewList previews={[]} onHide={vi.fn()} onShowHidden={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });
});
