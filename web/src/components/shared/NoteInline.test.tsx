// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NoteInline } from "./NoteInline";
import { markHits } from "../../lib/face";
import { plainInline } from "../../lib/inline";
import { AttachRefsContext, type AttachRefs } from "../../lib/useAttachMarkers";
import type { Attachment } from "../../types";

afterEach(cleanup);

/**
 * `markHits` splits a segment by character offset so the matched run can be
 * held at full ink, and it copies every flag onto each piece — `code` included.
 * Drawn a piece at a time, one snippet came out as three adjacent boxes, each
 * carrying the padding and the hairline `.inline-code` draws, with the joins
 * between them showing. One snippet is one box, and the hit goes inside it.
 */
describe("a snippet inside a searched line", () => {
  it("draws one box for one snippet, with the hit marked inside it", () => {
    const segs = markHits(plainInline("call `deriveFace(note)` first"), ["note"]);
    const { container } = render(<NoteInline segs={segs} />);
    const boxes = container.querySelectorAll("code.inline-code");
    expect(boxes).toHaveLength(1);
    expect(boxes[0].textContent).toBe("deriveFace(note)");
    // Nested inside the box, which is what the stylesheet hooks the emphasis
    // onto: a hit wrapped *around* the box could only be a fourth box.
    expect(boxes[0].querySelector('[data-hit="true"]')?.textContent).toBe("note");
  });

  it("leaves a snippet with no hit in it exactly as it was", () => {
    const { container } = render(<NoteInline segs={plainInline("`a + b` and more")} />);
    expect(container.querySelectorAll("code.inline-code")).toHaveLength(1);
    expect(container.querySelector('[data-hit="true"]')).toBeNull();
  });

  it("keeps the emphasis the snippet was written inside", () => {
    const segs = markHits(plainInline("**bold `deriveFace(note)` here**"), ["note"]);
    const { container } = render(<NoteInline segs={segs} />);
    const box = container.querySelector("code.inline-code");
    expect(box?.closest(".em")?.getAttribute("data-strong")).toBe("true");
  });

  /** The reader's round trip: every character of the note, delimiters and all. */
  it("still renders the reader's delimiters, drawn as marks", () => {
    const { container } = render(<NoteInline text="call `deriveFace()` first" />);
    expect(container.textContent).toBe("call `deriveFace()` first");
    expect(container.querySelectorAll(".note-mark")).toHaveLength(2);
    expect(container.querySelectorAll("[hidden]")).toHaveLength(0);
  });
});

/** Owner, 2026-10-26: in the open note a `[image 2]` marker opens its file; on a card it is text. */
describe("a file marker", () => {
  const pic = { id: "p1", name: "crack.jpg", mime: "image/jpeg", ref: 2 } as Attachment;
  const refs = (open: (id: string) => void): AttachRefs => ({
    find: (kind, n) => (kind === "image" && n === 2 ? pic : undefined),
    open,
  });

  it("opens the file it points at, drawn as the same characters", () => {
    const open = vi.fn();
    const { container, getByRole } = render(
      <AttachRefsContext.Provider value={refs(open)}>
        <NoteInline text="see [image 2] here" interactive />
      </AttachRefsContext.Provider>,
    );
    expect(container.textContent).toBe("see [image 2] here");
    fireEvent.click(getByRole("button", { name: "Open image 2, crack.jpg" }));
    expect(open).toHaveBeenCalledWith("p1");
  });

  it("is plain text on a card, and once its file is gone", () => {
    const card = render(
      <AttachRefsContext.Provider value={refs(() => {})}>
        <NoteInline text="see [image 2]" />
      </AttachRefsContext.Provider>,
    );
    expect(card.container.querySelector("button")).toBeNull();
    cleanup();
    const gone = render(
      <AttachRefsContext.Provider value={refs(() => {})}>
        <NoteInline text="see [image 3]" interactive />
      </AttachRefsContext.Provider>,
    );
    expect(gone.container.querySelector("button")).toBeNull();
    expect(gone.container.textContent).toBe("see [image 3]");
  });
});
