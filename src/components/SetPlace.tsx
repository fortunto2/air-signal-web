/**
 * "This is my place" — on a city page.
 *
 * The other half of `MyPlace`. Someone who searched their way to a city and found what they wanted
 * should be able to say so in one click, and then find it at the top of the home page next time.
 *
 * Deliberately not automatic. Remembering every city a person opens produces a list of places they
 * were curious about once, which is not the same as the place they live — and the site would then
 * be quietly wrong about the one thing it is supposed to know.
 */

import { useEffect, useState } from "react";
import { clearPlace, readPlace, writePlace } from "../lib/place";

interface Props {
  name: string;
  country: string;
  path: string;
  lat: number;
  lon: number;
}

export default function SetPlace({ name, country, path, lat, lon }: Props) {
  const [isMine, setIsMine] = useState<boolean | null>(null);

  // `null` until mounted, so the button never renders the wrong label for one frame.
  useEffect(() => {
    setIsMine(readPlace()?.path === path);
  }, [path]);

  if (isMine === null) return <span className="seg" style={{ opacity: 0.4 }}>·</span>;

  const toggle = () => {
    if (isMine) {
      clearPlace();
      setIsMine(false);
    } else {
      writePlace({ name, country, path, lat, lon, from: "chosen" });
      setIsMine(true);
    }
  };

  return (
    <button
      type="button"
      className={`seg${isMine ? " is-on" : ""}`}
      onClick={toggle}
      aria-pressed={isMine}
      title={isMine ? `${name} is your place — click to forget` : `Remember ${name} as your place`}
    >
      {isMine ? "★ your place" : "☆ make this my place"}
    </button>
  );
}
