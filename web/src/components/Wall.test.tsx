// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { Suspense } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Wall } from "./Wall";
import { NoteCard, NO_TERMS } from "./NoteCard";
import { inReadingOrder } from "../lib/useGridKeyboard";
import { CARD_METRICS } from "../lib/face";
import { attachment, linkPreview, note } from "../test/fixtures";
import type { Note } from "../types";

vi.mock("../store/useFileUrl", () => ({ useFileUrl: () => ({ url: null }) }));

afterEach(cleanup);

const noop = () => {};

function card(n: Note, pos: number, over: { selecting?: boolean; selected?: boolean } = {}) {
  return (
    <NoteCard
      key={n.id}
      note={n}
      onOpen={noop}
      onLongPress={noop}
      onMergeDragStart={noop}
      onMergeDragMove={noop}
      onMergeDragEnd={noop}
      selecting={over.selecting ?? false}
      selected={over.selected ?? false}
      mergeDragging={false}
      mergeTarget={false}
      trace={false}
      metrics={CARD_METRICS}
      terms={NO_TERMS}
      wall
      pos={pos}
    />
  );
}

/**
 * The tile's interior is its own chunk (`WallTile`, reached by a dynamic import
 * so the wall costs the first paint nothing), so a render is not finished until
 * every card has been filled — which is waited for here, not guessed at.
 */
async function wallOf(notes: Note[], over: { selecting?: boolean; selected?: boolean } = {}) {
  const view = render(
    <Suspense fallback={null}>
      <Wall notes={notes} cards={notes.map((n, i) => card(n, i, over))} gridRef={noop} onFocus={noop} />
    </Suspense>,
  );
  await waitFor(() => {
    expect(view.container.querySelector(".wall")).toBeTruthy();
    expect(view.container.querySelectorAll(".card[data-id]:empty")).toHaveLength(0);
  });
  return view;
}

const pictured = (id: string, w: number, h: number) =>
  note({ id, body: "", attachments: [attachment({ id: `a-${id}`, name: `${id}.png`, width: w, height: h })] });

describe("the wall", () => {
  it("is one tile per note, each still a card button carrying its id and its place in board order", async () => {
    // a short, b tall: c goes under a, so the columns hold [a, c] and [b].
    const notes = [pictured("a", 100, 50), pictured("b", 100, 200), note({ id: "c", body: "just words" })];
    const { container } = await wallOf(notes);
    const cards = [...container.querySelectorAll<HTMLElement>(".card[data-id]")];
    expect(cards).toHaveLength(3);
    expect(cards.every((c) => c.tagName === "BUTTON" && c.dataset.wall === "true")).toBe(true);
    // The DOM is column by column, so it is not the order a person reads in …
    expect(cards.map((c) => c.dataset.id)).toEqual(["a", "c", "b"]);
    // … and the keyboard puts it back.
    expect(inReadingOrder(cards).map((c) => c.dataset.id)).toEqual(["a", "b", "c"]);
  });

  it("puts the first tiles at the top of their own columns and the next into the shortest", async () => {
    // jsdom has no width, so two columns: a tall one then two short ones.
    const notes = [pictured("tall", 100, 200), pictured("s1", 100, 50), pictured("s2", 100, 50), pictured("s3", 100, 50)];
    const { container } = await wallOf(notes);
    const cols = [...container.querySelectorAll(".wall-col")].map((col) =>
      [...col.querySelectorAll<HTMLElement>(".card[data-id]")].map((c) => c.dataset.id),
    );
    expect(cols).toEqual([["tall"], ["s1", "s2", "s3"]]);
  });

  it("draws a single tile and no tiles without throwing", async () => {
    await expect(wallOf([pictured("only", 100, 100)])).resolves.toBeTruthy();
    cleanup();
    const { container } = await wallOf([]);
    expect(container.querySelectorAll(".card")).toHaveLength(0);
    expect(container.querySelector(".wall")).toBeTruthy();
  });

  it("keeps every tile when there are fewer than columns", async () => {
    const { container } = await wallOf([pictured("only", 100, 100)]);
    expect(container.querySelectorAll(".wall-col")).toHaveLength(2);
    expect(container.querySelectorAll(".card[data-id]")).toHaveLength(1);
  });
});

describe("the keyboard's reading order", () => {
  it("is the DOM order wherever no tile says its place", () => {
    const a = document.createElement("button");
    const b = document.createElement("button");
    expect(inReadingOrder([b, a])).toEqual([b, a]);
  });

  it("is board position, however the columns nest the tiles", () => {
    const make = (pos: number) => {
      const el = document.createElement("button");
      el.dataset.pos = String(pos);
      return el;
    };
    const [p0, p1, p2, p3] = [make(0), make(1), make(2), make(3)];
    expect(inReadingOrder([p0, p2, p1, p3])).toEqual([p0, p1, p2, p3]);
  });
});

describe("a tile's face", () => {
  it("is the picture at its own shape, with the extra pictures counted in the machine voice", async () => {
    const n = note({
      id: "p",
      body: "",
      attachments: [
        attachment({ id: "1", width: 400, height: 200, thumb: "data:image/jpeg;base64,xx" }),
        attachment({ id: "2" }),
        attachment({ id: "3" }),
      ],
    });
    const { container } = await wallOf([n]);
    const pic = container.querySelector<HTMLElement>(".wall-pic")!;
    expect(pic.style.aspectRatio.replace(/\s/g, "")).toBe("1/0.5");
    expect(container.querySelector(".wall-img")?.getAttribute("src")).toBe("data:image/jpeg;base64,xx");
    expect(container.querySelector(".wall-more")?.textContent).toBe("+2");
  });

  it("does not collapse a picture whose size was never stored", async () => {
    const n = note({ id: "p", body: "", attachments: [attachment({ width: null, height: null })] });
    const { container } = await wallOf([n]);
    expect(container.querySelector<HTMLElement>(".wall-pic")!.style.aspectRatio.replace(/\s/g, "")).toBe("1/0.75");
  });

  it("is a link's picture with a play mark for a video and the site under it", async () => {
    const n = note({
      id: "l",
      body: "https://example.com/v",
      link_previews: [linkPreview({ href: "https://example.com/v", image: "data:image/jpeg;base64,yy", width: 480, height: 270, media: "video" })],
    });
    const { container } = await wallOf([n]);
    expect(container.querySelector(".wall-play")).toBeTruthy();
    expect(container.querySelector(".wall-site")?.textContent).toBe("example.com");
    expect(container.querySelector(".wall-img")?.getAttribute("src")).toBe("data:image/jpeg;base64,yy");
  });

  it("is a title card — the page's title and the site — for a link with no picture", async () => {
    const n = note({ id: "t", body: "https://example.com/r", link_previews: [linkPreview({ href: "https://example.com/r", title: "A recipe" })] });
    const { container } = await wallOf([n]);
    expect(container.querySelector(".wall-title-name")?.textContent).toBe("A recipe");
    expect(container.querySelector(".wall-site")?.textContent).toBe("example.com");
    expect(container.querySelector(".wall-pic")).toBeNull();
  });

  it("shows the path in the site line when the page's title is only the site", async () => {
    const n = note({
      id: "ts",
      body: "https://www.example.com/a/b?x=1",
      link_previews: [linkPreview({ href: "https://www.example.com/a/b?x=1", domain: "example.com", title: "WWW.Example.com/" })],
    });
    const { container } = await wallOf([n]);
    expect(container.querySelector(".wall-title-name")?.textContent).toBe("example.com");
    expect(container.querySelector(".wall-site")?.textContent).toBe("/a/b?x=1");
  });

  it("drops the site line, keeping the card's height, when the title is the site and there is no path", async () => {
    const n = note({
      id: "tn",
      body: "https://example.com/",
      link_previews: [linkPreview({ href: "https://example.com/", domain: "example.com", title: "example.com" })],
    });
    const { container } = await wallOf([n]);
    expect(container.querySelector(".wall-title-name")?.textContent).toBe("example.com");
    expect(container.querySelector(".wall-site")?.textContent ?? "").toBe("");
  });

  it("is a quote card for words alone, with no footer", async () => {
    const n = note({ id: "q", body: "a thought worth keeping" });
    const { container } = await wallOf([n]);
    expect(container.querySelector(".card[data-tile='quote']")?.textContent).toContain("a thought worth keeping");
    expect(container.querySelector(".card-foot")).toBeNull();
  });

  it("names a file the tile cannot draw, in the machine voice, when the note has no words", async () => {
    const n = note({
      id: "z",
      body: "",
      attachments: [
        attachment({ id: "z1", mime: "application/zip", name: "moodboard-refs.zip", thumb: null, width: undefined, height: undefined }),
        attachment({ id: "z2", mime: "audio/mpeg", name: "memo.mp3", thumb: null, width: undefined, height: undefined }),
      ],
    });
    const { container } = await wallOf([n]);
    const tile = container.querySelector<HTMLElement>(".card[data-tile='quote']")!;
    expect(tile.querySelector(".wall-file-name")?.textContent).toBe("moodboard-refs.zip");
    const kind = tile.querySelector<HTMLElement>(".wall-file-kind")!;
    expect(kind.textContent).toBe("ZIP +1");
    expect(kind.classList.contains("mono")).toBe(true);
  });

  it("draws no file line when the note has words, which name the tile themselves", async () => {
    const n = note({ id: "w", body: "words and a file", attachments: [attachment({ mime: "audio/mpeg", name: "memo.mp3", thumb: null })] });
    const { container } = await wallOf([n]);
    expect(container.querySelector(".wall-file")).toBeNull();
  });

  it("shows a list of tick boxes on a quote card rather than a blank one", async () => {
    const n = note({ id: "todo", body: "[ ] milk\n[x] bread" });
    const { container } = await wallOf([n]);
    const tile = container.querySelector(".card[data-tile='quote']")!;
    expect(tile.querySelectorAll(".check-item")).toHaveLength(2);
    expect(tile.textContent).toContain("milk");
  });

  it("shows the note's words as one muted line under a picture", async () => {
    const n = note({ id: "c", body: "late light\nsecond line", attachments: [attachment()] });
    const { container } = await wallOf([n]);
    expect(container.querySelector(".wall-caption")?.textContent).toBe("late light");
  });

  it("draws no attachment strip and no footer under a picture", async () => {
    const n = note({ id: "c", body: "late light", attachments: [attachment()] });
    const { container } = await wallOf([n]);
    expect(container.querySelector(".card-attachment-strip")).toBeNull();
    expect(container.querySelector(".card-foot")).toBeNull();
  });

  it("gives a quote card its whole six lines even when the note carries a file the tile does not draw", async () => {
    const n = note({ id: "f", body: "words beside a file", attachments: [attachment({ mime: "application/pdf", name: "a.pdf", thumb: null })] });
    const { container } = await wallOf([n]);
    const tile = container.querySelector<HTMLElement>(".card[data-tile='quote']")!;
    expect(tile).toBeTruthy();
    // the strip that the "has files" rule makes room for is not drawn on a tile
    expect(container.querySelector(".card-attachment-strip")).toBeNull();
    expect(tile.dataset.hasFiles).toBe("false");
  });

  it("is an inverted slab when picked, and the photograph in it is left as it is", async () => {
    const n = note({ id: "p", body: "late light", attachments: [attachment({ thumb: "data:image/jpeg;base64,xx" })] });
    const { container } = await wallOf([n], { selecting: true, selected: true });
    const tile = container.querySelector<HTMLElement>(".card[data-id]")!;
    // the stylesheet's selected rule keys on this attribute (styles.test.ts holds the colours)
    expect(tile.dataset.selected).toBe("true");
    expect(tile.querySelector(".wall-caption")).toBeTruthy();
    const img = container.querySelector<HTMLElement>(".wall-img")!;
    expect(img.getAttribute("src")).toBe("data:image/jpeg;base64,xx");
    expect(img.getAttribute("style")).toBeNull();
  });

  it("names the tile for a screen reader", async () => {
    await wallOf([pictured("named", 100, 100)]);
    expect(screen.getAllByRole("button")[0].getAttribute("aria-label")).toBeTruthy();
  });

  it("marks a tile it is picking with the machine voice's box, and only while picking", async () => {
    const { container } = await wallOf([note({ id: "q", body: "words" })], { selecting: true, selected: true });
    expect(container.querySelector(".wall-tick")?.textContent).toBe("[x]");
    cleanup();
    const idle = await wallOf([note({ id: "q", body: "words" })]);
    expect(idle.container.querySelector(".wall-tick")).toBeNull();
  });
});
