import { now } from "@nightshift/client";
import { useCallback, useEffect, useState } from "react";

/**
 * What this browser remembers of your looks at Home: when you last had it
 * open, which signals showed then, and which you said you looked at. It
 * stays in this browser. Another browser starts fresh.
 */

const KEY = "nightshift:home-look";

/** One signal that showed: its id, the key of its flow, and the flow's name. */
type Shown = { id: string; key: string; flow: string };

type Look = {
	/** When Home was last open. */
	at: number;
	/** The signals that showed then (`signalId`). */
	shown: Shown[];
	/** The signals you looked at, and when. */
	looked: Record<string, number>;
};

function read(): Look | null {
	try {
		const raw = window.localStorage.getItem(KEY);
		return raw ? (JSON.parse(raw) as Look) : null;
	} catch {
		return null;
	}
}

function write(look: Look) {
	try {
		window.localStorage.setItem(KEY, JSON.stringify(look));
	} catch {
		// Storage is off: every look is a first look.
	}
}

/**
 * The look before this one, and how to mark a signal as looked at. The
 * look of now is kept when Home closes, so a reload does not hide what
 * was new.
 */
export function useLastLook(showing: Shown[] | undefined) {
	// Read once: the look before this one stays the same while Home is open.
	const [before] = useState(() =>
		typeof window === "undefined" ? null : read(),
	);
	const [looked, setLooked] = useState<Record<string, number>>(
		() => before?.looked ?? {},
	);

	useEffect(() => {
		if (!showing) return;
		const keep = () => {
			const ids = new Set(showing.map((signal) => signal.id));
			write({
				at: now(),
				shown: showing,
				// A signal that is gone needs no memory.
				looked: Object.fromEntries(
					Object.entries(looked).filter(([id]) => ids.has(id)),
				),
			});
		};
		window.addEventListener("pagehide", keep);
		return () => {
			window.removeEventListener("pagehide", keep);
			keep();
		};
	}, [showing, looked]);

	const look = useCallback(
		(id: string) => setLooked((ids) => ({ ...ids, [id]: now() })),
		[],
	);
	const again = useCallback(
		(id: string) => setLooked(({ [id]: _gone, ...ids }) => ids),
		[],
	);
	return { before, looked, look, again };
}
