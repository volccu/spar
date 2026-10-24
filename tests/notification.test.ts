import { describe, expect, it } from "vitest";
import { GRACE_SECONDS, graceTtl, MIN_TTL_SECONDS, notificationFor, ttlFor } from "../supabase/functions/_shared/notification";

// The text a reminder arrives with, checked here because the only other
// place it is ever seen is a phone's notification shade.
const at = "2026-08-27T10:00:00.000Z";

describe("notificationFor", () => {
  it("uses the first line as the title and the rest as the body", () => {
    const n = notificationFor({ note_id: "n1", reminder_at: at, body: "Call the dentist\nAsk about the Thursday slot\nand the invoice" });
    expect(n).toEqual({
      note_id: "n1",
      title: "Call the dentist",
      body: "Ask about the Thursday slot and the invoice",
      at,
      actions: [
        { action: "later", title: "Later" },
        { action: "done", title: "Done" },
      ],
    });
  });

  it("a one-line note is a title alone — nothing is invented for the body", () => {
    const n = notificationFor({ note_id: "n1", reminder_at: at, body: "Buy milk" });
    expect(n.title).toBe("Buy milk");
    expect(n.body).toBe("");
  });

  it("skips blank lines and trims, so the title is never empty whitespace", () => {
    const n = notificationFor({ note_id: "n1", reminder_at: at, body: "\n\n  Water the plants  \n\n  every day\n" });
    expect(n.title).toBe("Water the plants");
    expect(n.body).toBe("every day");
  });

  it("an empty note still says something", () => {
    expect(notificationFor({ note_id: "n1", reminder_at: at, body: "" }).title).toBe("Reminder");
    expect(notificationFor({ note_id: "n1", reminder_at: at, body: null as unknown as string }).title).toBe("Reminder");
  });

  /**
   * The two words a reminder can be answered with without opening the app.
   *
   * A repeating one is offered neither, and that is the decision rather than an
   * omission: `reminder_at` is the anchor of the series, so "Later" would move
   * every future occurrence rather than postpone one ringing, and "Done" would
   * mean *stop repeating* — which is a change to what the note is for, not a
   * thing to decide from a lock screen. `web/src/lib/reminderActions.ts`
   * refuses the same write from the other end, so a stale notification cannot
   * make it either.
   */
  it("offers Later and Done on a reminder that rings once", () => {
    const n = notificationFor({ note_id: "n1", reminder_at: at, body: "Bins out" });
    expect(n.actions.map((a) => a.action)).toEqual(["later", "done"]);
  });

  it("offers nothing on a reminder that comes round again", () => {
    for (const reminder_repeat of ["daily", "weekly", "monthly"]) {
      const n = notificationFor({ note_id: "n1", reminder_at: at, body: "Bins out", reminder_repeat });
      expect(n.actions, reminder_repeat).toEqual([]);
    }
  });

  it("treats a null rule as ringing once, which is what null means", () => {
    const n = notificationFor({ note_id: "n1", reminder_at: at, body: "Bins out", reminder_repeat: null });
    expect(n.actions).toHaveLength(2);
  });

  it("cuts a long first line at 60 with an ellipsis, and the body at 120", () => {
    const long = "x".repeat(200);
    const n = notificationFor({ note_id: "n1", reminder_at: at, body: `${long}\n${long}` });
    expect(n.title).toHaveLength(60);
    expect(n.title.endsWith("…")).toBe(true);
    expect(n.body).toHaveLength(120);
    expect(n.body.endsWith("…")).toBe(true);
  });
});

// How long the push service holds a reminder: what is left of its day of
// grace, never under a minute. `send-reminders` asks in milliseconds from an
// ISO string, the spår server in microseconds; both land on `graceTtl`.
describe("ttlFor", () => {
  const due = Date.parse(at);
  const HOUR = 3_600_000;

  it("is the whole window at the moment the reminder comes due", () => {
    expect(GRACE_SECONDS).toBe(24 * 60 * 60);
    expect(ttlFor(at, due)).toBe(GRACE_SECONDS);
  });

  it("is what is left of the window later on", () => {
    expect(ttlFor(at, due + 23 * HOUR)).toBe(3600);
    expect(ttlFor(at, due + 1500)).toBe(GRACE_SECONDS - 1); // 86398.5, rounded up
    expect(ttlFor(at, due + 2500)).toBe(GRACE_SECONDS - 2); // 86397.5, rounded up
  });

  it("never drops under a minute, even past the window", () => {
    expect(MIN_TTL_SECONDS).toBe(60);
    expect(ttlFor(at, due + 24 * HOUR - 1000)).toBe(60);
    expect(ttlFor(at, due + 48 * HOUR)).toBe(60);
  });

  it("never runs past the window for an occurrence still ahead", () => {
    expect(ttlFor(at, due - HOUR)).toBe(GRACE_SECONDS);
  });

  it("falls back to the whole window for an occurrence it cannot read", () => {
    expect(ttlFor("not an instant", due)).toBe(GRACE_SECONDS);
    expect(ttlFor("", due)).toBe(GRACE_SECONDS);
  });

  it("reads the clock when no time is handed in", () => {
    expect(ttlFor(new Date().toISOString())).toBeGreaterThan(GRACE_SECONDS - 5);
  });

  it("answers alike whatever unit the caller keeps instants in", () => {
    const us = due * 1000;
    for (const later of [0, 1500, 23 * HOUR, 24 * HOUR - 1000, 30 * HOUR]) {
      expect(graceTtl(us, us + later * 1000, 1_000_000), String(later)).toBe(ttlFor(at, due + later));
    }
  });
});
