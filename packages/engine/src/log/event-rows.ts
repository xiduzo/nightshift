import type { Database } from "@nightshift/db";
import { agentSession, run, step } from "@nightshift/db/schema";
import { eq, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { saveMemoryOfStep } from "../memory";
import { saveKeptOfStep } from "../variables";
import type {
	EngineEventType,
	EnginePayloads,
	EventInput,
	EventWrites,
} from "./events";

/**
 * The rows an event of this Walker implies, written in the batch of its
 * append (`RunLog.append`): the step row of `StepStarted`, the session row
 * of `SessionStarted`, the harness id of `HarnessSessionAssigned`, and the
 * kept values and the memory a `StepEnded` names. The step runner appends the event and
 * never touches the rows, as for the events another Walker wrote
 * (`history.ts`: its rows come with the batch, its harness ids and kept
 * values from the events). A row that is there already stays: a test
 * writes one before its event. Any other event implies no row.
 */
export function withImpliedRows<T extends EngineEventType>(
	db: Database,
	input: EventInput<T>,
	writes: EventWrites = {},
): EventWrites {
	const implied = impliedRows(db, input as EventInput<EngineEventType>);
	return {
		before: [...(writes.before ?? []), ...implied.before],
		after: [...(writes.after ?? []), ...implied.after],
	};
}

function impliedRows(
	db: Database,
	input: EventInput<EngineEventType>,
): { before: BatchItem<"sqlite">[]; after: BatchItem<"sqlite">[] } {
	const { runId, stepId, sessionId } = input;
	if (!runId) return { before: [], after: [] };
	/** The run's Space, read in the same statement as the event's. */
	const spaceId = sql<string>`(select ${run.spaceId} from ${run} where ${run.id} = ${runId})`;
	switch (input.type) {
		case "StepStarted": {
			if (!stepId) return { before: [], after: [] };
			const payload = input.payload as EnginePayloads["StepStarted"];
			return {
				before: [
					db
						.insert(step)
						.values({
							id: stepId,
							spaceId,
							runId,
							nodeId: payload.nodeId,
							nodeType: payload.nodeType,
							visit: payload.visit,
							transcriptPath: payload.transcriptPath,
							// The Device the step runs on (its Placement), not the Walker.
							...(payload.deviceId !== undefined
								? { deviceId: payload.deviceId }
								: {}),
						})
						.onConflictDoNothing(),
				],
				after: [],
			};
		}
		case "SessionStarted": {
			if (!stepId || !sessionId) return { before: [], after: [] };
			const payload = input.payload as EnginePayloads["SessionStarted"];
			return {
				before: [
					db
						.insert(agentSession)
						.values({
							id: sessionId,
							spaceId,
							runId,
							stepId,
							prompt: payload.prompt,
						})
						.onConflictDoNothing(),
				],
				after: [],
			};
		}
		case "HarnessSessionAssigned": {
			if (!sessionId) return { before: [], after: [] };
			const payload = input.payload as EnginePayloads["HarnessSessionAssigned"];
			return {
				before: [],
				after: [
					db
						.update(agentSession)
						.set({ harnessSessionId: payload.harnessSessionId })
						.where(eq(agentSession.id, sessionId)),
				],
			};
		}
		case "StepEnded": {
			const payload = input.payload as EnginePayloads["StepEnded"];
			if (!stepId) return { before: [], after: [] };
			return {
				before: [],
				after: [
					...(payload.kept && payload.variables
						? saveKeptOfStep(db, {
								runId,
								stepId,
								flowName: payload.kept.flowName,
								names: payload.kept.names,
								variables: payload.variables,
							})
						: []),
					...(payload.memory
						? saveMemoryOfStep(db, { runId, stepId, memory: payload.memory })
						: []),
				],
			};
		}
		default:
			return { before: [], after: [] };
	}
}
