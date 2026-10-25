/**
 * What the plan said for one hour: the evidence a report or an observation carries, so "it was smoky"
 * arrives with the NowCast, the nearest satellite fire, the ground monitor and the wind. Pure, so the
 * hour-matching is tested without the engine.
 */

import type { CrewAnswer } from "./crew";

export function evidenceAt(answer: CrewAnswer, at: string) {
  const hour = answer.plan.hours.find((h) => h.time === at) ?? null;
  const wind = answer.wind.find((w) => w.time === at) ?? null;
  return {
    place: answer.place,
    hour: at,
    /** Absent when the plan has no row for that hour (outside the day the plan covers), never zero. */
    metrics: hour?.metrics ?? null,
    /** 10 m wind that hour, °from and km/h: which way the smoke someone smelled was coming from. */
    wind: wind ? { dir_deg: wind.dir_deg, kmh: wind.kmh } : null,
    confidence: answer.plan.confidence.level,
    fire: answer.plan.confidence.fire,
    ground: answer.plan.confidence.ground,
  };
}
