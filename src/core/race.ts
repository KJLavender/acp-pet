// Race referee: the same task goes to every pet at once; pets that complete
// are ranked by finish time. Pets that fail or are cancelled aren't ranked.

import type { TurnOutcome } from "./events.js";

export type Racer = {
  feed(text: string, opts?: { demoSpeed?: number }): Promise<TurnOutcome | null>;
  raceResult(place: number, total: number): void;
  readonly busy: boolean;
};

export type RaceResult = { finishers: number[]; outcomes: (TurnOutcome | null)[] };

/**
 * Returns racer indexes in finishing order. `demoSpeeds` lets scripted
 * /demo races finish at different times (real agents differ on their own).
 */
export async function runRace(racers: Racer[], task: string, demoSpeeds?: number[]): Promise<RaceResult> {
  const entrants = racers.filter((r) => !r.busy);
  if (entrants.length < 2) throw new Error("a race needs at least two idle pets");
  const finishers: number[] = [];
  const outcomes = await Promise.all(
    racers.map(async (r, i) => {
      if (!entrants.includes(r)) return null;
      const outcome = await r.feed(task, demoSpeeds?.[i] ? { demoSpeed: demoSpeeds[i] } : {});
      if (outcome === "completed") finishers.push(i);
      return outcome;
    }),
  );
  finishers.forEach((i, place) => racers[i]!.raceResult(place + 1, entrants.length));
  return { finishers, outcomes };
}
