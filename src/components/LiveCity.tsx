/**
 * Live readings for a city.
 *
 * This island renders almost nothing. Its job is to take what the server already wrote into the
 * HTML and make it current — the score, the spectrum, the per-signal grid, the timestamp. If it
 * never runs, the page is complete and correct as of the last computation; if it runs, the page is
 * correct as of a minute ago. Those are the only two states allowed.
 *
 * That is also why it patches the DOM instead of rendering its own copy of the readout. A second
 * React-owned score sitting next to the server's would be two sources of truth on one screen, and
 * the one a crawler reads would be the one nobody maintains.
 *
 * It asks `/api/comfort` rather than computing anything. The earlier version loaded 91 KB of
 * WebAssembly and called four upstreams from the browser, which worked but made every visitor pay
 * for a calculation the Worker already does — and forced the binary to be imported two ways, which
 * is what stopped it working in the Worker at all. One place computes comfort now.
 */

import { useEffect, useState } from "react";
import { SIGNALS, comfortBand, type SignalKey } from "../lib/site";

interface Props {
  lat: number;
  lon: number;
  cityName: string;
}

type State = "loading" | "done" | "stale" | "failed";

interface Answer {
  total: number;
  worst: SignalKey | null;
  scores: Partial<Record<SignalKey, number>>;
  readings: Record<string, number>;
}

export default function LiveCity({ lat, lon }: Props) {
  const [state, setState] = useState<State>("loading");
  const [at, setAt] = useState<Date | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch(`/api/comfort?lat=${lat}&lon=${lon}`, {
          signal: AbortSignal.timeout(12_000),
        });
        if (cancelled) return;

        // 503 is the upstreams being unavailable, not a bug. The server's numbers stay on screen
        // and the line below says they are the last ones we could get.
        if (res.status === 503) return setState("stale");
        if (!res.ok) return setState("failed");

        const data = (await res.json()) as Answer;
        if (cancelled) return;

        paint(data.total, data.scores);
        setAt(new Date());
        setState("done");
      } catch {
        // A failed refresh leaves the server's numbers exactly as they were, which is the correct
        // outcome — they are real, just older. Saying nothing would be the bug.
        if (!cancelled) setState("failed");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [lat, lon]);

  // Always renders the line, even while loading. An island that returns `null` has no box, and a
  // component with no box never intersects the viewport — which is how this shipped once with
  // `client:visible` and simply never ran. The row is reserved either way so nothing shifts.
  return (
    <p
      className="eyebrow"
      style={{ padding: "10px 4px 0", textAlign: "right", minHeight: "1.4em" }}
      aria-live="polite"
    >
      {state === "done"
        ? `Refreshed live at ${at?.toISOString().slice(11, 16)} UTC`
        : state === "stale"
          ? "Upstreams busy — showing the last computed values"
          : state === "failed"
            ? "Could not refresh — showing the last computed values"
            : "Refreshing…"}
    </p>
  );
}

/**
 * Patch what the server rendered.
 *
 * Every element touched here was already in the HTML with a real value. Nothing is created, so
 * there is no arrangement in which this function is what makes the page readable.
 */
function paint(total: number, scores: Partial<Record<SignalKey, number>>) {
  const band = comfortBand(total);

  const score = document.querySelector<HTMLElement>('[data-live="comfort"]');
  if (score) {
    score.textContent = String(total);
    score.className = `value fg-${band}`;
  }

  const word = document.querySelector<HTMLElement>(".verdict .word");
  if (word) word.className = `word fg-${band}`;

  const cols = document.querySelectorAll<HTMLElement>(".spectrum .col");
  SIGNALS.forEach((s, i) => {
    const col = cols[i];
    const fill = col?.querySelector<HTMLElement>(".bar-fill");
    if (!col || !fill) return;

    const v = scores[s.key];
    if (v === undefined) {
      col.classList.add("is-absent");
      fill.className = "bar-fill";
      fill.style.height = "";
      fill.title = `${s.name} — no reading`;
      return;
    }
    col.classList.remove("is-absent");
    fill.className = `bar-fill scale-${comfortBand(v)}`;
    fill.style.height = `${Math.max(4, v)}%`;
    fill.title = `${s.name} — ${v}/100`;
  });

  const cells = document.querySelectorAll<HTMLElement>(".grid-signals .sig");
  SIGNALS.forEach((s, i) => {
    const cell = cells[i];
    if (!cell) return;
    const v = scores[s.key];
    const pts = cell.querySelector<HTMLElement>(".pts");
    const track = cell.querySelector<HTMLElement>(".track i");
    if (pts) pts.textContent = v === undefined ? "—" : String(v);
    if (track && v !== undefined) {
      track.className = `scale-${comfortBand(v)}`;
      track.style.width = `${v}%`;
    }
  });
}
