// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WallViewer } from "./WallViewer";
import { attachment, linkPreview, note } from "../test/fixtures";
import type { Note } from "../types";

vi.mock("../store/useFileUrl", () => ({ useFileUrl: () => ({ url: null }) }));
vi.mock("../store/attachments", () => ({ fetchFile: vi.fn() }));

afterEach(cleanup);

const photo = (id: string) =>
  note({ id, body: "", attachments: [attachment({ id: `a-${id}`, name: `${id}.png`, thumb: "data:image/jpeg;base64,xx" })] });
const words = (id: string) => note({ id, body: "only words" });
const pageWithPicture = (id: string) =>
  note({
    id,
    body: `https://example.com/${id}`,
    link_previews: [
      linkPreview({ href: `https://example.com/${id}`, title: `Page ${id}`, image: "data:image/jpeg;base64,yy", width: 480, height: 320 }),
    ],
  });

function viewer(notes: Note[], startId: string, extra: Partial<Parameters<typeof WallViewer>[0]> = {}) {
  const onClose = vi.fn();
  const onOpenNote = vi.fn();
  const result = render(
    <WallViewer
      notes={notes}
      startId={startId}
      origin={null}
      register={() => {}}
      onClose={onClose}
      onOpenNote={onOpenNote}
      {...extra}
    />,
  );
  return { ...result, onClose, onOpenNote };
}

describe("the wall's viewer", () => {
  it("walks only the tiles that have a picture, in board order, and says where it is", () => {
    viewer([photo("a"), words("w"), pageWithPicture("p"), photo("b")], "a");
    expect(screen.getByText("1 / 3")).toBeTruthy();
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(screen.getByText("2 / 3")).toBeTruthy();
    expect(screen.getByText("Page p")).toBeTruthy();
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(screen.getByText("3 / 3")).toBeTruthy();
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(screen.getByText("3 / 3")).toBeTruthy(); // the end of the board gives nowhere
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(screen.getByText("2 / 3")).toBeTruthy();
  });

  it("offers Open site for a link, and not for a file; Save for a file only", () => {
    viewer([pageWithPicture("p")], "p");
    const site = screen.getByRole("link", { name: /Open site/i }) as HTMLAnchorElement;
    expect(site.href).toBe("https://example.com/p");
    expect(site.target).toBe("_blank");
    expect(site.rel).toContain("noopener");
    expect(screen.queryByRole("button", { name: /^Save/i })).toBeNull();
    cleanup();
    viewer([photo("a")], "a");
    expect(screen.queryByRole("link", { name: /Open site/i })).toBeNull();
    expect(screen.getByRole("button", { name: /^Save/i })).toBeTruthy();
  });

  it("opens the note it came from", () => {
    const { onOpenNote } = viewer([photo("a"), photo("b")], "b");
    fireEvent.click(screen.getByRole("button", { name: "Open note" }));
    expect(onOpenNote).toHaveBeenCalledWith("b");
  });

  it("closes when the tile it is showing leaves the board — trashed, moved or archived — and never shows a stale one", () => {
    const board = [photo("a"), photo("b")];
    const { rerender, onClose } = viewer(board, "b");
    expect(screen.getByText("2 / 2")).toBeTruthy();
    rerender(
      <WallViewer notes={[board[0]]} startId="b" origin={null} register={() => {}} onClose={onClose} onOpenNote={() => {}} />,
    );
    expect(onClose).toHaveBeenCalled();
    expect(screen.queryByText("0 / 0")).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("stays on the same picture, with a true count, when a neighbour leaves", () => {
    const board = [photo("a"), photo("b"), photo("c")];
    const { rerender, onClose } = viewer(board, "c");
    rerender(
      <WallViewer notes={[board[1], board[2]]} startId="c" origin={null} register={() => {}} onClose={onClose} onOpenNote={() => {}} />,
    );
    expect(screen.getByText("2 / 2")).toBeTruthy();
    expect(screen.getByRole("dialog").getAttribute("aria-label")).toBe("c.png");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("keeps its place by the note, not by the number, when another picture arrives before it", () => {
    const board = [photo("a"), photo("b")];
    const { rerender } = viewer(board, "b");
    rerender(
      <WallViewer notes={[photo("new"), ...board]} startId="b" origin={null} register={() => {}} onClose={() => {}} onOpenNote={() => {}} />,
    );
    expect(screen.getByText("3 / 3")).toBeTruthy();
    expect(screen.getByRole("dialog").getAttribute("aria-label")).toBe("b.png");
  });

  it("closes at once on a board with no pictures rather than drawing nothing", () => {
    const { onClose } = viewer([words("w")], "w");
    expect(onClose).toHaveBeenCalled();
  });

  it("does not offer the walk when it is the board's only picture", () => {
    viewer([photo("a"), words("w")], "a");
    expect(screen.queryByText(/ \/ /)).toBeNull();
  });
});
