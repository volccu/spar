// @vitest-environment jsdom
import { render, cleanup, fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LinkPreview } from "./LinkPreview";
import type { LinkPreviewData } from "../lib/links";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function preview(over: Partial<LinkPreviewData>): LinkPreviewData {
  return {
    href: "https://example.com/a",
    domain: "example.com",
    title: "Example",
    description: null,
    image: null,
    fetched_at: null,
    ...over,
  };
}

describe("LinkPreview", () => {
  it("draws the picture when the image is a data URL", () => {
    const { container } = render(
      <LinkPreview
        preview={preview({ image: "data:image/jpeg;base64,AAAA" })}
        interactive
      />,
    );
    const img = container.querySelector("img.link-preview-image");
    expect(img?.getAttribute("src")).toBe("data:image/jpeg;base64,AAAA");
  });

  it("draws no picture for a raw http(s) image URL", () => {
    const { container } = render(
      <LinkPreview preview={preview({ image: "https://example.com/og.jpg" })} interactive />,
    );
    expect(container.querySelector("img.link-preview-image")).toBeNull();
  });

  it("says a dead page is gone beside its site in the open note, and keeps its title", () => {
    const { container } = render(
      <LinkPreview preview={preview({ gone: true, title: "Old recipe" })} interactive />,
    );
    expect(container.querySelector(".link-preview-domain")?.textContent).toBe("example.com · gone");
    expect(container.querySelector(".link-preview-title")?.textContent).toBe("Old recipe");
    // The address itself is untouched — it is still the link, and still live.
    expect(container.querySelector("a")?.getAttribute("href")).toBe("https://example.com/a");
  });

  it("leaves the word to the card's footer on a compact preview, and says nothing of a live page", () => {
    const compact = render(<LinkPreview preview={preview({ gone: true })} compact />);
    expect(compact.container.querySelector(".link-preview-gone")).toBeNull();
    cleanup();
    const live = render(<LinkPreview preview={preview({})} interactive />);
    expect(live.container.querySelector(".link-preview-gone")).toBeNull();
  });

  it("draws no picture when there is none", () => {
    const { container } = render(<LinkPreview preview={preview({ image: null })} interactive />);
    expect(container.querySelector("img.link-preview-image")).toBeNull();
  });

  /**
   * `window.open` as a browser actually implements it: a features string
   * carrying `noopener`/`noreferrer` returns `null` **and still opens the
   * window**, because severing the opener leaves nothing to hand back. The
   * mock this replaces returned a truthy stand-in whatever it was passed,
   * which is why it agreed the anchor stood down while a real desktop opened
   * two tabs on every link.
   */
  function browserlikeOpen() {
    const handle = { opener: {} } as unknown as Window;
    const spy = vi
      .spyOn(window, "open")
      .mockImplementation((_url?: unknown, _target?: string, features?: string) =>
        features && /noopener|noreferrer/.test(features) ? null : handle,
      );
    return { spy, handle };
  }

  it("opens one window, not two, on a real browser's window.open", () => {
    const { spy } = browserlikeOpen();
    const { container } = render(<LinkPreview preview={preview({})} interactive />);
    const anchor = container.querySelector("a.link-preview-interactive")!;
    // fireEvent reports false when the default was prevented — the anchor's
    // own navigation stood down because window.open was honoured. True here
    // means the anchor navigates as well and the user gets two tabs.
    expect(fireEvent.click(anchor)).toBe(false);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith("https://example.com/a", "_blank");
  });

  it("falls back to the anchor's own target when the runtime refuses", () => {
    vi.spyOn(window, "open").mockReturnValue(null);
    const { container } = render(<LinkPreview preview={preview({})} interactive />);
    const anchor = container.querySelector("a.link-preview-interactive")!;
    expect(fireEvent.click(anchor)).toBe(true);
    expect(anchor.getAttribute("target")).toBe("_blank");
    expect(anchor.getAttribute("rel")).toBe("noreferrer noopener");
  });
});
