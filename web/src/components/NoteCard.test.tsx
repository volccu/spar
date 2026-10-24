// @vitest-environment jsdom
import { render, screen, act, cleanup, fireEvent } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { NoteCard } from "./NoteCard";
import { takeKeyOpen } from "../lib/keyOpen";
import { CARD_METRICS, type CardMetrics } from "../lib/face";
import { ringMark } from "../lib/when";
import type { Note } from "../types";

afterEach(cleanup);

function noteWrittenAgo(ms: number, body = "kanelipullat"): Note {
  const iso = new Date(Date.now() - ms).toISOString();
  return {
    id: "n1",
    raw_content: body,
    body,
    source: "web",
    created_at: iso,
    updated_at: iso,
    status: "active",
    priority: 0,
  } as unknown as Note;
}

function card(
  note: Note,
  metrics: CardMetrics = CARD_METRICS,
  selecting = false,
  online = true,
  inBoard = false,
  row = false,
  terms: string[] = [],
) {
  return render(
    <NoteCard
      terms={terms}
      note={note}
      onOpen={() => {}}
      onLongPress={() => {}}
      onMergeDragStart={() => {}}
      onMergeDragMove={() => {}}
      onMergeDragEnd={() => {}}
      selecting={selecting}
      selected={false}
      mergeDragging={false}
      mergeTarget={false}
      trace={false}
      metrics={metrics}
      online={online}
      inBoard={inBoard}
      row={row}
    />,
  );
}

/**
 * The whole prop list once, so a test about one handler can name that handler
 * and nothing else. `card()` above takes its arguments by position, which is
 * fine for the seven it was built around and useless for the eighth.
 */
function drawCard(over: Partial<ComponentProps<typeof NoteCard>>) {
  const props: ComponentProps<typeof NoteCard> = {
    note: noteWrittenAgo(0),
    onOpen: () => {},
    onLongPress: () => {},
    onMergeDragStart: () => {},
    onMergeDragMove: () => {},
    onMergeDragEnd: () => {},
    selecting: false,
    selected: false,
    mergeDragging: false,
    mergeTarget: false,
    trace: false,
    metrics: CARD_METRICS,
    ...over,
  };
  return render(<NoteCard {...props} />);
}

/**
 * The unit tests in when.test.ts prove the arithmetic. This proves the wiring:
 * that the shared clock reaches a card at all, and that a card left on screen
 * catches up on its own rather than sitting on a stamp that quietly went stale.
 */
describe("NoteCard stamp", () => {
  it("counts rather than dates a note from today", () => {
    card(noteWrittenAgo(3 * 60 * 60 * 1000));
    expect(screen.getByRole("button").textContent).toContain("3 hrs");
  });

  it("catches up while the card sits on screen", () => {
    vi.useFakeTimers();
    try {
      card(noteWrittenAgo(0));
       expect(screen.getByRole("button").textContent).toContain("Now");

      // Past the minute boundary: the clock beats, the snapshot changes, and
      // this card — and only this card — re-renders.
      act(() => {
        vi.advanceTimersByTime(61_000);
      });
       expect(screen.getByRole("button").textContent).toContain("1 min");
    } finally {
      vi.useRealTimers();
    }
  });

  it("sets a list on the card as a list, not as a paragraph", () => {
    const { container } = card(
      noteWrittenAgo(0, "Shopping\n1. milk\n2. bread\nafter"),
    );
    const items = container.querySelectorAll(".card-item");
    expect(items).toHaveLength(2);
    // The marker is in a column of its own, which is the whole point: it is
    // what puts "1." and "10." on the same left edge.
    expect(items[0].querySelector(".card-mark")?.textContent).toBe("1. ");
    expect(items[0].querySelector(".card-mark")?.getAttribute("data-num")).toBe(
      "true",
    );
    // …and the card still says exactly what the note says.
    expect(container.querySelector(".card-body")?.textContent).toBe(
      "Shopping1. milk2. breadafter",
    );
  });

  it("shares inline marks and code blocks without nesting links", () => {
    const { container } = card(
      noteWrittenAgo(0, "# **Heading**\ntext\n```ts\nconst value = 1\n```"),
    );

    expect(container.querySelector('.card-body .em[data-strong="true"]')).toBeTruthy();
    expect(container.querySelector('.card-body .card-line[data-code="true"]')).toBeTruthy();
    expect(container.querySelector(".card-code-fence")).toBeTruthy();
    expect(container.querySelector(".card-body a")).toBeNull();
  });

  it("leaves an old note on the calendar, and never re-renders it", () => {
    card(noteWrittenAgo(400 * 24 * 60 * 60 * 1000));
    expect(screen.getByRole("button").textContent).toMatch(/[A-Z][a-z]{2} ’\d\d/);
  });
});

/** What the note carries, said in the row that already carries machine data. */
describe("the footer marks", () => {
  const tight: CardMetrics = { lines: 2, charsPerLine: 40 };

  it("says there is a tick box the face had no room to draw", () => {
    const { container } = card(
      noteWrittenAgo(0, `${"word ".repeat(80)}\n[ ] renew the passport`),
      tight,
    );
    // The characters a box is, and how far through the boxes the note is.
    expect(container.querySelector(".card-boxes")?.textContent).toBe("[ ]0/1");
  });

  it("does not draw the box twice on a card that is already the list", () => {
    const { container } = card(noteWrittenAgo(0, "[ ] milk\n[x] eggs"), tight);
    expect(container.querySelector(".card-boxes")).toBeNull();
  });

  it("gives the bare count when the face already draws the boxes (UX-008)", () => {
    // A titled list is the text face, and its boxes are in view: a `[ ]` in
    // the footer would be the footer repeating the face.
    const { container } = card(
      noteWrittenAgo(0, "Packing:\n[ ] socks\n[x] shirts\nand the charger"),
      { lines: 8, charsPerLine: 40 },
    );
    expect(container.querySelector(".card-boxes")).toBeNull();
    expect(container.querySelector(".card-progress")?.textContent).toBe("1/2");
  });

  it("says how far through the list is, on the list's own card too", () => {
    const { container } = card(
      noteWrittenAgo(0, "[x] milk\n[ ] eggs\n☑ jam\n– [ ] bread\n[X] tea"),
      tight,
    );
    // The face draws the first items; the footer counts all of them.
    const progress = container.querySelector(".card-progress");
    expect(progress?.textContent).toBe("3/5");
    expect(progress?.getAttribute("title")).toBe("3 of 5 ticked");
    // In the marks box, so the stamp is never what gives way to it.
    expect(progress?.closest(".card-marks")).toBeTruthy();
  });

  it("counts the boxes under the cut on a card that shows prose", () => {
    const { container } = card(
      noteWrittenAgo(0, `${"word ".repeat(80)}\n[x] passport\n[ ] visa\n[ ] tickets`),
      tight,
    );
    expect(container.querySelector(".card-boxes")?.textContent).toBe("[ ]1/3");
  });

  it("says there is code in the note", () => {
    const { container } = card(
      noteWrittenAgo(0, "to rebuild:\n```sh\nnpm run build\n```"),
      tight,
    );
    // The mark is a glyph, so it is the icon that has to be there, not text.
    expect(container.querySelectorAll(".card-foot .icon-data").length).toBeGreaterThan(
      0,
    );
  });

  it("marks nothing on a note that is only words", () => {
    const { container } = card(noteWrittenAgo(0, "kanelipullat"), tight);
    expect(container.querySelector(".card-boxes")).toBeNull();
  });
});

describe("idea cards", () => {
  it("marks a composed note as an idea and counts its sources", () => {
    const idea = {
      ...noteWrittenAgo(0, "one place for related notes"),
      source: "merge",
      merged_from: ["n1", "n2", "n3"],
    } as Note;
    const { container } = card(idea);

    expect(container.querySelector(".card")?.dataset.idea).toBe("true");
    expect(screen.getByRole("button").getAttribute("aria-label")).toMatch(/^Idea:/);
    expect(container.querySelector(".idea-mark")?.textContent).toContain("3");
  });

  /**
   * The snapshot is the card's face, and it fits the card. Resting on one used
   * to grow it, because the note's own text is long enough to be cut — a face
   * the card is not wearing was deciding what the pointer did.
   */
  it("never grows under a resting pointer", () => {
    vi.useFakeTimers();
    const idea = {
      ...noteWrittenAgo(0, "a".repeat(4000)),
      source: "merge",
      merged_from: ["n2", "n3"],
    } as Note;
    const { container } = render(
      <NoteCard
        note={idea}
        onOpen={() => {}}
        onLongPress={() => {}}
        onMergeDragStart={() => {}}
        onMergeDragMove={() => {}}
        onMergeDragEnd={() => {}}
        selecting={false}
        selected={false}
        mergeDragging={false}
        mergeTarget={false}
        trace={false}
        metrics={CARD_METRICS}
        snapshot={{ shapes: [], strokes: [], labels: [] }}
      />,
    );

    const el = container.querySelector<HTMLElement>(".card")!;
    fireEvent.pointerEnter(el, { pointerType: "mouse" });
    act(() => void vi.advanceTimersByTime(1000));

    expect(el.dataset.peek).toBe("false");
    vi.useRealTimers();
  });

  it("draws the canvas rather than the merged text", () => {
    const idea = {
      ...noteWrittenAgo(0, "one place for related notes"),
      source: "merge",
      merged_from: ["n2"],
    } as Note;
    const { container } = render(
      <NoteCard
        note={idea}
        onOpen={() => {}}
        onLongPress={() => {}}
        onMergeDragStart={() => {}}
        onMergeDragMove={() => {}}
        onMergeDragEnd={() => {}}
        selecting={false}
        selected={false}
        mergeDragging={false}
        mergeTarget={false}
        trace={false}
        metrics={CARD_METRICS}
        snapshot={{
          shapes: [
            { id: "n2", x: 0, y: 0, w: 260, h: 206, lines: [1, 0.4, 0], image: null, priority: true },
          ],
          strokes: [],
          labels: [],
        }}
      />,
    );

    expect(container.querySelector(".idea-snapshot")).toBeTruthy();
    expect(container.querySelector(".card-body")).toBeNull();
    // A blank line costs a line box and draws no rule.
    expect(container.querySelectorAll(".idea-snapshot-line")).toHaveLength(2);
    expect(container.querySelector(".idea-snapshot-priority")).toBeTruthy();
  });

  /**
   * The one card in the app that carries a header row of words, and the one
   * card that shows none of the note's own. A shelf of unnamed ideas is a
   * shelf of grey miniatures you have to open to tell apart.
   */
  function ideaCard(body: string) {
    const idea = {
      ...noteWrittenAgo(0, body),
      source: "merge",
      merged_from: ["n2"],
    } as Note;
    return render(
      <NoteCard
        note={idea}
        onOpen={() => {}}
        onLongPress={() => {}}
        onMergeDragStart={() => {}}
        onMergeDragMove={() => {}}
        onMergeDragEnd={() => {}}
        selecting={false}
        selected={false}
        mergeDragging={false}
        mergeTarget={false}
        trace={false}
        metrics={CARD_METRICS}
        snapshot={{ shapes: [], strokes: [], labels: [] }}
      />,
    );
  }

  it("draws the name the user gave the idea", () => {
    const { container } = ideaCard("# Kitchen rebuild\n\none place for related notes");
    expect(container.querySelector(".card-idea-name")?.textContent).toBe("Kitchen rebuild");
    // And announces it, rather than sixty characters of a composition the card
    // is not showing.
    expect(container.querySelector(".card")?.getAttribute("aria-label")).toContain(
      "Idea: Kitchen rebuild",
    );
  });

  it("draws no row at all for an idea nobody has named", () => {
    // A row reading "Idea" over a picture of an idea is a label, and cards
    // carry no labels.
    const { container } = ideaCard("one place for related notes");
    expect(container.querySelector(".card-idea-name")).toBeNull();
  });

  /**
   * A plain note is named the same way an idea is, and says it in the same
   * voice — but on its own first line, in the slot that line already had, so
   * the card is exactly as tall as it was and the cut lands where it did.
   */
  function plainCard(body: string) {
    return render(
      <NoteCard
        note={noteWrittenAgo(0, body)}
        onOpen={() => {}}
        onLongPress={() => {}}
        onMergeDragStart={() => {}}
        onMergeDragMove={() => {}}
        onMergeDragEnd={() => {}}
        selecting={false}
        selected={false}
        mergeDragging={false}
        mergeTarget={false}
        trace={false}
        metrics={CARD_METRICS}
      />,
    );
  }

  it("draws a plain note's name in the idea's voice, on the line it already had", () => {
    const { container } = plainCard("# Kitchen rebuild\n\nmeasure the wall");
    const first = container.querySelector(".card-body .card-line");
    expect(first?.getAttribute("data-name")).toBe("true");
    expect(first?.textContent).toBe("Kitchen rebuild");
    // No row of its own: that is the idea card's, which shows none of its words.
    expect(container.querySelector(".card-idea-name")).toBeNull();
    expect(container.querySelector(".card")?.getAttribute("aria-label")).toContain(
      "Kitchen rebuild",
    );
  });

  it("does not name a note by a heading further down, or by a ## line", () => {
    for (const body of ["measure the wall\n# Later", "## Ingredients\n\nflour"]) {
      const { container, unmount } = plainCard(body);
      expect(container.querySelector('.card-line[data-name="true"]')).toBeNull();
      unmount();
    }
  });
});

/**
 * Filed is styling only — the caller (App.tsx) decides when it applies (the
 * All board, search and Archive, the three places where standing on the board
 * does not already answer where a note lives); the card just draws whatever it
 * is handed, the same way it already draws `data-archived`.
 */
describe("a note already filed in a folder, seen from All", () => {
  it("carries the mark only when the caller says so", () => {
    const { container: plain } = card(noteWrittenAgo(0), CARD_METRICS, false, true, false);
    expect(plain.querySelector(".card")?.getAttribute("data-filed")).toBe("false");

    const { container: inBoard } = card(noteWrittenAgo(0), CARD_METRICS, false, true, true);
    expect(inBoard.querySelector(".card")?.getAttribute("data-filed")).toBe("true");
  });

  it("never touches the priority mark", () => {
    const note = { ...noteWrittenAgo(0), priority: 1 } as Note;
    const { container } = card(note, CARD_METRICS, false, true, true);
    expect(container.querySelector(".card")?.getAttribute("data-priority")).toBe("1");
  });
});

/**
 * The Links board draws a full-width row per note instead of a card in the
 * grid, because a link's picture, title, domain and the user's own words did
 * not fit in a ~160px phone column. The row is still one card element per note
 * — everything that counts elements (multi-select, the merge drag, the grid
 * reflow, the keyboard walk) depends on that and must go on being true.
 */
describe("a link on the Links board", () => {
  const link = noteWrittenAgo(0, "Saved link: worth a read\nhttps://example.com/a");

  it("draws the ordinary card face everywhere else", () => {
    const { container } = card(link, CARD_METRICS, false, true, false, false);
    expect(container.querySelector(".card")?.getAttribute("data-row")).toBe("false");
    expect(container.querySelector(".card-row-face")).toBeNull();
    expect(container.querySelector(".card-body")).toBeTruthy();
    expect(container.querySelector(".card-link-previews")).toBeTruthy();
  });

  it("draws a row with a name, the note's words, and the site in the footer", () => {
    const { container } = card(link, CARD_METRICS, false, true, false, true);
    expect(container.querySelector(".card")?.getAttribute("data-row")).toBe("true");
    expect(container.querySelector(".card-row-face")).toBeTruthy();
    expect(container.querySelector(".card-row-title")?.textContent).toBe("worth a read");
    // The site is in the footer, with the rest of the machine data — never on
    // a line box of its own between the name and the words.
    expect(container.querySelector(".card-foot .card-row-domain")?.textContent).toBe(
      "example.com",
    );
    // A page with no stored picture still gets its square, holding the link
    // mark, and nothing is fetched for it.
    expect(container.querySelector(".card-row-pic svg")).toBeTruthy();
    expect(container.querySelector(".card-row-shot")).toBeNull();
    expect(container.querySelector(".link-preview-thumb")).toBeNull();
    // The stacked card-sized preview is not drawn twice.
    expect(container.querySelector(".card-link-previews")).toBeNull();
  });

  /** Owner picked mockup C (2026-10-17): a row wears the picture the unfurl stored. */
  it("wears the page's stored picture, unless that preview was hidden", () => {
    const image = "data:image/jpeg;base64,AAAA";
    const saved = (hidden?: boolean): Note => ({
      ...link,
      link_previews: [
        {
          href: "https://example.com/a",
          domain: "example.com",
          title: "worth a read",
          description: null,
          image,
          fetched_at: "2026-09-20T00:00:00.000Z",
          ...(hidden ? { hidden: true } : {}),
        },
      ],
    });
    const shown = card(saved(), CARD_METRICS, false, true, false, true);
    expect(shown.container.querySelector(".card-row-shot")?.getAttribute("src")).toBe(image);
    shown.unmount();
    const put = card(saved(true), CARD_METRICS, false, true, false, true);
    expect(put.container.querySelector(".card-row-shot")).toBeNull();
    expect(put.container.querySelector(".card-row-pic svg")).toBeTruthy();
  });

  /**
   * A page that answered 404 or 410 says "gone" in the footer, beside the link
   * mark on a card and beside the site on a row — a word, since it is a thing
   * that failed, and never a change to anything the note says.
   */
  it("says a dead link is gone, on the card and on the row, in words", () => {
    const dead: Note = {
      ...link,
      link_previews: [
        {
          href: "https://example.com/a",
          domain: "example.com",
          title: "worth a read",
          description: null,
          image: null,
          fetched_at: "2026-09-20T00:00:00.000Z",
          gone: true,
        },
      ],
    };
    for (const row of [false, true]) {
      const { container, unmount } = card(dead, CARD_METRICS, false, true, false, row);
      expect(container.querySelector(".card-foot .card-sync-word")?.textContent).toBe("gone");
      // The card's own preview does not say it a second time.
      expect(container.querySelector(".link-preview-gone")).toBeNull();
      unmount();
    }
    const { container } = card(link, CARD_METRICS, false, true, false, true);
    expect(container.querySelector(".card-sync-word")).toBeNull();
  });

  it("counts the dead ones on a note of several links", () => {
    const body = "one https://a.example/1\ntwo https://a.example/2\nthree https://a.example/3";
    const base = { domain: "a.example", title: "t", description: null, image: null, fetched_at: "2026-09-20T00:00:00.000Z" };
    const several: Note = {
      ...noteWrittenAgo(0, body),
      link_previews: [
        { ...base, href: "https://a.example/1", gone: true },
        { ...base, href: "https://a.example/2" },
        { ...base, href: "https://a.example/3", gone: true },
        // Edited out of the text: kept in the row, never drawn, never counted.
        { ...base, href: "https://a.example/old", gone: true },
      ],
    };
    const { container } = card(several);
    expect(container.querySelector(".card-foot .card-sync-word")?.textContent).toBe("2 gone");
  });

  it("draws no strip line for a preview the owner put away, and a lone survivor gets the box", () => {
    const body = "one https://a.example/1\ntwo https://a.example/2\nthree https://a.example/3";
    const base = { domain: "a.example", title: "t", description: null, image: null, fetched_at: "2026-09-20T00:00:00.000Z" };
    const entries = (hidden: string[]) =>
      [1, 2, 3].map((n) => ({
        ...base,
        href: `https://a.example/${n}`,
        ...(hidden.includes(`https://a.example/${n}`) ? { hidden: true } : {}),
      }));
    const some = { ...noteWrittenAgo(0, body), link_previews: entries(["https://a.example/2"]) };
    const { container, unmount } = card(some);
    expect(container.querySelectorAll(".card-link-line")).toHaveLength(2);
    unmount();
    const one = {
      ...noteWrittenAgo(0, body),
      link_previews: entries(["https://a.example/1", "https://a.example/2"]),
    };
    const lone = card(one);
    expect(lone.container.querySelectorAll(".card-link-line")).toHaveLength(0);
    expect(lone.container.querySelectorAll(".card-link-previews .link-preview")).toHaveLength(1);
    lone.unmount();
    // A hidden link's "gone" is not counted in the footer either.
    const dead = {
      ...noteWrittenAgo(0, body),
      link_previews: entries(["https://a.example/1"]).map((e) =>
        e.href === "https://a.example/1" ? { ...e, gone: true } : e,
      ),
    };
    const { container: footed } = card(dead);
    expect(footed.querySelector(".card-foot .card-sync-word")).toBeNull();
  });

  it("gives the note's own words back — the whole point of the row", () => {
    const words = noteWrittenAgo(
      0,
      "Saved link: worth a read\nhttps://example.com/a\nread this before Friday",
    );
    const { container } = card(words, CARD_METRICS, false, true, false, true);
    // The words are there…
    expect(container.querySelector(".card-body")?.textContent).toContain(
      "read this before Friday",
    );
    // …and the line the title already says is not said a second time under it.
    expect(container.querySelector(".card-body")?.textContent).not.toContain(
      "worth a read",
    );
  });

  it("draws no words at all when the title is all the note says", () => {
    // A local unfurl's title *is* the note's first line, so the ordinary
    // "Saved link: …" note would otherwise print the same sentence twice.
    const { container } = card(link, CARD_METRICS, false, true, false, true);
    expect(container.querySelector(".card-row-title")?.textContent).toBe("worth a read");
    expect(container.querySelector(".card-body")).toBeNull();
  });

  it("never opens the words mid-word when the title was cut short", () => {
    // Long enough that `previewsFor` cuts the title at 87 and ellipsises it,
    // with the cut landing inside "talking". Taking exactly 87 characters off
    // the body then opened the row on "ng about…" (audit F7).
    const first =
      "Saved link: A note about picking an online store platform (like Shopify) for the shop we keep " +
      "talking about";
    // The precondition the test rests on: the cut is mid-word.
    const cutAt = 87 + "Saved link: ".length;
    expect(first[cutAt - 1]).toMatch(/\S/);
    expect(first[cutAt]).toMatch(/\S/);
    const long = noteWrittenAgo(0, `${first}
https://example.com/a
remember to compare fees`);
    // A row's measure, not a card's: `face.body` is already cut to the width
    // it is drawn at, and on a card's narrow measure the cut lands before the
    // title ends, so there is nothing to de-duplicate. A row is wider.
    const { container } = card(long, { ...CARD_METRICS, charsPerLine: 160 }, false, true, false, true);
    const body = container.querySelector(".card-body")?.textContent ?? "";
    expect(body).toContain("remember to compare fees");
    // The row's words start on a whole word — the tail of the cut one is not
    // the first thing on the row.
    expect(body).not.toMatch(/^ng\b/);
    expect(body.startsWith("about")).toBe(true);
  });

  it("stays one element per note, still a button that can be held", () => {
    const { container } = card(link, CARD_METRICS, false, true, false, true);
    expect(container.querySelectorAll(".card[data-id]")).toHaveLength(1);
    expect(container.querySelector(".card")?.tagName).toBe("BUTTON");
    expect(container.querySelector(".card-foot")).toBeTruthy();
  });

  it("counts the addresses rather than growing to hold them", () => {
    const many = noteWrittenAgo(
      0,
      "Reading list\nhttps://example.com/a\nhttps://example.org/b\nhttps://example.net/c",
    );
    const { container } = card(many, CARD_METRICS, false, true, false, true);
    expect(container.querySelectorAll(".card-row-face")).toHaveLength(1);
    // Said by the footer's own link mark, which has always counted exactly
    // this — a row never grows to hold a second address.
    expect(container.querySelector(".card-foot .card-link .link-n")?.textContent).toBe("3");
  });

  it("names a bare address once, not twice", () => {
    // Nothing written in front of the address, so the name has to be the site
    // itself — and the footer then says the path, which is the only part of the
    // address the name is not already showing. Every row opens with a name;
    // none of them prints one word in both halves.
    const bare = noteWrittenAgo(0, "https://example.com/a\nread later");
    const { container } = card(bare, CARD_METRICS, false, true, false, true);
    expect(container.querySelector(".card-row-title")?.textContent).toBe("example.com");
    expect(container.querySelector(".card-foot .card-row-domain")?.textContent).toBe("/a");
    expect(container.querySelector(".card-body")?.textContent).toBe("read later");
  });

  it("says nothing in the footer for an address that is only a host", () => {
    const host = noteWrittenAgo(0, "https://example.com/");
    const { container } = card(host, CARD_METRICS, false, true, false, true);
    expect(container.querySelector(".card-row-title")?.textContent).toBe("example.com");
    expect(container.querySelector(".card-foot .card-row-domain")).toBeNull();
  });

  /**
   * The order the row picks a name in, and why it is this way round. A stored
   * `og:title` winning outright puts two notes saved from claude.ai on screen
   * both called "Claude Artifact", with the words that tell them apart under
   * the name in the half that gets cut.
   */
  it("names the row by the user's own words before the page's title", () => {
    const withTitle = {
      ...noteWrittenAgo(0, "plan the meeting https://example.com/a"),
      link_previews: [
        {
          href: "https://example.com/a",
          domain: "example.com",
          title: "Example — the generic title every page here has",
          description: null,
          image: null,
          fetched_at: "2026-09-01T00:00:00.000Z",
        },
      ],
    } as unknown as Note;
    const { container } = card(withTitle, CARD_METRICS, false, true, false, true);
    expect(container.querySelector(".card-row-title")?.textContent).toBe("plan the meeting");
  });

  it("takes the page's title when the user wrote nothing of their own", () => {
    const bare = {
      ...noteWrittenAgo(0, "https://example.com/a"),
      link_previews: [
        {
          href: "https://example.com/a",
          domain: "example.com",
          title: "GitHub - terkelg/awesome",
          description: null,
          image: null,
          fetched_at: "2026-09-01T00:00:00.000Z",
        },
      ],
    } as unknown as Note;
    const { container } = card(bare, CARD_METRICS, false, true, false, true);
    expect(container.querySelector(".card-row-title")?.textContent).toBe(
      "GitHub - terkelg/awesome",
    );
  });

  it("refuses a title that is only the site saying its own name", () => {
    // An og:title of "www.example.com" over a footer reading "example.com" is
    // the one word on screen twice.
    const junk = {
      ...noteWrittenAgo(0, "https://www.example.com/watch"),
      link_previews: [
        {
          href: "https://www.example.com/watch",
          domain: "example.com",
          title: "www.example.com",
          description: null,
          image: null,
          fetched_at: "2026-09-01T00:00:00.000Z",
        },
      ],
    } as unknown as Note;
    const { container } = card(junk, CARD_METRICS, false, true, false, true);
    expect(container.querySelector(".card-row-title")?.textContent).toBe("example.com");
    expect(container.querySelector(".card-foot .card-row-domain")?.textContent).toBe("/watch");
  });

  it("draws the note's markup as words, never as characters", () => {
    // `## Plan meeting` reached the name with its hashes on, and on one line
    // the hashes are most of what there is room for.
    const marked = noteWrittenAgo(0, "## Plan meeting\nhttps://example.com/a\nbring the notes");
    const { container } = card(marked, CARD_METRICS, false, true, false, true);
    expect(container.querySelector(".card-row-title")?.textContent).toBe("Plan meeting");
    expect(container.querySelector(".card-body")?.textContent).toContain("bring the notes");
  });

  it("draws no row for a note with no address in it at all", () => {
    // Nothing without a link reaches the Links board, but the row falls back
    // to the ordinary faces rather than trusting that from inside the card.
    const { container } = card(noteWrittenAgo(0), CARD_METRICS, false, true, false, true);
    expect(container.querySelector(".card")?.getAttribute("data-row")).toBe("false");
    expect(container.querySelector(".card-body")).toBeTruthy();
  });
});

/**
 * Priority is a flag, and on a card it stands at the head of the footer row —
 * the one row that already carries marks about the note. It was a 9px square
 * flush in the card's top-left corner for years, which was right for a shape
 * at furniture scale and wrong for a glyph: a glyph there floats over the
 * first line, the exact failure the square was flush in the corner to avoid.
 */
describe("the priority flag on a card", () => {
  it("is not drawn at all when priority is off", () => {
    const { container } = card(noteWrittenAgo(0));
    expect(container.querySelector(".card-priority")).toBeNull();
  });

  it("leads the footer row when priority is on", () => {
    const note = { ...noteWrittenAgo(0), priority: 1 } as Note;
    const { container } = card(note);
    const flag = container.querySelector(".card-priority");
    expect(flag).toBeTruthy();
    // Ahead of what the note merely contains: it is the only thing in the row
    // that is a decision somebody made. The marks now sit in a box of their own
    // so the stamp cannot be clipped out of the row behind them, so "leads the
    // row" is a claim about the marks box rather than about the footer.
    const foot = container.querySelector(".card-foot");
    expect(foot?.firstElementChild).toBe(container.querySelector(".card-marks"));
    expect(container.querySelector(".card-marks")?.firstElementChild).toBe(flag);
  });

  /**
   * The stamp is the only ordering cue a card carries now that the board draws
   * no period rules, and the footer is a fixed band with an unbounded number of
   * marks competing for it. So the row holds exactly two children — every mark
   * in one box, then the stamp — and it is the box that runs out of room.
   */
  it("keeps the row to the marks and the stamp, in that order", () => {
    const note = { ...noteWrittenAgo(0), priority: 1 } as Note;
    const { container } = card(note);
    const foot = container.querySelector(".card-foot");
    const kids = [...(foot?.children ?? [])].map((el) => el.className);
    expect(kids).toEqual(["card-marks", "card-time"]);
  });
});

/**
 * The other decision a card's footer reports, beside the flag and drawn the
 * same way: that somebody marked this note as a to-do.
 *
 * It reads `note_type` and deliberately not `isTodoNote`. The wider predicate
 * — the one the shelf's Todos board and the open note's toggle both ask —
 * also says yes to a note whose every line is a tick box, and such a card is
 * already drawing those boxes at full size. Marking it again in the footer
 * would be the row repeating the face, which is the rule that already
 * suppresses the tick-box mark on a checklist.
 */
describe("the to-do mark on a card", () => {
  it("is not drawn on a note nobody has marked", () => {
    const { container } = card(noteWrittenAgo(0));
    expect(container.querySelector(".card-todo")).toBeNull();
  });

  it("stands beside the flag once the note is marked as a to-do", () => {
    const note = { ...noteWrittenAgo(0), note_type: "todo" } as Note;
    const { container } = card(note);
    expect(container.querySelector(".card-todo")).toBeTruthy();
  });

  it("is not drawn on a checklist, which is already showing its own boxes", () => {
    // `note_type: null` and every line a box — a to-do by the shelf's reading
    // and not by this one, on purpose.
    const note = { ...noteWrittenAgo(0), body: "[ ] milk\n[ ] eggs" } as Note;
    const { container } = card(note);
    expect(container.querySelector(".card-todo")).toBeNull();
  });

  it("stands down on the Todos board, which already says it of every card", () => {
    // Review UI-11: the same reason the folder mark stands down on its folder.
    const note = { ...noteWrittenAgo(0), note_type: "todo" } as Note;
    const { container } = drawCard({ note, onTodos: true });
    expect(container.querySelector(".card-todo")).toBeNull();
  });

  it("follows the flag, and both lead the marks", () => {
    const note = { ...noteWrittenAgo(0), priority: 1, note_type: "todo" } as Note;
    const { container } = card(note);
    const marks = [...(container.querySelector(".card-marks")?.children ?? [])].map(
      (el) => el.className,
    );
    expect(marks.slice(0, 2)).toEqual(["card-priority", "card-todo"]);
  });
});

/** A plain-language mention of the priority mark, for a screen reader that
 *  never sees the flag drawn in the footer. */
describe("priority in the accessible name", () => {
  it("says nothing extra when priority is off", () => {
    card(noteWrittenAgo(0));
    expect(screen.getByRole("button").getAttribute("aria-label")).not.toContain("priority");
  });

  it("mentions it plainly when priority is on", () => {
    const note = { ...noteWrittenAgo(0), priority: 1 } as Note;
    card(note);
    expect(screen.getByRole("button").getAttribute("aria-label")).toContain("marked important");
  });
});

/** The trash gives no other warning of its own on the board — see lib/trash.ts. */
describe("the trash countdown mark", () => {
  function trashedDaysAgo(days: number): Note {
    const iso = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    return {
      ...noteWrittenAgo(0),
      status: "trashed",
      updated_at: iso,
    } as Note;
  }

  it("says nothing for a note freshly trashed", () => {
    const { container } = card(trashedDaysAgo(0));
    expect(container.querySelector(".card-sync-word")).toBeNull();
  });

  it("says the days left once, in the stamp, even when the sweep is close", () => {
    const { container } = card(trashedDaysAgo(28));
    expect(container.querySelector(".card-sync-word")).toBeNull();
    expect(container.querySelector(".card-time")?.textContent).toBe("2d");
    expect(container.textContent).not.toContain("left");
    cleanup();
    const last = card(trashedDaysAgo(30));
    expect(last.container.querySelector(".card-sync-word")).toBeNull();
    expect(last.container.querySelector(".card-time")?.textContent).toBe("today");
  });

  it("never appears on a note that is not in the trash", () => {
    const { container } = card(noteWrittenAgo(0));
    expect(container.querySelector(".card-sync-word")).toBeNull();
  });

  it("puts the days left in the stamp, not the age of the last edit", () => {
    expect(card(trashedDaysAgo(1)).container.querySelector(".card-time")?.textContent).toBe("29d");
    cleanup();
    expect(card(trashedDaysAgo(10)).container.querySelector(".card-time")?.textContent).toBe("20d");
    cleanup();
    expect(card(trashedDaysAgo(30)).container.querySelector(".card-time")?.textContent).toBe("today");
    cleanup();
    // And a note that is not in the trash keeps counting its age.
    expect(card(noteWrittenAgo(0)).container.querySelector(".card-time")?.textContent).toBe("Now");
  });
});

/** A reminder only earns a mark once it is close — see REMINDER_SOON_MS. */
describe("the reminder mark", () => {
  function withReminder(msFromNow: number): Note {
    return {
      ...noteWrittenAgo(0),
      reminder_at: new Date(Date.now() + msFromNow).toISOString(),
    } as Note;
  }

  it("says nothing about a note with no reminder", () => {
    const { container } = card(noteWrittenAgo(0));
    expect(container.querySelector('[title="Reminder due soon"]')).toBeNull();
  });

  it("marks a reminder due within a day", () => {
    const { container } = card(withReminder(6 * 60 * 60 * 1000));
    expect(container.querySelector('[title="Reminder due soon"]')).toBeTruthy();
  });

  it("says nothing about a reminder still well ahead", () => {
    const { container } = card(withReminder(20 * 24 * 60 * 60 * 1000));
    expect(container.querySelector('[title="Reminder due soon"]')).toBeNull();
  });

  it("keeps marking a reminder that has passed and not been cleared", () => {
    const { container } = card(withReminder(-3 * 60 * 60 * 1000));
    expect(container.querySelector('[title="This reminder has passed"]')).toBeTruthy();
  });

  /** Review UX-06: on the Reminders list the slot says when, not how old. */
  it("says when it rings on the Reminders list, however far ahead", () => {
    const note = { ...noteWrittenAgo(2 * 24 * 60 * 60 * 1000), reminder_at: withReminder(20 * 24 * 60 * 60 * 1000).reminder_at } as Note;
    const { container } = drawCard({ note, reminders: true });
    expect(container.querySelector('[title="Reminder set"]')).toBeTruthy();
    const time = container.querySelector(".card-time")?.textContent;
    expect(time).toBe(ringMark(Date.parse(note.reminder_at!), Date.now()));
    expect(time).not.toBe("2 days");
  });

  /** Review FX-B-04: a missed one-off says so, on every board. */
  it("says passed for a missed reminder, in the overdue grammar, on any board", () => {
    const note = { ...noteWrittenAgo(2 * 24 * 60 * 60 * 1000), reminder_at: withReminder(-3 * 60 * 60 * 1000).reminder_at } as Note;
    for (const reminders of [false, true]) {
      const { container, unmount } = drawCard({ note, reminders });
      expect(container.querySelector(".card-time")?.textContent).toBe("passed");
      expect(container.querySelector(".card-foot")?.getAttribute("data-overdue")).toBe("true");
      unmount();
    }
  });

  it("never calls a repeating reminder passed", () => {
    const note = {
      ...noteWrittenAgo(2 * 24 * 60 * 60 * 1000),
      reminder_at: withReminder(-3 * 60 * 60 * 1000).reminder_at,
      reminder_repeat: "daily",
    } as Note;
    const { container } = drawCard({ note, reminders: true });
    expect(container.querySelector(".card-time")?.textContent).not.toBe("passed");
    expect(container.querySelector(".card-foot")?.getAttribute("data-overdue")).toBeNull();
  });

  it("keeps the note's age everywhere else", () => {
    const note = { ...noteWrittenAgo(2 * 24 * 60 * 60 * 1000), reminder_at: withReminder(6 * 60 * 60 * 1000).reminder_at } as Note;
    const { container } = drawCard({ note });
    expect(container.querySelector(".card-time")?.textContent).toBe("2 days");
  });
});

/** Review UX-13: a list is named by its items, not as an empty note. */
describe("the card's spoken name", () => {
  it("names a checklist by its first items and its progress", () => {
    const note = noteWrittenAgo(0, "[ ] oat milk\n[x] eggs\n[ ] lemons");
    drawCard({ note });
    const name = screen.getByRole("button").getAttribute("aria-label");
    expect(name).toBe("List: oat milk, eggs, lemons, 1 of 3 done");
  });

  it("says the reminder and the folder the note is filed in", () => {
    const note = {
      ...noteWrittenAgo(0, "Call the dentist"),
      reminder_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    } as Note;
    drawCard({ note, inBoard: true, boardName: "Home" });
    expect(screen.getByRole("button").getAttribute("aria-label")).toBe(
      "Call the dentist, reminder, in Home",
    );
  });
});

describe("file face without a picture", () => {
  // A zip has no first page to render, so its card draws the family mark over
  // the type in its own letters — the mark names the family, the extension
  // still says exactly what it is.
  it("draws the family mark and the exact type", () => {
    const zipped = {
      ...noteWrittenAgo(0, ""),
      attachments: [
        {
          id: "a1",
          name: "backup.zip",
          mime: "application/zip",
          size: 100,
          width: null,
          height: null,
          thumb: null,
          path: null,
          added_at: new Date().toISOString(),
        },
      ],
    } as Note;
    const { container } = card(zipped);
    expect(container.querySelector(".card-file .icon")).toBeTruthy();
    expect(container.querySelector(".card-file-kind")?.textContent).toBe("ZIP");
    expect(container.querySelector(".card-file-name")?.textContent).toBe("backup.zip");
  });
});

describe("multiple file previews", () => {
  it("shows more than the first attachment on the card", () => {
    const multi = {
      ...noteWrittenAgo(0, ""),
      attachments: [
        {
          id: "a1",
          name: "one.jpg",
          mime: "image/jpeg",
          size: 100,
          width: 10,
          height: 10,
          thumb: "data:image/jpeg;base64,one",
          path: null,
          added_at: new Date().toISOString(),
        },
        {
          id: "a2",
          name: "two.jpg",
          mime: "image/jpeg",
          size: 100,
          width: 10,
          height: 10,
          thumb: "data:image/jpeg;base64,two",
          path: null,
          added_at: new Date().toISOString(),
        },
      ],
    } as Note;
    const { container } = card(multi);
    expect(container.querySelectorAll(".card-file-tile")).toHaveLength(2);
  });

  it("keeps the note text and shows its attachments together", () => {
    const mixed = {
      ...noteWrittenAgo(0, "A note with pictures"),
      attachments: [
        {
          id: "a1",
          name: "one.jpg",
          mime: "image/jpeg",
          size: 100,
          width: 10,
          height: 10,
          thumb: "data:image/jpeg;base64,one",
          path: null,
          added_at: new Date().toISOString(),
        },
      ],
    } as Note;
    const { container } = card(mixed);
    expect(container.querySelector(".card-body")?.textContent).toContain(
      "A note with pictures",
    );
    expect(container.querySelectorAll(".card-attachment-strip .card-file-tile")).toHaveLength(1);
  });

  it("lets a row of pictures that runs past the card slide, and fades the edges it hides", () => {
    const pic = (id: string) => ({
      id,
      name: `${id}.jpg`,
      mime: "image/jpeg",
      size: 100,
      width: 10,
      height: 10,
      thumb: `data:image/jpeg;base64,${id}`,
      path: null,
      added_at: new Date().toISOString(),
    });
    const many = {
      ...noteWrittenAgo(0, "Six pictures"),
      attachments: ["a", "b", "c", "d", "e", "f"].map(pic),
    } as Note;
    // jsdom lays nothing out: give the row the widths a phone column has.
    const proto = HTMLElement.prototype;
    const widths = (el: HTMLElement) => el.classList.contains("card-strip-row");
    const scrollW = vi.spyOn(proto, "scrollWidth", "get").mockImplementation(function (this: HTMLElement) {
      return widths(this) ? 460 : 0;
    });
    const clientW = vi.spyOn(proto, "clientWidth", "get").mockImplementation(function (this: HTMLElement) {
      return widths(this) ? 174 : 0;
    });
    try {
      const { container } = card(many);
      const frame = container.querySelector<HTMLElement>(".card-attachment-strip")!;
      const row = container.querySelector<HTMLElement>(".card-strip-row")!;
      expect(frame.dataset.scrolls).toBe("true");
      expect(frame.dataset.over).toBe("true");
      expect(frame.dataset.before).toBe("false");
      row.scrollLeft = 286;
      fireEvent.scroll(row);
      expect(frame.dataset.over).toBe("false");
      expect(frame.dataset.before).toBe("true");
    } finally {
      scrollW.mockRestore();
      clientW.mockRestore();
    }
  });

  it("does not animate a pending file while offline", () => {
    const pending = {
      ...noteWrittenAgo(0, ""),
      attachments: [
        {
          id: "a1",
          name: "one.jpg",
          mime: "image/jpeg",
          size: 100,
          width: 10,
          height: 10,
          thumb: "data:image/jpeg;base64,one",
          path: null,
          added_at: new Date().toISOString(),
        },
      ],
    } as Note;
    const { container } = card(pending, CARD_METRICS, false, false);
    expect(container.querySelector(".syncmark")).toBeNull();
    expect(container.querySelector(".card-sync-word")?.textContent).toBe("offline");
  });

  /** Review UI-05: in this browser only, nothing is ever on its way. */
  it("says nothing about sending where there is nowhere to send", () => {
    const pending = {
      ...noteWrittenAgo(0, "a photo"),
      attachments: [
        {
          id: "a1",
          name: "one.jpg",
          mime: "image/jpeg",
          size: 100,
          width: 10,
          height: 10,
          thumb: "data:image/jpeg;base64,one",
          path: null,
          added_at: new Date().toISOString(),
        },
      ],
    } as Note;
    const online = drawCard({ note: pending, sendsFiles: false });
    expect(online.container.querySelector(".mark-state")).toBeNull();
    online.unmount();
    const offline = drawCard({ note: pending, sendsFiles: false, online: false });
    expect(offline.container.querySelector(".card-sync-word")).toBeNull();
    offline.unmount();
    // And with a server to send to, the mark is still there.
    const syncing = drawCard({ note: pending });
    expect(syncing.container.querySelector(".mark-state")).toBeTruthy();
  });
});

/**
 * Resting on a cut card answers the question the cut mark asks. It is a mouse
 * gesture and nothing else: a finger "enters" a card by touching it, which is
 * a tap, and a phone must never see this at all.
 */
describe("the hover peek", () => {
  const tight: CardMetrics = { lines: 2, charsPerLine: 40 };
  const long = () => noteWrittenAgo(0, "line ".repeat(200));

  function rest(el: HTMLElement, pointerType = "mouse") {
    fireEvent.pointerEnter(el, { pointerType });
    act(() => {
      vi.advanceTimersByTime(500);
    });
  }

  it("shows more of a cut note after the pointer settles", () => {
    vi.useFakeTimers();
    try {
      const { container } = card(long(), tight);
      const el = screen.getByRole("button");
      const before = container.querySelector(".card-body")!.textContent!.length;
      expect(el.dataset.peek).toBe("false");

      rest(el);
      expect(el.dataset.peek).toBe("true");
      expect(
        container.querySelector(".card-body")!.textContent!.length,
      ).toBeGreaterThan(before);

      fireEvent.pointerLeave(el);
      expect(el.dataset.peek).toBe("false");
    } finally {
      vi.useRealTimers();
    }
  });

  it("waits, so sweeping across the board sets nothing off", () => {
    vi.useFakeTimers();
    try {
      card(long(), tight);
      const el = screen.getByRole("button");
      fireEvent.pointerEnter(el, { pointerType: "mouse" });
      act(() => {
        vi.advanceTimersByTime(120);
      });
      expect(el.dataset.peek).toBe("false");
    } finally {
      vi.useRealTimers();
    }
  });

  it("is never something a finger can trigger", () => {
    vi.useFakeTimers();
    try {
      card(long(), tight);
      const el = screen.getByRole("button");
      rest(el, "touch");
      expect(el.dataset.peek).toBe("false");
    } finally {
      vi.useRealTimers();
    }
  });

  it("stays put on a card that is already showing all of itself", () => {
    vi.useFakeTimers();
    try {
      card(noteWrittenAgo(0, "kanelipullat"), tight);
      const el = screen.getByRole("button");
      rest(el);
      expect(el.dataset.peek).toBe("false");
    } finally {
      vi.useRealTimers();
    }
  });

  it("stands down while notes are being picked out", () => {
    vi.useFakeTimers();
    try {
      card(long(), tight, true);
      const el = screen.getByRole("button");
      rest(el);
      expect(el.dataset.peek).toBe("false");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("merge dragging", () => {
  it("starts after a held touch and ends on release", () => {
    vi.useFakeTimers();
    try {
      const onStart = vi.fn();
      const onMove = vi.fn();
      const onEnd = vi.fn();
      render(
        <NoteCard
          note={noteWrittenAgo(0)}
          onOpen={() => {}}
          onLongPress={() => {}}
          onMergeDragStart={onStart}
          onMergeDragMove={onMove}
          onMergeDragEnd={onEnd}
          selecting={false}
          selected={false}
          mergeDragging={false}
          mergeTarget={false}
          trace={false}
          metrics={CARD_METRICS}
        />,
      );
      const el = screen.getByRole("button");
      fireEvent.pointerDown(el, { pointerId: 1, pointerType: "touch" });
      act(() => vi.advanceTimersByTime(500));
      fireEvent.pointerMove(el, {
        pointerId: 1,
        pointerType: "touch",
        clientX: 60,
        clientY: 60,
      });
      expect(onStart).toHaveBeenCalledOnce();
      expect(onMove).toHaveBeenCalledOnce();
      fireEvent.pointerUp(el, { pointerId: 1, pointerType: "touch" });
      expect(onEnd).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  /**
   * A cancel is the browser taking the gesture away, and it is the one ending
   * that must never commit. It was wired to the same handler as the release —
   * the *commit* path — so a scroll claimed mid-drag, or a second finger
   * arriving, merged two notes, archived both sources and opened the canvas,
   * for a drag the user had abandoned. It is reachable with a finger: the card
   * declines the browser's horizontal scroll but not its vertical one, which
   * is exactly the trade `touch-action: pan-y` makes in styles.css.
   */
  function held(props: Partial<ComponentProps<typeof NoteCard>>) {
    drawCard(props);
    const el = screen.getByRole("button");
    fireEvent.pointerDown(el, { pointerId: 1, pointerType: "touch" });
    act(() => vi.advanceTimersByTime(500));
    fireEvent.pointerMove(el, {
      pointerId: 1,
      pointerType: "touch",
      clientX: 60,
      clientY: 60,
    });
    return el;
  }

  it("ends a cancelled drag without ever reaching the merge", () => {
    vi.useFakeTimers();
    try {
      const onEnd = vi.fn();
      const onCancel = vi.fn();
      const el = held({ onMergeDragEnd: onEnd, onMergeDragCancel: onCancel });

      fireEvent.pointerCancel(el, { pointerId: 1, pointerType: "touch" });
      expect(onCancel).toHaveBeenCalledOnce();
      expect(onEnd, "a cancel is not a release").not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("clears the target before ending, for a caller with no cancel of its own", () => {
    // The default written out of the other two props: say the pointer is
    // nowhere, *then* end. The board's own end path merges only when a target
    // is standing under the finger, so clearing it first is what makes the
    // ending safe without the caller having to know this happened.
    vi.useFakeTimers();
    try {
      const onMove = vi.fn();
      const onEnd = vi.fn();
      const el = held({ onMergeDragMove: onMove, onMergeDragEnd: onEnd });
      expect(onMove).toHaveBeenCalledOnce();

      fireEvent.pointerCancel(el, { pointerId: 1, pointerType: "touch" });
      expect(onMove).toHaveBeenCalledTimes(2);
      expect(onMove.mock.calls[1].slice(1)).toEqual([-1, -1]);
      expect(onEnd).toHaveBeenCalledOnce();
      // …and in that order: ended first, the target would still be set.
      expect(onMove.mock.invocationCallOrder[1]).toBeLessThan(
        onEnd.mock.invocationCallOrder[0],
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("says nothing at all when there was no drag to cancel", () => {
    vi.useFakeTimers();
    try {
      const onEnd = vi.fn();
      const onCancel = vi.fn();
      drawCard({ onMergeDragEnd: onEnd, onMergeDragCancel: onCancel });
      const el = screen.getByRole("button");
      // Pressed and taken away before the press was ever a hold.
      fireEvent.pointerDown(el, { pointerId: 1, pointerType: "touch" });
      fireEvent.pointerCancel(el, { pointerId: 1, pointerType: "touch" });
      expect(onCancel).not.toHaveBeenCalled();
      expect(onEnd).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

/** Review 2026-10-24, UX-07: the ordinary desktop ways to pick several notes. */
describe("picking a card the way a desktop does", () => {
  it.each([{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }])("%o-click picks it and does not open it", (mod) => {
    const onLongPress = vi.fn();
    const onOpen = vi.fn();
    drawCard({ onLongPress, onOpen });
    fireEvent.click(screen.getByRole("button"), mod);
    expect(onLongPress).toHaveBeenCalledOnce();
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("Space picks it, Enter still opens it", () => {
    const onLongPress = vi.fn();
    const onOpen = vi.fn();
    drawCard({ onLongPress, onOpen });
    const el = screen.getByRole("button");
    expect(fireEvent.keyDown(el, { key: " " }), "the key's own click is refused").toBe(false);
    expect(onLongPress).toHaveBeenCalledOnce();
    expect(fireEvent.keyUp(el, { key: " " }), "so is its release").toBe(false);
    expect(onOpen).not.toHaveBeenCalled();
    fireEvent.click(el, { detail: 0 });
    expect(onOpen).toHaveBeenCalledOnce();
  });
});

/**
 * Right-click is the desktop's long press, and it is the app's gesture rather
 * than the operating system's. The refusal used to sit *after* the selection
 * guard, so a held right button — which had already turned selection on
 * through the 450ms timer — picked the card out and then dropped the UA menu
 * over the board on top of it: one gesture answered twice.
 */
describe("right-clicking a card", () => {
  it("refuses the browser's own menu and picks the card out", () => {
    const onLongPress = vi.fn();
    drawCard({ onLongPress });
    const el = screen.getByRole("button");
    // fireEvent returns false when the handler called preventDefault.
    expect(fireEvent.contextMenu(el), "the UA menu is refused").toBe(false);
    expect(onLongPress).toHaveBeenCalledOnce();
  });

  it("still refuses it once the card is already picked out", () => {
    const onLongPress = vi.fn();
    drawCard({ onLongPress, selecting: true, selected: true });
    const el = screen.getByRole("button");
    expect(fireEvent.contextMenu(el)).toBe(false);
    // Selection is the click path's job from here; the menu is the only thing
    // this event has left to answer for.
    expect(onLongPress).not.toHaveBeenCalled();
  });

  it("does not also arm the hold, so the gesture is answered once", () => {
    vi.useFakeTimers();
    try {
      const onLongPress = vi.fn();
      drawCard({ onLongPress });
      const el = screen.getByRole("button");
      fireEvent.pointerDown(el, { pointerId: 1, pointerType: "mouse", button: 2 });
      act(() => vi.advanceTimersByTime(500));
      expect(onLongPress, "the menu event is the whole of a right-click").not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

/**
 * The grid is one tab stop a card, which on All is 400 presses of Tab between
 * the board row and the capture bar. The prop is the card's half of the roving
 * tabindex the board strip already runs; left unsaid it is exactly what it
 * always was, so it can never make the grid unreachable on its own.
 */
describe("where a card stands in the tab order", () => {
  it("is an ordinary tab stop when the caller says nothing", () => {
    drawCard({});
    expect(screen.getByRole("button").hasAttribute("tabindex")).toBe(false);
  });

  it("takes the roving stop, and stands out of the order otherwise", () => {
    drawCard({ tabIndex: 0 });
    expect(screen.getByRole("button").getAttribute("tabindex")).toBe("0");
    cleanup();
    drawCard({ tabIndex: -1 });
    expect(screen.getByRole("button").getAttribute("tabindex")).toBe("-1");
  });

  it("is still reachable from the arrows at -1", () => {
    // The other half of the pattern: `useGridKeyboard` moves focus by calling
    // `.focus()` from a listener on the window, and a -1 element answers that
    // perfectly well. Take this away and the grid is walkable by nothing.
    drawCard({ tabIndex: -1 });
    const el = screen.getByRole("button");
    el.focus();
    expect(document.activeElement).toBe(el);
  });
});

/**
 * A card's whole action is "open this note", and the second click of a
 * double-click has nothing to add to it.
 */
describe("a fast double-click", () => {
  it("opens the note once", () => {
    const onOpen = vi.fn();
    drawCard({ onOpen });
    const el = screen.getByRole("button");
    fireEvent.click(el, { detail: 1 });
    fireEvent.click(el, { detail: 2 });
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it("leaves a run of clicks alone while notes are being picked out", () => {
    // Here a click is a toggle and a run of them is somebody working quickly.
    const onOpen = vi.fn();
    drawCard({ onOpen, selecting: true, selected: true });
    const el = screen.getByRole("button");
    fireEvent.click(el, { detail: 1 });
    fireEvent.click(el, { detail: 2 });
    expect(onOpen).toHaveBeenCalledTimes(2);
  });
});

/**
 * The whole body of a search result used to step down to `--muted` merely
 * because a query was running. That step only reads as "the ink is over there"
 * when there is ink to look at: a note matched on an attachment's filename, or
 * a link note whose match sat inside an address the face strips, was made
 * harder to read and given nothing at full ink for the trouble. The dimming is
 * keyed on the mark now, and this is the flag the stylesheet keys on.
 */
describe("a card that is a search result", () => {
  const nothing = CARD_METRICS;

  it("says the body is dimmed only when it is really drawing a hit", () => {
    const { container } = card(
      noteWrittenAgo(0, "kanelipullat sunnuntaina"),
      nothing,
      false,
      true,
      false,
      false,
      ["kanelipulla"],
    );
    const body = container.querySelector(".card-body");
    expect(body?.getAttribute("data-dim")).toBe("true");
    expect(body?.querySelector('[data-hit="true"]')?.textContent).toBe("kanelipulla");
  });

  it("leaves the body at full ink when the match is nowhere on the card", () => {
    // Matched on an attachment's filename: the note's own words never hold it.
    const { container } = card(
      noteWrittenAgo(0, "kanelipullat sunnuntaina"),
      nothing,
      false,
      true,
      false,
      false,
      ["screenshot"],
    );
    const body = container.querySelector(".card-body");
    expect(body).toBeTruthy();
    expect(body?.hasAttribute("data-dim")).toBe(false);
  });

  it("carries the flag on the checklist face too, where the items are the words", () => {
    const body = ["[ ] milk", "[ ] kanelipullat", "[ ] bread"].join("\n");
    const { container } = card(
      noteWrittenAgo(0, body),
      nothing,
      false,
      true,
      false,
      false,
      ["kanelipulla"],
    );
    const list = container.querySelector(".check-list");
    expect(list?.getAttribute("data-dim")).toBe("true");
    expect(list?.querySelector('[data-hit="true"]')?.textContent).toBe("kanelipulla");
  });
});

/**
 * A card with several addresses on it.
 *
 * The owner's report of 2026-09-19: "i have 10 fishing spots linked from google
 * maps in one note but on the notes page i only see the first link preview".
 * The card *rendered* two preview boxes and a "+8 links" line — inside a strip
 * clamped to three card line boxes, 58.5px, against a preview box whose own
 * `min-height` was 58. One fitted. The other two were clipped away in silence,
 * and the card was indistinguishable from a note holding one link.
 *
 * A card with more than one link now draws a line per link instead of the
 * picture box, so what it renders is what it shows.
 */
describe("a card holding more than one address", () => {
  const spots = noteWrittenAgo(
    0,
    ["Spot 1 https://maps.example/a", "Spot 2 https://maps.example/b", "Spot 3 https://maps.example/c"].join("\n"),
  );

  it("keeps the picture box for a note with a single address", () => {
    const one = noteWrittenAgo(0, "Saved link: worth a read\nhttps://example.com/a");
    const { container } = card(one);
    expect(container.querySelector(".card-link-previews")).toBeTruthy();
    expect(container.querySelector(".card-link-list")).toBeNull();
  });

  it("names every address it has room for, one line each", () => {
    const { container } = card(spots);
    expect(container.querySelector(".card-link-previews")).toBeNull();
    const names = [...container.querySelectorAll(".card-link-name")].map((n) => n.textContent);
    expect(names).toEqual(["Spot 1", "Spot 2", "Spot 3"]);
    // Three fit, so nothing is held back and no count is drawn.
    expect(container.querySelector(".card-link-more")).toBeNull();
  });

  it("spends its last line on the count when there are more links than lines", () => {
    const ten = noteWrittenAgo(
      0,
      Array.from({ length: 10 }, (_, i) => `Spot ${i + 1} https://maps.example/${i}`).join("\n"),
    );
    const { container } = card(ten);
    const names = [...container.querySelectorAll(".card-link-name")].map((n) => n.textContent);
    // The strip takes the card here: the note has words, but they are the link
    // names themselves, and `stripUrls` leaves them on the card either way.
    expect(names.length).toBeGreaterThan(1);
    expect(names[0]).toBe("Spot 1");
    expect(container.querySelector(".card-link-more")?.textContent).toBe(
      `+${10 - names.length} more`,
    );
  });

  /**
   * A note that is ten bare addresses has no words of its own: `stripUrls`
   * leaves it nothing, so the face is empty and the three lines the strip used
   * to be capped at left five of the card's eight blank.
   */
  it("gives the whole card to the strip when the note is nothing but addresses", () => {
    const bare = noteWrittenAgo(
      0,
      Array.from({ length: 10 }, (_, i) => `https://maps.example/${i}`).join("\n"),
    );
    const { container } = card(bare);
    const lines = container.querySelectorAll(".card-link-line");
    expect(lines.length).toBeGreaterThan(3);
    // Nothing of the user's own to print, so each line is named by its site.
    expect(container.querySelector(".card-link-name")?.textContent).toBe("maps.example");
    // Which is also the site, so it is not printed twice on one line.
    expect(container.querySelector(".card-link-site")).toBeNull();
  });

  it("clamps the strip to the lines it was given, so nothing is clipped away", () => {
    const { container } = card(spots);
    const list = container.querySelector<HTMLElement>(".card-link-list");
    const declared = Number(list?.style.getPropertyValue("--card-link-lines"));
    expect(container.querySelectorAll(".card-link-line").length).toBeLessThanOrEqual(declared);
  });
});

describe("a document page on a card (review GD-01)", () => {
  const file = (name: string, mime: string) => ({
    id: name,
    name,
    mime,
    size: 100,
    width: 10,
    height: 10,
    thumb: "data:image/jpeg;base64,page",
    path: null,
    added_at: new Date().toISOString(),
  });

  it("marks a PDF's page as a document, so it is drawn as a negative from its top", () => {
    const pdf = { ...noteWrittenAgo(0, ""), attachments: [file("lease.pdf", "application/pdf")] } as Note;
    const { container } = card(pdf);
    expect(container.querySelector(".card-shot")?.getAttribute("data-doc")).toBe("true");
  });

  it("leaves a photograph's tones alone", () => {
    const photo = { ...noteWrittenAgo(0, ""), attachments: [file("beach.jpg", "image/jpeg")] } as Note;
    const { container } = card(photo);
    expect(container.querySelector(".card-shot")?.hasAttribute("data-doc")).toBe(false);
  });

  it("marks the PDF among several files and only it", () => {
    const both = {
      ...noteWrittenAgo(0, ""),
      attachments: [file("lease.pdf", "application/pdf"), file("beach.jpg", "image/jpeg")],
    } as Note;
    const { container } = card(both);
    const shots = [...container.querySelectorAll(".card-shot")].map((el) => el.getAttribute("data-doc"));
    expect(shots).toEqual(["true", null]);
  });
});

describe("a filed card's footer names its folder by the folder's own mark (review GD-05)", () => {
  // The whole Heroicons set is the slowest module in the app to transform,
  // and under a whole-suite run loading it was most of this test's time
  // (9.5 s of a 15 s budget; audit 2026-10-10, CODE-5). Loaded here, with
  // Lucide's, the test still waits for the sets to arrive and measures only
  // what it draws.
  beforeAll(async () => {
    await Promise.all([import("../lib/iconSet"), import("../lib/lucideSet")]);
  }, 120_000);

  it("draws the chosen mark once the set is here, the folder for none or an unknown name", async () => {
    const { renderHook, waitFor } = await import("@testing-library/react");
    const { useBoardIcons } = await import("./BoardLook");
    const loaded = renderHook(() => useBoardIcons(["HomeIcon", "lucide:fish"]));
    await waitFor(() => expect(loaded.result.current).toBe(true), { timeout: 10_000 });

    const filed = (boardIcon?: string) => {
      const { container, unmount } = drawCard({ inBoard: true, boardName: "Home", boardIcon });
      const mark = container.querySelector(".card-filed");
      const out = { html: mark?.innerHTML ?? "", title: mark?.getAttribute("title") };
      unmount();
      return out;
    };
    const plain = filed(undefined);
    // A folder dressed before Lucide keeps its Heroicons mark; one dressed
    // since wears Lucide's. Both draw at the footer's tier.
    const home = filed("HomeIcon");
    const fish = filed("lucide:fish");
    const unknown = filed("NoSuchMarkIcon");

    expect(plain.title).toBe("Filed in Home");
    expect(home.title).toBe("Filed in Home");
    expect(home.html).not.toBe(plain.html);
    expect(home.html).toContain("icon-data");
    expect(fish.html).not.toBe(plain.html);
    expect(fish.html).not.toBe(home.html);
    expect(fish.html).toContain("icon-data");
    expect(unknown.html).toBe(plain.html);
  }, 20_000);
});

describe("an unnamed idea card carries its first source's opening line (review UX-A-09)", () => {
  const snapshot = { shapes: [], strokes: [], labels: [] };
  const ideaCard = (body: string) =>
    drawCard({
      note: {
        ...noteWrittenAgo(0, body),
        source: "merge",
        merged_from: ["n2", "n3"],
      } as Note,
      snapshot,
    });

  it("draws the note's own words under the picture, never a label of the app's", () => {
    const { container } = ideaCard("Buy oat milk and candles\n\n———\n\nSecond source");
    expect(container.querySelector(".card-idea-name")).toBeNull();
    const line = container.querySelector(".card-idea-line");
    expect(line?.textContent).toBe("Buy oat milk and candles");
    // Under the thumbnail: after it in the card.
    const snap = container.querySelector(".idea-snapshot")!;
    expect(snap.compareDocumentPosition(line!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("skips blank lines and the rule between sources, and strips a list marker", () => {
    const { container } = ideaCard("\n- [ ] oat milk\n———\nsecond");
    expect(container.querySelector(".card-idea-line")?.textContent).toBe("oat milk");
  });

  it("is not drawn once the idea is named — the name speaks", () => {
    const { container } = ideaCard("# Pantry\n\nBuy oat milk");
    expect(container.querySelector(".card-idea-name")?.textContent).toBe("Pantry");
    expect(container.querySelector(".card-idea-line")).toBeNull();
  });
});

describe("the site name on a Links row opens the page (review FX-A-01)", () => {
  const linkNote = () =>
    ({
      ...noteWrittenAgo(0, "https://example.org/read/this"),
      note_type: "link",
    }) as Note;

  it("is a sibling link beside the row's button, never inside it", () => {
    const { container } = card(linkNote(), CARD_METRICS, false, true, false, true);
    const link = container.querySelector<HTMLAnchorElement>("a.card-row-site");
    expect(link).toBeTruthy();
    expect(link?.getAttribute("href")).toBe("https://example.org/read/this");
    expect(link?.getAttribute("target")).toBe("_blank");
    expect(link?.getAttribute("rel")).toBe("noopener");
    const button = container.querySelector("button.card")!;
    expect(button.contains(link)).toBe(false);
    expect(button.parentElement).toBe(link?.parentElement);
    // The row is still one `.card[data-id]` per note.
    expect(container.querySelectorAll(".card[data-id]")).toHaveLength(1);
  });

  it("is not drawn on a grid card, nor while a selection runs", () => {
    const grid = card(linkNote());
    expect(grid.container.querySelector("a")).toBeNull();
    cleanup();
    const picking = card(linkNote(), CARD_METRICS, true, true, false, true);
    expect(picking.container.querySelector("a.card-row-site")).toBeNull();
  });
});

describe("NoteCard opened by a key", () => {
  afterEach(() => vi.unstubAllGlobals());

  /** A machine with a mouse, and so with a keyboard (jsdom answers no query). */
  function stubKeyboard(has: boolean) {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: has && query === "(hover: hover) and (pointer: fine)",
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
  }

  // Enter on a focused card is a click with no pointer, `detail` 0; a tap or a
  // mouse click is 1. Only the first may put the caret in the note (UX-06).
  it("tells the note a key opened it, and never a tap", () => {
    stubKeyboard(true);
    const onOpen = vi.fn();
    drawCard({ onOpen });
    const button = screen.getByRole("button");
    fireEvent.click(button, { detail: 0 });
    const id = (onOpen.mock.calls[0][0] as Note).id;
    expect(takeKeyOpen(id)).toBe(true);
    fireEvent.click(button, { detail: 0 });
    fireEvent.click(button, { detail: 1 });
    expect(takeKeyOpen(id)).toBe(false);
  });

  it("does not count a click with no pointer on a device with no keyboard", () => {
    stubKeyboard(false);
    const onOpen = vi.fn();
    drawCard({ onOpen });
    fireEvent.click(screen.getByRole("button"), { detail: 0 });
    expect(takeKeyOpen((onOpen.mock.calls[0][0] as Note).id)).toBe(false);
  });
});

describe("a slip on the Todos board", () => {
  // Owner picked mockup B, 2026-10-17: a to-do that fits in SLIP_LINES is drawn
  // a third of a card tall; anything longer, a list or a file keeps its card.
  const todo = (body: string) => ({ ...noteWrittenAgo(0, body), note_type: "todo" }) as Note;
  const slipOf = (container: HTMLElement) =>
    container.querySelector(".card")?.getAttribute("data-slip") ?? null;

  it("draws a one-line to-do as a slip, with its line budget on the card", () => {
    const { container } = drawCard({ note: todo("Osta kissanruokaa"), onTodos: true });
    expect(slipOf(container)).toBe("true");
    expect(container.querySelector<HTMLElement>(".card")!.style.getPropertyValue("--card-lines")).toBe("2");
  });

  it("keeps the full card for a to-do longer than two lines", () => {
    const long = "Selvitä miksi sähkölasku nousi, soita yhtiölle ja pyydä erittely, tarkista mittarin lukema ja ota siitä kuva";
    const { container } = drawCard({ note: todo(long), onTodos: true });
    expect(slipOf(container)).toBeNull();
  });

  it("keeps the full card for a list, whose boxes are its words", () => {
    const { container } = drawCard({ note: todo("[ ] maito\n[ ] voita"), onTodos: true });
    expect(slipOf(container)).toBeNull();
  });

  it("is a full card everywhere but the Todos board", () => {
    const { container } = drawCard({ note: todo("Osta kissanruokaa") });
    expect(slipOf(container)).toBeNull();
  });
});
