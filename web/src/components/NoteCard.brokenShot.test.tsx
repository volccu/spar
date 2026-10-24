// @vitest-environment jsdom
import { render, cleanup, fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NoteCard } from "./NoteCard";
import { CARD_METRICS } from "../lib/face";
import type { Attachment, Note } from "../types";

/**
 * The card draws this device's own bytes when it has them. Bytes that will not
 * decode here (a format this browser cannot draw, a copy that came out empty)
 * left the tile as its bare backing — a row of brown boxes on the Files board
 * over notes whose photographs opened perfectly (2026-10-09). The thumbnail
 * travels inside the note and always draws, so it is what the card falls back to.
 */
vi.mock("../store/useFileUrl", () => ({
  useFileUrl: (att: Attachment | null) => ({
    url: att ? `blob:local-${att.id}` : null,
    missing: false,
  }),
}));

afterEach(cleanup);

function photo(id: string): Attachment {
  return {
    id,
    name: `${id}.jpg`,
    mime: "image/jpeg",
    size: 1024,
    width: 4000,
    height: 3000,
    thumb: `data:image/jpeg;base64,${id}`,
    path: "owner/x",
    added_at: "2026-10-01T10:00:00.000Z",
  };
}

function cardOf(attachments: Attachment[], body = "") {
  const iso = new Date().toISOString();
  const note = {
    id: "n1",
    raw_content: body,
    body,
    source: "web",
    created_at: iso,
    updated_at: iso,
    status: "active",
    priority: 0,
    attachments,
  } as unknown as Note;
  return render(
    <NoteCard
      terms={[]}
      note={note}
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
      online
      inBoard={false}
      row={false}
    />,
  );
}

describe("a card picture that will not draw", () => {
  it("falls back to the thumbnail on a one-picture card", () => {
    const { container } = cardOf([photo("a")]);
    const img = container.querySelector<HTMLImageElement>("img.card-shot")!;
    expect(img.getAttribute("src")).toBe("blob:local-a");
    fireEvent.error(img);
    expect(container.querySelector("img.card-shot")!.getAttribute("src")).toBe(
      "data:image/jpeg;base64,a",
    );
  });

  it("falls back to the thumbnail in a strip of several", () => {
    const { container } = cardOf([photo("a"), photo("b")], "words beside the pictures");
    const [first, second] = Array.from(container.querySelectorAll<HTMLImageElement>("img.card-shot"));
    fireEvent.error(first);
    const after = Array.from(container.querySelectorAll<HTMLImageElement>("img.card-shot"));
    expect(after[0].getAttribute("src")).toBe("data:image/jpeg;base64,a");
    // Only the one that failed steps down.
    expect(after[1].getAttribute("src")).toBe(second.getAttribute("src"));
  });
});
