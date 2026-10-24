// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { claimForOwner, putNote } from "./db";
import { note } from "../test/fixtures";

/**
 * An account switch lets go of this browser's push subscription before it
 * empties the store (audit 2026-10-10, SEC-7). Left standing, it still carried
 * the previous account's address, and that account's reminders went on ringing
 * on a browser now somebody else's. Its own file: the switch empties the store.
 */

const ALICE = "11111111-1111-1111-1111-111111111111";
const BOB = "22222222-2222-2222-2222-222222222222";

function fakeWorker(unsubscribe: () => Promise<boolean>) {
  const sub = { endpoint: "https://push.example/this-browser", unsubscribe: vi.fn(unsubscribe) };
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: {
      getRegistration: async () => ({ pushManager: { getSubscription: async () => sub } }),
    },
  });
  return sub;
}

afterEach(() => {
  delete (navigator as unknown as { serviceWorker?: unknown }).serviceWorker;
});

describe("an account switch and this browser's push subscription", () => {
  it("leaves the subscription alone when the same account signs in again", async () => {
    const sub = fakeWorker(async () => true);
    await putNote(note({ id: "alices", raw_content: "x", body: "x" }));
    expect(await claimForOwner(ALICE)).toBe(false);
    expect(await claimForOwner(ALICE)).toBe(false);
    expect(sub.unsubscribe).not.toHaveBeenCalled();
  });

  it("releases it when a different account takes the store", async () => {
    const sub = fakeWorker(async () => true);
    expect(await claimForOwner(BOB, { evenIfUnsent: true })).toBe(true);
    expect(sub.unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("still switches when the browser refuses to let go", async () => {
    const sub = fakeWorker(async () => {
      throw new Error("refused");
    });
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await claimForOwner(ALICE, { evenIfUnsent: true })).toBe(true);
    expect(sub.unsubscribe).toHaveBeenCalledTimes(1);
    quiet.mockRestore();
  });
});
