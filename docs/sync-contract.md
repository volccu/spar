# The sync contract

spår keeps every note on the device first (IndexedDB) and treats a server as a sync target. This
document is everything the web client relies on a server to do: which entities exist, which fields
they carry, who stamps which clock, how two devices' edits are merged, how a pull pages through
changes, how deletes survive an offline device, and what the client may call. It is written so a
second backend can be built against it and checked.

Two backends are held to it:

- **Supabase** — Postgres with row level security, the migrations in `supabase/migrations/`, the edge
  functions in `supabase/functions/`. This is the backend the contract was read off.
- **The spår server** — a single-process server (Node + SQLite) in `server/`, whose HTTP surface is
  [`docs/server-api.md`](server-api.md). It carries no known deviation: the suite holds it to every
  rule here in strict mode (`npm run test:conformance:server`, which needs nothing running).

The contract is enforced by the **conformance suite** in `conformance/`, which drives a backend only
through the operations in [§14](#14-the-client-facing-operations) and says which rule each test
checks. A rule here that the suite cannot check says so.

Words: **MUST** is a rule the client depends on and the suite checks; **SHOULD** is intended
behaviour a backend may miss without breaking the client today; **informative** paragraphs describe
what the client does with an answer, so a backend author knows why a rule exists. Where Supabase does
not meet a rule, the rule states the intended behaviour and [§16](#16-known-deviations-of-the-supabase-backend)
lists the deviation; the suite marks those tests as expected failures on that backend
(`it.fails`), so fixing one turns the suite red until the deviation is struck off.

Contents: [1 Vocabulary](#1-vocabulary) · [2 Ownership and isolation](#2-ownership-and-isolation) ·
[3 Notes](#3-notes) · [4 Per-field last-write-wins](#4-per-field-last-write-wins) ·
[5 Clocks](#5-clocks) · [6 Pulling changes: cursors](#6-pulling-changes-cursors) ·
[7 Trash, permanent delete and tombstones](#7-trash-permanent-delete-and-tombstones) ·
[8 Preferences and boards](#8-preferences-and-boards) · [9 Canvases](#9-canvases) ·
[10 Push subscriptions](#10-push-subscriptions) · [11 Reminders](#11-reminders) · [12 Files](#12-files) ·
[13 Link previews](#13-link-previews) · [14 The client-facing operations](#14-the-client-facing-operations) ·
[15 Live updates](#15-live-updates) · [16 Known deviations](#16-known-deviations-of-the-supabase-backend) ·
[17 Running the suite](#17-running-the-conformance-suite)

---

## 1. Vocabulary

**User, session.** Every operation is made by one signed-in user holding a session. The user's id is
a UUID; the client reads it from its own session without a network call (Supabase:
`auth.getSession()`), and never sends it as an owner on notes, canvases or prefs — the server takes
the owner from the session.

**Instants.** Two spellings exist and both mean an instant:

- A **client stamp** is always `Date.prototype.toISOString()`: `2026-09-27T12:00:00.123Z` — exactly
  24 characters, milliseconds, `Z`.
- A **server instant** is RFC 3339 with an explicit offset and up to six fractional digits, trailing
  zeros trimmed: `2026-09-27T12:00:00.123456+00:00`, `2031-01-01T00:00:01+00:00`.

A server MUST store and return instants with at least **microsecond** resolution (the `+1µs` floor
in [§5](#5-clocks) is observable), and MUST accept either spelling wherever it takes an instant
(cursors, `expected_updated_at`, stamps). Clients compare instants as instants (`cmpIso` in
`web/src/lib/versions.ts`), never as text — with one exception, the per-field clocks
([§4](#4-per-field-last-write-wins)).

**Ids.** Notes, canvases and attachments have client-made UUIDs. Wherever the contract orders by id,
the order is the byte order of the UUID, which equals the lexicographic order of its lowercase
canonical text (`0a…` < `1f…` < `a0…`).

**Entities.** Notes; tombstones (the record of a permanent delete); canvases (the arrangement of an
idea note — the Supabase table is still called `folders`); one preferences row per user (the user's
boards, i.e. folders, and the Inbox date); push subscriptions (one per device); reminder deliveries
(server bookkeeping); files (bytes, stored beside the note that carries their metadata).

---

## 2. Ownership and isolation

Every row belongs to exactly one user: the session that created it. A server MUST keep users apart
completely:

| # | Rule | Suite |
|---|------|-------|
| I1 | No read — a pull, a fetch by id, the combined pull, a tombstone pull, a canvas pull, the prefs read, a file download — ever returns another user's row or bytes. | `isolation`, `files` |
| I2 | A write naming another user's note id (upsert) is **refused**, and the other user's note is unchanged. | `isolation` |
| I3 | A narrow patch of another user's note changes nothing and reports nothing (it cannot reveal that the id exists). | `isolation` |
| I4 | A permanent delete of another user's note answers `false` and destroys nothing. | `isolation` |
| I5 | A canvas can only be written for an idea note the caller owns; otherwise the write is refused. | `isolation`, `prefs-and-canvases` |
| I6 | Each user has their own preferences row. | `isolation` |
| I7 | A push endpoint registered by one user cannot be taken over, changed or removed by another. | `isolation` |
| I8 | Files: a user may only write, read or remove under their own first path segment ([§12](#12-files)). A foreign path answers exactly as a missing one does. | `files` |
| I9 | Live change signals reach only the writer's own sessions ([§15](#15-live-updates)). | `realtime` — **Supabase deviates**, [§16](#16-known-deviations-of-the-supabase-backend) D1 |
| I10 | With no session, nothing is readable and nothing is writable. | `isolation` |
| I11 | Server-internal functions (the reminder projection and due list, tombstone pruning) are not callable by a client session. | not checked by the suite (no client operation reaches them) |

Supabase implements I1–I8 and I10 with row level security (`owner_id = auth.uid()` on every table,
migrations 0007, 0008, 0010, 0011, 0014, 0015), storage policies keyed on the path's first segment
(0005), and I11 with `revoke … from public, anon, authenticated` (0015, 0020, 0021, 0023). The `anon`
role holds no privilege on any table (0024, restated in 0025), and every table the client or the
sweep reads or writes is granted to `authenticated` and `service_role` explicitly, verb by verb
(0001, 0011, 0025) — nothing rests on a project's default privileges.

---

## 3. Notes

### 3.1 Fields

What the client writes on every upload and reads back. A server MAY hold more columns and MAY return
them; clients ignore keys they do not know. A server MUST NOT return `owner_id` to the client in the
combined pull.

| Field | Type as the client sees it | Null? | Merged by clock? | Notes |
|---|---|---|---|---|
| `id` | UUID | no | — | Made by the client. |
| `raw_content` | text | no | — | The original capture. **Immutable** (§3.3). |
| `body` | text | no | yes | What the user reads and edits. Defaults to `raw_content` on insert (§3.4). |
| `source` | text | no | no | `web`, `share`, `draw`, `import`, … Not interpreted. |
| `created_at` | instant | no | no | The client's stamp. |
| `updated_at` | instant | no | no | See [§5](#5-clocks). The key of the notes pull. |
| `note_type` | text | yes | yes | `todo`, `note` (an explicit "not a to-do"), `link`, …; null = never said. Not interpreted. |
| `board_id` | UUID | yes | yes | The user's folder (an id from the prefs `boards` list). No foreign key: a note may name a folder that was deleted. |
| `status` | text | no | yes | `active`, `archived` or `trashed`. |
| `priority` | integer | no | yes | 0 or 1. |
| `reminder_at` | instant | yes | yes | The reminder's anchor ([§11](#11-reminders)). |
| `reminder_repeat` | text | yes | yes | `daily`, `weekly`, `monthly`, or null. Any other value reads as null. |
| `done` | boolean | yes | yes | Carried and merged; no client reads it. |
| `merged_from` | UUID[] | yes | yes | On an idea: the notes it was composed from. |
| `merged_into` | UUID | yes | yes | On an archived source: the idea it went into. |
| `keep_id` | text | yes | no | Google Keep's id for an imported note. **Unique** when not null (§3.2). |
| `attachments` | JSON array | no (`[]`) | yes | Attachment metadata, opaque to the server: `{id, name, mime, size, width, height, thumb, path, added_at}`. `thumb` is a ≤320 px JPEG data URL; `path` is null until the bytes are uploaded ([§12](#12-files)). |
| `link_previews` | JSON array | no (`[]`) | yes | Preview metadata, opaque to the server: `{href, domain, title, description, image, fetched_at, gone?, checked_at?, hidden?}`. `hidden: true` is the owner putting that preview away; the server never reads it and must hand it back untouched, like any other key inside an entry. A client that does not know a key keeps it. |
| `field_updated_at` | JSON object `{field: client stamp}` | no (`{}`) | — | The per-field clocks ([§4](#4-per-field-last-write-wins)). |

`attachments` and `link_previews` are stored as sent and returned as JSON (a server may reorder the
keys of the objects inside; clients compare them structurally). A note written with neither carries
empty arrays, never null.

### 3.2 Writing a note

- **An upload is an upsert on `id`** carrying every column above (`toRow` in `web/src/store/sync.ts`).
  A new id is an insert; an existing one of the caller's is an update merged by [§4](#4-per-field-last-write-wins).
  Sending the same row twice stores one note. *(suite: `notes`)*
- **A batch is one statement.** An upload of several rows is accepted whole or refused whole; a
  refused batch stores none of its rows. *(suite: `notes`)* *Informative:* the client relies on this
  being atomic and bisects a refused batch to find the offending row
  (`send` in `web/src/store/sync.ts`).
- **Columns outside the merge set** — `source`, `created_at`, `keep_id` — are taken as sent on every
  accepted write. *(suite: `notes`)*
- **`keep_id` is unique per user**: `(owner, keep_id)` is unique when `keep_id` is not null. A second
  note of the same user carrying a taken `keep_id` is refused as a row; another user's note with the
  same `keep_id` is no concern of this user's and MUST be accepted. *(suite: `notes`)* Supabase:
  the unique index `notes_owner_id_keep_id_key` (0025); before 0025 the uniqueness spanned all users
  ([§16](#16-known-deviations-of-the-supabase-backend) D5).
  *Informative:* the importer skips notes it has already imported by this id.
- **A narrow patch** (`update … where id = ?`) changes only the named columns of an existing note of
  the caller's and **never creates one**; a patch of a missing or foreign id changes nothing and is
  not an error. *(suite: `notes`, `isolation`, `tombstones`)* The client uses it only to deliver a
  trashing it could not upsert ([§7.4](#74-a-refused-delete-informative)).

### 3.3 `raw_content` is immutable

Once a note exists, any write whose `raw_content` differs from the stored one MUST be refused as a
**row refusal**, and nothing about the note changes — not the body, not the stamps. This holds for
an upsert and for a narrow patch alike. A write repeating the same `raw_content` is fine.
*(suite: `notes`)* Supabase: `trg_notes_raw_immutable` (0001), SQLSTATE 23514.

### 3.4 The body defaults to the capture

- On **insert**, an empty (`''`) or null `body` MUST be stored as `raw_content`. *(suite: `notes`)*
  Supabase: `trg_body_defaults_to_capture` (0017, narrowed in 0025).
- On **update**, an empty body is the user emptying the note and MUST be stored as `''` — by a narrow
  patch *and* by an upsert. *(suite: `notes`)* An upsert's insert half is not a first insert: the
  default applies only when no row with that id exists yet. Before 0025 Supabase stored the capture
  when the update arrived as an upsert ([§16](#16-known-deviations-of-the-supabase-backend) D2).

### 3.5 Refusals

The client divides failures in two, and a backend MUST make the division visible:

- A **row refusal** — the server read the row and declined it: immutability, a tombstone, a unique
  or check constraint. Retrying the same row fails the same way. Supabase signals it as a SQLSTATE of
  class 22 or 23, or `P0001` (`namesTheRow` in `web/src/store/sync.ts`); the spår server as HTTP 409
  with `code: "row_refused"`, the refused row's `id` and a `reason`.
- **Anything else** — no session, an expired token, a gateway error, a dropped connection — is about
  the request, and the rows in it are blameless.

*Informative:* a row refusal is charged to that note, which is set aside ("held") after repeated
refusals so it stops blocking the outbox; a request failure is retried whole on the next tick and
charges nothing. Refusing another user's id (I2) SHOULD be a row refusal; Supabase answers it as a
permission error (`42501`), which the client reads as a request failure (D6); the spår server
answers it as a row refusal.

---

## 4. Per-field last-write-wins

Two devices editing different fields of one note must not lose either edit. Every client write
carries a clock per field; the server merges an incoming row into the stored one field by field.

### 4.1 The merge set

The fields merged by clock are exactly, in this order:

```
body, note_type, board_id, status, priority, reminder_at, reminder_repeat,
done, merged_from, merged_into, attachments, link_previews
```

This list MUST equal the client's `CONFLICT_FIELDS` (`web/src/lib/versions.ts`) and the array in the
newest `merge_note_field_versions` (migration 0020); `conformance/contract.test.ts` holds all three
together. A field missing from the server's set would silently fall back to whole-row
last-write-wins for that field.

### 4.2 Clocks

`field_updated_at` maps a field name to the client stamp of the last write to that field. Clients
MUST write clocks as canonical client stamps (`toISOString()`), because the Supabase merge compares
clocks as **text**; for canonical stamps text order and time order agree, and a backend MAY compare
them as instants instead. Behaviour for non-canonical clock strings is unspecified. A client with
per-field clocks sends a clock for every field in the merge set on every upload (`fieldClocks`).

### 4.3 The rule

On an **insert**, the row and its clock map are stored as sent. On an **update** of stored row `S` by
incoming row `W` (with clocks `Sc` and `Wc`):

1. If `Wc` is identical to `Sc` (JSON equality), nothing is merged: `W` is written as sent.
2. Otherwise, for each field `F` in the merge set:
   - `F` absent from `Wc` → `W.F` is written unconditionally, and the result has **no** clock for `F`
     (the stored clock is dropped).
   - `Wc[F]` is `null`, or `Sc[F]` exists and `Wc[F] <= Sc[F]` → **`W` loses `F`**: the stored value
     is kept and the result's clock for `F` is `Sc[F]` (absent if `Sc` had none).
   - otherwise (`Wc[F]` later, or `Sc` holds no clock for `F`) → **`W` wins `F`**: its value and clock
     are taken.
3. The result's clock map is `Wc` with those adjustments; keys outside the merge set are kept as sent.
4. Columns outside the merge set are written as sent ([§3.2](#32-writing-a-note)); `raw_content` must
   still be unchanged ([§3.3](#33-raw_content-is-immutable)).

The consequences a client relies on, each checked by the suite *(suite: `merge`)*:

| Case | Outcome |
|---|---|
| Newer clock | The field takes the incoming value and clock. |
| Older clock | The stored value and clock stay. |
| **Equal** clock | The incoming value **loses** (ties go to the stored row). |
| Fields in one write | Decided independently: one may win while another loses. |
| Result clocks | The per-field maximum of the two maps. |
| No stored clock for the field (an imported note) | Any clocked write wins it. |
| `null` clock | Loses; the stored clock is kept (or stays absent). |
| Field sent **without** a clock | Written unconditionally; its stored clock is forgotten. |
| Clock map identical to the stored one | The whole row is written as sent. |
| **No `field_updated_at` in the write at all** (a client without per-field clocks) | The whole row is written as sent and the stored clocks are kept — plain last-write-wins. |
| Every field loses | The values stay, and `updated_at` still moves forward ([§5](#5-clocks)). |

A clock map that is not a JSON object (an array, a string, JSON `null`) is unspecified; Supabase
treats such a write as a server-side patch that writes every column and keeps the stored clocks.
Clients never send one.

*Informative:* the client applies the mirror image when it pulls (`remoteIsNewer` and
`mergeNoteFields` in `web/src/lib/versions.ts`), so a pulled row only replaces a local field whose
clock is older, and an unsent local edit is never overwritten.

---

## 5. Clocks

Who stamps what:

| Stamp | Written by | Rule |
|---|---|---|
| per-field clocks | the client only | [§4](#4-per-field-last-write-wins). The server never invents one. |
| `notes.created_at` | the client | Stored as sent. |
| `notes.updated_at` | the client, floored by the server | Below. |
| `note_tombstones.deleted_at` | the server | Its own clock when the delete runs. |
| `folders.updated_at`, `prefs.updated_at` | the client | Stored exactly as sent, with no floor (§9, §8). |
| `reminder_deliveries.fired_at` | the server's sweep | — |
| `push_subscriptions.seen_at` | the client | Stored as sent. |

**`notes.updated_at`** — the key every notes pull pages by — follows these rules *(suite: `clocks`)*:

- **Insert:** stored exactly as sent, however far in the past. (Omitted: the server's clock.)
- **Update, sent stamp later than the stored one:** stored as sent.
- **Update, sent stamp earlier than the stored one:** stored as the stored stamp **plus one
  microsecond**.
- **Update, sent stamp equal to the stored one** (a note re-sent unchanged), **or no stamp in the
  write** (a narrow patch naming none): moved **strictly forward**. Supabase takes the server's clock
  or the stored stamp plus one microsecond, whichever is later (`touch_updated_at`, 0025); before
  0025 it took the server's clock alone, which moved backwards when the stored stamp was ahead of it
  ([§16](#16-known-deviations-of-the-supabase-backend) D3).

So after every accepted update `updated_at` is strictly greater than before, and equals the sent
stamp whenever that stamp is later. A server MUST NOT move a note's `updated_at` backwards: a pull
cursor never looks behind itself, so a row whose stamp falls behind another device's cursor is never
seen by that device again.

**The server's clock.** Every HTTP answer MUST carry an accurate `Date` header. *(suite: `clocks`)*
*Informative:* the client reads it off every answer (`web/src/store/serverClock.ts`) and uses it
three ways — it caps its saved pull cursors at the server's time, so a device with a fast clock
cannot drag a cursor into the future (`cappedAtServerTime`); it uploads each note and canvas stamped
no earlier than the server's time (`stampForUpload`), so a note written offline is not uploaded
behind the other device's cursor; and the trash sweep refuses to run until it has the server's time.

---

## 6. Pulling changes: cursors

### 6.1 The keyset

A **cursor** is `{at: instant, id: UUID | null}`. Every pull returns the caller's rows in ascending
`(time, id)` order — `updated_at, id` for notes and canvases, `deleted_at, note_id` for tombstones —
and starts after the cursor:

| Pull | Cursor with an id | Cursor with no id |
|---|---|---|
| notes | `time > at`, or `time = at and id > cursor.id` | `time > at` (**strictly after**) |
| tombstones | the same | `time > at` (strictly after) |
| canvases | the same | `time >= at` (**from the stamp, inclusive**) |

Instants are compared as instants, at microsecond precision, whatever their spelling. A page holds at
most `limit` rows. The client walks a keyset by passing the last row's `(time, id)` as the next
cursor until a page comes back short; the walk MUST return every row exactly once however the pages
cut a run of rows sharing one stamp. *(suite: `pull`)*

*Informative:* the canvas pull is inclusive with no id because a device may still hold a plain
timestamp saved before the cursor became a keyset, and re-reading one row is harmless where
skipping one is not. On each tick the client steps its saved cursor back over a short repair
window (two minutes on the first tick of a session or after a failure, fifteen seconds otherwise)
and drops the id (`repairStart` in `web/src/store/cursors.ts`), because a row can commit after the
client has read past its stamp; rows read twice are idempotent overwrites. Its saved cursor only
ever moves forward.

### 6.2 What a pull returns

- **Trashed and archived notes** are ordinary rows: a pull returns them like any other, with their
  status. *(suite: `pull`, `tombstones`)*
- **Permanently deleted notes** are absent from every note read, and are reported instead as a
  tombstone ([§7](#7-trash-permanent-delete-and-tombstones)).
- **An update moves a note forward**: once an update's `updated_at` passes a cursor, the next pull
  from that cursor returns the note again.
- **By id:** `notesById(ids)` returns the caller's notes among `ids`; unknown and foreign ids are
  simply absent. `noteState(id)` returns `{id, status, field_updated_at}` or nothing.

### 6.3 The combined pull

`pullChanges(notesCursor, tombstonesCursor, foldersCursor, limit)` answers four questions in one
round trip (Supabase: the `pull_changes` RPC, migration 0022):

```json
{
  "notes":      [ note rows, as in §3.1, in (updated_at, id) order ],
  "tombstones": [ { "note_id": "…", "deleted_at": "…" }, … ],
  "folders":    [ canvas rows, as in §9, in (updated_at, id) order ],
  "prefs":      { "boards": [ … ], "inbox_since": "…" | null, "updated_at": "…", … } | null
}
```

- Each list obeys its keyset in [§6.1](#61-the-keyset) and is limited to `limit` rows **separately**,
  so each is paged by its own cursor. *(suite: `pull`)*
- The answer MUST equal what the three separate pulls and the prefs read answer for the same cursors.
  *(suite: `pull`)*
- `prefs` is `null` for a user with no preferences row. No row carries `owner_id`.
- Rows MAY carry more keys than the client reads (Supabase returns every column of the table,
  including legacy ones); clients ignore them.

*Informative:* the client asks the combined pull first on every tick and continues a full page with
the separate pulls from where it ended; on a server without the combined pull (Supabase error
`PGRST202`) it falls back to the separate pulls for the rest of the session.

---

## 7. Trash, permanent delete and tombstones

### 7.1 Trash is a status

Deleting a note sets `status = 'trashed'` through an ordinary upload; the note stays whole, readable
and pulled, and is restored by writing the status back. *(suite: `tombstones`)* *Informative:* after
30 days the client's sweep destroys trashed notes permanently, and the user may empty the trash by
hand; those are the only two callers of the permanent delete.

### 7.2 Permanent delete

`permanentlyDeleteNote(id, expectedUpdatedAt) → boolean` (Supabase: `permanently_delete_note`,
migrations 0011 and 0019). It MUST answer **true** and destroy the note exactly when the note is
the caller's, its status is `trashed`, and **either**

- its `updated_at` is at or before `expectedUpdatedAt`, **or**
- no per-field clock in it is later than `expectedUpdatedAt` — the clocks compared as instants, values
  that are not dates ignored, and a note with no clocks at all counting as "nothing later".

Otherwise it answers **false** and changes nothing: the note is not trashed, is someone else's, does
not exist (including one already destroyed), or a client wrote a field after the expected stamp.
*(suite: `tombstones`)*

*Informative:* the second branch exists because the server may move `updated_at` on its own (§5)
while it can never invent a field clock, so "has any client written since I looked" is answered by
the clocks. For imported notes with no clocks the guard reduces to "is it still trashed".

When it answers true, in one transaction:

1. a **tombstone** `{note_id, deleted_at: server now}` is recorded (replacing any earlier one for that
   id);
2. the note row is deleted;
3. everything hanging off the note goes with it: its canvas (§9) *(suite: `tombstones`)* and its
   reminder delivery record (§11, not observable to a client).

Files are not part of this: the Supabase backend leaves the note's bytes in storage and the client
removes them itself after a confirmed delete (D7). A server MAY delete them itself; the spår server
does, once the transaction has committed, so the client's own removal then finds nothing.

### 7.3 Tombstones

- **Anti-resurrection.** While a tombstone exists, any upload of that note id by its owner — insert or
  update, any status — MUST be refused as a **row refusal**, and a narrow patch of it creates nothing.
  *(suite: `tombstones`)*
- **Pulled.** Tombstones are pulled by the keyset in [§6.1](#61-the-keyset) and in the combined pull.
- **Pruned after a year.** A tombstone older than **365 days** is forgotten (Supabase: the daily
  `prune_note_tombstones` job, 0021); after that the note id may be uploaded again. A tombstone younger
  than that is kept. The client forgets its own copies on the same horizon (`TOMBSTONE_DAYS` in
  `web/src/lib/trash.ts`); the two numbers MUST agree. *(suite: `tombstones`, `contract`)*

### 7.4 A refused delete (informative)

A false answer has two causes, and the client tells them apart with the reads above
(`deliverTrashing` in `web/src/store/sync.ts`): it reads `noteState(id)`; no row means the note is
already gone; a `status` clock newer than its own trashing means the other device really restored
the note, which is then fetched back; otherwise its own trashing never reached the server, so it
delivers it with one narrow patch (`status`, `updated_at`, the merged clocks) and asks for the
delete again. This is why [§3.2](#32-writing-a-note) requires that a narrow patch never create a row.

---

## 8. Preferences and boards

One row per user (Supabase: `prefs`, migrations 0014, 0016, 0018):

| Field | Type | Null? | Notes |
|---|---|---|---|
| `boards` | JSON array | no (`[]`) | The user's folders, opaque to the server: `{id, name, position, created_at, icon?, color?}`. Since 2026-09-29 it may also hold one entry `{id: "shelf-order", name, position, lenses: [...]}` carrying the order of the shelf's lenses; still opaque here, and the client reads it out of the folder list (`SHELF_ORDER_ID` in `web/src/lib/boards.ts`). |
| `inbox_since` | instant | yes | Where the Inbox starts: null = never answered; the epoch = "the whole pile". |
| `updated_at` | instant | no | Stored exactly as sent. |

- There is **no row** until the first upload; the read answers nothing. *(suite: `prefs-and-canvases`)*
- An upload writes **only the fields it carries** (plus `updated_at`): a date alone leaves the boards
  as they are, and boards alone leave the date. The first upload creates the row with the defaults
  above. *(suite: `prefs-and-canvases`)*
- The server applies **no conflict rule**: every upload is taken as sent, including an older
  `updated_at`. *(suite: `prefs-and-canvases`)*
- A **conditional upload** carries the `updated_at` the client read (or "no row"): it is written only
  while the row still holds that instant (or while there is still no row), and otherwise refused,
  writing nothing. Supabase: `write_prefs_if_unchanged(p_expected_at, p_boards, p_updated_at,
  p_set_since, p_inbox_since) → boolean` (migration 0028); the spår server: `PUT /api/prefs` with
  `expected_updated_at`, `412 prefs_moved` on a miss. The client sends every merged folder list this
  way, and on a miss reads, merges and sends again (audit DATA-1, 2026-10-10). A Supabase project
  without the function answers `PGRST202`, and the client falls back to the plain upload.
  *(suite: `prefs-and-canvases`)*

*Informative:* the conflict rule is the client's (`web/src/store/boardSync.ts`): a device uploads
only the fields it actually changed, and otherwise the server's row wins outright — so a device that
has never touched the shelf cannot wipe it by being newer.

---

## 9. Canvases

The arrangement of an idea note, one row per idea (Supabase: `folders`, migration 0010):

| Field | Type | Notes |
|---|---|---|
| `id` | UUID | **The idea note's own id.** The note must exist and be the caller's. |
| `items` | JSON array | `{note_id, x, y, width?}` for a note, `{attachment_id, x, y}` for a picture placed on the canvas (a file of the idea note; since 2026-10-28) — opaque to the server. A client splits them on read (`canvasFromRow`); an older one finds no note by an `attachment_id` entry, skips it and writes it back untouched. |
| `strokes` | JSON array | Pencil strokes — opaque. |
| `image_widths` | JSON object | attachment id → pixels — opaque. |
| `text_elements` | JSON array | Labels `{id, x, y, text, width?}` — opaque. |
| `created_at`, `updated_at` | instants | Stored exactly as sent. |

- Upload is an upsert on `id`; **every write replaces the whole row as sent**, whatever its stamp —
  there is no merge and no floor. *(suite: `prefs-and-canvases`)*
- A canvas for a note that does not exist, or is not the caller's, is refused. *(suite: `prefs-and-canvases`, `isolation`)*
- A canvas is destroyed with its note ([§7.2](#72-permanent-delete)).
- Pulled by the canvas keyset (inclusive with no id, [§6.1](#61-the-keyset)).

*Informative:* the client's rule is "remote wins unless this device has an arrangement still queued"
(`web/src/store/canvasSync.ts`): opening an idea invents a default layout that must never outrank a
real one, so the invented layout is never uploaded at all. Because the server keeps a canvas's stamp
as sent, the client uploads it stamped no earlier than the server's clock (`stampForUpload`), or the
row could land behind another device's cursor.

---

## 10. Push subscriptions

One row per device that has agreed to be woken (Supabase: `push_subscriptions`, migration 0015):
`endpoint` (text, the identity), `owner_id`, `p256dh`, `auth`, `user_agent` (nullable), `created_at`,
`seen_at`, `failed_at` (nullable).

- **Register** is an upsert on `endpoint` carrying `{endpoint, p256dh, auth, user_agent, seen_at,
  failed_at: null}` for the signed-in owner. Registering the same endpoint again updates that row in
  place (a browser re-subscribing returns the same endpoint); one row per device however often it
  registers. *(suite: `push`)*
- **Unregister** deletes by endpoint; an endpoint that is not registered is nothing to do. *(suite: `push`)*
- An endpoint registered by another user cannot be taken over, changed or removed (I7).
- **Retiring.** When the push service answers 404 or 410 for an endpoint, the sweep sets its
  `failed_at` and keeps the row; the sweep only ever sends to rows with `failed_at` null. The device
  registering again clears `failed_at` and brings the row back. *(suite: `push`)*
- A user's subscriptions go when the user does (Supabase: foreign key to `auth.users`, cascade).
- A server MAY refuse to register an endpoint it would not connect to — one that is not a public
  `https` URL — as a request failure. The spår server does (400), because the sweep connects to the
  endpoint from inside the instance's own network; Supabase stores any text.

*Informative:* the client registers when a reminder is set and permission is granted, refreshes the
row once on every start, and deletes it when the user turns ringing off on that device
(`web/src/store/push.ts`).

---

## 11. Reminders

### 11.1 On the note

`reminder_at` is the **anchor** of a series and `reminder_repeat` its rule (`daily`, `weekly`,
`monthly`, or null for "rings once"). Both are ordinary merged fields; setting a reminder schedules
nothing. **The server never writes a note** to deliver a reminder — not to advance the anchor, not to
record a delivery. *(suite: `reminders`)*

### 11.2 The occurrence projection

`occurrence(anchor, rule, now)` is the latest occurrence that is **not in the future**, or the anchor
itself while the whole series is still ahead:

- All arithmetic is in **UTC**.
- `daily` is 86 400 seconds and `weekly` 7 × 86 400 seconds, on the instant — so a daily reminder
  keeps its UTC time across a summer-time change, and shifts an hour on the wall clock.
- `monthly` is calendar months **measured from the anchor**, clamped to the last day of a shorter
  month: from 31 January the series is 28 February, 31 March, 30 April, 31 May. Every step is
  `anchor + n months`, never a step from the previous occurrence.
- No rule, or a rule the server does not know, projects to the anchor.
- The count of whole periods is estimated (exact for a fixed period; a count of month boundaries for
  a month), clamped at zero, then corrected down while `anchor + n·step > now` and up while
  `anchor + (n+1)·step <= now`, each at most four times.

This projection exists twice and the two MUST agree: the server's (Supabase: `reminder_occurrence`,
migration 0023) decides what rings, and the client's (`lastOccurrence` / `nextOccurrence` in
`web/src/lib/reminders.ts`) decides what the app shows. The suite holds the server to the golden
vectors in `web/src/test/reminderVectors.ts` — one table, derived by hand, which
`web/src/lib/reminders.test.ts` holds the client to as well — and compares the two projections across a deterministic sample of
400 triples weighted towards month ends, midnights and summer-time changes. *(suite: `reminders`)*

*Informative:* the app shows the **next** occurrence (the first not yet passed), so a repeating
reminder is never overdue. A monthly anchor near local midnight falls on the previous UTC day and is
projected on that UTC calendar day; storing a zone per note would be needed to change that, and is
not part of the contract.

### 11.3 What is due

A reminder is **due** — the sweep sends it — when all hold *(suite: `reminders`)*:

- the note has a `reminder_at` and is `active` (never archived or trashed);
- its occurrence `o = occurrence(reminder_at, reminder_repeat, now)` has passed: `o <= now`;
- `o` is less than a day old: `o > now − 1 day` (the **grace window**; a phone that was off for a week
  gets the latest occurrence once, not seven);
- no delivery is recorded for this note **at this instant `o`**.

Delivery is recorded per note as the **instant delivered**, not as a flag: a reminder moved to a new
time is due again, an unchanged one never fires twice, and each occurrence of a series fires once.
The due list carries `{note_id, owner_id, reminder_at: o (the occurrence), reminder_repeat, body}`.

### 11.4 The sweep (server-internal)

Every minute the server sends every due reminder to each live subscription of its owner as a Web
Push with `Urgency: high` and a TTL equal to what is left of the grace window (at least 60 seconds),
and records a delivery for `o` when at least one push service accepted it (HTTP 201). A reminder
with no live device is not recorded, so it is sent when a device registers within the grace window.
An endpoint answered 404 or 410 is retired (§10). Supabase: `pg_cron` → the `send-reminders` edge
function → `due_reminders`. The grace window is written in two places — `due_reminders`' default and
`GRACE_SECONDS` in `_shared/notification.ts`, which the function and the spår server both import — and
they MUST agree. *(suite: `contract`)*

The payload is JSON the service worker (`web/public/push-sw.js`) shows as it is:

```json
{ "note_id": "…", "title": "first line, ≤ 60 chars, or \"Reminder\"",
  "body": "the rest, ≤ 120 chars", "at": "the occurrence",
  "actions": [ { "action": "later", "title": "Later" }, { "action": "done", "title": "Done" } ] }
```

`actions` is empty for a repeating reminder (`supabase/functions/_shared/notification.ts`, which a
new backend can reuse as it is, with `_shared/webpush.ts`). VAPID keys sign each
push; the client subscribes with the public key.

---

## 12. Files

- **Where.** A file's bytes live at `<user id>/<note id>/<attachment id>` in a private store (Supabase:
  the `files` bucket, migration 0005). The note carries the metadata, including the thumbnail, in
  `attachments`; an attachment's `path` stays null until its bytes are uploaded, and the upload
  writes the path back into the note by an ordinary upload.
- **Upload** stores bytes at a path, **replacing** whatever is there (a retried upload). The content
  type is the file's MIME type. *(suite: `files`)*
- **Size.** A file of up to **50 MiB (52 428 800 bytes)** MUST be accepted and one byte more MUST be
  refused as too large, storing nothing. The client refuses larger files itself (`MAX_FILE_BYTES` in
  `web/src/lib/files.ts`). *(suite: `files`, `contract`)*
- **Ownership.** The first path segment MUST be the caller's own user id for every upload, download
  and removal. An upload under another user's folder, or under anything that is not a user id, is
  refused. A download of another user's file answers exactly as a missing file does (Supabase: 404
  "Object not found"). A removal of another user's path removes nothing. *(suite: `files`)*
- **Remove** deletes the named paths the caller owns; paths that hold nothing are not an error.
  Afterwards a download answers not found. *(suite: `files`)*

*Informative:* files upload after their note, three at a time, and a failed upload leaves `path` null
to be retried on the next tick (`web/src/store/attachments.ts`). A file whose removal failed is
remembered and retried on the next open.

---

## 13. Link previews

An endpoint that fetches a public web page's Open Graph metadata for the signed-in user, so the
browser need not (Supabase: the `link-preview` edge function).

**Request.** `POST` with a JSON body `{"url": string, "check"?: true}` and the user's session
(Supabase: `Authorization: Bearer <access token>`). `check: true` asks only whether the page is still
there and skips the picture.

**Answers:**

| Status | Body | When |
|---|---|---|
| 200 | `{url, title, description, image}` | An HTML page. `url` is the final address after redirects. `title` is `og:title`, `twitter:title` or `<title>`, else the host, at most 200 characters. `description` is at most 500 characters, or null. `image` is a `data:` URL of the first candidate picture that could be fetched (`og:image`, `og:image:url`, `og:image:secure_url`, `twitter:image`, `twitter:image:src`, `image`, `<link rel="image_src">`), or null — always null for `check: true`. |
| 200 | `{url, title: "", description: null, image: null, gone: true, status}` | The page answered **404 or 410**, and only those. |
| 400 | `{error}` | The body is not JSON, or the address is not a public http(s) web address (below), or a redirect leads to one. |
| 401 | `{error}` | No user session (the public API key alone is refused). |
| 405 | `{error}` | Not `POST` (`OPTIONS` answers the CORS preflight with 200). |
| 415 | `{error}` | The answer was not `text/html` or `application/xhtml+xml`. |
| 502 | `{error}` | Anything else: another status (403, 5xx, …), more than 3 redirects, a timeout, a network failure. |

**Protections.** The endpoint MUST refuse (400), before any request is made:
schemes other than `http`/`https`; addresses carrying a user name or password; `localhost`,
`*.localhost`, `*.local`, and the cloud metadata names; IPv4 literals in `0/8`, `10/8`, `100.64/10`,
`127/8`, `169.254/16`, `172.16/12`, `192.0/16`, `192.168/16`, `198.18/15`, and `224/4` and above;
decimal and hexadecimal integer hosts; **every** IPv6 literal; and any host name that does not resolve,
or resolves (A or AAAA) to any of those ranges or to a private or reserved IPv6 address. Every
redirect (at most 3) is re-checked the same way before it is followed, and so is every picture
address. Reads are bounded: 8 seconds for the page and 8 for the picture, the first 512 KiB of HTML,
pictures of at most 3 MiB and only `image/*`. *(suite: `link-preview`)* A server SHOULD also pin the
address it checked for the request it makes (no DNS rebinding between the check and the fetch), and
treat NAT64 (`64:ff9b::/96`) and 6to4 (`2002::/16`) addresses embedding a private IPv4 address as
private. Both implementations treat IPv6 as public only inside global unicast (`2000::/3`), with
IPv4-mapped, NAT64 and 6to4 addresses judged by their IPv4 address and Teredo refused, ask only for
ports 80 and 443, and limit each user to a burst of 30 previews and one more every 2 seconds (429).
The spår server also pins the address; the Supabase function cannot — Deno's `fetch` resolves again
and cannot be pinned — so DNS rebinding remains a residual risk there, and its rate limit is held
per isolate in memory, not per account (`supabase/functions/_shared/netguard.ts`, `rateLimit.ts`;
2026-10-10, audit SEC-3).

**CORS.** The answer names `access-control-allow-origin` only for origins on the instance's
allow-list (Supabase: the `ALLOWED_ORIGINS` secret, plus the local development server; the spår
server: `SPAR_ALLOWED_ORIGINS`, plus the local development server). A browser
throws away an answer without it, which looks to the client like a transport failure.
*(suite: `link-preview`, where the driver can see the header — not on the local Supabase stack,
whose gateway stamps `*` on every function answer)*

*Informative:* the client writes a verdict into the note only for an answer about the page — 200,
and 400, 413 or 415 — and treats every other status and every transport failure as "ask again
later" (`web/src/store/useLinkUnfurl.ts`). The picture is shrunk to a small JPEG before it is stored
in `link_previews`. A monthly re-check sends `check: true` and writes only `gone` and `checked_at`.

---

## 14. The client-facing operations

The whole backend surface of the web client, as found in its store modules (`web/src/store/`;
the files named below are the ones that use each operation). This is the interface a client
backend adapter implements — the web client's is `Backend` in `web/src/store/backend/types.ts`,
and every call to the Supabase client is in `web/src/store/backend/supabaseBackend.ts` — and the
conformance driver (`conformance/driver.ts`) mirrors it one for one. Every operation acts as the
signed-in user. The spår server's request for each is in
[`docs/server-api.md`](server-api.md#mapping-the-clients-operations).

**Auth and session** (`useAuth.ts`, `useNotes.ts`, `session.ts`, `supabase.ts`, `attachments.ts`, `push.ts`)

| Operation | In → out | Fails how |
|---|---|---|
| `session()` | → `{userId} \| null` | Never; read locally, no round trip. |
| `hasStoredSession()` | → boolean, synchronously | Never. Decides whether first paint may wait for sign-in. |
| `onSessionChange(cb)` | → unsubscribe | — The client purges the device store when the user id changes. |
| `signIn(…)` | backend-specific → sent / error | A message to show. Supabase: a magic link (`signInWithOtp`, `shouldCreateUser: false`, `emailRedirectTo` the app's origin). The spår server: email and password. |
| `signOut()` | → ok / error | A network failure leaves the session in place and is reported. |
| server clock | every answer's `Date` header | — ([§5](#5-clocks)). |

**Capability** (`capability.ts`, `sync.ts`, `boardSync.ts`, `canvasSync.ts`): `supports(feature) →
yes | no | unknown`, asked once per session per feature (files, link previews, `merged_into`,
per-field clocks, boards, repeating reminders, tombstones, canvases, prefs, the Inbox date, the
combined pull). "Unknown" — a transient failure — is never remembered, so the next tick asks again.
A conforming backend supports everything in this document; the probes exist for a Supabase schema
that lags the client, and an adapter for a backend that ships with the client may answer yes to all.

**Notes** (`sync.ts`, `pullChanges.ts`)

| Operation | In → out | Fails how |
|---|---|---|
| `upsertNotes(rows)` | full rows ([§3.1](#31-fields)) → ok | Row refusal (the batch is refused whole) / request failure ([§3.5](#35-refusals)). |
| `pullNotes(after, limit)` | cursor → rows | Request failure. |
| `notesById(ids)` | ids → the caller's rows among them | Request failure. |
| `noteState(id)` | → `{id, status, field_updated_at} \| null` | Request failure. |
| `patchNote(id, {status, updated_at, field_updated_at})` | → ok; never creates | Row refusal / request failure. |
| `permanentlyDeleteNote(id, expectedUpdatedAt)` | → boolean ([§7.2](#72-permanent-delete)) | Request failure (retried next tick). |
| `pullTombstones(after, limit)` | cursor → `{note_id, deleted_at}[]` | Request failure. |
| `pullChanges(cursors…, limit)` | → `{notes, tombstones, folders, prefs}` ([§6.3](#63-the-combined-pull)) | Not supported (fall back to the separate pulls) / request failure. |

**Canvases** (`canvasSync.ts`): `upsertCanvases(rows) → ok` (refused per row when the idea is not
the caller's); `pullCanvases(after, limit) → rows`.

**Preferences** (`boardSync.ts`): `upsertPrefs({boards?, inbox_since?, updated_at}) → ok`;
`writePrefsIf({boards, inbox_since?, updated_at}, readAt | null) → written?` (§8, conditional);
`readPrefs() → {boards, inbox_since, updated_at} | null`.

**Push** (`push.ts`): `upsertPushSubscription({endpoint, p256dh, auth, user_agent, seen_at,
failed_at: null}) → ok`; `deletePushSubscription(endpoint) → ok`. A failure is logged and reported
as "cannot ring here yet"; it never blocks anything else.

**Files** (`attachments.ts`): `uploadFile(path, bytes, contentType) → ok | too large | refused |
failed`; `downloadFile(path) → bytes | not found | failed`; `removeFiles(paths) → ok | failed`
(a failed removal is remembered and retried).

**Link preview** (`useLinkUnfurl.ts`): `linkPreview({url, check?}) → answer | status | no answer`
([§13](#13-link-previews)).

**Live updates** (`useSync.ts`): `subscribe(table, onSignal) → unsubscribe`, for `notes`, `folders`
and `prefs` ([§15](#15-live-updates)). A channel that fails to open is logged; the 20-second backstop
tick keeps the app in step without it.

---

## 15. Live updates

A change signal tells a client "something in this table changed; sync now". The client never applies
a signal's contents: it reads `new.id` and `new.updated_at` only to recognise the echo of its own
upload (`web/src/store/echo.ts`), and otherwise starts a sync tick after a short debounce.

- A write to a note, a canvas or the prefs row MUST signal the writer's own sessions, and the
  signal for an insert or update SHOULD carry the new row. A permanent delete MUST signal them too.
  *(suite: `realtime` — which does check that a note update's signal carries the new row, so for a
  note update the SHOULD is held as a MUST; both backends carry every row.)*
- A signal MUST NOT reach any other user — not for an insert, an update or a delete. *(suite:
  `realtime`; Supabase deviates for deletes, D1)*

---

## 16. Known deviations of the Supabase backend

Places where the Supabase backend does not meet the contract, or did not until a migration fixed
it. An open one is a test marked as an expected failure on that driver, or a note on the environment.

**Fixed in 0025, pending on hosted projects until applied.** Migration
`0025_sync_contract_repairs.sql` fixes D2, D3, D4 and D5, and the Supabase driver no longer declares
them, so the suite holds a stack that has run 0025 to the rule. A hosted project is fixed only once
0025 has been pushed to it (`npm run db:push`); until then it still behaves as each entry below
describes. D1, D6 and D7 are open, each for the reason given.

**D1 — A delete signal reaches other users.** *Open.* Supabase Realtime does not apply row level
security to `DELETE` events, so every user subscribed to `notes` (or `folders`) is told the primary
key of any row another user permanently deletes. The row's contents are not sent. *Deviation
`realtime-delete-reaches-other-users`.* It stays because the only fix available in SQL — leaving
`DELETE` out of the publication — would also silence the owner's own devices, which [§15](#15-live-updates)
requires to be signalled and which the client relies on: `useSync.ts` binds every event on `notes`
and `folders` and starts a sync tick on any of them, so a note destroyed on one device leaves the
other at once instead of on the 20-second backstop. Moving the signal to something RLS does filter
(a tombstone insert) needs a client change as well as a migration. The spår server's per-user event
stream does not have it: a signal is written only to the owner's own streams.

**D2 — An upsert could not empty a note's body.** *Fixed in 0025, pending on hosted projects until
applied.* The body-defaults-to-capture trigger (0017) is a `BEFORE INSERT` trigger, and an upsert
that updates an existing row runs the insert half first: Postgres hands the trigger-modified row to
`ON CONFLICT DO UPDATE` as `excluded`. So a client that emptied a note's words uploaded `body: ''`
with a new body clock, and the server stored the original capture under that clock. Other devices
then pulled the capture as the newest body, while the device that emptied the note kept `''` (its
clock is equal, so it does not take the server's value) — the two disagreed until the next edit.
0025 makes the trigger look the id up (only when the body is empty or missing, so an ordinary
capture costs nothing) and default the body only when no row exists yet. *Was deviation
`upsert-cannot-empty-body`.*

**D3 — Re-sending a stamp could move `updated_at` backwards.** *Fixed in 0025, pending on hosted
projects until applied.* When an update's `updated_at` equalled the stored one, `touch_updated_at`
(0013) set it to the server's `now()` with no floor. If the stored stamp was ahead of the server's
clock (a device with a fast clock), the note's stamp moved backwards. 0025 takes the server's clock
or the stored stamp plus one microsecond, whichever is later. *Was deviation
`equal-stamp-restamp-can-go-backwards`.*

**D4 — A fresh project could not reach four tables.** *Fixed in 0025, pending on hosted projects
until applied* (a hosted project created before 2026-05-30 already holds these privileges through its
default ones, so there 0025 changes nothing). No migration granted privileges on `folders`, `prefs`,
`push_subscriptions` or `reminder_deliveries`; the project the migrations were written against
exposed every new table to the API roles by default. A Supabase project or stack created with the
current default (new tables not exposed) gave `authenticated` and `service_role` no `SELECT`,
`INSERT`, `UPDATE` or `DELETE` on them, so canvases, boards, the combined pull and push registration
failed, and so did the reminder sweep's writes. 0025 grants what the client and the sweep use, verb by
verb, and nothing to `anon`; the conformance stack now starts with the new default pinned
(`SUPABASE_API_AUTO_EXPOSE_NEW_TABLES=false`, [§17](#17-running-the-conformance-suite)) and passes on
the migrations' own grants.

**D5 — `keep_id` was unique across all users**, not per user (`keep_id text unique`, migration
0001). *Fixed in 0025, pending on hosted projects until applied.* Two accounts importing Keep notes
with the same id collided: the second import's row was refused, and its owner learned that the id
existed in someone else's archive. 0025 replaces the global uniqueness with the unique index
`notes_owner_id_keep_id_key` on `(owner_id, keep_id)`, which the spår server implements too. *Was
deviation `keep-id-unique-across-users`.*

**D6 — Another user's id is refused as a permission error.** *Open.* An upsert naming another user's
note or endpoint fails with SQLSTATE `42501`, which the client classifies as a request failure rather
than a row refusal, so it would retry that batch whole instead of bisecting it. Unreachable in
practice: note ids are random UUIDs made by the client. Turning it into a row refusal would take a
`security definer` lookup across every account's notes on every insert, the hottest write path there
is, for a case no client produces.

**D7 — Files outlive their note.** *Open.* Nothing on the server removes a note's bytes when the note
is permanently deleted; the client removes them after a confirmed delete and retries failed removals.
Bytes whose removal never succeeds stay in storage. It cannot be done from SQL: Supabase's
`protect_objects_delete` trigger refuses a direct delete from `storage.objects` ("Use the Storage API
instead"), since the row only indexes bytes held in the object store.

**Legacy columns.** The combined pull returns every column of `notes`, including ones from an earlier
design (`title`, `gist`, `summary`, `tags`, `fts_doc`, `warmth`, …). Clients ignore them; a new
backend need not have them, nor the unused `interactions` table.

**Environment notes for the local stack**, not deviations of the backend: the local gateway stamps
`Access-Control-Allow-Origin: *` on every function answer, so the link-preview allow-list cannot be
observed there; and `[auth.email] enable_signup = false` in `supabase/config.toml` switches the email
provider off entirely in a local stack, so the conformance stack turns email sign-in back on (sign-up
stays off) to match the hosted shape.

---

## 17. Running the conformance suite

The suite lives in `conformance/` and is **not** part of `npm test`. Against Supabase it needs a
running local stack; against the spår server it needs nothing, because the driver starts the server
itself in the test process (a throwaway data folder, a random loopback port), which is why CI runs
that one on every push.

```bash
npm ci                                   # the Supabase CLI is a dev dependency
npm run conformance:stack -- start       # local Supabase, loopback only, migrations applied
npm run test:conformance                 # SPAR_CONFORMANCE_BACKEND defaults to supabase
npm run conformance:stack -- stop        # containers, volumes and network removed

npm run test:conformance:server          # the spår server: boots in-process, strict mode, no stack
```

`scripts/conformance-stack.mjs` starts the stack under its own project id (`spar-conformance`, or
`SUPABASE_PROJECT_ID`), on a Docker network created with
`com.docker.network.bridge.host_binding_ipv4=127.0.0.1` so every published port binds loopback only
(Docker's published ports bypass a host firewall), and reads the bindings back afterwards, stopping
the stack if any is not on `127.0.0.1`. It pins `SUPABASE_API_AUTO_EXPOSE_NEW_TABLES=false` — the
default of every project made since 2026-05-30, so a table reaches the API roles only through a
grant a migration wrote (D4) — and sets `SUPABASE_AUTH_EMAIL_ENABLE_SIGNUP=true` (sign-in on;
`[auth] enable_signup = false` keeps sign-up off). Test users are made with the service-role key through the admin API. The driver refuses to run
against anything but `127.0.0.1` or `localhost`.

Environment:

| Variable | Effect |
|---|---|
| `SPAR_CONFORMANCE_BACKEND` | `supabase` (default) or `spar-server` (the spår server, booted in-process). |
| `SPAR_SUPABASE_URL`, `SPAR_SUPABASE_ANON_KEY`, `SPAR_SUPABASE_SERVICE_ROLE_KEY` | Use these instead of asking the local stack. |
| `SPAR_CONFORMANCE_INTERNET=1` | Also run the link-preview tests that fetch real pages (example.com, httpbin.org). Off by default. |
| `SPAR_CONFORMANCE_LINK_PREVIEW=0` | Skip the link-preview file (no edge runtime). |
| `SPAR_CONFORMANCE_REALTIME=0` | Skip the live-update file. |
| `SPAR_CONFORMANCE_STRICT=1` | Claim no known deviations, to watch each one fail for its reason. |

**Adding a backend** means one file beside `conformance/drivers/supabase.ts` implementing
`ConformanceDriver`, and one case in `conformance/drivers/index.ts`. The driver translates the calls
and maps failures onto `BackendError` kinds; it declares which deviations it carries (ideally none)
and which optional parts it can exercise (`can`). The `ServerHooks` it provides reach server-internal
behaviour — the reminder projection, the due list, deliveries, tombstone pruning, retiring an
endpoint — which a client never calls but the contract still binds.
