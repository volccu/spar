/**
 * Link previews (docs/sync-contract.md §13): a public page's Open Graph
 * metadata, fetched for the signed-in user.
 *
 * Ported from the Supabase function `supabase/functions/link-preview/index.ts`
 * — the same answers and the same limits — with the fetching replaced by
 * `pinnedFetch`, which closes the gap that function cannot: DNS rebinding
 * (Deno's fetch cannot be pinned). Its address rules have been this file's own
 * since audit SEC-3 (`_shared/netguard.ts`). The verdict on a status and the
 * `check` flag come from the very file that function uses,
 * `_shared/linkStatus.ts`, and so does the page parsing, `_shared/pageMeta.ts`.
 * What the function does beyond that — site media, screenshots for the
 * Inspiration wall — it does alone.
 */
import { pageVerdict, wantsPicture } from "../../supabase/functions/_shared/linkStatus";
import { readCapped, readHtml, readMeta } from "../../supabase/functions/_shared/pageMeta";
import { LookupFailedError, NotPublicError, pinnedFetch, type PinnedFetchDeps } from "./pinnedFetch";

/** How far into a page its tags are looked for. The function reads further
 *  (two megabytes, for Pinterest); this one has not been asked to. */
const MAX_HTML = 512 * 1024;
const MAX_IMAGE = 3 * 1024 * 1024;
const TIMEOUT_MS = 8_000;
const IMAGE_TIMEOUT_MS = 8_000;
const MAX_REDIRECTS = 3;
const USER_AGENT = "Mozilla/5.0 (compatible; spar-link-preview/1.0)";

export interface PreviewAnswer {
  status: number;
  body: Record<string, unknown>;
}

export class LinkPreviewer {
  constructor(private readonly deps: PinnedFetchDeps) {}

  private async fetchImage(raw: string, pageUrl: URL): Promise<string | null> {
    let current: URL;
    try {
      current = new URL(raw, pageUrl);
    } catch {
      return null;
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), IMAGE_TIMEOUT_MS);
    try {
      for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
        let response: Response;
        try {
          // Every hop is re-checked and pinned inside pinnedFetch.
          response = await pinnedFetch(
            current,
            {
              signal: controller.signal,
              headers: { accept: "image/*", "user-agent": USER_AGENT, referer: pageUrl.toString() },
            },
            this.deps,
          );
        } catch {
          return null;
        }
        if (response.status >= 300 && response.status < 400) {
          await response.body?.cancel();
          if (redirects === MAX_REDIRECTS) return null;
          const location = response.headers.get("location");
          if (!location) return null;
          try {
            current = new URL(location, current);
          } catch {
            return null;
          }
          continue;
        }
        if (!response.ok) {
          await response.body?.cancel();
          return null;
        }
        const mime = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
        if (!mime.startsWith("image/")) {
          await response.body?.cancel();
          return null;
        }
        const bytes = await readCapped(response, MAX_IMAGE);
        if (!bytes) return null;
        return `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`;
      }
      return null;
    } catch {
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }

  private async metadata(html: string, url: URL, picture: boolean) {
    const { title, description, candidates } = readMeta(html);
    let image: string | null = null;
    for (const candidate of picture ? new Set(candidates) : []) {
      try {
        image = await this.fetchImage(candidate, url);
      } catch {
        image = null;
      }
      if (image) break;
    }
    return {
      title: title.slice(0, 200) || url.hostname,
      description: description ? description.slice(0, 500) : null,
      image,
    };
  }

  /** The answer for one request body, `{url, check?}` (already parsed JSON). */
  async preview(body: { url?: unknown; check?: unknown }): Promise<PreviewAnswer> {
    if (typeof body.url !== "string") return { status: 400, body: { error: "Only public http(s) URLs are supported" } };
    let current: URL;
    try {
      current = new URL(body.url);
    } catch {
      return { status: 400, body: { error: "Only public http(s) URLs are supported" } };
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
        let response: Response;
        try {
          response = await pinnedFetch(
            current,
            {
              signal: controller.signal,
              headers: { accept: "text/html,application/xhtml+xml", "user-agent": USER_AGENT },
            },
            this.deps,
          );
        } catch (error) {
          if (error instanceof LookupFailedError) return { status: 502, body: { error: error.message } };
          if (error instanceof NotPublicError) {
            return {
              status: 400,
              body: { error: redirects === 0 ? "Only public http(s) URLs are supported" : "The redirect target is not public" },
            };
          }
          throw error;
        }
        const verdict = pageVerdict(response.status);
        if (verdict === "redirect") {
          await response.body?.cancel();
          if (redirects === MAX_REDIRECTS) return { status: 502, body: { error: "Too many redirects" } };
          const location = response.headers.get("location");
          let next: URL | null = null;
          try {
            next = location ? new URL(location, current) : null;
          } catch {
            next = null;
          }
          if (!next) return { status: 400, body: { error: "The redirect target is not public" } };
          current = next;
          continue;
        }
        if (verdict === "gone") {
          await response.body?.cancel();
          return {
            status: 200,
            body: { url: current.toString(), title: "", description: null, image: null, gone: true, status: response.status },
          };
        }
        if (verdict === "failed") {
          await response.body?.cancel();
          return { status: 502, body: { error: "The page could not be fetched" } };
        }
        const type = response.headers.get("content-type") ?? "";
        const lower = type.toLowerCase();
        if (lower !== "" && !lower.includes("text/html") && !lower.includes("application/xhtml+xml")) {
          await response.body?.cancel();
          return { status: 415, body: { error: "The URL did not return a web page" } };
        }
        const meta = await this.metadata(await readHtml(response, MAX_HTML), current, wantsPicture(body));
        return { status: 200, body: { url: current.toString(), ...meta } };
      }
      return { status: 502, body: { error: "The page could not be fetched" } };
    } catch (error) {
      const aborted = controller.signal.aborted || (error instanceof Error && error.name === "AbortError");
      return { status: 502, body: { error: aborted ? "The page took too long to answer" : "The page could not be reached" } };
    } finally {
      clearTimeout(timeout);
    }
  }
}
