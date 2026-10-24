export interface KeepAnnotation {
  source?: string;
  title?: string;
  url?: string;
  description?: string;
}
export interface KeepListItem {
  text?: string;
  isChecked?: boolean;
}
export interface KeepAttachment {
  filePath?: string;
  mimetype?: string;
}
export interface KeepNote {
  title?: string;
  textContent?: string;
  listContent?: KeepListItem[];
  annotations?: KeepAnnotation[];
  attachments?: KeepAttachment[];
  labels?: { name?: string }[];
  isTrashed?: boolean;
  isArchived?: boolean;
  isPinned?: boolean;
  createdTimestampUsec?: number;
  userEditedTimestampUsec?: number;
}

export interface ParsedNote {
  keep_id: string;
  raw_content: string;
  tags: string[];
  status: "active" | "archived";
  pinned: boolean;
  created_at: string;
  last_interacted_at: string;
  has_enrichable_text: boolean;
  source: "import";
}

export function usecToIso(usec: number): string {
  return new Date(Math.round(usec / 1000)).toISOString();
}

export function parseKeepNote(json: KeepNote, keepId: string): ParsedNote | null {
  if (json.isTrashed) return null;

  const userSections: string[] = []; // sections that count as "enrichable text"
  const trailing: string[] = []; // image breadcrumbs (do NOT count as enrichable)

  // 1. user-written title (prepended so it survives the AI title layer)
  const title = (json.title ?? "").trim();
  if (title) userSections.push(title);

  // 2. body: textContent, or a checklist rendered from listContent
  const body = (json.textContent ?? "").trim();
  if (body) {
    userSections.push(body);
  } else if (json.listContent?.length) {
    const lines = json.listContent
      .map((it) => `[${it.isChecked ? "x" : " "}] ${(it.text ?? "").trim()}`)
      .join("\n");
    userSections.push(lines);
  }

  // 4. weblink block (built here so we can decide enrichability; placed after user text below)
  const links = (json.annotations ?? [])
    .filter((a) => a.source === "WEBLINK")
    .map((a) => {
      const parts = [a.title, a.url, a.description].map((p) => (p ?? "").trim()).filter(Boolean);
      return `Saved link: ${parts.join(" — ")}`;
    });

  // 3. image breadcrumbs (trailing, non-enrichable on their own)
  for (const att of json.attachments ?? []) {
    if (att.filePath) trailing.push(`[image attachment: ${att.filePath}]`);
  }

  const hasEnrichable = userSections.length > 0 || links.length > 0;

  const allSections = [...userSections, ...links, ...trailing];
  const raw_content = allSections.join("\n\n");

  return {
    keep_id: keepId,
    raw_content,
    tags: (json.labels ?? []).map((l) => (l.name ?? "").trim()).filter(Boolean),
    status: json.isArchived ? "archived" : "active",
    pinned: !!json.isPinned,
    created_at: usecToIso(json.createdTimestampUsec ?? 0),
    last_interacted_at: usecToIso(json.userEditedTimestampUsec ?? json.createdTimestampUsec ?? 0),
    has_enrichable_text: hasEnrichable,
    source: "import",
  };
}
