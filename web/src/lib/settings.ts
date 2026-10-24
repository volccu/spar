import { useSyncExternalStore } from "react";

/**
 * This device's settings — the Settings layer's switches that are new with it
 * (2026-10-11, owner approved). Every one is kept on the device, never synced:
 * the owner chose that so nothing here needs a column, a migration or a merge
 * rule, and a phone and a laptop can sensibly want different answers (a light
 * room, a thumb at the bottom of the screen). The two switches that moved in
 * from About keep their own modules and keys (`hapticsSwitch.ts`,
 * `appBadge.ts`); so does the reminder ringing (`store/push.ts`).
 *
 * A setting is a key and a closed list of answers. Storage that throws, or a
 * value this build does not know, reads as the default — and the default is
 * stored as nothing at all, so a device that never opened Settings carries no
 * key. Every write is told to whoever listens, in this tab directly and in
 * the others through the `storage` event, so the board row moves and the
 * theme turns the moment the switch is pressed.
 */

export const SETTINGS = {
  /** Dark is the default; System follows the device's own light/dark preference, and is stored. */
  theme: { key: "spar.theme", values: ["system", "light", "dark"], fallback: "dark" },
  /** Reduced adds to `prefers-reduced-motion`; it never takes it away. */
  motion: { key: "spar.motion", values: ["system", "reduced"], fallback: "system" },
  /** Where the phone's board row stands. A desktop's strip is always at the top. */
  boardRow: { key: "spar.boardRow", values: ["top", "bottom"], fallback: "top" },
  /** Off: no link is sent to the preview service from this device. */
  previews: { key: "spar.previews", values: ["fetch", "off"], fallback: "fetch" },
  /** The creature's weather lines (`lib/useWeatherLine.ts`). Off: no location is asked for and nothing is sent. */
  weather: { key: "spar.weather", values: ["on", "off"], fallback: "on" },
} as const;

export type SettingName = keyof typeof SETTINGS;
export type SettingValue<N extends SettingName> = (typeof SETTINGS)[N]["values"][number];

const listeners = new Set<() => void>();

function notify() {
  for (const listener of [...listeners]) listener();
}

export function readSetting<N extends SettingName>(name: N): SettingValue<N> {
  const { key, values, fallback } = SETTINGS[name];
  try {
    const stored = localStorage.getItem(key);
    return (values as readonly string[]).includes(stored ?? "")
      ? (stored as SettingValue<N>)
      : fallback;
  } catch {
    return fallback;
  }
}

export function writeSetting<N extends SettingName>(name: N, value: SettingValue<N>): void {
  const { key, fallback } = SETTINGS[name];
  try {
    if (value === fallback) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // A private window that refuses storage keeps the default; nothing to say.
  }
  notify();
}

let watchingTabs = false;

/** Called on every write here and on any storage change from another tab. */
export function onSettingsChange(listener: () => void): () => void {
  listeners.add(listener);
  if (!watchingTabs && typeof window !== "undefined") {
    watchingTabs = true;
    window.addEventListener("storage", (event) => {
      if (event.key === null || event.key.startsWith("spar.")) notify();
    });
  }
  return () => {
    listeners.delete(listener);
  };
}

/** One setting's answer, kept current while the component is mounted. */
export function useSetting<N extends SettingName>(name: N): SettingValue<N> {
  return useSyncExternalStore(
    onSettingsChange,
    () => readSetting(name),
    () => SETTINGS[name].fallback,
  );
}
