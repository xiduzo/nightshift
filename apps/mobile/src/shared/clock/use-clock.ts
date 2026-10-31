import { useSyncExternalStore } from "react";
import { AppState } from "react-native";

import { createTicker, type Ticker } from "./ticker";

const tickers = new Map<number, Ticker>();

/** The shared ticker of a period. The first one also listens for the app to come back. */
function tickerOf(everyMs: number): Ticker {
	let ticker = tickers.get(everyMs);
	if (!ticker) {
		if (tickers.size === 0) {
			AppState.addEventListener("change", (state) => {
				if (state !== "active") return;
				for (const each of tickers.values()) each.tick();
			});
		}
		ticker = createTicker(everyMs);
		tickers.set(everyMs, ticker);
	}
	return ticker;
}

/**
 * The time now, again every `everyMs`, from one ticker that every caller
 * of that period shares. Call it in the smallest part that shows a time,
 * a row or a text, not in a screen: only that part re-renders on a tick.
 * It ticks at once when the app comes back to the front.
 */
export function useClock(everyMs = 30_000): number {
	const ticker = tickerOf(everyMs);
	return useSyncExternalStore(ticker.subscribe, ticker.now);
}
