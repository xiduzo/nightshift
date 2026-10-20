import { useEffect, useState } from "react";

/** The current time, updated every `intervalMs`, for "waiting 5 minutes" labels. `null` stops the updates. */
export function useNow(intervalMs: number | null): number {
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		if (intervalMs === null) return;
		setNow(Date.now());
		const timer = setInterval(() => setNow(Date.now()), intervalMs);
		return () => clearInterval(timer);
	}, [intervalMs]);
	return now;
}
