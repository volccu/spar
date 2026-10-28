/**
 * Push subscriptions (§10) and the reminder sweep (§11).
 *
 * The sweep is the `send-reminders` edge function and the `due_reminders` SQL
 * of the Supabase backend, run in-process once a minute. What makes it the
 * same sweep rather than a lookalike:
 *
 *   - the occurrence is projected by `lastOccurrence` from
 *     web/src/lib/reminders.ts — the app's own projection, imported, so the
 *     server rings at exactly the instant the app shows, by construction;
 *   - the notification is composed by `_shared/notification.ts` and sent by
 *     `_shared/webpush.ts`, the files the edge function uses, so the service
 *     worker (web/public/push-sw.js) gets the payload it already knows, Later
 *     and Done included;
 *   - the grace window and the TTL are that file's too, and the delivery
 *     bookkeeping follows §11.3–11.4.
 *
 * The one thing that differs is where a push goes out: through `pinnedFetch`,
 * because a subscription's endpoint is a URL a user handed in, and this server
 * runs next to things a push service never needs to reach.
 */
import {
  GRACE_SECONDS,
  graceTtl,
  notificationFor,
  type DueReminder as DueAt,
} from "../../supabase/functions/_shared/notification";
import { sendPush, type VapidKeys } from "../../supabase/functions/_shared/webpush";
import { devicesToSend, doneAfter } from "../../supabase/functions/_shared/deliveries";
import { lastOccurrence } from "../../web/src/lib/reminders";
import type { Db } from "./db";
import { badRequest, rowRefused } from "./http";
import { publicUrlShape } from "./netguard";
import { formatInstant, type Micros } from "./time";
import { instant } from "./values";

/**
 * How long an occurrence stays due: one day. `GRACE_SECONDS` is the one
 * `send-reminders` uses, imported; `due_reminders`' `p_grace` default must
 * agree with it (`conformance/contract.test.ts` holds them together).
 */
export { GRACE_SECONDS };
const GRACE_US = GRACE_SECONDS * 1_000_000;
/** A user's devices beyond this many: the one seen longest ago makes room. */
export const MAX_SUBSCRIPTIONS_PER_USER = 50;

/**
 * The occurrence projection (§11.2): the latest occurrence of the series that
 * is not after `now`, or the anchor while the series is still ahead. The
 * arithmetic is the app's own; the anchor's sub-millisecond part (clients never
 * write one) is carried through unchanged.
 */
export function occurrence(anchor: Micros, repeat: string | null, now: Micros): Micros {
  const anchorMs = Math.floor(anchor / 1000);
  const at = lastOccurrence(
    { reminder_at: new Date(anchorMs).toISOString(), reminder_repeat: repeat as never },
    Math.floor(now / 1000),
  );
  return at === null ? anchor : anchor + (at - anchorMs) * 1000;
}

/** What is left of an occurrence's grace, in seconds, as the push's TTL (§11.4). */
export function ttlFor(at: Micros, now: Micros): number {
  return graceTtl(at, now, 1_000_000);
}

/** A reminder the sweep would send, its occurrence in microseconds. */
export type DueReminder = DueAt<Micros>;

export interface SubscriptionRow {
  endpoint: string;
  owner_id: string;
  p256dh: string;
  auth: string;
  user_agent: string | null;
  created_at: number;
  seen_at: number;
  failed_at: number | null;
}

const B64U = /^[A-Za-z0-9_-]+={0,2}$/;

export class Push {
  private sweeping = false;

  constructor(
    private readonly db: Db,
    private readonly now: () => Micros,
    private readonly keys: () => VapidKeys,
    private readonly transport: typeof fetch,
  ) {}

  /** Registers a device (§10): an upsert on the endpoint that clears `failed_at`. */
  subscribe(owner: string, input: Record<string, unknown>): void {
    const endpoint = input.endpoint;
    if (typeof endpoint !== "string" || endpoint.length > 2048) throw badRequest("endpoint must be a push service URL", "invalid_endpoint");
    const url = publicUrlShape(endpoint);
    if (!url || url.protocol !== "https:" || (url.port !== "" && url.port !== "443")) {
      throw badRequest("endpoint must be a public https URL on the standard port", "invalid_endpoint");
    }
    for (const key of ["p256dh", "auth"] as const) {
      const value = input[key];
      if (typeof value !== "string" || value.length === 0 || value.length > 256 || !B64U.test(value)) {
        throw badRequest(`${key} must be the browser's base64url key`, "invalid_subscription");
      }
    }
    const agent = input.user_agent;
    if (agent !== undefined && agent !== null && typeof agent !== "string") throw badRequest("user_agent must be a string or null");
    const seen = input.seen_at === undefined || input.seen_at === null ? this.now() : (instant("seen_at", input.seen_at, false) as Micros);

    const existing = this.db.prepare("select owner_id from push_subscriptions where endpoint = ?").get(endpoint) as
      | { owner_id: string }
      | undefined;
    if (existing && existing.owner_id !== owner) {
      throw rowRefused("not_owner", "That endpoint is registered to another account");
    }
    this.db.transaction(() => {
      if (!existing) {
        const count = (this.db.prepare("select count(*) as n from push_subscriptions where owner_id = ?").get(owner) as { n: number }).n;
        if (count >= MAX_SUBSCRIPTIONS_PER_USER) {
          this.db
            .prepare(
              `delete from push_subscriptions where endpoint in (
                 select endpoint from push_subscriptions where owner_id = ? order by seen_at limit ?)`,
            )
            .run(owner, count - MAX_SUBSCRIPTIONS_PER_USER + 1);
        }
      }
      this.db
        .prepare(
          `insert into push_subscriptions (endpoint, owner_id, p256dh, auth, user_agent, created_at, seen_at, failed_at)
           values (@endpoint, @owner, @p256dh, @auth, @agent, @now, @seen, null)
           on conflict (endpoint) do update set p256dh = excluded.p256dh, auth = excluded.auth,
             user_agent = excluded.user_agent, seen_at = excluded.seen_at, failed_at = null`,
        )
        .run({
          endpoint,
          owner,
          p256dh: input.p256dh,
          auth: input.auth,
          agent: typeof agent === "string" ? agent.slice(0, 512) : null,
          now: this.now(),
          seen,
        });
    })();
  }

  /** Unregisters a device of the caller's; anything else is nothing to do. */
  unsubscribe(owner: string, endpoint: unknown): void {
    if (typeof endpoint !== "string") throw badRequest("endpoint must be a string", "invalid_endpoint");
    this.db.prepare("delete from push_subscriptions where endpoint = ? and owner_id = ?").run(endpoint, owner);
  }

  live(owners: string[]): SubscriptionRow[] {
    if (owners.length === 0) return [];
    return this.db
      .prepare(`select * from push_subscriptions where failed_at is null and owner_id in (${owners.map(() => "?").join(", ")})`)
      .all(...owners) as SubscriptionRow[];
  }

  all(owner: string): SubscriptionRow[] {
    return this.db.prepare("select * from push_subscriptions where owner_id = ? order by created_at").all(owner) as SubscriptionRow[];
  }

  retire(endpoints: string[]): void {
    const stmt = this.db.prepare("update push_subscriptions set failed_at = ? where endpoint = ?");
    const now = this.now();
    this.db.transaction(() => {
      for (const endpoint of endpoints) stmt.run(now, endpoint);
    })();
  }

  /** Every reminder the sweep would send at `now` (§11.3). */
  due(now: Micros = this.now()): DueReminder[] {
    const rows = this.db
      .prepare(
        `select n.id, n.owner_id, n.reminder_at, n.reminder_repeat, n.body, d.reminder_at as delivered
           from notes n left join reminder_deliveries d on d.note_id = n.id
          where n.reminder_at is not null and n.status = 'active' and n.reminder_at <= ?`,
      )
      .all(now) as {
      id: string;
      owner_id: string;
      reminder_at: number;
      reminder_repeat: string | null;
      body: string;
      delivered: number | null;
    }[];
    const out: DueReminder[] = [];
    for (const row of rows) {
      const at = occurrence(row.reminder_at, row.reminder_repeat, now);
      if (at > now || at <= now - GRACE_US || row.delivered === at) continue;
      out.push({ note_id: row.id, owner_id: row.owner_id, reminder_at: at, reminder_repeat: row.reminder_repeat, body: row.body });
    }
    return out;
  }

  /** Records that an occurrence went; a note destroyed meanwhile records nothing. */
  recordDelivery(delivery: { note_id: string; owner_id: string; reminder_at: Micros }): void {
    this.db
      .prepare(
        `insert into reminder_deliveries (note_id, owner_id, reminder_at, fired_at)
         select @note_id, @owner_id, @reminder_at, @now where exists (select 1 from notes where id = @note_id)
         on conflict (note_id) do update set owner_id = excluded.owner_id, reminder_at = excluded.reminder_at, fired_at = excluded.fired_at`,
      )
      .run({ ...delivery, now: this.now() });
    // Closed: the per-device rows for it have done their job.
    this.db.prepare("delete from reminder_device_deliveries where note_id = ?").run(delivery.note_id);
  }

  /** The devices that already took this very occurrence. */
  deliveredTo(noteId: string, at: Micros): Set<string> {
    const rows = this.db
      .prepare("select endpoint from reminder_device_deliveries where note_id = ? and reminder_at = ?")
      .all(noteId, at) as { endpoint: string }[];
    return new Set(rows.map((r) => r.endpoint));
  }

  /** Records that one device took an occurrence (`_shared/deliveries.ts`). */
  recordDeviceDelivery(delivery: { note_id: string; owner_id: string; reminder_at: Micros }, endpoint: string): void {
    this.db
      .prepare(
        `insert into reminder_device_deliveries (note_id, endpoint, owner_id, reminder_at, fired_at)
         select @note_id, @endpoint, @owner_id, @reminder_at, @now where exists (select 1 from notes where id = @note_id)
         on conflict (note_id, endpoint) do update set reminder_at = excluded.reminder_at, fired_at = excluded.fired_at`,
      )
      .run({ ...delivery, endpoint, now: this.now() });
  }

  /**
   * One run of the sweep: sends what is due to each live device of its owner
   * that has not taken it yet, records an occurrence once every device has it
   * (`_shared/deliveries.ts`), retires endpoints answered 404/410. Never runs twice at once.
   */
  async sweep(): Promise<{ due: number; sent: number; retired: number }> {
    if (this.sweeping) return { due: 0, sent: 0, retired: 0 };
    this.sweeping = true;
    try {
      const now = this.now();
      const reminders = this.due(now);
      if (reminders.length === 0) return { due: 0, sent: 0, retired: 0 };
      const byOwner = new Map<string, SubscriptionRow[]>();
      for (const sub of this.live([...new Set(reminders.map((r) => r.owner_id))])) {
        const list = byOwner.get(sub.owner_id) ?? [];
        list.push(sub);
        byOwner.set(sub.owner_id, list);
      }
      const keys = this.keys();
      const retire: string[] = [];
      let sent = 0;
      for (const reminder of reminders) {
        const live = byOwner.get(reminder.owner_id) ?? [];
        // No device: not recorded, so a device registered within the grace
        // window still gets it.
        if (live.length === 0) continue;
        // Only the devices that have not taken this occurrence yet.
        const before = this.deliveredTo(reminder.note_id, reminder.reminder_at);
        const plan = devicesToSend(
          live.map((d) => d.endpoint),
          before,
          reminder.reminder_at / 1000,
          now / 1000,
        );
        if (plan.done) {
          this.recordDelivery(reminder);
          continue;
        }
        const devices = live.filter((d) => plan.send.includes(d.endpoint));
        const payload = notificationFor({
          note_id: reminder.note_id,
          reminder_at: formatInstant(reminder.reminder_at),
          body: reminder.body,
          reminder_repeat: reminder.reminder_repeat,
        });
        const ttl = ttlFor(reminder.reminder_at, now);
        const results = await Promise.all(
          devices.map(async (d) => ({ endpoint: d.endpoint, ...(await sendPush(d, payload, keys, ttl, this.transport)) })),
        );
        for (const result of results) {
          if (result.ok) {
            sent += 1;
            this.recordDeviceDelivery(reminder, result.endpoint);
          } else if (result.gone) {
            retire.push(result.endpoint);
          } else {
            console.error(`push to ${new URL(result.endpoint).host} failed: ${result.status}`);
          }
        }
        // Closed once every device has it or is gone for good; a device that
        // got no answer is tried again next sweep.
        if (doneAfter(results, before.size)) this.recordDelivery(reminder);
      }
      if (retire.length > 0) this.retire(retire);
      return { due: reminders.length, sent, retired: retire.length };
    } finally {
      this.sweeping = false;
    }
  }
}

