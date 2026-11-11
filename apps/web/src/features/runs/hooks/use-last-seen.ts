import { now } from "@nightshift/client";
import { useEffect, useState } from "react";

const KEY = (runId: string) => `nightshift:run-seen:${runId}`;

/** How often an open, visible run page notes that the person sees it. */
const NOTE_MS = 15_000;

function read(runId: string): number | null {
	try {
		const value = Number(localStorage.getItem(KEY(runId)));
		return Number.isFinite(value) && value > 0 ? value : null;
	} catch {
		return null;
	}
}

function write(runId: string, at: number) {
	try {
		localStorage.setItem(KEY(runId), String(at));
	} catch {
		// Storage is off: the page shows no "new since you looked" line.
	}
}

/**
 * When the person last had this run open, in this browser: the time the
 * page opened with, so steps after it read as new. While the page shows,
 * it notes the time again, so the next visit starts from here.
 */
export function useLastSeen(runId: string): number | null {
	const [seen] = useState(() =>
		typeof window === "undefined" ? null : read(runId),
	);
	useEffect(() => {
		const note = () => {
			if (document.visibilityState === "visible") write(runId, now());
		};
		note();
		const timer = window.setInterval(note, NOTE_MS);
		const hide = () => {
			// The page was in view until now.
			if (document.visibilityState === "hidden") write(runId, now());
		};
		document.addEventListener("visibilitychange", hide);
		return () => {
			window.clearInterval(timer);
			document.removeEventListener("visibilitychange", hide);
			write(runId, now());
		};
	}, [runId]);
	return seen;
}
