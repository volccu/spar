// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
  goodDayTomorrow,
  goodDayWords,
  weatherStrong,
  nowWords,
  readForecast,
  WEATHER_EVERY_MS,
  weatherLine,
  weatherWord,
  type Forecast,
} from "./weather";
import { forecastUrl, roughly } from "../store/weather";

/** A two-day forecast: today's and tomorrow's hours, each at one temperature and code unless told otherwise. */
function forecast(opts: {
  now?: string;
  today?: { temperature: number; code: number };
  tomorrow?: (hour: number) => { temperature: number; code: number };
}): Forecast {
  const now = opts.now ?? "2026-10-23T13:00";
  const time: string[] = [];
  const temperature: number[] = [];
  const code: number[] = [];
  for (const day of ["2026-10-23", "2026-10-24"]) {
    for (let h = 0; h < 24; h++) {
      time.push(`${day}T${String(h).padStart(2, "0")}:00`);
      const w = day === "2026-10-23" ? (opts.today ?? { temperature: 8, code: 3 }) : (opts.tomorrow?.(h) ?? { temperature: 8, code: 3 });
      temperature.push(w.temperature);
      code.push(w.code);
    }
  }
  return { current: { time: now, temperature: 8.4, code: 3 }, hourly: { time, temperature, code } };
}

describe("the words", () => {
  it("says the weather now in one small sound and plain facts", () => {
    expect(nowWords(forecast({}))).toBe("Beep. 8° and cloudy out.");
    expect(nowWords({ ...forecast({}), current: { time: "x", temperature: -0.3, code: 71 } })).toBe(
      "Beep. 0° and snowy out.",
    );
  });

  it("names the codes the way a person would", () => {
    expect(weatherWord(0)).toBe("clear");
    expect(weatherWord(2)).toBe("partly cloudy");
    expect(weatherWord(45)).toBe("foggy");
    expect(weatherWord(53)).toBe("drizzly");
    expect(weatherWord(81)).toBe("rainy");
    expect(weatherWord(96)).toBe("stormy");
  });

  it("says a good day with its warmest sunny hour", () => {
    expect(goodDayWords({ temperature: 21.4, hour: 14 })).toBe("Hm. Sunny and 21° tomorrow around 14:00.");
  });
});

describe("a good day tomorrow", () => {
  const sunnyFrom = (from: number, to: number, temp: (h: number) => number) => (h: number) =>
    h >= from && h <= to ? { temperature: temp(h), code: 0 } : { temperature: 8, code: 3 };

  it("is four clear daytime hours, warm enough, and names the warmest", () => {
    const fc = forecast({ tomorrow: sunnyFrom(10, 16, (h) => 12 + (h === 14 ? 6 : 0)) });
    expect(goodDayTomorrow(fc)).toEqual({ temperature: 18, hour: 14 });
  });

  it("is not three clear hours, however warm", () => {
    expect(goodDayTomorrow(forecast({ tomorrow: sunnyFrom(12, 14, () => 22) }))).toBeNull();
  });

  it("counts only the day: clear night hours do not make it sunny", () => {
    expect(goodDayTomorrow(forecast({ tomorrow: sunnyFrom(0, 8, () => 22) }))).toBeNull();
  });

  it("is a cold sunny day only when it is clearly warmer than today", () => {
    // Today's warmest is 4°: a sunny 7° is three degrees of good news.
    expect(goodDayTomorrow(forecast({ today: { temperature: 4, code: 3 }, tomorrow: sunnyFrom(9, 15, () => 7) }))).toEqual({
      temperature: 7,
      hour: 9,
    });
    // Today was 6°: a sunny 7° is not.
    expect(goodDayTomorrow(forecast({ today: { temperature: 6, code: 3 }, tomorrow: sunnyFrom(9, 15, () => 7) }))).toBeNull();
  });
});

describe("when it is said", () => {
  beforeEach(() => localStorage.clear());

  it("says the weather now once, then not again for four hours", () => {
    const fc = forecast({});
    const at = new Date(2026, 9, 23, 9, 0);
    expect(weatherLine(fc, at)).toBe("Beep. 8° and cloudy out.");
    expect(weatherLine(fc, new Date(at.getTime() + 60_000))).toBeNull();
    expect(weatherLine(fc, new Date(at.getTime() + WEATHER_EVERY_MS))).toBe("Beep. 8° and cloudy out.");
    // A Yes just tapped is answered whatever the clock says.
    expect(weatherLine(fc, new Date(at.getTime() + WEATHER_EVERY_MS + 1), true)).toBe("Beep. 8° and cloudy out.");
  });

  it("puts a good day first, from noon, once a day", () => {
    const fc = forecast({ tomorrow: (h) => (h >= 10 && h <= 16 ? { temperature: 20, code: 0 } : { temperature: 8, code: 3 }) });
    // In the morning tomorrow is not yet a plan: the weather now.
    expect(weatherLine(fc, new Date(2026, 9, 23, 9, 0))).toBe("Beep. 8° and cloudy out.");
    expect(weatherLine(fc, new Date(2026, 9, 23, 13, 0))).toBe("Hm. Sunny and 20° tomorrow around 10:00.");
    expect(weatherLine(fc, new Date(2026, 9, 23, 18, 0))).toBe("Beep. 8° and cloudy out.");
  });
});

describe("what leaves the device", () => {
  it("is a place rounded to a tenth of a degree, and nothing else about anybody", () => {
    expect(roughly(60.16987)).toBe(60.2);
    const url = new URL(forecastUrl(60.16987, 24.93545));
    expect(url.host).toBe("api.open-meteo.com");
    expect(url.searchParams.get("latitude")).toBe("60.2");
    expect(url.searchParams.get("longitude")).toBe("24.9");
    expect([...url.searchParams.keys()].sort()).toEqual(
      ["current", "forecast_days", "hourly", "latitude", "longitude", "timezone"],
    );
  });

  it("reads only a whole answer as a forecast", () => {
    expect(readForecast(null)).toBeNull();
    expect(readForecast({ current: { time: "t", temperature_2m: 1, weather_code: 0 } })).toBeNull();
    expect(
      readForecast({
        current: { time: "t", temperature_2m: 1, weather_code: 0 },
        hourly: { time: [], temperature_2m: [], weather_code: [] },
      }),
    ).not.toBeNull();
  });
});

describe("weatherStrong", () => {
  it("picks out the temperature and the condition", () => {
    expect(weatherStrong("Beep. 12° and mostly clear out.")).toEqual(["12°", "mostly clear"]);
    expect(weatherStrong("Beep. -3° and partly cloudy out.")).toEqual(["-3°", "partly cloudy"]);
    expect(weatherStrong("Hm. Sunny and 21° tomorrow around 14:00.")).toEqual(["21°", "Sunny"]);
  });

  it("finds nothing in a line that is not about the weather", () => {
    expect(weatherStrong("Hm. Want the weather?")).toEqual([]);
  });
});
