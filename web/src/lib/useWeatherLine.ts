import { useEffect, useRef, useState } from "react";
import type { Said } from "../components/Speech";
import { DEMO } from "./demo";
import { useSetting } from "./settings";

/**
 * When the creature talks about the weather (2026-10-23, owner approved; the
 * words and the rhythm are `lib/weather.ts`, the forecast `store/weather.ts`,
 * both behind a dynamic import so the first paint carries none of it).
 *
 * Now and then, never as a stream: the weather now at most once every four
 * hours, when the app is opened or comes back to the front; a sunny day coming
 * at most once a day, from noon, which is when "tomorrow" is a plan rather than
 * a guess. Never while something is being written, a note is open or a mode is
 * up (`quiet`) — it waits, and is said when that is over. Where the weather is
 * known by nobody, nothing is said: no error, no "couldn't get the weather".
 *
 * **The location is never asked for by surprise.** Until this site has an
 * answer, the creature offers once a day — "Hm. Want the weather? · Yes" — and
 * it is the tap on Yes that brings up the browser's own question. Refused, it
 * says nothing again; Settings' switch turns the whole of it off.
 */

/** How long a weather line stands. */
export const WEATHER_SAY_MS = 8_000;
/** How long the offer to say it stands. */
const ASK_SAY_MS = 12_000;
/** A moment after opening, so the weather is not the first thing to happen. */
const FIRST_LOOK_MS = 6_000;

const load = () => Promise.all([import("./weather"), import("../store/weather")]);

interface Shown {
  key: string;
  words: string;
  ask?: boolean;
  strong?: string[];
}

/** A weather line and the facts in it to set in bold (`weatherStrong`). */
export interface WeatherSaid {
  words: string;
  strong: string[];
}

/**
 * A poke asks for the weather now (2026-10-23, owner: "poking or clicking the
 * mascot should show the current weather"). A poke is a tap, so it may bring up
 * the browser's own location question; refused, switched off in Settings or no
 * forecast, it answers `null` and the creature says how sync stands instead.
 */
export function useWeatherOnPoke(): { enabled: boolean; ask: () => Promise<WeatherSaid | null> } {
  const enabled = useSetting("weather") === "on" && !DEMO;
  async function ask(): Promise<WeatherSaid | null> {
    try {
      const [words, store] = await load();
      const answer = await store.locationAnswer();
      if (answer === "denied" || answer === "none") return null;
      const place = await store.whereIsThis();
      const forecast = await store.forecastFor(place.lat, place.lon);
      if (!forecast) return null;
      const line = words.nowWords(forecast);
      return { words: line, strong: words.weatherStrong(line) };
    } catch {
      return null;
    }
  }
  return { enabled, ask };
}

export function useWeatherLine(quiet: boolean): Said | null {
  const on = useSetting("weather") === "on" && !DEMO;
  const [shown, setShown] = useState<Shown | null>(null);
  const looking = useRef(false);
  const quietRef = useRef(quiet);
  quietRef.current = quiet;

  /** The forecast for here, then the line it calls for, if any. */
  async function tell(fresh = false) {
    const [words, store] = await load();
    const place = await store.whereIsThis();
    const forecast = await store.forecastFor(place.lat, place.lon);
    if (!forecast) return;
    const now = new Date();
    const line = words.weatherLine(forecast, now, fresh);
    if (line) setShown({ key: `weather:${now.getTime()}`, words: line, strong: words.weatherStrong(line) });
  }

  async function look() {
    if (!on || looking.current || quietRef.current || document.hidden) return;
    looking.current = true;
    try {
      const [words, store] = await load();
      const answer = await store.locationAnswer();
      if (answer === "granted") await tell();
      else if (answer === "prompt") {
        const today = words.dayOf(new Date());
        if (words.readKept(words.ASKED_ON) === today) return;
        words.keep(words.ASKED_ON, today);
        setShown({ key: `weather-ask:${today}`, words: "Hm. Want the weather?", ask: true });
      }
    } catch {
      // No place, no forecast, no chunk: nothing to say.
    } finally {
      looking.current = false;
    }
  }
  const lookRef = useRef(look);
  lookRef.current = look;

  useEffect(() => {
    if (!on) return;
    const first = window.setTimeout(() => void lookRef.current(), FIRST_LOOK_MS);
    const onVisible = () => {
      if (!document.hidden) void lookRef.current();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearTimeout(first);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [on]);

  // Held back while something else had the room: said once that is over.
  const wasQuiet = useRef(quiet);
  useEffect(() => {
    if (wasQuiet.current && !quiet && on) void lookRef.current();
    wasQuiet.current = quiet;
  }, [on, quiet]);

  useEffect(() => {
    if (!shown) return;
    const t = window.setTimeout(() => setShown(null), shown.ask ? ASK_SAY_MS : WEATHER_SAY_MS);
    return () => window.clearTimeout(t);
  }, [shown]);

  if (!on || !shown) return null;
  if (!shown.ask) return { key: shown.key, words: shown.words };
  return {
    key: shown.key,
    words: shown.words,
    act: {
      verb: "Yes",
      label: "Yes, say the weather here",
      run: () => {
        setShown(null);
        // The tap is what lets the browser ask where this is.
        void tell(true).catch(() => {});
      },
    },
  };
}
