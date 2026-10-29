// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseBlocks } from "../lib/blocks";
import { NoteReader } from "./NoteReader";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const NOTE = "```bash\nffmpeg -i in.mov -vf scale=1280:-2 -c:v libx264 -crf 26 -c:a aac out.mp4\n```";

/** jsdom lays nothing out: say how wide the code box is and how wide its line. */
function widths(scroll: number, client: number) {
  vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockReturnValue(scroll);
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(client);
}

function read() {
  const noop = () => {};
  return render(
    <NoteReader
      blocks={parseBlocks(NOTE)}
      text={NOTE}
      textRef={{ current: NOTE }}
      onRewrite={noop}
      onStartEditing={noop}
      onFocusEdit={noop}
    />,
  );
}

describe("a code block in the open note (review UI-13)", () => {
  it("can be reached by keyboard when its line is wider than the box, and says what it is", () => {
    widths(578, 561);
    const pre = read().container.querySelector("pre.code")!;
    expect(pre.getAttribute("tabindex")).toBe("0");
    expect(pre.getAttribute("role")).toBe("region");
    expect(pre.getAttribute("aria-label")).toBe("Code, scrolls sideways");
  });

  it("is not a tab stop when everything fits", () => {
    widths(300, 300);
    const pre = read().container.querySelector("pre.code")!;
    expect(pre.hasAttribute("tabindex")).toBe(false);
    expect(pre.hasAttribute("aria-label")).toBe(false);
  });
});

describe("dragging a list item in the open note", () => {
  it("leaves the note alone when the browser cancels the drag", () => {
    const list = "- one\n- two\n- three";
    const onRewrite = vi.fn();
    const noop = () => {};
    const { container } = render(
      <NoteReader
        blocks={parseBlocks(list)}
        text={list}
        textRef={{ current: list }}
        onRewrite={onRewrite}
        onStartEditing={noop}
        onFocusEdit={noop}
      />,
    );
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      const i = Number(this.getAttribute("data-i") ?? 0);
      return { top: i * 20, height: 20, bottom: i * 20 + 20, left: 0, right: 0, width: 0, x: 0, y: i * 20, toJSON() {} } as DOMRect;
    });
    const grip = container.querySelector<HTMLElement>(".item-grip")!;
    const at = (clientY: number) => ({ clientY, pointerId: 1 });
    fireEvent.pointerDown(grip, at(10));
    fireEvent.pointerMove(grip, at(50));
    fireEvent.pointerCancel(grip, at(50));
    expect(onRewrite).not.toHaveBeenCalled();
  });
});
