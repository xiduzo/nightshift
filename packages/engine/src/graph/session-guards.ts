import type { AgentEvent } from "@nightshift/agents/types";

/**
 * The guards of one harness session that read its events: the turn limit
 * and the loop guard. Pure: the Agent node feeds each event in order and
 * stops the session on the first trip. The run budget is not here: it
 * reads the log (`deriveBudgetSpend`), not the session's events.
 *
 * A turn is one reply of the model: it starts with the first text or tool
 * call after a tool's result (or at the start of the session). Parallel
 * tool calls of one reply are one turn. A step report ends a turn like a
 * tool's result: the harness sends it when the report tool answered.
 * A subagent's events (`parentToolCallId`) count for neither guard.
 */

/** How many identical tool calls in a row mean the agent loops. */
export const LOOP_REPEATS = 3;

/** What tripped a guard: the step ends `fail`. */
export type GuardTrip =
	| { kind: "turns"; limit: number }
	| { kind: "looping"; tool: string };

export type SessionGuards = {
	/** Sees the next event of the session. Returns the trip, once, or null. */
	see(event: AgentEvent): GuardTrip | null;
};

/**
 * The guards of one session. `maxTurns` null: the engine counts no turns
 * (no limit, or the harness enforces it itself).
 */
export function sessionGuards(options: {
	maxTurns: number | null;
}): SessionGuards {
	const { maxTurns } = options;
	let turns = 0;
	let replyOver = true;
	let lastCall: string | null = null;
	let repeats = 0;
	let tripped = false;

	const trip = (found: GuardTrip): GuardTrip => {
		tripped = true;
		return found;
	};

	return {
		see(event) {
			if (tripped) return null;
			// A subagent's turns and calls are its own, not the session agent's.
			if ("parentToolCallId" in event && event.parentToolCallId) return null;
			switch (event.type) {
				case "text":
				case "tool-start":
					if (replyOver) {
						replyOver = false;
						turns += 1;
						if (maxTurns !== null && turns > maxTurns) {
							return trip({ kind: "turns", limit: maxTurns });
						}
					}
					return null;
				case "tool-result":
				case "report":
					replyOver = true;
					return null;
				case "tool-end": {
					const call = `${event.name}\u0000${canonicalJson(event.input)}`;
					repeats = call === lastCall ? repeats + 1 : 1;
					lastCall = call;
					return repeats >= LOOP_REPEATS
						? trip({ kind: "looping", tool: event.name })
						: null;
				}
				default:
					return null;
			}
		},
	};
}

/** JSON with the keys of every object sorted: two equal inputs give one text. */
function canonicalJson(value: unknown): string {
	return JSON.stringify(sorted(value)) ?? "undefined";
}

function sorted(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(sorted);
	if (value === null || typeof value !== "object") return value;
	return Object.fromEntries(
		Object.keys(value)
			.sort()
			.map((key) => [key, sorted((value as Record<string, unknown>)[key])]),
	);
}
