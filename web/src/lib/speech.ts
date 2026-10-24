import { useCallback, useEffect, useRef, useState } from "react";
import { parseBlocks } from "./blocks";
import { domainFor, linkify } from "./links";

/**
 * Read aloud — the browser's own voice, and nothing behind it.
 *
 * `speechSynthesis` is the voices Windows ships on a PC and Google's on
 * Android; no server is asked, no model is called, which is what lets this
 * stand beside SPEC §8. What needs deciding is only *what* is read and *in
 * which tongue*, and both are worked out here from the text alone.
 */

export type Lang = "fi" | "en";

/**
 * The words that give a language away. Short function words only — a note
 * about "the Helsinki sauna" is still English, and a note listing "ja" in a
 * roster of names is still one vote. "on" is left off both lists because it
 * is a common word in each; "me" likewise.
 */
const FINNISH = new Set([
  "ja", "ei", "että", "se", "oli", "mutta", "kun", "niin", "myös", "tai", "kanssa",
  "tämä", "joka", "hän", "minä", "sinä", "ne", "ole", "olla", "vain", "jos", "nyt",
  "sitten", "siis", "vielä", "mitä", "kuin", "tässä", "sinne", "siellä", "täällä",
  "pitää", "voi", "ovat", "olen", "olet", "hyvä", "koska", "sekä", "kaikki", "paljon",
  "jo", "ihan", "tuo", "tämän", "sen", "sitä", "siitä", "mihin", "missä",
  "vasta", "sinun", "minun", "meidän", "ehkä", "kyllä", "mukaan", "ilman",
]);
const ENGLISH = new Set([
  "the", "and", "is", "of", "to", "in", "that", "it", "for", "with", "as", "are",
  "this", "was", "be", "at", "by", "or", "from", "an", "not", "have", "you", "but",
  "they", "we", "can", "if", "will", "what", "when", "all", "your", "my", "just",
  "do", "about", "how", "there", "then", "also", "some", "more", "one", "would",
  "should", "could", "than", "into", "which", "their", "them",
]);

/** What the device speaks, as a tie-break; `en` where it says nothing. */
function deviceLang(): Lang {
  const said = typeof navigator === "undefined" ? "" : (navigator.language ?? "");
  return said.toLowerCase().startsWith("fi") ? "fi" : "en";
}

/**
 * Finnish or English, from the words alone.
 *
 * A vote per function word each way, and two votes for Finnish if the text
 * has an ä, ö or å in it at all — a note with no function words ("maitoa,
 * leipää") still has its letters. A tie is the device's own tongue. Two
 * languages is all this archive holds, so two is all it decides between; a
 * Swedish note will be read in one of them, and that is the honest limit.
 */
export function guessLang(text: string, fallback: Lang = deviceLang()): Lang {
  let fi = /[äöå]/i.test(text) ? 2 : 0;
  let en = 0;
  for (const word of text.toLowerCase().match(/[a-zäöå]+/g) ?? []) {
    if (FINNISH.has(word)) fi += 1;
    if (ENGLISH.has(word)) en += 1;
  }
  if (fi === en) return fallback;
  return fi > en ? "fi" : "en";
}

/** Prose with every address said as its host: "youtube.com", not the slug. */
function proseToSpeech(text: string): string {
  return linkify(text)
    .map((seg) => (seg.href ? domainFor(seg.href) : seg.text))
    .join("");
}

/**
 * The note as something a voice can say.
 *
 * Tick boxes and list marks are read as their words — "[ ] milk" is "milk",
 * because "left bracket space right bracket" is what a voice makes of the
 * characters. A code block is skipped whole: a voice reading code is noise
 * from the first line. An address becomes its host. Paragraphs stay apart,
 * so the pauses land where the note put them.
 */
export function speakable(text: string): string {
  const parts: string[] = [];
  for (const block of parseBlocks(text)) {
    if (block.kind === "code") continue;
    const said = block.kind === "prose" ? block.text : block.words;
    const spoken = proseToSpeech(said).trim();
    if (spoken !== "") parts.push(spoken);
  }
  return parts.join("\n\n");
}

/**
 * How long one utterance may be. Desktop Chrome stops speaking partway
 * through a long utterance — around fifteen seconds in, for years, and the
 * fix is the one every reader has settled on: say the text as a queue of
 * sentence-sized pieces rather than one long breath. Sentences are also
 * where the pauses belong.
 */
const PIECE_MAX = 200;

/**
 * Sentence-sized pieces of `text`, none longer than `max` unless a single
 * word is. Splits at sentence ends and line breaks first, and only breaks a
 * sentence at a space when it has to.
 */
export function pieces(text: string, max = PIECE_MAX): string[] {
  const out: string[] = [];
  const sentences = text
    .split(/(?<=[.!?…:;])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s !== "");
  for (const s of sentences) {
    if (s.length <= max) {
      out.push(s);
      continue;
    }
    let rest = s;
    while (rest.length > max) {
      const cut = rest.lastIndexOf(" ", max);
      const at = cut > 0 ? cut : max;
      out.push(rest.slice(0, at).trim());
      rest = rest.slice(at).trim();
    }
    if (rest !== "") out.push(rest);
  }
  return out;
}

/**
 * The voice to use for a tongue, or none — in which case the utterance
 * carries its `lang` alone and the engine picks. A voice that lives on the
 * device is preferred to one fetched from a server, because the local one
 * works on the train.
 */
export function pickVoice(
  voices: SpeechSynthesisVoice[],
  lang: Lang,
): SpeechSynthesisVoice | null {
  const fits = voices.filter((v) => v.lang.toLowerCase().startsWith(lang));
  if (fits.length === 0) return null;
  return (
    fits.find((v) => v.localService && v.default) ??
    fits.find((v) => v.localService) ??
    fits[0]
  );
}

const TAG: Record<Lang, string> = { fi: "fi-FI", en: "en-US" };

function synth(): SpeechSynthesis | null {
  if (typeof window === "undefined") return null;
  // A real object, not merely a slot: some embedded views declare the
  // property and leave it empty.
  return (window as { speechSynthesis?: SpeechSynthesis | null }).speechSynthesis ?? null;
}

/**
 * Reading the note aloud: whether the device can, whether it is, and the one
 * switch that starts and stops it.
 *
 * `toggle(text)` reads `text` from the top, or stops if already reading; the
 * mark on the meta row is that one switch said twice. Reading ends on its
 * own when the last piece is said, or the moment the note closes — the hook
 * cancels on unmount, because a voice going on about a note you have left
 * is the wrong kind of surprise.
 */
export function useReadAloud(): {
  available: boolean;
  speaking: boolean;
  toggle: (text: string) => void;
} {
  const [speaking, setSpeaking] = useState(false);
  const mine = useRef(false);
  const available = synth() !== null;

  // Chrome hands back an empty voice list until it has loaded them, and only
  // loads them once asked. Ask now, so they are there by the first tap.
  useEffect(() => {
    synth()?.getVoices();
  }, []);

  useEffect(
    () => () => {
      if (mine.current) synth()?.cancel();
    },
    [],
  );

  const toggle = useCallback((text: string) => {
    const s = synth();
    if (!s) return;
    if (mine.current) {
      mine.current = false;
      s.cancel();
      setSpeaking(false);
      return;
    }
    const said = pieces(speakable(text));
    if (said.length === 0) return;

    const lang = guessLang(text);
    const voice = pickVoice(s.getVoices(), lang);
    s.cancel();
    mine.current = true;
    setSpeaking(true);

    const done = () => {
      mine.current = false;
      setSpeaking(false);
    };
    said.forEach((piece, i) => {
      const u = new SpeechSynthesisUtterance(piece);
      u.lang = TAG[lang];
      if (voice) u.voice = voice;
      if (i === said.length - 1) u.onend = done;
      // `cancel()` reports as an error on some engines; either way it is over.
      u.onerror = done;
      s.speak(u);
    });
  }, []);

  return { available, speaking, toggle };
}
