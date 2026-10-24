/**
 * The creature's weather (2026-10-23, owner: "from time to time tell me the
 * current weather, and when a good weather day is coming, tell me it's sunny
 * and so warm tomorrow at such a time"). The pure half: what a forecast says,
 * in the Small Machine voice (one small sound, the facts plain). Fetching it
 * is `store/weather.ts`; when it is said is `useWeatherLine.ts`.
 */

/** An Open-Meteo forecast, cut down to what the creature says. Times are the place's own, ISO without zone. */
export interface Forecast {
  current: { time: string; temperature: number; code: number };
  hourly: { time: string[]; temperature: number[]; code: number[] };
}

/**
 * The WMO weather code as a word that finishes "12° and … out". Grouped the
 * way a person says them: there is no word for the difference between light
 * and moderate drizzle at a glance.
 */
export function weatherWord(code: number): string {
  if (code === 0) return "clear";
  if (code === 1) return "mostly clear";
  if (code === 2) return "partly cloudy";
  if (code === 3) return "cloudy";
  if (code === 45 || code === 48) return "foggy";
  if (code >= 51 && code <= 57) return "drizzly";
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return "rainy";
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return "snowy";
  if (code >= 95) return "stormy";
  return "grey";
}

/** Every condition a line can name, longest first so "mostly clear" wins over "clear". */
const CONDITIONS = [
  "partly cloudy", "mostly clear", "drizzly", "cloudy", "stormy", "foggy", "rainy", "snowy", "clear", "grey", "Sunny",
];

/**
 * The facts in a weather line, to be set in bold where it is said: the
 * temperature and the condition, the first thing the eye should catch
 * (2026-10-23, owner). Weight only, never a tone or a hue. Read off the line
 * rather than carried beside it, so every line the creature says about the
 * weather gets the same emphasis without a second copy of the wording.
 */
export function weatherStrong(line: string): string[] {
  const facts: string[] = [];
  const degreesSaid = line.match(/-?\d+°/);
  if (degreesSaid) facts.push(degreesSaid[0]);
  const said = CONDITIONS.find((word) => line.includes(word));
  if (said) facts.push(said);
  return facts;
}

/** A temperature as said: whole degrees, and never "-0". */
function degrees(t: number): string {
  const whole = Math.round(t);
  return `${whole === 0 ? 0 : whole}°`;
}

/** "Beep. 12° and cloudy out." */
export function nowWords(forecast: Forecast): string {
  return `Beep. ${degrees(forecast.current.temperature)} and ${weatherWord(forecast.current.code)} out.`;
}

/**
 * The hours of the day a good day is judged on: nine in the morning to eight
 * in the evening. Night is not when anybody goes out to enjoy the sun.
 */
const DAY_FROM = 9;
const DAY_TO = 20;
/** At least this many clear or mostly clear daytime hours make a sunny day. */
const SUNNY_HOURS = 4;
/** Warm enough to be worth saying, whatever today was. */
const WARM_ENOUGH = 15;
/** Or this much warmer than today: a sunny 9° after a 4° day is good news in October. */
const WARMER_BY = 3;

interface Hour {
  day: string;
  hour: number;
  temperature: number;
  code: number;
}

function hours(forecast: Forecast): Hour[] {
  const { time, temperature, code } = forecast.hourly;
  return time.map((t, i) => ({
    day: t.slice(0, 10),
    hour: Number(t.slice(11, 13)),
    temperature: temperature[i],
    code: code[i],
  }));
}

/**
 * **What counts as a good day tomorrow** — the rule, so it can be tuned:
 * between 9:00 and 20:00 at least four hours are clear or mostly clear (WMO
 * 0–1), and the warmest of those hours is at least 15°, or at least 3° warmer
 * than today's warmest daytime hour. The answer is that warmest clear hour.
 */
export function goodDayTomorrow(forecast: Forecast): { temperature: number; hour: number } | null {
  const today = forecast.current.time.slice(0, 10);
  const all = hours(forecast);
  const tomorrow = all.find((h) => h.day > today)?.day;
  if (!tomorrow) return null;
  const daytime = (h: Hour) => h.hour >= DAY_FROM && h.hour <= DAY_TO;
  const clear = all.filter((h) => h.day === tomorrow && daytime(h) && h.code <= 1);
  if (clear.length < SUNNY_HOURS) return null;
  const warmest = clear.reduce((best, h) => (h.temperature > best.temperature ? h : best));
  const todayWarmest = Math.max(
    ...all.filter((h) => h.day === today && daytime(h)).map((h) => h.temperature),
  );
  const good = warmest.temperature >= WARM_ENOUGH || warmest.temperature >= todayWarmest + WARMER_BY;
  return good ? { temperature: warmest.temperature, hour: warmest.hour } : null;
}

/** "Hm. Sunny and 21° tomorrow around 14:00." */
export function goodDayWords(day: { temperature: number; hour: number }): string {
  return `Hm. Sunny and ${degrees(day.temperature)} tomorrow around ${String(day.hour).padStart(2, "0")}:00.`;
}

/** The weather now is said at most this often. */
export const WEATHER_EVERY_MS = 4 * 60 * 60_000;
/** From this hour of the day a good day tomorrow is worth saying. */
export const GOOD_DAY_FROM_HOUR = 12;

const SAID_AT = "spar.weatherSaidAt";
const GOOD_DAY_ON = "spar.weatherGoodDayOn";
/** The day the creature last offered to say the weather (`useWeatherLine`). */
export const ASKED_ON = "spar.weatherAskedOn";

export function readKept(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function keep(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // A device that keeps nothing hears the weather a little more often.
  }
}

/** The calendar day here, as YYYY-MM-DD. */
export function dayOf(at: Date): string {
  return `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, "0")}-${String(at.getDate()).padStart(2, "0")}`;
}

/**
 * What to say from a forecast now, if anything — and the note of it, written
 * down so it is not said again too soon. A good day tomorrow comes first: it
 * is the line that is news. `fresh` is a Yes just tapped: the weather now is
 * said whatever the clock says.
 */
export function weatherLine(forecast: Forecast, now: Date, fresh = false): string | null {
  const day = dayOf(now);
  if (now.getHours() >= GOOD_DAY_FROM_HOUR && readKept(GOOD_DAY_ON) !== day) {
    const good = goodDayTomorrow(forecast);
    if (good) {
      keep(GOOD_DAY_ON, day);
      return goodDayWords(good);
    }
  }
  const last = Number(readKept(SAID_AT) ?? 0);
  if (!fresh && now.getTime() - last < WEATHER_EVERY_MS) return null;
  keep(SAID_AT, String(now.getTime()));
  return nowWords(forecast);
}

/** The forecast as Open-Meteo sends it, read defensively: anything missing is no forecast. */
export function readForecast(raw: unknown): Forecast | null {
  const r = raw as {
    current?: { time?: unknown; temperature_2m?: unknown; weather_code?: unknown };
    hourly?: { time?: unknown; temperature_2m?: unknown; weather_code?: unknown };
  } | null;
  const c = r?.current;
  const h = r?.hourly;
  if (!c || !h) return null;
  if (typeof c.time !== "string" || typeof c.temperature_2m !== "number" || typeof c.weather_code !== "number") {
    return null;
  }
  if (!Array.isArray(h.time) || !Array.isArray(h.temperature_2m) || !Array.isArray(h.weather_code)) return null;
  return {
    current: { time: c.time, temperature: c.temperature_2m, code: c.weather_code },
    hourly: { time: h.time as string[], temperature: h.temperature_2m as number[], code: h.weather_code as number[] },
  };
}
