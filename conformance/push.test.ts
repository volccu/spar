/**
 * Contract: "Push subscriptions".
 */
import { beforeAll, describe, expect, it } from "vitest";
import type { PushSubscriptionWrite, Session } from "./driver";
import { at, useDriver, users, uuid } from "./support";

const driver = useDriver();
let a: Session;

beforeAll(async () => {
  [a] = await users(driver, 1);
});

function subscription(overrides: Partial<PushSubscriptionWrite> = {}): PushSubscriptionWrite {
  return {
    endpoint: `https://push.example.test/send/${uuid()}`,
    p256dh: "BPublicKeyOfTheBrowser",
    auth: "authSecret",
    user_agent: "conformance",
    seen_at: at(0),
    failed_at: null,
    ...overrides,
  };
}

describe("registering a device", () => {
  it("stores a subscription under its endpoint, for the signed-in owner", async () => {
    const sub = subscription();
    await a.upsertPushSubscription(sub);
    const rows = await driver.server.allSubscriptions(a.userId);
    const row = rows.find((r) => r.endpoint === sub.endpoint);
    expect(row).toMatchObject({ endpoint: sub.endpoint, owner_id: a.userId, p256dh: sub.p256dh, auth: sub.auth, failed_at: null });
  });

  it("updates in place on the same endpoint: one row per device however often it registers", async () => {
    const sub = subscription();
    await a.upsertPushSubscription(sub);
    await a.upsertPushSubscription({ ...sub, p256dh: "rotated", auth: "rotated-auth", seen_at: at(60_000) });
    const rows = (await driver.server.allSubscriptions(a.userId)).filter((r) => r.endpoint === sub.endpoint);
    expect(rows.length).toBe(1);
    expect(rows[0].p256dh).toBe("rotated");
  });

  it("removes a subscription by endpoint", async () => {
    const sub = subscription();
    await a.upsertPushSubscription(sub);
    await a.deletePushSubscription(sub.endpoint);
    expect((await driver.server.allSubscriptions(a.userId)).map((r) => r.endpoint)).not.toContain(sub.endpoint);
  });

  it("treats removing an endpoint that is not registered as nothing to do", async () => {
    await a.deletePushSubscription(`https://push.example.test/send/${uuid()}`);
  });
});

describe("retiring a dead endpoint", () => {
  it("keeps a retired endpoint's row, but the sweep no longer sends to it", async () => {
    const sub = subscription();
    await a.upsertPushSubscription(sub);
    expect((await driver.server.liveSubscriptions([a.userId])).map((r) => r.endpoint)).toContain(sub.endpoint);
    await driver.server.retireSubscriptions([sub.endpoint]);
    expect((await driver.server.liveSubscriptions([a.userId])).map((r) => r.endpoint)).not.toContain(sub.endpoint);
    const row = (await driver.server.allSubscriptions(a.userId)).find((r) => r.endpoint === sub.endpoint);
    expect(row?.failed_at).not.toBeNull();
  });

  it("brings a retired endpoint back when the device registers again", async () => {
    const sub = subscription();
    await a.upsertPushSubscription(sub);
    await driver.server.retireSubscriptions([sub.endpoint]);
    await a.upsertPushSubscription({ ...sub, seen_at: at(120_000) });
    expect((await driver.server.liveSubscriptions([a.userId])).map((r) => r.endpoint)).toContain(sub.endpoint);
  });
});
