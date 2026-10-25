/**
 * Which rulebook a place falls under. One today: California's (Cal/OSHA §5141.1 smoke, §3395 heat,
 * and PG&E's E-TOU-C peak for the home signal). Every other state and country gets none, and the
 * plan then carries the forecast and the checks without legal thresholds. Pure, so the mapping is
 * tested and a second rulebook is one more line here, not a condition somewhere in the plan.
 */

export type Jurisdiction = "US-CA";

const BY_STATE: Record<string, Record<string, Jurisdiction>> = {
  US: { California: "US-CA" },
};

/** `("US", "California")` → "US-CA"; `("US", "Illinois")`, `("DE", …)`, `(null, null)` → null. */
export function jurisdictionFor(country: string | null | undefined, state: string | null | undefined): Jurisdiction | null {
  if (!country || !state) return null;
  return BY_STATE[country.toUpperCase()]?.[state] ?? null;
}
