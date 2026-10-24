import { mkdirSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { join } from "node:path";
import type { SearchHit } from "./search.js";


function esc(s: unknown): string {
  return String(s ?? "")
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
const STYLE = `<style>
body{font:15px/1.5 system-ui,sans-serif;margin:2rem;max-width:1100px}
.card{border:1px solid #ccc;border-radius:8px;padding:1rem;margin:1rem 0}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:1rem}
.raw{white-space:pre-wrap;background:#f6f6f6;padding:.75rem;border-radius:6px}
.title{font-weight:600;font-size:1.1rem}.gist{color:#333}.meta{color:#777;font-size:.85rem}
.prev{color:#999;text-decoration:line-through}.archived{opacity:.55}
@media(prefers-color-scheme:dark){body{background:#111;color:#ddd}.raw{background:#1c1c1c}.card{border-color:#333}}
</style>`;

export function renderSearchReport(query: string, hits: SearchHit[]): string {
  const cards = hits.map((h) => `<div class="card ${h.status === "archived" ? "archived" : ""}">
    <div class="title">${esc(h.title ?? "(un-enriched)")}</div>
    <div class="gist">${esc(h.gist ?? h.raw_content.slice(0, 120))}</div>
    <div class="meta">${esc(h.note_type ?? "?")}${h.status === "archived" ? " · archived" : ""} · score ${h.score.toFixed(3)}</div>
  </div>`).join("\n");
  return `<!doctype html><meta charset="utf-8"><title>Search: ${esc(query)}</title>${STYLE}
    <h1>Search: ${esc(query)} (${hits.length})</h1>${cards}`;
}

export function openReport(html: string, kind: string): void {
  mkdirSync("reports", { recursive: true });
  const path = join("reports", `${kind}-${Date.now()}.report.html`);
  writeFileSync(path, html, "utf-8");
  console.log(`report: ${path}`);
  try {
    // Windows: `start`; macOS: `open`; Linux: `xdg-open`
    const cmd = process.platform === "win32" ? `start "" "${path}"`
      : process.platform === "darwin" ? `open "${path}"` : `xdg-open "${path}"`;
    execSync(cmd, { shell: process.platform === "win32" ? "cmd.exe" : "/bin/sh" });
  } catch { /* opening is best-effort; the path is printed above */ }
}
