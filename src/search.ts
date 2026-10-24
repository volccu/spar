import type Database from "better-sqlite3";
import { fileURLToPath } from "node:url";
import { openDb } from "./db.js";
import { ftsSearch } from "./search/fts.js";
import { renderSearchReport, openReport } from "./report.js";

export interface SearchHit {
  id: string; title: string | null; gist: string | null;
  note_type: string | null; status: string; raw_content: string; score: number;
}

const CANDIDATES = 50;

/** Keyword-only search (FTS5 bm25 ranking). The semantic/embedding half was removed with the AI layer. */
export function search(db: Database.Database, query: string): SearchHit[] {
  const ids = ftsSearch(db, query, CANDIDATES);

  const byId = db.prepare(
    "SELECT id, title, gist, note_type, status, raw_content FROM notes WHERE id = ?"
  );
  const hits: SearchHit[] = ids.map((id, rank) => {
    // The SELECT above names exactly the columns of a hit bar its score,
    // which is worked out here — so that is what the row is.
    const row = byId.get(id) as Omit<SearchHit, "score">;
    // rank-based score (best match first); archived notes ranked lower
    const base = 1 / (rank + 1);
    const penalty = row.status === "archived" ? 0.5 : 1;
    return { ...row, score: base * penalty };
  });
  return hits.sort((a, b) => b.score - a.score).slice(0, 20);
}

function printHits(hits: SearchHit[]): void {
  for (const h of hits) {
    const muted = h.status === "archived" ? " (archived)" : "";
    console.log(`\n• ${h.title ?? "(un-enriched)"}${muted}  [${h.note_type ?? "?"}]`);
    console.log(`  ${h.gist ?? h.raw_content.slice(0, 80)}`);
  }
}

// CLI
if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const html = args.includes("--html");
  const query = args.filter((a) => a !== "--html").join(" ");
  if (!query) { console.error('usage: npm run search -- "<query>" [--html]'); process.exit(1); }
  const db = openDb();
  const hits = search(db, query);
  if (html) {
    openReport(renderSearchReport(query, hits), "search");
  } else {
    printHits(hits);
  }
}
