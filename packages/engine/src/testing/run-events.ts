import type { FlowNodeType } from "@nightshift/flows";
import {
	type EngineEventType,
	type EnginePayloads,
	foldRun,
	type LoggedEvent,
	type RunState,
	type Scope,
	type SessionOutcome,
	type StepOutcome,
} from "../log";

/**
 * Builds the event log of one run, shape only, for a test of what the log
 * says. Each event gets the next seq. It happens at the time `at` gave,
 * else one ms after the event before it (the first at 1000).
 */
export function runEvents(runId = "run-1") {
	const events: LoggedEvent[] = [];
	let next = 1000;
	const push = <T extends EngineEventType>(
		type: T,
		payload: EnginePayloads[T],
		ids: { stepId?: string; sessionId?: string } = {},
	) => {
		events.push({
			seq: events.length + 1,
			runId,
			stepId: ids.stepId ?? null,
			sessionId: ids.sessionId ?? null,
			type,
			payload,
			at: next,
		} as LoggedEvent);
		next += 1;
		return builder;
	};
	const builder = {
		events,
		push,
		/** The run state of the events so far. */
		state: (): RunState => foldRun(events),
		/** The next event happens at `time`. */
		at(time: number) {
			next = time;
			return builder;
		},
		runStarted: (extra: Partial<EnginePayloads["RunStarted"]> = {}) =>
			push("RunStarted", {
				projectId: "p",
				flowName: "f",
				title: "f",
				start: "worker",
				...extra,
			}),
		resumed: (
			nodeId: string,
			stepId: string | null = null,
			extra: Partial<EnginePayloads["RunResumed"]> = {},
		) => push("RunResumed", { nodeId, stepId, prompt: null, ...extra }),
		stepStarted: (
			stepId: string,
			nodeId: string,
			visit = 1,
			extra: Partial<EnginePayloads["StepStarted"]> = {},
		) =>
			push(
				"StepStarted",
				{
					nodeId,
					nodeType: nodeTypeFor(nodeId),
					visit,
					transcriptPath: `/t/${stepId}`,
					logPath: null,
					...extra,
				},
				{ stepId },
			),
		stepReopened: (stepId: string) =>
			push("StepReopened", { prompt: "go on" }, { stepId }),
		stepEnded: (
			stepId: string,
			outcome: StepOutcome = "pass",
			outputs: EnginePayloads["StepEnded"]["outputs"] = {},
			costUsd?: number | null,
		) =>
			push(
				"StepEnded",
				{
					outcome,
					outputs: { outcome, ...outputs },
					error: null,
					...(costUsd === undefined ? {} : { costUsd }),
				},
				{ stepId },
			),
		gateOpened: (stepId: string, question = "Ship it?", lockScreen = false) =>
			push(
				"GateOpened",
				{
					question,
					choices: [{ name: "approve" }, { name: "reject" }],
					...(lockScreen ? { lockScreen: true as const } : {}),
				},
				{ stepId },
			),
		waitStarted: (
			stepId: string,
			extra: Partial<EnginePayloads["WaitStarted"]> = {},
		) =>
			push(
				"WaitStarted",
				{
					reason: "command",
					until: 9999,
					message: "Tries again",
					since: 0,
					...extra,
				},
				{ stepId },
			),
		waitEnded: (stepId: string) =>
			push("WaitEnded", { early: false }, { stepId }),
		sessionStarted: (
			stepId: string,
			sessionId: string,
			extra: Partial<EnginePayloads["SessionStarted"]> = {},
		) =>
			push(
				"SessionStarted",
				{ prompt: "p", resumeSessionId: null, ...extra },
				{ stepId, sessionId },
			),
		harness: (
			stepId: string,
			sessionId: string,
			harnessSessionId: string,
			model: string | null = null,
		) =>
			push(
				"HarnessSessionAssigned",
				{ harnessSessionId, model },
				{ stepId, sessionId },
			),
		sessionEnded: (
			stepId: string,
			sessionId: string,
			outcome: SessionOutcome = "finished",
			costUsd: number | null = null,
			extra: Partial<EnginePayloads["SessionEnded"]> = {},
		) =>
			push(
				"SessionEnded",
				{
					outcome,
					error: null,
					errorKind: null,
					usage: null,
					costUsd,
					resetAt: null,
					...extra,
				},
				{ stepId, sessionId },
			),
		edge: (edgeId: string, from: string, to: string, scope?: Scope) =>
			push("EdgeTaken", {
				edgeId,
				from,
				to,
				outcome: "pass",
				...(scope ? { scope } : {}),
			}),
		ended: (
			status: EnginePayloads["RunEnded"]["status"],
			reason: string | null = null,
			result?: EnginePayloads["RunEnded"]["result"],
		) => push("RunEnded", { status, reason, ...(result ? { result } : {}) }),
	};
	return builder;
}

/** The node type a test's node id suggests: `check` runs a command, `gate` and `decide` decide, the rest are agents. */
function nodeTypeFor(nodeId: string): FlowNodeType {
	if (nodeId === "check") return "command";
	if (nodeId === "gate" || nodeId === "decide") return "decision";
	return "agent";
}
