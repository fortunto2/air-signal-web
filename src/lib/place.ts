/**
 * The reader's own place, remembered in the browser.
 *
 * One city, not a list. A person checking whether to walk the dog has one answer they want first,
 * and a favourites list is a feature for a different product — it can grow later without changing
 * what is stored here, because a single entry is the degenerate case of a list.
 *
 * It lives in `localStorage` and nowhere else. No account, no cookie, no server-side profile:
 * the site does not know who you are and should not start now. That also keeps the HTML
 * cacheable at the edge — personalisation happens in an island after the page is already correct
 * for everyone.
 */

const KEY = "airsignal:place";

export interface Place {
  name: string;
  country: string;
  /** The city page's path, so the island never has to rebuild a URL. */
  path: string;
  lat: number;
  lon: number;
  /** How it was chosen — a location fix or a deliberate pick. Shown, so it can be corrected. */
  from: "location" | "chosen";
}

export function readPlace(): Place | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<Place>;
    // Narrowed rather than trusted: this string survives deploys, and a shape from three versions
    // ago must not take a page down.
    if (typeof p?.path !== "string" || typeof p?.name !== "string") return null;
    if (!Number.isFinite(p.lat) || !Number.isFinite(p.lon)) return null;
    return {
      name: p.name,
      country: typeof p.country === "string" ? p.country : "",
      path: p.path,
      lat: p.lat as number,
      lon: p.lon as number,
      from: p.from === "location" ? "location" : "chosen",
    };
  } catch {
    return null;
  }
}

export function writePlace(place: Place): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(place));
  } catch {
    // Private browsing, a full quota, a locked-down profile. Losing the preference is a small
    // disappointment; throwing here would take the page with it.
  }
}

export function clearPlace(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* see writePlace */
  }
}

/**
 * Ask the browser where we are, then ask the database what that is called.
 *
 * `enableHighAccuracy` is off on purpose: this resolves to a town, and turning on the GPS to pick
 * between two streets would cost battery and a slower fix for a precision the answer discards.
 */
export async function locate(): Promise<Place> {
  if (!("geolocation" in navigator)) throw new Error("This browser cannot share a location");

  const position = await new Promise<GeolocationPosition>((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: false,
      timeout: 10_000,
      maximumAge: 300_000,
    });
  });

  const { latitude, longitude } = position.coords;
  const res = await fetch(`/api/nearest?lat=${latitude.toFixed(2)}&lon=${longitude.toFixed(2)}`, {
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error("Could not find a city near you");

  const city = (await res.json()) as {
    name: string;
    country: string;
    path: string;
    lat: number;
    lon: number;
  };
  return { ...city, from: "location" };
}

/** The message to show when a location request fails, in the reader's terms rather than the API's. */
export function locateError(err: unknown): string {
  const code = (err as GeolocationPositionError | undefined)?.code;
  if (code === 1) return "Location permission denied — pick a city instead";
  if (code === 2) return "Your location is unavailable right now";
  if (code === 3) return "Locating took too long — pick a city instead";
  return err instanceof Error ? err.message : "Could not determine your location";
}
