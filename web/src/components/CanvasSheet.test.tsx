// @vitest-environment jsdom
import { fireEvent, render, screen, cleanup, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Note, Canvas } from "../types";
import { CanvasSheet } from "./CanvasSheet";
import { note as base } from "../test/fixtures";

const note = (id: string, body: string): Note =>
  base({
    id,
    raw_content: body,
    body,
    created_at: "2026-08-10T10:00:00.000Z",
    updated_at: "2026-08-10T10:00:00.000Z",
    status: "archived",
  });

afterEach(cleanup);


const folder: Canvas = {
  id: "idea",
  idea_id: "idea",
  items: [
    { note_id: "a", x: 0, y: 0 },
    { note_id: "b", x: 276, y: 0 },
  ],
  strokes: [],
  image_widths: {},
  created_at: "2026-08-12T12:00:00.000Z",
  updated_at: "2026-08-12T12:00:00.000Z",
};

/** The note the canvas belongs to — what carries the idea's name. */
function idea(body = "first\n\n———\n\nsecond"): Note {
  return {
    ...note("idea", body),
    source: "merge",
    status: "active",
    merged_from: ["a", "b"],
  };
}

function renderFolder(overrides: Partial<React.ComponentProps<typeof CanvasSheet>> = {}) {
  return render(
    <CanvasSheet
      folder={folder}
      idea={idea()}
      notes={[note("a", "first"), note("b", "second")]}
      onClose={() => {}}
      onRename={() => {}}
      onRelease={() => {}}
      onDissolve={() => {}}
      onTrashNote={() => {}}
      onDragNoteTo={() => {}}
      onOpenNote={() => {}}
      onAddStroke={() => {}}
      onClearStrokes={() => {}} onRemoveStroke={() => {}} onChangeCanvas={() => {}}
      {...overrides}
    />,
  );
}

describe("CanvasSheet", () => {
  it("moves a child note while keeping the folder surface mounted", () => {
    const onDragNoteTo = vi.fn();
    renderFolder({ onDragNoteTo });

    const first = screen.getByRole("button", { name: /open note: first/i });
    fireEvent.pointerDown(first, { clientX: 10, clientY: 10, pointerId: 1 });
    fireEvent.pointerMove(first, { clientX: 110, clientY: 50, pointerId: 1 });
    fireEvent.pointerUp(first, { clientX: 110, clientY: 50, pointerId: 1 });

    expect(onDragNoteTo).toHaveBeenCalledWith("idea", "a", 100, 40);
    expect(document.querySelector(".canvas-surface")).toBeTruthy();
  });

  it("scrolls in both axes across the folder surface", () => {
    renderFolder();

    const canvas = document.querySelector<HTMLElement>(".canvas-surface")!;
    const world = document.querySelector<HTMLElement>(".canvas-world")!;
    expect(world.style.width).toBe("100000px");
    expect(world.style.height).toBe("100000px");

    canvas.scrollLeft = 51000;
    canvas.scrollTop = 49000;
    fireEvent.scroll(canvas);

    expect(canvas.scrollLeft).toBe(51000);
    expect(canvas.scrollTop).toBe(49000);
  });

  it("shows a note at full length instead of cutting it off", () => {
    const longBody = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join("\n");
    render(
      <CanvasSheet
        folder={{ ...folder, items: [{ note_id: "a", x: 0, y: 0 }] }}
        idea={idea()}
        notes={[note("a", longBody)]}
        onClose={() => {}}
        onRename={() => {}}
        onRelease={() => {}}
        onDissolve={() => {}}
        onTrashNote={() => {}}
        onDragNoteTo={() => {}}
        onOpenNote={() => {}}
        onAddStroke={() => {}}
        onClearStrokes={() => {}} onRemoveStroke={() => {}} onChangeCanvas={() => {}}
      />,
    );

    const capsule = screen.getByRole("button", { name: /open note: line 1/i });
    expect(capsule.textContent).toContain("line 20");
    expect(capsule.querySelector(".spatial-card-body")).toBeTruthy();
  });

  it("renders a move tool and a draw tool in the toolbar", () => {
    renderFolder();
    expect(screen.getByLabelText("Move")).toBeTruthy();
    expect(screen.getByLabelText("Draw")).toBeTruthy();
  });

  it("reveals one colour and one thickness control when draw tool is selected", () => {
    renderFolder();
    expect(screen.queryByLabelText("Pen colour: Ink")).toBeNull();

    fireEvent.click(screen.getByLabelText("Draw"));
    expect(screen.getByLabelText("Pen colour: Ink")).toBeTruthy();
    expect(screen.getByLabelText("Line thickness: 4")).toBeTruthy();
  });

  /**
   * Every other control in this bar says whether it is on — the two tools and
   * the three stroke weights all carry `aria-pressed`. The pen tones said it
   * only in `data-on`, which is a CSS hook and nothing else, so the one row
   * where the state *is* the whole message was silent to a reader. The tone
   * itself now rides in on `--pen` rather than as the button's own fill, so
   * the button can be a thumb's worth tall with the 22px sample drawn inside
   * it (`styles.test.ts` holds the height).
   */
  it("offers the three neutrals and all sixteen brand colours through one picker", () => {
    renderFolder();
    fireEvent.click(screen.getByLabelText("Draw"));
    const trigger = screen.getByLabelText("Pen colour: Ink");
    expect(trigger.getAttribute("style")).toContain("--pen");
    // The fill belongs to the swatch the stylesheet draws, never to the button.
    expect(trigger.style.background).toBe("");

    fireEvent.click(trigger);
    const menu = screen.getByRole("menu", { name: "Pen colour" });
    const choices = within(menu).getAllByRole("menuitemradio");
    expect(choices).toHaveLength(19);
    expect(within(menu).getByRole("menuitemradio", { name: "Ink", checked: true })).toBeTruthy();
    expect(within(menu).getByRole("menuitemradio", { name: "Muted", checked: false })).toBeTruthy();

    fireEvent.click(within(menu).getByRole("menuitemradio", { name: "Rust" }));
    expect(screen.queryByRole("menu", { name: "Pen colour" })).toBeNull();
    const rust = screen.getByLabelText("Pen colour: Rust");
    expect(rust.getAttribute("style")).toContain("var(--board-ember)");
    expect(rust.getAttribute("aria-expanded")).toBe("false");
  });

  it("stores the chosen brand token on the next stroke", () => {
    const onAddStroke = vi.fn();
    renderFolder({ initialTool: "draw", onAddStroke });
    fireEvent.click(screen.getByLabelText("Pen colour: Ink"));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Rust" }));

    const canvas = document.querySelector<HTMLElement>(".canvas-surface")!;
    canvas.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600 }) as DOMRect;
    fireEvent.pointerDown(canvas, { pointerId: 1, pointerType: "mouse", button: 0, clientX: 60, clientY: 60 });
    fireEvent.pointerMove(canvas, { pointerId: 1, pointerType: "mouse", button: 0, clientX: 100, clientY: 100 });
    fireEvent.pointerUp(canvas, { pointerId: 1, pointerType: "mouse", button: 0, clientX: 100, clientY: 100 });

    expect(onAddStroke).toHaveBeenCalledTimes(1);
    expect(onAddStroke.mock.calls[0][1].color).toBe("var(--board-ember)");
  });

  it("shows clear drawings only when strokes exist", () => {
    const stroke = {
      id: "s1",
      points: [[0, 0], [100, 100]] as [number, number][],
      color: "#16161a",
      width: 4,
    };
    renderFolder({ folder: { ...folder, strokes: [stroke] } });
    fireEvent.click(screen.getByLabelText("Draw"));
    expect(screen.getByLabelText("Clear drawings")).toBeTruthy();
  });

  /**
   * The menu opens where the hand already is. Offering only "Move" from there
   * meant the pencil was a trip to the far corner of the screen and back.
   */
  it("offers both tools from the canvas menu and marks the one in hand", () => {
    renderFolder();
    const canvas = document.querySelector<HTMLElement>(".canvas-surface")!;
    fireEvent.contextMenu(canvas, { clientX: 200, clientY: 200 });

    const menu = within(document.querySelector<HTMLElement>(".ctx-menu")!);
    const draw = menu.getByRole("menuitemradio", { name: "Draw", checked: false });
    expect(menu.getByRole("menuitemradio", { name: "Move", checked: true })).toBeTruthy();

    fireEvent.click(draw);
    // The menu closes behind the choice, and the toolbar agrees with it.
    expect(document.querySelector(".ctx-menu")).toBeNull();
    expect(document.querySelector<HTMLElement>(".canvas-surface")!.dataset.tool).toBe("draw");
    expect(screen.getByLabelText("Pen colour: Ink")).toBeTruthy();
  });

  /* --- naming the place ---------------------------------------------------- */

  it("says what it holds until somebody names it, and says so quietly", () => {
    // Beside its count, an unnamed idea of two notes reads "2 notes", not "2 Idea"
    // (review 2026-10-24 UX-05); a sketch with nothing in it still says Idea.
    renderFolder();
    const title = screen.getByRole("button", { name: /name this idea/i });
    expect(title.textContent).toBe("notes");
    expect(title.dataset.unnamed).toBe("true");
  });

  it("shows the name the user wrote into the idea's own text", () => {
    renderFolder({ idea: idea("# Kitchen rebuild\n\nfirst") });
    const title = screen.getByRole("button", { name: /idea: kitchen rebuild/i });
    expect(title.textContent).toBe("Kitchen rebuild");
    expect(title.dataset.unnamed).toBe("false");
  });

  it("renames on Enter, and hands up the name rather than the note", () => {
    const onRename = vi.fn();
    renderFolder({ onRename });

    fireEvent.click(screen.getByRole("button", { name: /name this idea/i }));
    const field = screen.getByLabelText("Idea name") as HTMLInputElement;
    fireEvent.change(field, { target: { value: "Kitchen" } });
    fireEvent.keyDown(field, { key: "Enter" });
    fireEvent.blur(field);

    expect(onRename).toHaveBeenCalledWith("idea", "Kitchen");
  });

  it("writes nothing when the name comes back unchanged", () => {
    const onRename = vi.fn();
    renderFolder({ idea: idea("# Kitchen\n\nfirst"), onRename });
    fireEvent.click(screen.getByRole("button", { name: /idea: kitchen/i }));
    fireEvent.blur(screen.getByLabelText("Idea name"));
    expect(onRename).not.toHaveBeenCalled();
  });

  it("abandons the edit on Escape", () => {
    const onRename = vi.fn();
    renderFolder({ onRename });
    fireEvent.click(screen.getByRole("button", { name: /name this idea/i }));
    const field = screen.getByLabelText("Idea name");
    fireEvent.change(field, { target: { value: "Nope" } });
    fireEvent.keyDown(field, { key: "Escape" });
    expect(onRename).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /name this idea/i })).toBeTruthy();
  });

  /* --- getting back out ---------------------------------------------------- */

  it("offers a note its way back to the board on right-click", () => {
    const onRelease = vi.fn();
    renderFolder({ onRelease });

    const first = screen.getByRole("button", { name: /open note: first/i });
    fireEvent.contextMenu(first, { clientX: 40, clientY: 40 });

    const menu = within(document.querySelector<HTMLElement>(".ctx-menu")!);
    fireEvent.click(menu.getByRole("menuitem", { name: /take out of idea/i }));

    expect(onRelease).toHaveBeenCalledWith("idea", "a");
    expect(document.querySelector(".ctx-menu")).toBeNull();
  });

  it("offers Delete on a note's menu and calls the prop, not the release path", () => {
    const onTrashNote = vi.fn();
    const onRelease = vi.fn();
    renderFolder({ onTrashNote, onRelease });

    const first = screen.getByRole("button", { name: /open note: first/i });
    fireEvent.contextMenu(first, { clientX: 40, clientY: 40 });

    const menu = within(document.querySelector<HTMLElement>(".ctx-menu")!);
    fireEvent.click(menu.getByRole("menuitem", { name: "Delete" }));

    expect(onTrashNote).toHaveBeenCalledWith("a");
    expect(onRelease).not.toHaveBeenCalled();
    expect(document.querySelector(".ctx-menu")).toBeNull();
  });

  it("does not draw a note that has been trashed", () => {
    // A note trashed on the other device is still named in `folder.items`
    // until this device's own canvas next syncs — the layout and the note's
    // own status travel independently, so the canvas has to check both.
    renderFolder({
      notes: [note("a", "first"), { ...note("b", "second"), status: "trashed" }],
    });

    expect(screen.getByRole("button", { name: /open note: first/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /open note: second/i })).toBeNull();
  });

  it("does not open the canvas menu over a note", () => {
    // The canvas menu is about the canvas. Right-clicking a note has to be a
    // question about that note, or the two menus race for the same gesture.
    renderFolder();
    const first = screen.getByRole("button", { name: /open note: first/i });
    fireEvent.contextMenu(first, { clientX: 40, clientY: 40 });

    const menu = within(document.querySelector<HTMLElement>(".ctx-menu")!);
    expect(menu.queryByRole("menuitemradio", { name: "Draw" })).toBeNull();
    expect(menu.getByRole("menuitem", { name: /take out of idea/i })).toBeTruthy();
  });

  it("offers to dissolve the whole idea from the canvas menu", () => {
    const onDissolve = vi.fn();
    renderFolder({ onDissolve });

    const canvas = document.querySelector<HTMLElement>(".canvas-surface")!;
    fireEvent.contextMenu(canvas, { clientX: 200, clientY: 200 });

    const menu = within(document.querySelector<HTMLElement>(".ctx-menu")!);
    fireEvent.click(menu.getByRole("menuitem", { name: /dissolve idea/i }));

    // It only asks — the App draws the dialog and does the work.
    expect(onDissolve).toHaveBeenCalledWith("idea");
  });

  /* --- the menus take the keyboard ---------------------------------------- */

  it("puts focus on a menu's first row, closes it on Escape and gives focus back", () => {
    const onClose = vi.fn();
    renderFolder({ onClose });
    const first = screen.getByRole("button", { name: /open note: first/i });
    first.focus();
    fireEvent.contextMenu(first, { clientX: 40, clientY: 40 });

    const open = screen.getByRole("menuitem", { name: "Open note" });
    expect(screen.getByRole("menu", { name: "Note menu" })).toBeTruthy();
    expect(document.activeElement).toBe(open);

    fireEvent.keyDown(open, { key: "ArrowDown" });
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: /take out of idea/i }));

    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(document.querySelector(".ctx-menu")).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(first);
  });

  it("lets a text label be reached and edited from the keyboard", () => {
    const onEditText = vi.fn();
    renderFolder({
      folder: { ...folder, text_elements: [{ id: "t1", text: "Buy milk", x: 10, y: 10 }] },
      onEditText,
    });
    const label = screen.getByRole("button", { name: "Buy milk" });
    expect(label.tabIndex).toBe(0);
    fireEvent.keyDown(label, { key: "Enter" });
    expect(screen.getByLabelText("Text on the idea")).toBeTruthy();
  });

  /* --- pinch to zoom -------------------------------------------------------
     jsdom returns all zeros from getBoundingClientRect, so the canvas surface
     is stubbed with a real rect the same way NoteView.test.tsx stubs a list
     item's — the pinch math needs an actual rectLeft/rectTop to divide by. */

  function stubCanvasRect() {
    const canvas = document.querySelector<HTMLElement>(".canvas-surface")!;
    canvas.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600 }) as DOMRect;
    return canvas;
  }

  it("raises the world's scale as two touch pointers move apart", () => {
    renderFolder();
    const canvas = stubCanvasRect();

    fireEvent.pointerDown(canvas, { pointerId: 1, clientX: 100, clientY: 100, pointerType: "touch" });
    fireEvent.pointerDown(canvas, { pointerId: 2, clientX: 200, clientY: 100, pointerType: "touch" });
    // Starting distance is 100px; spreading to 200px doubles the zoom.
    fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 50, clientY: 100, pointerType: "touch" });
    fireEvent.pointerMove(canvas, { pointerId: 2, clientX: 250, clientY: 100, pointerType: "touch" });

    const world = document.querySelector<HTMLElement>(".canvas-world")!;
    expect(world.style.transform).toBe("scale(2)");
    expect(screen.getByRole("button", { name: /zoomed to 200 percent/i })).toBeTruthy();
  });

  it("never zooms past the clamp, however far the fingers spread", () => {
    renderFolder();
    const canvas = stubCanvasRect();

    fireEvent.pointerDown(canvas, { pointerId: 1, clientX: 400, clientY: 100, pointerType: "touch" });
    fireEvent.pointerDown(canvas, { pointerId: 2, clientX: 500, clientY: 100, pointerType: "touch" });
    fireEvent.pointerMove(canvas, { pointerId: 1, clientX: -5000, clientY: 100, pointerType: "touch" });
    fireEvent.pointerMove(canvas, { pointerId: 2, clientX: 5000, clientY: 100, pointerType: "touch" });

    const world = document.querySelector<HTMLElement>(".canvas-world")!;
    expect(world.style.transform).toBe("scale(2.5)");
  });

  it("cancels a pan already in flight when a second finger joins, and does not resume it once the pinch ends", () => {
    renderFolder();
    const canvas = stubCanvasRect();

    // One finger starts a pan…
    const origin = canvas.scrollLeft; // the canvas centres itself on open
    fireEvent.pointerDown(canvas, { pointerId: 1, clientX: 100, clientY: 100, pointerType: "touch" });
    fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 60, clientY: 100, pointerType: "touch" });
    expect(canvas.scrollLeft).toBe(origin + 40);

    // …a second finger turns it into a pinch, which cancels the pan…
    fireEvent.pointerDown(canvas, { pointerId: 2, clientX: 200, clientY: 100, pointerType: "touch" });
    // …and lifting back to one finger does not hand the pan back its pointer:
    // it was cancelled, not paused, so nothing here is tracking it any more.
    fireEvent.pointerUp(canvas, { pointerId: 2, clientX: 200, clientY: 100, pointerType: "touch" });
    const scrollBeforeLoneMove = canvas.scrollLeft;
    fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 20, clientY: 100, pointerType: "touch" });

    expect(canvas.scrollLeft).toBe(scrollBeforeLoneMove);
  });

  it("resets to 100% from the zoom readout, and the readout disappears", () => {
    renderFolder();
    const canvas = stubCanvasRect();

    fireEvent.pointerDown(canvas, { pointerId: 1, clientX: 100, clientY: 100, pointerType: "touch" });
    fireEvent.pointerDown(canvas, { pointerId: 2, clientX: 200, clientY: 100, pointerType: "touch" });
    fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 50, clientY: 100, pointerType: "touch" });
    fireEvent.pointerMove(canvas, { pointerId: 2, clientX: 250, clientY: 100, pointerType: "touch" });

    const reset = screen.getByRole("button", { name: /zoomed to 200 percent/i });
    fireEvent.click(reset);

    expect(document.querySelector<HTMLElement>(".canvas-world")!.style.transform).toBe("scale(1)");
    expect(screen.queryByRole("button", { name: /zoomed to/i })).toBeNull();
  });

  it("resets around the middle of the view, not at the scroll 200% had left behind", () => {
    renderFolder();
    const canvas = stubCanvasRect();

    fireEvent.pointerDown(canvas, { pointerId: 1, clientX: 100, clientY: 100, pointerType: "touch" });
    fireEvent.pointerDown(canvas, { pointerId: 2, clientX: 200, clientY: 100, pointerType: "touch" });
    fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 50, clientY: 100, pointerType: "touch" });
    fireEvent.pointerMove(canvas, { pointerId: 2, clientX: 250, clientY: 100, pointerType: "touch" });
    fireEvent.pointerUp(canvas, { pointerId: 1, pointerType: "touch" });
    fireEvent.pointerUp(canvas, { pointerId: 2, pointerType: "touch" });
    const zoomed = { left: canvas.scrollLeft, top: canvas.scrollTop };

    fireEvent.click(screen.getByRole("button", { name: /zoomed to 200 percent/i }));

    // Whatever stood at the centre of the 800×600 view at 200% stands there
    // at 100%: its content point is (scroll + half the view) / 2.
    expect(canvas.scrollLeft).toBe((zoomed.left + 400) / 2 - 400);
    expect(canvas.scrollTop).toBe((zoomed.top + 300) / 2 - 300);
  });

  it("opens the next canvas where a canvas opens, whatever a pinch held at the clamp asked for", () => {
    const props = {
      idea: idea(),
      notes: [note("a", "first"), note("b", "second")],
      onClose: () => {},
      onRename: () => {},
      onRelease: () => {},
      onDissolve: () => {},
      onTrashNote: () => {},
      onDragNoteTo: () => {},
      onOpenNote: () => {},
      onAddStroke: () => {},
      onClearStrokes: () => {},
    };
    const { rerender } = render(<CanvasSheet {...props} folder={folder} />);
    const canvas = stubCanvasRect();
    const opened = { left: canvas.scrollLeft, top: canvas.scrollTop };

    // Spread to the clamp, then keep spreading: the zoom stays at 250%, so
    // the anchor that last move works out never lands.
    fireEvent.pointerDown(canvas, { pointerId: 1, clientX: 400, clientY: 100, pointerType: "touch" });
    fireEvent.pointerDown(canvas, { pointerId: 2, clientX: 500, clientY: 100, pointerType: "touch" });
    fireEvent.pointerMove(canvas, { pointerId: 1, clientX: -5000, clientY: 100, pointerType: "touch" });
    fireEvent.pointerMove(canvas, { pointerId: 2, clientX: 9000, clientY: 400, pointerType: "touch" });
    fireEvent.pointerUp(canvas, { pointerId: 1, pointerType: "touch" });
    fireEvent.pointerUp(canvas, { pointerId: 2, pointerType: "touch" });

    rerender(<CanvasSheet {...props} folder={{ ...folder, id: "another", idea_id: "another" }} />);

    expect(document.querySelector<HTMLElement>(".canvas-world")!.style.transform).toBe("scale(1)");
    expect(canvas.scrollLeft).toBe(opened.left);
    expect(canvas.scrollTop).toBe(opened.top);
  });

  it("neither opens nor moves a note when the browser cancels the press", () => {
    const onOpenNote = vi.fn();
    const onDragNoteTo = vi.fn();
    renderFolder({ onOpenNote, onDragNoteTo });
    const first = screen.getByRole("button", { name: /open note: first/i });
    const stood = { left: first.style.left, top: first.style.top };

    // Taken away before anything moved: this used to be the open path.
    fireEvent.pointerDown(first, { clientX: 10, clientY: 10, pointerId: 1 });
    fireEvent.pointerCancel(first, { clientX: 10, clientY: 10, pointerId: 1 });
    expect(onOpenNote).not.toHaveBeenCalled();

    // Taken away mid-drag: this used to be the commit path.
    fireEvent.pointerDown(first, { clientX: 10, clientY: 10, pointerId: 2 });
    fireEvent.pointerMove(first, { clientX: 110, clientY: 50, pointerId: 2 });
    fireEvent.pointerCancel(first, { clientX: 110, clientY: 50, pointerId: 2 });
    expect(onDragNoteTo).not.toHaveBeenCalled();
    expect(onOpenNote).not.toHaveBeenCalled();
    expect({ left: first.style.left, top: first.style.top }).toEqual(stood);
  });

  it("renders saved strokes as SVG paths", () => {
    const stroke = {
      id: "s1",
      points: [[0, 0], [100, 100]] as [number, number][],
      color: "#16161a",
      width: 4,
    };
    renderFolder({ folder: { ...folder, strokes: [stroke] } });

    const paths = document.querySelectorAll(".canvas-svg path");
    expect(paths.length).toBe(1);
    expect(paths[0].getAttribute("stroke")).toBe("#16161a");
  });
});

/**
 * A note on the canvas is drawn through the card's own `CardBody`. Its copy of
 * it had drifted: a code block's fences were spelled out as backticks and its
 * lines drawn in the body face, and a Keep tag line stood at full ink — where
 * the card hides the fences, sets code in the machine face and steps the tag
 * line down the ramp.
 */
describe("a note on the canvas reads as its card does", () => {
  function one(body: string) {
    render(
      <CanvasSheet
        folder={{ ...folder, items: [{ note_id: "a", x: 0, y: 0 }] }}
        idea={idea()}
        notes={[note("a", body)]}
        onClose={() => {}}
        onRename={() => {}}
        onRelease={() => {}}
        onDissolve={() => {}}
        onTrashNote={() => {}}
        onDragNoteTo={() => {}}
        onOpenNote={() => {}}
        onAddStroke={() => {}}
        onClearStrokes={() => {}} onRemoveStroke={() => {}} onChangeCanvas={() => {}}
      />,
    );
    return document.querySelector<HTMLElement>(".spatial-note .card-body")!;
  }

  it("hides a code block's fences and sets its lines as code", () => {
    const body = one("run this\n```\nnpm test\n```");
    expect(body.textContent).not.toContain("```");
    expect(body.querySelectorAll(".card-code-fence")).toHaveLength(2);
    const code = body.querySelector('.card-line[data-code="true"]')!;
    expect(code.textContent).toBe("npm test");
  });

  it("steps a Keep tag line down, as the card does", () => {
    const body = one("#todo\n\nbuy milk");
    const tag = body.querySelector('.card-line[data-tag="true"]')!;
    expect(tag.textContent).toBe("#todo");
    expect(body.querySelectorAll('[data-tag="true"]')).toHaveLength(1);
  });

  it("keeps what is the canvas's own: the uncut body class, lists, and Empty note", () => {
    const body = one("- [ ] eggs\n- [x] bread");
    expect(body.className).toBe("card-body spatial-card-body");
    expect(body.getAttribute("data-cut")).not.toBe("true");
    expect([...body.querySelectorAll(".card-item")].map((i) => i.getAttribute("data-done"))).toEqual([
      "false",
      "true",
    ]);
    cleanup();
    expect(one("").textContent).toBe("Empty note");
  });
});

describe("an empty sketch", () => {
  const empty: Canvas = { ...folder, items: [], text_elements: [] };
  const sketch = (props: Partial<React.ComponentProps<typeof CanvasSheet>> = {}) =>
    renderFolder({ folder: empty, notes: [], initialTool: "draw", ...props });

  it("says how to draw, and says nothing once there is a stroke", () => {
    sketch();
    expect(screen.getByText(/^Draw (here|with your finger)$/)).toBeTruthy();
    cleanup();
    sketch({
      folder: {
        ...empty,
        strokes: [{ id: "s", color: "#000", width: 2, points: [{ x: 0, y: 0 }, { x: 5, y: 5 }] }],
      },
    });
    expect(screen.queryByText(/^Draw (here|with your finger)$/)).toBeNull();
  });

  it("stays quiet on a canvas that holds notes", () => {
    renderFolder({ initialTool: "draw" });
    expect(screen.queryByText(/^Draw (here|with your finger)$/)).toBeNull();
  });
});
