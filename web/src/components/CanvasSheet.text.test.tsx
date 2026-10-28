// @vitest-environment jsdom
import { act, cleanup, createEvent, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Canvas, CanvasText } from "../types";
import { CanvasSheet } from "./CanvasSheet";
import { attachment, note as base } from "../test/fixtures";

/**
 * The Text tool and pictures set straight onto a canvas.
 *
 * World coordinates as in `CanvasSheet.tools.test.tsx`: the sheet opens
 * scrolled 48px short of the world's middle and the stubbed rect starts at 0,
 * so client (x, y) is world (x - 48, y - 48).
 */

// The thumbnail stands in for the bytes, which jsdom has no store for.
vi.mock("../store/useFileUrl", () => ({ useFileUrl: () => ({ url: null }) }));

afterEach(cleanup);

const empty: Canvas = {
  id: "idea",
  idea_id: "idea",
  items: [],
  strokes: [],
  image_widths: {},
  text_elements: [],
  created_at: "2026-08-12T12:00:00.000Z",
  updated_at: "2026-08-12T12:00:00.000Z",
};

const idea = (over = {}) => base({ id: "idea", raw_content: "# Sketch", body: "# Sketch", source: "draw", ...over });

function props(overrides: Partial<React.ComponentProps<typeof CanvasSheet>> = {}) {
  return {
    folder: empty,
    idea: idea(),
    notes: [],
    onClose: () => {},
    onRename: () => {},
    onRelease: () => {},
    onDissolve: () => {},
    onTrashNote: () => {},
    onDragNoteTo: () => {},
    onOpenNote: () => {},
    onAddStroke: () => {},
    onClearStrokes: () => {},
    onRemoveStroke: () => {},
    onChangeCanvas: () => {},
    onResizeNote: () => {},
    onResizeImage: () => {},
    onAddText: () => {},
    onEditText: () => {},
    onRemoveText: () => {},
    ...overrides,
  } satisfies React.ComponentProps<typeof CanvasSheet>;
}

function renderSheet(overrides: Partial<React.ComponentProps<typeof CanvasSheet>> = {}) {
  return render(<CanvasSheet {...props(overrides)} />);
}

function surface() {
  const el = document.querySelector<HTMLElement>(".canvas-surface")!;
  el.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600 }) as DOMRect;
  return el;
}

const mouse = (clientX: number, clientY: number, button = 0) => ({
  pointerId: 7,
  pointerType: "mouse",
  button,
  clientX,
  clientY,
});

/** The label editor focuses a tick late, so the press that made it cannot blur it. */
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

const label = (over: Partial<CanvasText> = {}): CanvasText => ({ id: "t1", x: 10, y: 10, text: "Buy milk", ...over });

describe("the Text tool", () => {
  it("stands in the toolbar beside Draw", () => {
    renderSheet();
    fireEvent.click(screen.getByRole("button", { name: "Text" }));
    expect(surface().dataset.tool).toBe("text");
    expect(screen.getByRole("button", { name: "Text" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("sets a label down where the canvas is pressed, and writes it only once it has words", async () => {
    const onAddText = vi.fn();
    renderSheet({ initialTool: "text", onAddText });
    fireEvent.pointerDown(surface(), mouse(200, 150));
    await settle();
    const field = screen.getByLabelText("Text on the idea") as HTMLTextAreaElement;
    expect(document.activeElement).toBe(field);
    // Nothing written while it is only an editor.
    expect(onAddText).not.toHaveBeenCalled();

    fireEvent.change(field, { target: { value: "Line one\nLine two" } });
    fireEvent.blur(field);
    expect(onAddText).toHaveBeenCalledTimes(1);
    const [canvasId, text] = onAddText.mock.calls[0];
    expect(canvasId).toBe("idea");
    expect(text.text).toBe("Line one\nLine two");
    expect(text.width).toBeGreaterThan(0);
    // Near the press: within a line of where the pointer was, in world units.
    expect(Math.abs(text.x - (200 - 48))).toBeLessThan(20);
    expect(Math.abs(text.y - (150 - 48))).toBeLessThan(20);
  });

  it("leaves nothing behind for a label closed blank, or cancelled with Escape", async () => {
    const onAddText = vi.fn();
    const onClose = vi.fn();
    renderSheet({ initialTool: "text", onAddText, onClose });
    fireEvent.pointerDown(surface(), mouse(200, 150));
    await settle();
    // Left blank a moment later — not the instant it was made (see below).
    const later = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 1000);
    fireEvent.blur(screen.getByLabelText("Text on the idea"));
    later.mockRestore();
    expect(screen.queryByLabelText("Text on the idea")).toBeNull();

    fireEvent.pointerDown(surface(), mouse(300, 150));
    await settle();
    const field = screen.getByLabelText("Text on the idea");
    fireEvent.change(field, { target: { value: "never mind" } });
    fireEvent.keyDown(field, { key: "Escape" });
    expect(screen.queryByLabelText("Text on the idea")).toBeNull();
    expect(onAddText).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("takes the focus back when a touch browser moves it the instant the label was set down", async () => {
    renderSheet({ initialTool: "text" });
    fireEvent.pointerDown(surface(), { ...mouse(200, 150), pointerType: "touch" });
    await settle();
    fireEvent.blur(screen.getByLabelText("Text on the idea"));
    await settle();
    expect(document.activeElement).toBe(screen.getByLabelText("Text on the idea"));
  });

  it("finishes the label being typed when the canvas is pressed, rather than starting another", async () => {
    const onAddText = vi.fn();
    renderSheet({ initialTool: "text", onAddText });
    fireEvent.pointerDown(surface(), mouse(200, 150));
    await settle();
    const field = screen.getByLabelText("Text on the idea");
    fireEvent.change(field, { target: { value: "Done" } });
    fireEvent.pointerDown(surface(), mouse(500, 400));
    expect(onAddText).toHaveBeenCalledTimes(1);
    await settle();
    expect(screen.queryByLabelText("Text on the idea")).toBeNull();
  });

  it("never sets a label down with the right button", async () => {
    renderSheet({ initialTool: "text" });
    fireEvent.pointerDown(surface(), mouse(200, 150, 2));
    await settle();
    expect(screen.queryByLabelText("Text on the idea")).toBeNull();
  });

  it("opens an existing label for editing when Text is pressed on it", async () => {
    const onEditText = vi.fn();
    renderSheet({ initialTool: "text", folder: { ...empty, text_elements: [label()] }, onEditText });
    fireEvent.pointerDown(screen.getByRole("button", { name: "Buy milk" }), mouse(60, 60));
    await settle();
    const field = screen.getByLabelText("Text on the idea");
    fireEvent.change(field, { target: { value: "Buy oat milk" } });
    fireEvent.blur(field);
    expect(onEditText).toHaveBeenCalledWith("idea", "t1", { text: "Buy oat milk" });
  });
});

describe("a label on the canvas", () => {
  it("is carried by Move and written once, where it was let go", () => {
    const onEditText = vi.fn();
    renderSheet({ folder: { ...empty, text_elements: [label()] }, onEditText });
    const el = screen.getByRole("button", { name: "Buy milk" });
    fireEvent.pointerDown(el, mouse(60, 60));
    fireEvent.pointerMove(el, mouse(90, 80));
    fireEvent.pointerMove(el, mouse(110, 100));
    expect(onEditText).not.toHaveBeenCalled();
    fireEvent.pointerUp(el, mouse(110, 100));
    expect(onEditText).toHaveBeenCalledTimes(1);
    expect(onEditText).toHaveBeenCalledWith("idea", "t1", { x: 60, y: 50 });
  });

  it("takes a new width from its corner", () => {
    const onEditText = vi.fn();
    renderSheet({ folder: { ...empty, text_elements: [label({ width: 200 })] }, onEditText });
    const handle = document.querySelector<HTMLElement>(".canvas-text-resize")!;
    fireEvent.pointerDown(handle, mouse(200, 60));
    fireEvent.pointerMove(handle, mouse(280, 60));
    fireEvent.pointerUp(handle, mouse(280, 60));
    expect(onEditText).toHaveBeenCalledWith("idea", "t1", { width: 280 });
  });

  it("is deleted by the Delete key, and Undo sets it back", () => {
    const onRemoveText = vi.fn();
    const onChangeCanvas = vi.fn();
    const text = label();
    renderSheet({ folder: { ...empty, text_elements: [text] }, onRemoveText, onChangeCanvas });
    fireEvent.keyDown(screen.getByRole("button", { name: "Buy milk" }), { key: "Delete" });
    expect(onRemoveText).toHaveBeenCalledWith("idea", "t1");
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    const change = onChangeCanvas.mock.calls[0][1] as (c: Canvas) => Canvas;
    expect(change({ ...empty, text_elements: [] }).text_elements).toEqual([text]);
  });

  it("has a menu of its own: Edit text and Delete text", async () => {
    const onRemoveText = vi.fn();
    renderSheet({ folder: { ...empty, text_elements: [label()] }, onRemoveText });
    fireEvent.contextMenu(screen.getByRole("button", { name: "Buy milk" }), { clientX: 60, clientY: 60 });
    const menu = screen.getByRole("menu", { name: "Text menu" });
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Edit text" }));
    await settle();
    expect(screen.getByLabelText("Text on the idea")).toBeTruthy();
    fireEvent.keyDown(screen.getByLabelText("Text on the idea"), { key: "Escape" });

    fireEvent.contextMenu(screen.getByRole("button", { name: "Buy milk" }), { clientX: 60, clientY: 60 });
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete text" }));
    expect(onRemoveText).toHaveBeenCalledWith("idea", "t1");
  });
});

describe("pictures on the canvas", () => {
  const pic = attachment({ id: "p1", name: "photo.png", thumb: "data:image/jpeg;base64,xx" });

  it("draws each of the idea's own pictures where it was placed, and an unplaced one too", () => {
    const loose = attachment({ id: "p2", name: "loose.png" });
    renderSheet({
      idea: idea({ attachments: [pic, loose] }),
      folder: { ...empty, images: [{ attachment_id: "p1", x: 100, y: 40 }] },
    });
    const placed = screen.getByRole("img", { name: "Picture: photo.png" });
    expect(placed.style.left).toBe(`${50_000 + 100}px`);
    expect(placed.style.top).toBe(`${50_000 + 40}px`);
    expect(screen.getByRole("img", { name: "Picture: loose.png" })).toBeTruthy();
  });

  it("stands under the drawing, so strokes land on it", () => {
    renderSheet({ idea: idea({ attachments: [pic] }), folder: { ...empty, images: [{ attachment_id: "p1", x: 0, y: 0 }] } });
    const world = document.querySelector(".canvas-world")!;
    const order = Array.from(world.children).map((el) => el.getAttribute("class"));
    expect(order.indexOf("canvas-picture")).toBeLessThan(order.indexOf("canvas-svg"));
  });

  it("draws over a picture with the pen instead of picking it up", () => {
    const onAddStroke = vi.fn();
    const onMoveImage = vi.fn();
    renderSheet({
      initialTool: "draw",
      idea: idea({ attachments: [pic] }),
      folder: { ...empty, images: [{ attachment_id: "p1", x: 0, y: 0 }] },
      onAddStroke,
      onMoveImage,
    });
    surface();
    const el = screen.getByRole("img", { name: "Picture: photo.png" });
    fireEvent.pointerDown(el, mouse(60, 60));
    fireEvent.pointerMove(el, mouse(120, 90));
    fireEvent.pointerUp(el, mouse(120, 90));
    expect(onAddStroke).toHaveBeenCalledTimes(1);
    expect(onMoveImage).not.toHaveBeenCalled();
  });

  it("is moved by Move and written once", () => {
    const onMoveImage = vi.fn();
    renderSheet({
      idea: idea({ attachments: [pic] }),
      folder: { ...empty, images: [{ attachment_id: "p1", x: 0, y: 0 }] },
      onMoveImage,
    });
    const el = screen.getByRole("img", { name: "Picture: photo.png" });
    fireEvent.pointerDown(el, mouse(60, 60));
    fireEvent.pointerMove(el, mouse(100, 90));
    fireEvent.pointerUp(el, mouse(100, 90));
    expect(onMoveImage).toHaveBeenCalledTimes(1);
    expect(onMoveImage).toHaveBeenCalledWith("idea", "p1", 40, 30);
  });

  it("takes a pasted picture onto the canvas, and leaves the app's own paste alone", () => {
    const onAddImages = vi.fn();
    renderSheet({ onAddImages });
    surface();
    const file = new File(["x"], "shot.png", { type: "image/png" });
    const later = vi.fn((e: Event) => e.defaultPrevented);
    window.addEventListener("paste", later);
    fireEvent.paste(document.body, { clipboardData: { files: [file], types: ["Files"] } });
    window.removeEventListener("paste", later);
    expect(onAddImages).toHaveBeenCalledTimes(1);
    expect(onAddImages.mock.calls[0][0]).toBe("idea");
    expect(onAddImages.mock.calls[0][1]).toEqual([file]);
    // Stopped on the way down: the window's own handler never sees it.
    expect(later).not.toHaveBeenCalled();
  });

  it("lets a pasted file that is not a picture go on to the app", () => {
    const onAddImages = vi.fn();
    renderSheet({ onAddImages });
    const file = new File(["x"], "plan.pdf", { type: "application/pdf" });
    fireEvent.paste(document.body, { clipboardData: { files: [file], types: ["Files"] } });
    expect(onAddImages).not.toHaveBeenCalled();
  });

  it("keeps a picture pasted with words into a label from becoming a note behind the canvas", async () => {
    const onAddImages = vi.fn();
    renderSheet({ onAddImages, folder: { ...empty, text_elements: [label()] } });
    fireEvent.keyDown(screen.getByRole("button", { name: "Buy milk" }), { key: "Enter" });
    await settle();
    const field = screen.getByLabelText("Text on the idea");
    const later = vi.fn();
    window.addEventListener("paste", later);
    const file = new File(["x"], "shot.png", { type: "image/png" });
    fireEvent.paste(field, { clipboardData: { files: [file], types: ["Files", "text/plain"] } });
    window.removeEventListener("paste", later);
    expect(onAddImages).not.toHaveBeenCalled();
    expect(later).not.toHaveBeenCalled();
  });

  it("leaves a drop of a picture and another kind of file to the app, whole", () => {
    const onAddImages = vi.fn();
    renderSheet({ onAddImages });
    const files = [new File(["x"], "shot.png", { type: "image/png" }), new File(["x"], "plan.pdf", { type: "application/pdf" })];
    fireEvent.drop(surface(), { dataTransfer: { files, types: ["Files"] } });
    expect(onAddImages).not.toHaveBeenCalled();
  });

  it("stands a dropped picture where it was let go", () => {
    const onAddImages = vi.fn();
    renderSheet({ onAddImages });
    const file = new File(["x"], "shot.png", { type: "image/png" });
    // jsdom's drop event carries no pointer position, so it is given one.
    const el = surface();
    const drop = createEvent.drop(el, { dataTransfer: { files: [file], types: ["Files"] } });
    Object.defineProperties(drop, { clientX: { value: 400 }, clientY: { value: 300 } });
    fireEvent(el, drop);
    expect(onAddImages).toHaveBeenCalledTimes(1);
    const [x, y] = onAddImages.mock.calls[0][2];
    // The drop point is the middle of the picture's top part, in world units.
    expect(x).toBe(400 - 48 - 120);
    expect(y).toBe(300 - 48 - 80);
  });

  it("offers Add picture, which opens a picker for pictures only", () => {
    const onAddImages = vi.fn();
    renderSheet({ onAddImages });
    surface();
    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    expect(input.accept).toBe("image/*");
    const click = vi.spyOn(input, "click");
    fireEvent.click(screen.getByRole("button", { name: "Add picture" }));
    expect(click).toHaveBeenCalled();
    const file = new File(["x"], "shot.png", { type: "image/png" });
    fireEvent.change(input, { target: { files: [file] } });
    expect(onAddImages).toHaveBeenCalledWith("idea", [file], expect.any(Array));
  });

  it("asks before removing a picture, because its file is destroyed", () => {
    const onRemoveImage = vi.fn();
    renderSheet({
      idea: idea({ attachments: [pic] }),
      folder: { ...empty, images: [{ attachment_id: "p1", x: 0, y: 0 }] },
      onRemoveImage,
    });
    fireEvent.contextMenu(screen.getByRole("img", { name: "Picture: photo.png" }), { clientX: 60, clientY: 60 });
    fireEvent.click(screen.getByRole("menuitem", { name: "Remove picture" }));
    expect(onRemoveImage).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Remove picture" }));
    expect(onRemoveImage).toHaveBeenCalledWith("idea", "p1");
  });
});
