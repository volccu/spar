import { describe, expect, it } from "vitest";
import { addressKey, addressKeys } from "./links";
import { lazyLinkIndex, linkIndex, savedTwin, savedWords } from "./savedLinks";
import { note } from "../test/fixtures";

describe("what makes two addresses the same page", () => {
  it("ignores the scheme, www., the host's case, a trailing slash and the fragment", () => {
    const key = addressKey("https://example.com/a");
    for (const same of [
      "http://example.com/a",
      "https://www.example.com/a",
      "https://EXAMPLE.com/a/",
      "https://example.com/a#section",
      "https://www.example.com/a/#top",
    ]) {
      expect(addressKey(same), same).toBe(key);
    }
  });

  it("keeps the path and the query, which name a different page", () => {
    expect(addressKey("https://example.com/a")).not.toBe(addressKey("https://example.com/b"));
    expect(addressKey("https://example.com/A")).not.toBe(addressKey("https://example.com/a"));
    expect(addressKey("https://example.com/a?id=1")).not.toBe(addressKey("https://example.com/a?id=2"));
    expect(addressKey("https://example.com/a?id=1")).not.toBe(addressKey("https://example.com/a"));
  });

  it("reads every address in the text through the app's own scanner", () => {
    expect(addressKeys("see www.example.com/a. and https://other.org/?q=1")).toEqual([
      "example.com/a",
      "other.org?q=1",
    ]);
    expect(addressKeys("no address here")).toEqual([]);
  });
});

describe("which note already holds an address", () => {
  const held = note({ id: "held", body: "Soup https://example.com/soup", created_at: "2026-01-01T00:00:00.000Z" });

  it("finds it from any spelling of the same page", () => {
    const index = linkIndex([held]);
    expect(savedTwin(index, "try www.example.com/soup/#x")?.id).toBe("held");
    expect(savedTwin(index, "try https://example.com/stew")).toBeNull();
  });

  it("counts active and archived notes, and never the trash", () => {
    const archived = { ...held, id: "arch", status: "archived" as const };
    const trashed = { ...held, id: "gone", status: "trashed" as const };
    expect(savedTwin(linkIndex([archived]), "https://example.com/soup")?.id).toBe("arch");
    expect(savedTwin(linkIndex([trashed]), "https://example.com/soup")).toBeNull();
  });

  it("prefers the active copy, then the newest", () => {
    const newer = { ...held, id: "newer", created_at: "2026-03-01T00:00:00.000Z" };
    const newestArchived = {
      ...held,
      id: "newest-archived",
      status: "archived" as const,
      created_at: "2026-06-01T00:00:00.000Z",
    };
    const index = linkIndex([held, newestArchived, newer]);
    expect(savedTwin(index, "https://example.com/soup")?.id).toBe("newer");
  });

  it("does not let a note answer for itself", () => {
    const shared = { ...held, id: "shared", created_at: "2026-09-01T00:00:00.000Z" };
    const index = linkIndex([held, shared]);
    expect(savedTwin(index, shared.body, "shared")?.id).toBe("held");
    expect(savedTwin(linkIndex([shared]), shared.body, "shared")).toBeNull();
  });

  it("builds the index once per list of notes", () => {
    const indexFor = lazyLinkIndex();
    const notes = [held];
    const first = indexFor(notes);
    expect(indexFor(notes)).toBe(first);
    expect(indexFor([...notes])).not.toBe(first);
  });
});

describe("which note already says exactly this", () => {
  const held = note({
    id: "held",
    body: "Ota kuva huolto ja soita.\nBidee rikki.",
    created_at: "2026-01-01T00:00:00.000Z",
  });

  it("finds a note with the same words, whatever the spacing or capitals", () => {
    const index = linkIndex([held]);
    expect(savedTwin(index, "ota kuva huolto ja soita. bidee rikki.")?.id).toBe("held");
    expect(savedTwin(index, "  Ota kuva huolto  ja soita.\n\nBidee rikki.\n")?.id).toBe("held");
  });

  it("asks for the whole text, never a part of it", () => {
    const index = linkIndex([held]);
    expect(savedTwin(index, "Ota kuva huolto ja soita.")).toBeNull();
    expect(savedTwin(index, "Ota kuva huolto ja soita. Bidee rikki. Ja vessa.")).toBeNull();
  });

  it("leaves a scrap too short to mean anything alone", () => {
    const scrap = note({ id: "scrap", body: "test" });
    expect(savedTwin(linkIndex([scrap]), "test")).toBeNull();
  });

  it("counts active and archived notes, and never the trash", () => {
    const archived = { ...held, id: "arch", status: "archived" as const };
    const trashed = { ...held, id: "gone", status: "trashed" as const };
    expect(savedTwin(linkIndex([archived]), held.body)?.id).toBe("arch");
    expect(savedTwin(linkIndex([trashed]), held.body)).toBeNull();
  });

  it("does not let a note answer for itself", () => {
    expect(savedTwin(linkIndex([held]), held.body, "held")).toBeNull();
  });

  it("names the note with the same words before one that only shares an address", () => {
    const link = note({ id: "link", body: "Soup https://example.com/soup", created_at: "2026-09-01T00:00:00.000Z" });
    const same = note({ id: "same", body: "Recipe https://example.com/soup", created_at: "2026-01-01T00:00:00.000Z" });
    expect(savedTwin(linkIndex([link, same]), "Recipe https://example.com/soup")?.id).toBe("same");
  });
});

describe("what the bar says about a saved address", () => {
  const now = Date.parse("2026-09-27T12:00:00.000Z");

  it("counts while counting is useful, then names the day", () => {
    expect(savedWords(note({ created_at: "2026-09-24T12:00:00.000Z" }), now)).toBe("Saved 3 days ago");
    expect(savedWords(note({ created_at: "2026-08-05T12:00:00.000Z" }), now)).toBe("Saved on 5 Aug");
  });

  it("says when the copy is archived", () => {
    expect(
      savedWords(note({ created_at: "2026-09-27T11:59:30.000Z", status: "archived" }), now),
    ).toBe("Saved just now, archived");
  });
});
