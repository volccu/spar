import { afterEach, describe, expect, it, vi } from "vitest";

// The sweep keeps a row per device that took a due reminder. If writing the
// "delivered" row fails, those per-device rows are the only memory of who has
// it, so they must survive to the next sweep.
const calls: { table: string; op: string }[] = [];
let handler: (req: Request) => Promise<Response>;

vi.mock("../supabase/functions/_shared/db.ts", () => ({
  adminClient: () => ({
    rpc: async () => ({
      data: [{ note_id: "n1", owner_id: "o1", reminder_at: new Date(Date.now() - 60_000).toISOString(), body: "x" }],
      error: null,
    }),
    from: (table: string) => {
      const result = (op: string) => {
        calls.push({ table, op });
        if (table === "reminder_deliveries" && op === "upsert") return { error: { message: "transient" } };
        return { data: [], error: null };
      };
      const b: any = {
        select: () => b,
        in: () => b,
        is: () =>
          Promise.resolve(
            table === "push_subscriptions"
              ? { data: [{ endpoint: "e1", p256dh: "p", auth: "a", owner_id: "o1" }], error: null }
              : { data: [], error: null },
          ),
        eq: () => Promise.resolve(result("delete")),
        delete: () => b,
        upsert: () => Promise.resolve(result("upsert")),
        update: () => b,
      };
      return b;
    },
  }),
}));
vi.mock("../supabase/functions/_shared/webpush.ts", () => ({
  sendPush: async () => ({ ok: true, status: 201 }),
}));

afterEach(() => vi.unstubAllGlobals());

describe("send-reminders", () => {
  it("keeps the per-device rows when the delivered record could not be written", async () => {
    vi.stubGlobal("Deno", {
      env: { get: (k: string) => ({ CRON_SECRET: "s", VAPID_PUBLIC_KEY: "a", VAPID_PRIVATE_KEY: "b", VAPID_SUBJECT: "mailto:a@b.c" })[k] },
      serve: (h: (req: Request) => Promise<Response>) => (handler = h),
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    // A variable, so the root typecheck does not follow the Deno-only function into the Node build.
    const entry = "../supabase/functions/send-reminders/index.ts";
    await import(/* @vite-ignore */ entry);
    const res = await handler(new Request("http://x", { headers: { "x-cron-secret": "s" } }));
    expect(res.status).toBe(200);
    expect(calls.some((c) => c.table === "reminder_deliveries" && c.op === "upsert")).toBe(true);
    expect(calls.filter((c) => c.table === "reminder_device_deliveries" && c.op === "delete")).toEqual([]);
  });
});
