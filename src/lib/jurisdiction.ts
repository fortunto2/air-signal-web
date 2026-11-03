/**
 * Which rulebook a place falls under. Two today: California's (Cal/OSHA §5141.1 smoke, §3395 heat,
 * and PG&E's E-TOU-C peak for the home signal) and Turkey's (the national air quality index bands
 * and the heat guidance, airq-core `rulebooks/tr.json`; mostly guidance, each rule says which).
 * Every other state and country gets none, and the plan then carries the forecast and the checks
 * without thresholds. Pure, so the mapping is tested and a new rulebook is one line here.
 */

export type Jurisdiction = "US-CA" | "TR";

/** Rulebooks that cover a whole country, whatever the province. */
const BY_COUNTRY: Record<string, Jurisdiction> = { TR: "TR" };

const BY_STATE: Record<string, Record<string, Jurisdiction>> = {
  US: { California: "US-CA" },
};

/** `("US", "California")` → "US-CA"; `("TR", any)` → "TR"; `("US", "Illinois")`, `("DE", …)`, `(null, null)` → null. */
export function jurisdictionFor(country: string | null | undefined, state: string | null | undefined): Jurisdiction | null {
  if (!country) return null;
  const c = country.toUpperCase();
  if (BY_COUNTRY[c]) return BY_COUNTRY[c];
  if (!state) return null;
  return BY_STATE[c]?.[state] ?? null;
}

/** The language a jurisdiction's own pages speak; the API answers in it when asked for `lang=tr`. */
export const JURISDICTION_LANG: Record<Jurisdiction, "en" | "tr"> = { "US-CA": "en", TR: "tr" };
