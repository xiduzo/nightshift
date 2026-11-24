/**
 * What every part of the dashboard measures with: the ranges of days, a
 * spread and the first rows of a list.
 */

/** The day ranges the details offer: 7, 30 or 90 days (`read/views.ts`). */
export const NIGHT_RANGES = [7, 30, 90] as const;
export type NightRange = (typeof NIGHT_RANGES)[number];

/** The runs an overview list shows. The full list is one link away. */
export const OVERVIEW_ROWS = 5;

/** The five-number summary of a set of values, such as what runs cost. */
export type Spread = {
	min: number;
	q1: number;
	median: number;
	q3: number;
	max: number;
	/** How many values it covers. */
	count: number;
};

/** The first rows of a ranked list, and how many rows it has in all. */
export type TopRows<T> = { rows: T[]; count: number };
