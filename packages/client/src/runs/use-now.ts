import { useEffect, useState } from "react";

import { now } from "../time";

/**
 * The time now, again every `everyMs`, for labels such as "waiting 5 min"
 * (`agoLabel`). `null` stops the updates.
 */
export function useNow(everyMs: number | null = 30_000): number {
	const [current, setNow] = useState(now);
	useEffect(() => {
		if (everyMs === null) return;
		setNow(now());
		const timer = setInterval(() => setNow(now()), everyMs);
		return () => clearInterval(timer);
	}, [everyMs]);
	return current;
}
