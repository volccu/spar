/**
 * A reminder through a merge, against the real sweep (review 2026-10-13,
 * EH-03). The sweep remembers what it rang by note id and rings only active
 * notes, so a merge that moves a reminder onto a new or existing idea decides
 * whether it rings twice, once, or never. What the app writes is built by the
 * app's own code (`buildMerge`, `reminderJoiningIdea`), not restated here.
 */
import { randomUUID, webcrypto } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { bytesToB64u } from "../../supabase/functions/_shared/webpush";
import { buildMerge, reminderJoiningIdea } from "../../web/src/lib/merge";
import type { Note } from "../../web/src/types";
import { Client, note, startServer, type Running } from "./helpers";

const subtle = webcrypto.subtle;

/** A signed-in user with one phone that takes every push. */
async function userWithPhone(s: Running): Promise<Client> {
  const a = new Client(s.url);
  await a.signUp();
  const keys = (await subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as webcrypto.CryptoKeyPair;
  const answer = await a.request("POST", "/api/push/subscribe", {
    endpoint: "https://push.example.test/phone",
    p256dh: bytesToB64u(new Uint8Array(await subtle.exportKey("raw", keys.publicKey))),
    auth: bytesToB64u(webcrypto.getRandomValues(new Uint8Array(16))),
    user_agent: "test",
    seen_at: new Date().toISOString(),
    failed_at: null,
  });
  expect(answer.status).toBe(204);
  return a;
}

const accepted = (async () => new Response(null, { status: 201 })) as typeof fetch;

describe("a reminder through a merge", () => {
  let s: Running;
  afterEach(async () => s?.close());

  it("does not ring again for a reminder that rang just before its note was merged", async () => {
    s = await startServer({}, { pushTransport: accepted });
    const a = await userWithPhone(s);
    const at = new Date(Date.now() - 5 * 60_000).toISOString();
    const A = note({ body: "Call the dentist", raw_content: "Call the dentist", reminder_at: at }) as unknown as Note;
    const B = note({ body: "Book the car in", raw_content: "Book the car in" }) as unknown as Note;
    await a.request("POST", "/api/notes", { rows: [A, B] });
    expect(await s.app.push.sweep()).toEqual({ due: 1, sent: 1, retired: 0 });

    const { merged } = buildMerge([A, B]);
    const later = new Date().toISOString();
    await a.request("POST", "/api/notes", {
      rows: [
        merged,
        { ...A, status: "archived", merged_into: merged.id, updated_at: later },
        { ...B, status: "archived", merged_into: merged.id, updated_at: later },
      ],
    });

    expect(await s.app.push.sweep()).toEqual({ due: 0, sent: 0, retired: 0 });
  });

  it("rings a daily reminder from the idea tomorrow, but not again today", async () => {
    s = await startServer({}, { pushTransport: accepted });
    const a = await userWithPhone(s);
    const anchor = Date.now() - 3 * 24 * 60 * 60_000 - 60 * 60_000; // an hour ago, three days running
    const A = note({ body: "Water the plants", raw_content: "Water the plants", reminder_at: new Date(anchor).toISOString(), reminder_repeat: "daily" }) as unknown as Note;
    const B = note({ body: "Feed the cat", raw_content: "Feed the cat" }) as unknown as Note;
    await a.request("POST", "/api/notes", { rows: [A, B] });
    expect(await s.app.push.sweep()).toEqual({ due: 1, sent: 1, retired: 0 });

    const { merged } = buildMerge([A, B]);
    const later = new Date().toISOString();
    await a.request("POST", "/api/notes", {
      rows: [
        merged,
        { ...A, status: "archived", merged_into: merged.id, updated_at: later },
        { ...B, status: "archived", merged_into: merged.id, updated_at: later },
      ],
    });

    expect(await s.app.push.sweep()).toEqual({ due: 0, sent: 0, retired: 0 });
    const tomorrow = (Date.now() + 24 * 60 * 60_000) * 1000; // microseconds
    expect(s.app.push.due(tomorrow).map((r) => r.note_id)).toEqual([merged.id]);
  });

  it("still rings a reminder whose note was merged into an existing idea", async () => {
    s = await startServer({}, { pushTransport: accepted });
    const a = await userWithPhone(s);
    const inAnHour = Date.now() + 60 * 60_000;
    const A = note({ body: "Pick up the parcel", raw_content: "Pick up the parcel", reminder_at: new Date(inAnHour).toISOString() }) as unknown as Note;
    const idea = note({ body: "# Errands", raw_content: "# Errands", source: "merge", merged_from: [randomUUID()] }) as unknown as Note;
    await a.request("POST", "/api/notes", { rows: [A, idea] });
    const then = (inAnHour + 60_000) * 1000; // microseconds, a minute after it is due
    expect(s.app.push.due(then)).toHaveLength(1);

    // What absorbIntoIdea (web/src/lib/useIdeaVerbs.ts) writes, reminder included.
    const later = new Date().toISOString();
    await a.request("POST", "/api/notes", {
      rows: [
        { ...idea, ...reminderJoiningIdea(idea, [A]), merged_from: [...(idea.merged_from ?? []), A.id], updated_at: later },
        { ...A, status: "archived", merged_into: idea.id, updated_at: later },
      ],
    });

    expect(s.app.push.due(then).map((r) => r.note_id)).toEqual([idea.id]);
  });
});
