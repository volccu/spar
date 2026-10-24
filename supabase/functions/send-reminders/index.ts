// send-reminders — the sweep that makes a reminder mean something.
//
// Called once a minute by pg_cron (migration 0015). Finds every reminder that
// has come due and not yet been delivered, pushes it to each of that owner's
// live devices, and writes down that it went — so the next run a minute later
// does not send it again.
//
// Secrets (set via `supabase secrets set`):
//   VAPID_PUBLIC_KEY   — base64url, the same key the browser subscribes with
//   VAPID_PRIVATE_KEY  — base64url, the 32-byte scalar. Never leaves here.
//   VAPID_SUBJECT      — mailto: address the push service can complain to
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected by Supabase.
//
// Nothing in here is allowed to be clever about failure. A push that does not
// go is retried by the next sweep for as long as the reminder stays inside the
// grace window in `due_reminders`; after that it is dropped on purpose, because
// a notification for something that was due yesterday is noise, not a reminder.
//
// The one thing that is *not* retried is a push the push service accepted, and
// that is what `ttlFor` (`_shared/notification.ts`) exists for: acceptance is
// recorded as delivery, so the message has to stay alive at the push service
// for exactly as long as the reminder stays due — no longer, and above all no
// less.
import { adminClient } from "../_shared/db.ts";
import { sendPush, type PushSubscription, type VapidKeys } from "../_shared/webpush.ts";
import { notificationFor, ttlFor, type DueReminder } from "../_shared/notification.ts";

interface SubscriptionRow extends PushSubscription {
  owner_id: string;
}

function vapidFromEnv(): VapidKeys | null {
  const publicKey = Deno.env.get("VAPID_PUBLIC_KEY");
  const privateKey = Deno.env.get("VAPID_PRIVATE_KEY");
  const subject = Deno.env.get("VAPID_SUBJECT");
  if (!publicKey || !privateKey || !subject) return null;
  return { publicKey, privateKey, subject };
}

Deno.serve(async (req) => {
  // A token of its own, not the service role key.
  //
  // `verify_jwt` is off for this function because the only caller is pg_cron,
  // which is not a signed-in anybody. Turning it on would not have helped: it
  // accepts *any* valid token from this project, including the anon key that
  // ships in the client bundle, so it would have waved through every visitor.
  //
  // The obvious alternative — have cron present the service role key — puts the
  // most privileged credential in the project into a scheduled job's stored
  // arguments, where it is read by anything that can read the job. This token
  // can do exactly one thing: cause reminders that are already due to be sent.
  // Losing it is a nuisance, not a breach.
  const expected = Deno.env.get("CRON_SECRET");
  const offered = req.headers.get("x-cron-secret");
  if (!expected || offered !== expected) {
    return new Response(JSON.stringify({ error: "forbidden" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }

  const keys = vapidFromEnv();
  if (!keys) {
    // Loud, because this is the failure that looks exactly like "no reminders
    // were due" from the outside.
    console.error("VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT not set");
    return new Response(JSON.stringify({ error: "push keys not configured" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const db = adminClient();
  const { data: due, error: dueError } = await db.rpc("due_reminders");
  if (dueError) {
    console.error("due_reminders failed:", dueError.message);
    return new Response(JSON.stringify({ error: dueError.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const reminders = (due ?? []) as DueReminder[];
  if (reminders.length === 0) {
    return new Response(JSON.stringify({ due: 0, sent: 0 }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  // One query for the devices rather than one per reminder: this is a
  // single-user app, so the subscription list is a handful of rows and
  // fetching it once per sweep is cheaper than fetching it per note.
  const owners = [...new Set(reminders.map((r) => r.owner_id))];
  const { data: subsData, error: subsError } = await db
    .from("push_subscriptions")
    .select("endpoint, p256dh, auth, owner_id")
    .in("owner_id", owners)
    .is("failed_at", null);
  if (subsError) {
    console.error("subscription lookup failed:", subsError.message);
    return new Response(JSON.stringify({ error: subsError.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const subs = (subsData ?? []) as SubscriptionRow[];
  const byOwner = new Map<string, SubscriptionRow[]>();
  for (const s of subs) {
    const list = byOwner.get(s.owner_id) ?? [];
    list.push(s);
    byOwner.set(s.owner_id, list);
  }

  const retire: string[] = [];
  const delivered: DueReminder[] = [];
  let sent = 0;

  for (const reminder of reminders) {
    const devices = byOwner.get(reminder.owner_id) ?? [];
    if (devices.length === 0) {
      // Nowhere to send it. Deliberately *not* recorded as delivered: the user
      // may allow notifications on a device tomorrow, and while the reminder
      // is still inside the grace window it should find them when they do.
      continue;
    }

    // Composed once per reminder, sent once per device (`_shared/notification.ts`).
    const payload = notificationFor(reminder);
    // One TTL per reminder, not per device: it is a fact about how long this
    // occurrence is worth showing, and every device is being told the same
    // thing at the same moment.
    const ttl = ttlFor(reminder.reminder_at);
    const results = await Promise.all(
      devices.map((d) =>
        sendPush(d, payload, keys, ttl).then((r) => ({
          endpoint: d.endpoint,
          ...r,
        })),
      ),
    );

    let anyOk = false;
    for (const r of results) {
      if (r.ok) {
        anyOk = true;
        sent += 1;
      } else if (r.gone) {
        retire.push(r.endpoint);
      } else {
        console.error(`push to ${r.endpoint} failed: ${r.status} ${r.error ?? ""}`);
      }
    }

    // Written down only when it actually arrived somewhere. A sweep where
    // every device was unreachable leaves the reminder due, and the next
    // minute tries again.
    if (anyOk) delivered.push(reminder);
  }

  if (delivered.length > 0) {
    const { error } = await db.from("reminder_deliveries").upsert(
      delivered.map((r) => ({
        note_id: r.note_id,
        owner_id: r.owner_id,
        reminder_at: r.reminder_at,
        fired_at: new Date().toISOString(),
      })),
      { onConflict: "note_id" },
    );
    if (error) console.error("recording deliveries failed:", error.message);
  }

  if (retire.length > 0) {
    // Kept rather than deleted, so a device that comes back is one row to
    // clear instead of a mystery. The client's own re-subscribe clears it.
    const { error } = await db
      .from("push_subscriptions")
      .update({ failed_at: new Date().toISOString() })
      .in("endpoint", retire);
    if (error) console.error("retiring dead subscriptions failed:", error.message);
  }

  return new Response(
    JSON.stringify({ due: reminders.length, sent, retired: retire.length }),
    { headers: { "Content-Type": "application/json" } },
  );
});
