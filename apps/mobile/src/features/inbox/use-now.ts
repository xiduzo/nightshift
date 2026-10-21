import { useEffect, useState } from "react";

/** The time now, again every `everyMs`: for "Waiting 12 min". */
export function useNow(everyMs = 30_000): number {
	const [now, setNow] = useState(Date.now);
	useEffect(() => {
		const timer = setInterval(() => setNow(Date.now()), everyMs);
		return () => clearInterval(timer);
	}, [everyMs]);
	return now;
}
