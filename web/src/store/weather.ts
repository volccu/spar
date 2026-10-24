import { readForecast, type Forecast } from "../lib/weather";

/**
 * Where the creature's weather comes from (2026-10-23, owner approved:
 * Open-Meteo, the phone's own location, a Settings switch that is on until
 * turned off).
 *
 * **The one call this app's browser makes to anybody but its own server.** It
 * is not the backend and does not go through `getBackend()`: it carries no
 * note, no account and no key — only a place, rounded to a tenth of a degree
 * (about ten kilometres) before it leaves the device, and asked at most once an
 * hour. `deploy/nginx.conf` lets exactly this host through `connect-src`, and
 * lets this site — itself, no one else — ask for the location. Nothing is sent
 * while the switch is off or the location has not been given.
 */

const HOST = "https://api.open-meteo.com/v1/forecast";
/** How long one answer is good for. */
export const FORECAST_KEEP_MS = 60 * 60_000;
const CACHE_KEY = "spar.weatherCache";

/** A place, rounded before it is ever written down or sent. */
export function roughly(coord: number): number {
  return Math.round(coord * 10) / 10;
}

export function forecastUrl(lat: number, lon: number): string {
  const q = new URLSearchParams({
    latitude: String(roughly(lat)),
    longitude: String(roughly(lon)),
    current: "temperature_2m,weather_code",
    hourly: "temperature_2m,weather_code",
    timezone: "auto",
    forecast_days: "2",
  });
  return `${HOST}?${q}`;
}

/** Whether this browser could ever give a location, and what it says it will do. */
export async function locationAnswer(): Promise<PermissionState | "none"> {
  if (typeof navigator === "undefined" || !navigator.geolocation) return "none";
  try {
    const status = await navigator.permissions?.query({ name: "geolocation" });
    return status?.state ?? "prompt";
  } catch {
    // A browser that cannot be asked about it asks the person instead.
    return "prompt";
  }
}

/** The device's place, roughly. Rejects if it is refused or does not come. */
export function whereIsThis(): Promise<{ lat: number; lon: number }> {
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: roughly(p.coords.latitude), lon: roughly(p.coords.longitude) }),
      reject,
      // A town is all it needs: no GPS, and a fix up to an hour old will do.
      { enableHighAccuracy: false, maximumAge: FORECAST_KEEP_MS, timeout: 20_000 },
    );
  });
}

interface Cached {
  at: number;
  lat: number;
  lon: number;
  raw: unknown;
}

function cached(lat: number, lon: number, now: number): Forecast | null {
  try {
    const c = JSON.parse(localStorage.getItem(CACHE_KEY) ?? "null") as Cached | null;
    if (!c || c.lat !== lat || c.lon !== lon || now - c.at > FORECAST_KEEP_MS) return null;
    return readForecast(c.raw);
  } catch {
    return null;
  }
}

/** The forecast for a place, from this device's hour-old copy if it has one. Null on any failure. */
export async function forecastFor(lat: number, lon: number, now = Date.now()): Promise<Forecast | null> {
  const kept = cached(lat, lon, now);
  if (kept) return kept;
  try {
    const answer = await fetch(forecastUrl(lat, lon));
    if (!answer.ok) return null;
    const raw: unknown = await answer.json();
    const forecast = readForecast(raw);
    if (!forecast) return null;
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({ at: now, lat, lon, raw } satisfies Cached));
    } catch {
      // No room, or no storage: it is simply asked again next time.
    }
    return forecast;
  } catch {
    return null;
  }
}
