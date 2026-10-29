// @vitest-environment jsdom
import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Attachment } from "../types";
import { useFileUrl } from "./useFileUrl";

vi.mock("./db", () => ({ getFile: vi.fn(async () => new Blob(["x"])) }));
vi.mock("./attachments", () => ({ fetchFile: vi.fn() }));

const att = {
  id: "a1",
  name: "f.png",
  mime: "image/png",
  size: 1,
  width: null,
  height: null,
  thumb: null,
  path: null,
  added_at: "2026-01-01T00:00:00Z",
} as Attachment;

describe("useFileUrl", () => {
  it("drops the address when the file goes away", async () => {
    URL.createObjectURL = vi.fn(() => "blob:one");
    URL.revokeObjectURL = vi.fn();
    const { result, rerender } = renderHook(({ a }) => useFileUrl(a, "local"), {
      initialProps: { a: att as Attachment | null },
    });
    await waitFor(() => expect(result.current.url).toBe("blob:one"));
    rerender({ a: null });
    expect(result.current.url).toBeNull();
  });
});
