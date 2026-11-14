import { type MoonPhase, moonPhase } from "@nightshift/client";
import { useEffect, useState } from "react";

/** The phase changes about every 3.7 days: an hourly look is enough. */
const CHECK_MS = 60 * 60 * 1000;

/** The phase of the moon now. It follows the moon while the page stays open. */
export function useMoonPhase(): MoonPhase {
	const [phase, setPhase] = useState(() => moonPhase());
	useEffect(() => {
		const timer = setInterval(() => setPhase(moonPhase()), CHECK_MS);
		return () => clearInterval(timer);
	}, []);
	return phase;
}

/** The icon of a phase, from `bun run icons`. `waiting` adds the dot of an open Gate. */
export function moonIcon(phase: MoonPhase, waiting = false): string {
	return `/moon/${phase}${waiting ? "-waiting" : ""}.svg`;
}
