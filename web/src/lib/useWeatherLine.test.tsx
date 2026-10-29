// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const gate = vi.hoisted(() => ({ wait: null as Promise<void> | null, said: 0 }));

vi.mock("./settings", () => ({ useSetting: () => "on" }));
vi.mock("./weather", () => ({
  weatherLine: () => {
    gate.said += 1;
    return "Now 12° and rain.";
  },
  weatherStrong: () => ["12°", "rain"],
  dayOf: () => "d",
  readKept: () => null,
  keep: () => {},
  ASKED_ON: "a",
}));
vi.mock("../store/weather", () => ({
  locationAnswer: async () => "granted",
  whereIsThis: async () => ({ lat: 1, lon: 2 }),
  forecastFor: async () => {
    await gate.wait;
    return {};
  },
}));

import { useWeatherLine } from "./useWeatherLine";

afterEach(() => vi.useRealTimers());

describe("useWeatherLine", () => {
  it("hands the facts to set in bold along with an unprompted weather line", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { result } = renderHook(() => useWeatherLine(false));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(7_000);
    });
    expect(result.current?.words).toBe("Now 12° and rain.");
    expect(result.current?.strong).toEqual(["12°", "rain"]);
  });

  it("says nothing when a note is opened while the forecast is still coming, and says it once that is over", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    gate.said = 0;
    let release = () => {};
    gate.wait = new Promise<void>((r) => (release = r));
    const { result, rerender } = renderHook(({ quiet }) => useWeatherLine(quiet), { initialProps: { quiet: false } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(7_000);
    });
    rerender({ quiet: true });
    gate.wait = null;
    await act(async () => {
      release();
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(result.current).toBeNull();
    expect(gate.said).toBe(0);
    rerender({ quiet: false });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(result.current?.words).toBe("Now 12° and rain.");
  });
});
