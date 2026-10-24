import type { Attachment, Canvas, LinkPreview, Note, UserBoard } from "../types";

/**
 * The shapes the tests build, in one place.
 *
 * Eighteen test files each declared their own `function note(over)`, fifteen
 * lines apiece, listing the whole of `Note` from memory, and three more did
 * the same for a canvas or an attachment. Adding a column meant editing all
 * of them, and **nothing at all made anyone**: `web/tsconfig`
 * excludes `*.test.ts` and neither Vitest suite typechecks, so a fixture is the
 * one kind of object in this codebase that can quietly stop being the type it
 * claims to be. They had. Several still carried `title`, `gist`, `summary`,
 * `tags` and `enriched_at` — fields deleted with the AI layer and absent from
 * `Note` for months — and most were missing `reminder_repeat`, which
 * migration 0020 added.
 *
 * `lib/reminders.test.ts` keeps a `note()` of its own on purpose: it builds
 * the two reminder fields and nothing else, which is a statement about what
 * the projection reads rather than a copy of the note's shape.
 *
 * This file is *not* a test file, so it is inside the tsconfig and `tsc -b`
 * checks it on every build. That is the whole point of the move: the fixtures
 * cannot drift from the types again without the build saying so. Nothing in
 * the app imports it, so it is never bundled.
 *
 * Each builder takes an override object and applies it last, so a test still
 * says only what it cares about. Where a file needs different defaults — a
 * different date, an archived note, a body its assertions read — it keeps a
 * two-line wrapper of its own around these, which is a fact about that file's
 * subject rather than a second copy of the shape.
 */

/** The default instant. A test that cares about time passes its own. */
export const STAMP = "2026-01-01T00:00:00.000Z";

export function note(over: Partial<Note> = {}): Note {
  return {
    id: "n1",
    raw_content: "body",
    body: "body",
    source: "web",
    created_at: STAMP,
    updated_at: STAMP,
    note_type: null,
    board_id: null,
    status: "active",
    priority: 0,
    reminder_at: null,
    reminder_repeat: null,
    done: null,
    merged_from: null,
    keep_id: null,
    attachments: [],
    ...over,
  };
}

export function attachment(over: Partial<Attachment> = {}): Attachment {
  return {
    id: "a1",
    name: "shot.png",
    mime: "image/png",
    size: 3,
    width: 10,
    height: 10,
    thumb: "data:image/jpeg;base64,xx",
    path: "u1/n1/a1",
    added_at: "2026-08-01T00:00:00.000Z",
    ...over,
  };
}

/** A canvas is keyed by the idea note it arranges, so `idea_id` follows `id`. */
export function canvas(over: Partial<Canvas> = {}): Canvas {
  const id = over.id ?? "idea";
  return {
    id,
    idea_id: id,
    items: [{ note_id: "a", x: 0, y: 0 }],
    strokes: [],
    image_widths: {},
    text_elements: [],
    created_at: "2026-08-12T08:00:00.000Z",
    updated_at: "2026-08-12T09:00:00.000Z",
    ...over,
  };
}

export function linkPreview(over: Partial<LinkPreview> = {}): LinkPreview {
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

export function board(over: Partial<UserBoard> = {}): UserBoard {
  return { id: "b1", name: "Recipes", position: 0, ...over };
}
