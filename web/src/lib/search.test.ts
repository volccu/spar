import { describe, expect, it } from "vitest";
import { hasPhrase, searchNotes, searchTerms, trashMatches } from "./search";
import type { Attachment, Note } from "../types";
import { linkPreview, note as base } from "../test/fixtures";

const note = (over: Partial<Note>): Note =>
  base({
    id: "n",
    raw_content: "",
    body: "",
    created_at: "2026-08-10T09:00:00.000Z",
    updated_at: "2026-08-10T09:00:00.000Z",
    ...over,
  });


function file(name: string): Attachment {
  return {
    id: `a-${name}`,
    name,
    mime: "application/pdf",
    size: 1000,
    width: null,
    height: null,
    thumb: null,
    path: null,
    added_at: "2026-08-10T09:00:00.000Z",
  };
}

/**
 * A dropped file writes nothing into the note's text — the file is what the
 * note is. That is only safe because the name is still searchable from where
 * it actually lives, which is on the attachment.
 */
describe("finding a file by its name", () => {
  it("finds a note whose only content is the file", () => {
    const dropped = note({ id: "f1", attachments: [file("receipt.pdf")] });
    const other = note({ id: "n1", body: "kanelipullat" });
    expect(searchNotes([other, dropped], "receipt").map((n) => n.id)).toEqual(["f1"]);
  });

  it("matches a prefix of the name, the way it matches the body", () => {
    const dropped = note({ id: "f1", attachments: [file("1000025005.jpg")] });
    expect(searchNotes([dropped], "10000250")).toHaveLength(1);
  });

  it("still ranks a note that matches in both above one that matches in one", () => {
    const both = note({ id: "both", body: "the receipt from the shop", attachments: [file("receipt.pdf")] });
    const bodyOnly = note({ id: "body", body: "the receipt from the shop" });
    const ranked = searchNotes([bodyOnly, both], "receipt").map((n) => n.id);
    expect(ranked[0]).toBe("both");
  });

  it("does not invent a match out of an empty attachment list", () => {
    expect(searchNotes([note({ body: "kanelipullat" })], "receipt")).toEqual([]);
  });
});

/**
 * A mild pull toward whatever was touched recently, folded into the score
 * itself — not only the tie-break `cmpDate` already ran on an exact tie.
 */
describe("a recency boost in the ranking", () => {
  it("ranks an equally good recent match above an equally good old one", () => {
    const recent = note({
      id: "recent",
      body: "buy milk",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    const old = note({
      id: "old",
      body: "buy milk",
      created_at: "2020-01-01T00:00:00.000Z",
      updated_at: "2020-01-01T00:00:00.000Z",
    });
    expect(searchNotes([old, recent], "milk").map((n) => n.id)).toEqual(["recent", "old"]);
  });

  it("stays mild — a genuinely stronger match still wins over a fresher weak one", () => {
    // Both query terms are in "strong"'s body, one at the very start; "fresh"
    // only covers one of the two terms. The 15% recency ceiling must never
    // be enough to flip a real coverage gap like that.
    const strong = note({
      id: "strong",
      body: "milk today: need milk for the recipe today",
      created_at: "2020-01-01T00:00:00.000Z",
      updated_at: "2020-01-01T00:00:00.000Z",
    });
    const freshWeak = note({
      id: "freshWeak",
      body: "note to self: buy milk",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    expect(searchNotes([freshWeak, strong], "milk today").map((n) => n.id)[0]).toBe("strong");
  });

  it("never lets recency invent a match on its own", () => {
    const recent = note({ body: "kanelipullat", updated_at: new Date().toISOString() });
    expect(searchNotes([recent], "receipt")).toEqual([]);
  });
});

/**
 * A fixed instant, so the recency boost is the same number on every run and
 * these orderings say something about the ranking rather than about today.
 */
const NOW = Date.parse("2026-09-10T12:00:00.000Z");

const dated = (over: Partial<Note>, when: string): Note =>
  note({ created_at: when, updated_at: when, ...over });

/**
 * A URL saved with none of the user's own words beside it is drawn on the
 * Links board under its fetched `og:title` — so that title is the name the
 * user reads, remembers the note by, and types into the search field. It was
 * the one handle on a note that search could not see.
 */
describe("finding a link by the name the board draws it under", () => {
  it("finds a bare URL by the title it was fetched under", () => {
    const link = note({
      id: "link",
      body: "https://example.com/a",
      link_previews: [linkPreview({ title: "Roasted cauliflower, three ways" })],
    });
    const other = note({ id: "n1", body: "kanelipullat" });
    expect(searchNotes([other, link], "cauliflower").map((n) => n.id)).toEqual(["link"]);
  });

  /**
   * A link the edge function refused to answer for keeps the *local* unfurl,
   * whose title `previewsFor` builds out of the sentence standing in front of
   * the address — so the stored title is the note's own words a second time.
   * Scored as it comes, every link note would outrank every plain one on words
   * the reader can only see once. `dup` is the older of the two, so it can only
   * come first if its own sentence was counted twice.
   */
  it("does not score a title the note's own words already say", () => {
    const dup = dated(
      {
        id: "dup",
        body: "Saved link: kanelipullat https://example.com/a",
        link_previews: [linkPreview({ title: "Saved link: kanelipullat" })],
      },
      "2026-08-01T09:00:00.000Z",
    );
    const plain = dated(
      { id: "plain", body: "Saved link: kanelipullat https://example.com/b" },
      "2026-09-01T09:00:00.000Z",
    );
    expect(searchNotes([dup, plain], "kanelipullat", NOW).map((n) => n.id)).toEqual([
      "plain",
      "dup",
    ]);
  });

  // `previewsFor` cuts a long title at 87 characters and ends it in an
  // ellipsis the note itself does not carry, so the comparison has to be made
  // against the same trimmed head `rowWords` compares.
  it("sees past the ellipsis a long local title was cut with", () => {
    const words = "kanelipullat ".repeat(8).trim();
    const dup = dated(
      {
        id: "dup",
        body: `${words} https://example.com/a`,
        link_previews: [linkPreview({ title: `${words.slice(0, 87)}...` })],
      },
      "2026-08-01T09:00:00.000Z",
    );
    const plain = dated(
      { id: "plain", body: `${words} https://example.com/b` },
      "2026-09-01T09:00:00.000Z",
    );
    expect(searchNotes([dup, plain], "kanelipullat", NOW).map((n) => n.id)).toEqual([
      "plain",
      "dup",
    ]);
  });
});

/**
 * `coverage / terms.length` was a multiplier, so a second word could only ever
 * re-rank the same set — and on a query nothing answered well, the note holding
 * one word of three *was* the result. A person typing a second word is
 * narrowing.
 */
describe("a second word narrows", () => {
  it("drops a note that answers only one of the two words", () => {
    const both = note({ id: "both", body: "buy milk today" });
    const one = note({ id: "one", body: "buy milk tomorrow" });
    expect(searchNotes([one, both], "milk today", NOW).map((n) => n.id)).toEqual(["both"]);
  });

  it("counts the words across the body, the files and the link titles together", () => {
    const spread = note({
      id: "spread",
      body: "the one from the shop",
      attachments: [file("receipt.pdf")],
      link_previews: [linkPreview({ title: "Kanelipullat" })],
    });
    expect(searchNotes([spread], "receipt kanelipullat shop", NOW).map((n) => n.id)).toEqual([
      "spread",
    ]);
  });

  it("leaves a single term exactly as it was — mid-word and all", () => {
    const n = note({ id: "n", body: "kanelipullat sunnuntaina" });
    expect(searchNotes([n], "pulla", NOW).map((x) => x.id)).toEqual(["n"]);
  });

  // A word typed twice is one condition, not two: scored twice and counted
  // twice, a stutter made a note answering one word look like it answered two.
  it("treats a word repeated in the query as the one word it is", () => {
    expect(searchTerms("milk MILK milk")).toEqual(["milk"]);
    const n = note({ id: "n", body: "buy milk" });
    expect(searchNotes([n], "milk milk", NOW).map((x) => x.id)).toEqual(["n"]);
  });
});

/**
 * A note that keeps saying a word is about that word. A single `indexOf` could
 * not tell it from a note that mentions it once — but frequency has to be
 * bounded, or the longest note in the archive wins every query by being long.
 */
describe("term frequency, and its ceiling", () => {
  const when = "2026-08-10T09:00:00.000Z";

  it("ranks a note that keeps saying the word above one that mentions it once", () => {
    const about = dated(
      { id: "about", body: "verokortti: the verokortti arrived, the verokortti is filed" },
      when,
    );
    const mention = dated({ id: "mention", body: "verokortti was mentioned once" }, when);
    expect(searchNotes([mention, about], "verokortti", NOW).map((n) => n.id)).toEqual([
      "about",
      "mention",
    ]);
  });

  /**
   * Past the bound another repeat says nothing further. `many` says it twenty
   * times and is a month older than `five`; unbounded, length alone would put
   * it first, which is exactly the failure the ceiling exists for.
   */
  it("stops counting at the bound, so a long note cannot win on length", () => {
    const many = dated(
      { id: "many", body: "milk ".repeat(20).trim() },
      "2026-08-01T09:00:00.000Z",
    );
    const five = dated(
      { id: "five", body: "milk ".repeat(5).trim() },
      "2026-09-01T09:00:00.000Z",
    );
    expect(searchNotes([many, five], "milk", NOW).map((n) => n.id)).toEqual(["five", "many"]);
  });
});

/**
 * `ä` is one character or two depending on what wrote it, and Google Takeout
 * can carry either. The owner writes Finnish, so a note invisible to its own
 * word is a real class of miss.
 */
describe("a letter written two ways", () => {
  // "reseptiä" — the a and its two dots as separate characters, which is
  // what NFD looks like and what Takeout can hand over.
  const decomposed = "resepti" + "a\u0308";

  it("finds a decomposed note from a query typed precomposed", () => {
    const n = note({ id: "n", body: `${decomposed} sunnuntaina` });
    expect(searchNotes([n], "reseptiä", NOW).map((x) => x.id)).toEqual(["n"]);
  });

  it("finds a precomposed note from a query typed decomposed", () => {
    const n = note({ id: "n", body: "reseptiä sunnuntaina" });
    expect(searchNotes([n], decomposed, NOW).map((x) => x.id)).toEqual(["n"]);
  });

  // The reason the notes are only composed for a query that carries a
  // non-ASCII character: an ASCII query cannot tell the two forms apart,
  // because the decomposed letter still holds its plain ASCII base.
  it("needs none of that for an ASCII query", () => {
    const n = note({ id: "n", body: `${decomposed} sunnuntaina` });
    expect(searchNotes([n], "resept", NOW).map((x) => x.id)).toEqual(["n"]);
  });
});

/**
 * Each note's lowercased text is remembered per note object. An edit makes a
 * new object, so the memory can never answer for words that are not there any
 * more — this holds that.
 */
describe("remembering a note's prepared text", () => {
  it("finds an edited note by its new words, and not by its old ones", () => {
    const before = base({ id: "m1", body: "Buy Oat milk" });
    expect(searchNotes([before], "oat").map((n) => n.id)).toEqual(["m1"]);
    const after = { ...before, body: "Buy almond milk" };
    expect(searchNotes([after], "oat")).toEqual([]);
    expect(searchNotes([after], "almond").map((n) => n.id)).toEqual(["m1"]);
    // And the first object still answers as it did.
    expect(searchNotes([before], "oat").map((n) => n.id)).toEqual(["m1"]);
  });
});

/**
 * The words inside a note's PDFs, read once per device (`store/pdfText.ts`)
 * and handed in as `files`. A document that says the word is an answer; a
 * note that says it itself is a better one.
 */
describe("finding a note by the words inside its PDF", () => {
  const lease = note({ id: "lease", attachments: [file("scan-0042.pdf")] });
  const texts = new Map([["a-scan-0042.pdf", "Vuokrasopimus\nHämeenkatu 12, Tampere"]]);

  it("finds a note whose only words are inside its document", () => {
    expect(searchNotes([lease], "tampere", NOW)).toEqual([]);
    expect(searchNotes([lease], "tampere", NOW, texts).map((n) => n.id)).toEqual(["lease"]);
  });

  it("ranks a hit in the document below the same hit in the note's own words", () => {
    const said = note({ id: "said", body: "moving to Tampere" });
    expect(searchNotes([lease, said], "tampere", NOW, texts).map((n) => n.id)).toEqual([
      "said",
      "lease",
    ]);
  });

  it("counts the document toward every word being found", () => {
    // One word in the note, the other in the document: an answer to both.
    const both = note({ id: "both", body: "the lease", attachments: lease.attachments });
    expect(searchNotes([both], "lease tampere", NOW, texts).map((n) => n.id)).toEqual(["both"]);
    expect(searchNotes([both], "lease helsinki", NOW, texts)).toEqual([]);
  });

  it("composes the document for a query typed with a letter written two ways", () => {
    const decomposed = new Map([["a-scan-0042.pdf", "Hämeenkatu"]]);
    expect(searchNotes([lease], "hämeenkatu", NOW, decomposed).map((n) => n.id)).toEqual([
      "lease",
    ]);
  });

  it("sees a document's words change when it is read again", () => {
    expect(searchNotes([lease], "turku", NOW, texts)).toEqual([]);
    const reread = new Map([["a-scan-0042.pdf", "Turku"]]);
    expect(searchNotes([lease], "turku", NOW, reread).map((n) => n.id)).toEqual(["lease"]);
  });

  it("still never reads the trash", () => {
    const binned = { ...lease, status: "trashed" as const };
    expect(searchNotes([binned], "tampere", NOW, texts)).toEqual([]);
  });
});

/**
 * The words inside a screenshot or photograph, read on the device
 * (`store/imageText.ts`, FX-A-07), arrive in the very same map as a PDF's and
 * weigh the same: half.
 */
describe("finding a note by the words inside its picture", () => {
  const shot = note({
    id: "shot",
    attachments: [{ ...file("Screenshot_2026.png"), mime: "image/png" }],
  });
  const texts = new Map([["a-Screenshot_2026.png", "Ferry timetable, Naantali"]]);

  it("finds a note whose only content is a picture, by the words in it", () => {
    expect(searchNotes([shot], "timetable", NOW)).toEqual([]);
    expect(searchNotes([shot], "timetable", NOW, texts).map((n) => n.id)).toEqual(["shot"]);
  });

  it("ranks it below a note that says the word itself", () => {
    const said = note({ id: "said", body: "check the ferry timetable" });
    expect(searchNotes([shot, said], "timetable", NOW, texts).map((n) => n.id)).toEqual([
      "said",
      "shot",
    ]);
  });
});

/**
 * A plural typed where the note says the singular (review 2026-10-01, UX-27).
 * Matching is by substring, so a word with its plural ending taken off finds
 * everything the whole word found and the singular besides — it can only
 * widen a search, never lose a hit.
 */
describe("a plural finds the singular", () => {
  it("finds 'tyre' from 'tyres'", () => {
    const n = note({ id: "t", body: "Change the winter tyre on Friday" });
    expect(searchNotes([n], "tyres").map((x) => x.id)).toEqual(["t"]);
  });

  it("finds 'box' from 'boxes' and 'church' from 'churches'", () => {
    const a = note({ id: "a", body: "one box of screws" });
    const b = note({ id: "b", body: "the old church" });
    expect(searchNotes([a, b], "boxes").map((x) => x.id)).toEqual(["a"]);
    expect(searchNotes([a, b], "churches").map((x) => x.id)).toEqual(["b"]);
  });

  it("still finds the plural itself", () => {
    const n = note({ id: "p", body: "new tyres" });
    expect(searchNotes([n], "tyres").map((x) => x.id)).toEqual(["p"]);
  });

  it("leaves a double s and a short word alone", () => {
    expect(searchTerms("glass")).toEqual(["glass"]);
    expect(searchTerms("bus")).toEqual(["bus"]);
    expect(searchTerms("is")).toEqual(["is"]);
  });

  it("applies to every word of a longer search", () => {
    const n = note({ id: "m", body: "tyre and box" });
    expect(searchNotes([n], "tyres boxes").map((x) => x.id)).toEqual(["m"]);
  });
});

/**
 * A remembered quote is remembered word for word (review 2026-10-04, FX-A-04).
 * Words inside double quotes must stand together, in that order; everything
 * outside them searches exactly as before, and the quoted words still mark the
 * card like any other term.
 */
describe("a phrase in double quotes", () => {
  it("finds the words standing together, in that order", () => {
    const n = note({ id: "n", body: "We should go before reading the rest" });
    expect(searchNotes([n], '"go before reading"', NOW).map((x) => x.id)).toEqual(["n"]);
  });

  it("does not find the same words in another order", () => {
    const n = note({ id: "n", body: "Background reading before we go" });
    expect(searchNotes([n], '"go before reading"', NOW)).toEqual([]);
    // Unquoted, the same words are three separate conditions, and they hold.
    expect(searchNotes([n], "go before reading", NOW).map((x) => x.id)).toEqual(["n"]);
  });

  it("does not find the words when something stands between them", () => {
    const apart = note({ id: "apart", body: "electricity bill due, pay on friday" });
    const together = note({ id: "together", body: "Electricity Friday!" });
    expect(searchNotes([apart, together], '"electricity friday"', NOW).map((x) => x.id)).toEqual([
      "together",
    ]);
  });

  it("lets punctuation, a line break or extra spaces sit between the words", () => {
    const n = note({ id: "n", body: "the electricity,\n  friday one" });
    expect(searchNotes([n], '"electricity friday"', NOW).map((x) => x.id)).toEqual(["n"]);
  });

  it("matches the phrase as written, plural and all", () => {
    const n = note({ id: "n", body: "the notes app idea" });
    expect(searchNotes([n], '"notes app"', NOW).map((x) => x.id)).toEqual(["n"]);
  });

  it("keeps substring matching at the phrase's two ends", () => {
    const n = note({ id: "n", body: "kanelipullat sunnuntaina aamulla" });
    expect(searchNotes([n], '"pullat sunnuntai"', NOW).map((x) => x.id)).toEqual(["n"]);
  });

  it("searches the words outside the quotes as before", () => {
    const hit = note({ id: "hit", body: "milk: go before reading, then shop" });
    const noMilk = note({ id: "no-milk", body: "go before reading, then shop" });
    expect(
      searchNotes([hit, noMilk], 'milk "go before reading"', NOW).map((x) => x.id),
    ).toEqual(["hit"]);
  });

  it("reads a quote left open as running to the end of the query", () => {
    const n = note({ id: "n", body: "We should go before reading" });
    const reversed = note({ id: "r", body: "reading before we go" });
    expect(searchNotes([n, reversed], '"go before', NOW).map((x) => x.id)).toEqual(["n"]);
  });

  it("finds a phrase in a link's fetched title", () => {
    const n = note({
      id: "n",
      body: "https://example.com/a",
      link_previews: [linkPreview({ title: "How to go before reading" })],
    });
    expect(searchNotes([n], '"go before reading"', NOW).map((x) => x.id)).toEqual(["n"]);
  });

  it("keeps the quoted words for the card to mark", () => {
    expect(searchTerms('milk "go before reading"')).toEqual(["milk", "go", "before", "reading"]);
  });

  it("knows a quoted phrase from a quoted single word and from none", () => {
    expect(hasPhrase('milk "go before"')).toBe(true);
    expect(hasPhrase('"go before')).toBe(true);
    expect(hasPhrase('"milk"')).toBe(false);
    expect(hasPhrase("go before")).toBe(false);
  });
});

/* Audit 2026-10-10, UX-1: an empty search can say the note is in the Trash,
   while the Trash itself is never a result. */
describe("trashMatches", () => {
  it("finds what a search would have found in the Trash, and only there", () => {
    const notes = [
      note({ id: "live", body: "lease for the flat", status: "active" }),
      note({ id: "binned", body: "lease for the garage", status: "trashed" }),
      note({ id: "other", body: "nothing to do with it", status: "trashed" }),
    ];
    expect(trashMatches(notes, "garage").map((n) => n.id)).toEqual(["binned"]);
    expect(trashMatches(notes, "garage")[0].status).toBe("trashed");
    expect(searchNotes(notes, "garage")).toEqual([]);
    expect(trashMatches(notes, "flat")).toEqual([]);
  });
});
