import type { Suggestion, SuggestionRequest } from "@nightshift/flows";
import { useCallback, useEffect, useRef, useState } from "react";
import { client } from "@/shared/api";
import { followSuggestion } from "./follow-suggestion";

/** Where one suggestion request is. */
export type SuggestionState =
	| { status: "idle" }
	/** `activity`: what the agent does now, or null before it says. */
	| { status: "running"; activity: string | null }
	| { status: "ready"; suggestion: Suggestion }
	| { status: "failed"; message: string };

const IDLE: SuggestionState = { status: "idle" };

/**
 * One suggestion at a time for one field: `start` asks (and stops the one
 * before), `stop` stops it and forgets the result. Unmounting stops it too,
 * so closing the popover or the inspector ends the agent's work.
 */
export function useSuggestion() {
	const [state, setState] = useState<SuggestionState>(IDLE);
	const running = useRef<AbortController | null>(null);

	useEffect(() => () => running.current?.abort(), []);

	const start = useCallback((request: SuggestionRequest) => {
		running.current?.abort();
		const controller = new AbortController();
		running.current = controller;
		setState({ status: "running", activity: null });
		void followSuggestion({
			client,
			request,
			signal: controller.signal,
			onActivity: (activity) => {
				if (!controller.signal.aborted)
					setState({ status: "running", activity });
			},
		}).then((result) => {
			if (controller.signal.aborted) return;
			running.current = null;
			setState(
				result.ok
					? { status: "ready", suggestion: result.suggestion }
					: { status: "failed", message: result.message },
			);
		});
	}, []);

	const stop = useCallback(() => {
		running.current?.abort();
		running.current = null;
		setState(IDLE);
	}, []);

	return { state, start, stop };
}
