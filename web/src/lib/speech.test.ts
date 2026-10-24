import { describe, expect, it } from "vitest";
import { guessLang, pickVoice, pieces, speakable } from "./speech";

describe("guessLang", () => {
  it("hears Finnish in its function words", () => {
    expect(
      guessLang("Ja tämä paikka herää vasta illalla, kun kaikki on kotona.", "en"),
    ).toBe("fi");
  });

  it("hears English in its function words", () => {
    expect(
      guessLang("The place only wakes up in the evening when everyone is home.", "fi"),
    ).toBe("en");
  });

  /** A shopping list has no function words, but it has its letters. */
  it("takes ä and ö as Finnish when there is nothing else to go on", () => {
    expect(guessLang("maitoa, leipää, kahvia", "en")).toBe("fi");
  });

  it("leaves a tie to the device", () => {
    expect(guessLang("Buy milk", "fi")).toBe("fi");
    expect(guessLang("Buy milk", "en")).toBe("en");
  });
});

describe("speakable", () => {
  it("reads a tick box as its words, not its brackets", () => {
    expect(speakable("[ ] maitoa\n[x] leipää")).toBe("maitoa\n\nleipää");
  });

  it("skips a code block whole", () => {
    expect(speakable("Run this:\n```\nnpm test\n```\nthen stop.")).toBe(
      "Run this:\n\nthen stop.",
    );
  });

  it("says an address as its host", () => {
    expect(speakable("katso https://www.youtube.com/watch?v=abc123 illalla")).toBe(
      "katso youtube.com illalla",
    );
  });

  it("has nothing to say for a note of only code", () => {
    expect(speakable("```\nx = 1\n```")).toBe("");
  });
});

describe("pieces", () => {
  it("cuts at sentence ends and line breaks", () => {
    expect(pieces("One. Two! Three?\nFour")).toEqual(["One.", "Two!", "Three?", "Four"]);
  });

  /** Desktop Chrome stops partway through a long breath; never hand it one. */
  it("never hands the engine more than the ceiling", () => {
    const long = Array.from({ length: 60 }, (_, i) => `word${i}`).join(" ");
    const out = pieces(long, 50);
    expect(out.length).toBeGreaterThan(1);
    for (const p of out) expect(p.length).toBeLessThanOrEqual(50);
    expect(out.join(" ")).toBe(long);
  });

  it("says nothing for nothing", () => {
    expect(pieces("   \n  ")).toEqual([]);
  });
});

describe("pickVoice", () => {
  const voice = (lang: string, localService: boolean, isDefault = false) =>
    ({ lang, localService, default: isDefault, name: lang, voiceURI: lang }) as SpeechSynthesisVoice;

  it("prefers a voice that lives on the device", () => {
    const remote = voice("fi-FI", false);
    const local = voice("fi-FI", true);
    expect(pickVoice([remote, local, voice("en-US", true)], "fi")).toBe(local);
  });

  it("answers none when no voice speaks the tongue, so the tag alone is sent", () => {
    expect(pickVoice([voice("en-US", true), voice("sv-SE", true)], "fi")).toBeNull();
  });
});
