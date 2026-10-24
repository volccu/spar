/**
 * a lone UTF-16 surrogate in a note's text.
 *
 * JSON allows "\ud83d" on its own (a JS string cut in the middle of an emoji
 * has one), and `text()` in values.ts lets it through. SQLite stores text as
 * UTF-8, where it becomes U+FFFD, so the stored `raw_content` is no longer what
 * was sent. The note is accepted once; every later upload of the same row —
 * the client re-sends raw_content with each edit — is refused with
 * 409 raw_content_immutable, and a refusal rolls back the whole batch, so the
 * other notes in it are stuck behind it. (Postgres, behind the Supabase
 * backend, refuses such text outright at the first write.)
 */
import { afterEach, describe, expect, it } from "vitest";
import { Client, note, startServer, type Running } from "./helpers";

describe("text with a lone surrogate", () => {
  let s: Running;
  afterEach(async () => s?.close());

  it("is either refused at once or kept exactly: the same row can be sent again", async () => {
    s = await startServer();
    const a = new Client(s.url);
    await a.signUp();
    const broken = note({ raw_content: "half an emoji \ud83d", body: "half an emoji \ud83d" });
    const first = await a.request("POST", "/api/notes", { rows: [broken] });
    if (first.status !== 200) return; // refused up front is a fine answer
    // The same row again, as the client does after any later edit of the note.
    const again = await a.request("POST", "/api/notes", { rows: [{ ...broken, body: "edited" }, note()] });
    expect(again.status, again.text).toBe(200);
  });
});
