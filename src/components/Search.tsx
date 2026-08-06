/**
 * Search, in the bar, on every page.
 *
 * What was here before was a link to the map wearing a magnifying glass — the shape of a search box
 * with none of the behaviour. Ten thousand city pages and nine thousand device pages are not
 * reachable by browsing, so the box is the only route to most of the site.
 *
 * It answers two kinds of query from one field: a name ("sofia") and a device id ("82613"), because
 * the person typing the number is usually the person who owns the box and has no idea which town
 * we filed it under.
 *
 * Progressive by construction: the island replaces a plain link, so with no JavaScript the reader
 * still lands on the map rather than on a dead input.
 */

import { useEffect, useRef, useState } from "react";
import { pmBand } from "../lib/site";

interface Hit {
  kind: "city" | "station";
  id: number;
  name: string;
  detail: string;
  path: string;
  pm25: number | null;
  comfort: number | null;
}

export default function Search({ placeholder = "Search a city or sensor id" }: { placeholder?: string }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(0);
  const [busy, setBusy] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  // One request per pause in typing, and the previous one is abandoned rather than raced: without
  // the abort, "sof" can land after "sofia" and overwrite the better answer with a worse one.
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setHits([]);
      setBusy(false);
      return;
    }
    const ac = new AbortController();
    setBusy(true);
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(term)}`, { signal: ac.signal });
        const body = (await res.json()) as { hits: Hit[] };
        setHits(body.hits ?? []);
        setCursor(0);
      } catch {
        // An aborted request is the normal case here, not a failure worth showing.
      } finally {
        if (!ac.signal.aborted) setBusy(false);
      }
    }, 180);
    return () => {
      clearTimeout(t);
      ac.abort();
    };
  }, [q]);

  // Clicking anywhere else closes the list. Focus alone is not enough: a reader who clicks a
  // heading behind the dropdown expects it gone.
  useEffect(() => {
    const away = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, []);

  // `/` focuses the box from anywhere, the way every search on the web behaves — but not while the
  // reader is already typing into something.
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (e.key === "/" && tag !== "INPUT" && tag !== "TEXTAREA") {
        e.preventDefault();
        input.current?.focus();
      }
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, []);

  const go = (hit: Hit) => {
    window.location.href = hit.path;
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") return setOpen(false);
    if (!hits.length) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor((c) => (c + 1) % hits.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor((c) => (c - 1 + hits.length) % hits.length);
    } else if (e.key === "Enter" && hits[cursor]) {
      e.preventDefault();
      go(hits[cursor]!);
    }
  };

  const showing = open && q.trim().length >= 2;

  return (
    <div className="searchbox" ref={box}>
      <label className="search" htmlFor="q">
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.5" />
          <path d="M11 11l4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
        <input
          id="q"
          ref={input}
          type="search"
          value={q}
          placeholder={placeholder}
          autoComplete="off"
          role="combobox"
          aria-expanded={showing}
          aria-controls="search-results"
          aria-label="Search a city or sensor id"
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKey}
        />
      </label>

      {showing && (
        <div className="results" id="search-results" role="listbox">
          {hits.map((h, i) => (
            <a
              key={`${h.kind}-${h.id}`}
              href={h.path}
              role="option"
              aria-selected={i === cursor}
              className={i === cursor ? "hit is-on" : "hit"}
              onMouseEnter={() => setCursor(i)}
            >
              <span className="hit-name">
                {h.name}
                {h.kind === "station" && <span className="hit-kind">sensor</span>}
              </span>
              <span className="hit-detail">{h.detail}</span>
              {h.pm25 !== null && (
                <span className={`num fg-${pmBand(h.pm25)}`}>{h.pm25.toFixed(1)}</span>
              )}
            </a>
          ))}

          {!hits.length && (
            <div className="hit-empty">
              {busy ? "Searching…" : `Nothing matches “${q.trim()}”`}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
