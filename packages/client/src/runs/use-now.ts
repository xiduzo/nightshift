import { useEffect, useState } from "react";

/**
 * The time now, again every `everyMs`, for labels such as "waiting 5 min"
 * (`agoLabel`). `null` stops the updates.
 */
export function useNow(everyMs: number | null = 30_000): number {
	const [now, setNow] = useState(Date.now);
	useEffect(() => {
		if (everyMs === null) return;
		setNow(Date.now());
		const timer = setInterval(() => setNow(Date.now()), everyMs);
		return () => clearInterval(timer);
	}, [everyMs]);
	return now;
}
