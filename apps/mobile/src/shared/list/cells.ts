/**
 * Where a row sits in its card, without React Native. A list (FlashList)
 * draws each row as its own piece of the card: the first piece has the
 * round top, the last the round bottom.
 */

/** One row of a card in a list: the item, and whether it starts or ends the card. */
export type Cell<T> = { item: T; first: boolean; last: boolean };

/** The items of one card, each with its place in it. */
export function cellsOf<T>(items: readonly T[]): Cell<T>[] {
	return items.map((item, index) => ({
		item,
		first: index === 0,
		last: index === items.length - 1,
	}));
}
