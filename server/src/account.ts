/**
 * Taking everything out, and taking everything away.
 *
 * The export is the app's own archive (`web/src/lib/exportArchive.ts`, the
 * same function the app's "Export everything" builds its zip with), fed from
 * the server's copy instead of the device's: every note as a text file in its
 * place, its files beside it, and the lot again as `spår.json`.
 */
import { planArchive, writeArchive } from "../../web/src/lib/exportArchive";
import type { Attachment, Canvas, Note, UserBoard } from "../../web/src/types";
import type { CanvasDbRow, PrefsDbRow } from "./canvases";
import type { FileStore } from "./files";
import type { NoteRecord } from "./notes";
import { formatInstant, formatNullable } from "./time";
import { isPlainObject } from "./values";

function str(value: unknown, fallback: string): string {
  return typeof value === "string" && value !== "" ? value : fallback;
}

/** Attachments as the archive reads them: whatever a client stored, made safe to name. */
function attachmentsOf(value: unknown[]): Attachment[] {
  return value.filter(isPlainObject).map((a, i) => ({
    id: str(a.id, `file-${i + 1}`),
    name: str(a.name, "file"),
    mime: typeof a.mime === "string" ? a.mime : "",
    size: typeof a.size === "number" ? a.size : 0,
    width: typeof a.width === "number" ? a.width : null,
    height: typeof a.height === "number" ? a.height : null,
    thumb: typeof a.thumb === "string" ? a.thumb : null,
    path: typeof a.path === "string" ? a.path : null,
    added_at: typeof a.added_at === "string" ? a.added_at : "",
    ...(typeof a.ref === "number" ? { ref: a.ref } : {}),
  }));
}

export function archiveNote(n: NoteRecord): Note {
  return {
    id: n.id,
    raw_content: n.raw_content,
    body: n.body,
    source: n.source,
    created_at: formatInstant(n.created_at),
    updated_at: formatInstant(n.updated_at),
    note_type: n.note_type as Note["note_type"],
    board_id: n.board_id,
    status: n.status as Note["status"],
    priority: n.priority,
    reminder_at: formatNullable(n.reminder_at),
    reminder_repeat: n.reminder_repeat as Note["reminder_repeat"],
    done: n.done,
    merged_from: n.merged_from,
    merged_into: n.merged_into,
    keep_id: n.keep_id,
    attachments: attachmentsOf(n.attachments),
    link_previews: n.link_previews as Note["link_previews"],
    field_updated_at: (isPlainObject(n.field_updated_at) ? n.field_updated_at : {}) as Record<string, string>,
  };
}

function boardsOf(prefs: PrefsDbRow | null): UserBoard[] {
  if (!prefs) return [];
  const parsed = JSON.parse(prefs.boards) as unknown;
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter(isPlainObject)
    .filter((b) => typeof b.id === "string" && b.id !== "")
    .map((b, i) => ({
      ...(b as object),
      id: b.id as string,
      name: str(b.name, "Folder"),
      position: typeof b.position === "number" ? b.position : i,
    }));
}

function canvasOf(row: CanvasDbRow): Canvas {
  return {
    id: row.id,
    idea_id: row.id,
    items: JSON.parse(row.items),
    strokes: JSON.parse(row.strokes),
    image_widths: JSON.parse(row.image_widths),
    text_elements: JSON.parse(row.text_elements),
    created_at: formatInstant(row.created_at),
    updated_at: formatInstant(row.updated_at),
  };
}

export async function exportArchive(
  owner: string,
  input: { notes: NoteRecord[]; prefs: PrefsDbRow | null; canvases: CanvasDbRow[] },
  files: FileStore,
  now = new Date(),
): Promise<{ bytes: Uint8Array; fileName: string }> {
  const plan = planArchive({
    notes: input.notes.map(archiveNote),
    folders: boardsOf(input.prefs),
    canvases: input.canvases.map(canvasOf),
    now,
  });
  const result = await writeArchive(plan, (att) => (att.path ? files.readBytes(owner, att.path) : Promise.resolve(null)), undefined, now);
  return { bytes: new Uint8Array(await result.blob.arrayBuffer()), fileName: result.fileName };
}
