/**
 * The reader's own place, on the home page.
 *
 * The site's front door is the same for everyone — it has to be, because the HTML is cached at the
 * edge and a page rendered per visitor is a page nobody gets quickly. So personalisation happens
 * here, after the cache, in an island: read the saved city, fetch its comfort, offer a link.
 *
 * Absent a saved city it offers to find one. That button is the whole feature: "is it worth going
 * outside" is a question about *here*, and making someone type their town first is making them do
 * the work the browser already did.
 */

import { useEffect, useState } from "react";
import { locate, locateError, readPlace, writePlace, type Place } from "../lib/place";
import { comfortBand } from "../lib/site";

type State = "idle" | "locating" | "loading" | "ready" | "failed";

export default function MyPlace() {
  const [place, setPlace] = useState<Place | null>(null);
  const [comfort, setComfort] = useState<number | null>(null);
  const [state, setState] = useState<State>("idle");
  const [error, setError] = useState<string | null>(null);

  // Read on mount, not during render: `localStorage` does not exist while the island is being
  // hydrated on the server's markup, and touching it there is a hydration mismatch.
  useEffect(() => {
    const saved = readPlace();
    if (saved) {
      setPlace(saved);
      setState("loading");
    }
  }, []);

  useEffect(() => {
    if (!place) return;
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch(`/api/comfort?lat=${place.lat}&lon=${place.lon}`, {
          signal: AbortSignal.timeout(12_000),
        });
        if (cancelled) return;
        if (!res.ok) return setState("ready"); // the link still works; only the number is missing
        const data = (await res.json()) as { total: number };
        if (cancelled) return;
        setComfort(data.total);
        setState("ready");
      } catch {
        if (!cancelled) setState("ready");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [place]);

  const findMe = async () => {
    setState("locating");
    setError(null);
    try {
      const found = await locate();
      writePlace(found);
      setPlace(found);
      setState("loading");
    } catch (err) {
      setError(locateError(err));
      setState("failed");
    }
  };

  if (place) {
    const band = comfort === null ? null : comfortBand(comfort);
    return (
      <a className="row" href={place.path} style={{ borderTop: "1px solid var(--line-soft)" }}>
        <span className="rank num" aria-hidden="true">
          ★
        </span>
        <span>
          <span className="city">{place.name}</span>{" "}
          <span className="country">
            {place.country}
            {place.from === "location" ? " · near you" : " · your place"}
          </span>
        </span>
        <span />
        <span className={`n${band ? ` fg-${band}` : ""}`}>
          {comfort ?? (state === "loading" ? "…" : "—")}
        </span>
      </a>
    );
  }

  return (
    <div style={{ padding: "12px 20px 16px", borderTop: "1px solid var(--line-soft)" }}>
      <button
        type="button"
        className="seg"
        onClick={findMe}
        disabled={state === "locating"}
        style={{ cursor: state === "locating" ? "progress" : "pointer" }}
      >
        {state === "locating" ? "Finding you…" : "Find the air near me →"}
      </button>
      {error && (
        <p className="eyebrow" style={{ marginTop: 8, color: "var(--s-poor)" }} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
