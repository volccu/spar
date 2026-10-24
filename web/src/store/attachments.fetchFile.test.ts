import { describe, expect, it, vi } from "vitest";
import type { Attachment } from "../types";

/**
 * A file fetched from the server is shown even when this device cannot keep a
 * copy of it. The copy is a cache; a phone out of room refuses the write, and
 * that is exactly when the file must still open (bughunt 2026-10-15).
 */

const bytes = new Blob(["%PDF-1.4"], { type: "application/pdf" });

vi.mock("./db", () => ({
  getFile: async () => undefined,
  putFile: async () => {
    throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
  },
  allTombstones: async () => [],
  cachedFiles: async () => [],
  deleteFiles: async () => {},
  getMeta: async () => undefined,
  setMeta: async () => {},
}));
vi.mock("./backend", () => ({
  getBackend: async () => ({ downloadFile: async () => ({ data: bytes, error: null }) }),
}));
vi.mock("./sync", () => ({ serverKnowsAttachments: async () => true }));
vi.mock("./pdfText", () => ({ pdfBytesLanded: vi.fn() }));
vi.mock("./imageText", () => ({ imageBytesLanded: vi.fn() }));

import { fetchFile } from "./attachments";

const att = {
  id: "a1",
  name: "plan.pdf",
  mime: "application/pdf",
  size: bytes.size,
  path: "owner/n1/a1",
} as Attachment;

describe("fetchFile", () => {
  it("hands back the server's bytes when this device refuses to keep them", async () => {
    await expect(fetchFile(att)).resolves.toBe(bytes);
  });
});
