/**
 * The phase of the moon, for the Night Shift logo. The phase is the same
 * everywhere on Earth at one instant, so it needs no time zone.
 */

import { DAY_MS, type Instant, now } from "./clock";

/**
 * One of the eight phases the moon emoji show, from 🌑 to 🌘:
 * 0 new, 1 waxing crescent, 2 first quarter, 3 waxing gibbous, 4 full,
 * 5 waning gibbous, 6 last quarter, 7 waning crescent.
 */
export type MoonPhase = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

/** The mean time from one new moon to the next. */
const SYNODIC_MONTH_MS = 29.530588853 * DAY_MS;
/** A known new moon: 2000-01-06 18:14 UTC. */
const NEW_MOON: Instant = Date.UTC(2000, 0, 6, 18, 14);

/** The phase of the moon at `at`, the nearest of the eight. */
export function moonPhase(at: Instant = now()): MoonPhase {
	const age = (at - NEW_MOON) / SYNODIC_MONTH_MS;
	const fraction = age - Math.floor(age);
	return (Math.round(fraction * 8) % 8) as MoonPhase;
}
